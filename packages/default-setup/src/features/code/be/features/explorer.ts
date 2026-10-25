import type { Reply } from '@apackdev/sdk/events'
import type { OutgoingCodeEvents } from '../contract.ts'
import { answer } from '../answer.ts'
import { broadcastToSurface } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { assign, setup } from 'xstate'

import { FileSystemRepository } from '../services/filesystem.ts'
import { GitWatcherService } from '../services/gitwatcher.ts'
import type { FileChangeInfo } from '../services/gitwatcher.ts'

const surfaceId = 'code' as const

function requireRepository(context: CodeExplorerSystemContext, path: string, reply: Reply<OutgoingCodeEvents> | undefined): context is CodeExplorerSystemContext & { repository: FileSystemRepository } {
  if (!context.repository) {
    answer(reply, {
      type: 'explorer.CODE_ERROR',
      data: {
        code: 'INVALID_PATH',
        message: 'No directory selected.',
        path,
      },
    })
    return false
  }
  return true
}

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeExplorerSystemContext {
  baseDirectory: string | null
  repository: FileSystemRepository | null
  gitWatcher: GitWatcherService | null
}

export type Event =
  | { type: 'explorer.LIST_FILES'; path: string }
  | { type: 'explorer.READ_FILE'; path: string }
  | { type: 'explorer.WRITE_FILE'; path: string; content: string }
  | { type: 'explorer.CREATE_FILE'; path: string; content?: string }
  | { type: 'explorer.DELETE_FILE'; path: string }
  | { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'explorer.CREATE_DIRECTORY'; path: string }
  | { type: 'explorer.GET_FILE_INFO'; path: string }
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
  | { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string; gitWatcher: GitWatcherService | null }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.MOVE_FILES'; sourcePaths: string[]; targetDir: string }
  | { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }
  | { type: 'explorer.FILE_CHANGE_CALLBACK'; change: FileChangeInfo }
  | { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
  | { type: 'CODE_CONNECTED' };

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeExplorerSystemContext, Event>();

export const explorerSystem = setup({
  types: {
    context: {} as CodeExplorerSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitWatcher?: GitWatcherService | null }
  },
  actions: handlers.actions({
    setupFileWatcher: ({ context, self }) => {
      // Set up the callback for file changes from git watcher
      if (context.gitWatcher) {
        context.gitWatcher.setFileChangeCallback((change: FileChangeInfo) => {
          self.send({ type: 'explorer.FILE_CHANGE_CALLBACK', change })
        })
      }
    },

    handleFileChange: ({ event }) => {
      const ev = event as { type: 'explorer.FILE_CHANGE_CALLBACK'; change: FileChangeInfo }

      broadcastToSurface(surfaceId, {
        type: 'explorer.FILE_CHANGED_EXTERNALLY',
        data: ev.change
      })
    },

    sendBaseDirectoryInfo: ({ context, reply }) => {
      // Send base directory listing on connect
      if (context.baseDirectory && context.repository) {
        context.repository.listDirectory(context.baseDirectory).then(content => {
          answer(reply, {
            type: 'explorer.FILES_LISTED',
            data: content,
          })
        }).catch(() => {
          // Ignore errors on connect
        })
      }
    },

    listFiles: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.LIST_FILES'; path: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        const path = ev.path || context.baseDirectory || ''
        const content = await context.repository.listDirectory(path)
        answer(reply, {
          type: 'explorer.FILES_LISTED',
          data: content,
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    readFile: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.READ_FILE'; path: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        const content = await context.repository.readFile(ev.path)
        answer(reply, {
          type: 'explorer.FILE_CONTENT',
          data: content,
        })

        // Register file with git watcher for external change detection
        if (context.gitWatcher) {
          context.gitWatcher.registerOpenFile(ev.path)
        }
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    writeFile: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.WRITE_FILE'; path: string; content: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        await context.repository.writeFile(ev.path, ev.content)
        answer(reply, {
          type: 'explorer.FILE_SAVED',
          data: { path: ev.path },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    createFile: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.CREATE_FILE'; path: string; content?: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        await context.repository.writeFile(ev.path, ev.content || '')
        answer(reply, {
          type: 'explorer.FILE_CREATED',
          data: { path: ev.path },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    deleteFile: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.DELETE_FILE'; path: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        await context.repository.deleteFile(ev.path)
        answer(reply, {
          type: 'explorer.FILE_DELETED',
          data: { path: ev.path },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    renameFile: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }

      if (!requireRepository(context, ev.oldPath, reply)) return

      try {
        await context.repository.renameFile(ev.oldPath, ev.newPath)
        answer(reply, {
          type: 'explorer.FILE_RENAMED',
          data: { oldPath: ev.oldPath, newPath: ev.newPath },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    createDirectory: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.CREATE_DIRECTORY'; path: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        await context.repository.createDirectory(ev.path)
        answer(reply, {
          type: 'explorer.DIRECTORY_CREATED',
          data: { path: ev.path },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    getFileInfo: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.GET_FILE_INFO'; path: string }

      if (!requireRepository(context, ev.path, reply)) return

      try {
        const info = await context.repository.getFileInfo(ev.path)
        answer(reply, {
          type: 'explorer.FILE_INFO',
          data: info,
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    setBaseDirectory: () => {
      // No longer need to send active directory info
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
        const ev = event as { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string; gitWatcher: GitWatcherService | null }
        return ev.path
      },
      repository: ({ event }) => {
        const ev = event as { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string; gitWatcher: GitWatcherService | null }
        return new FileSystemRepository(ev.path)
      },
      gitWatcher: ({ event }) => {
        const ev = event as { type: 'explorer.UPDATE_BASE_DIRECTORY'; path: string; gitWatcher: GitWatcherService | null }
        return ev.gitWatcher
      }
    }),

    closeFile: ({ event, context }) => {
      const ev = event as { type: 'explorer.CLOSE_FILE'; path: string }
      // Unregister file from git watcher when closed
      if (context.gitWatcher) {
        context.gitWatcher.unregisterOpenFile(ev.path)
      }
    },

    quickOpenSearch: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }

      if (!requireRepository(context, ev.baseDirectory, reply)) return

      try {
        const files = await context.repository.getAllFiles(ev.baseDirectory)
        answer(reply, {
          type: 'explorer.QUICK_OPEN_RESULTS',
          data: files,
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: ev.baseDirectory,
          },
        })
      }
    },

    moveFiles: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.MOVE_FILES'; sourcePaths: string[]; targetDir: string }

      if (!requireRepository(context, ev.targetDir, reply)) return

      try {
        const movedPaths: string[] = []
        for (const sourcePath of ev.sourcePaths) {
          const destPath = await context.repository.moveFile(sourcePath, ev.targetDir)
          movedPaths.push(destPath)
          // Unregister old path from watcher to prevent stale FILE_CHANGED_EXTERNALLY events
          if (context.gitWatcher) {
            context.gitWatcher.unregisterOpenFile(sourcePath)
          }
        }

        answer(reply, {
          type: 'explorer.FILES_MOVED',
          data: { sourcePaths: ev.sourcePaths, targetDir: ev.targetDir, movedPaths },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    copyFiles: async ({ event, context, reply }) => {
      const ev = event as { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }

      if (!requireRepository(context, ev.targetDir, reply)) return

      try {
        const copiedPaths: string[] = []
        for (const sourcePath of ev.sourcePaths) {
          const destPath = await context.repository.copyFileInto(sourcePath, ev.targetDir)
          copiedPaths.push(destPath)
        }

        answer(reply, {
          type: 'explorer.FILES_COPIED',
          data: { targetDir: ev.targetDir, copiedPaths },
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },

    listBaseFiles: async ({ context, reply }) => {
      if (!requireRepository(context, context.baseDirectory || '', reply)) return

      try {
        const path = context.baseDirectory || ''
        const content = await context.repository.listDirectory(path)
        answer(reply, {
          type: 'explorer.FILES_LISTED',
          data: content,
        })
      } catch (error: any) {
        answer(reply, {
          type: 'explorer.CODE_ERROR',
          data: {
            code: error.code || 'IO_ERROR',
            message: error.message,
            path: error.path,
          },
        })
      }
    },
  })
}).createMachine({
  id: 'explorer',
  initial: 'idle',
  context: ({ input }: { input?: { baseDirectory: string | null; gitWatcher?: GitWatcherService | null } }) => {
    const baseDir = input?.baseDirectory || null
    return {
      baseDirectory: baseDir,
      repository: baseDir ? new FileSystemRepository(baseDir) : null,
      gitWatcher: input?.gitWatcher || null,
    }
  },
  entry: 'setupFileWatcher',
  states: {
    idle: {
      on: {
        'CODE_CONNECTED': {
          actions: 'sendBaseDirectoryInfo'
        },
        'explorer.LIST_FILES': {
          actions: 'listFiles'
        },
        'explorer.READ_FILE': {
          actions: 'readFile'
        },
        'explorer.WRITE_FILE': {
          actions: 'writeFile'
        },
        'explorer.CREATE_FILE': {
          actions: 'createFile'
        },
        'explorer.DELETE_FILE': {
          actions: 'deleteFile'
        },
        'explorer.RENAME_FILE': {
          actions: 'renameFile'
        },
        'explorer.CREATE_DIRECTORY': {
          actions: 'createDirectory'
        },
        'explorer.GET_FILE_INFO': {
          actions: 'getFileInfo'
        },
        'explorer.SET_BASE_DIRECTORY': {
          actions: ['assignBaseDirectory', 'setBaseDirectory']
        },
        'explorer.MOVE_FILES': {
          actions: 'moveFiles'
        },
        'explorer.COPY_FILES': {
          actions: 'copyFiles'
        },
        'explorer.UPDATE_BASE_DIRECTORY': {
          actions: ['updateBaseDirectory', 'setupFileWatcher', 'listBaseFiles']
        },
        'explorer.CLOSE_FILE': {
          actions: 'closeFile'
        },
        'explorer.FILE_CHANGE_CALLBACK': {
          actions: 'handleFileChange'
        },
        'explorer.QUICK_OPEN_SEARCH': {
          actions: 'quickOpenSearch'
        }
      }
    }
  }
})