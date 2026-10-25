import { surfaceStorage } from '@apackdev/sdk/fe'
import type { SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('browser'))
import { setup, assign, fromCallback, type ActorRefFrom } from 'xstate';
import type { BrowserSettings } from '#generated/types.ts';
import type { Bookmark, BrowserContext, BrowserInboxEvent, BrowserTab, BrowserTabPersistedId } from './contract.ts';
import { autocomplete, recordVisit, updateHistoryMeta, displayUrl, type AutocompleteSuggestion } from './history.ts';
import { sendToSystem } from '#generated/events.ts';
import { openSurface } from '#generated/fe.ts';
import { getNextAvailableColor, saveTabGroups, loadTabGroups, type TabGroup, type TabGroupColor } from '@apackdev/sdk/fe';

export type { TabGroup, TabGroupColor };
export type { Bookmark, BrowserTab, BrowserTabPersistedId } from './contract.ts';

export const id = 'browser' as const;



export type { AutocompleteSuggestion };


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
  | { type: 'AUTOCOMPLETE.RESULTS'; suggestions: AutocompleteSuggestion[]; inlineCompletion: string | null }
  // Bookmark events
  | { type: 'BOOKMARK.TOGGLE' }
  | { type: 'BOOKMARK.REMOVE'; url: string }
  | { type: 'BOOKMARK.NAVIGATE'; url: string }
  // Backend events
  | { type: 'SAVED_SESSION_READ'; savedTabs: SavedTab[]; savedBookmarks: Bookmark[] }
  | SurfaceLifecycleEvent
  // IPC bridge events
  | { type: 'IPC.TAB_CREATED'; tab: BrowserTabState }
  | { type: 'IPC.TAB_REMOVED'; tabId: number }
  | { type: 'IPC.TAB_UPDATED'; tabId: number; changes: Partial<BrowserTab> }
  | { type: 'IPC.ACTIVE_TAB_CHANGED'; tabId: number };

export type BrowserState = ActorRefFrom<typeof browserState>;

function navAction(method: 'goBack' | 'goForward' | 'reload' | 'stop') {
  return ({ context }: { context: BrowserContext }) => {
    if (context.activeTabId !== null) {
      window.electronAPI?.browser[method](context.activeTabId);
    }
  };
}

// Debounce tab sync to backend (2s after last change)
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let restoreTabsRemaining = 0;

