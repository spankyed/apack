import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb from '@apackdev/sdk/fe'
import { contextMenu, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import { targetIs, TRAIL_CLICK, type TrailClickEvent } from '@apackdev/sdk/fe'
import { answerOf, answersCall, isAnswered, newCall, type AnswersOf } from '@apackdev/sdk/events'
import type { DatabaseSettings } from '#generated/types.ts'
import type { DatabaseContext, DatabaseInboxEvent } from './contract.ts'
import type { DatabaseSchemaInfo, OutgoingDatabaseEvents } from '#features/database/be/types.ts'
import type { Contract as DatabaseSystemContract } from '#features/database/be/contract.ts'
import { sendToSystem } from '#generated/events.ts'
import { fromView } from '#generated/fe.ts'
import { attributeQueryTemplate, entityQueryTemplate, exampleQuery, relationQueryTemplate } from './constants.ts'
import { History, HardDriveDownload } from 'lucide-vue-next'

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'database' as const;
export type DatabaseState = ActorRefFrom<typeof databaseState>

/** Database replacement invalidates row results and outstanding requests, not the query editor or preferences. */
function emptyDatabaseResults() {
  return {
    queryResult: null, isLoading: false, error: null, executionTime: null,
    pendingQueryCall: null, pendingTransactionCall: null, selectedSchemaItem: null,
    isAiQueryLoading: false,
    flowRuns: [], currentFlowId: null, flowEvents: [], expandedNodes: new Set<string>(),
    nodeDetails: new Map<string, import('@apackdev/sdk/steps').RunNode>(), isLoadingRuns: false,
    runPagination: { offset: 0, limit: 50, hasMore: false },
  };
}

/**
 * `OutgoingDatabaseEvents` and nothing of its own: a union of a member with its own copy narrows to *both*, so a
 * field added to the canonical declaration would read as optional here with no type error anywhere.
 */
type SystemEvent = OutgoingDatabaseEvents |
  { type: 'FEATURE_SETTINGS_UPDATED'; settings: DatabaseSettings }

type UIEvent =
  | SurfaceLifecycleEvent
  | { type: 'QUERY.EXECUTE'; code: string }
  | { type: 'TRANSACTION.EXECUTE'; code: string }
  | { type: 'SCHEMA.SELECT'; itemType: 'entity' | 'attribute' | 'relation'; value: string }
  | { type: 'QUERY.UPDATE'; code: string }
  | { type: 'SCHEMA.READ'; schema: DatabaseSchemaInfo }
  | { type: 'SCHEMA.FAILED'; error: string }
  | { type: 'DATABASE.RESET' }
  | { type: 'MODE.TOGGLE' }
  | { type: 'AI_QUERY.GENERATE'; prompt: string; mode: 'query' | 'transaction' }
  | { type: 'VIEW_MODE.TOGGLE' }
  | { type: 'RUNS.SELECT_FLOW'; flowId: string }
  | { type: 'RUNS.EXPAND_NODE'; nodeId: string }
  | { type: 'RUNS.LOAD_MORE' }
  | { type: 'RUNS.REQUEST_FLOWS' }
  | { type: 'ENTITY.DELETE'; entityId: string }
  | DatabaseInboxEvent
  | { type: 'BACK_TO_EXPLORER' }
  | { type: 'BACKUP.EXPORT'; path: string; name?: string; databases: Array<'lmdb' | 'runHistory'> }
  | { type: 'BACKUP.IMPORT'; path: string; skipUnknownDatabases?: boolean }
  | { type: 'BACKUP.READ_INFO'; path: string }
  | TrailClickEvent

export type DatabaseEvents = UIEvent | SystemEvent | AnswersOf<DatabaseSystemContract>
const typeOf = safeEvents<DatabaseEvents>()

const generateQueryForSchemaItem = (type: 'entity' | 'attribute' | 'relation', value: string): string => {
  switch (type) {
    case 'entity':
      return entityQueryTemplate(value);
    case 'attribute':
      return attributeQueryTemplate(value);
    case 'relation':
      return relationQueryTemplate(value);
  }
}

const SCHEMA_VIEW = 'schemaView'

const databaseState = setup({
  actors: {
    schemaView: fromView('database', 'schema', (update) =>
      (update.ok ? { type: 'SCHEMA.READ' as const, schema: update.value } : { type: 'SCHEMA.FAILED' as const, error: update.error })),
  },
  types: {
    context: {} as DatabaseContext,
    events: {} as DatabaseEvents,
  },
  guards: {
    targetIs,
    /**
     * Whether an answer answers the query or the transaction still outstanding, landed or refused.
     *
     * A transition guard rather than a check inside each handler: an action that has to decide whether
     * to do nothing is one someone later edits into doing something, and `threads`' `SET_VIEW_DATA` does
     * it this way for the same reason. An answer to an ask nobody is waiting for is simply not taken.
     *
     * `answersCall` is false when the slot is empty, which is what makes "an answer nobody asked for" a
     * case this refuses rather than one it admits — see its doc for why the comparison cannot be written
     * by hand.
     */
    answersPendingQuery: ({ context, event }) => event.type.startsWith('ASK_') && (event as { asked?: string }).asked === 'EXECUTE_QUERY' && answersCall(event, context.pendingQueryCall),
    answersPendingTransaction: ({ context, event }) => event.type.startsWith('ASK_') && (event as { asked?: string }).asked === 'EXECUTE_TRANSACTION' && answersCall(event, context.pendingTransactionCall),
    /**
     * Whether these events are the page the viewer is waiting for: the right flow *and* the right offset.
     *
     * The flow alone was not enough, and the gap was reachable. `setFlowEvents` decided append-or-replace
     * from whatever offset the context had reached, so re-selecting a flow while a later page was in
     * flight made that page replace the whole list — page two shown as if it were the flow. The reply
     * echoes its `offset` now, which is what lets this say *which* page rather than only which flow.
     */
    answersCurrentPage: ({ context, event }) => {
      if (!isAnswered(event, 'GET_FLOW_EVENTS')) return false;
      const { flowId, offset } = answerOf(event, 'GET_FLOW_EVENTS');
      return flowId === context.currentFlowId && offset === context.runPagination.offset;
    },
  },
  actions: {
    /* ── the schema, followed from the shell's start, in a delivery naming the surface ── */
    followSchema: enqueueActions(({ enqueue }) => {
      enqueue.stopChild(SCHEMA_VIEW);
      enqueue.spawnChild('schemaView', { id: SCHEMA_VIEW });
    }),
    setSchema: assign(({ event }) => ({ schema: typeOf('SCHEMA.READ', event).schema })),
    setSchemaError: assign(({ event }) => ({ error: typeOf('SCHEMA.FAILED', event).error })),
    /** Any window replaced the data: what this one shows names rows that may be gone */
    dropReplacedResults: assign(emptyDatabaseResults),

    /* ── settings ─────────────────────────────────────── */
    setDatabaseSettings: assign(({ event }) => {
      const ev = typeOf('FEATURE_SETTINGS_UPDATED', event);
      return {
        settings: ev.settings
      }
    }),

    /* ── query interactions ────────────────────────────── */
    /**
     * The four asks mint the call, which is what makes an answer identifiable.
     *
     * **`newCall()` rather than the one `sendToSystem` returns, because of the shape these are written in.**
     * An `enqueueActions` body defers its sends past the `assign` that stores the id, so the id has to exist
     * before the send does; `sendToSystem`'s own return would arrive a turn too late. Given one it uses it,
     * so the stored value and the sent value are the same by construction rather than by ordering.
     *
     * Minted by the asker rather than stamped by the answerer, which the envelope's `newCall` keeps: the
     * case this exists for is an ask someone stopped waiting for, and an id assigned when the answer is
     * built would give that abandoned ask's late answer the newest id. Random, not a counter, because an
     * answer can reach every window and a counter local to one would collide with another's.
     */
    executeQuery: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('QUERY.EXECUTE', event);
      const call = newCall();
      enqueue.assign({ pendingQueryCall: call });
      enqueue(() => sendToSystem(id, { type: 'EXECUTE_QUERY', code: ev.code }, { call }));
    }),

    executeTransaction: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('TRANSACTION.EXECUTE', event);
      const call = newCall();
      enqueue.assign({ pendingTransactionCall: call });
      enqueue(() => sendToSystem(id, { type: 'EXECUTE_TRANSACTION', code: ev.code }, { call }));
    }),

    deleteEntity: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ENTITY.DELETE', event);
      // Use write() to delete the entity
      const deleteCode = `write('${ev.entityId}').destroy(); return { deleted: '${ev.entityId}' };`;
      const call = newCall();
      enqueue.assign({ pendingTransactionCall: call });
      enqueue(() => sendToSystem(id, { type: 'EXECUTE_TRANSACTION', code: deleteCode }, { call }));
    }),

    /** Sent from inside an answer's handler, so there is no incoming event to take a call from */
    refreshAfterDelete: enqueueActions(({ context, enqueue }) => {
      // Re-run the current query after successful deletion
      if (!context.currentQuery) return;
      const code = context.currentQuery;
      const call = newCall();
      enqueue.assign({ pendingQueryCall: call });
      enqueue(() => sendToSystem(id, { type: 'EXECUTE_QUERY', code }, { call }));
    }),

    updateQuery: assign(({ event }) => {
      const ev = typeOf('QUERY.UPDATE', event);
      return { currentQuery: ev.code };
    }),

    setQueryResult: assign(({ event }) => {
      const ev = answerOf(event, 'EXECUTE_QUERY');
      return {
        queryResult: ev.result,
        executionTime: ev.executionTime,
        isLoading: false,
        error: null,
        // Cleared, so a second reply carrying the same id is not accepted twice
        pendingQueryCall: null,
      };
    }),

    setQueryError: assign(({ event }) => {
      return {
        error: typeOf('ASK_FAILED', event).failure.message,
        isLoading: false,
        pendingQueryCall: null,
      };
    }),

    setTransactionResult: enqueueActions(({ event, enqueue }) => {
      const ev = answerOf(event, 'EXECUTE_TRANSACTION');
      const settled = {
        queryResult: ev.result,
        executionTime: ev.executionTime,
        isLoading: false,
        error: null,
        pendingTransactionCall: null,
      } as const;

      // Check if this was a delete operation
      if (ev.result && ev.result.deleted) {
        // After successful deletion, refresh the current query
        enqueue.assign(settled);
        enqueue('refreshAfterDelete');
      } else {
        // Regular transaction result
        enqueue.assign(settled);
      }
    }),

    /**
     * Generating a query from a prompt failed: refused as it was asked, or failed in the flow it started. Its own
     * handler because it owns `isAiQueryLoading`, which no query's answer touches.
     */
    setAiQueryError: assign(({ event }) => ({
      error: event.type === 'ASK_FAILED' ? event.failure.message : typeOf('AI_QUERY_ERROR', event).error,
      isAiQueryLoading: false,
    })),

    setTransactionError: assign(({ event }) => {
      return {
        error: typeOf('ASK_FAILED', event).failure.message,
        isLoading: false,
        pendingTransactionCall: null,
      };
    }),

    toggleMode: assign(({ context }) => {
      const newMode: 'query' | 'transaction' = context.mode === 'query' ? 'transaction' : 'query';
      return {
        mode: newMode,
      };
    }),

    setLoading: assign({
      isLoading: true,
      error: null,
    }),

    /* ── ai query ───────────────────────────────── */
    generateAiQuery: ({ event }) => {
      const ev = typeOf('AI_QUERY.GENERATE', event);
      if (!ev.prompt?.trim()) {
        console.error('Invalid prompt provided for AI query generation');
        return;
      }
      sendToSystem(id, {
        type: 'GENERATE_AI_QUERY',
        prompt: ev.prompt.trim(),
        mode: ev.mode,
      });
    },

    setAiQueryLoading: assign({
      isAiQueryLoading: true,
    }),

    setAiQueryResult: assign(({ event }) => {
      const ev = typeOf('AI_QUERY_GENERATED', event);
      return {
        currentQuery: ev.query,
        isAiQueryLoading: false,
      };
    }),

    /* ── schema interactions ───────────────────────────────── */
    selectSchemaItem: assign(({ event }) => {
      const ev = typeOf('SCHEMA.SELECT', event);
      const query = generateQueryForSchemaItem(ev.itemType, ev.value);

      return {
        selectedSchemaItem: {
          type: ev.itemType,
          value: ev.value,
        },
        currentQuery: query,
      };
    }),


    /* ── run history viewer actions ──────────────────────── */
    toggleViewMode: assign(({ context }) => {
      const newMode: DatabaseContext['viewMode'] = context.viewMode === 'database' ? 'runs' : 'database';
      if (newMode === 'runs' && context.flowRuns.length === 0) {
        // Ask for the flow runs when switching to the run history the first time
        sendToSystem(id, {
          type: 'GET_FLOW_RUNS',
        });
      }
      return {
        viewMode: newMode,
        isLoadingRuns: newMode === 'runs' && context.flowRuns.length === 0,
      };
    }),

    requestFlowRuns: () => {
      sendToSystem(id, {
        type: 'GET_FLOW_RUNS',
      });
    },

    setFlowRuns: assign(({ event }) => {
      const ev = answerOf(event, 'GET_FLOW_RUNS');
      // Newest first, as the run history lists them
      const sortedFlows = ev.flows;

      // Auto-select first flow if we have flows and no current selection
      if (sortedFlows.length > 0) {
        const firstFlow = sortedFlows[0];
        sendToSystem(id, {
          type: 'GET_FLOW_EVENTS',
          flowId: firstFlow.id,
          offset: 0,
          limit: 50,
        });

        return {
          flowRuns: sortedFlows,
          currentFlowId: firstFlow.id,
          isLoadingRuns: true, // Still loading events for the selected flow
        };
      }

      return {
        flowRuns: sortedFlows,
        isLoadingRuns: false,
      };
    }),

    selectFlow: assign(({ event }) => {
      const ev = typeOf('RUNS.SELECT_FLOW', event);
      sendToSystem(id, {
        type: 'GET_FLOW_EVENTS',
        flowId: ev.flowId,
        offset: 0,
        limit: 50,
      });
      return {
        currentFlowId: ev.flowId,
        flowEvents: [],
        runPagination: {
          offset: 0,
          limit: 50,
          hasMore: false,
        },
        isLoadingRuns: true,
      };
    }),

    setFlowEvents: assign(({ event, context }) => {
      const ev = answerOf(event, 'GET_FLOW_EVENTS');
      return {
        // The page this answer is *for*. Equal to the context's offset today, because the guard admits
        // only the page being awaited — so no case can tell the two readings apart, and none pretends to.
        // It is the event's to say: loosen that guard to accept a range and reading the context goes wrong
        // silently, which is the edit that would make this line matter.
        // A later page of a live run repeats what an event arriving since shifted onto it: pages are newest first
        // by offset, so a new event moves every one down. Only the ones not listed yet are added
        flowEvents: ev.offset > 0
          ? [...context.flowEvents, ...ev.events.filter((event) => !context.flowEvents.some((listed) => listed.id === event.id))]
          : ev.events,
        runPagination: {
          ...context.runPagination,
          hasMore: ev.hasMore,
        },
        isLoadingRuns: false,
      };
    }),

    loadMoreEvents: enqueueActions(({ context, enqueue }) => {
      // One page at a time. The guard admits the offset being awaited, so a second click while the first
      // page is in flight would move that offset and strand the page already asked for.
      if (!context.currentFlowId || !context.runPagination.hasMore || context.isLoadingRuns) return;

      const newOffset = context.runPagination.offset + context.runPagination.limit;
      sendToSystem(id, {
        type: 'GET_FLOW_EVENTS',
        flowId: context.currentFlowId,
        offset: newOffset,
        limit: context.runPagination.limit,
      });
      enqueue.assign({
        runPagination: {
          ...context.runPagination,
          offset: newOffset,
        },
        isLoadingRuns: true,
      });
    }),

    expandNode: enqueueActions(({ event, context, enqueue }) => {
      const ev = typeOf('RUNS.EXPAND_NODE', event);
      const newExpanded = new Set(context.expandedNodes);

      if (newExpanded.has(ev.nodeId)) {
        newExpanded.delete(ev.nodeId);
      } else {
        newExpanded.add(ev.nodeId);
        // Request node details if not already loaded
        if (!context.nodeDetails.has(ev.nodeId)) {
          sendToSystem(id, {
            type: 'GET_NODE_DETAILS',
            nodeId: ev.nodeId,
          });
        }
      }

      enqueue.assign({
        expandedNodes: newExpanded,
      });
    }),

    setNodeDetails: assign(({ event, context }) => {
      const ev = answerOf(event, 'GET_NODE_DETAILS');
      if (ev.details) {
        const newDetails = new Map(context.nodeDetails);
        newDetails.set(ev.nodeId, ev.details);
        return {
          nodeDetails: newDetails,
        };
      }
      return {};
    }),

    /* ── backup actions ─────────────────────────────────── */
    requestBackupInfo: ({ event }) => {
      sendToSystem(id, { type: 'GET_BACKUP_INFO', path: typeOf('BACKUP.READ_INFO', event).path });
    },

    setBackupInfo: assign(({ event }) => {
      const ev = answerOf(event, 'GET_BACKUP_INFO');
      return {
        backupInfo: ev.info,
      };
    }),

    exportBackup: ({ event }) => {
      const { path, name, databases } = typeOf('BACKUP.EXPORT', event);
      sendToSystem(id, { type: 'EXPORT_DATABASE', path, name, databases });
    },

    importBackup: ({ event }) => {
      const { path, skipUnknownDatabases } = typeOf('BACKUP.IMPORT', event);
      sendToSystem(id, { type: 'IMPORT_DATABASE', path, skipUnknownDatabases });
    },

    exportFinished: assign(({ event }) => ({
      exporting: false,
      backupResult: { operation: 'export' as const, error: event.type === 'ASK_FAILED' ? event.failure.message : undefined },
    })),

    importFinished: assign(({ event }) => {
      if (isAnswered(event, 'IMPORT_DATABASE')) {
        return { ...emptyDatabaseResults(), importing: false, backupResult: { operation: 'import' as const, message: event.answer.message } };
      }
      const { failure } = typeOf('ASK_FAILED', event);
      return {
        importing: false,
        backupResult: {
          operation: 'import' as const,
          error: failure.message,
          ...(failure.kind === 'unknown-databases' ? { unknownDatabases: failure.unknownDatabases } : {}),
        },
      };
    }),

    /* ── reset database actions ─────────────────────────── */
    resetDatabase: () => {
      sendToSystem(id, {
        type: 'RESET_DATABASE',
      });
    },

    handleResetSuccess: assign(emptyDatabaseResults),

    handleResetError: assign(({ event }) => ({ error: `Reset failed: ${typeOf('ASK_FAILED', event).failure.message}` })),
  },
}).createMachine({
  id,
  initial: 'explorer',
  context: () => ({
    ...emptyDatabaseResults(),
    schema: {
      entities: [],
      attributes: [],
      relations: [],
    },
    currentQuery: exampleQuery,
    mode: 'query',
    settings: null,
    // Run history viewer fields
    viewMode: 'database',
    // Backup fields
    backupInfo: null,
    exporting: false,
    importing: false,
    backupResult: null,
  }),
  on: {
    ...TRAIL_CLICK([
      ['.explorer', 'explorer'],
    ]),
    // Where a surface asks for what it starts from: the shell hands it this in a delivery naming the surface
    SURFACE_STARTED: { actions: 'followSchema' },
    'SCHEMA.READ': { actions: 'setSchema' },
    'SCHEMA.FAILED': { actions: 'setSchemaError' },
    DATABASE_REPLACED: { actions: 'dropReplacedResults' },
    AI_QUERY_ERROR: { actions: 'setAiQueryError' },
AI_QUERY_LOADING: { actions: 'setAiQueryLoading' },
    AI_QUERY_GENERATED: { actions: 'setAiQueryResult' },
    FEATURE_SETTINGS_UPDATED: { actions: 'setDatabaseSettings' },
    // The answers to what this window asks: a query or a transaction it is waiting on, a page of the run history, a
    // backup's summary, and replacing or exporting the data. A query's answer is the console's only while it is the one
    // outstanding
    ASK_ANSWERED: [
      { guard: ({ event }) => isAnswered(event, 'EXPORT_DATABASE'), actions: 'exportFinished' },
      { guard: ({ event }) => isAnswered(event, 'IMPORT_DATABASE'), actions: 'importFinished' },
      { guard: ({ event }) => isAnswered(event, 'RESET_DATABASE'), actions: 'handleResetSuccess' },
      { guard: 'answersPendingQuery', actions: 'setQueryResult' },
      { guard: 'answersPendingTransaction', actions: 'setTransactionResult' },
      { guard: ({ event }) => isAnswered(event, 'GET_FLOW_RUNS'), actions: 'setFlowRuns' },
      { guard: 'answersCurrentPage', actions: 'setFlowEvents' },
      { guard: ({ event }) => isAnswered(event, 'GET_NODE_DETAILS'), actions: 'setNodeDetails' },
      { guard: ({ event }) => isAnswered(event, 'GET_BACKUP_INFO'), actions: 'setBackupInfo' },
    ],
    ASK_FAILED: [
      { guard: 'answersPendingQuery', actions: 'setQueryError' },
      { guard: 'answersPendingTransaction', actions: 'setTransactionError' },
      { guard: ({ event }) => event.asked === 'GENERATE_AI_QUERY', actions: 'setAiQueryError' },
      { guard: ({ event }) => event.asked === 'EXPORT_DATABASE', actions: 'exportFinished' },
      { guard: ({ event }) => event.asked === 'IMPORT_DATABASE', actions: 'importFinished' },
      { guard: ({ event }) => event.asked === 'RESET_DATABASE', actions: 'handleResetError' },
    ],
    // Reset database events. The request comes from the surface's settings, whatever view the surface is in
    'DATABASE.RESET': { actions: 'resetDatabase' },
  },
  meta: {
    ...breadcrumb('explorer', 'Database Explorer', true),
    ...contextMenu([
      { label: 'View Run History', icon: History, event: { type: 'VIEW_MODE.TOGGLE' }, iconColor: 'text-purple-400' },
{ separator: true, label: 'Backup & Restore', icon: HardDriveDownload, event: { type: 'VIEW_BACKUP' }, iconColor: 'text-green-400' },
    ]),
  },
  states: {
    explorer: {
      tags: ['database-explorer'],
      on: {
        'QUERY.EXECUTE': {
          actions: ['setLoading', 'executeQuery'],
        },
        'TRANSACTION.EXECUTE': {
          actions: ['setLoading', 'executeTransaction'],
        },
        'ENTITY.DELETE': {
          actions: ['setLoading', 'deleteEntity'],
        },
        'QUERY.UPDATE': {
          actions: 'updateQuery',
        },
        'MODE.TOGGLE': {
          actions: 'toggleMode',
        },
        'SCHEMA.SELECT': {
          actions: 'selectSchemaItem',
        },
'AI_QUERY.GENERATE': {
          actions: ['generateAiQuery'],
        },
        'VIEW_MODE.TOGGLE': {
          actions: ['toggleViewMode', 'requestFlowRuns'],
        },
        'RUNS.SELECT_FLOW': {
          actions: 'selectFlow',
        },
        'RUNS.EXPAND_NODE': {
          actions: 'expandNode',
        },
        'RUNS.LOAD_MORE': {
          actions: 'loadMoreEvents',
        },
        'RUNS.REQUEST_FLOWS': {
          actions: 'requestFlowRuns',
        },
        'VIEW_BACKUP': {
          target: 'backup',
        },
      },
    },
    backup: {
      meta: { ...breadcrumb('backup', 'Backup & Restore') },
      on: {
        'BACK_TO_EXPLORER': {
          target: 'explorer',
        },
        'BACKUP.EXPORT': { actions: ['exportBackup', assign({ exporting: true })] },
        'BACKUP.IMPORT': { actions: ['importBackup', assign({ importing: true })] },
        'BACKUP.READ_INFO': { actions: 'requestBackupInfo' },
      },
    },
  },
})

export default databaseState
