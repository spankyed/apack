import { EARS } from '../types/entities.ts';
import type { ContentItem } from './item-types.ts';
import { _boundBackendHost } from '../runtime/backend-port.ts';
import { collectionContentWriter, documentContentWriter } from './document-writers.ts';

/** Where a record sits: its parent row (for tree children) and its position among its siblings */
export interface ContentWriteContext {
  parentId?: EARS.EntityId;
  index: number;
  /**
   * On update, the fields the entity's previous apply set that the record no longer sets: `update` resets
   * them (to what `create` gives a record that doesn't set them). Empty for `find` and `create`.
   */
  clearedFields: string[];
}

/** An existing row a record matches */
export interface ContentMatch {
  id: EARS.EntityId;
  contentHash?: unknown;
}

/**
 * How entities of one type are found, created, updated and removed when content is applied. The pack that
 * owns the entity type declares them (apack.json `content.writers`), so any pack writing that type goes
 * through its repository. Without hooks, the generic applier writes rows directly.
 */
export interface ContentWriter<R extends ContentItem = ContentItem> {
  /**
   * The entity holds other records rather than being one of them (a folder), so a row another pack
   * wrote is reused as a parent: the item's children are written under it and the entity itself is
   * left as its own pack wrote it. Without this an entity another pack's content claimed is never matched,
   * and the item writes a second entity beside it.
   */
  container?: boolean;
  /** Replaces the entry's `identity` matching */
  find?(record: R, context: ContentWriteContext): ContentMatch | undefined;
  create?(record: R, context: ContentWriteContext): EARS.EntityId;
  update?(id: EARS.EntityId, record: R, context: ContentWriteContext): void;
  remove?(id: EARS.EntityId): void;
}

/** The content writers the registered packs declare, by entity type */
export interface ContentWriterRegistry {
  get(entity: string): ContentWriter | undefined;
}

/**
 * The SDK's writers for the SDK's own entities, which no pack may declare.
 *
 * A pack declares writers only for entity types it owns (the declaration schema refuses the rest), so an
 * entity the SDK owns has no pack to speak for it — and `Document` and `Collection` need one, because the
 * tree mechanics a generic write skips are what make a written document match one created in the app.
 * Named here rather than registered anywhere: they are not a contribution, they are how these entities
 * are written, so there is no order in which they can be missing.
 */
const sdkContentWriters: Record<string, ContentWriter> = {
  [EARS.Entity.Document]: documentContentWriter as ContentWriter,
  [EARS.Entity.Collection]: collectionContentWriter as ContentWriter,
};

/**
 * @internal Appliers read the hooks of the bound app's registered packs (a pack's registration's
 * `contentWriters`), and the SDK's own for the entities it owns. A pack's comes first, so a pack
 * declaring an entity the SDK owns is reported by the schema rather than silently losing its writer.
 */
export const _contentWriterRegistry: ContentWriterRegistry = {
  get: (entity) => _boundBackendHost().packs.contentWriters(entity) ?? sdkContentWriters[entity],
};
