import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('code'))
import { setup, type ActorRefFrom, type AnyActorRef, assign, enqueueActions } from 'xstate';

import breadcrumb from '@apackdev/sdk/fe';
import { type HotkeyEvent, type HotkeysMap, createHotkeyProcessor } from '@apackdev/sdk/fe';
import { saveOpenTabs, loadPersistedTabs, sortTabsByPinned } from './utils/persisted-tabs.ts';
import { loadRecentFiles, addRecentFile } from './utils/recent-files.ts';
import { pushTabViewHistory, nextActiveFromHistory } from './utils/tab-management.ts';
import { saveTabGroups, loadTabGroups, getNextAvailableColor, type TabGroupColor, type TabGroup } from '@apackdev/sdk/fe';
import { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward } from '@apackdev/sdk/fe';
import type { CodeSettings } from '#generated/types.ts';
import type { ActionTab, CodeContext, CodeInboxEvent, OpenFile, PanelType, PromptTab, TerminalTab } from './contract.ts';
export type { OpenFile, TerminalTab, QuickOpenResult, PanelType } from './contract.ts';
export type { CodeContext } from './contract.ts';
import type { OutgoingCodeEvents } from '#features/code/be/contract.ts';
import { sendToSystem } from '#generated/events.ts';

// Import child state machines
import { explorerState } from './features/explorer/state.ts';
import { searchState } from './features/search/state.ts';
import { commitState } from './features/commit/state.ts';
import { pullRequestState } from './features/pull-request/state.ts';
import { terminalState, type TerminalInfo } from './features/terminal/state.ts';
import { actionsState } from './features/actions/state.ts';
import { promptsState } from './features/prompts/state.ts';
import type { KeyboardShortcut } from '@apackdev/sdk/types';
import { codeChild, routeToCodeChild, CODE_CHILD_IDS } from './features/children.ts';

export const id = 'code' as const;

// Module-level callback for getting editor selection text.
// Set by canvas.vue so the state machine can read Monaco selection without Vue refs.
let _editorSelectionGetter: (() => string) | null = null;
export function setEditorSelectionGetter(getter: (() => string) | null) {
  _editorSelectionGetter = getter;
}

const ALL_PANELS: PanelType[] = ['explorer', 'search', 'commit', 'pr', 'actions', 'prompts'];

/** IDs of terminals currently open as canvas tabs */
function getTabbedTerminalIds(openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[]): Set<string> {
  return new Set(
    openFiles.filter((f: any) => f.isTerminal).map((f: any) => f.terminalInfo.id)
  )
}

/** Unstaged diff tabs are editable (right side = working tree). PR diffs are read-only. */
export function isEditableDiff(file: OpenFile | { isDiff?: boolean; isPrDiff?: boolean; gitFile?: { staged: boolean } }): boolean {
  if ('isPrDiff' in file && file.isPrDiff) return false
  return file.isDiff === true && file.gitFile?.staged === false
}

export type { TabGroupColor, TabGroup };

export type Event =
  | OutgoingCodeEvents
  // The app's, when the code surface's settings change
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: CodeSettings }
  // Generic update event for child actors to update parent state
  | CodeInboxEvent
  | { type: 'ADD_TAB'; tab: any; replacePreview?: boolean; extraUpdates?: Partial<CodeContext> }
  | { type: 'SURFACE_ACTIVATED' }
  | { type: 'SELECT_PANEL'; panel: PanelType }
  // Tab pinning events
  | { type: 'PIN_TAB'; path: string }
  | { type: 'UNPIN_TAB'; path: string }
  | { type: 'PIN_TAB_AT'; path: string; targetPath: string; side: 'left' | 'right' }
  | { type: 'UNPIN_TAB_AT'; path: string; targetPath: string; side: 'left' | 'right' }
  // Tab group events
  | { type: 'CREATE_GROUP'; name: string; tabPaths?: string[] }
  | { type: 'RENAME_GROUP'; groupId: string; name: string }
  | { type: 'CHANGE_GROUP_COLOR'; groupId: string; color: TabGroupColor }
  | { type: 'DELETE_GROUP'; groupId: string; closeTabsInGroup?: boolean }
  | { type: 'TOGGLE_GROUP_COLLAPSE'; groupId: string }
  | { type: 'ADD_TAB_TO_GROUP'; path: string; groupId: string }
  | { type: 'REMOVE_TAB_FROM_GROUP'; path: string }
  | { type: 'REORDER_GROUPS'; fromIndex: number; toIndex: number }
  | { type: 'PIN_GROUP'; groupId: string }
  | { type: 'UNPIN_GROUP'; groupId: string }
  // Hotkey events
  | HotkeyEvent
  | { type: 'OPEN_TERMINAL' }
  | { type: 'OPEN_TERMINAL_TAB' }
  | { type: 'NAVIGATE_PREV_PANEL' }
  | { type: 'NAVIGATE_NEXT_PANEL' }
  | { type: 'FOCUS_SEARCH'; selectedText?: string }
  // Quick open events
  | { type: 'TOGGLE_QUICK_OPEN' }
  | { type: 'SHOW_QUICK_OPEN' }
  | { type: 'HIDE_QUICK_OPEN' }
  | { type: 'UPDATE_QUICK_OPEN_QUERY'; query: string }
  | { type: 'SELECT_QUICK_OPEN_RESULT'; index: number }
  | { type: 'OPEN_QUICK_OPEN_RESULT'; path: string }
  | { type: 'SEARCH_IN_FOLDER'; folder: string }
  | { type: 'SAVE_ACTIVE_FILE' }
  | { type: 'CLOSE_ACTIVE_TAB' }
  | { type: 'CLOSE_TAB'; path: string }
  | { type: 'KILL_TERMINAL'; path: string }
  | { type: 'PROMOTE_PREVIEW_TAB'; path: string }
  // Panel terminal events
  | { type: 'SELECT_PANEL_TERMINAL'; terminalId: string }
  | { type: 'CLOSE_PANEL_TERMINAL' }
  | { type: 'OPEN_TERMINAL_IN_TAB'; terminalId: string }
  | { type: 'MOVE_TERMINAL_TO_PANEL'; path: string }
  | { type: 'TOGGLE_PANEL_TERMINAL' }
  | { type: 'TERMINAL_TAB_INFO_CHANGED'; terminalId: string; changes: Record<string, any> }
  | { type: 'RESTORE_PERSISTED_TABS_SETTLED' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' };

export type CodeState = ActorRefFrom<typeof codeState>;

// Shared tab removal logic (tab removal + group cleanup + explorer notify)
function removeTabLogic(context: CodeContext, self: AnyActorRef, path: string) {
  const file = context.openFiles.find(f => f.path === path)
  const newOpenFiles = context.openFiles.filter(f => f.path !== path)
  const newActiveFilePath = context.activeFilePath === path
    ? nextActiveFromHistory(context.tabViewHistory, newOpenFiles)
    : context.activeFilePath

  const groupId = file && 'groupId' in file ? (file as any).groupId : undefined
  let newTabGroups = context.tabGroups
  if (groupId) {
    const remaining = newOpenFiles.filter(f => 'groupId' in f && (f as any).groupId === groupId)
    if (remaining.length === 0) newTabGroups = context.tabGroups.filter(g => g.id !== groupId)
  }

  const pendingTabOrder = context.pendingTabOrder
    ?.filter(tab => tab.path !== path)
  let pendingPersistedMetadata = context.pendingPersistedMetadata
  if (pendingPersistedMetadata?.has(path)) {
    const next = new Map(pendingPersistedMetadata)
    next.delete(path)
    pendingPersistedMetadata = next.size > 0 ? next : undefined
  }

  codeChild(self, 'explorer')?.send({ type: 'explorer.CLOSE_FILE', path })

  return {
    openFiles: newOpenFiles,
    activeFilePath: newActiveFilePath,
    tabGroups: newTabGroups,
    pendingTabOrder: pendingTabOrder && pendingTabOrder.length > 0 ? pendingTabOrder : undefined,
    pendingPersistedMetadata,
  }
}

// Close tab with terminal confirmation, then remove
function closeTabWithConfirmation(context: CodeContext, self: AnyActorRef, path: string) {
  const file = context.openFiles.find(f => f.path === path)

  if (file && 'isTerminal' in file && (file as any).isTerminal) {
    const confirmClose = context.settings?.confirmTerminalClose ?? true
    if (confirmClose) {
      const terminalInfo = (file as any).terminalInfo
      const name = terminalInfo.customTitle || terminalInfo.cwd.split('/').filter(Boolean).pop() || terminalInfo.title
      if (!confirm(`Close terminal "${name}"?`)) return {}
    }
    if (context.settings?.closeTerminalOnTabClose ?? true) {
      codeChild(self, 'terminal')?.send({ type: 'terminal.CLOSE', terminalId: (file as any).terminalInfo.id })
    }
  }

  return removeTabLogic(context, self, path)
}

// Directory will be loaded from backend EARS store

// Insert a newly-restored tab into its persisted slot. Non-persisted tabs (or
// tabs appearing after all persisted ones have been placed) go to the end.
function insertByPersistedOrder<T extends { path: string }>(
  openFiles: T[],
  newTab: T,
  pendingOrder: Array<{ path: string; order: number }>
): T[] {
  const orderMap = new Map(pendingOrder.map(t => [t.path, t.order]))
  const newOrder = orderMap.get(newTab.path)

  // Not a persisted tab — append at the end (unpinned section).
  if (newOrder === undefined) {
    return [...openFiles, newTab]
  }

  // Find the first existing tab whose persisted order is greater than newTab's.
  const insertAt = openFiles.findIndex(f => {
    const o = orderMap.get(f.path)
    return o !== undefined && o > newOrder
  })

  if (insertAt === -1) {
    return [...openFiles, newTab]
  }

  return [...openFiles.slice(0, insertAt), newTab, ...openFiles.slice(insertAt)]
}

// Helper to check and delete empty groups
function deleteEmptyGroups(
  openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[],
  tabGroups: TabGroup[],
  targetGroupId?: string
): TabGroup[] {
  if (!targetGroupId) return tabGroups

  const remainingTabsInGroup = openFiles.filter(
    f => 'groupId' in f && f.groupId === targetGroupId
  )

  if (remainingTabsInGroup.length === 0) {
    return tabGroups.filter(g => g.id !== targetGroupId)
  }

  return tabGroups
}

function groupIdsForOpenTabs(openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[]): Set<string> {
  return new Set(
    openFiles
      .map(file => ('groupId' in file ? file.groupId : undefined))
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)
  )
}