function syncTabsToBackend(tabs: BrowserTab[], options?: { immediate?: boolean }) {
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
    sendToSystem(id, { type: 'SYNC_TABS', tabs: persistable });
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

function normalizeSavedTabs(tabs: SavedTab[]): NormalizeTabsResult {
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

function syncBookmarksToBackend(bookmarks: Bookmark[]) {
  if (bookmarkSyncTimer) clearTimeout(bookmarkSyncTimer);
  bookmarkSyncTimer = setTimeout(() => {
    const persistable = bookmarks.map((bm, i) => ({
      url: bm.url,
      title: bm.title,
      favicon: bm.favicon,
      displayOrder: i,
    }));
    sendToSystem(id, { type: 'SYNC_BOOKMARKS', bookmarks: persistable });
  }, 2000);
}


function persistState(context: BrowserContext) {
  saveTabGroups(storage, 'tab-groups', context.tabGroups);
  syncTabsToBackend(context.tabs);
}

function persistGroupsOnly(context: BrowserContext) {
  saveTabGroups(storage, 'tab-groups', context.tabGroups);
}

function generateGroupId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Map url→groupId for restoring group assignments when tabs are recreated on startup
const pendingGroupAssignments = new Map<string, string[]>();

function deleteEmptyGroups(tabs: BrowserTab[], groups: TabGroup[]): TabGroup[] {
  const usedGroupIds = new Set(tabs.filter(t => t.groupId).map(t => t.groupId!));
  return groups.filter(g => usedGroupIds.has(g.id));
}

// Debounce autocomplete queries outside the machine to avoid timer in context
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Suppress inline completion when deleting (only show when typing forward)
let suppressInlineCompletion = false;

function runAutocompleteQuery(query: string, sendBack: (event: BrowserEvents) => void) {
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

const browserState = setup({
  types: {
    context: {} as BrowserContext,
    events: {} as BrowserEvents,
  },
  actors: {
    ipcBridge: fromCallback(({ sendBack }) => {
      const api = window.electronAPI?.browser;
      if (!api) return;

      const unsubs = [
        api.onTabCreated((tab) => sendBack({ type: 'IPC.TAB_CREATED', tab })),
        api.onTabRemoved((tabId) => sendBack({ type: 'IPC.TAB_REMOVED', tabId })),
        api.onTabUpdated((tabId, changes) => sendBack({ type: 'IPC.TAB_UPDATED', tabId, changes })),
        api.onActiveTabChanged((tabId) => sendBack({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId })),
      ];

      return () => unsubs.forEach(unsub => unsub());
    }),
  },
  actions: {
    navigate: ({ context }) => {
      const url = context.addressBarValue.trim();
      if (!url) return;
      if (context.activeTabId !== null) {
        window.electronAPI?.browser.navigate(context.activeTabId, url);
      } else {
        window.electronAPI?.browser.createTab(url);
      }
    },
    goBack: navAction('goBack'),
    goForward: navAction('goForward'),
    reload: navAction('reload'),
    stop: navAction('stop'),
  },
}).createMachine({
  id,
  initial: 'active',
  context: {
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
  invoke: { src: 'ipcBridge' },
  states: {
    active: {
      on: {
        FEATURE_SETTINGS_UPDATED: { actions: assign({ settings: ({ event }) => (event as { settings: BrowserSettings }).settings }) },
        'TAB.CREATE': {
          actions: ({ event }) => {
            window.electronAPI?.browser.createTab(event.url);
          },
        },
        'LINK.OPEN': {
          // The user's choice, in this feature's own settings
          actions: ({ context, event }) => {
            if (context.settings.openLinksInApp ?? true) {
              openSurface('browser', { type: 'TAB.CREATE', url: event.url });
            } else {
              window.electronAPI?.shell?.openExternal(event.url);
            }
          },
        },
        'TAB.CLOSE': {
          actions: ({ event }) => {
            window.electronAPI?.browser.closeTab(event.tabId);
          },
        },
        'TAB.SELECT': {
          actions: ({ event }) => {
            window.electronAPI?.browser.selectTab(event.tabId);
          },
        },
        'TAB.DUPLICATE': {
          actions: ({ event }) => {
            window.electronAPI?.browser.duplicateTab(event.tabId);
          },
        },
        'TAB.CLOSE_OTHERS': {
          actions: ({ context, event }) => {
            for (const tab of context.tabs) {
              if (tab.id !== event.tabId) {
                window.electronAPI?.browser.closeTab(tab.id);
              }
            }
          },
        },
        'TAB.TOGGLE_MUTE': {
          actions: ({ context, event }) => {
            const tab = context.tabs.find(t => t.id === event.tabId);
            if (tab) {
              window.electronAPI?.browser.setTabMuted(event.tabId, !tab.isMuted);
            }
          },
        },
        // Tab group actions
        'TAB.ADD_TO_GROUP': {
          actions: [
            assign(({ context, event }) => {
              const tabs = context.tabs.map(t =>
                t.id === event.tabId ? { ...t, groupId: event.groupId } : t,
              );
              return { tabs };
            }),
            ({ context }) => persistState(context),
          ],
        },
        'TAB.REMOVE_FROM_GROUP': {
          actions: [
            assign(({ context, event }) => {
              const tabs = context.tabs.map(t =>
                t.id === event.tabId ? { ...t, groupId: undefined } : t,
              );
              const tabGroups = deleteEmptyGroups(tabs, context.tabGroups);
              return { tabs, tabGroups };
            }),
            ({ context }) => persistState(context),
          ],
        },
        'GROUP.CREATE': {
          actions: [
            assign(({ context, event }) => {
              const color = getNextAvailableColor(context.tabGroups);
              const newGroup: TabGroup = {
                id: generateGroupId(),
                name: event.name || `Group ${context.tabGroups.length + 1}`,
                color,
                isCollapsed: false,
                order: context.tabGroups.length,
              };
              const tabGroups = [...context.tabGroups, newGroup];
              const tabs = event.tabIds
                ? context.tabs.map(t => event.tabIds!.includes(t.id) ? { ...t, groupId: newGroup.id } : t)
                : context.tabs;
              return { tabGroups, tabs };
            }),
            ({ context }) => persistState(context),
          ],
        },
        'GROUP.RENAME': {
          actions: [
            assign(({ context, event }) => ({
              tabGroups: context.tabGroups.map(g =>
                g.id === event.groupId ? { ...g, name: event.name } : g,
              ),
            })),
            ({ context }) => persistGroupsOnly(context),
          ],
        },
        'GROUP.CHANGE_COLOR': {
          actions: [
            assign(({ context, event }) => ({
              tabGroups: context.tabGroups.map(g =>
                g.id === event.groupId ? { ...g, color: event.color } : g,
              ),
            })),
            ({ context }) => persistGroupsOnly(context),
          ],
        },
        'GROUP.DELETE': {
          actions: [
            ({ context, event }) => {
              if (event.closeTabs) {
                for (const tab of context.tabs) {
                  if (tab.groupId === event.groupId) {
                    window.electronAPI?.browser.closeTab(tab.id);
                  }
                }
              }
            },
            assign(({ context, event }) => {
              const tabGroups = context.tabGroups.filter(g => g.id !== event.groupId);
              const tabs = event.closeTabs
                ? context.tabs // tabs will be removed via IPC.TAB_REMOVED
                : context.tabs.map(t => t.groupId === event.groupId ? { ...t, groupId: undefined } : t);
              return { tabGroups, tabs };
            }),
            ({ context }) => persistState(context),
          ],
        },
        'GROUP.TOGGLE_COLLAPSE': {
          actions: [
            assign(({ context, event }) => ({
              tabGroups: context.tabGroups.map(g =>
                g.id === event.groupId ? { ...g, isCollapsed: !g.isCollapsed } : g,
              ),
            })),
            ({ context }) => persistGroupsOnly(context),
          ],
        },
        'NAV.GO': {
          actions: [
            assign(({ context, event }) => {
              // If a suggestion is selected, use its URL
              const url = context.selectedSuggestionIndex >= 0
                ? context.suggestions[context.selectedSuggestionIndex]?.url ?? event.url
                : event.url;
              return {
                addressBarValue: url,
                suggestions: [],
                selectedSuggestionIndex: -1,
                inlineCompletion: null,
                _lastNavWasTyped: true,
              };
            }),
            'navigate',
          ],
        },
        'NAV.BACK': { actions: 'goBack' },
        'NAV.FORWARD': { actions: 'goForward' },
        'NAV.RELOAD': { actions: 'reload' },
        'NAV.STOP': { actions: 'stop' },
        'ADDRESS_BAR.UPDATE': {
          actions: [
            assign(({ context, event }) => {
              const isTypingForward = event.value.length > context.addressBarValue.length;
              suppressInlineCompletion = !isTypingForward;

              // Preserve inline completion if the user is typing forward into it
              let inlineCompletion: string | null = null;
              if (isTypingForward && context.inlineCompletion) {
                const currentFull = context.addressBarValue + context.inlineCompletion;
                if (currentFull.toLowerCase().startsWith(event.value.toLowerCase())) {
                  inlineCompletion = currentFull.slice(event.value.length);
                }
              }
              return {
                addressBarValue: event.value,
                preAutocompleteValue: event.value,
                selectedSuggestionIndex: -1,
                inlineCompletion,
              };
            }),
            ({ event, self }) => {
              runAutocompleteQuery(event.value.trim(), (e) => self.send(e));
            },
          ],
        },
        'ADDRESS_BAR.FOCUS': {
          actions: assign({ isAddressBarFocused: true }),
        },
        'ADDRESS_BAR.BLUR': {
          actions: assign({
            isAddressBarFocused: false,
            suggestions: [],
            selectedSuggestionIndex: -1,
            inlineCompletion: null,
          }),
        },
        // Autocomplete
        'AUTOCOMPLETE.RESULTS': {
          actions: assign(({ event }) => ({
            suggestions: event.suggestions,
            inlineCompletion: event.inlineCompletion,
          })),
        },
        'AUTOCOMPLETE.SELECT': {
          actions: assign(({ context, event }) => {
            if (event.index === -1) {
              return {
                selectedSuggestionIndex: -1,
                addressBarValue: context.preAutocompleteValue,
                inlineCompletion: null,
              };
            }
            const suggestion = context.suggestions[event.index];
            if (!suggestion) return {};
            return {
              selectedSuggestionIndex: event.index,
              addressBarValue: suggestion.url,
              inlineCompletion: null,
            };
          }),
        },
        'AUTOCOMPLETE.DISMISS': {
          actions: assign({
            suggestions: [],
            selectedSuggestionIndex: -1,
            inlineCompletion: null,
          }),
        },
        'AUTOCOMPLETE.ACCEPT_INLINE': {
          actions: assign(({ context }) => {
            if (!context.inlineCompletion) return {};
            const full = context.preAutocompleteValue + context.inlineCompletion;
            return {
              addressBarValue: full,
              preAutocompleteValue: full,
              inlineCompletion: null,
            };
          }),
        },
        // Bookmark events
        'BOOKMARK.TOGGLE': {
          actions: [
            assign(({ context }) => {
              const tab = context.tabs.find(t => t.id === context.activeTabId);
              if (!tab?.url || tab.url === 'about:blank' || tab.url.startsWith('data:')) return {};
              const exists = context.bookmarks.some(b => b.url === tab.url);
              const bookmarks = exists
                ? context.bookmarks.filter(b => b.url !== tab.url)
                : [...context.bookmarks, { url: tab.url, title: tab.title, favicon: tab.favicon, displayOrder: context.bookmarks.length }];
              return { bookmarks };
            }),
            ({ context }) => syncBookmarksToBackend(context.bookmarks),
          ],
        },
        'BOOKMARK.REMOVE': {
          actions: [
            assign(({ context, event }) => ({
              bookmarks: context.bookmarks.filter(b => b.url !== event.url),
            })),
            ({ context }) => syncBookmarksToBackend(context.bookmarks),
          ],
        },
        'BOOKMARK.NAVIGATE': {
          actions: [
            assign(({ event }) => ({
              addressBarValue: event.url,
            })),
            'navigate',
          ],
        },
        // What the window restores, asked for when the shell starts the surface, in a delivery naming it
        SURFACE_STARTED: {
          actions: () => { sendToSystem(id, { type: 'GET_SAVED_SESSION' }); },
        },
        'SAVED_SESSION_READ': {
          actions: [
            assign(({ event }) => ({
              tabGroups: loadTabGroups(storage, 'tab-groups'),
              bookmarks: event.savedBookmarks ?? [],
            })),
            ({ context, event }) => {
              const normalized = normalizeSavedTabs(event.savedTabs ?? []);
              if (normalized.invalidCount > 0) {
                console.warn('[Browser] Dropping invalid saved tabs before restore', {
                  rawCount: event.savedTabs?.length ?? 0,
                  repairedCount: normalized.tabs.length,
                  invalidCount: normalized.invalidCount,
                });
              }

              if (context.tabs.length === 0 && normalized.tabs.length > 0) {
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
            },
          ],
        },
        // IPC events
        'IPC.TAB_CREATED': {
          actions: [
            assign(({ context, event }) => {
              if (context.tabs.some(t => t.id === event.tab.id)) return {};
              // Apply pending group assignment from restore
              const tab: BrowserTab = { ...event.tab, persistedId: ensurePersistedTabId(event.tab) };
              const queue = pendingGroupAssignments.get(tab.url);
              if (queue?.length) {
                tab.groupId = queue.shift();
                if (queue.length === 0) pendingGroupAssignments.delete(tab.url);
              }
              return { tabs: [...context.tabs, tab] };
            }),
            ({ context }) => {
              if (restoreTabsRemaining > 0) {
                restoreTabsRemaining -= 1;
                if (restoreTabsRemaining === 0) {
                  syncTabsToBackend(context.tabs);
                }
                return;
              }
              syncTabsToBackend(context.tabs);
            },
          ],
        },
        'IPC.TAB_REMOVED': {
          actions: [
            assign(({ context, event }) => {
              const tabs = context.tabs.filter(t => t.id !== event.tabId);
              const tabGroups = deleteEmptyGroups(tabs, context.tabGroups);
              return {
                tabs,
                tabGroups,
                activeTabId: context.activeTabId === event.tabId
                  ? (tabs.at(-1)?.id ?? null)
                : context.activeTabId,
                ...(context.activeTabId === event.tabId
                  ? { addressBarValue: tabs.at(-1)?.url ?? '' }
                  : {}),
              };
            }),
            ({ context }) => {
              persistGroupsOnly(context);
              syncTabsToBackend(context.tabs, { immediate: true });
            },
          ],
        },
        'IPC.TAB_UPDATED': {
          actions: [
            assign(({ context, event }) => {
              const tabs = context.tabs.map(t =>
                t.id === event.tabId ? { ...t, ...event.changes } : t,
              );
              const syncUrl = !context.isAddressBarFocused
                && event.tabId === context.activeTabId
                && event.changes.url !== undefined;
              return {
                tabs,
                ...(syncUrl ? { addressBarValue: event.changes.url } : {}),
                ...(event.changes.url ? { _lastNavWasTyped: false } : {}),
              };
            }),
            ({ context, event }) => {
              if (event.changes.url && event.changes.url !== 'about:blank' && !event.changes.url.startsWith('data:')) {
                const tab = context.tabs.find(t => t.id === event.tabId);
                recordVisit(event.changes.url, tab?.title ?? '', tab?.favicon ?? '', context._lastNavWasTyped);
              }
              if ((event.changes.title || event.changes.favicon) && !event.changes.url) {
                const tab = context.tabs.find(t => t.id === event.tabId);
                if (tab?.url) updateHistoryMeta(tab.url, event.changes.title, event.changes.favicon);
              }
              // Sync to backend on URL or title changes
              if (event.changes.url || event.changes.title) {
                if (restoreTabsRemaining > 0) return;
                syncTabsToBackend(context.tabs);
              }
            },
          ],
        },
        'IPC.ACTIVE_TAB_CHANGED': {
          actions: assign(({ context, event }) => {
            const tab = context.tabs.find(t => t.id === event.tabId);
            return {
              activeTabId: event.tabId,
              ...(context.isAddressBarFocused ? {} : { addressBarValue: tab?.url ?? '' }),
            };
          }),
        },
      },
    },
  },
});

export default browserState;
