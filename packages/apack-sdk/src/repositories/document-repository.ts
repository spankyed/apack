// Documents and the folders holding them: the SDK declares `Document`, `Collection` and `parent_of`, so
// the app can read documents itself — `getCommands()` is a query over the ones whose `documentType` marks
// them command lists — and a pack can store one without depending on whichever pack used to own them.
//
// **The tree's mechanics are here; its presentation is not.** A document's place among its siblings is
// written when it is created, and siblings are mixed — folders by `parent_of`, documents by `contains` —
// so an entity that moved without them would sort differently depending on who wrote it. What stays with
// the feature that draws the tree is everything a view wants: paths, counts, child shapes, the index,
// search, symlink resolution. These return rows and ids; a DTO is the editor's.
import { findRelations, untypedCreate, untypedQuery as query, untypedWrite as write } from '../ears/index.ts';
import { sdkEntities } from '../ears/sdk-entities.ts';
import { EARS } from '../types/entities.ts';
import type { CollectionEntity, ContentSection, DocumentEntity } from '../types/sdk-entities.ts';

/** A document's fields, as it is created */
export interface DocumentInput {
  name: string;
  content: ContentSection[];
  tags?: string[];
  /** The folder to put it in; absent leaves it at the root */
  parentId?: EARS.EntityId | null;
  /** What the document is: `commands` marks a slash-command list */
  documentType?: string;
  contentHash?: string;
  /** An id to create it under, for a caller restoring a row rather than making one */
  id?: string;
}

/** A folder's fields, as it is created */
export interface CollectionInput {
  name: string;
  description?: string;
  parentId?: EARS.EntityId;
  contentHash?: string;
  id?: string;
}

/** The gap left between siblings, so one can be dropped between two without renumbering them */
const ORDER_GAP = 1000;

/** A row's display order, tolerating the array an older write left */
export function displayOrderOf(row: unknown): number {
  const order = (row as { displayOrder?: unknown } | undefined)?.displayOrder;
  return Array.isArray(order) ? (order[0] as number) || 0 : (order as number) || 0;
}

/** The folder holding `childId`, or none when it is at the root */
export function parentCollectionOf(childId: EARS.EntityId): EARS.EntityId | null {
  const [relation] = findRelations({ kind: EARS.RelKind.PARENT_OF, target: childId });
  return (relation?.source as EARS.EntityId) ?? null;
}

/** The folder holding `documentId`, or none when it is at the root */
export function collectionOfDocument(documentId: EARS.EntityId): EARS.EntityId | null {
  const [relation] = findRelations({ kind: EARS.RelKind.CONTAINS, target: documentId });
  return (relation?.source as EARS.EntityId) ?? null;
}

/** A folder's names from the root down to it */
export function collectionPath(collectionId: EARS.EntityId): string[] {
  const names = (rows: Array<Record<string, unknown>>) => rows.map((row) => String(row.name));
  return [
    ...names(query.ids(collectionId).ancestors(EARS.RelKind.PARENT_OF).pick(['name'])).reverse(),
    ...names(query.ids(collectionId).pick(['name'])),
  ];
}

/**
 * Where a new child of `parentId` sorts: after every sibling, folders and documents alike.
 *
 * Both kinds share one ordering because the tree shows them together, which is why this cannot be
 * answered by either entity's own rows.
 */
export function nextDisplayOrder(parentId: EARS.EntityId | null): number {
  const siblings = parentId === null
    ? [
      ...(query(EARS.Entity.Collection).unlinkedFrom(EARS.RelKind.PARENT_OF).pickAll() as Array<Record<string, unknown>>),
      ...(query(EARS.Entity.Document).unlinkedFrom(EARS.RelKind.CONTAINS).pickAll() as Array<Record<string, unknown>>),
    ]
    : [
      ...(query.ids(parentId).out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).pickAll() as Array<Record<string, unknown>>),
      ...(query.ids(parentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Document).pickAll() as Array<Record<string, unknown>>),
    ];
  return Math.max(0, ...siblings.map(displayOrderOf)) + ORDER_GAP;
}

/** Rows of documents, which no write announcement wraps */
const documentReads = {
  byId: (id: EARS.EntityId): DocumentEntity | undefined => sdkEntities.query.ids(id).ofType(EARS.Entity.Document).pickOne() ?? undefined,

  all: (): DocumentEntity[] => sdkEntities.query(EARS.Entity.Document).pickAll(),

  /**
   * Every document of `documentType`, in the order the tree shows them: display order, then name.
   *
   * This is what the chat's slash commands are read through, so the order is the list's order and not
   * an accident of insertion.
   */
  ofType: (documentType: string): DocumentEntity[] =>
    documentReads.all()
      .filter((document) => document.documentType === documentType)
      .sort((a, b) => displayOrderOf(a) - displayOrderOf(b) || a.name.localeCompare(b.name)),
};

type DocumentsListener = () => void;

const documentsListeners = new Set<DocumentsListener>();

/**
 * Every document write tells its subscribers, so no write decides whether its own mattered and one added
 * later is covered without anyone remembering.
 *
 * **It hands subscribers no payload and makes no send.** A repository reads and writes rows; what changed
 * is the subscriber's to work out. The app's own subscriber derives the chat's slash commands from these
 * rows and compares the result, which is the one place that comparison is made — so an editor never has
 * to announce that it edited a command, and a second editor would not have to either.
 *
 * It wraps the writes only, so the reads beside them keep their identity for a caller holding a reference.
 */
function announceWrites<T extends Record<string, (...args: never[]) => unknown>>(writes: T): T {
  const announced: Record<string, unknown> = {};
  for (const [name, write] of Object.entries(writes)) {
    announced[name] = (...args: never[]) => {
      const result = (write as (...a: never[]) => unknown)(...args);
      for (const listener of documentsListeners) listener();
      return result;
    };
  }
  return announced as T;
}

