import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent } from '../../utils/parent-communication.ts';
import { removeTabs, renameInTabViewHistory } from '../../utils/tab-management.ts';
import { addRecentFile } from '../../utils/recent-files.ts';
import { imageExtensions, videoExtensions } from '../../utils/file-icons.ts';

// File types
export interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: Date
  extension?: string
}

export interface DirectoryContent {
  path: string
  files: FileInfo[]
}

export interface FileContent {
  path: string
  content: string
  encoding: string
}

// File watching types
export interface FileChangeInfo {
  path: string
  modifiedAt: Date
  changeType: 'add' | 'change' | 'unlink'
}

/** Derive parent directory path from a file/folder path */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export interface CodeExplorerContext {
  rootFiles: FileInfo[]
  expandedDirs: Set<string>
  dirContents: Record<string, FileInfo[]>
  loadingDirs: Set<string>
  selectedPaths: string[]
  revealPath: string | null
  pendingEditorMode: Map<string, 'richText' | 'plainText'>
}

function emptyTreeState(): CodeExplorerContext {
  return {
    rootFiles: [], expandedDirs: new Set(), dirContents: {}, loadingDirs: new Set(),
    selectedPaths: [], revealPath: null, pendingEditorMode: new Map(),
  }
}

// Quick open types
export interface QuickOpenResult {
  path: string
  relativePath: string
  name: string
  type: 'file' | 'directory'
  extension?: string
  score?: number
}

