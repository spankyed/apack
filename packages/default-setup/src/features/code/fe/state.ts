import type { Read, Value } from '@apackdev/state';
import {
  canGoBack,
  canGoForward,
  createNavHistory,
  getNextAvailableColor,
  goBack,
  goForward,
  loadTabGroups,
  processHotkeys,
  pushNavHistory,
  saveTabGroups,
  surfaceStorage,
  type HotkeyEvent,
  type HotkeysMap,
  type SurfaceChrome,
  type TabGroup,
  type TabGroupColor,
} from '@apackdev/sdk/fe';
import type { KeyboardShortcut } from '@apackdev/sdk/types';
import { ref as featureRef } from '#generated/ref.ts';
import { state } from '#generated/state.ts';
import type { CodeSettings } from '#generated/types.ts';
import type { OutgoingCodeEvents } from '#features/code/be/contract.ts';
import type {
  ActionTab,
  CodeContext,
  CodeInboxEvent,
  OpenFile,
  PanelType,
  PromptTab,
  TerminalTab,
} from './contract.ts';
export type { OpenFile, TerminalTab, QuickOpenResult, PanelType, CodeContext } from './contract.ts';
export type { TabGroupColor, TabGroup };

import { saveOpenTabs, loadPersistedTabs, sortTabsByPinned } from './utils/persisted-tabs.ts';
import { terminalNameFor } from './utils/terminal-name.ts';
import { loadRecentFiles, addRecentFile } from './utils/recent-files.ts';
import {
  pushTabViewHistory,
  nextActiveFromHistory,
  removeTabs,
  renameInTabViewHistory,
} from './utils/tab-management.ts';
import { diffTab, diffTabPath, refreshedDiffTab } from './utils/diff-tabs.ts';
import { imageExtensions, videoExtensions } from './utils/file-icons.ts';
import { terminalPool, viewSettingsOf } from './utils/terminal-pool.ts';

// Child state machines
import { explorerState, type CodeExplorerReport } from './features/explorer/state.ts';
import { searchState } from './features/search/state.ts';
import { commitState, type CommitReport, type OpenDiffRef } from './features/commit/state.ts';
import { pullRequestState, type CodePullRequestReport } from './features/pull-request/state.ts';
import { terminalState, type CodeTerminalEvent, type CodeTerminalReport, type TerminalInfo } from './features/terminal/state.ts';
import { actionsState, type CodeActionsReport } from './features/actions/state.ts';
import { promptsState, type CodePromptsReport } from './features/prompts/state.ts';
import { githubState } from './features/github/state.ts';

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('code'));

export const id = 'code' as const;

// Module-level callback for getting editor selection text.
// Set by canvas.vue so the state machine can read Monaco selection without Vue refs.
let _editorSelectionGetter: (() => string) | null = null;
export function setEditorSelectionGetter(getter: (() => string) | null) {
  _editorSelectionGetter = getter;
}

const ALL_PANELS: PanelType[] = ['explorer', 'search', 'commit', 'pr', 'actions', 'prompts'];

type CodeTab = OpenFile | TerminalTab | ActionTab | PromptTab;

/** IDs of terminals currently open as canvas tabs */
function getTabbedTerminalIds(openFiles: readonly Read<CodeTab>[]): Set<string> {
  return new Set(openFiles.filter((f: any) => f.isTerminal).map((f: any) => f.terminalInfo.id));
}

/** Unstaged diff tabs are editable (right side = working tree). PR diffs are read-only. */
export function isEditableDiff(
  file: OpenFile | { isDiff?: boolean; isPrDiff?: boolean; gitFile?: { staged: boolean } },
): boolean {
  if ('isPrDiff' in file && file.isPrDiff) return false;
  return file.isDiff === true && file.gitFile?.staged === false;
}

function openDiffRefsOf(openFiles: readonly Read<CodeTab>[]): OpenDiffRef[] {
  return openFiles
    .filter(
      (f): f is Read<OpenFile> =>
        Boolean(f.isDiff && 'gitFile' in f && f.gitFile && !('isPrDiff' in f && f.isPrDiff)),
    )
    .map((f) => ({ tab: f.path, path: f.gitFile!.path, staged: f.gitFile!.staged }));
}

function createTerminalTab(info: Read<TerminalInfo>): TerminalTab {
  return {
    path: `terminal:${info.id}`,
    content: '',
    originalContent: '',
    modified: false,
    isTerminal: true,
    terminalInfo: info as TerminalInfo,
  };
}

// Insert a newly-restored tab into its persisted slot. Non-persisted tabs go to the end.
function insertByPersistedOrder<T extends { path: string }>(
  openFiles: T[],
  newTab: T,
  pendingOrder: ReadonlyArray<{ path: string; order: number }>,
): T[] {
  const orderMap = new Map(pendingOrder.map((t) => [t.path, t.order]));
  const newOrder = orderMap.get(newTab.path);

  if (newOrder === undefined) {
    return [...openFiles, newTab];
  }

  const insertAt = openFiles.findIndex((f) => {
    const o = orderMap.get(f.path);
    return o !== undefined && o > newOrder;
  });

  if (insertAt === -1) {
    return [...openFiles, newTab];
  }

  return [...openFiles.slice(0, insertAt), newTab, ...openFiles.slice(insertAt)];
}

function deleteEmptyGroups(
  openFiles: readonly Read<CodeTab>[],
  tabGroups: readonly Read<TabGroup>[],
  targetGroupId?: string,
): TabGroup[] {
  if (!targetGroupId) return tabGroups as TabGroup[];
  const remaining = openFiles.filter((f) => 'groupId' in f && f.groupId === targetGroupId);
  if (remaining.length === 0) {
    return (tabGroups as TabGroup[]).filter((g) => g.id !== targetGroupId);
  }
  return tabGroups as TabGroup[];
}

function groupIdsForOpenTabs(openFiles: readonly Read<CodeTab>[]): Set<string> {
  return new Set(
    openFiles
      .map((file) => ('groupId' in file ? file.groupId : undefined))
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0),
  );
}

/**
 * The groups still named by a tab: one that is open, **or one a restore is still expecting**.
 */
function pruneEmptyTabGroups(
  openFiles: readonly Read<CodeTab>[],
  tabGroups: readonly Read<TabGroup>[],
  stillExpected: Read<CodeContext['pendingPersistedMetadata']>,
): TabGroup[] {
  const groupIds = groupIdsForOpenTabs(openFiles);
  for (const metadata of stillExpected?.values() ?? []) {
    if (metadata.groupId) groupIds.add(metadata.groupId);
  }
  return (tabGroups as TabGroup[]).filter((group) => groupIds.has(group.id));
}

function prunePersistedTabGroups(groups: TabGroup[], tabs: Array<{ groupId?: string }>): TabGroup[] {
  const groupIds = new Set(
    tabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0),
  );
  return groups.filter((group) => groupIds.has(group.id));
}

function unarrivedPaths(data: Read<CodeContext>): ReadonlySet<string> {
  const expected = data.pendingPersistedMetadata;
  if (!expected || expected.size === 0) return new Set();
  const open = new Set(data.openFiles.map((file) => file.path));
  return new Set([...expected.keys()].filter((path) => !open.has(path)));
}

/**
 * Writes this window's tab layout, **if this window is the one that keeps it** (M5).
 */
function persistCodeTabs(data: Read<CodeContext>): void {
  if (!data.ownsAppLayout) return;
  const stillExpected = unarrivedPaths(data);
  const tabGroups = pruneEmptyTabGroups(data.openFiles, data.tabGroups, data.pendingPersistedMetadata);
  saveOpenTabs(
    data.openFiles as CodeTab[],
    data.activeFilePath,
    data.panelTerminalId,
    data.panelTerminalExpanded,
    stillExpected,
  );
  saveTabGroups(storage, 'tab-groups', tabGroups);
}

function saveTabs(data: Read<CodeContext>, force = false): void {
  if (!data.tabsRestored) return;
  if (!force && data.pendingTabOrder !== undefined) return;
  persistCodeTabs(data);
}

