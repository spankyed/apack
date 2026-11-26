import type { Read } from '@apackdev/state';
import {
  getNextAvailableColor,
  loadTabGroups,
  saveTabGroups,
  surfaceStorage,
  type SurfaceLifecycleEvent,
  type TabGroup,
  type TabGroupColor,
} from '@apackdev/sdk/fe';
import { ref as featureRef } from '#generated/ref.ts';
import { openSurface } from '#generated/fe.ts';
import { state, type PackNet } from '#generated/state.ts';
import type { BrowserSettings } from '#generated/types.ts';
import type { Bookmark, BrowserContext, BrowserInboxEvent, BrowserTab, BrowserTabPersistedId } from './contract.ts';
import { autocomplete, displayUrl, recordVisit, updateHistoryMeta, type AutocompleteSuggestion } from './history.ts';

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('browser'));

export type { TabGroup, TabGroupColor };
export type { Bookmark, BrowserTab, BrowserTabPersistedId } from './contract.ts';
export type { AutocompleteSuggestion };

export const id = 'browser' as const;

interface SavedTab {
  id: BrowserTabPersistedId;
  url: string;
  title: string;
  favicon: string;
  displayOrder: number;
  isMuted: boolean;
  groupId?: string;
}

interface NormalizeTabsResult {
  tabs: SavedTab[];
  invalidCount: number;
}

type BrowserInternalEvents = {
  type: 'AUTOCOMPLETE.RESULTS';
  suggestions: AutocompleteSuggestion[];
  inlineCompletion: string | null;
};

type BrowserEvents =
  // UI events
  | BrowserInboxEvent
  // A link to open, from anywhere in the app (`openLink` from @apackdev/sdk/fe): here or in the system's browser
  | { type: 'LINK.OPEN'; url: string }
  // The app's, when this feature's settings change
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: BrowserSettings }
  | { type: 'TAB.CLOSE'; tabId: number }
  | { type: 'TAB.SELECT'; tabId: number }
  | { type: 'TAB.DUPLICATE'; tabId: number }
  | { type: 'TAB.CLOSE_OTHERS'; tabId: number }
  | { type: 'TAB.TOGGLE_MUTE'; tabId: number }
  | { type: 'TAB.ADD_TO_GROUP'; tabId: number; groupId: string }
  | { type: 'TAB.REMOVE_FROM_GROUP'; tabId: number }
  | { type: 'GROUP.CREATE'; name?: string; tabIds?: number[] }
  | { type: 'GROUP.RENAME'; groupId: string; name: string }
  | { type: 'GROUP.CHANGE_COLOR'; groupId: string; color: TabGroupColor }
  | { type: 'GROUP.DELETE'; groupId: string; closeTabs?: boolean }
  | { type: 'GROUP.TOGGLE_COLLAPSE'; groupId: string }
  | { type: 'NAV.GO'; url: string }
  | { type: 'NAV.BACK' }
  | { type: 'NAV.FORWARD' }
  | { type: 'NAV.RELOAD' }
  | { type: 'NAV.STOP' }
  | { type: 'ADDRESS_BAR.UPDATE'; value: string }
  | { type: 'ADDRESS_BAR.FOCUS' }
  | { type: 'ADDRESS_BAR.BLUR' }
  // Autocomplete events
  | { type: 'AUTOCOMPLETE.SELECT'; index: number }
  | { type: 'AUTOCOMPLETE.DISMISS' }
  | { type: 'AUTOCOMPLETE.ACCEPT_INLINE' }
  // Bookmark events
  | { type: 'BOOKMARK.TOGGLE' }
  | { type: 'BOOKMARK.REMOVE'; url: string }
  | { type: 'BOOKMARK.NAVIGATE'; url: string }
  | Extract<SurfaceLifecycleEvent, { type: 'SURFACE_STARTED' }>
  // IPC bridge events
  | { type: 'IPC.TAB_CREATED'; tab: BrowserTabState }
  | { type: 'IPC.TAB_REMOVED'; tabId: number }
  | { type: 'IPC.TAB_UPDATED'; tabId: number; changes: Partial<BrowserTabState> }
  | { type: 'IPC.ACTIVE_TAB_CHANGED'; tabId: number };