export type Event =
  | { type: 'explorer.LIST_FILES'; path: string }
  | { type: 'explorer.CREATE_FILE'; name: string }
  | { type: 'explorer.CREATE_DIRECTORY'; path: string }
  | { type: 'explorer.DELETE_FILE'; path: string }
  | { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'explorer.OPEN_FILE'; path: string; editorMode?: 'richText' | 'plainText' }
  | { type: 'explorer.OPEN_FILES'; paths: string[] }
  | { type: 'explorer.WRITE_FILE'; path: string; content: string }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
  | { type: 'explorer.FILES_LISTED'; data: { path: string; files: FileInfo[] } }
  | { type: 'explorer.FILE_DELETED'; data: { path: string } }
  | { type: 'explorer.FILE_RENAMED'; data: { oldPath: string; newPath: string } }
  | { type: 'explorer.DIRECTORY_CREATED'; data: { path: string } }
  | { type: 'explorer.ERROR'; message: string }
  // Tree view events
  | { type: 'explorer.EXPAND_DIRECTORY'; path: string }
  | { type: 'explorer.COLLAPSE_DIRECTORY'; path: string }
  | { type: 'explorer.SELECT_ITEMS'; paths: string[] }
  | { type: 'explorer.MOVE_ITEMS'; sourcePaths: string[]; targetDir: string }
  // Backend events that affect file state
  | { type: 'explorer.FILE_CONTENT'; data: { path: string; content: string; encoding: string } }
  | { type: 'explorer.FILE_SAVED'; data: { path: string } }
  | { type: 'explorer.FILE_CHANGED_EXTERNALLY'; data: { path: string; modifiedAt: Date; changeType: 'add' | 'change' | 'unlink' } }
  | { type: 'explorer.CODE_ERROR'; data: { message: string; code?: string; path?: string } }
  // Quick open events
  | { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
  | { type: 'explorer.QUICK_OPEN_RESULTS'; data: QuickOpenResult[] }
  // Move/copy results from backend
  | { type: 'explorer.FILES_MOVED'; data: { sourcePaths: string[]; targetDir: string; movedPaths: string[] } }
  | { type: 'explorer.FILES_COPIED'; data: { targetDir: string; copiedPaths: string[] } }
  | { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }
  // Reveal in tree
  | { type: 'explorer.REVEAL_IN_TREE'; path: string }
  | { type: 'explorer.CLEAR_REVEAL' }
  | { type: 'explorer.REFRESH_TREE' }
  // Broadcast events from parent
  | { type: 'CODE_STARTED'; data: { baseDirectory: string | null } };

export const explorerState = setup({
  types: {
    context: {} as CodeExplorerContext,
    events: {} as Event
  },
  actions: {
    setLoading: ({ self }) => {
      updateParentState(self, { isLoading: true, error: null })
    },

    handleFileContent: assign(({ event, context, self }) => {
      const ev = event as { type: 'explorer.FILE_CONTENT'; data: { path: string; content: string; encoding: string; size?: number; isBinary?: boolean } }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const existingFile = openFiles.find((f: any) => f.path === ev.data.path)

      // Determine editor mode: explicit request > setting default
      // Large files (>300KB) skip Tiptap — it struggles with large documents
      const MAX_RICH_TEXT_SIZE = 300 * 1024
      const ext = ev.data.path.split('.').pop()?.toLowerCase() || ''
      const pendingMode = context.pendingEditorMode.get(ev.data.path)
      const mdEditorDefault = parentContext?.settings?.mdEditorDefault ?? false
      const isRichText = pendingMode === 'plainText' ? false
        : (pendingMode === 'richText' || (mdEditorDefault && ext === 'md'))
          && (ev.data.size ?? 0) < MAX_RICH_TEXT_SIZE

      let newPendingMap = context.pendingEditorMode
      if (pendingMode) {
        newPendingMap = new Map(context.pendingEditorMode)
        newPendingMap.delete(ev.data.path)
      }

      // Track the file as recently opened
      const recentlyOpenedFiles = parentContext?.recentlyOpenedFiles || []
      const updatedRecentFiles = addRecentFile(recentlyOpenedFiles, ev.data.path, parentContext?.baseDirectory || '')

      // Build tab data — parent decides preview state via ADD_TAB
      const isImageFile = !existingFile && imageExtensions.includes(ext)
      const isVideoFile = !existingFile && videoExtensions.includes(ext)
      const tab = {
        path: ev.data.path,
        content: ev.data.content,
        originalContent: ev.data.content,
        modified: false,
        isRichText,
        _richTextBaselineSet: false,
        ...(existingFile ? {
          externallyModified: false,
          externalModificationTime: undefined,
          pendingSaveConflict: false,
        } : {}),
        ...(isImageFile && { isImage: true }),
        ...(isVideoFile && { isVideo: true }),
        ...(ev.data.isBinary && { isBinary: true }),
      }
      addTabToParent(self, tab, false, {
        isLoading: false,
        recentlyOpenedFiles: updatedRecentFiles
      })

      self.send({ type: 'explorer.REVEAL_IN_TREE', path: ev.data.path })

      return { pendingEditorMode: newPendingMap }
    }),

    handleFileSaved: ({ event, self }) => {
      const ev = event as { type: 'explorer.FILE_SAVED'; data: { path: string } }
      const parentContext = getParentContext(self)

      const updatedFiles = (parentContext?.openFiles || []).map((f: any) => {
        const matchesPath = f.path === ev.data.path || (f.isDiff && f.gitFile?.path === ev.data.path)
        if (!matchesPath) return f
        return {
          ...f,
          originalContent: f.content,
          modified: false,
          pendingSaveConflict: false,
          externallyModified: false,
          externalModificationTime: undefined
        }
      })

      updateParentState(self, { openFiles: updatedFiles })
    },

    handleFileChangedExternally: ({ event, self }) => {
      const ev = event as { type: 'explorer.FILE_CHANGED_EXTERNALLY'; data: { path: string; modifiedAt: Date; changeType: 'add' | 'change' | 'unlink' } }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const file = openFiles.find((f: any) => f.path === ev.data.path)

      if (file && !file.isDiff) {
        // File was deleted/moved externally — don't try to re-read it
        if (ev.data.changeType === 'unlink') {
          return
        }

        const updatedFiles = openFiles.map((f: any) => {
          if (f.path === ev.data.path && !f.isDiff) {
            return {
              ...f,
              externallyModified: true,
              externalModificationTime: ev.data.modifiedAt,
              pendingSaveConflict: f.modified
            }
          }
          return f
        })

        updateParentState(self, { openFiles: updatedFiles })

        // Only refresh if file is not modified by user
        if (!file.modified) {
          sendToSystem('code', { type: 'explorer.READ_FILE', path: ev.data.path })
        }
      }
    },

    handleCodeError: ({ event, self }) => {
      const ev = event as { type: 'explorer.CODE_ERROR'; data: { message: string; code?: string; path?: string } }

      // A tab restored from storage whose file has since gone: drop the tab rather
      // than leave one that can never load. Pinned tabs are kept by removeTabs.
      if (ev.data.code === 'NOT_FOUND' && ev.data.path) {
        const parentContext = getParentContext(self)
        const openFiles = parentContext?.openFiles ?? []
        if (openFiles.some((f: any) => f.path === ev.data.path)) {
          const result = removeTabs(openFiles, ev.data.path, parentContext.activeFilePath)
          updateParentState(self, { ...result, error: null, isLoading: false })
          return
        }
      }

      updateParentState(self, { error: ev.data.message, isLoading: false })
    },

    listFiles: ({ event }) => {
      const ev = event as { type: 'explorer.LIST_FILES'; path: string }
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: ev.path })
    },

    assignFiles: assign(({ event, context, self }) => {
      const ev = event as { type: 'explorer.FILES_LISTED'; data: { path: string; files: FileInfo[] } }
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''

      updateParentState(self, { isLoading: false, error: null })

      // Remove from loading dirs
      const newLoadingDirs = new Set(context.loadingDirs)
      newLoadingDirs.delete(ev.data.path)

      // If this is the base directory, update rootFiles
      if (ev.data.path === baseDirectory) {
        return {
          rootFiles: ev.data.files,
          dirContents: { ...context.dirContents, [ev.data.path]: ev.data.files },
          loadingDirs: newLoadingDirs,
        }
      }

      // Otherwise, update dirContents cache
      return {
        dirContents: { ...context.dirContents, [ev.data.path]: ev.data.files },
        loadingDirs: newLoadingDirs,
      }
    }),

    deleteFile: ({ event }) => {
      const ev = event as { type: 'explorer.DELETE_FILE'; path: string }
      sendToSystem('code', { type: 'explorer.DELETE_FILE', path: ev.path })
    },

    createDirectory: ({ event }) => {
      const ev = event as { type: 'explorer.CREATE_DIRECTORY'; path: string }
      sendToSystem('code', { type: 'explorer.CREATE_DIRECTORY', path: ev.path })
    },

    renameFile: ({ event }) => {
      const ev = event as { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
      sendToSystem('code', { type: 'explorer.RENAME_FILE', oldPath: ev.oldPath, newPath: ev.newPath })
    },

    assignError: ({ event, self }) => {
      const ev = event as { type: 'explorer.ERROR'; message: string }
      updateParentState(self, { error: ev.message, isLoading: false })
    },

    handleCodeConnected: assign(({ event, self }) => {
      const ev = event as { type: 'CODE_STARTED'; data: { baseDirectory: string | null } }
      updateParentState(self, { baseDirectory: ev.data.baseDirectory })
      if (ev.data.baseDirectory) {
        sendToSystem('code', { type: 'explorer.LIST_FILES', path: ev.data.baseDirectory })
      }
      return emptyTreeState()
    }),

    openFile: assign(({ event, context }) => {
      const ev = event as { type: 'explorer.OPEN_FILE'; path: string; editorMode?: 'richText' | 'plainText' }
      sendToSystem('code', { type: 'explorer.READ_FILE', path: ev.path })
      if (ev.editorMode) {
        const newMap = new Map(context.pendingEditorMode)
        newMap.set(ev.path, ev.editorMode)
        return { pendingEditorMode: newMap }
      }
      return {}
    }),

    openFiles: enqueueActions(({ enqueue, event }) => {
      const ev = event as { type: 'explorer.OPEN_FILES'; paths: string[] }
      ev.paths.forEach(path => {
        enqueue(({ self }) => {
          self.send({ type: 'explorer.OPEN_FILE', path })
        })
      })
    }),

    setBaseDirectory: assign(({ event, self }) => {
      const ev = event as { type: 'explorer.SET_BASE_DIRECTORY'; path: string }

      // Send SET_BASE_DIRECTORY to the parent code system to update everything
      // (backend's UPDATE_BASE_DIRECTORY handler auto-lists files via listBaseFiles)
      sendToSystem('code', { type: 'SET_BASE_DIRECTORY', path: ev.path })

      // Update parent state
      updateParentState(self, {
        baseDirectory: ev.path
      })

      // Reset tree state
      return emptyTreeState()
    }),

    refreshTree: assign(({ context, self }) => {
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''
      if (!baseDirectory) return {}

      // Re-fetch base directory
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: baseDirectory })

      // Re-fetch all currently expanded directories
      for (const dir of context.expandedDirs) {
        if (dir !== baseDirectory) {
          sendToSystem('code', { type: 'explorer.LIST_FILES', path: dir })
        }
      }

      // Clear cache but keep expandedDirs so tree stays open
      const loadingDirs = new Set(context.expandedDirs)
      loadingDirs.add(baseDirectory)

      return {
        dirContents: {} as Record<string, FileInfo[]>,
        loadingDirs,
      }
    }),

    expandDirectory: assign(({ event, context }) => {
      const ev = event as { type: 'explorer.EXPAND_DIRECTORY'; path: string }
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.add(ev.path)

      // If we already have cached contents, just expand
      if (context.dirContents[ev.path]) {
        return { expandedDirs: newExpanded }
      }

      // Otherwise, fetch contents
      const newLoading = new Set(context.loadingDirs)
      newLoading.add(ev.path)
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: ev.path })

      return {
        expandedDirs: newExpanded,
        loadingDirs: newLoading,
      }
    }),

    collapseDirectory: assign(({ event, context }) => {
      const ev = event as { type: 'explorer.COLLAPSE_DIRECTORY'; path: string }
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.delete(ev.path)
      return { expandedDirs: newExpanded }
    }),

    selectItems: assign(({ event }) => {
      const ev = event as { type: 'explorer.SELECT_ITEMS'; paths: string[] }
      return { selectedPaths: ev.paths }
    }),

    moveItems: ({ event }) => {
      const ev = event as { type: 'explorer.MOVE_ITEMS'; sourcePaths: string[]; targetDir: string }
      sendToSystem('code', { type: 'explorer.MOVE_FILES', sourcePaths: ev.sourcePaths, targetDir: ev.targetDir })
    },

    copyFiles: ({ event }) => {
      const ev = event as { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }
      sendToSystem('code', { type: 'explorer.COPY_FILES', sourcePaths: ev.sourcePaths, targetDir: ev.targetDir })
    },

    handleFilesCopied: assign(({ event }) => {
      const ev = event as { type: 'explorer.FILES_COPIED'; data: { targetDir: string; copiedPaths: string[] } }
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: ev.data.targetDir })
      return { selectedPaths: [] as string[] }
    }),

    handleFilesMoved: assign(({ event }) => {
      const ev = event as { type: 'explorer.FILES_MOVED'; data: { sourcePaths: string[]; targetDir: string; movedPaths: string[] } }

      // Refresh the target directory
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: ev.data.targetDir })

      // Refresh all unique source parent directories
      const sourceParentDirs = new Set(ev.data.sourcePaths.map(getParentDir))
      sourceParentDirs.forEach(dir => {
        sendToSystem('code', { type: 'explorer.LIST_FILES', path: dir })
      })

      // Clear selection
      return { selectedPaths: [] as string[] }
    }),

    handleFileDeleted: ({ event, self }) => {
      const ev = event as { type: 'explorer.FILE_DELETED'; data: { path: string } }
      const parentContext = getParentContext(self)

      // Refresh the parent directory of the deleted file
      const parentDir = getParentDir(ev.data.path)
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: parentDir })

      // Remove from open files if it's open
      if (parentContext?.openFiles?.find((f: any) => f.path === ev.data.path)) {
        const result = removeTabs(
          parentContext.openFiles,
          ev.data.path,
          parentContext.activeFilePath
        )

        updateParentState(self, result)
      }
    },

    handleFileRenamed: ({ event, self }) => {
      const ev = event as { type: 'explorer.FILE_RENAMED'; data: { oldPath: string; newPath: string } }
      const parentContext = getParentContext(self)

      // Refresh the parent directory of the renamed file
      const parentDir = getParentDir(ev.data.oldPath)
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: parentDir })

      // If renamed to a different directory, also refresh that
      const newParentDir = getParentDir(ev.data.newPath)
      if (newParentDir !== parentDir) {
        sendToSystem('code', { type: 'explorer.LIST_FILES', path: newParentDir })
      }

      // Update open files if renamed file is open
      const openFiles = parentContext?.openFiles || []
      const hasRenamedFile = openFiles.some((f: any) => f.path === ev.data.oldPath)

      if (hasRenamedFile) {
        const newOpenFiles = openFiles.map((f: any) =>
          f.path === ev.data.oldPath ? { ...f, path: ev.data.newPath } : f
        )
        const newActiveFile = parentContext.activeFilePath === ev.data.oldPath
          ? ev.data.newPath
          : parentContext.activeFilePath

        updateParentState(self, {
          openFiles: newOpenFiles,
          activeFilePath: newActiveFile,
          tabViewHistory: renameInTabViewHistory(parentContext?.tabViewHistory || [], ev.data.oldPath, ev.data.newPath)
        })
      }
    },

    handleDirectoryCreated: assign(({ event, context }) => {
      const ev = event as { type: 'explorer.DIRECTORY_CREATED'; data: { path: string } }

      // Refresh the parent directory to show the new directory
      const parentDir = getParentDir(ev.data.path)
      sendToSystem('code', { type: 'explorer.LIST_FILES', path: parentDir })

      // Expand parent so the new folder is visible, select it, and mark for rename
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.add(parentDir)

      return {
        expandedDirs: newExpanded,
        selectedPaths: [ev.data.path],
      }
    }),

    writeFile: ({ event }) => {
      const ev = event as { type: 'explorer.WRITE_FILE'; path: string; content: string }
      sendToSystem('code', { type: 'explorer.WRITE_FILE', path: ev.path, content: ev.content })
    },

    closeFile: ({ event }) => {
      const ev = event as { type: 'explorer.CLOSE_FILE'; path: string }
      sendToSystem('code', { type: 'explorer.CLOSE_FILE', path: ev.path })
    },

    quickOpenSearch: ({ event }) => {
      const ev = event as { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
      sendToSystem('code', { type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: ev.baseDirectory })
    },

    handleQuickOpenResults: ({ event, self }) => {
      const ev = event as { type: 'explorer.QUICK_OPEN_RESULTS'; data: QuickOpenResult[] }
      updateParentState(self, {
        quickOpenResults: ev.data,
        quickOpenLoading: false
      })
    },

    revealInTree: assign(({ event, context, self }) => {
      const ev = event as { type: 'explorer.REVEAL_IN_TREE'; path: string }
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''

      // Compute ancestor directory paths between baseDirectory and the file
      const ancestors: string[] = []
      let current = getParentDir(ev.path)
      while (current.length >= baseDirectory.length && current !== '') {
        ancestors.push(current)
        if (current === baseDirectory) break
        current = getParentDir(current)
      }

      const newExpanded = new Set(context.expandedDirs)
      const newLoading = new Set(context.loadingDirs)

      for (const dir of ancestors) {
        newExpanded.add(dir)
        if (!context.dirContents[dir]) {
          newLoading.add(dir)
          sendToSystem('code', { type: 'explorer.LIST_FILES', path: dir })
        }
      }

      return {
        expandedDirs: newExpanded,
        loadingDirs: newLoading,
        selectedPaths: [ev.path],
        revealPath: ev.path,
      }
    }),

    clearReveal: assign({ revealPath: null }),
  }
}).createMachine({
  id: 'explorer',
  initial: 'idle',
  context: emptyTreeState,
  states: {
    idle: {
      on: {
        'CODE_STARTED': {
          actions: 'handleCodeConnected'
        },
        'explorer.REFRESH_TREE': {
          actions: 'refreshTree'
        },
        'explorer.LIST_FILES': {
          actions: ['setLoading', 'listFiles']
        },
        'explorer.FILES_LISTED': {
          actions: 'assignFiles'
        },
        'explorer.DELETE_FILE': {
          actions: 'deleteFile'
        },
        'explorer.CREATE_DIRECTORY': {
          actions: 'createDirectory'
        },
        'explorer.RENAME_FILE': {
          actions: 'renameFile'
        },
        'explorer.OPEN_FILE': {
          actions: 'openFile'
        },
        'explorer.OPEN_FILES': {
          actions: 'openFiles'
        },
        'explorer.SET_BASE_DIRECTORY': {
          actions: 'setBaseDirectory'
        },
        'explorer.EXPAND_DIRECTORY': {
          actions: 'expandDirectory'
        },
        'explorer.COLLAPSE_DIRECTORY': {
          actions: 'collapseDirectory'
        },
        'explorer.SELECT_ITEMS': {
          actions: 'selectItems'
        },
        'explorer.MOVE_ITEMS': {
          actions: 'moveItems'
        },
        'explorer.FILES_MOVED': {
          actions: 'handleFilesMoved'
        },
        'explorer.COPY_FILES': {
          actions: 'copyFiles'
        },
        'explorer.FILES_COPIED': {
          actions: 'handleFilesCopied'
        },
        'explorer.FILE_DELETED': {
          actions: 'handleFileDeleted'
        },
        'explorer.FILE_RENAMED': {
          actions: 'handleFileRenamed'
        },
        'explorer.DIRECTORY_CREATED': {
          actions: 'handleDirectoryCreated'
        },
        'explorer.ERROR': {
          actions: 'assignError'
        },
        // Handle backend events
        'explorer.FILE_CONTENT': {
          actions: 'handleFileContent'
        },
        'explorer.FILE_SAVED': {
          actions: 'handleFileSaved'
        },
        'explorer.FILE_CHANGED_EXTERNALLY': {
          actions: 'handleFileChangedExternally'
        },
        'explorer.CODE_ERROR': {
          actions: 'handleCodeError'
        },
        'explorer.WRITE_FILE': {
          actions: 'writeFile'
        },
        'explorer.CLOSE_FILE': {
          actions: 'closeFile'
        },
        'explorer.QUICK_OPEN_SEARCH': {
          actions: 'quickOpenSearch'
        },
        'explorer.QUICK_OPEN_RESULTS': {
          actions: 'handleQuickOpenResults'
        },
        'explorer.REVEAL_IN_TREE': {
          actions: 'revealInTree'
        },
        'explorer.CLEAR_REVEAL': {
          actions: 'clearReveal'
        }
      }
    }
  }
});

/** The explorer child's actor, as the code surface's components reach it with `codeChild()` */
export type ExplorerActor = ActorRefFrom<typeof explorerState>;
