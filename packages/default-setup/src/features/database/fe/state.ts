import type { Value } from '@apackdev/state';
import type { SurfaceChrome, SurfaceLifecycleEvent, TrailClickEvent } from '@apackdev/sdk/fe';
import type { RunNode } from '@apackdev/sdk/steps';
import { HardDriveDownload, History } from 'lucide-vue-next';
import { state, type PackNet } from '#generated/state.ts';
import type { DatabaseSettings } from '#generated/types.ts';
import type { OutgoingDatabaseEvents } from '#features/database/be/types.ts';
import type { DatabaseContext, DatabaseInboxEvent } from './contract.ts';
import { attributeQueryTemplate, entityQueryTemplate, exampleQuery, relationQueryTemplate } from './constants.ts';

export const id = 'database' as const;

type DatabaseAsks = PackNet['systems']['database']['asks'];

/** The asks whose answers name rows: given up when the data is replaced */
const ROW_ASKS = ['query', 'transaction', 'flowRuns', 'flowEvents'] as const;

/** Database replacement invalidates row results and outstanding requests, not the query editor or preferences. */
function emptyDatabaseResults() {
  return {
    queryResult: null,
    error: null,
    executionTime: null,
    selectedSchemaItem: null,
    isAiQueryLoading: false,
    flowRuns: [],
    currentFlowId: null,
    flowEvents: [],
    expandedNodes: new Set<string>(),
    nodeDetails: new Map<string, RunNode>(),
    runPagination: { offset: 0, limit: 50, hasMore: false },
  };
}

/**
 * `OutgoingDatabaseEvents` and nothing of its own: a union of a member with its own copy narrows to *both*, so a
 * field added to the canonical declaration would read as optional here with no type error anywhere.
 */
type SystemEvent = OutgoingDatabaseEvents | { type: 'FEATURE_SETTINGS_UPDATED'; settings: DatabaseSettings };

type UIEvent =
  | Extract<SurfaceLifecycleEvent, { type: 'SURFACE_STARTED' }>
  | { type: 'QUERY.EXECUTE'; code: string }
  | { type: 'TRANSACTION.EXECUTE'; code: string }
  | { type: 'SCHEMA.SELECT'; itemType: 'entity' | 'attribute' | 'relation'; value: string }
  | { type: 'QUERY.UPDATE'; code: string }
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
  | TrailClickEvent;

export type DatabaseEvents = UIEvent | SystemEvent;

type DatabaseData = DatabaseContext & {
  /** Incremented on `SURFACE_STARTED` so the schema view is followed (and re-followed on restart) */
  schemaFollowSeq: number;
};

type DatabaseShape = {
  data: DatabaseData;
  calls: {
    query: { readonly one: DatabaseAsks['EXECUTE_QUERY']['args'] };
    transaction: { readonly one: DatabaseAsks['EXECUTE_TRANSACTION']['args'] };
    aiQuery: { readonly one: DatabaseAsks['GENERATE_AI_QUERY']['args'] };
    flowRuns: 'one';
    flowEvents: { readonly one: DatabaseAsks['GET_FLOW_EVENTS']['args'] };
    backupInfo: { readonly one: DatabaseAsks['GET_BACKUP_INFO']['args'] };
    export: { readonly one: DatabaseAsks['EXPORT_DATABASE']['args'] };
    import: { readonly one: DatabaseAsks['IMPORT_DATABASE']['args'] };
    reset: 'one';
    /** A node's details are asked for per node, several at once: by the node's id */
    nodeDetails: 'each';
  };
  states: {
    explorer: {};
    backup: {};
  };
};

export type DatabasePending = Value<DatabaseShape>['pending'];

/** Whether a query or a transaction is running */
export const isRunningCode = (pending: Pick<DatabasePending, 'query' | 'transaction'>): boolean =>
  pending.query || pending.transaction;
