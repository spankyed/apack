import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { fromAsk, sendToSystem } from '#generated/events.ts';
import type { AnswerPayload, AskFailure, AskOutcome } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { Contract as CodeSystemContract } from '#features/code/be/contract.ts';
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
  /** The folder each listing under way was asked for, by the id its ask was spawned under */
  listings: Record<string, string>
  selectedPaths: string[]
  revealPath: string | null
  pendingEditorMode: Map<string, 'richText' | 'plainText'>
}

function emptyTreeState(): CodeExplorerContext {
  return {
    rootFiles: [], expandedDirs: new Set(), dirContents: {}, loadingDirs: new Set(), listings: {},
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

/** The explorer asks of the code system */
type ExplorerAsks = { [K in Extract<keyof CodeSystemContract['asks'], `explorer.${string}`>]: CodeSystemContract['asks'][K] };

/**
 * The asks this machine makes several of at once, by the name each is spawned under: a spawned ask's id is
 * `<name>.<n>`, so its answer arrives as `xstate.done.actor.<name>.<n>` and a transition names the kind it is about
 */
type SpawnedAsks = {
  list: 'explorer.LIST_FILES'
  read: 'explorer.READ_FILE'
  write: 'explorer.WRITE_FILE'
  delete: 'explorer.DELETE_FILE'
  rename: 'explorer.RENAME_FILE'
  mkdir: 'explorer.CREATE_DIRECTORY'
  move: 'explorer.MOVE_FILES'
  copy: 'explorer.COPY_FILES'
};

/** How a spawned ask ended, as the event its actor finishes with */
type AskEnded = {
  [Name in keyof SpawnedAsks]: { type: `xstate.done.actor.${Name}.${string}`; output: AskOutcome<ExplorerAsks[SpawnedAsks[Name]]>; actorId: string }
}[keyof SpawnedAsks];

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
  | { type: 'explorer.ERROR'; message: string }
  // Tree view events
  | { type: 'explorer.EXPAND_DIRECTORY'; path: string }
  | { type: 'explorer.COLLAPSE_DIRECTORY'; path: string }
  | { type: 'explorer.SELECT_ITEMS'; paths: string[] }
  | { type: 'explorer.MOVE_ITEMS'; sourcePaths: string[]; targetDir: string }
  // Backend events that affect file state
  | { type: 'explorer.FILE_CHANGED_EXTERNALLY'; data: { path: string; modifiedAt: Date; changeType: 'add' | 'change' | 'unlink' } }
  // Quick open events
  | { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
  | { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }
  // Reveal in tree
  | { type: 'explorer.REVEAL_IN_TREE'; path: string }
  | { type: 'explorer.CLEAR_REVEAL' }
  | { type: 'explorer.REFRESH_TREE' }
  // What the surface starts from, handed on by the surface
  | { type: 'CODE_STARTED'; data: { baseDirectory: string | null } }
  // How each ask this machine spawned ended
  | AskEnded;

const typeOf = safeEvents<Event>();

/** The id the next ask of a kind is spawned under, which no other ask has */
let spawned = 0;
const askId = <Name extends keyof SpawnedAsks>(name: Name): `${Name}.${number}` => `${name}.${++spawned}`;

/** Records the folder a listing spawned under `id` was asked for */
const listingAsked = (id: string, path: string) => ({ context }: { context: CodeExplorerContext }) =>
  ({ listings: { ...context.listings, [id]: path } })

/** How the spawned ask an event ends ended; throws for an event that ends none, which is an action on the wrong transition */
function outcomeIn(event: Event): AskEnded['output'] {
  if (!('output' in event)) throw new Error(`Expected the end of an ask, got ${event.type}`)
  return event.output
}

/** The answer a spawned ask ended with, for an action its transition runs only when it was answered (`answered`) */
function answerIn<Name extends keyof SpawnedAsks>(name: Name, event: Event): AnswerPayload<ExplorerAsks[SpawnedAsks[Name]]> {
  const outcome = outcomeIn(event)
  if (!event.type.startsWith(`xstate.done.actor.${name}.`) || !outcome.ok) throw new Error(`Expected the answer to a ${name} ask, got ${event.type}`)
  return outcome.value as AnswerPayload<ExplorerAsks[SpawnedAsks[Name]]>
}

/** Why a file ask was not done: a file failure says which path and how, any other only says */
type FileAskFailure = AskFailure<ExplorerAsks['explorer.READ_FILE']>;

export const explorerState = setup({
  types: {
    context: {} as CodeExplorerContext,
    events: {} as Event
  },
  actors: {
    list: fromAsk('code', 'explorer.LIST_FILES'),
    read: fromAsk('code', 'explorer.READ_FILE'),
    write: fromAsk('code', 'explorer.WRITE_FILE'),
    delete: fromAsk('code', 'explorer.DELETE_FILE'),
    rename: fromAsk('code', 'explorer.RENAME_FILE'),
    mkdir: fromAsk('code', 'explorer.CREATE_DIRECTORY'),
    move: fromAsk('code', 'explorer.MOVE_FILES'),
    copy: fromAsk('code', 'explorer.COPY_FILES'),
    findFiles: fromAsk('code', 'explorer.QUICK_OPEN_SEARCH'),
  },
  guards: {
    /** The ask an event ends was answered, rather than refused */
    answered: ({ event }) => outcomeIn(event).ok,
  },
  actions: {
    setLoading: ({ self }) => {
      updateParentState(self, { isLoading: true, error: null })
    },

    /** An ask that ended is no longer this machine's child */
    /**
     * A listing ended: it is no longer one under way, and one that was not done leaves its folder unmarked as loading,
     * as an answered one does. The folder is the one it was asked for, since a failure need not name a path
     */
    listingEnded: assign(({ context, event }) => {
      if (!('actorId' in event) || !(event.actorId in context.listings)) return {}
      const { [event.actorId]: path, ...listings } = context.listings
      if (outcomeIn(event).ok || !context.loadingDirs.has(path!)) return { listings }
      const loadingDirs = new Set(context.loadingDirs)
      loadingDirs.delete(path!)
      return { listings, loadingDirs }
    }),

    forgetAsk: enqueueActions(({ enqueue, event }) => {
      if ('actorId' in event) enqueue.stopChild(event.actorId)
    }),

    handleFileContent: assign(({ event, context, self }) => {
      const ev = { data: answerIn('read', event) }
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
      const ev = { data: answerIn('write', event) }
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

    handleFileChangedExternally: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('explorer.FILE_CHANGED_EXTERNALLY', event)
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
          enqueue.spawnChild('read', { id: askId('read'), input: { path: ev.data.path } })
        }
      }
    }),

    /** An ask that was not done, of whichever kind: shown where the explorer shows its errors */
    handleCodeError: ({ event, self }) => {
      const outcome = outcomeIn(event)
      if (outcome.ok) return
      const failure: FileAskFailure = outcome.failure

      // A tab restored from storage whose file has since gone: drop the tab rather than leave one that can
      // never load. A pinned one goes too — `removeTabs` exempts nothing, deliberately, because pinning is
      // about where a tab sits and not about outliving what it shows, and every caller of it is a subject
      // that is gone.
      if (failure.kind === 'file' && failure.code === 'NOT_FOUND' && failure.path) {
        const parentContext = getParentContext(self)
        const openFiles = parentContext?.openFiles ?? []
        if (openFiles.some((f: any) => f.path === failure.path)) {
          const result = removeTabs(openFiles, failure.path, parentContext.activeFilePath)
          updateParentState(self, { ...result, error: null, isLoading: false })
          return
        }
      }

      updateParentState(self, { error: failure.message, isLoading: false })
    },

    listFiles: enqueueActions(({ event, enqueue }) => {
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: typeOf('explorer.LIST_FILES', event).path } }); enqueue.assign(listingAsked(id, typeOf('explorer.LIST_FILES', event).path)) }
    }),

    assignFiles: assign(({ event, context, self }) => {
      const ev = { data: answerIn('list', event) }
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

    deleteFile: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('delete', { id: askId('delete'), input: { path: typeOf('explorer.DELETE_FILE', event).path } })
    }),

    createDirectory: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('mkdir', { id: askId('mkdir'), input: { path: typeOf('explorer.CREATE_DIRECTORY', event).path } })
    }),

    renameFile: enqueueActions(({ event, enqueue }) => {
      const { oldPath, newPath } = typeOf('explorer.RENAME_FILE', event)
      enqueue.spawnChild('rename', { id: askId('rename'), input: { oldPath, newPath } })
    }),

    assignError: ({ event, self }) => {
      updateParentState(self, { error: typeOf('explorer.ERROR', event).message, isLoading: false })
    },

    handleCodeConnected: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('CODE_STARTED', event)
      updateParentState(self, { baseDirectory: ev.data.baseDirectory })
      enqueue.assign(emptyTreeState())
      if (ev.data.baseDirectory) {
        { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: ev.data.baseDirectory } }); enqueue.assign(listingAsked(id, ev.data.baseDirectory)) }
      }
    }),

    openFile: enqueueActions(({ event, context, enqueue }) => {
      const ev = typeOf('explorer.OPEN_FILE', event)
      enqueue.spawnChild('read', { id: askId('read'), input: { path: ev.path } })
      if (ev.editorMode) {
        const newMap = new Map(context.pendingEditorMode)
        newMap.set(ev.path, ev.editorMode)
        enqueue.assign({ pendingEditorMode: newMap })
      }
    }),

    openFiles: enqueueActions(({ enqueue, event }) => {
      typeOf('explorer.OPEN_FILES', event).paths.forEach(path => {
        enqueue(({ self }) => {
          self.send({ type: 'explorer.OPEN_FILE', path })
        })
      })
    }),

    setBaseDirectory: assign(({ event, self }) => {
      const ev = typeOf('explorer.SET_BASE_DIRECTORY', event)

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

    refreshTree: enqueueActions(({ context, self, enqueue }) => {
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''
      if (!baseDirectory) return

      // Re-fetch base directory
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: baseDirectory } }); enqueue.assign(listingAsked(id, baseDirectory)) }

      // Re-fetch all currently expanded directories
      for (const dir of context.expandedDirs) {
        if (dir !== baseDirectory) {
          { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: dir } }); enqueue.assign(listingAsked(id, dir)) }
        }
      }

      // Clear cache but keep expandedDirs so tree stays open
      const loadingDirs = new Set(context.expandedDirs)
      loadingDirs.add(baseDirectory)

      enqueue.assign({
        dirContents: {} as Record<string, FileInfo[]>,
        loadingDirs,
      })
    }),

    expandDirectory: enqueueActions(({ event, context, enqueue }) => {
      const ev = typeOf('explorer.EXPAND_DIRECTORY', event)
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.add(ev.path)

      // If we already have cached contents, just expand
      if (context.dirContents[ev.path]) {
        enqueue.assign({ expandedDirs: newExpanded })
        return
      }

      // Otherwise, fetch contents
      const newLoading = new Set(context.loadingDirs)
      newLoading.add(ev.path)
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: ev.path } }); enqueue.assign(listingAsked(id, ev.path)) }

      enqueue.assign({
        expandedDirs: newExpanded,
        loadingDirs: newLoading,
      })
    }),

    collapseDirectory: assign(({ event, context }) => {
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.delete(typeOf('explorer.COLLAPSE_DIRECTORY', event).path)
      return { expandedDirs: newExpanded }
    }),

    selectItems: assign(({ event }) => ({ selectedPaths: typeOf('explorer.SELECT_ITEMS', event).paths })),

    moveItems: enqueueActions(({ event, enqueue }) => {
      const { sourcePaths, targetDir } = typeOf('explorer.MOVE_ITEMS', event)
      enqueue.spawnChild('move', { id: askId('move'), input: { sourcePaths, targetDir } })
    }),

    copyFiles: enqueueActions(({ event, enqueue }) => {
      const { sourcePaths, targetDir } = typeOf('explorer.COPY_FILES', event)
      enqueue.spawnChild('copy', { id: askId('copy'), input: { sourcePaths, targetDir } })
    }),

    handleFilesCopied: enqueueActions(({ event, enqueue }) => {
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: answerIn('copy', event).targetDir } }); enqueue.assign(listingAsked(id, answerIn('copy', event).targetDir)) }
      enqueue.assign({ selectedPaths: [] })
    }),

    handleFilesMoved: enqueueActions(({ event, enqueue }) => {
      const moved = answerIn('move', event)

      // Refresh the target directory
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: moved.targetDir } }); enqueue.assign(listingAsked(id, moved.targetDir)) }

      // Refresh all unique source parent directories
      const sourceParentDirs = new Set(moved.sourcePaths.map(getParentDir))
      sourceParentDirs.forEach(dir => {
        { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: dir } }); enqueue.assign(listingAsked(id, dir)) }
      })

      // Clear selection
      enqueue.assign({ selectedPaths: [] })
    }),

    handleFileDeleted: enqueueActions(({ event, self, enqueue }) => {
      const ev = { data: answerIn('delete', event) }
      const parentContext = getParentContext(self)

      // Refresh the parent directory of the deleted file
      const parentDir = getParentDir(ev.data.path)
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: parentDir } }); enqueue.assign(listingAsked(id, parentDir)) }

      // Remove from open files if it's open
      if (parentContext?.openFiles?.find((f: any) => f.path === ev.data.path)) {
        const result = removeTabs(
          parentContext.openFiles,
          ev.data.path,
          parentContext.activeFilePath
        )

        updateParentState(self, result)
      }
    }),

    handleFileRenamed: enqueueActions(({ event, self, enqueue }) => {
      const ev = { data: answerIn('rename', event) }
      const parentContext = getParentContext(self)

      // Refresh the parent directory of the renamed file
      const parentDir = getParentDir(ev.data.oldPath)
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: parentDir } }); enqueue.assign(listingAsked(id, parentDir)) }

      // If renamed to a different directory, also refresh that
      const newParentDir = getParentDir(ev.data.newPath)
      if (newParentDir !== parentDir) {
        { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: newParentDir } }); enqueue.assign(listingAsked(id, newParentDir)) }
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
    }),

    handleDirectoryCreated: enqueueActions(({ event, context, enqueue }) => {
      const ev = { data: answerIn('mkdir', event) }

      // Refresh the parent directory to show the new directory
      const parentDir = getParentDir(ev.data.path)
      { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: parentDir } }); enqueue.assign(listingAsked(id, parentDir)) }

      // Expand parent so the new folder is visible, select it, and mark for rename
      const newExpanded = new Set(context.expandedDirs)
      newExpanded.add(parentDir)

      enqueue.assign({
        expandedDirs: newExpanded,
        selectedPaths: [ev.data.path],
      })
    }),

    writeFile: enqueueActions(({ event, enqueue }) => {
      const { path, content } = typeOf('explorer.WRITE_FILE', event)
      enqueue.spawnChild('write', { id: askId('write'), input: { path, content } })
    }),

    closeFile: ({ event }) => {
      sendToSystem('code', { type: 'explorer.CLOSE_FILE', path: typeOf('explorer.CLOSE_FILE', event).path })
    },

    revealInTree: enqueueActions(({ event, context, self, enqueue }) => {
      const ev = typeOf('explorer.REVEAL_IN_TREE', event)
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
          { const id = askId('list'); enqueue.spawnChild('list', { id, input: { path: dir } }); enqueue.assign(listingAsked(id, dir)) }
        }
      }

      enqueue.assign({
        expandedDirs: newExpanded,
        loadingDirs: newLoading,
        selectedPaths: [ev.path],
        revealPath: ev.path,
      })
    }),

    clearReveal: assign({ revealPath: null }),
  }
}).createMachine({
  id: 'explorer',
  initial: 'idle',
  context: emptyTreeState,
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
    'explorer.COPY_FILES': {
      actions: 'copyFiles'
    },
    'explorer.ERROR': {
      actions: 'assignError'
    },
    'explorer.FILE_CHANGED_EXTERNALLY': {
      actions: 'handleFileChangedExternally'
    },
    'explorer.WRITE_FILE': {
      actions: 'writeFile'
    },
    'explorer.CLOSE_FILE': {
      actions: 'closeFile'
    },
    // Entering `findingFiles` again stops the listing under way and starts this one
    'explorer.QUICK_OPEN_SEARCH': {
      target: '.findingFiles', reenter: true
    },
    // How each spawned ask ended: its answer taken, or its failure shown
    'xstate.done.actor.list.*': [
      { guard: 'answered', actions: ['assignFiles', 'listingEnded', 'forgetAsk'] },
      { actions: ['handleCodeError', 'listingEnded', 'forgetAsk'] },
    ],
    'xstate.done.actor.read.*': [
      { guard: 'answered', actions: ['handleFileContent', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.write.*': [
      { guard: 'answered', actions: ['handleFileSaved', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.delete.*': [
      { guard: 'answered', actions: ['handleFileDeleted', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.rename.*': [
      { guard: 'answered', actions: ['handleFileRenamed', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.mkdir.*': [
      { guard: 'answered', actions: ['handleDirectoryCreated', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.move.*': [
      { guard: 'answered', actions: ['handleFilesMoved', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'xstate.done.actor.copy.*': [
      { guard: 'answered', actions: ['handleFilesCopied', 'forgetAsk'] },
      { actions: ['handleCodeError', 'forgetAsk'] },
    ],
    'explorer.REVEAL_IN_TREE': {
      actions: 'revealInTree'
    },
    'explorer.CLEAR_REVEAL': {
      actions: 'clearReveal'
    }
  },
  states: {
    idle: {},
    // Every file under a folder is being listed for quick open, for exactly as long as this state is
    findingFiles: {
      invoke: {
        src: 'findFiles',
        input: ({ event }) => ({ baseDirectory: typeOf('explorer.QUICK_OPEN_SEARCH', event).baseDirectory }),
        onDone: {
          target: 'idle',
          actions: ({ event, self }) => {
            updateParentState(self, event.output.ok
              ? { quickOpenResults: event.output.value, quickOpenLoading: false }
              : { error: event.output.failure.message, isLoading: false })
          },
        },
      },
    },
  }
});

/** The explorer child's actor, as the code surface's components reach it with `codeChild()` */
export type ExplorerActor = ActorRefFrom<typeof explorerState>;
