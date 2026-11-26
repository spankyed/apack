// [SEARCH_INDEX_FF] The search index is dormant: ./search-index/README.md lists its call sites and how to turn it on
import { state } from '#generated/state.ts';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';
// [SEARCH_INDEX_FF] import type { SearchIndex } from './search-index/types/search-index'
import { repository } from '#generated/repository.ts';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { libraryService } from './services/library.ts';
import * as symlink from './repository/symlink.ts';
import { toMap, toIdentifierSet, mapArray } from '@apackdev/sdk/utils';
import { exportLibrary } from './export-library.ts';
import { importLibrary } from './import-library.ts';

type LibraryBroadcast = (to: 'library', event: { type: 'FOLDER_CHANGED'; folderId: string | null }) => void;

type DiskRefuse = (kind: 'not-found' | 'no-access', message: string) => Error;

const DISK_FAILURE_KINDS: Readonly<Record<string, 'not-found' | 'no-access'>> = {
  ENOENT: 'not-found',
  ENOTDIR: 'not-found',
  EACCES: 'no-access',
  EPERM: 'no-access',
};

function rethrowDiskRefusal(error: unknown, refuse: DiskRefuse): never {
  const code = (error as { code?: unknown } | null)?.code;
  const kind = typeof code === 'string' ? DISK_FAILURE_KINDS[code] : undefined;
  if (kind !== undefined) {
    throw refuse(kind, error instanceof Error ? error.message : String(error));
  }
  throw error;
}

/** Maps Node filesystem errors (`ENOENT`/`ENOTDIR`, `EACCES`/`EPERM`) to the ask's declared disk refusal kinds. */
function withDiskRefusal<T>(refuse: DiskRefuse, run: () => T): T {
  try {
    const result = run();
    if (result !== null && typeof result === 'object' && 'then' in result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).catch((error: unknown) => rethrowDiskRefusal(error, refuse)) as T;
    }
    return result;
  } catch (error: unknown) {
    rethrowDiskRefusal(error, refuse);
  }
}

/**
 * Tells every window that something on disk under a symlinked folder changed, which no view can see: `folderId`'s
 * contents, or with `null`, a symlinked folder's not known. A notification — whoever is showing one fetches it again.
 */
const diskChanged = (broadcast: LibraryBroadcast, folderId: string | null) =>
  broadcast('library', { type: 'FOLDER_CHANGED', folderId });

/** The folder on disk an item on disk sits in, or `null` when that can't be worked out */
function diskParentOf(id: string): string | null {
  const parsed = symlink.parseSymlinkId(id);
  if (!parsed) return null;
  const resolved = symlink.resolveSymlinkPath(id);
  const basePath = symlink.getSymlinkCollectionPath(parsed.collectionId);
  if (!resolved || !basePath) return parsed.collectionId;
  const parentRelPath = path.dirname(path.relative(basePath, resolved.absolutePath));
  return parentRelPath && parentRelPath !== '.' ? symlink.buildSymlinkId(parsed.collectionId, parentRelPath) : parsed.collectionId;
}

function resolveHomePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  if (trimmed === '~') return os.homedir();
  return trimmed;
}

/**
 * A window's writes to the library, its fetches of what is on disk and its imports and exports, each answered to
 * whoever asked: with what it made, read, imported or exported, or why it could not be done. The surface holds its views behind its own unanswered writes and shows
 * nothing for a fetch until it is answered, which the table holds whichever way a handler ends. An error from the disk
 * under a symlinked folder is answered as the kind it is (`not-found`, `no-access`) where the ask declares it.
 */
