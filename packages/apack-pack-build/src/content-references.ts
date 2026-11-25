import type { ContentIndex, ContentItemIdentity } from '@apackdev/pack-format';

export type { ContentItemIdentity, ContentReference } from '@apackdev/pack-format';

export interface ContentReferenceInspection {
  source: ContentItemIdentity;
  path: string;
  target: { key: string; item?: string };
  status: 'indexed' | 'not-indexed' | 'dynamic';
}

/** Resolve against compiled inventory only; this says nothing about user rows or applier-created records. */
export function inspectContentReferences(index: ContentIndex): ContentReferenceInspection[] {
  const items = new Map(index.entries.map(entry => [entry.key, new Set(entry.items.map(item => item.key))]));
  return index.entries.flatMap(entry => (entry.references ?? []).map(reference => ({
    source: { key: entry.key, item: reference.item }, path: reference.path, target: reference.target,
    status: reference.kind === 'dynamic' ? 'dynamic' as const
      : items.get(reference.target.key)?.has(reference.target.item) ? 'indexed' as const : 'not-indexed' as const,
  })));
}

/** Known incoming references for rename/removal review; dynamic targets cannot be ruled out. */
export function findContentDependents(index: ContentIndex, target: ContentItemIdentity): ContentReferenceInspection[] {
  return inspectContentReferences(index).filter(reference => reference.status !== 'dynamic'
    && reference.target.key === target.key && reference.target.item === target.item);
}