function finalizeRestoreState(data: Read<CodeContext>): Partial<CodeContext> {
  if (
    data.pendingTabOrder === undefined &&
    data.pendingPersistedMetadata === undefined &&
    data.pendingTerminalTabIds === undefined
  ) {
    return {};
  }

  const openPaths = new Set(data.openFiles.map((file) => file.path));
  const stillExpected = new Map(
    [...(data.pendingPersistedMetadata ?? [])].filter(([path]) => !openPaths.has(path)),
  ) as Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>;
  const activeFilePath =
    data.activeFilePath && openPaths.has(data.activeFilePath)
      ? data.activeFilePath
      : (data.openFiles[0]?.path ?? null);

  return {
    pendingTabOrder: undefined,
    pendingPersistedMetadata: stillExpected.size > 0 ? stillExpected : undefined,
    pendingTerminalTabIds: undefined,
    tabGroups: pruneEmptyTabGroups(data.openFiles, data.tabGroups, stillExpected),
    activeFilePath,
  };
}

function addTabPatch(
  data: Read<CodeContext>,
  tab: any,
  replacePreview?: boolean,
  extraUpdates?: Partial<CodeContext>,
): Partial<CodeContext> {
  const enablePreview = data.settings?.enablePreview ?? true;
  let openFiles: any[] = [...data.openFiles];

  const persistedMetadata = data.pendingPersistedMetadata?.get(tab.path);
  const incomingTab = persistedMetadata
    ? {
        ...tab,
        groupId: persistedMetadata.groupId,
        isPinned: persistedMetadata.isPinned,
        isPreview: persistedMetadata.isPreview,
      }
    : tab;
  const isRestoring = persistedMetadata !== undefined;

  const existingIndex = openFiles.findIndex((f: any) => f.path === incomingTab.path);

  if (existingIndex >= 0) {
    openFiles[existingIndex] = { ...openFiles[existingIndex], ...incomingTab };
  } else {
    const isSpecialTab = incomingTab.isTerminal || incomingTab.isAction || incomingTab.isPrompt;
    const shouldPreview = !isRestoring && enablePreview && !isSpecialTab && !replacePreview;

    if (shouldPreview || replacePreview) {
      openFiles = openFiles.filter((f: any) => !f.isPreview);
    }

    const newTab = shouldPreview ? { ...incomingTab, isPreview: true } : incomingTab;
    openFiles = data.pendingTabOrder
      ? insertByPersistedOrder(openFiles, newTab, data.pendingTabOrder)
      : sortTabsByPinned([...openFiles, newTab]);
  }

  let pendingPersistedMetadata = data.pendingPersistedMetadata
    ? (new Map(data.pendingPersistedMetadata) as Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>)
    : undefined;
  if (persistedMetadata && pendingPersistedMetadata) {
    pendingPersistedMetadata.delete(incomingTab.path);
    if (pendingPersistedMetadata.size === 0) pendingPersistedMetadata = undefined;
  }

  let pendingTabOrder = data.pendingTabOrder ? [...data.pendingTabOrder] : undefined;
  if (pendingTabOrder) {
    const openPaths = new Set(openFiles.map((f) => f.path));
    if (pendingTabOrder.every((t) => openPaths.has(t.path))) {
      pendingTabOrder = undefined;
    }
  }

  let activeFilePath = isRestoring
    ? data.activeFilePath
    : (extraUpdates && 'activeFilePath' in extraUpdates ? extraUpdates.activeFilePath! : incomingTab.path);

  const justFinishedRestore = pendingTabOrder === undefined && data.pendingTabOrder !== undefined;
  if (justFinishedRestore && openFiles.length > 0 && !openFiles.some((f) => f.path === activeFilePath)) {
    activeFilePath = openFiles[0].path;
  }

  const tabGroups =
    pendingTabOrder === undefined
      ? pruneEmptyTabGroups(openFiles, data.tabGroups, pendingPersistedMetadata)
      : (data.tabGroups as TabGroup[]);

  return {
    ...extraUpdates,
    openFiles,
    activeFilePath,
    pendingPersistedMetadata,
    pendingTabOrder,
    tabGroups,
    tabViewHistory: activeFilePath
      ? pushTabViewHistory(data.tabViewHistory as string[], activeFilePath)
      : (data.tabViewHistory as string[]),
  };
}

function removeTabPatch(data: Read<CodeContext>, path: string): Partial<CodeContext> {
  const file = data.openFiles.find((f) => f.path === path);
  const newOpenFiles = (data.openFiles as CodeTab[]).filter((f) => f.path !== path);
  const newActiveFilePath =
    data.activeFilePath === path
      ? nextActiveFromHistory(data.tabViewHistory as string[], newOpenFiles)
      : data.activeFilePath;

  const groupId = file && 'groupId' in file ? (file as any).groupId : undefined;
  let newTabGroups = data.tabGroups as TabGroup[];
  if (groupId) {
    const remaining = newOpenFiles.filter((f) => 'groupId' in f && (f as any).groupId === groupId);
    if (remaining.length === 0) newTabGroups = newTabGroups.filter((g) => g.id !== groupId);
  }

  const pendingTabOrder = data.pendingTabOrder?.filter((tab) => tab.path !== path);
  let pendingPersistedMetadata = data.pendingPersistedMetadata
    ? (new Map(data.pendingPersistedMetadata) as Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>)
    : undefined;
  if (pendingPersistedMetadata?.has(path)) {
    pendingPersistedMetadata.delete(path);
    if (pendingPersistedMetadata.size === 0) pendingPersistedMetadata = undefined;
  }

  const openPaths = new Set(newOpenFiles.map((f) => f.path));
  const tabViewHistory = (data.tabViewHistory as string[]).filter((p) => openPaths.has(p));

  return {
    openFiles: newOpenFiles,
    activeFilePath: newActiveFilePath,
    tabGroups: newTabGroups,
    tabViewHistory,
    pendingTabOrder: pendingTabOrder && pendingTabOrder.length > 0 ? pendingTabOrder : undefined,
    pendingPersistedMetadata,
  };
}

function extractHotkeys(settings: CodeSettings | undefined, fallback: Read<HotkeysMap>): HotkeysMap {
  const hotkeys: HotkeysMap = {};
  if (settings?.hotkeys) {
    for (const [key, value] of Object.entries(settings.hotkeys)) {
      if (value) hotkeys[key] = value as KeyboardShortcut;
    }
  }
  return Object.keys(hotkeys).length > 0 ? hotkeys : ({ ...fallback } as HotkeysMap);
}

type CodeChildReports =
  | (CodeActionsReport & { from?: string })
  | (CodePromptsReport & { from?: string })
  | (CodeExplorerReport & { from?: string })
  | (CodeTerminalReport & { from?: string })
  | (CommitReport & { from?: string })
  | (CodePullRequestReport & { from?: string });