function pruneEmptyTabGroups(
  openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[],
  tabGroups: TabGroup[]
): TabGroup[] {
  const groupIds = groupIdsForOpenTabs(openFiles)
  return tabGroups.filter(group => groupIds.has(group.id))
}

function prunePersistedTabGroups(
  groups: TabGroup[],
  tabs: Array<{ groupId?: string }>
): TabGroup[] {
  const groupIds = new Set(
    tabs
      .map(tab => tab.groupId)
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)
  )
  return groups.filter(group => groupIds.has(group.id))
}

function persistCodeTabs(context: CodeContext): void {
  const tabGroups = pruneEmptyTabGroups(context.openFiles, context.tabGroups)
  saveOpenTabs(context.openFiles, context.activeFilePath, context.panelTerminalId, context.panelTerminalExpanded)
  saveTabGroups(storage, 'tab-groups', tabGroups)
}

function finalizeRestoreState(context: CodeContext): Partial<CodeContext> {
  if (context.pendingTabOrder === undefined && context.pendingPersistedMetadata === undefined && context.pendingTerminalTabIds === undefined) {
    return {}
  }

  const openPaths = new Set(context.openFiles.map(file => file.path))
  const tabGroups = pruneEmptyTabGroups(context.openFiles, context.tabGroups)
  const activeFilePath = context.activeFilePath && openPaths.has(context.activeFilePath)
    ? context.activeFilePath
    : context.openFiles[0]?.path ?? null

  return {
    pendingTabOrder: undefined,
    pendingPersistedMetadata: undefined,
    pendingTerminalTabIds: undefined,
    tabGroups,
    activeFilePath,
  }
}

