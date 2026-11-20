import { featureSettings } from '#generated/settings.ts';

import { sendToSystem, broadcastToSurface } from '#generated/events.ts';
// Untyped for now: a typed `reply` needs an `answers` field on the contract and a codegen reader, which
// stays deferred. `onConnected`/`onIncoming` come from here for the same reason.
import { setup } from 'xstate';
import { performance } from 'node:perf_hooks';
import { defineSystem } from '@apackdev/sdk/framework';
import { UnknownBackupDatabasesError } from '@apackdev/sdk/services';
import type { Contract } from './contract.ts';
import { executeQuery } from './execute/query.ts';
import { executeTransaction } from './execute/transaction.ts';
import type { RunNodeId } from '@apackdev/sdk/steps';
import { createLogger } from '@apackdev/sdk/logger';
import { services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';

import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingDatabaseEvents } from './types.ts';

const logger = createLogger('database');

/** Runs a query or a transaction, timed: a failure is logged here and answered as the ask's refusal */
async function ran(what: string, run: () => Promise<unknown>) {
  try {
    const startTime = performance.now();
    const result = await run();
    return { result, executionTime: performance.now() - startTime };
  } catch (error: unknown) {
    logger.error(`${what} failed:`, { error: errorMessage(error) });
    throw error;
  }
}

export const databaseSpec = defineSystem<Contract>();

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
type OutcomeType = 'AI_QUERY_ERROR' | 'EXPORT_DATABASE_ERROR' | 'EXPORT_DATABASE_SUCCESS' | 'IMPORT_DATABASE_ERROR' | 'IMPORT_DATABASE_SUCCESS' | 'RESET_DATABASE_ERROR' | 'RESET_DATABASE_SUCCESS'
type Outcome = Extract<OutgoingDatabaseEvents, { type: OutcomeType }>

/**
 * Answers whoever asked, and tells every window when nobody did: an outcome sent from the backend still has to reach
 * a window, which is the case `reply` is absent for
 */
const answer = (reply: Reply<OutgoingDatabaseEvents> | undefined, event: Outcome): void =>
  (reply ? reply(event) : broadcastToSurface('database', event));

/** The data was replaced: every window drops what it showed, and the asker hears its own outcome besides */
const replaced = () => broadcastToSurface('database', { type: 'DATABASE_REPLACED' });

/**
 * What a window asks the database feature, each answered to whoever asked. A query's answer names the request it is
 * for by the envelope's call, so two in flight from one console answer two requests, and the console tells its own.
 */
export const answers = databaseSpec.answers({
  EXECUTE_QUERY: ({ ask }) => ran('Query execution', () => executeQuery(ask.code)),
  // The window that ran it asks for the schema again; every other one shows the schema it last asked for
  EXECUTE_TRANSACTION: ({ ask }) => ran('Transaction execution', () => executeTransaction(ask.code)),
  GET_FLOW_RUNS: () => {
    try {
      // A session's root and every subflow it ran, newest first
      const flows = services.runHistory.findRuns({ limit: 100 });
      logger.info('Retrieved flow runs', { count: flows.length });
      return { flows };
    } catch (error: unknown) {
      logger.error('Failed to get flow runs:', { error: errorMessage(error) });
      return { flows: [] };
    }
  },
  GET_FLOW_EVENTS: ({ ask }) => {
    const { flowId, offset = 0, limit = 50 } = ask;
    try {
      // The events a flow run heard are its children: a page of them, newest first, each with what it ran. The
      // index is asked for no more than the page and one beyond it, which says whether there is more
      const heard = services.runHistory.findChildren(flowId as RunNodeId, { reverse: true, limit: offset + limit + 1 });
      const events = heard.slice(offset, offset + limit).map((node) => services.runHistory.tree(node.id)!);
      logger.info('Retrieved events for flow', { count: events.length, flowId });
      return { flowId, events, hasMore: heard.length > offset + limit, offset };
    } catch (error: unknown) {
      logger.error('Failed to get flow events:', { error: errorMessage(error), flowId });
      return { flowId, events: [], hasMore: false, offset };
    }
  },
  GET_NODE_DETAILS: ({ ask }) => {
    try {
      const details = services.runHistory.get(ask.nodeId as RunNodeId) ?? null;
      logger.info('Retrieved node details', { nodeId: ask.nodeId });
      return { nodeId: ask.nodeId, details };
    } catch (error: unknown) {
      logger.error('Failed to get node details:', { error: errorMessage(error), nodeId: ask.nodeId });
      return { nodeId: ask.nodeId, details: null };
    }
  },
  GET_BACKUP_INFO: async ({ ask }) => {
    try {
      return { info: await services.appData.readBackupSummary(ask.path) };
    } catch (error: unknown) {
      logger.error('Failed to get backup info:', { error: errorMessage(error) });
      return { info: null };
    }
  },
});