type BrowserShape = {
  data: BrowserContext;
  internal: BrowserInternalEvents;
  calls: {
    /** What the window restores, one at a time */
    savedSession: 'one';
  };
};

type BrowserTell = (to: 'browser', event: Read<PackNet['systems']['browser']['events']>) => void;

function navigateTo(activeTabId: number | null, rawUrl: string) {
  const url = rawUrl.trim();
  if (!url) return;
  if (activeTabId !== null) {
    window.electronAPI?.browser.navigate(activeTabId, url);
  } else {
    window.electronAPI?.browser.createTab(url);
  }
}

function runNav(activeTabId: number | null, method: 'goBack' | 'goForward' | 'reload' | 'stop') {
  if (activeTabId !== null) {
    window.electronAPI?.browser[method](activeTabId);
  }
}

// Debounce tab sync to backend (2s after last change)
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let restoreTabsRemaining = 0;

function syncTabsToBackend(tabs: readonly Read<BrowserTab>[], tell: BrowserTell, options?: { immediate?: boolean }) {
  if (syncTimer) clearTimeout(syncTimer);
  const send = () => {
    const persistable = tabs
      .filter(t => t.url && t.url !== 'about:blank' && !t.url.startsWith('data:'))
      .map((t, i) => ({
        id: ensurePersistedTabId(t),
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        displayOrder: i,
        isMuted: t.isMuted,
        groupId: t.groupId,
      }));
    tell(id, { type: 'SYNC_TABS', tabs: persistable });
  };

  if (options?.immediate) {
    syncTimer = null;
    send();
    return;
  }

  syncTimer = setTimeout(send, 2000);
}

function isRestorableUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url !== 'about:blank' && !url.startsWith('data:');
}

function isBrowserTabPersistedId(id: string | undefined): id is BrowserTabPersistedId {
  return Boolean(id?.startsWith('BrowserTab-'));
}

function createPersistedTabId(): BrowserTabPersistedId {
  return `BrowserTab-${crypto.randomUUID()}`;
}

function ensurePersistedTabId(tab: { persistedId?: string }): BrowserTabPersistedId {
  return isBrowserTabPersistedId(tab.persistedId) ? tab.persistedId : createPersistedTabId();
}

function normalizeSavedTabs(tabs: readonly SavedTab[]): NormalizeTabsResult {
  const normalized: SavedTab[] = [];
  let invalidCount = 0;

  for (const tab of tabs) {
    if (!isRestorableUrl(tab.url)) {
      invalidCount += 1;
      continue;
    }

    normalized.push({
      id: tab.id || createPersistedTabId(),
      url: tab.url,
      title: tab.title || 'New Tab',
      favicon: tab.favicon || '',
      displayOrder: normalized.length,
      isMuted: Boolean(tab.isMuted),
      ...(tab.groupId ? { groupId: tab.groupId } : {}),
    });
  }

  return { tabs: normalized, invalidCount };
}

// Debounce bookmark sync to backend (2s after last change)
let bookmarkSyncTimer: ReturnType<typeof setTimeout> | null = null;

function syncBookmarksToBackend(bookmarks: readonly Read<Bookmark>[], tell: BrowserTell) {
  if (bookmarkSyncTimer) clearTimeout(bookmarkSyncTimer);
  bookmarkSyncTimer = setTimeout(() => {
    const persistable = bookmarks.map((bm, i) => ({
      url: bm.url,
      title: bm.title,
      favicon: bm.favicon,
      displayOrder: i,
    }));
    tell(id, { type: 'SYNC_BOOKMARKS', bookmarks: persistable });
  }, 2000);
}

function persistState(tabs: readonly Read<BrowserTab>[], tabGroups: readonly Read<TabGroup>[], tell: BrowserTell) {
  saveTabGroups(storage, 'tab-groups', [...tabGroups]);
  syncTabsToBackend(tabs, tell);
}

function persistGroupsOnly(tabGroups: readonly Read<TabGroup>[]) {
  saveTabGroups(storage, 'tab-groups', [...tabGroups]);
}

function generateGroupId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Map url→groupId for restoring group assignments when tabs are recreated on startup
const pendingGroupAssignments = new Map<string, string[]>();

