import { create, write, query } from '#generated/ears.ts';
import * as path from 'path'
import { EARS } from '#generated/ears.ts'
import type { DocumentDTO, CollectionDTO, LibraryItem } from '../types.ts'
// [SEARCH_INDEX_FF] import * as searchIndexRepo from '../search-index/repository' (dormant: ../search-index/README.md)
import { libraryQueries } from './queries.ts'
import {
  collectionPath, collectionRepository, displayOrderOf, documentRepository, nextDisplayOrder, parentCollectionOf,
} from '@apackdev/sdk/repositories'
import { formatFileSize, getContentLength } from './helpers.ts'
import { wouldCreateCycle } from '@apackdev/sdk/ears'
import type { ContentSection } from '#features/library/be/types.ts';


type DocumentsListener = () => void;

const documentsListeners = new Set<DocumentsListener>();

/**
 * Every write below tells its subscribers, through `announceWrites`, so no method decides whether its own
 * write mattered and a method added later is covered without anyone remembering. What changed is the
 * subscriber's to work out — `libraryService.commands()` is a derivation over these rows, and the system's
 * watcher compares it, which is the one place that comparison is made.
 *
 * It hands subscribers no payload and makes no send: a repository reads and writes rows. The listener set is
 * module state, held only for as long as a subscriber keeps its handle, which is what the returned function
 * gives back.
 *
 * **Each write keeps `writers` as its receiver**, since several of them do their work by calling a sibling
 * (`deleteItems` deletes each document, `moveItems` moves each one). Dropping the receiver leaves `this`
 * undefined inside those, so the write silently does nothing — `tests/features/library/be/index.spec.ts`'s
 * deleted-document case is what says so. Calling the sibling on the plain object also keeps one announcement
 * per call made from outside, rather than one per item.
 */
function announceWrites<T extends Record<string, (...args: never[]) => unknown>>(writers: T): T {
  const announced: Record<string, unknown> = {};
  for (const [name, write] of Object.entries(writers)) {
    announced[name] = (...args: never[]) => {
      const result = (write as (...a: never[]) => unknown).apply(writers, args);
      for (const listener of documentsListeners) listener();
      return result;
    };
  }
  return announced as T;
}

