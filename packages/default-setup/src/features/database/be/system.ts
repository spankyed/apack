import { featureSettings } from '#generated/settings.ts';

import { tell, broadcast } from '#generated/events.ts';
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

/** The data was replaced: every window drops what it showed, and the asker is answered besides */
const replaced = () => broadcast('database', { type: 'DATABASE_REPLACED' });

/**
 * What a window asks the database feature, each answered to whoever asked, its replacing the data among them; that
 * the data was replaced is news besides, for every window. A query's answer names the request it is
 * for by the envelope's call, so two in flight from one console answer two requests, and the console tells its own.
 */
export const answers = databaseSpec.answers({
  EXECUTE_QUERY: ({ args }) => ran('Query execution', () => executeQuery(args.code)),
  EXECUTE_TRANSACTION: ({ args }) => ran('Transaction execution', () => executeTransaction(args.code)),
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
  GET_FLOW_EVENTS: ({ args }) => {
    const { flowId, offset = 0, limit = 50 } = args;
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
  GET_NODE_DETAILS: ({ args }) => {
    try {
      const details = services.runHistory.get(args.nodeId as RunNodeId) ?? null;
      logger.info('Retrieved node details', { nodeId: args.nodeId });
      return { nodeId: args.nodeId, details };
    } catch (error: unknown) {
      logger.error('Failed to get node details:', { error: errorMessage(error), nodeId: args.nodeId });
      return { nodeId: args.nodeId, details: null };
    }
  },
  GET_BACKUP_INFO: async ({ args }) => {
    try {
      return { info: await services.appData.readBackupSummary(args.path) };
    } catch (error: unknown) {
      logger.error('Failed to get backup info:', { error: errorMessage(error) });
      return { info: null };
    }
  },
  /**
   * Started, and answered as soon as it is: the query arrives later, from the flow it starts (`db-query`,
   * `db-transaction`), which sends it to the asking window by its connection. A flow run is no delivery, so the brain
   * event carries that connection for the action to answer.
   */
  GENERATE_AI_QUERY: ({ args: { prompt, mode }, client }) => {
    if (!prompt?.trim()) throw new Error('Please provide a valid prompt');

    const threadsSettings = featureSettings.forFeature('threads').get();
    const provider = threadsSettings?.chat?.defaultMode || 'Claude Code';

    tell('brain', {
      type: 'HANDLE_BRAIN_EVENT',
      eventType: 'db.query',
      payload: { prompt: prompt.trim(), mode: mode ?? 'query', provider, ...(client && { client }) },
    });
  },
  EXPORT_DATABASE: async ({ args: { path, name, databases } }) => {
    try {
      return { path: await services.appData.exportBackup(path, name, databases) };
    } catch (error: unknown) {
      logger.error('Failed to export database:', { error: errorMessage(error) });
      throw error;
    }
  },
  // Replaces stored data and reloads memory from it; on failure the previous data is restored and reloaded. The
  // settings come in with the rest, and the import's migrations write them: run through the settings' writer, it
  // tells the settings system a replacement is running, so nothing is told a change until it ends
  IMPORT_DATABASE: async ({ args: { path, skipUnknownDatabases }, refuse }) => {
    let imported;
    try {
      imported = await services.appData.importBackup(path, { skipUnknownDatabases });
    } catch (error: unknown) {
      logger.error('Failed to import database:', { error: errorMessage(error) });
      // The user decides whether to import a newer apack's backup without what this one can't hold
      if (error instanceof UnknownBackupDatabasesError) {
        throw refuse('unknown-databases', errorMessage(error), { unknownDatabases: error.databases });
      }
      throw error;
    }
    const { missingDatabases, unknownEntityTypes } = imported;
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
    replaced();
    return { message: `Import successful.${nothingToRestore}${fromMissingPacks} Please restart the brain manually.` };
  },
  RESET_DATABASE: async () => {
    try {
      logger.info('Starting database reset...');

      // The host resets the whole app: fresh stores, then each pack's onInit and its content (the root flow among it), then migrations
      await services.appData.reset();

      // Restart the brain with the new root flow
      tell('brain', { type: 'RESTART_BRAIN' });

      logger.info('Database reset completed', { flowId: repository.flowsQueries.rootFlow() });
    } catch (error: unknown) {
      logger.error('Database reset failed:', { error: errorMessage(error) });
      throw error;
    }
    replaced();
    return { message: 'Database reset successfully. New root flow created.' };
  },
});

export const databaseSystem = setup({
  types: databaseSpec.types,
  actions: { ...answers.actions },
}).createMachine({
  id: 'database',
  initial: 'idle',
  context: () => ({}),
  states: {
    idle: {
      on: { ...answers.on },
    },
  },
});

const databaseEntry = { spec: databaseSpec, machine: databaseSystem };

export default databaseEntry;