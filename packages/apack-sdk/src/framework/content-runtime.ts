import type { RelationRules, RowRules } from '@apackdev/ears';
import type { ContentWriter } from '../content/writers.ts';

/** Generated content bindings used without activating a pack's systems or services. */
export interface ContentRuntime {
  id: string;
  /** Identity of the manifest that generated this source or bundled runtime. */
  declarationRevision: string;
  entities: Record<string, string>;
  relKinds: Record<string, string>;
  roles: Record<string, string>;
  /** What each of the pack's shaped entities' created rows is held to, read off its shape; none when absent */
  rowRules?: Record<string, RowRules>;
  /** What each of the pack's relation kinds that declares a rule holds its edges to; none when absent */
  relationRules?: Record<string, RelationRules>;
  repositories: Record<string, unknown>;
  contentWriters: Record<string, ContentWriter>;
}
