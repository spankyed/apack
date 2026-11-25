import type { PackContentPreviewItem } from '../framework/preview-types.ts';

export interface ContentItemIdentity { key: string; item: string }

/** A declared reference in compiled content; computed targets remain explicit rather than guessed. */
export type ContentReference = { item: string; path: string } & (
  | { kind: 'static'; target: ContentItemIdentity }
  | { kind: 'dynamic'; target: { key: string } }
);

/** `content.json` in the compiled directory: what each content key holds */
export interface ContentIndex {
  version: 1;
  /** The pack that compiled the content: the content keys it writes name it, so two packs' items never share an entity */
  packId: string;
  entries: ContentIndexEntry[];
}

export interface ContentIndexEntry {
  key: string;
  /** Written into the database (a compile-only entry is read by pack code instead) */
  written: boolean;
  /** Fields that name a record: include sets and previews use the first */
  identity?: string[];
  count: number;
  /** Top-level items, named as include sets name them */
  items: PackContentPreviewItem[];
  /** Known static/computed references. Omitted for compilers without an analyzer; static analysis is not exhaustive. */
  references?: ContentReference[];
}
