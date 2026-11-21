import { assign, enqueueActions, setup, type ActorRefFrom, type DoneActorEvent } from 'xstate'
import breadcrumb from '@apackdev/sdk/fe'
import { contextMenu, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import { targetIs, TRAIL_CLICK, type TrailClickEvent } from '@apackdev/sdk/fe'
import type { AskOutcome } from '@apackdev/sdk/events'
import type { DatabaseSettings } from '#generated/types.ts'
import type { DatabaseContext, DatabaseInboxEvent } from './contract.ts'
import type { DatabaseAsks, DatabaseSchemaInfo, OutgoingDatabaseEvents } from '#features/database/be/types.ts'
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
 * The asks this window has under way, each a child of the surface under the id here for as long as it is: an ask of
 * one kind replaces the one before it, and its outcome arrives as `xstate.done.actor.<id>`. They are children rather
 * than states because the shell reads a surface's breadcrumbs off its top-level states, which the explorer and the
 * backup view are, and an ask outlives a move between the two.
 */
const QUERY = 'query' as const
const TRANSACTION = 'transaction' as const
const AI_QUERY = 'aiQuery' as const
const FLOW_RUNS = 'flowRuns' as const
const FLOW_EVENTS = 'flowEvents' as const
const BACKUP_INFO = 'backupInfo' as const
const EXPORT = 'export' as const
const IMPORT = 'import' as const
const RESET = 'reset' as const
/** A node's details are asked for per node, several at once: each under this prefix and the node's id */
const NODE_DETAILS = 'nodeDetails' as const

/** The asks whose answers name rows: given up when the data is replaced */
const ROW_ASKS = [QUERY, TRANSACTION, FLOW_RUNS, FLOW_EVENTS] as const

/** A surface's snapshot, as far as telling which asks are under way needs it */
type WithChildren = { children: Record<string, unknown> }
const underWay = (snapshot: WithChildren, ask: string): boolean => snapshot.children[ask] !== undefined

/** Whether a query or a transaction is running */
export const isRunningCode = (snapshot: WithChildren): boolean => underWay(snapshot, QUERY) || underWay(snapshot, TRANSACTION)
/** Whether the run history is being read: the flow runs, or a page of one's events */
export const isLoadingRuns = (snapshot: WithChildren): boolean => underWay(snapshot, FLOW_RUNS) || underWay(snapshot, FLOW_EVENTS)
export const isExporting = (snapshot: WithChildren): boolean => underWay(snapshot, EXPORT)
export const isImporting = (snapshot: WithChildren): boolean => underWay(snapshot, IMPORT)

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

/** How ask `K` ended, as the event its child `Id` is done with */
type AskDone<K extends keyof DatabaseAsks, Id extends string> = DoneActorEvent<AskOutcome<DatabaseAsks[K]>, Id>

type AskDoneEvent =
  | AskDone<'EXECUTE_QUERY', typeof QUERY>
  | AskDone<'EXECUTE_TRANSACTION', typeof TRANSACTION>
  | AskDone<'GENERATE_AI_QUERY', typeof AI_QUERY>
  | AskDone<'GET_FLOW_RUNS', typeof FLOW_RUNS>
  | AskDone<'GET_FLOW_EVENTS', typeof FLOW_EVENTS>
  | AskDone<'GET_NODE_DETAILS', `${typeof NODE_DETAILS}.${string}`>
  | AskDone<'GET_BACKUP_INFO', typeof BACKUP_INFO>
  | AskDone<'EXPORT_DATABASE', typeof EXPORT>
  | AskDone<'IMPORT_DATABASE', typeof IMPORT>
  | AskDone<'RESET_DATABASE', typeof RESET>

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

export type DatabaseEvents = UIEvent | SystemEvent | AskDoneEvent

const isNodeDetailsDone = (event: DatabaseEvents): event is AskDone<'GET_NODE_DETAILS', `${typeof NODE_DETAILS}.${string}`> =>
  event.type.startsWith(`xstate.done.actor.${NODE_DETAILS}.`)
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
    executeQuery: fromAsk('database', 'EXECUTE_QUERY'),
    executeTransaction: fromAsk('database', 'EXECUTE_TRANSACTION'),
    generateAiQuery: fromAsk('database', 'GENERATE_AI_QUERY'),
    getFlowRuns: fromAsk('database', 'GET_FLOW_RUNS'),
    getFlowEvents: fromAsk('database', 'GET_FLOW_EVENTS'),
    getNodeDetails: fromAsk('database', 'GET_NODE_DETAILS'),
    getBackupInfo: fromAsk('database', 'GET_BACKUP_INFO'),
    exportDatabase: fromAsk('database', 'EXPORT_DATABASE'),
    importDatabase: fromAsk('database', 'IMPORT_DATABASE'),
    resetDatabase: fromAsk('database', 'RESET_DATABASE'),
  },
  types: {
    context: {} as DatabaseContext,
    events: {} as DatabaseEvents,
  },
  guards: {
    targetIs,
    /** An ask that ended with its answer */
    answered: ({ event }) => 'output' in event && event.output.ok,
    /** The flow runs were read and there is one to select */
    listedFlowRuns: ({ event }) => {
      const { output } = typeOf('xstate.done.actor.flowRuns', event);
      return output.ok && output.value.flows.length > 0;
    },
    /** A transaction deleted a row while a query is in the editor to run again */
    deletedRow: ({ context, event }) => {
      const { output } = typeOf('xstate.done.actor.transaction', event);
      return output.ok && Boolean(output.value.result?.deleted) && Boolean(context.currentQuery);
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
    dropReplacedResults: enqueueActions(({ enqueue }) => {
      for (const ask of ROW_ASKS) enqueue.stopChild(ask);
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
      enqueue.stopChild(QUERY);
      enqueue.assign({ error: null });
      enqueue.spawnChild('executeQuery', { id: QUERY, input: { code } });
    }),

    executeTransaction: enqueueActions(({ event, enqueue }) => {
      const code = event.type === 'ENTITY.DELETE'
        ? `write('${event.entityId}').destroy(); return { deleted: '${event.entityId}' };`
        : typeOf('TRANSACTION.EXECUTE', event).code;
      enqueue.stopChild(TRANSACTION);
      enqueue.assign({ error: null });
      enqueue.spawnChild('executeTransaction', { id: TRANSACTION, input: { code } });
    }),

    updateQuery: assign(({ event }) => {
      const ev = typeOf('QUERY.UPDATE', event);
      return { currentQuery: ev.code };
    }),

    queryDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.query', event);
      enqueue.stopChild(QUERY);
      enqueue.assign(output.ok
        ? { queryResult: output.value.result, executionTime: output.value.executionTime, error: null }
        : { error: output.failure.message });
    }),

    transactionDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.transaction', event);
      enqueue.stopChild(TRANSACTION);
      if (!output.ok) {
        enqueue.assign({ error: output.failure.message });
        return;
      }
      enqueue.assign({ queryResult: output.value.result, executionTime: output.value.executionTime, error: null });
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
      enqueue.stopChild(AI_QUERY);
      enqueue.spawnChild('generateAiQuery', { id: AI_QUERY, input: { prompt: ev.prompt.trim(), mode: ev.mode } });
    }),

    /** Generating a query was refused as it was asked: said where a query's error is */
    aiQueryAsked: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.aiQuery', event);
      enqueue.stopChild(AI_QUERY);
      if (!output.ok) enqueue.assign({ error: output.failure.message, isAiQueryLoading: false });
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
      enqueue.stopChild(FLOW_RUNS);
      enqueue.spawnChild('getFlowRuns', { id: FLOW_RUNS, input: {} });
    }),

    /** The page of the current flow's events at the offset the context has reached, in place of any being read */
    requestFlowEvents: enqueueActions(({ context, enqueue }) => {
      enqueue.stopChild(FLOW_EVENTS);
      if (!context.currentFlowId) return;
      const { offset, limit } = context.runPagination;
      enqueue.spawnChild('getFlowEvents', { id: FLOW_EVENTS, input: { flowId: context.currentFlowId, offset, limit } });
    }),

    flowRunsDone: enqueueActions(({ context, event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.flowRuns', event);
      enqueue.stopChild(FLOW_RUNS);
      if (!output.ok) return;
      // Newest first, as the run history lists them
      const { flows } = output.value;
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
    loadMoreEvents: enqueueActions(({ context, enqueue, self }) => {
      if (!context.currentFlowId || !context.runPagination.hasMore || underWay(self.getSnapshot(), FLOW_EVENTS)) return;
      const { limit } = context.runPagination;
      const offset = context.runPagination.offset + limit;
      enqueue.assign({ runPagination: { ...context.runPagination, offset } });
      enqueue.spawnChild('getFlowEvents', { id: FLOW_EVENTS, input: { flowId: context.currentFlowId, offset, limit } });
    }),

    flowEventsDone: enqueueActions(({ context, event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.flowEvents', event);
      enqueue.stopChild(FLOW_EVENTS);
      if (!output.ok) return;
      const page = output.value;
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

    expandNode: enqueueActions(({ event, context, enqueue, self }) => {
      const ev = typeOf('RUNS.EXPAND_NODE', event);
      const newExpanded = new Set(context.expandedNodes);

      if (newExpanded.has(ev.nodeId)) {
        newExpanded.delete(ev.nodeId);
      } else {
        newExpanded.add(ev.nodeId);
        // Its details are asked for unless they are held or already being read
        const ask = `${NODE_DETAILS}.${ev.nodeId}` as const;
        if (!context.nodeDetails.has(ev.nodeId) && !underWay(self.getSnapshot(), ask)) {
          enqueue.spawnChild('getNodeDetails', { id: ask, input: { nodeId: ev.nodeId } });
        }
      }

      enqueue.assign({
        expandedNodes: newExpanded,
      });
    }),

    nodeDetailsDone: enqueueActions(({ event, context, enqueue }) => {
      if (!isNodeDetailsDone(event)) return;
      const { output, actorId } = event;
      enqueue.stopChild(actorId);
      if (!output.ok || !output.value.details) return;
      const newDetails = new Map(context.nodeDetails);
      newDetails.set(output.value.nodeId, output.value.details);
      enqueue.assign({ nodeDetails: newDetails });
    }),

    /* ── backup actions ─────────────────────────────────── */
    requestBackupInfo: enqueueActions(({ event, enqueue }) => {
      enqueue.stopChild(BACKUP_INFO);
      enqueue.spawnChild('getBackupInfo', { id: BACKUP_INFO, input: { path: typeOf('BACKUP.READ_INFO', event).path } });
    }),

    backupInfoDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.backupInfo', event);
      enqueue.stopChild(BACKUP_INFO);
      if (output.ok) enqueue.assign({ backupInfo: output.value.info });
    }),

    exportBackup: enqueueActions(({ event, enqueue }) => {
      const { path, name, databases } = typeOf('BACKUP.EXPORT', event);
      enqueue.stopChild(EXPORT);
      enqueue.spawnChild('exportDatabase', { id: EXPORT, input: { path, name, databases } });
    }),

    importBackup: enqueueActions(({ event, enqueue }) => {
      const { path, skipUnknownDatabases } = typeOf('BACKUP.IMPORT', event);
      enqueue.stopChild(IMPORT);
      enqueue.spawnChild('importDatabase', { id: IMPORT, input: { path, skipUnknownDatabases } });
    }),

    exportDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.export', event);
      enqueue.stopChild(EXPORT);
      enqueue.assign({ backupResult: { operation: 'export' as const, error: output.ok ? undefined : output.failure.message } });
    }),

    importDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.import', event);
      enqueue.stopChild(IMPORT);
      // An import that was done replaced the data, which `dropReplacedResults` has answered before this
      if (output.ok) {
        enqueue.assign({ backupResult: { operation: 'import' as const, error: undefined, message: output.value.message } });
        return;
      }
      const { failure } = output;
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
      enqueue.stopChild(RESET);
      enqueue.spawnChild('resetDatabase', { id: RESET, input: {} });
    }),

    resetDone: enqueueActions(({ event, enqueue }) => {
      const { output } = typeOf('xstate.done.actor.reset', event);
      enqueue.stopChild(RESET);
      // A reset that was done replaced the data, which `dropReplacedResults` has answered before this
      if (!output.ok) enqueue.assign({ error: `Reset failed: ${output.failure.message}` });
    }),
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
    // How each ask this window made ended, whichever view it has open by then
    'xstate.done.actor.query': { actions: 'queryDone' },
    'xstate.done.actor.transaction': [
      // A row was deleted: the current query is run again, to show what is left
      { guard: 'deletedRow', actions: ['transactionDone', 'executeQuery'] },
      { actions: 'transactionDone' },
    ],
    'xstate.done.actor.aiQuery': { actions: 'aiQueryAsked' },
    'xstate.done.actor.flowRuns': [
      { guard: 'listedFlowRuns', actions: ['flowRunsDone', 'requestFlowEvents'] },
      { actions: 'flowRunsDone' },
    ],
    'xstate.done.actor.flowEvents': { actions: 'flowEventsDone' },
    'xstate.done.actor.nodeDetails.*': { actions: 'nodeDetailsDone' },
    'xstate.done.actor.backupInfo': { actions: 'backupInfoDone' },
    'xstate.done.actor.export': { actions: 'exportDone' },
    'xstate.done.actor.import': [
      { guard: 'answered', actions: ['dropReplacedResults', 'importDone'] },
      { actions: 'importDone' },
    ],
    'xstate.done.actor.reset': [
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
