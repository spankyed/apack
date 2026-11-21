import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { fromAsk, tell } from '#generated/events.ts';
import type { AskFailure } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import { freshKey, makes, type MadeEvent, type MakesEnqueue, type Making } from '@apackdev/sdk/fe';
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
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
  rootFiles: FileInfo[]
  expandedDirs: Set<string>
  dirContents: Record<string, FileInfo[]>
  loadingDirs: Set<string>
  selectedPaths: string[]
  revealPath: string | null
  pendingEditorMode: Map<string, 'richText' | 'plainText'>
}

/** The tree with nothing read. The asks under way are not the tree's, and go on as they were */
function emptyTreeState(): Omit<CodeExplorerContext, 'making'> {
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

/** The explorer asks of the code system */
type ExplorerAsks = { [K in Extract<keyof CodeSystemContract['asks'], `explorer.${string}`>]: CodeSystemContract['asks'][K] };

/**
 * The asks this machine makes several of at once, each under the name the machine makes it by. A listing is one under
 * way per folder, by the folder's path; every other is made under a key of its own (`freshKey`), so that every one
 * asked for is done
 */
const made = makes(({ each }) => ({
  list: each(fromAsk('code', 'explorer.LIST_FILES')),
  read: each(fromAsk('code', 'explorer.READ_FILE')),
  write: each(fromAsk('code', 'explorer.WRITE_FILE')),
  delete: each(fromAsk('code', 'explorer.DELETE_FILE')),
  rename: each(fromAsk('code', 'explorer.RENAME_FILE')),
  mkdir: each(fromAsk('code', 'explorer.CREATE_DIRECTORY')),
  move: each(fromAsk('code', 'explorer.MOVE_FILES')),
  copy: each(fromAsk('code', 'explorer.COPY_FILES')),
}));

/** The name an ask is made under */
type Name = (typeof made.names)[number];

/** How an ask the machine made ended */
type Made = MadeEvent<typeof made>;

/** How the ask made as `N` ended */
type OutcomeOf<N extends Name> = Extract<Made, { type: `made.${N}` }> extends { outcome: infer Outcome } ? Outcome : never;

/** What the ask made as `N` is answered with */
type AnswerOf<N extends Name> = OutcomeOf<N> extends infer Outcome ? (Outcome extends { ok: true; value: infer Answer } ? Answer : never) : never;

export type Event =
  | { type: 'explorer.LIST_FILES'; path: string }
  | { type: 'explorer.CREATE_DIRECTORY'; path: string }
  | { type: 'explorer.DELETE_FILE'; path: string }
  | { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'explorer.OPEN_FILE'; path: string; editorMode?: 'richText' | 'plainText' }
  | { type: 'explorer.OPEN_FILES'; paths: string[] }
  | { type: 'explorer.WRITE_FILE'; path: string; content: string }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
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
  // How each ask this machine made ended
  | Made;

const typeOf = safeEvents<Event>();

/** Asks for a folder's listing, in place of one under way for that folder */
function askForListing(enqueue: MakesEnqueue, path: string): void {
  made.make(enqueue, 'list', path, { path })
}

/** How the ask an event ends ended; throws for an event that ends none, which is an action on the wrong transition */
function outcomeIn(event: Event): OutcomeOf<Name> {
  if (!('outcome' in event)) throw new Error(`Expected the end of an ask, got ${event.type}`)
  return event.outcome
}

/** The answer an ask ended with, for an action its transition runs only when it was answered (`answered`) */
function answerIn<N extends Name>(name: N, event: Event): AnswerOf<N> {
  const outcome = outcomeIn(event)
  if (event.type !== `made.${name}` || !outcome.ok) throw new Error(`Expected the answer to a ${name} ask, got ${event.type}`)
  return outcome.value as AnswerOf<N>
}

/** Why a file ask was not done: a file failure says which path and how, any other only says */
type FileAskFailure = AskFailure<ExplorerAsks['explorer.READ_FILE']>;

export const explorerState = setup({
  types: {
    context: {} as CodeExplorerContext,
    events: {} as Event
  },
  actors: {
    ...made.actors,
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

    /** A listing that was not done leaves its folder unmarked as loading, as an answered one does: the folder is the one it was asked for, since a failure need not name a path */
    listingEnded: assign(({ context, event }) => {
      const path = typeOf('made.list', event).key
      if (outcomeIn(event).ok || !context.loadingDirs.has(path)) return {}
      const loadingDirs = new Set(context.loadingDirs)
      loadingDirs.delete(path)
      return { loadingDirs }
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
          made.make(enqueue, 'read', freshKey(), { path: ev.data.path })
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
      askForListing(enqueue, typeOf('explorer.LIST_FILES', event).path)
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
      made.make(enqueue, 'delete', freshKey(), { path: typeOf('explorer.DELETE_FILE', event).path })
    }),

    createDirectory: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'mkdir', freshKey(), { path: typeOf('explorer.CREATE_DIRECTORY', event).path })
    }),

    renameFile: enqueueActions(({ event, enqueue }) => {
      const { oldPath, newPath } = typeOf('explorer.RENAME_FILE', event)
      made.make(enqueue, 'rename', freshKey(), { oldPath, newPath })
    }),

    handleCodeConnected: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('CODE_STARTED', event)
      updateParentState(self, { baseDirectory: ev.data.baseDirectory })
      enqueue.assign(emptyTreeState())
      if (ev.data.baseDirectory) {
        askForListing(enqueue, ev.data.baseDirectory)
      }
    }),

    openFile: enqueueActions(({ event, context, enqueue }) => {
      const ev = typeOf('explorer.OPEN_FILE', event)
      made.make(enqueue, 'read', freshKey(), { path: ev.path })
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
      tell('code', { type: 'SET_BASE_DIRECTORY', path: ev.path })

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
      askForListing(enqueue, baseDirectory)

      // Re-fetch all currently expanded directories
      for (const dir of context.expandedDirs) {
        if (dir !== baseDirectory) {
          askForListing(enqueue, dir)
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
      askForListing(enqueue, ev.path)

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
      made.make(enqueue, 'move', freshKey(), { sourcePaths, targetDir })
    }),

    copyFiles: enqueueActions(({ event, enqueue }) => {
      const { sourcePaths, targetDir } = typeOf('explorer.COPY_FILES', event)
      made.make(enqueue, 'copy', freshKey(), { sourcePaths, targetDir })
    }),

    handleFilesCopied: enqueueActions(({ event, enqueue }) => {
      askForListing(enqueue, answerIn('copy', event).targetDir)
      enqueue.assign({ selectedPaths: [] })
    }),

    handleFilesMoved: enqueueActions(({ event, enqueue }) => {
      const moved = answerIn('move', event)

      // Refresh the target directory
      askForListing(enqueue, moved.targetDir)

      // Refresh all unique source parent directories
      const sourceParentDirs = new Set(moved.sourcePaths.map(getParentDir))
      sourceParentDirs.forEach(dir => {
        askForListing(enqueue, dir)
      })

      // Clear selection
      enqueue.assign({ selectedPaths: [] })
    }),

    handleFileDeleted: enqueueActions(({ event, self, enqueue }) => {
      const ev = { data: answerIn('delete', event) }
      const parentContext = getParentContext(self)

      // Refresh the parent directory of the deleted file
      const parentDir = getParentDir(ev.data.path)
      askForListing(enqueue, parentDir)

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
      askForListing(enqueue, parentDir)

      // If renamed to a different directory, also refresh that
      const newParentDir = getParentDir(ev.data.newPath)
      if (newParentDir !== parentDir) {
        askForListing(enqueue, newParentDir)
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
      askForListing(enqueue, parentDir)

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
      made.make(enqueue, 'write', freshKey(), { path, content })
    }),

    closeFile: ({ event }) => {
      tell('code', { type: 'explorer.CLOSE_FILE', path: typeOf('explorer.CLOSE_FILE', event).path })
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
          askForListing(enqueue, dir)
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
  context: () => ({ making: made.none(), ...emptyTreeState() }),
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
    // How each ask ended: its answer taken, or its failure shown
    [made.done]: { actions: made.settle() },
    'made.list': [
      { guard: 'answered', actions: ['assignFiles', 'listingEnded'] },
      { actions: ['handleCodeError', 'listingEnded'] },
    ],
    'made.read': [
      { guard: 'answered', actions: 'handleFileContent' },
      { actions: 'handleCodeError' },
    ],
    'made.write': [
      { guard: 'answered', actions: 'handleFileSaved' },
      { actions: 'handleCodeError' },
    ],
    'made.delete': [
      { guard: 'answered', actions: 'handleFileDeleted' },
      { actions: 'handleCodeError' },
    ],
    'made.rename': [
      { guard: 'answered', actions: 'handleFileRenamed' },
      { actions: 'handleCodeError' },
    ],
    'made.mkdir': [
      { guard: 'answered', actions: 'handleDirectoryCreated' },
      { actions: 'handleCodeError' },
    ],
    'made.move': [
      { guard: 'answered', actions: 'handleFilesMoved' },
      { actions: 'handleCodeError' },
    ],
    'made.copy': [
      { guard: 'answered', actions: 'handleFilesCopied' },
      { actions: 'handleCodeError' },
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
              : { error: event.output.failure.message, quickOpenLoading: false })
          },
        },
      },
    },
  }
});

/** The explorer child's actor, as the code surface's components reach it with `codeChild()` */
export type ExplorerActor = ActorRefFrom<typeof explorerState>;
