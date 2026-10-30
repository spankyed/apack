// Backend-neutral requests. These describe EARS work, not a persistence representation or binary codec.

export type QueryScope = 'live' | 'withTrashed' | 'trashed';
export type QueryStart = { from: 'types'; types: string[] } | { from: 'ids'; ids: string[] } | { from: 'all' };
export type { SearchOptions } from './runtime.ts';
import type { EdgeDirection, SearchOptions } from './runtime.ts';
export type QueryStep =
  | { step: 'ofType'; type: string }
  | { step: 'within'; ids: string[] }
  | { step: 'where'; field: string; value: unknown }
  | { step: 'has' | 'lacks'; field: string }
  | { step: 'withRole'; role: string }
  | { step: 'linkedWith'; other: string }
  | { step: 'linkedTo' | 'linkedFrom' | 'unlinkedTo' | 'unlinkedFrom'; kind: string; other?: string }
  | { step: 'out' | 'in' | 'both' | 'descendants' | 'ancestors'; kinds: string[]; types?: string[]; depth?: number }
  | { step: 'pathTo'; to: string; kinds: string[]; direction?: EdgeDirection; depth?: number }
  | { step: 'orderBy'; field: string; descending?: boolean }
  | { step: 'reverse' }
  | { step: 'limit'; n: number }
  | { step: 'distinct'; field?: string }
  | { step: 'after'; id: string }
  | { step: 'near'; vector: number[]; index?: string; k?: number }
  | { step: 'like'; id: string; index?: string; k?: number }
  | { step: 'hybrid'; query: string; vector: number[]; textIndex?: string; vectorIndex?: string; k?: number; options?: SearchOptions }
  | { step: 'search'; query: string; index?: string; options?: SearchOptions }
  | { step: 'containing'; text: string; caseInsensitive?: boolean }
  | { step: 'matching'; pattern: string };
export type QueryTerminal =
  | { answer: 'ids' | 'count' | 'first' | 'last' | 'exists' }
  | { answer: 'rows' | 'firstRow'; fields?: string[] }
  | { answer: 'degrees'; kinds: string[]; direction?: EdgeDirection; types?: string[] }
  | { answer: 'edges'; kinds: string[]; outward: boolean; types?: string[] }
  | { answer: 'groupBy'; field: string; counts?: boolean }
  | { answer: 'hits'; fields?: string[]; highlights?: boolean };
export interface QueryPlan {
  scope?: QueryScope;
  start: QueryStart;
  steps?: QueryStep[];
  terminal: QueryTerminal;
}
export type ReadOp =
  | { read: 'query'; plan: QueryPlan; visits?: boolean; explain?: boolean }
  | { read: 'row'; id: string }
  | { read: 'relation'; id: string }
  | { read: 'field'; id: string; field: string }
  | { read: 'findRelations'; kind?: string; source?: string; target?: string }
  | { read: 'wouldCreateCycle'; source: string; target: string; kinds: string[] }
  | { read: 'suggest'; type: string; index?: string; term: string; limit?: number }
  | { read: 'pendingEmbeddings'; type: string; index?: string; limit?: number }
  | { read: 'findLabels'; query: string; fields: Record<string, string>; limit?: number; scope?: QueryScope };

/** Attribute mutations become complete operations when the write builder attaches the entity and touch policy. */
export type AttributeMutation =
  | { op: 'set'; fields: Record<string, unknown> }
  | { op: 'append' | 'merge' | 'removeValue'; field: string; value: unknown }
  | { op: 'delete'; field: string }
  | { op: 'removeAt'; field: string; index: number };
export type Op =
  | (AttributeMutation & { id: string; touch?: boolean })
  | { op: 'create'; type: string; id?: string; fields?: Record<string, unknown>; shortCode?: string; createdAt?: number; updatedAt?: number }
  | { op: 'upsert'; type: string; id: string; fields?: Record<string, unknown>; shortCode?: string }
  | { op: 'trash'; id: string; at?: number }
  | { op: 'restore' | 'destroy'; id: string }
  | { op: 'grant' | 'revoke'; id: string; role: string }
  | { op: 'grantExclusive'; id: string; role: string; among: string[] }
  | { op: 'link'; source: string; kind: string; target: string; info?: unknown }
  | { op: 'unlink'; source: string; kind?: string; target?: string }
  | { op: 'updateRelation'; relation: string; source?: string; target?: string; info?: unknown }
  | { op: 'removeRelation'; relation: string }
  | { op: 'takeLabel'; type: string; base: string }
  | { op: 'embed'; id: string; index?: string; chunk: number; hash: string; model: string; vector: number[] };