export type CodeEvent =
  | OutgoingCodeEvents
  | CodeInboxEvent
  | CodeChildReports
  | Extract<
      CodeTerminalEvent,
      { type: 'terminal.CLOSE' | 'terminal.RESTART' | 'terminal.INPUT' | 'terminal.RESIZE' | 'terminal.REFRESH_LIST' }
    >
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: CodeSettings }
  | { type: 'ADD_TAB'; tab: any; replacePreview?: boolean; extraUpdates?: Partial<CodeContext> }
  | { type: 'SURFACE_ACTIVATED' }
  | { type: 'SURFACE_DEACTIVATED' }
  | { type: 'SURFACE_STARTED'; ownsAppLayout?: boolean }
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
  | { type: 'RESTORE_PERSISTED_TABS_SETTLED' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' };

type CodeShape = {
  data: CodeContext;
  calls: {
    codeStart: 'one';
  };
  starts: {
    explorer: typeof explorerState;
    terminal: typeof terminalState;
    search: typeof searchState;
    commit: typeof commitState;
    pr: typeof pullRequestState;
    codeActions: typeof actionsState;
    codePrompts: typeof promptsState;
    github: typeof githubState;
  };
  states: {
    canvas: {};
  };
};

export const codeChrome: SurfaceChrome<Value<CodeShape>> = {
  default: { label: 'Code', target: 'canvas' },
  states: {
    canvas: {
      breadcrumb: { label: 'Code', target: 'canvas' },
    },
  },
};

const codeState = state<CodeShape, CodeEvent>()({
  initial: 'canvas',
  data: {
    ownsAppLayout: true,
    baseDirectory: '',
    openFiles: [],
    activeFilePath: null,
    isLoading: false,
    error: null,
    selectedPanel: 'explorer' as PanelType,
    tabsRestored: false,
    pendingTabOrder: undefined,
    pendingPersistedMetadata: undefined,
    tabGroups: [],
    isQuickOpenVisible: false,
    quickOpenQuery: '',
    quickOpenResults: [],
    quickOpenSelectedIndex: 0,
    quickOpenLoading: false,
    recentlyOpenedFiles: [],
    tabViewHistory: [],
    hotkeys: {},
    settings: undefined,
    pendingRevealLine: null,
    searchFocusTrigger: 0,
    searchPrefillText: '',
    panelTerminalId: null,
    panelTerminalExpanded: false,
    pendingTerminalTabIds: undefined,
    panelNavHistory: createNavHistory('explorer' as PanelType),
  },
  starts: () => ({
    explorer: explorerState,
    terminal: terminalState,
    search: searchState,
    commit: commitState,
    pr: pullRequestState,
    codeActions: actionsState,
    codePrompts: promptsState,
    github: githubState,
  }),
  /**
   * Owns the terminal pool lifecycle, window focus external-change checks, and the persisted-tab restore settle timer.
   * Stopping the surface disposes every pooled emulator and removes every listener and timer cleanly.
   */
  listen: ({ send, tell }) => {
    const checkExternal = () => {
      tell('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES', by: 'window' });
    };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('focus', checkExternal);

    const settleTimer = hasWindow
      ? window.setTimeout(() => {
          send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' });
        }, 2500)
      : undefined;

    return () => {
      if (hasWindow) window.removeEventListener('focus', checkExternal);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      terminalPool.disposeAll();
    };
  },
  /** Restores persisted tabs on surface startup */
  run: ({ tell, child }) => {
    const {
      tabs: persistedTabs,
      activeFilePath: persistedActive,
      panelTerminalId: persistedPanelTerminal,
      panelTerminalExpanded: persistedExpanded,
    } = loadPersistedTabs();
    const persistedGroups = prunePersistedTabGroups(loadTabGroups(storage, 'tab-groups'), persistedTabs);

    const tabOrder = persistedTabs.map((tab) => ({ path: tab.path, order: tab.order }));
    const metadataMap = new Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>();
    for (const tab of persistedTabs) {
      metadataMap.set(tab.path, {
        groupId: tab.groupId,
        isPinned: tab.isPinned,
        isPreview: tab.isPreview,
      });
    }

    const persistedPaths = new Set(persistedTabs.map((t) => t.path));
    const restoredActive =
      persistedActive && persistedPaths.has(persistedActive) ? persistedActive : (persistedTabs[0]?.path ?? null);

    const terminalTabIds = persistedTabs.filter((t) => t.type === 'terminal').map((t) => t.terminalId!);
    const restoredPanelTerminal =
      persistedPanelTerminal && terminalTabIds.includes(persistedPanelTerminal) ? null : persistedPanelTerminal;

    if (persistedTabs.length > 0) {
      const fileTabs = persistedTabs.filter((tab) => tab.type === 'file');
      const terminalTabs = persistedTabs.filter((tab) => tab.type === 'terminal');
      const actionTabs = persistedTabs.filter((tab) => tab.type === 'action');
      const promptTabs = persistedTabs.filter((tab) => tab.type === 'prompt');

      console.log('[Code Surface] tabs to restore:', {
        actionCount: actionTabs.length,
        fileCount: fileTabs.length,
        terminalCount: terminalTabs.length,
        promptCount: promptTabs.length,
        totalCount: persistedTabs.length,
      });

      if (fileTabs.length > 0) {
        tell(child('explorer'), { type: 'explorer.OPEN_FILES', paths: fileTabs.map((t) => t.path) });
      }
      if (actionTabs.length > 0) {
        tell(child('codeActions'), { type: 'codeActions.OPEN_TABS', actionIds: actionTabs.map((t) => t.actionId!) });
      }
      if (promptTabs.length > 0) {
        tell(child('codePrompts'), { type: 'codePrompts.OPEN_TABS', promptIds: promptTabs.map((t) => t.promptId!) });
      }
    }

    return {
      data: {
        tabsRestored: true,
        pendingTabOrder: tabOrder.length > 0 ? tabOrder : undefined,
        pendingPersistedMetadata: metadataMap.size > 0 ? metadataMap : undefined,
        tabGroups: persistedGroups,
        activeFilePath: restoredActive,
        panelTerminalId: restoredPanelTerminal,
        panelTerminalExpanded: restoredPanelTerminal ? persistedExpanded : false,
        pendingTerminalTabIds: terminalTabIds.length > 0 ? terminalTabIds : undefined,
      },
    };
  },
  calls: ({ one }) => ({
    codeStart: one('code', 'GET_CODE_START', {
      done: (outcome, { data, tell, child }) => {
        if (!outcome.ok) return;
        const started = outcome.value;
        const baseDirectory = started.baseDirectory || '';
        const hotkeys = extractHotkeys(started.settings, data.hotkeys);

        terminalPool.setCopyOnSelect(started.settings?.copyOnSelect === true);
        terminalPool.setViewSettings(viewSettingsOf(started.settings));

        // Hand the start to every child panel
        tell(child('explorer'), { type: 'CODE_STARTED', data: { baseDirectory: started.baseDirectory ?? null } });
        tell(child('terminal'), { type: 'CODE_STARTED', baseDirectory, settings: started.settings });
        tell(child('search'), { type: 'CODE_STARTED', baseDirectory });
        tell(child('commit'), { type: 'CODE_STARTED', directory: baseDirectory });
        tell(child('pr'), { type: 'CODE_STARTED', baseDirectory });

        return {
          data: {
            baseDirectory,
            recentlyOpenedFiles: loadRecentFiles(baseDirectory),
            settings: started.settings,
            hotkeys,
          },
        };
      },
    }),
  }),
  on: {
    // ── Lifecycle & settings ───────────────────────────────────────────────────────────
    SURFACE_STARTED: (event, { cancel, call }) => {
      cancel('codeStart');
      call('codeStart');
      return { data: { ownsAppLayout: event.ownsAppLayout !== false } };
    },
    BASE_DIRECTORY_CHANGED: (_event, { cancel, call }) => {
      cancel('codeStart');
      call('codeStart');
    },
    CLI_TEST_RESULT: () => {},
    FEATURE_SETTINGS_UPDATED: ({ settings }, { data, tell, child }) => {
      const hotkeys = extractHotkeys(settings, data.hotkeys);
      terminalPool.setCopyOnSelect(settings?.copyOnSelect === true);
      terminalPool.setViewSettings(viewSettingsOf(settings));
      tell(child('terminal'), { type: 'SYNC_SETTINGS', settings });
      return { data: { settings, hotkeys } };
    },
    SURFACE_ACTIVATED: (_event, { tell, child }) => {
      tell(child('terminal'), { type: 'terminal.REFRESH_LIST' });
      tell(child('commit'), { type: 'commit.SHOWN' });
    },
    SURFACE_DEACTIVATED: (_event, { tell, child }) => {
      tell(child('commit'), { type: 'commit.HIDDEN' });
    },

    // ── Routed inbox & backend events to children ─────────────────────────────────────
    'terminal.CREATE': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.CLOSE': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.RESTART': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.INPUT': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.RESIZE': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.REFRESH_LIST': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'explorer.SET_BASE_DIRECTORY': (event, { tell, child }) => {
      tell(child('explorer'), event);
    },
    'codeActions.OPEN_ACTION': (event, { tell, child }) => {
      tell(child('codeActions'), event);
    },
    'codePrompts.OPEN_PROMPT': (event, { tell, child }) => {
      tell(child('codePrompts'), event);
    },
    'explorer.FILE_CHANGED_EXTERNALLY': (ev, { data, tell, child }) => {
      const file = data.openFiles.find((f) => f.path === ev.data.path);
      if (!file || file.isDiff || ev.data.changeType === 'unlink') return;

      const updatedFiles = (data.openFiles as CodeTab[]).map((f) => {
        if (f.path === ev.data.path && !f.isDiff) {
          return {
            ...f,
            externallyModified: true,
            externalModificationTime: ev.data.modifiedAt,
            pendingSaveConflict: f.modified,
          };
        }
        return f;
      });

      if (!file.modified) {
        tell(child('explorer'), { type: 'explorer.OPEN_FILE', path: ev.data.path });
      }
      const nextData = { ...data, openFiles: updatedFiles };
      saveTabs(nextData);
      return { data: { openFiles: updatedFiles } };
    },
    'commit.REPOSITORY_CHANGED': (event, { tell, child }) => {
      tell(child('commit'), event);
    },
    'commit.GENERATING_MESSAGE': (event, { tell, child }) => {
      tell(child('commit'), event);
    },
    'commit.MESSAGE_GENERATED': (event, { tell, child }) => {
      tell(child('commit'), event);
    },
    'commit.MESSAGE_NOT_GENERATED': (event, { tell, child }) => {
      tell(child('commit'), event);
    },
    'pr.GIT_STATUS_REFRESHED': (event, { tell, child }) => {
      tell(child('pr'), event);
    },
    'terminal.CREATED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.CLIPBOARD': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.BELL': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.NOTIFIED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.PROGRESS': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.TITLED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.CLOSED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.CRASHED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.RESIZED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.RESTARTED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.RENAMED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.CWD_CHANGED': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.KEPT': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.STATUS': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'github.ACCOUNT_CHANGED': (event, { tell, child }) => {
      tell(child('github'), event);
    },

    // ── Reports from children ─────────────────────────────────────────────────────────
    CODE_ACTIONS_SHOW_TAB: ({ tab }, { data }) => {
      if (data.openFiles.some((f) => f.path === tab.path)) {
        const next: Partial<CodeContext> = {
          activeFilePath: tab.path,
          tabViewHistory: pushTabViewHistory(data.tabViewHistory as string[], tab.path),
        };
        saveTabs({ ...data, ...next });
        return { data: next };
      }
      const patch = addTabPatch(data, tab, true);
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    CODE_ACTIONS_ACTION_SAVED: ({ action }, { data }) => {
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        'isAction' in file && file.isAction && file.actionEntity.id === action.id
          ? { ...file, actionEntity: action, modified: false }
          : file,
      );
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    CODE_PROMPTS_SHOW_TAB: ({ tab }, { data }) => {
      if (data.openFiles.some((f) => f.path === tab.path)) {
        const next: Partial<CodeContext> = {
          activeFilePath: tab.path,
          tabViewHistory: pushTabViewHistory(data.tabViewHistory as string[], tab.path),
        };
        saveTabs({ ...data, ...next });
        return { data: next };
      }
      const patch = addTabPatch(data, tab, true);
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    CODE_PROMPTS_PROMPT_SAVED: ({ prompt }, { data }) => {
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        'isPrompt' in file && file.isPrompt && file.promptEntity.id === prompt.id
          ? { ...file, promptEntity: prompt, modified: false }
          : file,
      );
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    EXPLORER_LOADING: () => ({ data: { isLoading: true, error: null } }),
    EXPLORER_LISTED: () => ({ data: { isLoading: false, error: null } }),
    EXPLORER_FILE_READ: ({ file, editorMode }, { data, tell, child }) => {
      const existingFile = data.openFiles.find((f) => f.path === file.path);
      const MAX_RICH_TEXT_SIZE = 300 * 1024;
      const ext = file.path.split('.').pop()?.toLowerCase() || '';
      const mdEditorDefault = data.settings?.mdEditorDefault ?? false;
      const isRichText =
        editorMode === 'plainText'
          ? false
          : (editorMode === 'richText' || (mdEditorDefault && ext === 'md')) &&
            (file.size ?? 0) < MAX_RICH_TEXT_SIZE;

      const updatedRecentFiles = addRecentFile(data.recentlyOpenedFiles as string[], file.path, data.baseDirectory);
      const isImageFile = !existingFile && imageExtensions.includes(ext);
      const isVideoFile = !existingFile && videoExtensions.includes(ext);
      const tab = {
        path: file.path,
        content: file.content,
        originalContent: file.content,
        modified: false,
        isRichText,
        _richTextBaselineSet: false,
        ...(existingFile
          ? {
              externallyModified: false,
              externalModificationTime: undefined,
              pendingSaveConflict: false,
            }
          : {}),
        ...(isImageFile ? { isImage: true } : {}),
        ...(isVideoFile ? { isVideo: true } : {}),
        ...(file.isBinary ? { isBinary: true } : {}),
      };

      const patch = addTabPatch(data, tab, false, {
        isLoading: false,
        recentlyOpenedFiles: updatedRecentFiles,
      });
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next);
      return { data: patch };
    },
    EXPLORER_FILE_SAVED: ({ path }, { data }) => {
      const openFiles = (data.openFiles as CodeTab[]).map((f: any) => {
        const matchesPath = f.path === path || (f.isDiff && f.gitFile?.path === path);
        if (!matchesPath) return f;
        return {
          ...f,
          originalContent: f.content,
          modified: false,
          pendingSaveConflict: false,
          externallyModified: false,
          externalModificationTime: undefined,
        };
      });
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    EXPLORER_FILE_DELETED: ({ path }, { data, tell, child }) => {
      if (!data.openFiles.some((f) => f.path === path)) return;
      const result = removeTabs(data.openFiles as CodeTab[], path, data.activeFilePath);
      const openPaths = new Set(result.openFiles.map((f) => f.path));
      const tabViewHistory = (data.tabViewHistory as string[]).filter((p) => openPaths.has(p));
      const tabGroups =
        data.tabsRestored && data.pendingTabOrder === undefined
          ? pruneEmptyTabGroups(result.openFiles, data.tabGroups, data.pendingPersistedMetadata)
          : (data.tabGroups as TabGroup[]);
      const patch: Partial<CodeContext> = { ...result, tabViewHistory, tabGroups };
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next);
      return { data: patch };
    },
    EXPLORER_FILE_RENAMED: ({ oldPath, newPath }, { data }) => {
      if (!data.openFiles.some((f) => f.path === oldPath)) return;
      const openFiles = (data.openFiles as CodeTab[]).map((f) => (f.path === oldPath ? { ...f, path: newPath } : f));
      const activeFilePath = data.activeFilePath === oldPath ? newPath : data.activeFilePath;
      const tabViewHistory = renameInTabViewHistory(data.tabViewHistory as string[], oldPath, newPath);
      const patch: Partial<CodeContext> = { openFiles, activeFilePath, tabViewHistory };
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    EXPLORER_ERROR: ({ message, notFoundPath }, { data, tell, child }) => {
      if (notFoundPath && data.openFiles.some((f) => f.path === notFoundPath)) {
        const result = removeTabs(data.openFiles as CodeTab[], notFoundPath, data.activeFilePath);
        const openPaths = new Set(result.openFiles.map((f) => f.path));
        const tabViewHistory = (data.tabViewHistory as string[]).filter((p) => openPaths.has(p));
        const tabGroups =
          data.tabsRestored && data.pendingTabOrder === undefined
            ? pruneEmptyTabGroups(result.openFiles, data.tabGroups, data.pendingPersistedMetadata)
            : (data.tabGroups as TabGroup[]);
        const patch: Partial<CodeContext> = { ...result, tabViewHistory, tabGroups, error: null, isLoading: false };
        const next = { ...data, ...patch };
        tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
        saveTabs(next);
        return { data: patch };
      }
      return { data: { error: message, isLoading: false } };
    },
    EXPLORER_BASE_DIRECTORY_SET: ({ path }, { data, tell, child }) => {
      const changed = path && path !== data.baseDirectory;
      if (changed) {
        tell(child('search'), { type: 'search.DIRECTORY_CHANGED', baseDirectory: path });
        tell(child('terminal'), { type: 'SYNC_BASE_DIRECTORY', baseDirectory: path });
        tell(child('pr'), { type: 'SYNC_BASE_DIRECTORY', baseDirectory: path });
      }
      return {
        data: {
          baseDirectory: path,
          ...(changed ? { recentlyOpenedFiles: loadRecentFiles(path) } : {}),
        },
      };
    },
    EXPLORER_QUICK_OPEN_RESULTS: ({ results }) => ({
      data: { quickOpenResults: results, quickOpenLoading: false },
    }),
    EXPLORER_QUICK_OPEN_ERROR: ({ message }) => ({
      data: { error: message, quickOpenLoading: false },
    }),

    TERMINAL_LIST_LOADED: ({ terminals }, { data }) => {
      const pendingTabIds = data.pendingTerminalTabIds;
      let current: Read<CodeContext> = data;
      let patch: Partial<CodeContext> = {};

      if (pendingTabIds && pendingTabIds.length > 0 && terminals.length > 0) {
        const staleTabPaths: string[] = [];
        for (const terminalId of pendingTabIds) {
          const info = terminals.find((t) => t.id === terminalId);
          if (info) {
            const added = addTabPatch(current, createTerminalTab(info), false, {
              activeFilePath: current.activeFilePath,
            });
            patch = { ...patch, ...added };
            current = { ...current, ...added };
          } else {
            staleTabPaths.push(`terminal:${terminalId}`);
          }
        }
        if (staleTabPaths.length > 0 && current.pendingTabOrder) {
          const filtered = current.pendingTabOrder.filter((t) => !staleTabPaths.includes(t.path));
          patch.pendingTabOrder = filtered.length > 0 ? filtered : undefined;
          current = { ...current, pendingTabOrder: patch.pendingTabOrder };
        }
        patch.pendingTerminalTabIds = undefined;
      }

      const tabbedIds = getTabbedTerminalIds(current.openFiles);
      if (pendingTabIds) {
        for (const tid of pendingTabIds) tabbedIds.add(tid);
      }

      const currentPanelId = current.panelTerminalId;
      const panelTerminalExists = currentPanelId && terminals.some((t) => t.id === currentPanelId);
      const panelTerminalIsTabbed = currentPanelId ? tabbedIds.has(currentPanelId) : false;

      if ((!currentPanelId || !panelTerminalExists || panelTerminalIsTabbed) && terminals.length > 0) {
        const available = terminals.find((t) => !tabbedIds.has(t.id));
        if (available) {
          patch.panelTerminalId = available.id;
        } else if (!panelTerminalExists || panelTerminalIsTabbed) {
          patch.panelTerminalId = null;
        }
      }

      if (Object.keys(patch).length === 0) return;
      saveTabs({ ...current, ...patch });
      return { data: patch };
    },
    TERMINAL_CREATED_FOR_WINDOW: ({ terminalInfo, target }, { data }) => {
      if (target === 'tab') {
        const patch = addTabPatch(data, createTerminalTab(terminalInfo));
        saveTabs({ ...data, ...patch });
        return { data: patch };
      }
      const patch: Partial<CodeContext> = {
        panelTerminalId: terminalInfo.id,
        panelTerminalExpanded: true,
      };
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    TERMINAL_CLOSED_REPORT: ({ terminalId, remainingTerminals }, { data }) => {
      const terminalPath = `terminal:${terminalId}`;
      const result = removeTabs(data.openFiles as CodeTab[], terminalPath, data.activeFilePath);
      if (data.activeFilePath === terminalPath && result.openFiles.length > 0) {
        result.activeFilePath = nextActiveFromHistory(data.tabViewHistory as string[], result.openFiles);
      }
      const openPaths = new Set(result.openFiles.map((f) => f.path));
      const tabViewHistory = (data.tabViewHistory as string[]).filter((p) => openPaths.has(p));
      const tabGroups =
        data.tabsRestored && data.pendingTabOrder === undefined
          ? pruneEmptyTabGroups(result.openFiles, data.tabGroups, data.pendingPersistedMetadata)
          : (data.tabGroups as TabGroup[]);

      let panelUpdate: Partial<CodeContext> = {};
      if (data.panelTerminalId === terminalId) {
        const tabbedIds = getTabbedTerminalIds(result.openFiles);
        const next = remainingTerminals.find((t) => t.id !== terminalId && !tabbedIds.has(t.id));
        panelUpdate = { panelTerminalId: next?.id ?? null };
      }

      const patch: Partial<CodeContext> = { ...result, tabViewHistory, tabGroups, ...panelUpdate };
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    TERMINAL_TAB_INFO_CHANGED: ({ terminalId, changes }, { data }) => {
      const terminalPath = `terminal:${terminalId}`;
      let changed = false;
      const openFiles = (data.openFiles as CodeTab[]).map((file: any) => {
        if (file.path === terminalPath && file.isTerminal) {
          changed = true;
          return { ...file, terminalInfo: { ...file.terminalInfo, ...changes } };
        }
        return file;
      });
      if (!changed) return;
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    TERMINAL_OPEN_TAB_REQUEST: ({ terminalInfo, preserveActive }, { data }) => {
      const terminalPath = `terminal:${terminalInfo.id}`;
      const exists = data.openFiles.some((f) => f.path === terminalPath);
      if (exists) {
        if (preserveActive) return;
        const next: Partial<CodeContext> = {
          activeFilePath: terminalPath,
          tabViewHistory: pushTabViewHistory(data.tabViewHistory as string[], terminalPath),
        };
        saveTabs({ ...data, ...next });
        return { data: next };
      }
      const patch = addTabPatch(
        data,
        createTerminalTab(terminalInfo),
        false,
        preserveActive ? { activeFilePath: data.activeFilePath } : undefined,
      );
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },

    OPEN_DIFF_TAB: ({ diff }, { data, tell, child }) => {
      const patch = addTabPatch(data, diffTab(diff));
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next);
      return { data: patch };
    },
    ACTIVATE_DIFF_TAB: ({ tab }, { data }) => {
      const next: Partial<CodeContext> = {
        activeFilePath: tab,
        tabViewHistory: pushTabViewHistory(data.tabViewHistory as string[], tab),
      };
      saveTabs({ ...data, ...next });
      return { data: next };
    },
    REFRESH_DIFF_TAB: ({ diff }, { data }) => {
      const tabPath = diffTabPath(diff);
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === tabPath ? refreshedDiffTab(file as OpenFile, diff) : file,
      );
      return { data: { openFiles } };
    },
    OPEN_FILE_TAB: ({ file }, { data, tell, child }) => {
      if (file.status === 'deleted') {
        const deletedTab = {
          path: `deleted:${file.path}`,
          content: '',
          originalContent: '',
          modified: false,
          isDeleted: true,
          deletedFilePath: file.path,
        };
        const patch = addTabPatch(data, deletedTab);
        saveTabs({ ...data, ...patch });
        return { data: patch };
      }
      const baseDirectory = data.baseDirectory;
      const fullPath = file.path.startsWith('/')
        ? file.path
        : baseDirectory.endsWith('/')
          ? baseDirectory + file.path
          : baseDirectory + '/' + file.path;
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: false });
      tell(child('explorer'), { type: 'explorer.OPEN_FILE', path: fullPath });
      return { data: { selectedPanel: 'explorer' } };
    },

    PR_OPEN_DIFF_TAB: ({ tab }, { data }) => {
      const patch = addTabPatch(data, tab);
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    PR_OPEN_FILE: ({ path }, { tell, child }) => {
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: false });
      tell(child('explorer'), { type: 'explorer.OPEN_FILE', path });
      return { data: { selectedPanel: 'explorer' } };
    },
    PR_SELECT_PANEL: ({ panel }, { tell, child }) => {
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: panel === 'pr' });
      return { data: { selectedPanel: panel } };
    },

    // ── Surface UI events ─────────────────────────────────────────────────────────────
    ADD_TAB: ({ tab, replacePreview, extraUpdates }, { data, tell, child }) => {
      const patch = addTabPatch(data, tab, replacePreview, extraUpdates);
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next);
      return { data: patch };
    },
    UPDATE_STATE: ({ updates }, { data, tell, child }) => {
      const merged: Record<string, any> = { ...data, ...updates };

      if (updates.baseDirectory && updates.baseDirectory !== data.baseDirectory) {
        merged.recentlyOpenedFiles = loadRecentFiles(updates.baseDirectory);
        tell(child('search'), { type: 'search.DIRECTORY_CHANGED', baseDirectory: updates.baseDirectory });
        tell(child('terminal'), { type: 'SYNC_BASE_DIRECTORY', baseDirectory: updates.baseDirectory });
        tell(child('pr'), { type: 'SYNC_BASE_DIRECTORY', baseDirectory: updates.baseDirectory });
      }

      if (updates.selectedPanel !== undefined && updates.selectedPanel !== data.selectedPanel) {
        tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: updates.selectedPanel === 'pr' });
      }

      if (updates.openFiles && updates.openFiles.length < data.openFiles.length) {
        const openPaths = new Set(merged.openFiles.map((f: any) => f.path));
        merged.tabViewHistory = (merged.tabViewHistory ?? data.tabViewHistory).filter((p: string) =>
          openPaths.has(p),
        );
      }

      if (merged.activeFilePath && merged.activeFilePath !== data.activeFilePath) {
        if (!updates.tabViewHistory) {
          merged.tabViewHistory = pushTabViewHistory(
            merged.tabViewHistory ?? data.tabViewHistory,
            merged.activeFilePath,
          );
        }
      }

      if (merged.tabsRestored && merged.pendingTabOrder === undefined) {
        merged.tabGroups = pruneEmptyTabGroups(merged.openFiles, merged.tabGroups, merged.pendingPersistedMetadata);
      }

      if (updates.openFiles !== undefined) {
        tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(merged.openFiles) });
      }

      saveTabs(merged as Read<CodeContext>);
      return { data: merged as CodeContext };
    },

    SELECT_PANEL: ({ panel }, { data, tell, child }) => {
      if (!ALL_PANELS.includes(panel)) {
        tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: false });
        tell(child('commit'), { type: 'commit.HIDDEN' });
        return { data: { selectedPanel: 'explorer' } };
      }
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: panel === 'pr' });
      tell(child('commit'), { type: panel === 'commit' ? 'commit.SHOWN' : 'commit.HIDDEN' });
      if (panel === 'commit') tell(child('commit'), { type: 'commit.REFRESH_STATUS' });
      else if (panel === 'pr') tell(child('pr'), { type: 'pr.REFRESH_STATUS' });

      return {
        data: {
          selectedPanel: panel,
          panelNavHistory: pushNavHistory(data.panelNavHistory, panel),
        },
      };
    },
    NAVIGATE_BACK: (_event, { data, tell, child }) => {
      if (!canGoBack(data.panelNavHistory)) return;
      const result = goBack(data.panelNavHistory)!;
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: result.entry === 'pr' });
      tell(child('commit'), { type: result.entry === 'commit' ? 'commit.SHOWN' : 'commit.HIDDEN' });
      if (result.entry === 'commit') tell(child('commit'), { type: 'commit.REFRESH_STATUS' });
      else if (result.entry === 'pr') tell(child('pr'), { type: 'pr.REFRESH_STATUS' });
      return { data: { panelNavHistory: result.history, selectedPanel: result.entry } };
    },
    NAVIGATE_FORWARD: (_event, { data, tell, child }) => {
      if (!canGoForward(data.panelNavHistory)) return;
      const result = goForward(data.panelNavHistory)!;
      tell(child('pr'), { type: 'SYNC_PANEL_SHOWN', isPanelShown: result.entry === 'pr' });
      tell(child('commit'), { type: result.entry === 'commit' ? 'commit.SHOWN' : 'commit.HIDDEN' });
      if (result.entry === 'commit') tell(child('commit'), { type: 'commit.REFRESH_STATUS' });
      else if (result.entry === 'pr') tell(child('pr'), { type: 'pr.REFRESH_STATUS' });
      return { data: { panelNavHistory: result.history, selectedPanel: result.entry } };
    },

    // ── Tab pinning & groups ──────────────────────────────────────────────────────────
    PROMOTE_PREVIEW_TAB: ({ path }, { data }) => {
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === path ? { ...file, isPreview: false } : file,
      );
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    PIN_TAB: ({ path }, { data }) => {
      const tab = data.openFiles.find((f) => f.path === path);
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined;
      const updatedFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === path ? { ...file, isPinned: true, groupId: undefined, isPreview: false } : file,
      );
      const tabGroups = deleteEmptyGroups(updatedFiles, data.tabGroups, groupId);
      const openFiles = [...updatedFiles.filter((t) => t.isPinned), ...updatedFiles.filter((t) => !t.isPinned)];
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    UNPIN_TAB: ({ path }, { data }) => {
      const tab = data.openFiles.find((f) => f.path === path);
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined;
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === path ? { ...file, isPinned: false, groupId: undefined } : file,
      );
      const tabGroups = deleteEmptyGroups(openFiles, data.tabGroups, groupId);
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    PIN_TAB_AT: ({ path, targetPath, side }, { data }) => {
      const tab = data.openFiles.find((f) => f.path === path);
      if (!tab) return;
      const groupId = 'groupId' in tab ? tab.groupId : undefined;
      const remaining = (data.openFiles as CodeTab[]).filter((f) => f.path !== path);
      const movedTab = { ...tab, isPinned: true, groupId: undefined, isPreview: false } as CodeTab;
      const targetIndex = remaining.findIndex((f) => f.path === targetPath);
      const insertAt =
        targetIndex === -1
          ? remaining.filter((t) => t.isPinned).length
          : side === 'right'
            ? targetIndex + 1
            : targetIndex;
      remaining.splice(insertAt, 0, movedTab);
      const tabGroups = deleteEmptyGroups(remaining, data.tabGroups, groupId);
      saveTabs({ ...data, openFiles: remaining, tabGroups });
      return { data: { openFiles: remaining, tabGroups } };
    },
    UNPIN_TAB_AT: ({ path, targetPath, side }, { data }) => {
      const tab = data.openFiles.find((f) => f.path === path);
      if (!tab) return;
      const groupId = 'groupId' in tab ? tab.groupId : undefined;
      const remaining = (data.openFiles as CodeTab[]).filter((f) => f.path !== path);
      const movedTab = { ...tab, isPinned: false, groupId: undefined } as CodeTab;
      const targetIndex = remaining.findIndex((f) => f.path === targetPath);
      const insertAt = targetIndex === -1 ? remaining.length : side === 'right' ? targetIndex + 1 : targetIndex;
      remaining.splice(insertAt, 0, movedTab);
      const tabGroups = deleteEmptyGroups(remaining, data.tabGroups, groupId);
      saveTabs({ ...data, openFiles: remaining, tabGroups });
      return { data: { openFiles: remaining, tabGroups } };
    },
    PIN_GROUP: ({ groupId }, { data }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).map((g) => (g.id === groupId ? { ...g, isPinned: true } : g));
      const updatedFiles = (data.openFiles as CodeTab[]).map((file) =>
        'groupId' in file && file.groupId === groupId ? { ...file, isPinned: true } : file,
      );
      const openFiles = [...updatedFiles.filter((t) => t.isPinned), ...updatedFiles.filter((t) => !t.isPinned)];
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    UNPIN_GROUP: ({ groupId }, { data }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).map((g) => (g.id === groupId ? { ...g, isPinned: false } : g));
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        'groupId' in file && file.groupId === groupId ? { ...file, isPinned: false } : file,
      );
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    CREATE_GROUP: ({ name, tabPaths }, { data }) => {
      let shouldPinGroup = false;
      if (tabPaths && tabPaths.length > 0) {
        const tabsToAdd = data.openFiles.filter((f) => tabPaths.includes(f.path));
        shouldPinGroup = tabsToAdd.some((tab) => tab.isPinned);
      }
      const color = getNextAvailableColor(data.tabGroups as TabGroup[], shouldPinGroup);
      const newGroup: TabGroup = {
        id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        color,
        isCollapsed: false,
        isPinned: shouldPinGroup,
        order: data.tabGroups.length,
      };
      const updatedFiles = tabPaths
        ? (data.openFiles as CodeTab[]).map((file) =>
            tabPaths.includes(file.path)
              ? { ...file, groupId: newGroup.id, isPinned: shouldPinGroup, isPreview: false }
              : file,
          )
        : (data.openFiles as CodeTab[]);
      const openFiles = [...updatedFiles.filter((t) => t.isPinned), ...updatedFiles.filter((t) => !t.isPinned)];
      const tabGroups = [...(data.tabGroups as TabGroup[]), newGroup];
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    RENAME_GROUP: ({ groupId, name }, { data }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).map((g) => (g.id === groupId ? { ...g, name } : g));
      saveTabs({ ...data, tabGroups });
      return { data: { tabGroups } };
    },
    CHANGE_GROUP_COLOR: ({ groupId, color }, { data }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).map((g) => (g.id === groupId ? { ...g, color } : g));
      saveTabs({ ...data, tabGroups });
      return { data: { tabGroups } };
    },
    DELETE_GROUP: ({ groupId, closeTabsInGroup }, { data, tell, child }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).filter((g) => g.id !== groupId);
      const openFiles = closeTabsInGroup
        ? (data.openFiles as CodeTab[]).filter((file) => !('groupId' in file) || file.groupId !== groupId)
        : (data.openFiles as CodeTab[]).map((file) =>
            'groupId' in file && file.groupId === groupId ? { ...file, groupId: undefined } : file,
          );
      const openPaths = new Set(openFiles.map((f) => f.path));
      const tabViewHistory = (data.tabViewHistory as string[]).filter((p) => openPaths.has(p));
      const activeWasRemoved = closeTabsInGroup && data.activeFilePath && !openPaths.has(data.activeFilePath);
      const activeFilePath = activeWasRemoved ? nextActiveFromHistory(tabViewHistory, openFiles) : data.activeFilePath;
      const next = { ...data, tabGroups, openFiles, activeFilePath, tabViewHistory };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(openFiles) });
      saveTabs(next, true);
      return { data: { tabGroups, openFiles, activeFilePath, tabViewHistory } };
    },
    TOGGLE_GROUP_COLLAPSE: ({ groupId }, { data }) => {
      const tabGroups = (data.tabGroups as TabGroup[]).map((g) =>
        g.id === groupId ? { ...g, isCollapsed: !g.isCollapsed } : g,
      );
      saveTabs({ ...data, tabGroups });
      return { data: { tabGroups } };
    },
    ADD_TAB_TO_GROUP: ({ path, groupId }, { data }) => {
      const targetGroup = data.tabGroups.find((g) => g.id === groupId);
      const shouldPin = targetGroup?.isPinned || false;
      const updatedFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === path ? { ...file, groupId, isPinned: shouldPin, isPreview: false } : file,
      );
      const openFiles = [...updatedFiles.filter((t) => t.isPinned), ...updatedFiles.filter((t) => !t.isPinned)];
      saveTabs({ ...data, openFiles });
      return { data: { openFiles } };
    },
    REMOVE_TAB_FROM_GROUP: ({ path }, { data }) => {
      const tab = data.openFiles.find((f) => f.path === path);
      const groupId = tab && 'groupId' in tab ? tab.groupId : undefined;
      const openFiles = (data.openFiles as CodeTab[]).map((file) =>
        file.path === path ? { ...file, groupId: undefined } : file,
      );
      const tabGroups = deleteEmptyGroups(openFiles, data.tabGroups, groupId);
      saveTabs({ ...data, openFiles, tabGroups });
      return { data: { openFiles, tabGroups } };
    },
    REORDER_GROUPS: ({ fromIndex, toIndex }, { data }) => {
      const groups = [...(data.tabGroups as TabGroup[])];
      const [movedGroup] = groups.splice(fromIndex, 1);
      groups.splice(toIndex, 0, movedGroup);
      const tabGroups = groups.map((group, index) => ({ ...group, order: index }));
      saveTabs({ ...data, tabGroups });
      return { data: { tabGroups } };
    },

    // ── Hotkeys & Navigation ──────────────────────────────────────────────────────────
    HOTKEY_PRESSED: (event, { data, send }) => {
      const actionType = processHotkeys(event, data.hotkeys as HotkeysMap, {
        openTerminal: 'OPEN_TERMINAL',
        openTerminalTab: 'OPEN_TERMINAL_TAB',
        navigatePrevPanel: 'NAVIGATE_PREV_PANEL',
        navigateNextPanel: 'NAVIGATE_NEXT_PANEL',
        focusSearch: 'FOCUS_SEARCH',
        quickOpen: 'SHOW_QUICK_OPEN',
        saveFile: 'SAVE_ACTIVE_FILE',
        closeTab: 'CLOSE_ACTIVE_TAB',
      });
      if (actionType) send({ type: actionType });
    },
    NAVIGATE_PREV_PANEL: (_event, { data, send }) => {
      const currentIndex = ALL_PANELS.indexOf(data.selectedPanel);
      const newIndex = currentIndex === 0 ? ALL_PANELS.length - 1 : currentIndex - 1;
      send({ type: 'SELECT_PANEL', panel: ALL_PANELS[newIndex] });
    },
    NAVIGATE_NEXT_PANEL: (_event, { data, send }) => {
      const currentIndex = ALL_PANELS.indexOf(data.selectedPanel);
      const newIndex = currentIndex === ALL_PANELS.length - 1 ? 0 : currentIndex + 1;
      send({ type: 'SELECT_PANEL', panel: ALL_PANELS[newIndex] });
    },
    FOCUS_SEARCH: (_event, { data, send }) => {
      const selectedText = _editorSelectionGetter?.() || '';
      send({ type: 'SELECT_PANEL', panel: 'search' });
      return {
        data: {
          searchFocusTrigger: data.searchFocusTrigger + 1,
          searchPrefillText: selectedText,
        },
      };
    },
    SEARCH_IN_FOLDER: ({ folder }, { data, tell, child, send }) => {
      const relativePath = folder.startsWith(data.baseDirectory)
        ? folder.slice(data.baseDirectory.length + 1)
        : folder;
      tell(child('search'), {
        type: 'search.UPDATE_OPTIONS',
        options: { includePattern: `${relativePath}/**` },
      });
      send({ type: 'SELECT_PANEL', panel: 'search' });
    },

    // ── Terminal panel / tab actions ──────────────────────────────────────────────────
    OPEN_TERMINAL: (_event, { data, read, tell, child }) => {
      const terminals = read(child('terminal'))?.data.terminals ?? [];
      const tabbedIds = getTabbedTerminalIds(data.openFiles);

      if (terminals.length === 0) {
        tell(child('terminal'), { type: 'terminal.CREATE', cwd: data.baseDirectory });
        return { data: { panelTerminalExpanded: true } };
      }

      if (!data.panelTerminalId) {
        const available = terminals.find((t) => !tabbedIds.has(t.id));
        if (available) {
          return { data: { panelTerminalId: available.id, panelTerminalExpanded: true } };
        }
        tell(child('terminal'), { type: 'terminal.CREATE', cwd: data.baseDirectory });
        return { data: { panelTerminalExpanded: true } };
      }

      return { data: { panelTerminalExpanded: !data.panelTerminalExpanded } };
    },
    OPEN_TERMINAL_TAB: (_event, { data, tell, child }) => {
      tell(child('terminal'), { type: 'terminal.CREATE', cwd: data.baseDirectory, target: 'tab' });
      saveTabs(data);
    },
    SELECT_PANEL_TERMINAL: ({ terminalId }, { data }) => {
      saveTabs({ ...data, panelTerminalId: terminalId });
      return { data: { panelTerminalId: terminalId } };
    },
    CLOSE_PANEL_TERMINAL: (_event, { data, tell, child }) => {
      if (data.panelTerminalId) {
        tell(child('terminal'), { type: 'terminal.CLOSE', terminalId: data.panelTerminalId });
      }
      const patch = { panelTerminalId: null, panelTerminalExpanded: false };
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },
    TOGGLE_PANEL_TERMINAL: (_event, { data }) => {
      const panelTerminalExpanded = !data.panelTerminalExpanded;
      saveTabs({ ...data, panelTerminalExpanded });
      return { data: { panelTerminalExpanded } };
    },
    OPEN_TERMINAL_IN_TAB: ({ terminalId }, { data, read, tell, child }) => {
      const terminals = read(child('terminal'))?.data.terminals ?? [];
      const terminalInfo = terminals.find((t) => t.id === terminalId);
      if (!terminalInfo) return;

      tell(child('terminal'), { type: 'terminal.OPEN_TAB', terminalInfo });

      if (data.panelTerminalId === terminalId) {
        const tabbedIds = getTabbedTerminalIds(data.openFiles);
        tabbedIds.add(terminalId);
        const next = terminals.find((t) => !tabbedIds.has(t.id));
        const panelTerminalId = next?.id ?? null;
        saveTabs({ ...data, panelTerminalId });
        return { data: { panelTerminalId } };
      }
      saveTabs(data);
    },
    MOVE_TERMINAL_TO_PANEL: ({ path }, { data }) => {
      const file = data.openFiles.find((f) => f.path === path);
      if (!file || !('isTerminal' in file)) return;
      const terminalId = (file as Read<TerminalTab>).terminalInfo.id;
      const openFiles = (data.openFiles as CodeTab[]).filter((f) => f.path !== path);
      const activeFilePath =
        data.activeFilePath === path ? nextActiveFromHistory(data.tabViewHistory as string[], openFiles) : data.activeFilePath;
      const tabGroups = pruneEmptyTabGroups(openFiles, data.tabGroups, data.pendingPersistedMetadata);
      const patch: Partial<CodeContext> = {
        openFiles,
        activeFilePath,
        tabGroups,
        panelTerminalId: terminalId,
        panelTerminalExpanded: true,
      };
      saveTabs({ ...data, ...patch });
      return { data: patch };
    },

    // ── Quick Open ────────────────────────────────────────────────────────────────────
    TOGGLE_QUICK_OPEN: (_event, { data, tell, child }) => {
      const opening = !data.isQuickOpenVisible;
      tell(child('explorer'), { type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: data.baseDirectory });
      return {
        data: {
          isQuickOpenVisible: opening,
          quickOpenQuery: opening ? data.quickOpenQuery : '',
          quickOpenResults: opening ? (data.quickOpenResults as any[]) : [],
          quickOpenSelectedIndex: 0,
          quickOpenLoading: opening,
        },
      };
    },
    SHOW_QUICK_OPEN: (_event, { data, tell, child }) => {
      tell(child('explorer'), { type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: data.baseDirectory });
      return {
        data: {
          isQuickOpenVisible: true,
          quickOpenQuery: '',
          quickOpenResults: [],
          quickOpenSelectedIndex: 0,
          quickOpenLoading: true,
        },
      };
    },
    HIDE_QUICK_OPEN: () => ({
      data: {
        isQuickOpenVisible: false,
        quickOpenQuery: '',
        quickOpenResults: [],
        quickOpenSelectedIndex: 0,
        quickOpenLoading: false,
      },
    }),
    UPDATE_QUICK_OPEN_QUERY: ({ query }) => ({
      data: { quickOpenQuery: query, quickOpenSelectedIndex: 0 },
    }),
    SELECT_QUICK_OPEN_RESULT: ({ index }, { data }) => {
      const maxIndex = Math.max(0, data.quickOpenResults.length - 1);
      return { data: { quickOpenSelectedIndex: Math.max(0, Math.min(index, maxIndex)) } };
    },
    OPEN_QUICK_OPEN_RESULT: ({ path }, { data, tell, child }) => {
      const recentlyOpenedFiles = addRecentFile(data.recentlyOpenedFiles as string[], path, data.baseDirectory);
      tell(child('explorer'), { type: 'explorer.OPEN_FILE', path });
      return {
        data: {
          recentlyOpenedFiles,
          isQuickOpenVisible: false,
          quickOpenQuery: '',
          quickOpenResults: [],
          quickOpenSelectedIndex: 0,
          quickOpenLoading: false,
        },
      };
    },

    // ── File actions ──────────────────────────────────────────────────────────────────
    SAVE_ACTIVE_FILE: (_event, { data, tell, child }) => {
      const activeFile = data.openFiles.find((f) => f.path === data.activeFilePath);
      if (!activeFile) return;

      if (activeFile.isDiff) {
        const file = activeFile as Read<OpenFile>;
        if (!isEditableDiff(file as OpenFile)) return;
        tell(child('explorer'), { type: 'explorer.WRITE_FILE', path: file.gitFile!.path, content: file.content });
        return;
      }

      if ('isAction' in activeFile && activeFile.isAction) {
        const actionId = activeFile.path.replace('action:', '');
        tell(child('codeActions'), { type: 'codeActions.SAVE_ACTION', actionId, content: activeFile.content });
      } else if ('isPrompt' in activeFile && activeFile.isPrompt) {
        const promptId = activeFile.path.replace('prompt:', '');
        tell(child('codePrompts'), { type: 'codePrompts.SAVE_PROMPT', promptId, content: activeFile.content });
      } else {
        tell(child('explorer'), { type: 'explorer.WRITE_FILE', path: activeFile.path, content: activeFile.content });
      }
    },
    CLOSE_ACTIVE_TAB: (_event, { data, tell, child }) => {
      const path = data.activeFilePath;
      if (!path) return;
      const file = data.openFiles.find((f) => f.path === path);
      if (file && 'isTerminal' in file && file.isTerminal) {
        if (data.settings?.confirmTerminalClose ?? true) {
          const terminalInfo = (file as Read<TerminalTab>).terminalInfo;
          const name = terminalInfo.customTitle || terminalNameFor(terminalInfo.cwd) || terminalInfo.title;
          if (!confirm(`Close terminal "${name}"?`)) return;
        }
        if (data.settings?.closeTerminalOnTabClose ?? true) {
          tell(child('terminal'), { type: 'terminal.CLOSE', terminalId: (file as Read<TerminalTab>).terminalInfo.id });
        }
      }
      tell(child('explorer'), { type: 'explorer.CLOSE_FILE', path });
      const patch = removeTabPatch(data, path);
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next, true);
      return { data: patch };
    },
    CLOSE_TAB: ({ path }, { data, tell, child }) => {
      const file = data.openFiles.find((f) => f.path === path);
      if (file && 'isTerminal' in file && file.isTerminal) {
        if (data.settings?.confirmTerminalClose ?? true) {
          const terminalInfo = (file as Read<TerminalTab>).terminalInfo;
          const name = terminalInfo.customTitle || terminalNameFor(terminalInfo.cwd) || terminalInfo.title;
          if (!confirm(`Close terminal "${name}"?`)) return;
        }
        if (data.settings?.closeTerminalOnTabClose ?? true) {
          tell(child('terminal'), { type: 'terminal.CLOSE', terminalId: (file as Read<TerminalTab>).terminalInfo.id });
        }
      }
      tell(child('explorer'), { type: 'explorer.CLOSE_FILE', path });
      const patch = removeTabPatch(data, path);
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next, true);
      return { data: patch };
    },
    KILL_TERMINAL: ({ path }, { data, tell, child }) => {
      const file = data.openFiles.find((f) => f.path === path);
      if (!file || !('isTerminal' in file)) return;
      tell(child('terminal'), { type: 'terminal.CLOSE', terminalId: (file as Read<TerminalTab>).terminalInfo.id });
      tell(child('explorer'), { type: 'explorer.CLOSE_FILE', path });
      const patch = removeTabPatch(data, path);
      const next = { ...data, ...patch };
      tell(child('commit'), { type: 'OPEN_DIFFS_CHANGED', openDiffs: openDiffRefsOf(next.openFiles) });
      saveTabs(next, true);
      return { data: patch };
    },
    /**
     * **Settling writes nothing to storage.** Every real change persists through `saveTabs`, so leaving storage
     * alone means a tab that is still missing is still there to try again.
     */
    RESTORE_PERSISTED_TABS_SETTLED: (_event, { data }) => {
      const updates = finalizeRestoreState(data);
      if (Object.keys(updates).length === 0) return;

      const openPaths = new Set(data.openFiles.map((file) => file.path));
      const missing = data.pendingTabOrder?.filter((tab) => !openPaths.has(tab.path)) ?? [];
      if (missing.length > 0) {
        console.info(
          `[Code Surface] ${missing.length} restored tab(s) have not arrived; they stay in storage for the next launch`,
        );
      }
      return { data: updates };
    },
  },
  states: {
    canvas: {},
  },
});

export default codeState;
