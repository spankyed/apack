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
 * cannot be read, as the viewer shows nothing either way. Replacing or exporting the data answers with what it did,
 * and generating a query with only that it started: the query comes from the flow it starts.
 */
export type DatabaseAsks = {
  EXECUTE_QUERY: { args: { code: string }; answer: Ran }
  EXECUTE_TRANSACTION: { args: { code: string }; answer: Ran }
  GET_FLOW_RUNS: { answer: { flows: RunNode[] } }
  /** A page of a flow run's events: \`offset\` is which page, which tells two pages of one flow apart */
  GET_FLOW_EVENTS: { args: { flowId: string; offset?: number; limit?: number }; answer: { flowId: string; events: RunTree[]; hasMore: boolean; offset: number } }
  GET_NODE_DETAILS: { args: { nodeId: string }; answer: { nodeId: string; details: RunNode | null } }
  GET_BACKUP_INFO: { args: { path: string }; answer: { info: { timestamp: number; databases: string[]; size: number; hasMedia?: boolean } | null } }
  /** Refused for an empty prompt; otherwise the flow that writes the query has started */
  GENERATE_AI_QUERY: { args: { prompt: string; mode?: 'query' | 'transaction' } }
  /** Answered with the backup's path */
  EXPORT_DATABASE: { args: { path: string; name?: string; databases: ('lmdb' | 'runHistory')[] }; answer: { path: string } }
  /**
   * Answered with what to tell the user. A backup holding databases this app cannot is refused as
   * `unknown-databases`, naming them, for the user to decide whether to import it without them
   */
  IMPORT_DATABASE: {
    args: { path: string; skipUnknownDatabases?: boolean }
    answer: { message: string }
    refuses: { 'unknown-databases': { unknownDatabases: string[] } }
  }
  RESET_DATABASE: { answer: { message: string } }
}

/**
 * What the database system sends beside its answers: `DATABASE_REPLACED`, which is news for every window, and the
 * generated query, which a flow sends to the asking window by its connection.
 */
export type OutgoingDatabaseEvents =
  /**
   * The data was replaced — imported or reset — by any window: every window drops the results it shows and the run
   * history it holds, which name rows that may be gone. A notification; the window that asked is answered too.
   */
  | { type: 'DATABASE_REPLACED' }
  /**
   * The three a flow sends (`db-query`, `db-transaction`) to the window that asked: a flow run is no delivery, so it
   * has no sender to reply to, and the ask carries the window's connection for the action to answer instead.
   */
  | { type: 'AI_QUERY_LOADING' }
  | { type: 'AI_QUERY_GENERATED'; query: string }
  /**
   * Generating a query from a prompt failed in the flow, which is not a query failing. Its own event because it
   * answers no ask: the flow sends it long after `GENERATE_AI_QUERY` was answered.
   */
  | { type: 'AI_QUERY_ERROR'; error: string };