/** Deliberate unchecked repair/import operations remain separate from ordinary validated writes. */
export type Load =
  | { load: 'entity'; id: string; fields: Record<string, unknown>; trashed?: boolean }
  | { load: 'relation'; id: string; kind: string; source: string; target: string; info?: unknown }
  | { load: 'sequence'; name: string; next: number }
  | { load: 'embedding'; id: string; index: string; chunk: number; model: string; hash: string; vector: number[] }
  | { load: 'unset'; id: string; field: string };

export interface StoredRelation {
  id: string;
  kind: string;
  source: string;
  target: string;
  info?: unknown;
}
export interface StoredHit {
  id: string;
  score: number;
  terms: string[];
  highlights?: import('./runtime.ts').SearchHighlights;
  row?: Record<string, unknown>;
}
interface QueryAnswers {
  ids: { kind: 'ids'; ids: string[] };
  count: { kind: 'count'; n: number };
  first: { kind: 'id'; id: string | null };
  last: { kind: 'id'; id: string | null };
  exists: { kind: 'bool'; value: boolean };
  rows: { kind: 'rows'; rows: Record<string, unknown>[]; plainObjects?: boolean };
  firstRow: { kind: 'row'; row: Record<string, unknown> | null; plainObjects?: boolean };
  edges: { kind: 'relations'; relations: StoredRelation[] };
  degrees: { kind: 'degrees'; degrees: Array<[string, number]> };
  groupBy: { kind: 'groups'; groups: Array<[unknown, string[] | number]>; plainObjects?: boolean };
  hits: { kind: 'hits'; hits: StoredHit[]; plainObjects?: boolean };
}
export type QueryAnswerFor<T extends QueryTerminal> = QueryAnswers[T['answer']];
export type QueryAnswer = QueryAnswers[keyof QueryAnswers] & { __visited?: number };
export type ExplainedAnswer = { kind: 'explained'; answer: QueryAnswer; ms: number } & (
  { backend: 'sqlite'; statementCount: number; statements: import('./runtime.ts').SqliteStatement[] }
  | { backend: 'elmdb'; visited: number; stages: import('./runtime.ts').QueryStage[] }
);
export type Answer = QueryAnswer
  | { kind: 'field'; present: boolean; value: unknown }
  | { kind: 'relation'; relation: StoredRelation | null }
  | { kind: 'pending'; index: string; model: string; dims: number; count: number; chunks: Array<{ id: string; chunk: number; hash: string; text: string }> }
  | { kind: 'suggestions'; completions: string[]; corrections: string[] }
  | { kind: 'labels'; hits: Array<{ id: string; score: number; positions: number[] }> }
  | { kind: 'visited'; answer: QueryAnswer; visited: number }
  | ExplainedAnswer;
export type ReadAnswer<R extends ReadOp> =
  R extends { read: 'query' } ? R extends { explain: true } ? ExplainedAnswer
    : R extends { visits: true } ? Extract<Answer, { kind: 'visited' }> : QueryAnswer
  : R extends { read: 'row' } ? QueryAnswers['firstRow']
  : R extends { read: 'field' } ? Extract<Answer, { kind: 'field' }>
  : R extends { read: 'relation' } ? Extract<Answer, { kind: 'relation' }>
  : R extends { read: 'findRelations' } ? QueryAnswers['edges']
  : R extends { read: 'wouldCreateCycle' } ? QueryAnswers['exists']
  : R extends { read: 'pendingEmbeddings' } ? Extract<Answer, { kind: 'pending' }>
  : R extends { read: 'suggest' } ? Extract<Answer, { kind: 'suggestions' }>
  : Extract<Answer, { kind: 'labels' }>;