const writers = {
  createDocument(
    name: string,
    content: ContentSection[],
    tags: string[],
    collectionId?: EARS.EntityId,
    id?: string,
    contentHash?: string,
    /** What the document is: `commands` makes it a slash-command list, as frontmatter does for content */
    documentType?: string,
  ): DocumentDTO {
    const row = documentRepository.create({
      name, content, tags, parentId: collectionId, id, contentHash, documentType,
    })
    return libraryQueries.findDocument(row.id as EARS.EntityId)!
  },

  updateDocument(
    id: EARS.EntityId,
    name: string,
    content: ContentSection[],
    tags: string[],
    collectionId?: EARS.EntityId,
    contentHash?: string,
    /** What the document is: `commands` makes it a slash-command list */
    documentType?: string,
  ): DocumentDTO {
    // `parentId` only when the caller named one: omitted leaves the document in its folder
    documentRepository.update(id, {
      name, content, tags, contentHash, documentType,
      ...(collectionId !== undefined && { parentId: collectionId }),
    })
    return libraryQueries.findDocument(id)!
  },

  deleteDocument(id: EARS.EntityId): void {
    documentRepository.remove(id)
  },

  createCollection(
    name: string,
    description?: string,
    parentId?: EARS.EntityId,
    id?: string,
    contentHash?: string,
  ): CollectionDTO {
    const now = Date.now()
    const displayOrder = nextDisplayOrder(parentId || null)
    const collectionId = create(EARS.Entity.Collection, {
      ...(id && { id: id as EARS.EntityId }),
      createdAt: now,
      name,
      displayOrder,
      ...(contentHash && { contentHash }),
      ...(description && { description }),
    }).id()
    if (parentId) {
      write(parentId).link(EARS.RelKind.PARENT_OF, collectionId)
    }

    const path = collectionPath(collectionId)

    return {
      id: collectionId,
      name,
      description,
      parentId,
      path,
      documentCount: 0,
      childCollections: [],
      displayOrder,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }
  },

  updateCollection(
    id: EARS.EntityId,
    name: string,
    description?: string,
    contentHash?: string,
  ): CollectionDTO {
    const collectionId = id

    const attrs: Record<string, any> = {
      name,
      ...(contentHash && { contentHash }),
    }

    if (description !== undefined) {
      attrs.description = description
    }

    write(collectionId).setMany(attrs)
    const collections = query.ids(collectionId).pickAll()
    const collection = collections[0]
    const documentCount = (query.ids(collectionId)
      .out(EARS.RelKind.CONTAINS, EARS.Entity.Document)
      .pickAll()).length

    const childCollections = query.ids(collectionId)
      .out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection)
      .pick(['name', 'description', 'createdAt', 'updatedAt'])

    const path = collectionPath(collectionId)

    const buildChildren = (children: any[]): CollectionDTO[] =>
      children.map(child => ({
        id: child.id,
        name: child.name as string,
        description: child.description as string | undefined,
        path: collectionPath(child.id as EARS.EntityId),
        documentCount: query.ids(child.id as EARS.EntityId).out(EARS.RelKind.CONTAINS, EARS.Entity.Document).count(),
        childCollections: buildChildren(query.ids(child.id as EARS.EntityId).out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).pick(['name', 'description', 'createdAt', 'updatedAt'])),
        displayOrder: displayOrderOf(child),
        createdAt: new Date(child.createdAt as number).toISOString(),
        updatedAt: new Date(child.updatedAt as number || child.createdAt as number).toISOString(),
      }))

    return {
      id: collectionId,
      name: collection!.name as string,
      description: collection!.description as string | undefined,
      path,
      documentCount,
      childCollections: buildChildren(childCollections),
      displayOrder: displayOrderOf(collection!),
      createdAt: new Date(collection!.createdAt as number).toISOString(),
      updatedAt: new Date(collection!.updatedAt as number || collection!.createdAt as number).toISOString(),
    }
  },

  deleteCollection(id: EARS.EntityId): void {
    collectionRepository.remove(id)
  },

  /** A document with no folder given moves to the root, which is `null` to the repository */
  moveDocument(
    documentId: EARS.EntityId,
    newCollectionId?: EARS.EntityId
  ): DocumentDTO {
    documentRepository.update(documentId, { parentId: newCollectionId ?? null })
    return libraryQueries.findDocument(documentId)!
  },

  renameItem(id: EARS.EntityId, name: string, type: 'document' | 'folder'): LibraryItem {
    const entityId = id
    const now = Date.now()
    
    if (type === 'document') documentRepository.update(entityId, { name })
    else collectionRepository.update(entityId, { name })

    if (type === 'document') {
      const doc = libraryQueries.findDocument(entityId)
      if (!doc) {
        throw new Error(`Document ${entityId} not found`)
      }
      // Ensure content is an array
      const content = doc.content || []
      return {
        type: 'document',
        id: entityId,
        name,
        shortCode: doc.shortCode,
        parentId: doc.collectionId || null,
        content: content,
        tags: doc.tags,
        size: formatFileSize(getContentLength(content)),
        kind: 'Document',
        displayOrder: displayOrderOf(doc),
        createdAt: doc.createdAt,
        updatedAt: new Date(now).toISOString(),
      }
    } else {
      const collections = query.ids(entityId).pickAll()
      const collection = collections[0]!
      const childCount = 0 // Simplified for now
      
      // Find parent folder
      const parentId = parentCollectionOf(entityId)
      
      return {
        type: 'folder',
        id: entityId,
        name,
        parentId,
        childCount,
        size: `${childCount} items`,
        kind: 'Folder',
        displayOrder: displayOrderOf(collection),
        createdAt: new Date(collection.createdAt as number).toISOString(),
        updatedAt: new Date(now).toISOString(),
      }
    }
  },

  deleteItems(ids: EARS.EntityId[]): void {
    for (const id of ids) {
      // Check entity type from ID prefix
      if (id.startsWith('Document-')) {
        this.deleteDocument(id as EARS.EntityId)
      } else if (id.startsWith('Collection-')) {
        this.deleteCollection(id)
      }
    }
  },

  moveItems(ids: EARS.EntityId[], targetFolderId: EARS.EntityId | null): void {
    for (const id of ids) {
      if (id.startsWith('Document-')) {
        this.moveDocument(id, targetFolderId || undefined)
      } else if (id.startsWith('Collection-')) {
        // Move collection to new parent, unless that would put the folder inside itself
        const collectionId = id
        if (targetFolderId && wouldCreateCycle(targetFolderId, collectionId, [EARS.RelKind.PARENT_OF])) continue

        const currentParent = parentCollectionOf(collectionId)
        
        // Remove from current parent if exists
        if (currentParent) {
          write(currentParent).unlink(EARS.RelKind.PARENT_OF, collectionId)
        }
        
        // Add to new parent if specified
        if (targetFolderId) {
          write(targetFolderId).link(EARS.RelKind.PARENT_OF, collectionId)
        }
        
        // Update display order
        const displayOrder = nextDisplayOrder(targetFolderId)
        write(collectionId).set('displayOrder', displayOrder)
      }
    }
  },

  createSymlinkCollection(
    name: string,
    symlinkPath: string,
    parentId?: EARS.EntityId,
    id?: string,
  ): CollectionDTO {
    const now = Date.now()
    const displayOrder = nextDisplayOrder(parentId || null)
    const collectionId = create(EARS.Entity.Collection, {
      ...(id && { id: id as EARS.EntityId }),
      createdAt: now,
      name,
      symlinkPath,
      displayOrder,
    }).id()

    if (parentId) {
      write(parentId).link(EARS.RelKind.PARENT_OF, collectionId)
    }

    const path = collectionPath(collectionId)

    return {
      id: collectionId,
      name,
      parentId,
      path,
      documentCount: 0,
      childCollections: [],
      displayOrder,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      symlinkPath,
    }
  },

  updateSymlinkPath(collectionId: EARS.EntityId, newPath: string): CollectionDTO {
    const now = Date.now()
    const newName = path.basename(newPath) || 'Symlink'
    write(collectionId).setMany({ symlinkPath: newPath, name: newName })

    const col = query.ids(collectionId).pickAll()[0]
    const colPath = collectionPath(collectionId)
    const parentId = parentCollectionOf(collectionId) || undefined

    return {
      id: collectionId,
      name: newName,
      parentId,
      path: colPath,
      documentCount: 0,
      childCollections: [],
      displayOrder: (col.displayOrder as number) || 0,
      createdAt: new Date(col.createdAt as number).toISOString(),
      updatedAt: new Date(now).toISOString(),
      symlinkPath: newPath,
    }
  },

  updateDocumentTags(documentId: EARS.EntityId, tags: string[]): void {
    documentRepository.update(documentId, { tags })
  }
} as const

export const libraryCommands = {
  ...announceWrites(writers),
  /** Follows every write above, until the returned function is called */
  onDocumentsChanged(listener: DocumentsListener): () => void {
    documentsListeners.add(listener);
    return () => documentsListeners.delete(listener);
  },
} as const;
