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

export type IncomingDatabaseEvents =
  | { type: 'EXECUTE_QUERY'; code: string }
  | { type: 'EXECUTE_TRANSACTION'; code: string }
  | { type: 'GENERATE_AI_QUERY'; prompt: string; mode?: 'query' | 'transaction' }
  /** The schema as the data is now: answered with `SCHEMA_READ` */
  | { type: 'GET_SCHEMA' }
  | { type: 'GET_FLOW_RUNS' }
  | { type: 'GET_FLOW_EVENTS'; flowId: string; offset?: number; limit?: number }
  | { type: 'GET_NODE_DETAILS'; nodeId: string }
  | { type: 'EXPORT_DATABASE'; path: string; name?: string; databases: ('lmdb' | 'runHistory')[] }
  | { type: 'IMPORT_DATABASE'; path: string; skipUnknownDatabases?: boolean }
  | { type: 'GET_BACKUP_INFO'; path: string }
  | { type: 'RESET_DATABASE' };

/**
 * What the database system sends. Every one answers whoever asked, by `reply`, but two: `DATABASE_REPLACED`, which is
 * news for every window, and the generated query, which a flow sends.
 *
 * **The schema is fetched, not a view.** It is a walk over the whole store (`getSchemaStats`), so a view of it would
 * re-run that walk after every commit anyone makes; a window asks for it when it opens, when the user refreshes, and
 * after its own transaction or a replacement.
 */
export type OutgoingDatabaseEvents =
  | { type: 'SCHEMA_READ'; schema: DatabaseSchemaInfo }
  /**
   * The data was replaced — imported or reset — by any window: every window drops the results it shows and the run
   * history it holds, which name rows that may be gone, and asks for the schema again. A notification; the window that
   * asked has its own outcome too.
   */
  | { type: 'DATABASE_REPLACED' }
  /**
   * The four replies to `EXECUTE_QUERY`/`EXECUTE_TRANSACTION`.
   *
   * **None of them names the request, because the envelope does.** `reply` stamps `Message.answering` with
   * the call the request was sent under, and the delivery door puts that on the delivered event under a
   * reserved key — so a requester tells its own answer from someone else's by asking `answersCall`
   * (`@apackdev/sdk/events`), and neither side declares a field for it.
   *
   * **The call is the requester's, which is what makes it identify a request rather than an emit.** The case
   * it exists for is a requester that gave up waiting and asked again: an id stamped when the *answer* is
   * built gives the abandoned request's late answer the newest id, so that answer wins. It has to be unique
   * across windows for the same reason — an answer can reach every one of them.
   */
  | { type: 'QUERY_RESULT'; result: any; executionTime: number }
  | { type: 'QUERY_ERROR'; error: string }
  | { type: 'TRANSACTION_RESULT'; result: any; executionTime: number }
  | { type: 'TRANSACTION_ERROR'; error: string }
  /**
   * The three a flow sends (`db-query`, `db-transaction`), broadcast to every window: a flow run is no delivery, so it
   * has no sender to reply to. They carry a query, never rows.
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
  | { type: 'FLOW_RUNS_RESULT'; flows: RunNode[] }
  /**
   * `offset` is which page these events are, which is what tells two pages of one flow apart — the flow id
   * alone cannot, so a viewer correlating on it places a late page by wherever it has since got to.
   */
  | { type: 'FLOW_EVENTS_RESULT'; flowId: string; events: RunTree[]; hasMore: boolean; offset: number }
  | { type: 'NODE_DETAILS_RESULT'; nodeId: string; details: RunNode | null }
  | { type: 'EXPORT_DATABASE_SUCCESS'; path: string }
  | { type: 'EXPORT_DATABASE_ERROR'; error: string }
  | { type: 'IMPORT_DATABASE_SUCCESS'; message?: string }
  | { type: 'IMPORT_DATABASE_ERROR'; error: string; unknownDatabases?: string[] }
  | { type: 'BACKUP_INFO_RESULT'; info: { timestamp: number; databases: string[]; size: number; hasMedia?: boolean } | null }
  | { type: 'RESET_DATABASE_SUCCESS'; message: string }
  | { type: 'RESET_DATABASE_ERROR'; error: string };
