import { given, type Read } from '@apackdev/state';
import type { NormalizeAsks } from '@apackdev/sdk/events';
import { state } from '#generated/state.ts';
import type { ExplorerAsks } from '../contract.ts';
import { FileSystemRepository } from '../services/filesystem.ts';
import { OpenFileWatcher, type FileChangeInfo } from '../services/open-file-watcher.ts';
import type { CodeSystemError } from '../types.ts';

export interface CodeExplorerSystemContext {
  baseDirectory: string | null;
  repository: FileSystemRepository | null;
  watcher: OpenFileWatcher | null;
}

export type Event =
  | { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string }
  | { type: 'explorer.CHECK_OPEN_FILES' }
  | { type: 'explorer.CLOSE_FILE'; path: string };

type ExplorerShape = {
  data: CodeExplorerSystemContext;
  internal:
    | { type: 'ATTACH_WATCHER'; watcher: OpenFileWatcher }
    | { type: 'FILE_CHANGED'; change: FileChangeInfo };
};

/** The codes a file failure is told with, by the code the filesystem service or the disk gave; `IO_ERROR` for any other */
const FILE_FAILURE_CODES: Readonly<Record<string, CodeSystemError['code']>> = {
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_PATH: 'INVALID_PATH',
  IO_ERROR: 'IO_ERROR',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  ENOENT: 'NOT_FOUND',
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED',
};

type FileRefusal = (kind: 'file', message: string, data: Omit<CodeSystemError, 'message'>) => Error;

/** A file operation that failed, as its ask is refused: what failed, and the path it failed at, else the one asked about */
function fileFailure(refuse: FileRefusal, error: unknown, path: string | undefined): Error {
  const { code, path: at, message } = error as { code?: unknown; path?: string; message?: string };
  const failed = (typeof code === 'string' ? FILE_FAILURE_CODES[code] : undefined) ?? 'IO_ERROR';
  const where = at ?? path;
  return refuse('file', message ?? String(error), { code: failed, ...(where !== undefined && { path: where }) });
}

/**
 * Runs a file operation over the explorer's folder: refused when there is none, and its failure told as a file
 * failure of the path it was at (`fileFailure`)
 */
async function overFiles<T>(
  repository: Read<FileSystemRepository> | null,
  path: string | undefined,
  refuse: FileRefusal,
  run: (repository: Read<FileSystemRepository>) => Promise<T>,
): Promise<T> {
  if (!repository) {
    throw refuse('file', 'No directory selected.', { code: 'INVALID_PATH', ...(path !== undefined && { path }) });
  }
  try {
    return await run(repository);
  } catch (error) {
    throw fileFailure(refuse, error, path);
  }
}

export const explorerSystem = state<ExplorerShape, Event, NormalizeAsks<ExplorerAsks>>()({
  data: {
    baseDirectory: given,
    repository: null,
    watcher: null,
  },
  listen: ({ send }) => {
    const watcher = new OpenFileWatcher((change) => send({ type: 'FILE_CHANGED', change }));
    send({ type: 'ATTACH_WATCHER', watcher });
    return () => {
      void watcher.stop();
    };
  },
  run: ({ data }) => (data.baseDirectory ? { data: { repository: new FileSystemRepository(data.baseDirectory) } } : undefined),
  internal: {
    ATTACH_WATCHER: ({ watcher }) => ({ data: { watcher } }),
    FILE_CHANGED: ({ change }, { broadcast }) => {
      broadcast('code', {
        type: 'explorer.FILE_CHANGED_EXTERNALLY',
        data: change,
      });
    },
  },
  on: {
    'explorer.UPDATE_BASE_DIRECTORY': ({ path }) => ({
      data: {
        baseDirectory: path,
        repository: new FileSystemRepository(path),
      },
    }),
    /** Something may have changed on disk without an event for it: look at every open file again */
    'explorer.CHECK_OPEN_FILES': (_event, { data }) => {
      void data.watcher?.check();
    },
    'explorer.CLOSE_FILE': ({ path }, { data }) => {
      data.watcher?.close(path);
    },
  },
  answers: {
    'explorer.LIST_FILES': (args, { data, refuse }) =>
      overFiles(data.repository, args.path, refuse, (repository) =>
        repository.listDirectory(args.path || data.baseDirectory || ''),
      ),
    'explorer.READ_FILE': ({ path }, { data, refuse }) =>
      overFiles(data.repository, path, refuse, async (repository) => {
        // Watched from before it is read, so a change made while it is being read is one to what the editor holds
        data.watcher?.open(path);
        try {
          return await repository.readFile(path);
        } catch (error) {
          data.watcher?.close(path);
          throw error;
        }
      }),
    'explorer.WRITE_FILE': ({ path, content }, { data, refuse }) =>
      overFiles(data.repository, path, refuse, async (repository) => {
        await repository.writeFile(path, content);
        return { path };
      }),
    'explorer.DELETE_FILE': ({ path }, { data, refuse }) =>
      overFiles(data.repository, path, refuse, async (repository) => {
        await repository.deleteFile(path);
        return { path };
      }),
    'explorer.RENAME_FILE': ({ oldPath, newPath }, { data, refuse }) =>
      overFiles(data.repository, oldPath, refuse, async (repository) => {
        await repository.renameFile(oldPath, newPath);
        return { oldPath, newPath };
      }),
    'explorer.CREATE_DIRECTORY': ({ path }, { data, refuse }) =>
      overFiles(data.repository, path, refuse, async (repository) => {
        await repository.createDirectory(path);
        return { path };
      }),
    'explorer.QUICK_OPEN_SEARCH': ({ baseDirectory }, { data, refuse }) =>
      overFiles(data.repository, baseDirectory, refuse, (repository) => repository.getAllFiles(baseDirectory)),
    'explorer.MOVE_FILES': ({ sourcePaths, targetDir }, { data, refuse }) =>
      overFiles(data.repository, targetDir, refuse, async (repository) => {
        const movedPaths: string[] = [];
        for (const sourcePath of sourcePaths) {
          movedPaths.push(await repository.moveFile(sourcePath, targetDir));
          // The old path is no file any more, so a change at it is not one to an open file
          data.watcher?.close(sourcePath);
        }
        return { sourcePaths, targetDir, movedPaths };
      }),
    'explorer.COPY_FILES': ({ sourcePaths, targetDir }, { data, refuse }) =>
      overFiles(data.repository, targetDir, refuse, async (repository) => {
        const copiedPaths: string[] = [];
        for (const sourcePath of sourcePaths) copiedPaths.push(await repository.copyFileInto(sourcePath, targetDir));
        return { targetDir, copiedPaths };
      }),
  },
});
