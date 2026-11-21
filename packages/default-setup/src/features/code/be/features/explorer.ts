import type { AnswersTo, ExplorerAsks } from '../contract.ts'
import { AskError } from '@apackdev/sdk/events'
import { broadcastToSurface } from '#generated/events.ts';
import { assign, fromCallback, setup, type ActorRefFrom, type AnyActorRef } from 'xstate'

import { FileSystemRepository } from '../services/filesystem.ts'
import { OpenFileWatcher } from '../services/open-file-watcher.ts'
import type { FileChangeInfo } from '../services/open-file-watcher.ts'
import type { CodeSystemError } from '../types.ts'

const surfaceId = 'code' as const

export interface CodeExplorerSystemContext {
  baseDirectory: string | null
  repository: FileSystemRepository | null
}

/** What the explorer tells the watcher of its open files */
type OpenFilesEvent = { type: 'OPEN' | 'CLOSE'; path: string } | { type: 'CHECK' }

/** The watcher of the files open in an editor, which lives as long as the explorer does */
const openFiles = (self: AnyActorRef): AnyActorRef | undefined => self.getSnapshot().children.openFiles

export type Event =
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
  | { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string }
  | { type: 'explorer.CHECK_OPEN_FILES' }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.FILE_CHANGE_CALLBACK'; change: FileChangeInfo };