/** Whether the run history is being read: the flow runs, or a page of one's events */
export const isLoadingRuns = (pending: Pick<DatabasePending, 'flowRuns' | 'flowEvents'>): boolean =>
  pending.flowRuns || pending.flowEvents;

const generateQueryForSchemaItem = (type: 'entity' | 'attribute' | 'relation', value: string): string => {
  switch (type) {
    case 'entity':
      return entityQueryTemplate(value);
    case 'attribute':
      return attributeQueryTemplate(value);
    case 'relation':
      return relationQueryTemplate(value);
  }
};

export const databaseChrome: SurfaceChrome<Value<DatabaseShape>> = {
  default: { label: 'Database Explorer', target: 'explorer' },
  menu: [
    { label: 'View Run History', icon: History, event: { type: 'VIEW_MODE.TOGGLE' }, iconColor: 'text-purple-400' },
    { separator: true, label: 'Backup & Restore', icon: HardDriveDownload, event: { type: 'VIEW_BACKUP' }, iconColor: 'text-green-400' },
  ],
  states: {
    explorer: {
      breadcrumb: { label: 'Database Explorer', target: 'explorer' },
    },
    backup: {
      breadcrumb: { label: 'Backup & Restore', target: 'backup' },
    },
  },
};

const databaseState = state<DatabaseShape, DatabaseEvents>()({
  initial: 'explorer',
  data: {
    ...emptyDatabaseResults(),
    schemaFollowSeq: 0,
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
  },
  // Give each started window instance its own Set and Map rather than sharing the initial empty instances
  run: () => ({
    data: {
      expandedNodes: new Set<string>(),
      nodeDetails: new Map<string, RunNode>(),
    },
  }),
  follows: (follow) => ({
    // The schema, followed from the shell's start, in a delivery naming the surface
    schemaView: follow('database', 'schema', {
      from: ['schemaFollowSeq'],
      args: ({ schemaFollowSeq }) => (schemaFollowSeq > 0 ? {} : null),
      updated: (update) =>
        update.ok
          ? { data: { schema: update.value } }
          : { data: { error: update.failure.message } },
    }),
  }),
  calls: ({ one, each }) => ({
    query: one('database', 'EXECUTE_QUERY', {
      done: (outcome) =>
        outcome.ok
          ? { data: { queryResult: outcome.value.result, executionTime: outcome.value.executionTime, error: null } }
          : { data: { error: outcome.failure.message } },
    }),
    transaction: one('database', 'EXECUTE_TRANSACTION', {
      done: (outcome, { data, call, cancel }) => {
        if (!outcome.ok) return { data: { error: outcome.failure.message } };
        // A row was deleted: the current query is run again, to show what is left
        if (Boolean(outcome.value.result?.deleted) && Boolean(data.currentQuery)) {
          cancel('query');
          call('query', { code: data.currentQuery });
        }
        return {
          data: {
            queryResult: outcome.value.result,
            executionTime: outcome.value.executionTime,
            error: null,
          },
        };
      },
    }),
    aiQuery: one('database', 'GENERATE_AI_QUERY', {
      // Generating a query was refused as it was asked: said where a query's error is
      done: (outcome) => (outcome.ok ? undefined : { data: { error: outcome.failure.message, isAiQueryLoading: false } }),
    }),
    flowRuns: one('database', 'GET_FLOW_RUNS', {
      done: (outcome, { data, call, cancel }) => {
        if (!outcome.ok) return;
        // Newest first, as the run history lists them
        const { flows } = outcome.value;
        if (flows.length > 0) {
          // The first flow is selected, for its first page to be read
          const currentFlowId = flows[0].id;
          const runPagination = { ...data.runPagination, offset: 0 };
          cancel('flowEvents');
          call('flowEvents', { flowId: currentFlowId, offset: 0, limit: runPagination.limit });
          return { data: { flowRuns: flows, currentFlowId, runPagination } };
        }
        return { data: { flowRuns: flows } };
      },
    }),
    flowEvents: one('database', 'GET_FLOW_EVENTS', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return;
        const page = outcome.value;
        return {
          data: {
            // The page is placed by the offset it is for: the first replaces the list, a later one adds to it.
            // A later page of a live run repeats what an event arriving since shifted onto it: pages are newest first
            // by offset, so a new event moves every one down. Only the ones not listed yet are added
            flowEvents: page.offset > 0
              ? [...data.flowEvents, ...page.events.filter((heard) => !data.flowEvents.some((listed) => listed.id === heard.id))]
              : page.events,
            runPagination: { ...data.runPagination, hasMore: page.hasMore },
          },
        };
      },
    }),
    nodeDetails: each('database', 'GET_NODE_DETAILS', {
      args: (nodeId) => ({ nodeId }),
      done: (outcome, { data }) => {
        if (!outcome.ok || !outcome.value.details) return;
        const newDetails = new Map(data.nodeDetails);
        newDetails.set(outcome.value.nodeId, outcome.value.details);
        return { data: { nodeDetails: newDetails } };
      },
    }),
    backupInfo: one('database', 'GET_BACKUP_INFO', {
      done: (outcome) => (outcome.ok ? { data: { backupInfo: outcome.value.info } } : undefined),
    }),
    export: one('database', 'EXPORT_DATABASE', {
      done: (outcome) => ({
        data: { backupResult: { operation: 'export' as const, error: outcome.ok ? undefined : outcome.failure.message } },
      }),
    }),
    import: one('database', 'IMPORT_DATABASE', {
      done: (outcome, { cancel }) => {
        if (outcome.ok) {
          for (const ask of ROW_ASKS) cancel(ask);
          return {
            data: {
              ...emptyDatabaseResults(),
              backupResult: { operation: 'import' as const, error: undefined, message: outcome.value.message },
            },
          };
        }
        const { failure } = outcome;
        return {
          data: {
            backupResult: {
              operation: 'import' as const,
              error: failure.message,
              ...(failure.kind === 'unknown-databases' ? { unknownDatabases: failure.unknownDatabases } : {}),
            },
          },
        };
      },
    }),
    reset: one('database', 'RESET_DATABASE', {
      done: (outcome, { cancel }) => {
        if (outcome.ok) {
          for (const ask of ROW_ASKS) cancel(ask);
          return { data: emptyDatabaseResults() };
        }
        return { data: { error: `Reset failed: ${outcome.failure.message}` } };
      },
    }),
  }),
  on: {
    TRAIL_CLICK: (event) => {
      if (event.target === 'explorer') return { at: 'explorer' };
    },
    // Where a surface asks for what it starts from: the shell hands it this in a delivery naming the surface
    SURFACE_STARTED: (_event, { data }) => ({ data: { schemaFollowSeq: data.schemaFollowSeq + 1 } }),
    // Any window replaced the data: what this one shows names rows that may be gone, and so would what it asked for
    DATABASE_REPLACED: (_event, { cancel }) => {
      for (const ask of ROW_ASKS) cancel(ask);
      return { data: emptyDatabaseResults() };
    },
    AI_QUERY_ERROR: (event) => ({ data: { error: event.error, isAiQueryLoading: false } }),
    AI_QUERY_LOADING: () => ({ data: { isAiQueryLoading: true } }),
    AI_QUERY_GENERATED: (event) => ({ data: { currentQuery: event.query, isAiQueryLoading: false } }),
    FEATURE_SETTINGS_UPDATED: (event) => ({ data: { settings: event.settings } }),
    // Reset database events. The request comes from the surface's settings, whatever view the surface is in
    'DATABASE.RESET': (_event, { call, cancel }) => {
      cancel('reset');
      call('reset');
    },
  },
  states: {
    explorer: {
      on: {
        'QUERY.EXECUTE': (event, { call, cancel }) => {
          cancel('query');
          call('query', { code: event.code });
          return { data: { error: null } };
        },
        'TRANSACTION.EXECUTE': (event, { call, cancel }) => {
          cancel('transaction');
          call('transaction', { code: event.code });
          return { data: { error: null } };
        },
        'ENTITY.DELETE': (event, { call, cancel }) => {
          const code = `write('${event.entityId}').destroy(); return { deleted: '${event.entityId}' };`;
          cancel('transaction');
          call('transaction', { code });
          return { data: { error: null } };
        },
        'QUERY.UPDATE': (event) => ({ data: { currentQuery: event.code } }),
        'MODE.TOGGLE': (_event, { data }) => ({
          data: { mode: data.mode === 'query' ? 'transaction' as const : 'query' as const },
        }),
        'SCHEMA.SELECT': (event) => ({
          data: {
            selectedSchemaItem: { type: event.itemType, value: event.value },
            currentQuery: generateQueryForSchemaItem(event.itemType, event.value),
          },
        }),
        'AI_QUERY.GENERATE': (event, { call, cancel }) => {
          if (!event.prompt?.trim()) {
            console.error('Invalid prompt provided for AI query generation');
            return;
          }
          cancel('aiQuery');
          call('aiQuery', { prompt: event.prompt.trim(), mode: event.mode });
        },
        'VIEW_MODE.TOGGLE': (_event, { data, call, cancel }) => {
          cancel('flowRuns');
          call('flowRuns');
          return { data: { viewMode: data.viewMode === 'database' ? 'runs' as const : 'database' as const } };
        },
        'RUNS.SELECT_FLOW': (event, { call, cancel }) => {
          cancel('flowEvents');
          if (event.flowId) {
            call('flowEvents', { flowId: event.flowId, offset: 0, limit: 50 });
          }
          return {
            data: {
              currentFlowId: event.flowId,
              flowEvents: [],
              runPagination: { offset: 0, limit: 50, hasMore: false },
            },
          };
        },
        'RUNS.EXPAND_NODE': (event, { data, snapshot, call }) => {
          const newExpanded = new Set(data.expandedNodes);
          if (newExpanded.has(event.nodeId)) {
            newExpanded.delete(event.nodeId);
          } else {
            newExpanded.add(event.nodeId);
            // Its details are asked for unless they are held or already being read
            if (!data.nodeDetails.has(event.nodeId) && !(event.nodeId in snapshot.pending.nodeDetails)) {
              call('nodeDetails', event.nodeId);
            }
          }
          return { data: { expandedNodes: newExpanded } };
        },
        // One page at a time: a page asked for while another is coming would move the offset the list is built from
        'RUNS.LOAD_MORE': (_event, { data, snapshot, call }) => {
          if (!data.currentFlowId || !data.runPagination.hasMore || snapshot.pending.flowEvents) return;
          const { limit } = data.runPagination;
          const offset = data.runPagination.offset + limit;
          call('flowEvents', { flowId: data.currentFlowId, offset, limit });
          return { data: { runPagination: { ...data.runPagination, offset } } };
        },
        'RUNS.REQUEST_FLOWS': (_event, { call, cancel }) => {
          cancel('flowRuns');
          call('flowRuns');
        },
        VIEW_BACKUP: () => ({ at: 'backup' }),
      },
    },
    backup: {
      on: {
        BACK_TO_EXPLORER: () => ({ at: 'explorer' }),
        'BACKUP.EXPORT': (event, { call, cancel }) => {
          cancel('export');
          call('export', { path: event.path, name: event.name, databases: event.databases });
        },
        'BACKUP.IMPORT': (event, { call, cancel }) => {
          cancel('import');
          call('import', { path: event.path, skipUnknownDatabases: event.skipUnknownDatabases });
        },
        'BACKUP.READ_INFO': (event, { call, cancel }) => {
          cancel('backupInfo');
          call('backupInfo', { path: event.path });
        },
      },
    },
  },
});

export default databaseState;