function deleteEmptyGroups(tabs: readonly Read<BrowserTab>[], groups: readonly Read<TabGroup>[]): TabGroup[] {
  const usedGroupIds = new Set(tabs.filter(t => t.groupId).map(t => t.groupId!));
  return groups.filter(g => usedGroupIds.has(g.id)).map(g => ({ ...g }));
}

// Debounce autocomplete queries outside the machine to avoid timer in context
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Suppress inline completion when deleting (only show when typing forward)
let suppressInlineCompletion = false;

function runAutocompleteQuery(query: string, sendBack: (event: BrowserInternalEvents) => void) {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (query.length < 1) {
    sendBack({ type: 'AUTOCOMPLETE.RESULTS', suggestions: [], inlineCompletion: null });
    return;
  }
  debounceTimer = setTimeout(() => {
    const suggestions = autocomplete(query);
    let inlineCompletion: string | null = null;
    if (!suppressInlineCompletion && suggestions.length > 0 && suggestions[0].matchType === 'url') {
      const display = displayUrl(suggestions[0].url);
      if (display.toLowerCase().startsWith(query.toLowerCase())) {
        inlineCompletion = display.slice(query.length);
      }
    }
    sendBack({ type: 'AUTOCOMPLETE.RESULTS', suggestions, inlineCompletion });
  }, 100);
}