/** Rows and writes of documents */
const documentWrites = {
  create: (data: DocumentInput): DocumentEntity => {
    const { parentId, id, tags, documentType, contentHash, ...fields } = data;
    const now = Date.now();
    // Read before the row exists, which would then sort as its own sibling; `create` numbers its short code
    const displayOrder = nextDisplayOrder(parentId ?? null);
    const documentId = untypedCreate(EARS.Entity.Document, {
      ...(id && { id: id as EARS.EntityId }),
      createdAt: now,
      ...fields,
      displayOrder,
      tags: tags ?? [],
      ...(documentType !== undefined && { documentType }),
      ...(contentHash && { contentHash }),
    }).id();
    if (parentId) write(parentId).link(EARS.RelKind.CONTAINS, documentId);
    return (query.ids(documentId).pickAll() as unknown as DocumentEntity[])[0];
  },

  /**
   * Writes the fields given. The three states of `parentId` are distinct: a folder moves the document
   * into it, `null` moves it out to the root, and leaving it out keeps it where it is. A document at the
   * root is one no folder `contains`, so moving it there is an unlink with nothing to follow.
   */
  update: (id: EARS.EntityId, updates: Partial<DocumentInput>): void => {
    const { parentId, id: _id, tags, documentType, contentHash, ...fields } = updates;
    write(id).setMany({
      ...fields,
      ...(tags && { tags }),
      ...(documentType !== undefined && { documentType }),
      ...(contentHash && { contentHash }),
    });
    if (parentId === undefined) return;
    const current = collectionOfDocument(id);
    if (current === (parentId ?? null)) return;
    if (current) write(current).unlink(EARS.RelKind.CONTAINS, id);
    if (parentId) write(parentId).link(EARS.RelKind.CONTAINS, id);
  },

  /** Removes the document and the link holding it, which no longer names anything */
  remove: (id: EARS.EntityId): void => {
    const parent = collectionOfDocument(id);
    if (parent) write(parent).unlink(EARS.RelKind.CONTAINS, id);
    write(id).destroy();
  },
};

/**
 * Rows and writes of documents.
 *
 * **Every mutation of a document row goes through here**, which is what makes the announcement complete:
 * a caller that reaches past it with `write` writes a document nobody is told about. That is why the editor's
 * rename, move and tag writes call `update` rather than writing the attribute themselves.
 */
export const documentRepository = {
  ...documentReads,
  ...announceWrites(documentWrites),

  /** Follows every document write above, until the returned function is called */
  onDocumentsChanged(listener: DocumentsListener): () => void {
    documentsListeners.add(listener);
    return () => documentsListeners.delete(listener);
  },
} as const;

/** Rows and writes of the folders documents sit in */
export const collectionRepository = {
  byId: (id: EARS.EntityId): CollectionEntity | undefined => sdkEntities.query.ids(id).ofType(EARS.Entity.Collection).pickOne() ?? undefined,

  all: (): CollectionEntity[] => sdkEntities.query(EARS.Entity.Collection).pickAll(),

  /** The folders directly inside `parentId`, or the root ones */
  children: (parentId: EARS.EntityId | null): CollectionEntity[] => (parentId === null
    ? sdkEntities.query(EARS.Entity.Collection).unlinkedFrom(EARS.RelKind.PARENT_OF).pickAll()
    : query.ids(parentId).out(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).pickAll() as unknown as CollectionEntity[]),

  /** The documents directly inside `parentId` */
  documents: (parentId: EARS.EntityId): DocumentEntity[] =>
    query.ids(parentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Document).pickAll() as unknown as DocumentEntity[],

  create: (data: CollectionInput): CollectionEntity => {
    const { parentId, id, description, contentHash, ...fields } = data;
    const now = Date.now();
    // Read before the row exists, which would otherwise sort as its own sibling
    const displayOrder = nextDisplayOrder(parentId ?? null);
    const collectionId = untypedCreate(EARS.Entity.Collection, {
      ...(id && { id: id as EARS.EntityId }),
      createdAt: now,
      ...fields,
      displayOrder,
      ...(contentHash && { contentHash }),
      // A folder is named, not numbered: it has no shortCode, so an empty description is simply absent
      ...(description ? { description } : {}),
    }).id();
    if (parentId) write(parentId).link(EARS.RelKind.PARENT_OF, collectionId);
    return (query.ids(collectionId).pickAll() as unknown as CollectionEntity[])[0];
  },

  /** A description given as `''` is emptied; one left out is kept */
  update: (id: EARS.EntityId, updates: Partial<Omit<CollectionInput, 'parentId' | 'id'>>): void => {
    const { description, contentHash, ...fields } = updates;
    write(id).setMany({
      ...fields,
      ...(contentHash && { contentHash }),
      ...(description !== undefined && { description }),
    });
  },

  /**
   * Removes the folder, keeping what it held: its documents go to the root and its folders to its own
   * parent. A folder is a place rather than an owner, so deleting one is not deleting what was in it.
   */
  remove: (id: EARS.EntityId): void => {
    for (const document of collectionRepository.documents(id)) {
      write(id).unlink(EARS.RelKind.CONTAINS, document.id as EARS.EntityId);
    }
    const parent = parentCollectionOf(id);
    if (parent) write(parent).unlink(EARS.RelKind.PARENT_OF, id);
    for (const child of collectionRepository.children(id)) {
      const childId = child.id as EARS.EntityId;
      write(id).unlink(EARS.RelKind.PARENT_OF, childId);
      if (parent) write(parent).link(EARS.RelKind.PARENT_OF, childId);
    }
    write(id).destroy();
  },
};