export const explorerSystem = setup({
  types: {
    context: {} as CodeExplorerSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null }
  },
  actors: {
    openFiles: fromCallback<OpenFilesEvent>(({ receive, sendBack }) => {
      const watcher = new OpenFileWatcher(change => sendBack({ type: 'explorer.FILE_CHANGE_CALLBACK', change }))
      receive((event) => {
        if (event.type === 'OPEN') watcher.open(event.path)
        else if (event.type === 'CLOSE') watcher.close(event.path)
        else void watcher.check()
      })
      return () => { void watcher.stop() }
    }),
  },
  actions: {
    /** Something may have changed on disk without an event for it: look at every open file again */
    checkOpenFiles: ({ self }) => {
      openFiles(self)?.send({ type: 'CHECK' })
    },

    handleFileChange: ({ event }) => {
      const ev = event as { type: 'explorer.FILE_CHANGE_CALLBACK'; change: FileChangeInfo }

      broadcastToSurface(surfaceId, {
        type: 'explorer.FILE_CHANGED_EXTERNALLY',
        data: ev.change
      })
    },

    assignBaseDirectory: assign({
      baseDirectory: ({ event }) => {
        const ev = event as { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
        return ev.path
      },
      repository: ({ event }) => {
        const ev = event as { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
        return new FileSystemRepository(ev.path)
      },
    }),

    updateBaseDirectory: assign({
      baseDirectory: ({ event }) => {
        const ev = event as { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string }
        return ev.path
      },
      repository: ({ event }) => {
        const ev = event as { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string }
        return new FileSystemRepository(ev.path)
      },
    }),

    closeFile: ({ event, self }) => {
      const ev = event as { type: 'explorer.CLOSE_FILE'; path: string }
      openFiles(self)?.send({ type: 'CLOSE', path: ev.path })
    },
  },
}).createMachine({
  id: 'explorer',
  initial: 'idle',
  context: ({ input }: { input?: { baseDirectory: string | null } }) => {
    const baseDir = input?.baseDirectory || null
    return {
      baseDirectory: baseDir,
      repository: baseDir ? new FileSystemRepository(baseDir) : null,
    }
  },
  invoke: { id: 'openFiles', src: 'openFiles' },
  states: {
    idle: {
      on: {
        'explorer.SET_BASE_DIRECTORY': {
          actions: 'assignBaseDirectory'
        },
        'explorer.UPDATE_BASE_DIRECTORY': {
          actions: ['updateBaseDirectory']
        },
        'explorer.CHECK_OPEN_FILES': {
          actions: 'checkOpenFiles'
        },
        'explorer.CLOSE_FILE': {
          actions: 'closeFile'
        },
        'explorer.FILE_CHANGE_CALLBACK': {
          actions: 'handleFileChange'
        }
      }
    }
  }
})

/** The explorer, as the code system holds it: the folder's files, and the watcher of the open ones */
const explorerOf = (code: AnyActorRef) => code.getSnapshot().children.explorer as ActorRefFrom<typeof explorerSystem> | undefined

/** The codes a file failure is told with, by the code the filesystem service or the disk gave; `IO_ERROR` for any other */
const FILE_FAILURE_CODES: Readonly<Record<string, CodeSystemError['code']>> = {
  NOT_FOUND: 'NOT_FOUND', PERMISSION_DENIED: 'PERMISSION_DENIED', INVALID_PATH: 'INVALID_PATH', IO_ERROR: 'IO_ERROR', FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  ENOENT: 'NOT_FOUND', EACCES: 'PERMISSION_DENIED', EPERM: 'PERMISSION_DENIED',
}

/** A file operation that failed, as its ask is refused: what failed, and the path it failed at, else the one asked about */
function fileFailure(error: unknown, path: string | undefined): AskError {
  const { code, path: at, message } = error as { code?: unknown; path?: string; message?: string }
  const failed = (typeof code === 'string' ? FILE_FAILURE_CODES[code] : undefined) ?? 'IO_ERROR'
  const where = at ?? path
  return new AskError('file', message ?? String(error), { code: failed, ...(where !== undefined && { path: where }) })
}

/**
 * Runs a file operation over the explorer's folder: refused when there is none, and its failure told as a file
 * failure of the path it was at (`fileFailure`)
 */
async function overFiles<T>(code: AnyActorRef, path: string | undefined, run: (repository: FileSystemRepository, explorer: AnyActorRef) => Promise<T>): Promise<T> {
  const explorer = explorerOf(code)
  const repository = explorer?.getSnapshot().context.repository
  if (!explorer || !repository) throw new AskError('file', 'No directory selected.', { code: 'INVALID_PATH', ...(path !== undefined && { path }) })
  try {
    return await run(repository, explorer)
  } catch (error) {
    throw fileFailure(error, path)
  }
}

/** The explorer asks, answered by the code system (`answers`, `system.ts`) over the explorer's folder */
export const explorerAnswers: AnswersTo<ExplorerAsks> = {
  'explorer.LIST_FILES': ({ args, self }) => overFiles(self, args.path, (repository, explorer) =>
    repository.listDirectory(args.path || explorer.getSnapshot().context.baseDirectory || '')),
  'explorer.READ_FILE': ({ args: { path }, self }) => overFiles(self, path, async (repository, explorer) => {
    // Watched from before it is read, so a change made while it is being read is one to what the editor holds
    openFiles(explorer)?.send({ type: 'OPEN', path })
    try {
      return await repository.readFile(path)
    } catch (error) {
      openFiles(explorer)?.send({ type: 'CLOSE', path })
      throw error
    }
  }),
  'explorer.WRITE_FILE': ({ args: { path, content }, self }) => overFiles(self, path, async (repository) => {
    await repository.writeFile(path, content)
    return { path }
  }),
  'explorer.CREATE_FILE': ({ args: { path, content }, self }) => overFiles(self, path, async (repository) => {
    await repository.writeFile(path, content || '')
    return { path }
  }),
  'explorer.DELETE_FILE': ({ args: { path }, self }) => overFiles(self, path, async (repository) => {
    await repository.deleteFile(path)
    return { path }
  }),
  'explorer.RENAME_FILE': ({ args: { oldPath, newPath }, self }) => overFiles(self, oldPath, async (repository) => {
    await repository.renameFile(oldPath, newPath)
    return { oldPath, newPath }
  }),
  'explorer.CREATE_DIRECTORY': ({ args: { path }, self }) => overFiles(self, path, async (repository) => {
    await repository.createDirectory(path)
    return { path }
  }),
  'explorer.GET_FILE_INFO': ({ args: { path }, self }) => overFiles(self, path, repository => repository.getFileInfo(path)),
  'explorer.QUICK_OPEN_SEARCH': ({ args: { baseDirectory }, self }) => overFiles(self, baseDirectory, repository => repository.getAllFiles(baseDirectory)),
  'explorer.MOVE_FILES': ({ args: { sourcePaths, targetDir }, self }) => overFiles(self, targetDir, async (repository, explorer) => {
    const movedPaths: string[] = []
    for (const sourcePath of sourcePaths) {
      movedPaths.push(await repository.moveFile(sourcePath, targetDir))
      // The old path is no file any more, so a change at it is not one to an open file
      openFiles(explorer)?.send({ type: 'CLOSE', path: sourcePath })
    }
    return { sourcePaths, targetDir, movedPaths }
  }),
  'explorer.COPY_FILES': ({ args: { sourcePaths, targetDir }, self }) => overFiles(self, targetDir, async (repository) => {
    const copiedPaths: string[] = []
    for (const sourcePath of sourcePaths) copiedPaths.push(await repository.copyFileInto(sourcePath, targetDir))
    return { targetDir, copiedPaths }
  }),
}
