// The database surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
import type { MakingOf, SurfaceInbox } from '@apackdev/sdk/fe'
import type { RunTree, RunNode } from '@apackdev/sdk/steps'
import type { DatabaseSettings } from '#generated/types.ts'
import type { DatabaseSchemaInfo } from '../be/types.ts'

export interface DatabaseContext {
  /**
   * Which of the asks this window makes are under way, by the name the machine makes each under. A node's details
   * are asked for per node, so those are the ids of the nodes being read
   */
  making: MakingOf<{
    query: 'one'; transaction: 'one'; aiQuery: 'one'; flowRuns: 'one'; flowEvents: 'one'; backupInfo: 'one';
    export: 'one'; import: 'one'; reset: 'one'; nodeDetails: 'each';
  }>;
  schema: DatabaseSchemaInfo;
  currentQuery: string;
  queryResult: any;
  error: string | null;
  executionTime: number | null;
  selectedSchemaItem: {
    type: 'entity' | 'attribute' | 'relation';
    value: string;
  } | null;
  mode: 'query' | 'transaction';
  isAiQueryLoading: boolean;
  settings: DatabaseSettings | null;
  // Run history viewer fields
  viewMode: 'database' | 'runs';
  flowRuns: RunNode[];
  currentFlowId: string | null;
  flowEvents: RunTree[];
  expandedNodes: Set<string>;
  nodeDetails: Map<string, RunNode>;
  runPagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  // Backup fields
  backupInfo: { timestamp: number; databases: string[]; size: number; hasMedia?: boolean } | null;
  /** The last export or import to finish, a new object each time */
  backupResult: {
    operation: 'export' | 'import';
    error?: string;
    message?: string;
    /** The backup holds these stores, which this apack doesn't have: importing it leaves them out */
    unknownDatabases?: string[];
  } | null;
}

/**
 * The page the Database settings open. Spelled out rather than extracted from the machine's union: the contract is
 * read from this module alone, and an `Extract<>` over `./state` would pull the machine back in. The extracted form
 * also named `VIEW_DASHBOARD`, which that union never had, so it silently declared one event where it meant two.
 */
export type DatabaseInboxEvent = { type: 'VIEW_BACKUP' }

export type Contract = {
  state: DatabaseContext
  inbox: SurfaceInbox<{ pack: DatabaseInboxEvent }>
}
