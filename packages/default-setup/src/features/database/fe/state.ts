import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb from '@apackdev/sdk/fe'
import { contextMenu } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import { targetIs, TRAIL_CLICK, type TrailClickEvent } from '@apackdev/sdk/fe'
import { answersCall, newCall } from '@apackdev/sdk/events'
import type { DatabaseSettings } from '#generated/types.ts'
import type { DatabaseContext, DatabaseInboxEvent } from './contract.ts'
import type { OutgoingDatabaseEvents } from '#features/database/be/types.ts'
import { sendToSystem } from '#generated/events.ts'
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
    isAiQueryLoading: false, isRefreshing: false,
    flowRuns: [], currentFlowId: null, flowEvents: [], expandedNodes: new Set<string>(),
    nodeDetails: new Map<string, import('@apackdev/sdk/steps').RunNode>(), isLoadingRuns: false,
    runPagination: { offset: 0, limit: 50, hasMore: false },
  };
}

/**
 * `OutgoingDatabaseEvents` and nothing of its own.
 *
 * It used to re-declare five of those members here as well. A union of a member with its own copy
 * narrows to *both*, so a field added to the canonical declaration read as optional with no type error
 * anywhere, so a field the backend adds reads as checked here when nothing checks it.
 */
type SystemEvent = OutgoingDatabaseEvents |
  { type: 'FEATURE_SETTINGS_UPDATED'; settings: DatabaseSettings }

type UIEvent =
  | { type: 'QUERY.EXECUTE'; code: string }
  | { type: 'TRANSACTION.EXECUTE'; code: string }
  | { type: 'SCHEMA.SELECT'; itemType: 'entity' | 'attribute' | 'relation'; value: string }
  | { type: 'QUERY.UPDATE'; code: string }
  |{ type: 'DATABASE.REFRESH_SCHEMA' }
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

export type DatabaseEvents = UIEvent | SystemEvent
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