const browserState = state<BrowserShape, BrowserEvents>()({
  data: {
    tabs: [],
    settings: {} as BrowserSettings,
    activeTabId: null,
    addressBarValue: '',
    isAddressBarFocused: false,
    tabGroups: [],
    suggestions: [],
    selectedSuggestionIndex: -1,
    inlineCompletion: null,
    preAutocompleteValue: '',
    _lastNavWasTyped: false,
    bookmarks: [],
  },
  listen: ({ send }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.browser : undefined;
    const unsubs = api
      ? [
          api.onTabCreated((tab) => send({ type: 'IPC.TAB_CREATED', tab })),
          api.onTabRemoved((tabId) => send({ type: 'IPC.TAB_REMOVED', tabId })),
          api.onTabUpdated((tabId, changes) => send({ type: 'IPC.TAB_UPDATED', tabId, changes })),
          api.onActiveTabChanged((tabId) => send({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId })),
        ]
      : [];

    return () => {
      unsubs.forEach(unsub => unsub());
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      if (bookmarkSyncTimer) {
        clearTimeout(bookmarkSyncTimer);
        bookmarkSyncTimer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  },
  calls: ({ one }) => ({
    // A session that could not be read restores nothing
    savedSession: one('browser', 'GET_SAVED_SESSION', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return;
        const { savedTabs, savedBookmarks } = outcome.value;
        const normalized = normalizeSavedTabs(savedTabs);
        if (normalized.invalidCount > 0) {
          console.warn('[Browser] Dropping invalid saved tabs before restore', {
            rawCount: savedTabs.length,
            repairedCount: normalized.tabs.length,
            invalidCount: normalized.invalidCount,
          });
        }

        if (data.tabs.length === 0 && normalized.tabs.length > 0) {
          // Set up pending group assignments for restored tabs
          pendingGroupAssignments.clear();
          for (const saved of normalized.tabs) {
            if (saved.groupId) {
              const queue = pendingGroupAssignments.get(saved.url) ?? [];
              queue.push(saved.groupId);
              pendingGroupAssignments.set(saved.url, queue);
            }
          }

          restoreTabsRemaining = normalized.tabs.length;
          // Create tabs lazily — don't load URLs until the user opens the browser surface
          Promise.all(normalized.tabs.map(saved =>
            window.electronAPI?.browser.createTab(saved.url, {
              lazy: true,
              title: saved.title,
              favicon: saved.favicon,
              activate: false,
              persistedId: saved.id,
            }),
          )).then((tabs) => {
            const firstRestored = tabs.find(tab => tab !== null);
            if (firstRestored) {
              window.electronAPI?.browser.selectTab(firstRestored.id);
            }
          }).catch((error) => {
            console.error('[Browser] Failed to restore saved tabs', error);
            restoreTabsRemaining = 0;
          });
        }

        return {
          data: {
            tabGroups: loadTabGroups(storage, 'tab-groups'),
            // A page with no favicon is saved without one, which the bar shows as an empty one
            bookmarks: savedBookmarks.map((bookmark) => ({ ...bookmark, favicon: bookmark.favicon ?? '' })),
          },
        };
      },
    }),
  }),
  internal: {
    'AUTOCOMPLETE.RESULTS': (event) => ({
      data: {
        suggestions: event.suggestions,
        inlineCompletion: event.inlineCompletion,
      },
    }),
  },
  on: {
    FEATURE_SETTINGS_UPDATED: (event) => ({ data: { settings: event.settings } }),
    'TAB.CREATE': (event) => {
      window.electronAPI?.browser.createTab(event.url);
    },
    'LINK.OPEN': (event, { data }) => {
      // The user's choice, in this feature's own settings
      if (data.settings.openLinksInApp ?? true) {
        openSurface('browser', { type: 'TAB.CREATE', url: event.url });
      } else {
        window.electronAPI?.shell?.openExternal(event.url);
      }
    },
    'TAB.CLOSE': (event) => {
      window.electronAPI?.browser.closeTab(event.tabId);
    },
    'TAB.SELECT': (event) => {
      window.electronAPI?.browser.selectTab(event.tabId);
    },
    'TAB.DUPLICATE': (event) => {
      window.electronAPI?.browser.duplicateTab(event.tabId);
    },
    'TAB.CLOSE_OTHERS': (event, { data }) => {
      for (const tab of data.tabs) {
        if (tab.id !== event.tabId) {
          window.electronAPI?.browser.closeTab(tab.id);
        }
      }
    },
    'TAB.TOGGLE_MUTE': (event, { data }) => {
      const tab = data.tabs.find(t => t.id === event.tabId);
      if (tab) {
        window.electronAPI?.browser.setTabMuted(event.tabId, !tab.isMuted);
      }
    },
    // Tab group actions
    'TAB.ADD_TO_GROUP': (event, { data, tell }) => {
      const tabs = data.tabs.map(t =>
        t.id === event.tabId ? { ...t, groupId: event.groupId } : { ...t },
      );
      persistState(tabs, data.tabGroups, tell);
      return { data: { tabs } };
    },
    'TAB.REMOVE_FROM_GROUP': (event, { data, tell }) => {
      const tabs = data.tabs.map(t =>
        t.id === event.tabId ? { ...t, groupId: undefined } : { ...t },
      );
      const tabGroups = deleteEmptyGroups(tabs, data.tabGroups);
      persistState(tabs, tabGroups, tell);
      return { data: { tabs, tabGroups } };
    },
    'GROUP.CREATE': (event, { data, tell }) => {
      const color = getNextAvailableColor([...data.tabGroups]);
      const newGroup: TabGroup = {
        id: generateGroupId(),
        name: event.name || `Group ${data.tabGroups.length + 1}`,
        color,
        isCollapsed: false,
        order: data.tabGroups.length,
      };
      const tabGroups = [...data.tabGroups, newGroup];
      const tabs = event.tabIds
        ? data.tabs.map(t => (event.tabIds!.includes(t.id) ? { ...t, groupId: newGroup.id } : { ...t }))
        : data.tabs;
      persistState(tabs, tabGroups, tell);
      return { data: { tabGroups, tabs } };
    },
    'GROUP.RENAME': (event, { data }) => {
      const tabGroups = data.tabGroups.map(g =>
        g.id === event.groupId ? { ...g, name: event.name } : { ...g },
      );
      persistGroupsOnly(tabGroups);
      return { data: { tabGroups } };
    },
    'GROUP.CHANGE_COLOR': (event, { data }) => {
      const tabGroups = data.tabGroups.map(g =>
        g.id === event.groupId ? { ...g, color: event.color } : { ...g },
      );
      persistGroupsOnly(tabGroups);
      return { data: { tabGroups } };
    },
    'GROUP.DELETE': (event, { data, tell }) => {
      if (event.closeTabs) {
        for (const tab of data.tabs) {
          if (tab.groupId === event.groupId) {
            window.electronAPI?.browser.closeTab(tab.id);
          }
        }
      }
      const tabGroups = data.tabGroups.filter(g => g.id !== event.groupId);
      const tabs = event.closeTabs
        ? data.tabs // tabs will be removed via IPC.TAB_REMOVED
        : data.tabs.map(t => (t.groupId === event.groupId ? { ...t, groupId: undefined } : { ...t }));
      persistState(tabs, tabGroups, tell);
      return { data: { tabGroups, tabs } };
    },
    'GROUP.TOGGLE_COLLAPSE': (event, { data }) => {
      const tabGroups = data.tabGroups.map(g =>
        g.id === event.groupId ? { ...g, isCollapsed: !g.isCollapsed } : { ...g },
      );
      persistGroupsOnly(tabGroups);
      return { data: { tabGroups } };
    },
    'NAV.GO': (event, { data }) => {
      // If a suggestion is selected, use its URL
      const url = data.selectedSuggestionIndex >= 0
        ? data.suggestions[data.selectedSuggestionIndex]?.url ?? event.url
        : event.url;
      navigateTo(data.activeTabId, url);
      return {
        data: {
          addressBarValue: url,
          suggestions: [],
          selectedSuggestionIndex: -1,
          inlineCompletion: null,
          _lastNavWasTyped: true,
        },
      };
    },
    'NAV.BACK': (_event, { data }) => runNav(data.activeTabId, 'goBack'),
    'NAV.FORWARD': (_event, { data }) => runNav(data.activeTabId, 'goForward'),
    'NAV.RELOAD': (_event, { data }) => runNav(data.activeTabId, 'reload'),
    'NAV.STOP': (_event, { data }) => runNav(data.activeTabId, 'stop'),
    'ADDRESS_BAR.UPDATE': (event, { data, send }) => {
      const isTypingForward = event.value.length > data.addressBarValue.length;
      suppressInlineCompletion = !isTypingForward;

      // Preserve inline completion if the user is typing forward into it
      let inlineCompletion: string | null = null;
      if (isTypingForward && data.inlineCompletion) {
        const currentFull = data.addressBarValue + data.inlineCompletion;
        if (currentFull.toLowerCase().startsWith(event.value.toLowerCase())) {
          inlineCompletion = currentFull.slice(event.value.length);
        }
      }
      runAutocompleteQuery(event.value.trim(), (e) => send(e));
      return {
        data: {
          addressBarValue: event.value,
          preAutocompleteValue: event.value,
          selectedSuggestionIndex: -1,
          inlineCompletion,
        },
      };
    },
    'ADDRESS_BAR.FOCUS': () => ({ data: { isAddressBarFocused: true } }),
    'ADDRESS_BAR.BLUR': () => ({
      data: {
        isAddressBarFocused: false,
        suggestions: [],
        selectedSuggestionIndex: -1,
        inlineCompletion: null,
      },
    }),
    // Autocomplete
    'AUTOCOMPLETE.SELECT': (event, { data }) => {
      if (event.index === -1) {
        return {
          data: {
            selectedSuggestionIndex: -1,
            addressBarValue: data.preAutocompleteValue,
            inlineCompletion: null,
          },
        };
      }
      const suggestion = data.suggestions[event.index];
      if (!suggestion) return;
      return {
        data: {
          selectedSuggestionIndex: event.index,
          addressBarValue: suggestion.url,
          inlineCompletion: null,
        },
      };
    },
    'AUTOCOMPLETE.DISMISS': () => ({
      data: {
        suggestions: [],
        selectedSuggestionIndex: -1,
        inlineCompletion: null,
      },
    }),
    'AUTOCOMPLETE.ACCEPT_INLINE': (_event, { data }) => {
      if (!data.inlineCompletion) return;
      const full = data.preAutocompleteValue + data.inlineCompletion;
      return {
        data: {
          addressBarValue: full,
          preAutocompleteValue: full,
          inlineCompletion: null,
        },
      };
    },
    // Bookmark events
    'BOOKMARK.TOGGLE': (_event, { data, tell }) => {
      const tab = data.tabs.find(t => t.id === data.activeTabId);
      if (!tab?.url || tab.url === 'about:blank' || tab.url.startsWith('data:')) {
        syncBookmarksToBackend(data.bookmarks, tell);
        return;
      }
      const exists = data.bookmarks.some(b => b.url === tab.url);
      const bookmarks = exists
        ? data.bookmarks.filter(b => b.url !== tab.url)
        : [...data.bookmarks, { url: tab.url, title: tab.title, favicon: tab.favicon, displayOrder: data.bookmarks.length }];
      syncBookmarksToBackend(bookmarks, tell);
      return { data: { bookmarks } };
    },
    'BOOKMARK.REMOVE': (event, { data, tell }) => {
      const bookmarks = data.bookmarks.filter(b => b.url !== event.url);
      syncBookmarksToBackend(bookmarks, tell);
      return { data: { bookmarks } };
    },
    'BOOKMARK.NAVIGATE': (event, { data }) => {
      navigateTo(data.activeTabId, event.url);
      return { data: { addressBarValue: event.url } };
    },
    // What the window restores, asked for when the shell starts the surface, in a delivery naming it: one ask at
    // a time, a later start's in place of one under way
    SURFACE_STARTED: (_event, { call, cancel }) => {
      cancel('savedSession');
      call('savedSession');
    },
    // IPC events
    'IPC.TAB_CREATED': (event, { data, tell }) => {
      const exists = data.tabs.some(t => t.id === event.tab.id);
      let tabs: readonly Read<BrowserTab>[] = data.tabs;
      if (!exists) {
        // Apply pending group assignment from restore
        const tab: BrowserTab = { ...event.tab, persistedId: ensurePersistedTabId(event.tab) };
        const queue = pendingGroupAssignments.get(tab.url);
        if (queue?.length) {
          tab.groupId = queue.shift();
          if (queue.length === 0) pendingGroupAssignments.delete(tab.url);
        }
        tabs = [...data.tabs, tab];
      }
      if (restoreTabsRemaining > 0) {
        restoreTabsRemaining -= 1;
        if (restoreTabsRemaining === 0) {
          syncTabsToBackend(tabs, tell);
        }
      } else {
        syncTabsToBackend(tabs, tell);
      }
      if (exists) return;
      return { data: { tabs } };
    },
    'IPC.TAB_REMOVED': (event, { data, tell }) => {
      const tabs = data.tabs.filter(t => t.id !== event.tabId);
      const tabGroups = deleteEmptyGroups(tabs, data.tabGroups);
      persistGroupsOnly(tabGroups);
      syncTabsToBackend(tabs, tell, { immediate: true });
      return {
        data: {
          tabs,
          tabGroups,
          activeTabId: data.activeTabId === event.tabId
            ? (tabs.at(-1)?.id ?? null)
            : data.activeTabId,
          ...(data.activeTabId === event.tabId
            ? { addressBarValue: tabs.at(-1)?.url ?? '' }
            : {}),
        },
      };
    },
    'IPC.TAB_UPDATED': (event, { data, tell }) => {
      const { persistedId, ...restChanges } = event.changes;
      const changes: Partial<BrowserTab> = {
        ...restChanges,
        ...(isBrowserTabPersistedId(persistedId) ? { persistedId } : {}),
      };
      const tabs = data.tabs.map(t =>
        t.id === event.tabId ? { ...t, ...changes } : { ...t },
      );
      const syncUrl = !data.isAddressBarFocused
        && event.tabId === data.activeTabId
        && event.changes.url !== undefined;
      const updatedTab = tabs.find(t => t.id === event.tabId);
      const nextLastNavWasTyped = event.changes.url ? false : data._lastNavWasTyped;

      if (event.changes.url && event.changes.url !== 'about:blank' && !event.changes.url.startsWith('data:')) {
        recordVisit(event.changes.url, updatedTab?.title ?? '', updatedTab?.favicon ?? '', nextLastNavWasTyped);
      }
      if ((event.changes.title || event.changes.favicon) && !event.changes.url) {
        if (updatedTab?.url) updateHistoryMeta(updatedTab.url, event.changes.title, event.changes.favicon);
      }
      // Sync to backend on URL or title changes
      if (event.changes.url || event.changes.title) {
        if (restoreTabsRemaining <= 0) {
          syncTabsToBackend(tabs, tell);
        }
      }
      return {
        data: {
          tabs,
          ...(syncUrl ? { addressBarValue: event.changes.url } : {}),
          ...(event.changes.url ? { _lastNavWasTyped: false } : {}),
        },
      };
    },
    'IPC.ACTIVE_TAB_CHANGED': (event, { data }) => {
      const tab = data.tabs.find(t => t.id === event.tabId);
      return {
        data: {
          activeTabId: event.tabId,
          ...(data.isAddressBarFocused ? {} : { addressBarValue: tab?.url ?? '' }),
        },
      };
    },
  },
});

export default browserState;
