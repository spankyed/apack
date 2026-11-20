import type { RunTree, RunNode } from '@apackdev/sdk/steps';

import { EARS } from '#generated/ears.ts';

export interface DatabaseQueryResult {
  nodes: Array<{
    id: EARS.EntityId;
    type: EARS.Entity;
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: EARS.EntityId;
    target: EARS.EntityId;
    type: EARS.RelKind;
    data?: Record<string, unknown>;
  }>;
}

export interface DatabaseSchemaInfo {
  entities: Array<{
    type: EARS.Entity;
  }>;
  attributes: Array<{
    kind: string;
  }>;
  relations: Array<{
    kind: EARS.RelKind;
  }>;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type DatabaseSettings = import('#generated/settings.ts').SettingsOf<'database'>;

/** What a query or a transaction answers with: its result, and how long it took */
type Ran = { result: any; executionTime: number }

/**
 * What a window asks the database feature, each answered once. A query or a transaction is answered with its result
 * or refused as \`failed\` with why it could not run; the run history's reads answer with an empty page where they
 * cannot be read, as the viewer shows nothing either way.
 */
export type DatabaseAsks = {
  EXECUTE_QUERY: { ask: { code: string }; answer: Ran }
  EXECUTE_TRANSACTION: { ask: { code: string }; answer: Ran }
  GET_FLOW_RUNS: { answer: { flows: RunNode[] } }
  /** A page of a flow run's events: \`offset\` is which page, which tells two pages of one flow apart */
  GET_FLOW_EVENTS: { ask: { flowId: string; offset?: number; limit?: number }; answer: { flowId: string; events: RunTree[]; hasMore: boolean; offset: number } }
  GET_NODE_DETAILS: { ask: { nodeId: string }; answer: { nodeId: string; details: RunNode | null } }
  GET_BACKUP_INFO: { ask: { path: string }; answer: { info: { timestamp: number; databases: string[]; size: number; hasMedia?: boolean } | null } }
}

/**
 * What a window sends the database feature and is answered for by an outcome every window should know of when nobody
 * asked, or by a flow: generating a query, and replacing or exporting the data.
 */
export type IncomingDatabaseEvents =
  | { type: 'GENERATE_AI_QUERY'; prompt: string; mode?: 'query' | 'transaction' }
  | { type: 'EXPORT_DATABASE'; path: string; name?: string; databases: ('lmdb' | 'runHistory')[] }
  | { type: 'IMPORT_DATABASE'; path: string; skipUnknownDatabases?: boolean }
  | { type: 'RESET_DATABASE' };

/**
 * What the database system sends beside its answers: the outcomes of replacing and exporting the data, which reach
 * every window when nobody asked; `DATABASE_REPLACED`, which is news for every window; and the generated query, which a
 * flow sends to the asking window by its connection.
 */
export type OutgoingDatabaseEvents =
  /**
   * The data was replaced — imported or reset — by any window: every window drops the results it shows and the run
   * history it holds, which name rows that may be gone. A notification; the window that
   * asked has its own outcome too.
   */
  | { type: 'DATABASE_REPLACED' }
  /**
   * The three a flow sends (`db-query`, `db-transaction`) to the window that asked: a flow run is no delivery, so it
   * has no sender to reply to, and the ask carries the window's connection for the action to answer instead.
   */
  | { type: 'AI_QUERY_LOADING' }
  | { type: 'AI_QUERY_GENERATED'; query: string }
  /**
   * Generating a query from a prompt failed, which is not a query failing.
   *
   * **Its own event because it answers nothing.** It is broadcast, not replied, so it carries no call — and
   * the guard on `QUERY_ERROR` takes only an answer whose call is the one outstanding. Sent as a
   * `QUERY_ERROR` it would be dropped by that guard every time and the surface's loading flag would never
   * clear, which is the failure this split prevents. An answer and an announcement are different things,
   * and one event cannot be both.
   */
  | { type: 'AI_QUERY_ERROR'; error: string }
  | { type: 'EXPORT_DATABASE_SUCCESS'; path: string }
  | { type: 'EXPORT_DATABASE_ERROR'; error: string }
  | { type: 'IMPORT_DATABASE_SUCCESS'; message?: string }
  | { type: 'IMPORT_DATABASE_ERROR'; error: string; unknownDatabases?: string[] }
  | { type: 'RESET_DATABASE_SUCCESS'; message: string }
  | { type: 'RESET_DATABASE_ERROR'; error: string };