const databaseState = setup({
  types: {
    context: {} as DatabaseContext,
    events: {} as DatabaseEvents,
  },
  guards: {
    targetIs,
    /**
     * Whether an answer answers the ask still outstanding.
     *
     * A transition guard rather than a check inside each handler: an action that has to decide whether
     * to do nothing is one someone later edits into doing something, and `threads`' `SET_VIEW_DATA` does
     * it this way for the same reason. An answer to an ask nobody is waiting for is simply not taken.
     *
     * `answersCall` is false when the slot is empty, which is what makes "an answer nobody asked for" a
     * case this refuses rather than one it admits — see its doc for why the comparison cannot be written
     * by hand.
     */
    answersPendingQuery: ({ context, event }) => answersCall(event, context.pendingQueryCall),
    answersPendingTransaction: ({ context, event }) => answersCall(event, context.pendingTransactionCall),
    /**
     * Whether these events are the page the viewer is waiting for: the right flow *and* the right offset.
     *
     * The flow alone was not enough, and the gap was reachable. `setFlowEvents` decided append-or-replace
     * from whatever offset the context had reached, so re-selecting a flow while a later page was in
     * flight made that page replace the whole list — page two shown as if it were the flow. The reply
     * echoes its `offset` now, which is what lets this say *which* page rather than only which flow.
     */
    answersCurrentPage: ({ context, event }) => {
      const ev = event as { flowId?: string; offset?: number };
      return ev.flowId === context.currentFlowId && ev.offset === context.runPagination.offset;
    },
  },
  actions: {
    /* ── the schema, fetched: a walk over the whole store, which no view should re-run on every commit ── */
    requestSchema: () => {
      sendToSystem(id, { type: 'GET_SCHEMA' });
    },
    setSchema: assign(({ event }) => ({ schema: typeOf('SCHEMA_READ', event).schema, isRefreshing: false })),
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
      const ev = typeOf('QUERY_RESULT', event);
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
      const ev = typeOf('QUERY_ERROR', event);
      return {
        error: ev.error,
        isLoading: false,
        pendingQueryCall: null,
      };
    }),

    setTransactionResult: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('TRANSACTION_RESULT', event);
      const settled = {
        queryResult: ev.result,
        executionTime: ev.executionTime,
        isLoading: false,
        error: null,
        pendingTransactionCall: null,
      } as const;

      // A transaction can add an entity type or a relation kind, so the schema is asked for again
      enqueue('requestSchema');
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
     * Generating a query from a prompt failed.
     *
     * Its own handler because it is the only one of these that answers no request, and because it owns
     * `isAiQueryLoading` — which `setQueryError` used to clear, back when one event meant both things.
     */
    setAiQueryError: assign(({ event }) => {
      const ev = typeOf('AI_QUERY_ERROR', event);
      return {
        error: ev.error,
        isAiQueryLoading: false,
      };
    }),

    setTransactionError: assign(({ event }) => {
      const ev = typeOf('TRANSACTION_ERROR', event);
      return {
        error: ev.error,
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

    setRefreshing: assign({
      isRefreshing: true,
    }),

    /* ── run history viewer actions ──────────────────────── */
    toggleViewMode: assign(({ context }) => {
      const newMode = context.viewMode === 'database' ? 'runs' : 'database';
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
      const ev = typeOf('FLOW_RUNS_RESULT', event);
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
      const ev = typeOf('FLOW_EVENTS_RESULT', event);
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
      const ev = typeOf('NODE_DETAILS_RESULT', event);
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
      const ev = typeOf('BACKUP_INFO_RESULT', event);
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
      backupResult: { operation: 'export' as const, error: event.type === 'EXPORT_DATABASE_ERROR' ? event.error : undefined },
    })),

    importFinished: assign(({ event }) => ({
      ...(event.type === 'IMPORT_DATABASE_SUCCESS' ? emptyDatabaseResults() : {}),
      importing: false,
      backupResult: {
        operation: 'import' as const,
        error: event.type === 'IMPORT_DATABASE_ERROR' ? event.error : undefined,
        ...(event.type === 'IMPORT_DATABASE_SUCCESS' ? { message: event.message } : {}),
        ...(event.type === 'IMPORT_DATABASE_ERROR' && event.unknownDatabases ? { unknownDatabases: event.unknownDatabases } : {}),
      },
    })),

    /* ── reset database actions ─────────────────────────── */
    resetDatabase: () => {
      sendToSystem(id, {
        type: 'RESET_DATABASE',
      });
    },

    handleResetSuccess: assign(emptyDatabaseResults),

    handleResetError: assign(({ event }) => {
      const ev = typeOf('RESET_DATABASE_ERROR', event);
      return {
        error: `Reset failed: ${ev.error}`,
      };
    }),
  },
}).createMachine({
  id,
  initial: 'explorer',
  entry: 'requestSchema',
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
    SCHEMA_READ: { actions: 'setSchema' },
    DATABASE_REPLACED: { actions: ['dropReplacedResults', 'requestSchema'] },
    QUERY_RESULT: { guard: 'answersPendingQuery', actions: 'setQueryResult' },
    QUERY_ERROR: { guard: 'answersPendingQuery', actions: 'setQueryError' },
    TRANSACTION_RESULT: { guard: 'answersPendingTransaction', actions: 'setTransactionResult' },
    TRANSACTION_ERROR: { guard: 'answersPendingTransaction', actions: 'setTransactionError' },
    AI_QUERY_ERROR: { actions: 'setAiQueryError' },
AI_QUERY_LOADING: { actions: 'setAiQueryLoading' },
    AI_QUERY_GENERATED: { actions: 'setAiQueryResult' },
    FEATURE_SETTINGS_UPDATED: { actions: 'setDatabaseSettings' },
    // Run history viewer events
    FLOW_RUNS_RESULT: { actions: 'setFlowRuns' },
    FLOW_EVENTS_RESULT: { guard: 'answersCurrentPage', actions: 'setFlowEvents' },
    NODE_DETAILS_RESULT: { actions: 'setNodeDetails' },
    // Backup events
    BACKUP_INFO_RESULT: { actions: 'setBackupInfo' },
    EXPORT_DATABASE_SUCCESS: { actions: 'exportFinished' },
    EXPORT_DATABASE_ERROR: { actions: 'exportFinished' },
    IMPORT_DATABASE_SUCCESS: { actions: 'importFinished' },
    IMPORT_DATABASE_ERROR: { actions: 'importFinished' },
    // Reset database events. The request comes from the surface's settings, whatever view the surface is in
    'DATABASE.RESET': { actions: 'resetDatabase' },
    RESET_DATABASE_SUCCESS: { actions: 'handleResetSuccess' },
    RESET_DATABASE_ERROR: { actions: 'handleResetError' },
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
        'DATABASE.REFRESH_SCHEMA': {
          actions: ['setRefreshing', 'requestSchema'],
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