const codeState = setup({
  types: {
    context: {} as CodeContext,
    events: {} as Event
  },
  actors: {
    explorerState,
    searchState,
    commitState,
    pullRequestState,
    terminalState,
    actionsState,
    promptsState
  },
  actions: {
    spawnFeatureActors: enqueueActions(({ enqueue }) => {
      // Only spawn if not already
        enqueue.spawnChild('explorerState', { id: 'explorer' });
        enqueue.spawnChild('terminalState', { id: 'terminal' });
        enqueue.spawnChild('searchState', { id: 'search' });
        enqueue.spawnChild('commitState', { id: 'commit' });
        enqueue.spawnChild('pullRequestState', { id: 'pr' });
        enqueue.spawnChild('actionsState', { id: 'codeActions' });
        enqueue.spawnChild('promptsState', { id: 'codePrompts' });
    }),

    notifyDirectoryChange: ({ event, context, self }) => {
      const ev = event as { type: 'UPDATE_STATE'; updates: Partial<CodeContext> }
      if (ev.updates.baseDirectory && ev.updates.baseDirectory !== context.baseDirectory) {
        // Swap in the new project's recent files, so Quick Open ranks its files and not
        // the previous project's. Sent as its own event: this action runs before
        // updateState, so assigning here would be overwritten by the same UPDATE_STATE.
        const recentlyOpenedFiles = loadRecentFiles(ev.updates.baseDirectory)
        self.send({ type: 'UPDATE_STATE', updates: { recentlyOpenedFiles } })

        // Don't send commit.REFRESH_STATUS or pr.REFRESH_STATUS here.
        // The backend handles refresh via notifyChildSystemsOfBaseChange after
        // SET_BASE_DIRECTORY is processed, avoiding a race condition where these
        // frontend-initiated refreshes hit the backend before the directory update.
        codeChild(self, 'search')?.send({ type: 'search.DIRECTORY_CHANGED', baseDirectory: ev.updates.baseDirectory });
      }
    },
    saveTabsAction: ({ context }) => {
      // Don't save tabs until they've been restored (to avoid overwriting with empty array)
      if (!context.tabsRestored) {
        return
      }
      // Skip noisy per-tab saves while a restoration batch is still in flight,
      // and avoid persisting an incomplete tab list if the app exits mid-restore.
      // The save fires naturally on the LAST restoration arrival because addTab
      // clears pendingTabOrder when the final expected path lands.
      if (context.pendingTabOrder !== undefined) {
        return
      }
      persistCodeTabs(context)
    },
    forceSaveTabsAction: ({ context }) => {
      if (!context.tabsRestored) {
        return
      }
      persistCodeTabs(context)
    },
    addTab: assign(({ event, context }) => {
      const ev = event as { type: 'ADD_TAB'; tab: any; replacePreview?: boolean; extraUpdates?: Partial<CodeContext> }
      const enablePreview = context.settings?.enablePreview ?? true
      let openFiles = [...context.openFiles]

      // If this tab has persisted metadata waiting, this is a restore insertion.
      // Hydrate isPinned/groupId onto the incoming tab BEFORE it lands in openFiles.
      const persistedMetadata = context.pendingPersistedMetadata?.get(ev.tab.path)
      const incomingTab = persistedMetadata
        ? { ...ev.tab, groupId: persistedMetadata.groupId, isPinned: persistedMetadata.isPinned, isPreview: persistedMetadata.isPreview }
        : ev.tab
      const isRestoring = persistedMetadata !== undefined

      // Check if tab already exists
      const existingIndex = openFiles.findIndex((f: any) => f.path === incomingTab.path)

      if (existingIndex >= 0) {
        // Tab exists — update content, KEEP preview state unchanged
        openFiles[existingIndex] = { ...openFiles[existingIndex], ...incomingTab }
      } else {
        // New tab — parent decides preview state based on tab type.
        // Restored tabs must never come back as ephemeral previews.
        const isSpecialTab = incomingTab.isTerminal || incomingTab.isAction || incomingTab.isPrompt
        const shouldPreview = !isRestoring && enablePreview && !isSpecialTab && !ev.replacePreview

        // Remove old preview tab (only one preview at a time)
        if (shouldPreview || ev.replacePreview) {
          openFiles = openFiles.filter((f: any) => !f.isPreview)
        }

        const newTab = shouldPreview ? { ...incomingTab, isPreview: true } : incomingTab
        // During restore, place the tab in its persisted slot. Otherwise keep
        // the pinned-first invariant via sortTabsByPinned.
        openFiles = context.pendingTabOrder
          ? insertByPersistedOrder(openFiles, newTab, context.pendingTabOrder)
          : sortTabsByPinned([...openFiles, newTab])
      }

      // Consume the pending-metadata entry for this tab, if any. Treat the map
      // as immutable — clone before mutating.
      let pendingPersistedMetadata = context.pendingPersistedMetadata
      if (persistedMetadata && pendingPersistedMetadata) {
        const next = new Map(pendingPersistedMetadata)
        next.delete(incomingTab.path)
        pendingPersistedMetadata = next.size > 0 ? next : undefined
      }

      // Clear pendingTabOrder once every persisted path is now present in openFiles.
      let pendingTabOrder = context.pendingTabOrder
      if (pendingTabOrder) {
        const openPaths = new Set(openFiles.map(f => f.path))
        const allPlaced = pendingTabOrder.every(t => openPaths.has(t.path))
        if (allPlaced) pendingTabOrder = undefined
      }

      // During restore, don't bounce activeFilePath as tabs stream in — leave
      // the previously-active tab focused. A user-initiated open focuses the new tab.
      let activeFilePath = isRestoring
        ? context.activeFilePath
        : (ev.extraUpdates?.activeFilePath ?? incomingTab.path)

      // Restore-completion fallback: if the persisted active path's tab failed to
      // restore (file deleted, terminal rejected by backend), repoint to the first
      // open tab so the editor isn't left blank with a phantom selection.
      const justFinishedRestore = pendingTabOrder === undefined && context.pendingTabOrder !== undefined
      if (justFinishedRestore && openFiles.length > 0
          && !openFiles.some(f => f.path === activeFilePath)) {
        activeFilePath = openFiles[0].path
      }

      const tabGroups = pendingTabOrder === undefined
        ? pruneEmptyTabGroups(openFiles, context.tabGroups)
        : context.tabGroups

      return {
        ...context,
        ...ev.extraUpdates,
        openFiles,
        activeFilePath,
        pendingPersistedMetadata,
        pendingTabOrder,
        tabGroups,
        tabViewHistory: activeFilePath
          ? pushTabViewHistory(context.tabViewHistory, activeFilePath)
          : context.tabViewHistory
      }
    }),
    updateState: assign(({ event, context }) => {
      const ev = event as { type: 'UPDATE_STATE'; updates: Partial<CodeContext> }
      const updates = { ...context, ...ev.updates }

      // Auto-clean history when tabs are removed
      if (ev.updates.openFiles && ev.updates.openFiles.length < context.openFiles.length) {
        const openPaths = new Set(updates.openFiles.map((f: any) => f.path))
        updates.tabViewHistory = (updates.tabViewHistory ?? context.tabViewHistory)
          .filter((p: string) => openPaths.has(p))
      }

      // Auto-push to history when active tab changes
      if (updates.activeFilePath && updates.activeFilePath !== context.activeFilePath) {
        if (!ev.updates.tabViewHistory) {
          updates.tabViewHistory = pushTabViewHistory(
            updates.tabViewHistory ?? context.tabViewHistory,
            updates.activeFilePath
          )
        }
      }

      if (updates.tabsRestored && updates.pendingTabOrder === undefined) {
        updates.tabGroups = pruneEmptyTabGroups(updates.openFiles, updates.tabGroups)
      }

      return updates
    }),
    assignFiles: assign({
      isLoading: false,
      error: null
    }),
    initializeSurface: ({ self }) => {
      // Explorer is initialized by the CODE_STARTED answer — no re-init needed here.
      codeChild(self, 'terminal')?.send({ type: 'terminal.REFRESH_LIST' });
    },

    restorePersistedTabs: enqueueActions(({ enqueue, self }) => {
      const { tabs: persistedTabs, activeFilePath: persistedActive, panelTerminalId: persistedPanelTerminal, panelTerminalExpanded: persistedExpanded } = loadPersistedTabs()
      const persistedGroups = prunePersistedTabGroups(
        loadTabGroups(storage, 'tab-groups'),
        persistedTabs
      )

      // Store the desired tab order
      const tabOrder = persistedTabs.map(tab => ({ path: tab.path, order: tab.order }))

      // Create a map of path -> metadata to apply after tabs are created.
      // Populate for ALL persisted tabs so the addTab action can detect restoration
      // and preserve their preview/permanent state.
      const metadataMap = new Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>()
      persistedTabs.forEach(tab => {
        metadataMap.set(tab.path, {
          groupId: tab.groupId,
          isPinned: tab.isPinned,
          isPreview: tab.isPreview
        })
      })

      // Restore activeFilePath from persistence so addTab's "preserve context.activeFilePath
      // during restore" branch keeps the previously-active tab focused. If the persisted
      // active path no longer matches a tab (corrupt or stale storage),
      // fall back to the first persisted tab so the editor isn't blank on load.
      const persistedPaths = new Set(persistedTabs.map(t => t.path))
      const restoredActive = persistedActive && persistedPaths.has(persistedActive)
        ? persistedActive
        : persistedTabs[0]?.path ?? null

      // Mark tabs as restored immediately (even if empty)
      // Collect terminal tab IDs to restore later (when TERMINALS_LISTED arrives from backend)
      const terminalTabIds = persistedTabs.filter(t => t.type === 'terminal').map(t => t.terminalId!)
      const restoredPanelTerminal = persistedPanelTerminal && terminalTabIds.includes(persistedPanelTerminal)
        ? null
        : persistedPanelTerminal

      enqueue.assign({
        tabsRestored: true,
        pendingTabOrder: tabOrder.length > 0 ? tabOrder : undefined,
        pendingPersistedMetadata: metadataMap.size > 0 ? metadataMap : undefined,
        tabGroups: persistedGroups,
        activeFilePath: restoredActive,
        panelTerminalId: restoredPanelTerminal,
        panelTerminalExpanded: restoredPanelTerminal ? persistedExpanded : false,
        pendingTerminalTabIds: terminalTabIds.length > 0 ? terminalTabIds : undefined
      })

      // If no persisted tabs, we're done
      if (persistedTabs.length === 0) {
        return
      }

      // Restore tabs
      enqueue(() => {
        const explorerActor = codeChild(self, 'explorer')
        const actionsActor = codeChild(self, 'codeActions')
        const promptsActor = codeChild(self, 'codePrompts')

        // Filter tabs by type
        const fileTabs = persistedTabs.filter(tab => tab.type === 'file')
        const terminalTabs = persistedTabs.filter(tab => tab.type === 'terminal')
        const actionTabs = persistedTabs.filter(tab => tab.type === 'action')
        const promptTabs = persistedTabs.filter(tab => tab.type === 'prompt')

        console.log('[Code Surface] tabs to restore:', {
          actionCount: actionTabs.length,
          fileCount: fileTabs.length,
          terminalCount: terminalTabs.length,
          promptCount: promptTabs.length,
          totalCount: persistedTabs.length,
        })

        // Send file paths to restore
        if (fileTabs.length > 0 && explorerActor) {
          const filePaths = fileTabs.map(tab => tab.path)
          explorerActor.send({
            type: 'explorer.OPEN_FILES',
            paths: filePaths
          })
        }

        // Terminal tabs are NOT sent here — they're deferred to assignTerminals
        // (when TERMINALS_LISTED arrives) to avoid racing with backend restore.
        // See pendingTerminalTabIds in context.

        // Send action IDs to restore
        if (actionTabs.length > 0 && actionsActor) {
          const actionIds = actionTabs.map(tab => tab.actionId!)
          actionsActor.send({
            type: 'codeActions.OPEN_TABS',
            actionIds
          })
        }

        // Send prompt IDs to restore
        if (promptTabs.length > 0 && promptsActor) {
          const promptIds = promptTabs.map(tab => tab.promptId!)
          promptsActor.send({
            type: 'codePrompts.OPEN_TABS',
            promptIds
          })
        }
      })

      enqueue(() => {
        window.setTimeout(() => {
          self.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })
        }, 2500)
      })
    }),
    // Hands every child whatever arrived and lets each ignore what it doesn't handle. That is routing rather than
    // addressing one child, so there is no single event union to check against and the children stay untyped here —
    // as in `routeEvent`. Every call that names one child names its type.
    broadcastToAllFeatures: ({ event, self }) => {
      for (const id of CODE_CHILD_IDS) routeToCodeChild(self, id, event);
    },

    routeEvent: ({ event, self }) => {
      const eventType = event.type;

      // An event's prefix names the child that handles it. The one call whose child isn't known here: which
      // machine `prefix` stands for is the event's to say at runtime, so this is the routing itself and there is
      // no actor type to name — every other call names one.
      if (eventType.includes('.')) {
        const [prefix] = eventType.split('.');
        routeToCodeChild(self, prefix, event);
      }
    },

    selectPanel: assign(({
      event,
      context,
      self
    }) => {
      const ev = event as { type: 'SELECT_PANEL'; panel: PanelType };

      // Guard against invalid panel types (e.g. persisted 'terminal' from before removal)
      if (!ALL_PANELS.includes(ev.panel)) {
        return { ...context, selectedPanel: 'explorer' as PanelType };
      }

      // Notify child machines if needed
      if (ev.panel === 'commit') {
        codeChild(self, 'commit')?.send({ type: 'commit.REFRESH_STATUS' });
      } else if (ev.panel === 'pr') {
        codeChild(self, 'pr')?.send({ type: 'pr.REFRESH_STATUS' });
      }
      // Actions and prompts are loaded by their respective main surface actors
      return {
        ...context,
        selectedPanel: ev.panel,
        panelNavHistory: pushNavHistory(context.panelNavHistory, ev.panel),
      };
    }),

    // Quick open actions
    showQuickOpen: assign({
      isQuickOpenVisible: true,
      quickOpenQuery: '',
      quickOpenResults: [],
      quickOpenSelectedIndex: 0,
      quickOpenLoading: true
    }),

    hideQuickOpen: assign({
      isQuickOpenVisible: false,
      quickOpenQuery: '',
      quickOpenResults: [],
      quickOpenSelectedIndex: 0,
      quickOpenLoading: false
    }),

    toggleQuickOpen: assign(({ context }) => ({
      ...context,
      isQuickOpenVisible: !context.isQuickOpenVisible,
      quickOpenQuery: context.isQuickOpenVisible ? '' : context.quickOpenQuery,
      quickOpenResults: context.isQuickOpenVisible ? [] : context.quickOpenResults,
      quickOpenSelectedIndex: 0,
      quickOpenLoading: context.isQuickOpenVisible ? false : true
    })),

    updateQuickOpenQuery: assign(({ event }) => {
      const ev = event as { type: 'UPDATE_QUICK_OPEN_QUERY'; query: string };
      return {
        quickOpenQuery: ev.query,
        quickOpenSelectedIndex: 0
      };
    }),

    selectQuickOpenResult: assign(({ event, context }) => {
      const ev = event as { type: 'SELECT_QUICK_OPEN_RESULT'; index: number };
      const maxIndex = Math.max(0, context.quickOpenResults.length - 1);
      return {
        quickOpenSelectedIndex: Math.max(0, Math.min(ev.index, maxIndex))
      };
    }),

    openQuickOpenResult: ({ context, self, event }) => {
      const ev = event as { type: 'OPEN_QUICK_OPEN_RESULT'; path: string };

      // Track the file as recently opened
      const updatedRecentFiles = addRecentFile(context.recentlyOpenedFiles, ev.path, context.baseDirectory);
      self.send({
        type: 'UPDATE_STATE',
        updates: { recentlyOpenedFiles: updatedRecentFiles }
      });

      // Open file through explorer
      codeChild(self, 'explorer')?.send({
        type: 'explorer.OPEN_FILE',
        path: ev.path
      });
    },

    requestQuickOpenFiles: ({ context, self }) => {
      codeChild(self, 'explorer')?.send({
        type: 'explorer.QUICK_OPEN_SEARCH',
        baseDirectory: context.baseDirectory
      });
    },

    handleCodeConnected: assign(({ event, context }) => {
      const ev = event as { type: 'CODE_STARTED'; data: { baseDirectory: string | null; settings?: CodeSettings } }

      // Extract hotkeys from settings - filter out undefined values
      const hotkeys: HotkeysMap = {};
      if (ev.data.settings?.hotkeys) {
        Object.entries(ev.data.settings.hotkeys).forEach(([key, value]) => {
          if (value) {
            hotkeys[key] = value as KeyboardShortcut;
          }
        });
      }

      // Update directory state from backend
      // Explorer child will receive CODE_STARTED via broadcastToAllFeatures and initialize itself
      const baseDirectory = ev.data.baseDirectory || ''

      return {
        ...context,
        baseDirectory,
        recentlyOpenedFiles: loadRecentFiles(baseDirectory),
        settings: ev.data.settings,
        hotkeys: Object.keys(hotkeys).length > 0 ? hotkeys : context.hotkeys
      }
    }),

    handleSettingsUpdate: assign(({ event, context }) => {
      const ev = event as { type: 'FEATURE_SETTINGS_UPDATED'; settings: CodeSettings }

      // Extract hotkeys from settings - filter out undefined values
      const hotkeys: HotkeysMap = {};
      if (ev.settings?.hotkeys) {
        Object.entries(ev.settings.hotkeys).forEach(([key, value]) => {
          if (value) {
            hotkeys[key] = value as KeyboardShortcut;
          }
        });
      }

      return {
        ...context,
        settings: ev.settings,
        hotkeys: Object.keys(hotkeys).length > 0 ? hotkeys : context.hotkeys
      }
    }),

    handleHotkey: createHotkeyProcessor({
      openTerminal: 'OPEN_TERMINAL',
      openTerminalTab: 'OPEN_TERMINAL_TAB',
      navigatePrevPanel: 'NAVIGATE_PREV_PANEL',
      navigateNextPanel: 'NAVIGATE_NEXT_PANEL',
      focusSearch: 'FOCUS_SEARCH',
      quickOpen: 'SHOW_QUICK_OPEN',
      saveFile: 'SAVE_ACTIVE_FILE',
      closeTab: 'CLOSE_ACTIVE_TAB',
    }),

    saveActiveFile: ({ context, self }) => {
      const activeFile = context.openFiles.find(f => f.path === context.activeFilePath)
      if (!activeFile) return

      if (activeFile.isDiff) {
        const file = activeFile as OpenFile
        if (!isEditableDiff(file)) return
        codeChild(self, 'explorer')?.send({ type: 'explorer.WRITE_FILE', path: file.gitFile!.path, content: file.content })
        return
      }

      if ('isAction' in activeFile && (activeFile as any).isAction) {
        const actionId = activeFile.path.replace('action:', '')
        codeChild(self, 'codeActions')?.send({ type: 'codeActions.SAVE_ACTION', actionId, content: activeFile.content })
      } else if ('isPrompt' in activeFile && (activeFile as any).isPrompt) {
        const promptId = activeFile.path.replace('prompt:', '')
        codeChild(self, 'codePrompts')?.send({ type: 'codePrompts.SAVE_PROMPT', promptId, content: activeFile.content })
      } else {
        codeChild(self, 'explorer')?.send({ type: 'explorer.WRITE_FILE', path: activeFile.path, content: activeFile.content })
      }
    },
    closeActiveTab: assign(({ context, self }) => {
      if (!context.activeFilePath) return {}
      return closeTabWithConfirmation(context, self, context.activeFilePath)
    }),
    closeTab: assign(({ context, self, event }) => {
      const { path } = event as { type: 'CLOSE_TAB'; path: string }
      return closeTabWithConfirmation(context, self, path)
    }),
    killTerminal: enqueueActions(({ enqueue, context, self, event }) => {
      const { path } = event as { type: 'KILL_TERMINAL'; path: string }
      const file = context.openFiles.find(f => f.path === path)
      if (!file || !('isTerminal' in file)) return
      enqueue(() => {
        codeChild(self, 'terminal')?.send({ type: 'terminal.CLOSE', terminalId: (file as any).terminalInfo.id })
      })
      enqueue(assign(() => removeTabLogic(context, self, path)))
    }),
    openTerminal: enqueueActions(({ enqueue, context, self }) => {
      const terminals: TerminalInfo[] = codeChild(self, 'terminal')?.getSnapshot()?.context?.terminals || []
      const tabbedIds = getTabbedTerminalIds(context.openFiles)

      if (terminals.length === 0) {
        // No terminals — create one (will be routed to panel by child actor)
        enqueue(() => {
          codeChild(self, 'terminal')?.send({ type: 'terminal.CREATE', cwd: context.baseDirectory })
        })
        enqueue(assign({ panelTerminalExpanded: true }))
        return
      }

      if (!context.panelTerminalId) {
        // Terminals exist but none selected for panel — pick first non-tabbed
        const available = terminals.find(t => !tabbedIds.has(t.id))
        if (available) {
          enqueue(assign({ panelTerminalId: available.id, panelTerminalExpanded: true }))
          return
        }
        // All terminals are in tabs — create a new one
        enqueue(() => {
          codeChild(self, 'terminal')?.send({ type: 'terminal.CREATE', cwd: context.baseDirectory })
        })
        enqueue(assign({ panelTerminalExpanded: true }))
        return
      }

      // Panel terminal already set — toggle expand/collapse
      enqueue(assign({ panelTerminalExpanded: !context.panelTerminalExpanded }))
    }),

    openTerminalTab: enqueueActions(({ enqueue, context, self }) => {
      enqueue(() => {
        codeChild(self, 'terminal')?.send({ type: 'terminal.CREATE', cwd: context.baseDirectory, target: 'tab' })
      })
    }),

    selectPanelTerminal: assign(({ event }) => {
      const ev = event as { type: 'SELECT_PANEL_TERMINAL'; terminalId: string };
      return { panelTerminalId: ev.terminalId };
    }),

    closePanelTerminal: enqueueActions(({ enqueue, context, self }) => {
      const terminalId = context.panelTerminalId;
      if (terminalId) {
        enqueue(() => {
          codeChild(self, 'terminal')?.send({ type: 'terminal.CLOSE', terminalId })
        })
      }
      enqueue(assign({ panelTerminalId: null, panelTerminalExpanded: false }))
    }),

    togglePanelTerminal: assign(({ context }) => {
      return { panelTerminalExpanded: !context.panelTerminalExpanded }
    }),

    updateTerminalTabInfo: assign(({ event, context }) => {
      const ev = event as { type: 'TERMINAL_TAB_INFO_CHANGED'; terminalId: string; changes: Record<string, any> }
      const terminalPath = `terminal:${ev.terminalId}`
      let changed = false
      const updatedOpenFiles = context.openFiles.map((file: any) => {
        if (file.path === terminalPath && file.isTerminal) {
          changed = true
          return {
            ...file,
            terminalInfo: { ...file.terminalInfo, ...ev.changes }
          }
        }
        return file
      })
      return changed ? { openFiles: updatedOpenFiles } : {}
    }),

    openTerminalInTab: enqueueActions(({ enqueue, context, event, self }) => {
      const ev = event as { type: 'OPEN_TERMINAL_IN_TAB'; terminalId: string }
      const terminals: TerminalInfo[] = codeChild(self, 'terminal')?.getSnapshot()?.context?.terminals || []
      const terminalInfo = terminals.find(t => t.id === ev.terminalId)

      if (!terminalInfo) return

      // Open as canvas tab
      enqueue(() => {
        codeChild(self, 'terminal')?.send({ type: 'terminal.OPEN_TAB', terminalInfo })
      })

      // If this was the panel terminal, auto-select next available
      if (context.panelTerminalId === ev.terminalId) {
        const tabbedIds = new Set(
          context.openFiles.filter((f: any) => f.isTerminal).map((f: any) => f.terminalInfo.id)
        )
        tabbedIds.add(ev.terminalId)
        const next = terminals.find(t => !tabbedIds.has(t.id))
        enqueue(assign({ panelTerminalId: next?.id ?? null }))
      }
    }),

    moveTerminalToPanel: assign(({ context, event }) => {
      const { path } = event as { type: 'MOVE_TERMINAL_TO_PANEL'; path: string }
      const file = context.openFiles.find(f => f.path === path)
      if (!file || !('isTerminal' in file)) return {}
      const terminalId = (file as any).terminalInfo.id
      // Remove tab without killing the process, set as panel terminal
      const newOpenFiles = context.openFiles.filter(f => f.path !== path)
      const newActiveFilePath = context.activeFilePath === path
        ? nextActiveFromHistory(context.tabViewHistory, newOpenFiles)
        : context.activeFilePath
      return {
        openFiles: newOpenFiles,
        activeFilePath: newActiveFilePath,
        panelTerminalId: terminalId,
        panelTerminalExpanded: true
      }
    }),

    navigatePrevPanel: ({ context, self }) => {
      const currentIndex = ALL_PANELS.indexOf(context.selectedPanel);
      const newIndex = currentIndex === 0 ? ALL_PANELS.length - 1 : currentIndex - 1;
      self.send({ type: 'SELECT_PANEL', panel: ALL_PANELS[newIndex] });
    },

    navigateNextPanel: ({ context, self }) => {
      const currentIndex = ALL_PANELS.indexOf(context.selectedPanel);
      const newIndex = currentIndex === ALL_PANELS.length - 1 ? 0 : currentIndex + 1;
      self.send({ type: 'SELECT_PANEL', panel: ALL_PANELS[newIndex] });
    },

    focusSearch: assign(({ context, self }) => {
      const selectedText = _editorSelectionGetter?.() || '';
      self.send({ type: 'SELECT_PANEL', panel: 'search' });
      return {
        ...context,
        searchFocusTrigger: context.searchFocusTrigger + 1,
        searchPrefillText: selectedText,
      };
    }),

    searchInFolder: ({ event, context, self }) => {
      const ev = event as { type: 'SEARCH_IN_FOLDER'; folder: string }
      // Compute relative path and set as include pattern glob
      const relativePath = ev.folder.startsWith(context.baseDirectory)
        ? ev.folder.slice(context.baseDirectory.length + 1)
        : ev.folder
      codeChild(self, 'search')?.send({
        type: 'search.UPDATE_OPTIONS',
        options: { includePattern: `${relativePath}/**` }
      })
      self.send({ type: 'SELECT_PANEL', panel: 'search' })
    },

    promotePreviewTab: assign(({ event, context }) => {
      const ev = event as { type: 'PROMOTE_PREVIEW_TAB'; path: string }
      return {
        ...context,
        openFiles: context.openFiles.map(file =>
          file.path === ev.path ? { ...file, isPreview: false } : file
        )
      }
    }),

    pinTab: assign(({ event, context }) => {
      const ev = event as { type: 'PIN_TAB'; path: string }

      // Get groupId before modifying
      const tab = context.openFiles.find(f => f.path === ev.path)
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined

      const updatedFiles = context.openFiles.map(file =>
        file.path === ev.path ? { ...file, isPinned: true, groupId: undefined, isPreview: false } : file
      )

      // Delete group if now empty
      const updatedGroups = deleteEmptyGroups(updatedFiles, context.tabGroups, groupId)

      // Sort tabs to put pinned tabs first
      const pinnedTabs = updatedFiles.filter(tab => tab.isPinned)
      const unpinnedTabs = updatedFiles.filter(tab => !tab.isPinned)

      return {
        ...context,
        openFiles: [...pinnedTabs, ...unpinnedTabs],
        tabGroups: updatedGroups
      }
    }),

    unpinTab: assign(({ event, context }) => {
      const ev = event as { type: 'UNPIN_TAB'; path: string }

      // Get groupId before modifying
      const tab = context.openFiles.find(f => f.path === ev.path)
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined

      const updatedFiles = context.openFiles.map(file =>
        file.path === ev.path ? { ...file, isPinned: false, groupId: undefined } : file
      )

      // Delete group if now empty
      const updatedGroups = deleteEmptyGroups(updatedFiles, context.tabGroups, groupId)

      return {
        ...context,
        openFiles: updatedFiles,
        tabGroups: updatedGroups
      }
    }),

    pinTabAt: assign(({ event, context }) => {
      const ev = event as { type: 'PIN_TAB_AT'; path: string; targetPath: string; side: 'left' | 'right' }
      const tab = context.openFiles.find(f => f.path === ev.path)
      if (!tab) return context
      const groupId = 'groupId' in tab ? tab.groupId : undefined

      const remaining = context.openFiles.filter(f => f.path !== ev.path)
      const movedTab = { ...tab, isPinned: true, groupId: undefined, isPreview: false }

      const targetIndex = remaining.findIndex(f => f.path === ev.targetPath)
      const insertAt = targetIndex === -1
        ? remaining.filter(t => t.isPinned).length
        : ev.side === 'right' ? targetIndex + 1 : targetIndex

      remaining.splice(insertAt, 0, movedTab)

      const tabGroups = deleteEmptyGroups(remaining, context.tabGroups, groupId as string | undefined)
      return { ...context, openFiles: remaining, tabGroups }
    }),

    unpinTabAt: assign(({ event, context }) => {
      const ev = event as { type: 'UNPIN_TAB_AT'; path: string; targetPath: string; side: 'left' | 'right' }
      const tab = context.openFiles.find(f => f.path === ev.path)
      if (!tab) return context
      const groupId = 'groupId' in tab ? tab.groupId : undefined

      const remaining = context.openFiles.filter(f => f.path !== ev.path)
      const movedTab = { ...tab, isPinned: false, groupId: undefined }

      const targetIndex = remaining.findIndex(f => f.path === ev.targetPath)
      const insertAt = targetIndex === -1
        ? remaining.length
        : ev.side === 'right' ? targetIndex + 1 : targetIndex

      remaining.splice(insertAt, 0, movedTab)

      const tabGroups = deleteEmptyGroups(remaining, context.tabGroups, groupId as string | undefined)
      return { ...context, openFiles: remaining, tabGroups }
    }),

    pinGroup: assign(({ event, context }) => {
      const ev = event as { type: 'PIN_GROUP'; groupId: string }
      const updatedGroups = context.tabGroups.map(group =>
        group.id === ev.groupId ? { ...group, isPinned: true } : group
      )
      // Also pin all tabs in this group
      const updatedFiles = context.openFiles.map(file =>
        'groupId' in file && file.groupId === ev.groupId
          ? { ...file, isPinned: true }
          : file
      )
      // Sort tabs to put pinned tabs first
      const pinnedTabs = updatedFiles.filter(tab => tab.isPinned)
      const unpinnedTabs = updatedFiles.filter(tab => !tab.isPinned)
      return {
        ...context,
        tabGroups: updatedGroups,
        openFiles: [...pinnedTabs, ...unpinnedTabs]
      }
    }),

    unpinGroup: assign(({ event, context }) => {
      const ev = event as { type: 'UNPIN_GROUP'; groupId: string }
      const updatedGroups = context.tabGroups.map(group =>
        group.id === ev.groupId ? { ...group, isPinned: false } : group
      )
      // Also unpin all tabs in this group
      const updatedFiles = context.openFiles.map(file =>
        'groupId' in file && file.groupId === ev.groupId
          ? { ...file, isPinned: false }
          : file
      )
      return {
        ...context,
        tabGroups: updatedGroups,
        openFiles: updatedFiles
      }
    }),

    createGroup: assign(({ event, context }) => {
      const ev = event as { type: 'CREATE_GROUP'; name: string; tabPaths?: string[] }

      // Determine if group should be pinned based on tabs being added
      let shouldPinGroup = false
      if (ev.tabPaths && ev.tabPaths.length > 0) {
        const tabsToAdd = context.openFiles.filter(f => ev.tabPaths!.includes(f.path))
        // Group is pinned if any of its tabs are pinned
        shouldPinGroup = tabsToAdd.some(tab => tab.isPinned)
      }

      const color = getNextAvailableColor(context.tabGroups, shouldPinGroup)

      const newGroup: TabGroup = {
        id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: ev.name,
        color,
        isCollapsed: false,
        isPinned: shouldPinGroup,
        order: context.tabGroups.length
      }

      // Update files if tabPaths provided - set isPinned to match group
      const updatedFiles = ev.tabPaths
        ? context.openFiles.map(file =>
            ev.tabPaths!.includes(file.path)
              ? { ...file, groupId: newGroup.id, isPinned: shouldPinGroup, isPreview: false }
              : file
          )
        : context.openFiles

      // Sort tabs to put pinned tabs first (consistent with other actions)
      const pinnedTabs = updatedFiles.filter(tab => tab.isPinned)
      const unpinnedTabs = updatedFiles.filter(tab => !tab.isPinned)

      return {
        ...context,
        tabGroups: [...context.tabGroups, newGroup],
        openFiles: [...pinnedTabs, ...unpinnedTabs]
      }
    }),

    renameGroup: assign(({ event, context }) => {
      const ev = event as { type: 'RENAME_GROUP'; groupId: string; name: string }
      return {
        ...context,
        tabGroups: context.tabGroups.map(group =>
          group.id === ev.groupId ? { ...group, name: ev.name } : group
        )
      }
    }),

    changeGroupColor: assign(({ event, context }) => {
      const ev = event as { type: 'CHANGE_GROUP_COLOR'; groupId: string; color: TabGroupColor }
      return {
        ...context,
        tabGroups: context.tabGroups.map(group =>
          group.id === ev.groupId ? { ...group, color: ev.color } : group
        )
      }
    }),

    deleteGroup: assign(({ event, context }) => {
      const ev = event as { type: 'DELETE_GROUP'; groupId: string; closeTabsInGroup?: boolean }

      // Remove group
      const updatedGroups = context.tabGroups.filter(g => g.id !== ev.groupId)

      // Either close tabs or ungroup them
      const updatedFiles = ev.closeTabsInGroup
        ? context.openFiles.filter(file => !('groupId' in file) || file.groupId !== ev.groupId)
        : context.openFiles.map(file =>
            ('groupId' in file && file.groupId === ev.groupId) ? { ...file, groupId: undefined } : file
          )

      // Clean history and select next active tab if tabs were closed
      const openPaths = new Set(updatedFiles.map(f => f.path))
      const updatedHistory = context.tabViewHistory.filter(p => openPaths.has(p))

      const activeWasRemoved = ev.closeTabsInGroup && context.activeFilePath
        && !openPaths.has(context.activeFilePath)

      const newActiveFilePath = activeWasRemoved
        ? nextActiveFromHistory(updatedHistory, updatedFiles)
        : context.activeFilePath

      return {
        ...context,
        tabGroups: updatedGroups,
        openFiles: updatedFiles,
        activeFilePath: newActiveFilePath,
        tabViewHistory: updatedHistory
      }
    }),

    toggleGroupCollapse: assign(({ event, context }) => {
      const ev = event as { type: 'TOGGLE_GROUP_COLLAPSE'; groupId: string }
      return {
        ...context,
        tabGroups: context.tabGroups.map(group =>
          group.id === ev.groupId ? { ...group, isCollapsed: !group.isCollapsed } : group
        )
      }
    }),

    addTabToGroup: assign(({ event, context }) => {
      const ev = event as { type: 'ADD_TAB_TO_GROUP'; path: string; groupId: string }

      // Find the target group to check if it's pinned
      const targetGroup = context.tabGroups.find(g => g.id === ev.groupId)
      const shouldPin = targetGroup?.isPinned || false

      // Set tab's isPinned to match the group's pinned status
      const updatedFiles = context.openFiles.map(file =>
        file.path === ev.path
          ? { ...file, groupId: ev.groupId, isPinned: shouldPin, isPreview: false }
          : file
      )

      // Sort tabs to put pinned tabs first (consistent with pinGroup/unpinGroup)
      const pinnedTabs = updatedFiles.filter(tab => tab.isPinned)
      const unpinnedTabs = updatedFiles.filter(tab => !tab.isPinned)

      return {
        ...context,
        openFiles: [...pinnedTabs, ...unpinnedTabs]
      }
    }),

    removeTabFromGroup: assign(({ event, context }) => {
      const ev = event as { type: 'REMOVE_TAB_FROM_GROUP'; path: string }

      // Find the group this tab belongs to
      const tab = context.openFiles.find(f => f.path === ev.path)
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined

      // Remove tab from group
      const updatedFiles = context.openFiles.map(file =>
        file.path === ev.path ? { ...file, groupId: undefined } : file
      )

      // Delete group if now empty
      const updatedGroups = deleteEmptyGroups(updatedFiles, context.tabGroups, groupId)

      return {
        ...context,
        openFiles: updatedFiles,
        tabGroups: updatedGroups
      }
    }),

    settlePersistedTabsRestore: assign(({ context }) => {
      const updates = finalizeRestoreState(context)
      if (Object.keys(updates).length === 0) return {}

      const nextContext = { ...context, ...updates }
      persistCodeTabs(nextContext)
      console.info('[Code Surface] restored tabs settled', {
        openTabCount: nextContext.openFiles.length,
        prunedPendingCount: context.pendingTabOrder?.filter(tab => !nextContext.openFiles.some(file => file.path === tab.path)).length ?? 0,
      })
      return updates
    }),

    reorderGroups: assign(({ event, context }) => {
      const ev = event as { type: 'REORDER_GROUPS'; fromIndex: number; toIndex: number }
      const groups = [...context.tabGroups]
      const [movedGroup] = groups.splice(ev.fromIndex, 1)
      groups.splice(ev.toIndex, 0, movedGroup)

      // Update order values
      const reorderedGroups = groups.map((group, index) => ({
        ...group,
        order: index
      }))

      return {
        ...context,
        tabGroups: reorderedGroups
      }
    }),
  }
}).createMachine({
  id,
  initial: 'canvas',
  entry: ['spawnFeatureActors', 'restorePersistedTabs'],
  context: {
    baseDirectory: '', // Will be loaded from backend EARS store
    openFiles: [], // Don't load tabs here - wait for SURFACE_ACTIVATED
    activeFilePath: null,
    isLoading: false,
    error: null,
    selectedPanel: 'explorer' as PanelType,
    // Tab groups state
    tabGroups: [],
    // Quick open state
    isQuickOpenVisible: false,
    quickOpenQuery: '',
    quickOpenResults: [],
    quickOpenSelectedIndex: 0,
    quickOpenLoading: false,
    recentlyOpenedFiles: [], // loaded per project once the backend reports baseDirectory
    tabViewHistory: [],
    // Default hotkeys for code surface (will be overridden by settings)
    hotkeys: {},
    pendingRevealLine: null,
    searchFocusTrigger: 0,
    searchPrefillText: '',
    panelTerminalId: null,
    panelTerminalExpanded: false,
    panelNavHistory: createNavHistory('explorer' as PanelType),
  },
  states: {
    canvas: {
      meta: breadcrumb('canvas', 'Code', true),
      on: {
        // What the surface starts from, asked as the shell starts it, in a delivery naming the surface
        SURFACE_STARTED: {
          actions: () => { sendToSystem('code', { type: 'GET_CODE_START' }) },
        },
        // The directory moved, in every window: ask again for what the surface starts from
        BASE_DIRECTORY_CHANGED: {
          actions: () => { sendToSystem('code', { type: 'GET_CODE_START' }) },
        },
        // The answer, handed to every feature, each of which asks for what its panel shows
        CODE_STARTED: {
          actions: ['handleCodeConnected', 'broadcastToAllFeatures']
        },
        // Handle settings updates
        FEATURE_SETTINGS_UPDATED: {
          actions: ['handleSettingsUpdate']
        },
        // Route events to child machines
        '*': {
          actions: ['routeEvent']
        },
        // Simple state update from child machines
        UPDATE_STATE: {
          actions: ['notifyDirectoryChange', 'updateState', 'saveTabsAction']
        },
        // Add a new tab (race-free: always uses current parent state)
        ADD_TAB: {
          actions: ['addTab', 'saveTabsAction']
        },
        // Surface initialization
        SURFACE_ACTIVATED: {
          actions: ['initializeSurface']
        },
        // Panel selection
        SELECT_PANEL: {
          actions: ['selectPanel']
        },
        NAVIGATE_BACK: {
          guard: ({ context }) => canGoBack(context.panelNavHistory),
          actions: assign(({ context, self }) => {
            const result = goBack(context.panelNavHistory)!;
            if (result.entry === 'commit') codeChild(self, 'commit')?.send({ type: 'commit.REFRESH_STATUS' });
            else if (result.entry === 'pr') codeChild(self, 'pr')?.send({ type: 'pr.REFRESH_STATUS' });
            return { panelNavHistory: result.history, selectedPanel: result.entry };
          }),
        },
        NAVIGATE_FORWARD: {
          guard: ({ context }) => canGoForward(context.panelNavHistory),
          actions: assign(({ context, self }) => {
            const result = goForward(context.panelNavHistory)!;
            if (result.entry === 'commit') codeChild(self, 'commit')?.send({ type: 'commit.REFRESH_STATUS' });
            else if (result.entry === 'pr') codeChild(self, 'pr')?.send({ type: 'pr.REFRESH_STATUS' });
            return { panelNavHistory: result.history, selectedPanel: result.entry };
          }),
        },
        // Tab pinning
        PIN_TAB: {
          actions: ['pinTab', 'saveTabsAction']
        },
        UNPIN_TAB: {
          actions: ['unpinTab', 'saveTabsAction']
        },
        PIN_TAB_AT: {
          actions: ['pinTabAt', 'saveTabsAction']
        },
        UNPIN_TAB_AT: {
          actions: ['unpinTabAt', 'saveTabsAction']
        },
        // Tab groups
        CREATE_GROUP: {
          actions: ['createGroup', 'saveTabsAction']
        },
        RENAME_GROUP: {
          actions: ['renameGroup', 'saveTabsAction']
        },
        CHANGE_GROUP_COLOR: {
          actions: ['changeGroupColor', 'saveTabsAction']
        },
        DELETE_GROUP: {
          actions: ['deleteGroup', 'forceSaveTabsAction']
        },
        TOGGLE_GROUP_COLLAPSE: {
          actions: ['toggleGroupCollapse', 'saveTabsAction']
        },
        ADD_TAB_TO_GROUP: {
          actions: ['addTabToGroup', 'saveTabsAction']
        },
        REMOVE_TAB_FROM_GROUP: {
          actions: ['removeTabFromGroup', 'saveTabsAction']
        },
        REORDER_GROUPS: {
          actions: ['reorderGroups', 'saveTabsAction']
        },
        PIN_GROUP: {
          actions: ['pinGroup', 'saveTabsAction']
        },
        UNPIN_GROUP: {
          actions: ['unpinGroup', 'saveTabsAction']
        },
        // Hotkey handling
        HOTKEY_PRESSED: {
          actions: ['handleHotkey']
        },
        OPEN_TERMINAL: {
          actions: 'openTerminal'
        },
        OPEN_TERMINAL_TAB: {
          actions: ['openTerminalTab', 'saveTabsAction']
        },
        SELECT_PANEL_TERMINAL: {
          actions: ['selectPanelTerminal', 'saveTabsAction']
        },
        CLOSE_PANEL_TERMINAL: {
          actions: ['closePanelTerminal', 'saveTabsAction']
        },
        OPEN_TERMINAL_IN_TAB: {
          actions: ['openTerminalInTab', 'saveTabsAction']
        },
        MOVE_TERMINAL_TO_PANEL: {
          actions: ['moveTerminalToPanel', 'saveTabsAction']
        },
        TOGGLE_PANEL_TERMINAL: {
          actions: ['togglePanelTerminal', 'saveTabsAction']
        },
        // Surgical update from terminal child — avoids stale openFiles snapshots
        TERMINAL_TAB_INFO_CHANGED: {
          actions: ['updateTerminalTabInfo', 'saveTabsAction']
        },
        NAVIGATE_PREV_PANEL: {
          actions: 'navigatePrevPanel'
        },
        NAVIGATE_NEXT_PANEL: {
          actions: 'navigateNextPanel'
        },
        FOCUS_SEARCH: {
          actions: 'focusSearch'
        },
        SEARCH_IN_FOLDER: {
          actions: 'searchInFolder'
        },
        // Quick open events
        TOGGLE_QUICK_OPEN: {
          actions: ['toggleQuickOpen', 'requestQuickOpenFiles']
        },
        SHOW_QUICK_OPEN: {
          actions: ['showQuickOpen', 'requestQuickOpenFiles']
        },
        HIDE_QUICK_OPEN: {
          actions: ['hideQuickOpen']
        },
        UPDATE_QUICK_OPEN_QUERY: {
          actions: ['updateQuickOpenQuery']
        },
        SELECT_QUICK_OPEN_RESULT: {
          actions: ['selectQuickOpenResult']
        },
        OPEN_QUICK_OPEN_RESULT: {
          actions: ['openQuickOpenResult', 'hideQuickOpen']
        },
        // File actions (hotkeys + UI)
        SAVE_ACTIVE_FILE: {
          actions: 'saveActiveFile'
        },
        CLOSE_ACTIVE_TAB: {
          actions: ['closeActiveTab', 'forceSaveTabsAction']
        },
        CLOSE_TAB: {
          actions: ['closeTab', 'forceSaveTabsAction']
        },
        KILL_TERMINAL: {
          actions: ['killTerminal', 'forceSaveTabsAction']
        },
        RESTORE_PERSISTED_TABS_SETTLED: {
          actions: ['settlePersistedTabsRestore']
        },
        PROMOTE_PREVIEW_TAB: {
          actions: ['promotePreviewTab', 'saveTabsAction']
        }
      }
    }
  }
});

export default codeState;

// Type definitions for parent-child communication
export interface StateUpdate {
  type: 'UPDATE_STATE'
  updates: Partial<CodeContext>
}
