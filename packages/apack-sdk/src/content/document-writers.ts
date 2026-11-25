// How documents and folders are written when content is applied, for any pack whose content declares
// them: through the SDK's repositories, so a written document gets the shortCode and display order one
// created in the app does, and a folder nests with `parent_of` while holding documents with `contains`.
//
// The entity types are the SDK's, so these are too, and nobody registers them: a pack declares writers
// only for entities it owns, so these have no pack to be contributed by. `sdkContentWriters` in
// `writers.ts` names them, which is also why this module imports only the *type* from there.
import { untypedQuery as query } from '../ears/index.ts';
import { collectionRepository, documentRepository } from '../repositories/document-repository.ts';
import { EARS } from '../types/entities.ts';
import type { ContentSection } from '../types/sdk-entities.ts';
import type { ContentItem } from './item-types.ts';
import type { ContentWriter } from './writers.ts';

export interface DocumentItem extends ContentItem {
  name: string;
  content: ContentSection[];
  tags?: string[];
  /** What the document is: `commands` marks a slash-command list */
  documentType?: string;
}

export interface CollectionItem extends ContentItem {
  name: string;
  description?: string;
}

/** The folder a row sits in, or undefined at the root */
function folderOf(id: EARS.EntityId, relKind: EARS.RelKind): EARS.EntityId | undefined {
  return query.ids(id).in(relKind, EARS.Entity.Collection).ids()[0];
}

/**
 * The row a record names in its folder. A name is unique among its siblings rather than across the
 * tree, so a folder or document of that name elsewhere is a different row.
 */
function namedIn(
  rows: Array<{ id: EARS.EntityId; contentHash?: string }>,
  relKind: EARS.RelKind,
  parentId: EARS.EntityId | undefined,
): { id: EARS.EntityId; contentHash?: string } | undefined {
  const match = rows.find((row) => folderOf(row.id, relKind) === parentId);
  return match && { id: match.id, contentHash: match.contentHash };
}

const named = (entity: EARS.Entity, name: string): Array<{ id: EARS.EntityId; contentHash?: string }> =>
  (query(entity).where('name', name).pick(['contentHash']) as Array<{ id: EARS.EntityId; contentHash?: string }>);

export const documentContentWriter: ContentWriter<DocumentItem> = {
  find(record, { parentId }) {
    return namedIn(named(EARS.Entity.Document, record.name), EARS.RelKind.CONTAINS, parentId);
  },

  create(record, { parentId }) {
    return documentRepository.create({
      name: record.name, content: record.content, tags: record.tags ?? [], parentId,
      documentType: record.documentType, contentHash: record.contentHash as string | undefined,
    }).id as EARS.EntityId;
  },

  update(id, record) {
    documentRepository.update(id, {
      name: record.name, content: record.content, tags: record.tags ?? [],
      documentType: record.documentType, contentHash: record.contentHash as string | undefined,
    });
  },

  remove(id) {
    documentRepository.remove(id);
  },
};

export const collectionContentWriter: ContentWriter<CollectionItem> = {
  // A folder holds other packs' documents too, so one another pack wrote is written into, not copied
  container: true,

  find(record, { parentId }) {
    return namedIn(named(EARS.Entity.Collection, record.name), EARS.RelKind.PARENT_OF, parentId);
  },

  create(record, { parentId }) {
    return collectionRepository.create({
      name: record.name, description: record.description, parentId,
      contentHash: record.contentHash as string | undefined,
    }).id as EARS.EntityId;
  },

  /** A description the record no longer sets is emptied; one it never set is left alone */
  update(id, record, { clearedFields }) {
    collectionRepository.update(id, {
      name: record.name,
      description: record.description ?? (clearedFields.includes('description') ? '' : undefined),
      contentHash: record.contentHash as string | undefined,
    });
  },

  remove(id) {
    collectionRepository.remove(id);
  },
};
