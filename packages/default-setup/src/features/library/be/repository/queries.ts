import { query } from '#generated/ears.ts';
import * as fs from 'fs/promises'

import { EARS } from '#generated/ears.ts'
import type { DocumentDTO, CollectionDTO, LibraryIndex, LibraryItem, FolderItem, FolderContents, BreadcrumbItem } from '../types.ts'
import { parentCollectionOf, collectionOfDocument, displayOrderOf, collectionPath } from '@apackdev/sdk/repositories'
import { isRootCollection, formatFileSize, getContentLength } from './helpers.ts'
import { isSymlinkId, isSymlinkCollection, getSymlinkFolderContents, resolveSymlinkPath } from './symlink.ts'
import type { ContentSection, DocumentShortCode } from '#features/library/be/types.ts';

/** The fields a folder item reads */
const FOLDER_FIELDS = ['name', 'symlinkPath', 'displayOrder', 'createdAt', 'updatedAt'] as const

export const libraryQueries = {
  getDocuments(collectionId?: string): DocumentDTO[] {
    const allDocuments = query(EARS.Entity.Document)

    if (collectionId) {
      const documentsInCollection = query.ids(collectionId as EARS.EntityId)
        .out(EARS.RelKind.CONTAINS, EARS.Entity.Document)
        .pickAll()

      const documentIds = documentsInCollection.map((doc) => doc.id)
      if (documentIds.length === 0) return []

      const documents = documentIds.map((id) => this.findDocument(id as EARS.EntityId))
      return documents.filter((doc): doc is DocumentDTO => doc !== null)
    }

    const documents = allDocuments.pick(['name', 'content', 'shortCode', 'createdAt', 'updatedAt', 'tags', 'displayOrder', 'documentType'])

    const documentsWithDetails = documents.map((doc) => {
      const tags = doc.tags || []

      // Find collection that contains this document
      const collectionId = collectionOfDocument(doc.id as EARS.EntityId)
      const collection = collectionId ? query.ids(collectionId).pickAll()[0] : null

      const path = collection
        ? collectionPath(collection.id as EARS.EntityId)
        : []

      return {
        id: doc.id,
        name: doc.name as string,
        content: doc.content as ContentSection[],
        shortCode: doc.shortCode as DocumentShortCode,
        tags: tags as string[],
        documentType: doc.documentType as string | undefined,
        collectionId: collection?.id,
        collectionPath: path,
        displayOrder: displayOrderOf(doc),
        createdAt: new Date(doc.createdAt as number).toISOString(),
        updatedAt: new Date(doc.updatedAt as number || doc.createdAt as number).toISOString(),
      }
    })

    return documentsWithDetails
  },

  findDocument(id: EARS.EntityId): DocumentDTO | null {
    const documentId = id
    const documents = query.ids(documentId).pickAll()
    const document = documents[0]

    if (!document) return null

    const tags = document.tags || []

    const collectionId = query.ids(documentId).in(EARS.RelKind.CONTAINS, EARS.Entity.Collection).first()
    const path = collectionId ? collectionPath(collectionId) : []

    return {
      id: documentId,
      name: document.name as string,
      content: document.content as ContentSection[],
      shortCode: document.shortCode as DocumentShortCode,
      tags: tags as string[],
      collectionId: collectionId ?? undefined,
      collectionPath: path,
      displayOrder: displayOrderOf(document),
      createdAt: new Date(document.createdAt as number).toISOString(),
      updatedAt: new Date(document.updatedAt as number || document.createdAt as number).toISOString(),
    }
  },

  /** The document a short code names, or null: a code is unique, and the value index answers the lookup */
  findDocumentByShortCode(shortCode: DocumentShortCode): DocumentDTO | null {
    const id = query(EARS.Entity.Document).where('shortCode', shortCode).first()
    return id ? this.findDocument(id) : null
  },

  /** Every document and folder by name, for the reference picker and the panel's stats */
  getIndex(): LibraryIndex {
    return {
      documents: query(EARS.Entity.Document).pick(['name', 'shortCode', 'tags']).map((doc) => ({
        id: doc.id,
        name: doc.name as string,
        shortCode: doc.shortCode as DocumentShortCode,
        tags: (doc.tags as string[] | undefined) ?? [],
      })),
      folders: query(EARS.Entity.Collection).pick(['name']).map((col) => ({
        id: col.id,
        name: col.name as string,
      })),
    }
  },

  getCollections(): CollectionDTO[] {
    const rootCollections = query(EARS.Entity.Collection)
      .pick(['name', 'description', 'createdAt', 'updatedAt', 'symlinkPath'])
      .filter(col => isRootCollection(col.id as EARS.EntityId))

    const buildTree = (cols: any[]): CollectionDTO[] =>
      cols.map(col => ({
        id: col.id,
        name: col.name as string,
        description: col.description as string | undefined,
        path: collectionPath(col.id as EARS.EntityId),
        documentCount: query.ids(col.id as EARS.EntityId).out(EARS.RelKind.CONTAINS, EARS.Entity.Document).count(),
        childCollections: buildTree(query.ids(col.id as EARS.EntityId).out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).pick(['name', 'description', 'createdAt', 'updatedAt', 'symlinkPath'])),
        displayOrder: displayOrderOf(col),
        createdAt: new Date(col.createdAt as number).toISOString(),
        updatedAt: new Date(col.updatedAt as number || col.createdAt as number).toISOString(),
        ...(col.symlinkPath ? { symlinkPath: col.symlinkPath as string } : {}),
      }))

    return buildTree(rootCollections)
  },

  /** Whether a document is a file on disk under a symlinked folder, rather than one the library stores */
  isDiskDocument(id: string): boolean {
    return isSymlinkId(id)
  },

  /** Whether a folder's contents are on disk: a symlinked collection, or a folder inside one */
  isDiskFolder(folderId: string | null): boolean {
    return folderId !== null && (isSymlinkId(folderId) || isSymlinkCollection(folderId))
  },

  /** A folder's contents wherever they are: on disk for a symlinked folder, else in the library */
  async getFolderContents(folderId: EARS.EntityId | null): Promise<FolderContents> {
    if (folderId && this.isDiskFolder(folderId)) {
      const symlinkContents = await getSymlinkFolderContents(folderId)
      if (symlinkContents) return symlinkContents
    }
    return this.engineFolderContents(folderId)
  },

  /** The symlinked collections among `ids` whose folder on disk is gone */
  async brokenSymlinks(ids: readonly string[]): Promise<string[]> {
    const broken: string[] = []
    for (const id of ids) {
      const target = query.ids(id as EARS.EntityId).pickOne(['symlinkPath'])?.symlinkPath as string | undefined
      if (!target) continue
      try {
        await fs.access(target)
      } catch {
        broken.push(id)
      }
    }
    return broken
  },

  /**
   * A folder's contents as the library stores them: its folders and documents, its path and breadcrumbs. It reads the
   * engine and nothing else, so a view can watch it; whether a symlinked folder still reaches its disk is
   * `brokenSymlinks`', and a symlinked folder's own contents are `getFolderContents`'.
   */
  engineFolderContents(folderId: EARS.EntityId | null): FolderContents {
    const items: LibraryItem[] = []

    // The folders in this directory: at the root, the collections nothing is a parent of
    let folders: any[]
    if (folderId === null) {
      folders = query(EARS.Entity.Collection).unlinkedFrom(EARS.RelKind.PARENT_OF).pick(FOLDER_FIELDS)
    } else {
      folders = query.ids(folderId).out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).pick(FOLDER_FIELDS)
    }

    // Each folder's children, its folders and documents, for all of them in a read each
    const folderIds = folders.map(folder => folder.id as EARS.EntityId)
    const children = new Map<string, Set<string>>()
    for (const [kind, type] of [[EARS.RelKind.PARENT_OF, EARS.Entity.Collection], [EARS.RelKind.CONTAINS, EARS.Entity.Document]] as const) {
      if (!folderIds.length) break
      for (const { source, target } of query.ids(folderIds).outEdges(kind, type)) {
        if (source !== target) children.set(source, (children.get(source) ?? new Set()).add(target))
      }
    }

    for (const folder of folders) {
      const itemId = folder.id
      const childCount = children.get(itemId)?.size ?? 0
      const folderSymlinkPath = folder.symlinkPath as string | undefined

      const folderItem: FolderItem = {
        type: 'folder',
        id: itemId,
        name: folder.name as string,
        parentId: folderId,
        childCount,
        size: '--',
        kind: 'Folder',
        displayOrder: displayOrderOf(folder),
        createdAt: new Date(folder.createdAt as number).toISOString(),
        updatedAt: new Date(folder.updatedAt as number || folder.createdAt as number).toISOString(),
      }

      if (folderSymlinkPath) {
        folderItem.isSymlink = true
        folderItem.symlinkPath = folderSymlinkPath
        folderItem.size = '--'
      }

      items.push(folderItem)
    }
    
    // The documents in this directory: at the root, the documents nothing contains
    let documents: any[] = []

    if (folderId === null) {
      documents = query(EARS.Entity.Document).unlinkedFrom(EARS.RelKind.CONTAINS).pickAll()
    } else {
      // Get documents in this collection
      documents = query.ids(folderId)
        .out(EARS.RelKind.CONTAINS, EARS.Entity.Document)
        .pickAll()
    }
    
    // Convert documents to document items
    for (const doc of documents) {
      const documentId = doc.id
      
      const contentSections = doc.content as ContentSection[]
      
      // Calculate content length for all sections
      const contentLength = getContentLength(contentSections)
      const size = formatFileSize(contentLength)
      
      const tags = doc.tags || []
      
      items.push({
        type: 'document',
        id: documentId,
        name: doc.name as string,
        shortCode: doc.shortCode as DocumentShortCode,
        parentId: folderId,
        content: contentSections,
        tags: tags as string[],
        size,
        kind: 'Document',
        displayOrder: displayOrderOf(doc),
        createdAt: new Date(doc.createdAt as number).toISOString(),
        updatedAt: new Date(doc.updatedAt as number || doc.createdAt as number).toISOString(),
      })
    }
    
    // Get current path and breadcrumbs
    const currentPath = folderId ? collectionPath(folderId) : []
    const breadcrumbs = this.getFolderPath(folderId)
    
    return {
      items: items.sort((a, b) => {
        // Folders first, then by display order
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1
        }
        // Sort by display order, fall back to name if orders are equal
        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder
        }
        return a.name.localeCompare(b.name)
      }),
      currentPath,
      currentFolderId: folderId,
      breadcrumbs,
    }
  },

  getFolderPath(folderId: EARS.EntityId | null): BreadcrumbItem[] {
    if (folderId === null) {
      return []
    }
    
    // The folder and every folder above it, the root first
    const ids = [folderId, ...query.ids(folderId).ancestors(EARS.RelKind.PARENT_OF).ids()].reverse()
    const names = new Map(query.ids(ids).pick(['name']).map(row => [row.id, row.name as string]))
    return ids.flatMap((id): BreadcrumbItem[] => (names.has(id) ? [{ id, name: names.get(id)!, path: [] }] : []))
  },

  getParentFolderId(folderId: EARS.EntityId): EARS.EntityId | null {
    return parentCollectionOf(folderId)
  },


  getDocumentsInCollection(collectionId: EARS.EntityId): DocumentDTO[] {
    const documentIds = query.ids(collectionId)
      .out(EARS.RelKind.CONTAINS, EARS.Entity.Document)
      .ids()
    
    if (documentIds.length === 0) {
      return []
    }
    
    const documents = documentIds.map((id) => this.findDocument(id))
    
    return documents.filter((doc): doc is DocumentDTO => doc !== null)
  },

  getText(id: EARS.EntityId): string | undefined {
    const doc = this.findDocument(id)
    if (!doc) return undefined
    return doc.content
      .filter((s): s is Extract<ContentSection, { type: 'markdown' }> | Extract<ContentSection, { type: 'text' }> | Extract<ContentSection, { type: 'code' }> => s.type === 'markdown' || s.type === 'text' || s.type === 'code')
      .map(s => s.text)
      .join('\n')
  },

  resolveSymlinkPath(id: string): { collectionId: string; absolutePath: string } | null {
    return resolveSymlinkPath(id)
  },

  getAllDocuments(): DocumentDTO[] {
    const documents = query(EARS.Entity.Document)
      .pick(['name', 'content', 'shortCode', 'createdAt', 'updatedAt', 'tags', 'displayOrder'])

    const documentsWithDetails = documents.map((doc) => {
      const tags = doc.tags || []

      // Find collection that contains this document
      const collectionLinks = query.ids(doc.id as EARS.EntityId)
        .inEdges(EARS.RelKind.CONTAINS, EARS.Entity.Collection)
      const collection = collectionLinks.length > 0 ? query.ids(collectionLinks[0].source).pickAll()[0] : null

      const path = collection ? collectionPath(collection.id as EARS.EntityId) : []

      return {
        id: doc.id,
        name: doc.name as string,
        content: doc.content as ContentSection[],
        shortCode: doc.shortCode as DocumentShortCode,
        tags: tags as string[],
        collectionId: collection?.id,
        collectionPath: path,
        displayOrder: doc.displayOrder as number || 0,
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt ?? doc.createdAt).toISOString(),
      }
    })

    return documentsWithDetails
  }
} as const