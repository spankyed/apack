import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb from '@apackdev/sdk/fe'
import { contextMenu, makes, type MadeEvent, type Making, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import { targetIs, TRAIL_CLICK, type TrailClickEvent } from '@apackdev/sdk/fe'
import type { DatabaseSettings } from '#generated/types.ts'
import type { DatabaseContext, DatabaseInboxEvent } from './contract.ts'
import type { DatabaseSchemaInfo, OutgoingDatabaseEvents } from '#features/database/be/types.ts'
import { fromAsk } from '#generated/events.ts'
import { fromView } from '#generated/fe.ts'
import { attributeQueryTemplate, entityQueryTemplate, exampleQuery, relationQueryTemplate } from './constants.ts'
import { History, HardDriveDownload } from 'lucide-vue-next'

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'database' as const;
export type DatabaseState = ActorRefFrom<typeof databaseState>

/**
 * The asks this window makes of the database system, recorded in the context's `making` while each is under way: an
 * ask of one kind replaces the one before it, and its outcome arrives as `made.<name>`. They are children rather
 * than states because the shell reads a surface's breadcrumbs off its top-level states, which the explorer and the
 * backup view are, and an ask outlives a move between the two.
 */
const made = makes(({ one, each }) => ({
  query: one(fromAsk('database', 'EXECUTE_QUERY')),
  transaction: one(fromAsk('database', 'EXECUTE_TRANSACTION')),
  aiQuery: one(fromAsk('database', 'GENERATE_AI_QUERY')),
  flowRuns: one(fromAsk('database', 'GET_FLOW_RUNS')),
  flowEvents: one(fromAsk('database', 'GET_FLOW_EVENTS')),
  backupInfo: one(fromAsk('database', 'GET_BACKUP_INFO')),
  export: one(fromAsk('database', 'EXPORT_DATABASE')),
  import: one(fromAsk('database', 'IMPORT_DATABASE')),
  reset: one(fromAsk('database', 'RESET_DATABASE')),
  /** A node's details are asked for per node, several at once: by the node's id */
  nodeDetails: each(fromAsk('database', 'GET_NODE_DETAILS')),
}))

/** The asks whose answers name rows: given up when the data is replaced */
const ROW_ASKS = ['query', 'transaction', 'flowRuns', 'flowEvents'] as const

type DatabaseMaking = Making<typeof made>

/** Whether a query or a transaction is running */
export const isRunningCode = (making: DatabaseMaking): boolean => making.query || making.transaction
/** Whether the run history is being read: the flow runs, or a page of one's events */
export const isLoadingRuns = (making: DatabaseMaking): boolean => making.flowRuns || making.flowEvents

/** Database replacement invalidates row results and outstanding requests, not the query editor or preferences. */
function emptyDatabaseResults() {
  return {
    queryResult: null, error: null, executionTime: null,
    selectedSchemaItem: null,
    isAiQueryLoading: false,
    flowRuns: [], currentFlowId: null, flowEvents: [], expandedNodes: new Set<string>(),
    nodeDetails: new Map<string, import('@apackdev/sdk/steps').RunNode>(),
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

export type DatabaseEvents = UIEvent | SystemEvent | MadeEvent<typeof made>

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
    ...made.actors,
  },
  types: {
    context: {} as DatabaseContext,
    events: {} as DatabaseEvents,
  },
  guards: {
    targetIs,
    /** An ask that ended with its answer */
    answered: ({ event }) => 'outcome' in event && event.outcome.ok,
    /** The flow runs were read and there is one to select */
    listedFlowRuns: ({ event }) => {
      const { outcome } = typeOf('made.flowRuns', event);
      return outcome.ok && outcome.value.flows.length > 0;
    },
    /** A transaction deleted a row while a query is in the editor to run again */
    deletedRow: ({ context, event }) => {
      const { outcome } = typeOf('made.transaction', event);
      return outcome.ok && Boolean(outcome.value.result?.deleted) && Boolean(context.currentQuery);
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
    /** Any window replaced the data: what this one shows names rows that may be gone, and so would what it asked for */
    dropReplacedResults: enqueueActions(({ context, enqueue }) => {
      for (const ask of ROW_ASKS) made.drop(enqueue, context, ask);
      enqueue.assign(emptyDatabaseResults());
    }),

    /* ── settings ─────────────────────────────────────── */
    setDatabaseSettings: assign(({ event }) => {
      const ev = typeOf('FEATURE_SETTINGS_UPDATED', event);
      return {
        settings: ev.settings
      }
    }),

    /* ── query interactions ────────────────────────────── */
    /**
     * A query and a transaction are asked for independently, one of each at a time: asking again gives up the one
     * under way, so the result shown is the last one asked for. Deleting a row is a transaction that asks for the
     * current query again once it is done, which is why the two are not one ask.
     */
    executeQuery: enqueueActions(({ context, event, enqueue }) => {
      // The query typed, or the current one again after a deletion
      const code = event.type === 'QUERY.EXECUTE' ? event.code : context.currentQuery;
      enqueue.assign({ error: null });
      made.make(enqueue, 'query', { code });
    }),

    executeTransaction: enqueueActions(({ event, enqueue }) => {
      const code = event.type === 'ENTITY.DELETE'
        ? `write('${event.entityId}').destroy(); return { deleted: '${event.entityId}' };`
        : typeOf('TRANSACTION.EXECUTE', event).code;
      enqueue.assign({ error: null });
      made.make(enqueue, 'transaction', { code });
    }),

    updateQuery: assign(({ event }) => {
      const ev = typeOf('QUERY.UPDATE', event);
      return { currentQuery: ev.code };
    }),

    queryDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.query', event);
      enqueue.assign(outcome.ok
        ? { queryResult: outcome.value.result, executionTime: outcome.value.executionTime, error: null }
        : { error: outcome.failure.message });
    }),

    transactionDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.transaction', event);
      if (!outcome.ok) {
        enqueue.assign({ error: outcome.failure.message });
        return;
      }
      enqueue.assign({ queryResult: outcome.value.result, executionTime: outcome.value.executionTime, error: null });
    }),

    toggleMode: assign(({ context }) => {
      const newMode: 'query' | 'transaction' = context.mode === 'query' ? 'transaction' : 'query';
      return {
        mode: newMode,
      };
    }),

    /* ── ai query ───────────────────────────────── */
    /** Answered as soon as the flow that writes the query has started: the query arrives later, from that flow */
    generateAiQuery: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('AI_QUERY.GENERATE', event);
      if (!ev.prompt?.trim()) {
        console.error('Invalid prompt provided for AI query generation');
        return;
      }
      made.make(enqueue, 'aiQuery', { prompt: ev.prompt.trim(), mode: ev.mode });
    }),

    /** Generating a query was refused as it was asked: said where a query's error is */
    aiQueryAsked: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.aiQuery', event);
      if (!outcome.ok) enqueue.assign({ error: outcome.failure.message, isAiQueryLoading: false });
    }),

    /** Generating a query failed in the flow it started. It owns `isAiQueryLoading`, which no query's answer touches */
    setAiQueryError: assign(({ event }) => ({
      error: typeOf('AI_QUERY_ERROR', event).error,
      isAiQueryLoading: false,
    })),

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
    toggleViewMode: assign(({ context }) => ({ viewMode: context.viewMode === 'database' ? 'runs' as const : 'database' as const })),

    requestFlowRuns: enqueueActions(({ enqueue }) => {
      made.make(enqueue, 'flowRuns', {});
    }),

    /** The page of the current flow's events at the offset the context has reached, in place of any being read */
    requestFlowEvents: enqueueActions(({ context, enqueue }) => {
      if (!context.currentFlowId) {
        made.drop(enqueue, context, 'flowEvents');
        return;
      }
      const { offset, limit } = context.runPagination;
      made.make(enqueue, 'flowEvents', { flowId: context.currentFlowId, offset, limit });
    }),

    flowRunsDone: enqueueActions(({ context, event, enqueue }) => {
      const { outcome } = typeOf('made.flowRuns', event);
      if (!outcome.ok) return;
      // Newest first, as the run history lists them
      const { flows } = outcome.value;
      enqueue.assign({ flowRuns: flows });
      // The first flow is selected, for its first page to be read
      if (flows.length > 0) enqueue.assign({ currentFlowId: flows[0].id, runPagination: { ...context.runPagination, offset: 0 } });
    }),

    selectFlow: assign(({ event }) => ({
      currentFlowId: typeOf('RUNS.SELECT_FLOW', event).flowId,
      flowEvents: [],
      runPagination: { offset: 0, limit: 50, hasMore: false },
    })),

    /** One page at a time: a page asked for while another is coming would move the offset the list is built from */
    loadMoreEvents: enqueueActions(({ context, enqueue }) => {
      if (!context.currentFlowId || !context.runPagination.hasMore || context.making.flowEvents) return;
      const { limit } = context.runPagination;
      const offset = context.runPagination.offset + limit;
      enqueue.assign({ runPagination: { ...context.runPagination, offset } });
      made.make(enqueue, 'flowEvents', { flowId: context.currentFlowId, offset, limit });
    }),

    flowEventsDone: enqueueActions(({ context, event, enqueue }) => {
      const { outcome } = typeOf('made.flowEvents', event);
      if (!outcome.ok) return;
      const page = outcome.value;
      enqueue.assign({
        // The page is placed by the offset it is for: the first replaces the list, a later one adds to it.
        // A later page of a live run repeats what an event arriving since shifted onto it: pages are newest first
        // by offset, so a new event moves every one down. Only the ones not listed yet are added
        flowEvents: page.offset > 0
          ? [...context.flowEvents, ...page.events.filter((heard) => !context.flowEvents.some((listed) => listed.id === heard.id))]
          : page.events,
        runPagination: { ...context.runPagination, hasMore: page.hasMore },
      });
    }),

    expandNode: enqueueActions(({ event, context, enqueue }) => {
      const ev = typeOf('RUNS.EXPAND_NODE', event);
      const newExpanded = new Set(context.expandedNodes);

      if (newExpanded.has(ev.nodeId)) {
        newExpanded.delete(ev.nodeId);
      } else {
        newExpanded.add(ev.nodeId);
        // Its details are asked for unless they are held or already being read
        if (!context.nodeDetails.has(ev.nodeId) && !(ev.nodeId in context.making.nodeDetails)) {
          made.make(enqueue, 'nodeDetails', ev.nodeId, { nodeId: ev.nodeId });
        }
      }

      enqueue.assign({
        expandedNodes: newExpanded,
      });
    }),

    nodeDetailsDone: enqueueActions(({ event, context, enqueue }) => {
      const { outcome } = typeOf('made.nodeDetails', event);
      if (!outcome.ok || !outcome.value.details) return;
      const newDetails = new Map(context.nodeDetails);
      newDetails.set(outcome.value.nodeId, outcome.value.details);
      enqueue.assign({ nodeDetails: newDetails });
    }),

    /* ── backup actions ─────────────────────────────────── */
    requestBackupInfo: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'backupInfo', { path: typeOf('BACKUP.READ_INFO', event).path });
    }),

    backupInfoDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.backupInfo', event);
      if (outcome.ok) enqueue.assign({ backupInfo: outcome.value.info });
    }),

    exportBackup: enqueueActions(({ event, enqueue }) => {
      const { path, name, databases } = typeOf('BACKUP.EXPORT', event);
      made.make(enqueue, 'export', { path, name, databases });
    }),

    importBackup: enqueueActions(({ event, enqueue }) => {
      const { path, skipUnknownDatabases } = typeOf('BACKUP.IMPORT', event);
      made.make(enqueue, 'import', { path, skipUnknownDatabases });
    }),

    exportDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.export', event);
      enqueue.assign({ backupResult: { operation: 'export' as const, error: outcome.ok ? undefined : outcome.failure.message } });
    }),

    importDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.import', event);
      // An import that was done replaced the data, which `dropReplacedResults` has answered before this
      if (outcome.ok) {
        enqueue.assign({ backupResult: { operation: 'import' as const, error: undefined, message: outcome.value.message } });
        return;
      }
      const { failure } = outcome;
      enqueue.assign({
        backupResult: {
          operation: 'import' as const,
          error: failure.message,
          ...(failure.kind === 'unknown-databases' ? { unknownDatabases: failure.unknownDatabases } : {}),
        },
      });
    }),

    /* ── reset database actions ─────────────────────────── */
    resetDatabase: enqueueActions(({ enqueue }) => {
      made.make(enqueue, 'reset', {});
    }),

    resetDone: enqueueActions(({ event, enqueue }) => {
      const { outcome } = typeOf('made.reset', event);
      // A reset that was done replaced the data, which `dropReplacedResults` has answered before this
      if (!outcome.ok) enqueue.assign({ error: `Reset failed: ${outcome.failure.message}` });
    }),
  },
}).createMachine({
  id,
  initial: 'explorer',
  context: () => ({
    ...emptyDatabaseResults(),
    making: made.none(),
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
    [made.done]: { actions: made.settle() },
    // How each ask this window made ended, whichever view it has open by then
    'made.query': { actions: 'queryDone' },
    'made.transaction': [
      // A row was deleted: the current query is run again, to show what is left
      { guard: 'deletedRow', actions: ['transactionDone', 'executeQuery'] },
      { actions: 'transactionDone' },
    ],
    'made.aiQuery': { actions: 'aiQueryAsked' },
    'made.flowRuns': [
      { guard: 'listedFlowRuns', actions: ['flowRunsDone', 'requestFlowEvents'] },
      { actions: 'flowRunsDone' },
    ],
    'made.flowEvents': { actions: 'flowEventsDone' },
    'made.nodeDetails': { actions: 'nodeDetailsDone' },
    'made.backupInfo': { actions: 'backupInfoDone' },
    'made.export': { actions: 'exportDone' },
    'made.import': [
      { guard: 'answered', actions: ['dropReplacedResults', 'importDone'] },
      { actions: 'importDone' },
    ],
    'made.reset': [
      { guard: 'answered', actions: ['dropReplacedResults', 'resetDone'] },
      { actions: 'resetDone' },
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
          actions: 'executeQuery',
        },
        'TRANSACTION.EXECUTE': {
          actions: 'executeTransaction',
        },
        'ENTITY.DELETE': {
          actions: 'executeTransaction',
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
          actions: ['selectFlow', 'requestFlowEvents'],
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
        'BACKUP.EXPORT': { actions: 'exportBackup' },
        'BACKUP.IMPORT': { actions: 'importBackup' },
        'BACKUP.READ_INFO': { actions: 'requestBackupInfo' },
      },
    },
  },
})

export default databaseState