export const databaseSystem = setup({
  types: databaseSpec.types,
  actions: { ...answers.actions, ...databaseSpec.actions({
    handleAiQuery: ({ event, reply, client }) => {
      const { prompt, mode } = databaseSpec.typeOf('GENERATE_AI_QUERY', event);

      if (!prompt?.trim()) {
        logger.error('Invalid prompt provided for AI query generation');
        answer(reply, { type: 'AI_QUERY_ERROR', error: 'Please provide a valid prompt' });
        return;
      }

      const threadsSettings = featureSettings.forFeature('threads').get();
      const provider = threadsSettings?.chat?.defaultMode || 'Claude Code';

      sendToSystem('brain', {
        type: 'HANDLE_BRAIN_EVENT',
        eventType: 'db.query',
        // A flow run has no return address, so the ask carries the asking window's connection for the action to answer
        payload: { prompt: prompt.trim(), mode: mode ?? 'query', provider, ...(client && { client }) },
      });
    },
    exportDatabase: ({ event, reply }) => {
      const { path, name, databases } = databaseSpec.typeOf('EXPORT_DATABASE', event);

      services.appData.exportBackup(path, name, databases).then(
        (resultPath) => {
          answer(reply, {
            type: 'EXPORT_DATABASE_SUCCESS',
            path: resultPath
          });
        },
        (error: unknown) => {
          logger.error('Failed to export database:', { error: errorMessage(error) });
          answer(reply, {
            type: 'EXPORT_DATABASE_ERROR',
            error: errorMessage(error)
          });
        }
      );
    },
    importDatabase: ({ event, reply }) => {
      const { path, skipUnknownDatabases } = databaseSpec.typeOf('IMPORT_DATABASE', event);

      // Replaces stored data and reloads memory from it; on failure the previous data is restored and reloaded. The
      // settings come in with the rest, and the import's migrations write them: run through the settings' writer, it
      // tells the settings system a replacement is running, so nothing is told a change until it ends
      services.appData.importBackup(path, { skipUnknownDatabases }).then(
        ({ missingDatabases, unknownEntityTypes }) => {
          // The brain stops itself: replacing the data sends DATA_REPLACED, which it answers by killing a flow
          // whose rows are gone. It is not restarted here, which is what the message below tells the user
          // A store the backup listed but didn't hold came back empty: said, not silently dropped
          const nothingToRestore = missingDatabases.length > 0
            ? ` The backup listed ${missingDatabases.join(', ')} but held nothing for it, so it is now empty.`
            : '';
          // Rows of a type no installed pack declares: kept, but nothing reads them until that pack is back
          const fromMissingPacks = unknownEntityTypes.length > 0
            ? ` It also holds ${unknownEntityTypes.map(([type, count]) => `${count} ${type}`).join(', ')} that no installed pack declares;`
              + ' those stay until the pack that declared them is installed again.'
            : '';
          answer(reply, {
            type: 'IMPORT_DATABASE_SUCCESS',
            message: `Import successful.${nothingToRestore}${fromMissingPacks} Please restart the brain manually.`
          });
          replaced();
        },
        (error: unknown) => {
          logger.error('Failed to import database:', { error: errorMessage(error) });
          answer(reply, {
            type: 'IMPORT_DATABASE_ERROR',
            error: errorMessage(error),
            // The user decides whether to import a newer apack's backup without what this one can't hold
            ...(error instanceof UnknownBackupDatabasesError && { unknownDatabases: error.databases }),
          });
        }
      );
    },
    resetDatabase: async ({ reply }) => {
      try {
        logger.info('Starting database reset...');

        // The host resets the whole app: fresh stores, then each pack's onInit and its content (the root flow among it), then migrations
        await services.appData.reset();

        // Restart the brain with the new root flow
        sendToSystem('brain', { type: 'RESTART_BRAIN' });

        logger.info('Database reset completed', { flowId: repository.flowsQueries.rootFlow() });

        answer(reply, {
          type: 'RESET_DATABASE_SUCCESS',
          message: 'Database reset successfully. New root flow created.'
        });

        replaced();
      } catch (error: unknown) {
        logger.error('Database reset failed:', { error: errorMessage(error) });

        answer(reply, {
          type: 'RESET_DATABASE_ERROR',
          error: errorMessage(error)
        });
      }
    },
  }) },
}).createMachine({
  id: 'database',
  initial: 'idle',
  context: () => ({}),
  states: {
    idle: {
      on: {
        ...answers.on,
        GENERATE_AI_QUERY: {
          actions: 'handleAiQuery',
        },
        EXPORT_DATABASE: {
          actions: 'exportDatabase',
        },
        IMPORT_DATABASE: {
          actions: 'importDatabase',
        },
        RESET_DATABASE: {
          actions: 'resetDatabase',
        },
      },
    },
  },
});

const databaseEntry = { spec: databaseSpec, machine: databaseSystem };

export default databaseEntry;