export const librarySystem = state<
  {},
  IncomingOnlyEventsOf<Contract> | Extract<HostLifecycleEvents, { type: 'FEATURE_SETTINGS_UPDATED' }>,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  on: {
    FEATURE_SETTINGS_UPDATED: ({ changes }) => {
      const tagChanges = changes?.tags;

      if (!tagChanges) return;

      const renames = toMap(tagChanges.renames);
      // Tags use 'name' property as identifier
      const removed = toIdentifierSet(tagChanges.removed, (item: any) => item.name);

      if (!renames.size && !removed.size) return;

      // Update all documents that have renamed or removed tags
      for (const doc of repository.libraryQueries.getAllDocuments()) {
        const { next: nextTags, changed } = mapArray(doc.tags, renames, removed);

        if (changed) repository.libraryCommands.updateDocumentTags(doc.id, nextTags);
      }
    },
  },
  answers: {
    CREATE_DOCUMENT: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      await libraryService.create({
        name: args.name,
        content: args.content,
        tags: args.tags,
        parentId: args.collectionId,
        documentType: args.documentType,
      });
      if (args.collectionId && repository.libraryQueries.isDiskFolder(args.collectionId)) diskChanged(broadcast, args.collectionId);
    }),
    UPDATE_DOCUMENT: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      await libraryService.update({ id: args.id, name: args.name, content: args.content, tags: args.tags });
      if (repository.libraryQueries.isDiskDocument(args.id)) diskChanged(broadcast, diskParentOf(args.id));
    }),
    DELETE_DOCUMENT: (args) => { repository.libraryCommands.deleteDocument(args.id); },
    GET_DOCUMENT: (args, { refuse }) => withDiskRefusal(refuse, async () => {
      const document = await libraryService.find(args.id);
      if (!document) throw refuse('not-found', 'Document not found');
      return { document };
    }),
    CREATE_COLLECTION: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      if (args.parentId && repository.libraryQueries.isDiskFolder(args.parentId)) {
        await libraryService.createFolder({ name: args.name, parentId: args.parentId });
        diskChanged(broadcast, args.parentId);
        return {};
      }
      // Only the window that asked names it; every window's folder shows it through the folder view
      return { collection: repository.libraryCommands.createCollection(args.name, args.description, args.parentId) };
    }),
    UPDATE_COLLECTION: (args) => { repository.libraryCommands.updateCollection(args.id, args.name, args.description); },
    DELETE_COLLECTION: (args) => { repository.libraryCommands.deleteCollection(args.id); },
    MOVE_DOCUMENT: (args) => { repository.libraryCommands.moveDocument(args.documentId, args.collectionId); },
    // File browser
    GET_FOLDER_CONTENTS: (args, { refuse }) => withDiskRefusal(refuse, () => repository.libraryQueries.getFolderContents(args.folderId)),
    CHECK_SYMLINKS: async (args) => ({ ids: args.ids, broken: await repository.libraryQueries.brokenSymlinks(args.ids) }),
    RENAME_ITEM: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      if (symlink.isSymlinkId(args.id)) {
        // Worked out before the rename, while the path still resolves
        const parent = diskParentOf(args.id);
        await libraryService.rename(args.id, args.name);
        diskChanged(broadcast, parent);
        return;
      }
      repository.libraryCommands.renameItem(args.id, args.name, args.itemType);
    }),
    DELETE_ITEMS: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      await libraryService.remove(args.ids);
      if (args.ids.some(symlink.isSymlinkId)) diskChanged(broadcast, null);
    }),
    MOVE_ITEMS: (args, { broadcast, refuse }) => withDiskRefusal(refuse, async () => {
      await libraryService.move(args.ids, args.targetFolderId);
      if (args.ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(args.targetFolderId)) diskChanged(broadcast, null);
    }),
    // Symlinked folders
    CREATE_SYMLINK_COLLECTION: (args) => ({
      collection: repository.libraryCommands.createSymlinkCollection(args.name, resolveHomePath(args.symlinkPath), args.parentId),
    }),
    UPDATE_SYMLINK_PATH: async (args, { broadcast, refuse }) => {
      const resolvedPath = resolveHomePath(args.newPath);
      // A folder to link has to be one: missing, or a file, is refused
      let isDirectory = false;
      try {
        isDirectory = (await fs.stat(resolvedPath)).isDirectory();
      } catch {
        // Missing: refused below
      }
      if (!isDirectory) throw refuse('not-found', `Path does not exist: ${resolvedPath}`);
      repository.libraryCommands.updateSymlinkPath(args.collectionId, resolvedPath);
      diskChanged(broadcast, args.collectionId);
    },
    EXPORT_LIBRARY: ({ directory, format }) => exportLibrary(directory, format),
    // What an import stored reaches every window through the library's views, a part way import's included
    IMPORT_LIBRARY: ({ directory }) => {
      const result = importLibrary(directory);
      if (result.created === 0 && result.errors.length > 0) throw new Error(result.errors.join('\n'));
      return { count: result.created, ...(result.errors.length > 0 ? { errors: result.errors } : {}) };
    },
  },
});

export default librarySystem;
