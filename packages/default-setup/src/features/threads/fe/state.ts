import { given, type Each, type Read, type Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import {
  canGoBack,
  canGoForward,
  createNavHistory,
  entityIs,
  freshKey,
  goBack,
  goForward,
  processHotkeys,
  pushNavHistory,
  surfaceStorage,
  untypedOpenSurface,
  viewRead,
  viewWrites,
  writeEnded,
  writeSent,
  writing,
  type HotkeyEvent,
  type HotkeysMap,
  type SurfaceChrome,
  type SurfaceLifecycleEvent,
  type TrailClickEvent,
} from '@apackdev/sdk/fe';
import { resolveName } from '@apackdev/sdk/ids';
import type { EARS } from '@apackdev/sdk';
import { Archive, Copy, Pin, Trash2 } from 'lucide-vue-next';
import { ref as featureRef } from '#generated/ref.ts';
import { state, type PackNet } from '#generated/state.ts';
import type {
  AgentMode as AgentModeConfig,
  AgentSettings,
  AgentThreadData,
  BlockResponse,
  ChatPage,
  ChatStart,
  MessageEntity,
  MessageReferences,
  MessageSearchResult,
  Tab,
  ThreadCreateData,
  ThreadDetailView,
  ThreadEditFields,
  ThreadEntity,
  ThreadExtended,
  ThreadsSettings,
  ThreadTabView,
  ThreadViewData,
} from '#generated/types.ts';
import type { OutgoingThreadsEvents } from '#features/threads/be/types.ts';
import type { RecentThreadsSortOrder } from '#features/threads/be/repository/index.ts';
import { getNextAvailableColor, type TabGroupColor, type ThreadTabGroup } from '#features/threads/fe/canvas/agent/tabs/types.ts';
import { loadThreadTabGroups, saveThreadTabGroups } from '#features/threads/fe/canvas/agent/tabs/tab-groups.ts';
import { blockRunCaughtUp, finishedRun, messageStreamBlocks, messageStreamText, runCaughtUp } from './message-text.ts';
import type { ChatState, Contract, ThreadListItem, ThreadsContext, ThreadsInboxEvent } from './contract.ts';

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('threads'));
const HOST_SETTINGS = resolveName('settings', 'host');

export const id = 'threads' as const;

// The threads surface over its views. It is drawn in several places — the list, the board, a thread's page and the
// dashboard as canvas routes, and the chat beside every surface — so no one component holds its views: the state
// follows each declaratively via `follows`, reacting to its data as arguments change. The list, the recent threads
// and the archived ones are three views from which the thread map is derived; the open thread's chat, its detail
// page and each open tab are one view each; and each message either lists is its own view, so a reply streaming into
// one message re-runs that message's view alone. This window's thread writes hold the thread-level views back until
// each is answered (`ViewWrites`), so a result from before an edit never undoes it on screen.
//
// What it starts from — the thread to open, the tabs every window opens, the settings — is asked for when the shell
// starts the surface (`SURFACE_STARTED`), in a delivery naming it, which is what lets the system answer.

/** How many messages a page of the chat holds, and how many more each `LOAD_MORE_MESSAGES` asks for */
const MESSAGE_PAGE_SIZE = 50;

/** Duration (ms) a freshly created thread stays marked `isNew` for its list entrance animation. */
const NEW_THREAD_ANIMATION_MS = 1000;

/**
 * Where the pointer was, for the one thing that needs it: a hotkey carries no coordinates, so the quick
 * prompt opens at the last position the pointer was seen (`quickPromptCursor`).
 *
 * The listener is owned by the root `listen` below, not installed at module scope, so importing this file
 * touches nothing on `window` and stopping the surface removes its listener cleanly.
 */
let mouseX = 0;
let mouseY = 0;

function getInitialView(): 'list' | 'kanban' | 'dashboard' {
  try {
    const stored = storage.get('view-preference');
    if (stored === 'kanban') return 'kanban';
    if (stored === 'dashboard') return 'dashboard';
  } catch {}
  return 'list';
}

interface StoredTabData {
  tabs: { id: string; label: string; groupId?: string }[];
  activeTabId: string;
}

function saveTabsToStorage(tabs: readonly Tab[], activeTabId: string) {
  try {
    storage.set('open-tabs', JSON.stringify({
      tabs: tabs.filter(t => !t.pinned).map(t => ({ id: t.id, label: t.label, ...(t.groupId && { groupId: t.groupId }) })),
      activeTabId,
    } satisfies StoredTabData));
  } catch {}
}

function loadTabsFromStorage(): StoredTabData | null {
  try {
    const raw = storage.get('open-tabs');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function extractChatSettings(chatSettings: AgentSettings) {
  const hotkeys: HotkeysMap = {};
  if (chatSettings.hotkeys) {
    Object.entries(chatSettings.hotkeys).forEach(([key, value]) => {
      if (value) hotkeys[key] = value;
    });
  }
  return { chatSettings, hotkeys, modes: chatSettings.modes || [] };
}

export function resolveDefaultModePhase(
  settings: AgentSettings | undefined,
  modes: readonly AgentModeConfig[],
  fallbackMode: string,
  fallbackPhase: string | undefined,
): { mode: string; phase: string | undefined } {
  const preferredMode = settings?.defaultMode
    ? modes.find(m => m.name === settings.defaultMode)
    : undefined;
  const fallbackModeConfig = modes.find(m => m.name === fallbackMode);
  const modeConfig = preferredMode && !preferredMode.hidden && !preferredMode.disabled
    ? preferredMode
    : fallbackModeConfig;
  const mode = modeConfig?.name ?? fallbackMode;

  const hasPhases = !!modeConfig?.phases?.length;
  const preferredPhase = settings?.defaultPhase
    ? modeConfig?.phases?.find(p => p.name === settings.defaultPhase)
    : undefined;
  const fallbackPhaseConfig = fallbackPhase
    ? modeConfig?.phases?.find(p => p.name === fallbackPhase)
    : undefined;
  const phase = hasPhases
    ? (preferredPhase?.name ?? fallbackPhaseConfig?.name ?? modeConfig!.phases![0].name)
    : fallbackPhase;

  return { mode, phase };
}

const defaultThread: ThreadCreateData | ThreadViewData = {
  topic: '',
  instructions: '',
  tags: [],
  linkedThreads: [],
};

const defaultChatThread: AgentThreadData = {
  id: undefined,
  topic: '',
  instructions: '',
  status: 'backlog',
  timestamp: Date.now(),
  messages: [],
  artifacts: [],
};

export type { ChatState, ThreadListItem } from './contract.ts';

// ---- Types ----

type ThreadsAsks = PackNet['systems']['threads']['asks'];

type ChatFollowupEvent =
  | { type: 'LOAD_MORE_MESSAGES' }
  | { type: 'OPEN_THREAD_CHAT'; threadId: string };

type RecentViewArgs = { limit: number; sortOrder: RecentThreadsSortOrder };

type ThreadsData = Omit<
  ThreadsContext,
  'selectedThreadCode' | 'pendingActionId' | 'pendingThreadCwd' | 'pendingForceDirectoryPicker'
> & {
  selectedThreadCode: string | undefined;
  pendingActionId: string | undefined;
  pendingThreadCwd: string | undefined;
  pendingForceDirectoryPicker: boolean | undefined;
  /** Whether `SURFACE_STARTED` has run and the list view should be followed. */
  started: boolean;
  /** Incremented when a held/refused write settles so thread-level views re-subscribe cleanly. */
  viewRefresh: number;
  /** Arguments for `archived` and `recent` views, populated once settings arrive. */
  recentViewArgs: RecentViewArgs | null;
  /** The thread followed by the `detail` view while in `view`. */
  detailThreadId: string | null;
  /** The thread followed by the `chat` view (kept separate from `currentThread` so chat reads never re-trigger `chat`). */
  chatThreadId: string | null;
  /** Versioned keys (`${viewRefresh}:${threadId}`) driving `follows.tabs` so `viewRefresh` re-subscribes open tabs. */
  tabViewKeys: string[];
  /** Trimmed search query driving `follows.messageSearch`. */
  searchQuery: string;
  /** Active chat-state override timers, keyed by `${threadId}:${seq}` so a later flash cancels the earlier timer. */
  overrideTimers: Record<string, { threadId: string; durationMs: number }>;
  /** Monotonic sequence for versioned timer and follow-up keys. */
  timerSeq: number;
  /** Deferred microtask follow-ups scheduled from a `chat` view delivery so they execute in a fresh step. */
  chatFollowups: Record<string, { event: ChatFollowupEvent }>;
};

const _feContractCheck: ThreadsData extends ThreadsContext ? true : never = true;
void _feContractCheck;

type SystemEvent =
  | OutgoingThreadsEvents
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: ThreadsSettings }
  | Extract<SurfaceLifecycleEvent, { type: 'SURFACE_STARTED' }>;

type UIEvent =
  | Exclude<ThreadsInboxEvent, { type: 'OPEN_THREAD_CHAT' }>
  // Thread management events
  | { type: 'OPEN_THREAD_CHAT'; threadId: string; restore?: boolean }
  | { type: 'SHOW_CREATE_FORM' }
  | { type: 'SHOW_CREATE_FORM_AS_CHILD'; parentThreadId: string }
  | { type: 'VIEW_LIST' }
  | { type: 'VIEW_KANBAN' }
  | { type: 'VIEW_DASHBOARD' }
  | { type: 'UPDATE_THREAD_STATUS'; id: string; status: ThreadEntity['status'] }
  | { type: 'SELECT_THREAD'; id: string }
  | { type: 'CREATE_THREAD' }
  | { type: 'CANCEL_CREATE' }
  | { type: 'DELETE_THREAD'; threadId: string }
  | { type: 'ARCHIVE_THREAD'; threadId: string }
  | { type: 'UNARCHIVE_THREAD'; threadId: string }
  | { type: 'TOGGLE_VIEW_ARCHIVE' }
  | { type: 'UNPIN_THREAD'; threadId: string }
  | { type: 'PIN_THREAD'; threadId: string }
  | {
    type: 'UPDATE_THREAD_FIELD';
    key: keyof ThreadEditFields;
    value: ThreadEditFields[keyof ThreadEditFields];
    state: 'create' | 'view';
  }
  | { type: 'CLEAR_NEW_THREAD_FLAG'; id: string }
  | { type: 'TOGGLE_TAGS_SECTION'; show: boolean }
  | { type: 'TOGGLE_LINKED_SECTION'; show: boolean }
  | { type: 'TOGGLE_FILTER_STATUS'; status: string }
  | { type: 'TOGGLE_FILTER_TAG'; tag: string }
  | { type: 'TOGGLE_FILTER_CHAT_STATE'; chatState: string }
  | { type: 'SET_SEARCH'; keyword: string }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'TOGGLE_ROOT_ONLY_FILTER' }
  | { type: 'SELECT_THREAD_ITEMS'; itemIds: string[] }
  | { type: 'SET_THREAD_PARENT'; childIds: string[]; parentId: string }
  | { type: 'THREADS.IMPORT'; directory: string }
  | { type: 'THREADS.RESET_IMPORT_STATUS' }
  | { type: 'THREADS.EXPORT'; directory: string }
  | { type: 'THREADS.RESET_EXPORT_STATUS' }
  // Chat/agent events
  | { type: 'VIEW_THREAD'; threadId: string }
  | { type: 'SEND_MESSAGE'; text: string; references?: MessageReferences }
  | { type: 'SEND_COMMAND'; command: string; text: string; references?: MessageReferences }
  | { type: 'CLEAR_THREAD' }
  | { type: 'NEW_THREAD_IN_PROJECT'; directory: string }
  | { type: 'NEW_THREAD_NO_PROJECT' }
  | { type: 'CREATE_CHILD_THREAD'; parentThreadId: string }
  | { type: 'CLEAR_CHAT_STATE_OVERRIDE'; threadId: string }
  | { type: 'SELECT_TAB'; tabId: string }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'CLOSE_ACTIVE_TAB' }
  | { type: 'SELECT_ARTIFACT'; artifactId: string }
  | { type: 'SET_MODE'; mode: string }
  | { type: 'SET_PHASE'; phase: string }
  | { type: 'RESPOND_TO_BLOCK_INTERACTION'; messageId: string; response: BlockResponse }
  | ({ type: 'HOTKEY_PRESSED' } & HotkeyEvent)
  | { type: 'OPEN_QUICK_PROMPTS' }
  | { type: 'CLOSE_QUICK_PROMPTS' }
  | { type: 'TOGGLE_QUICK_PROMPTS' }
  | { type: 'NAVIGATE_TO_SECRETS' }
  | { type: 'FORK_THREAD'; messageId: string; threadId?: string; threadTopic?: string }
  | { type: 'REVERT_THREAD'; messageId: string; threadId: string; restoreFiles?: boolean; userCliUuid?: string }
  | { type: 'SUMMARIZE_THREAD'; messageId: string; threadId: string }
  | { type: 'PAUSE_TURN'; threadId: string }
  | { type: 'UNQUEUE_MESSAGE'; threadId: string; messageId: string }
  | { type: 'DISMISS_MESSAGE'; messageId: string }
  | { type: 'LOAD_MORE_MESSAGES' }
  | { type: 'SEARCH_MESSAGES'; query: string }
  | { type: 'OPEN_MESSAGE'; threadId: string; messageId: string }
  | { type: 'FOCUSED_MESSAGE_SHOWN' }
  | { type: 'CHAT.FAILURES_TOLD'; told: readonly { readonly message: string }[] }
  | { type: 'RENAME_THREAD'; threadId: string; topic: string }
  // Tab reorder & group events
  | { type: 'REORDER_TABS'; fromIndex: number; toIndex: number }
  | { type: 'PIN_TAB_AT'; tabId: string; targetTabId: string; side: 'left' | 'right' }
  | { type: 'UNPIN_TAB_AT'; tabId: string; targetTabId: string; side: 'left' | 'right' }
  | { type: 'CREATE_TAB_GROUP'; tabIds?: string[] }
  | { type: 'RENAME_TAB_GROUP'; groupId: string; name: string }
  | { type: 'CHANGE_TAB_GROUP_COLOR'; groupId: string; color: TabGroupColor }
  | { type: 'DELETE_TAB_GROUP'; groupId: string }
  | { type: 'TOGGLE_TAB_GROUP_COLLAPSE'; groupId: string }
  | { type: 'ADD_TAB_TO_GROUP'; tabId: string; groupId: string }
  | { type: 'ADD_TAB_TO_GROUP_AT'; tabId: string; groupId: string; targetTabId: string; side: 'left' | 'right' }
  | { type: 'REMOVE_TAB_FROM_GROUP'; tabId: string }
  | { type: 'UNGROUP_ALL_IN_GROUP'; groupId: string }
  | { type: 'CLOSE_ALL_IN_GROUP'; groupId: string }
  | { type: 'PIN_TAB_GROUP'; groupId: string }
  | { type: 'UNPIN_TAB_GROUP'; groupId: string }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' };

export type ThreadsEvents = OpenEntity | UIEvent | SystemEvent | TrailClickEvent;

// ---- Child timer & microtask states ----

const newThreadFlagTimerState = state<
  { data: { threadId: string }; reports: { type: 'CLEAR_NEW_THREAD_FLAG'; id: string } },
  never
>()({
  data: { threadId: given },
  run: async ({ data, sleep, report }) => {
    await sleep(NEW_THREAD_ANIMATION_MS);
    report({ type: 'CLEAR_NEW_THREAD_FLAG', id: data.threadId });
  },
  failed: () => {},
});

const chatStateOverrideTimerState = state<
  { data: { threadId: string; durationMs: number }; reports: { type: 'CLEAR_CHAT_STATE_OVERRIDE'; threadId: string } },
  never
>()({
  data: { threadId: given, durationMs: given },
  run: async ({ data, sleep, report }) => {
    await sleep(data.durationMs);
    report({ type: 'CLEAR_CHAT_STATE_OVERRIDE', threadId: data.threadId });
  },
  failed: () => {},
});

const chatFollowupState = state<
  { data: { event: ChatFollowupEvent }; reports: ChatFollowupEvent },
  never
>()({
  data: { event: given },
  run: async ({ data, report }) => {
    await Promise.resolve();
    report(data.event);
  },
  failed: () => {},
});

type ThreadsShape = {
  data: ThreadsData;
  calls: {
    chatStart: 'one';
    created: { readonly each: ThreadsAsks['CREATE_THREAD']['args'] };
    opened: { readonly many: ThreadsAsks['OPEN_THREAD_CHAT']['args'] };
    sent: { readonly many: ThreadsAsks['USER_MSG']['args'] };
    sentCommand: { readonly many: ThreadsAsks['USER_COMMAND']['args'] };
    forked: { readonly many: ThreadsAsks['FORK_THREAD']['args'] };
    imported: { readonly many: ThreadsAsks['IMPORT_THREADS']['args'] };
    exported: { readonly many: ThreadsAsks['EXPORT_THREADS']['args'] };
    statusWrite: { readonly each: ThreadsAsks['UPDATE_THREAD_STATUS']['args'] };
    fieldWrite: { readonly each: ThreadsAsks['UPDATE_THREAD_FIELD']['args'] };
    deleteWrite: { readonly each: ThreadsAsks['DELETE_THREAD']['args'] };
    parentWrite: { readonly each: ThreadsAsks['SET_THREAD_PARENT']['args'] };
  };
  starts: {
    newThreadTimers: Each<typeof newThreadFlagTimerState>;
    overrideTimers: Each<typeof chatStateOverrideTimerState>;
    chatFollowups: Each<typeof chatFollowupState>;
  };
  states: {
    dashboard: {};
    list: {};
    kanban: {};
    create: {};
    view: {};
  };
};

// ---- Helpers ----

type ThreadLike = Partial<ThreadEntity> & { id: string };

export function threadsFromStore<T>(threadMap: Readonly<Record<string, T>>, threadIds: readonly string[]): T[] {
  return threadIds.map(id => threadMap[id]).filter((thread): thread is T => Boolean(thread));
}

function threadIdsFrom(threads: readonly ThreadLike[]): string[] {
  return threads.map(t => t.id);
}

function mergeThreadMap(
  threadMap: Readonly<Record<string, ThreadListItem>>,
  threads: readonly ThreadLike[],
): Record<string, ThreadListItem> {
  const next = { ...threadMap };
  for (const thread of threads) {
    next[thread.id] = { ...next[thread.id], ...thread } as ThreadListItem;
  }
  return next;
}

/** Update a single thread in the map (no-op if not found) */
function patchThread(data: Read<ThreadsData>, threadId: string, patch: Partial<ThreadListItem>) {
  const existing = data.threadMap[threadId];
  if (!existing) return { threadMap: { ...data.threadMap } };
  return { threadMap: { ...data.threadMap, [threadId]: { ...existing, ...patch } } };
}

/** Remove a thread from the map and id list */
function removeThread(data: Read<ThreadsData>, threadId: string) {
  const { [threadId]: _, ...rest } = data.threadMap;
  return { threadMap: rest, threadIds: data.threadIds.filter(id => id !== threadId) };
}

/** A thread's field as the user set it, shown at once: `write` is the ask that stores it, which the views are held behind */
function optimisticFieldUpdate(data: Read<ThreadsData>, write: string, threadId: string, key: string, value: unknown) {
  return {
    writes: writeSent(data.writes, write),
    ...patchThread(data, threadId, { [key]: value } as Partial<ThreadListItem>),
    tabs: data.tabs.map(t => t.id === threadId ? { ...t, [key]: value, ...(key === 'topic' ? { label: value as string } : {}) } : t),
    ...(data.currentThread?.id === threadId ? { currentThread: { ...data.currentThread, [key]: value } } : {}),
    ...(data.view.id === threadId ? { view: { ...data.view, [key]: value } } : {}),
  };
}

/**
 * The thread map and the lists the surface shows, derived from what the list, recent and archived views last gave:
 * a thread deleted anywhere leaves all three, and so the map
 */
function threadStore(
  freshThreadIds: readonly string[],
  showArchived: boolean,
  lists: ThreadsData['lists'],
): Partial<ThreadsData> {
  const threadMap = mergeThreadMap({}, [...lists.archived, ...lists.recent, ...lists.list] as ThreadLike[]);
  for (const fresh of freshThreadIds) {
    if (threadMap[fresh]) threadMap[fresh] = { ...threadMap[fresh], isNew: true };
  }
  const chatStates: Record<string, ChatState> = {};
  for (const thread of Object.values(threadMap)) {
    if (typeof thread.chatState === 'string') chatStates[thread.id] = thread.chatState as ChatState;
  }
  return {
    lists,
    threadMap,
    chatStates,
    threadIds: threadIdsFrom((showArchived ? lists.archived : lists.list) as ThreadLike[]),
    recentThreadIds: threadIdsFrom(lists.recent as ThreadLike[]),
    sidebarArchivedThreads: lists.archived as ThreadListItem[],
  };
}

/** The messages `ids` name: the row each view last gave, with a streamed reply's run spliced in (G1) */
function messagesOf(
  messageContents: Readonly<Record<string, Partial<MessageEntity>>>,
  messageStreams: Readonly<Record<string, { readonly at: number; readonly text: string }>>,
  messageBlockStreams: Readonly<Record<string, { readonly blockId: string; readonly at: number; readonly text: string }>>,
  ids: readonly string[],
): Partial<MessageEntity>[] {
  return ids.flatMap((messageId) => {
    const row = messageContents[messageId];
    if (!row) return [];
    const shown = messageStreamText(row.text, messageStreams[messageId]);
    const blocks = messageStreamBlocks(row.blocks, messageBlockStreams[messageId]);
    if (shown === row.text && blocks === row.blocks) return [row];
    return [{ ...row, ...(shown === row.text ? {} : { text: shown }), ...(blocks === row.blocks ? {} : { blocks }) }];
  });
}

/** The chat's and the detail page's messages, composed again from their ids and each message's view */
function composedMessages(
  currentThread: Read<AgentThreadData> | null,
  view: Read<ThreadViewData>,
  chatMessageIds: readonly string[],
  detailMessageIds: readonly string[],
  messageContents: Readonly<Record<string, Partial<MessageEntity>>>,
  messageStreams: Readonly<Record<string, { readonly at: number; readonly text: string }>>,
  messageBlockStreams: Readonly<Record<string, { readonly blockId: string; readonly at: number; readonly text: string }>>,
) {
  return {
    currentThread: currentThread
      ? { ...currentThread, messages: messagesOf(messageContents, messageStreams, messageBlockStreams, chatMessageIds) }
      : currentThread,
    view: { ...view, messages: messagesOf(messageContents, messageStreams, messageBlockStreams, detailMessageIds) },
  };
}

/** Synchronizes `messageViews` with the listed chat + detail messages, pruning unfollowed rows/streams and recomposing messages. */
function syncMessages(
  data: Read<ThreadsData>,
  chatMessageIds: readonly string[],
  detailMessageIds: readonly string[],
  currentThread: Read<AgentThreadData> | null = data.currentThread,
  view: Read<ThreadViewData> = data.view,
) {
  const listed = [...new Set([...chatMessageIds, ...detailMessageIds])];
  const messageContents = Object.fromEntries(
    listed.flatMap(messageId => (data.messageContents[messageId] ? [[messageId, data.messageContents[messageId]]] : [])),
  );
  // A streamed run is pruned with the row it splices onto; a window that stops listing a message holds
  // neither, and nothing accumulates across a long session
  const messageStreams = Object.fromEntries(
    listed.flatMap(messageId => (data.messageStreams[messageId] ? [[messageId, data.messageStreams[messageId]]] : [])),
  );
  const messageBlockStreams = Object.fromEntries(
    listed.flatMap(messageId => (data.messageBlockStreams[messageId] ? [[messageId, data.messageBlockStreams[messageId]]] : [])),
  );
  return {
    chatMessageIds: [...chatMessageIds],
    detailMessageIds: [...detailMessageIds],
    messageViews: listed,
    messageContents,
    messageStreams,
    messageBlockStreams,
    ...composedMessages(currentThread, view, chatMessageIds, detailMessageIds, messageContents, messageStreams, messageBlockStreams),
  };
}

function makeTabViewKeys(tabs: readonly Tab[], viewRefresh: number): string[] {
  return tabs.map(tab => `${viewRefresh}:${tab.id}`);
}

function threadIdFromTabKey(key: string): string {
  const cut = key.indexOf(':');
  return cut >= 0 ? key.slice(cut + 1) : key;
}

/** Updates tab view tracking (`tabViews`, `tabViewKeys`, `tabsRead`) and persists open tabs to window storage. */
function syncTabs(
  tabs: readonly Tab[],
  activeTabId: string,
  tabsRead: readonly string[],
  viewRefresh: number,
) {
  saveTabsToStorage(tabs, activeTabId);
  const open = tabs.map(tab => tab.id);
  return {
    tabs: [...tabs],
    activeTabId,
    tabViews: open,
    tabViewKeys: makeTabViewKeys(tabs, viewRefresh),
    tabsRead: tabsRead.filter(threadId => open.includes(threadId)),
  };
}

/** Removes any tab groups with no remaining tabs and persists groups to storage. */
function cleanupAndPersistGroups(tabs: readonly Tab[], tabGroups: readonly ThreadTabGroup[]): ThreadTabGroup[] {
  const tabGroupIds = new Set(tabs.map(t => t.groupId).filter(Boolean));
  const nextGroups = tabGroups.filter(g => tabGroupIds.has(g.id));
  saveThreadTabGroups(nextGroups);
  return nextGroups;
}

/** Clears detail-view tracking when leaving the `view` state so its messages are pruned. */
function leaveDetailData(data: Read<ThreadsData>) {
  if (data.detailThreadId === null && data.detailMessageIds.length === 0) return {};
  return {
    detailThreadId: null,
    ...syncMessages(data, data.chatMessageIds, []),
  };
}

/** The recent threads' limit and order, as the settings hold them */
function recentArgs(settings: Read<ThreadsSettings> | null): RecentViewArgs {
  const limit = settings?.recentThreadsLimit;
  const sortOrder = settings?.recentThreadsSortOrder;
  return {
    limit: typeof limit === 'number' && limit > 0 ? limit : 7,
    sortOrder: sortOrder === 'visited' || sortOrder === 'message' ? sortOrder : 'created',
  };
}

function persistListView() { try { storage.set('view-preference', 'list'); } catch {} }
function persistKanbanView() { try { storage.set('view-preference', 'kanban'); } catch {} }
function persistDashboardView() { try { storage.set('view-preference', 'dashboard'); } catch {} }

function selectedThreadData(data: Read<ThreadsData>, threadId: string) {
  const selectedThread = data.threadMap[threadId];
  if (!selectedThread) {
    // Thread not in threadMap (e.g. archived, or tab restored from storage).
    // Reset view to defaults with the target id, for its detail view to fill.
    return {
      selectedThreadCode: undefined,
      linkSave: null,
      linkRefusal: null,
      view: {
        ...defaultThread,
        id: threadId as ThreadEntity['id'],
        shortCode: '' as const,
        status: '',
        timestamp: 0,
      },
    };
  }

  const { id: tid, shortCode, status, timestamp, topic, instructions, tags, pinned } = selectedThread;
  return {
    selectedThreadCode: shortCode,
    linkSave: null,
    linkRefusal: null,
    view: {
      ...defaultThread,
      id: tid,
      shortCode,
      status,
      timestamp,
      topic,
      instructions,
      tags: tags ? [...tags] : [],
      pinned,
    },
  };
}

function applySettings(settings: ThreadsSettings) {
  const chat = (settings as unknown as { chat?: AgentSettings })?.chat;
  return {
    settings,
    availableTags: settings?.tags || [],
    ...(chat ? extractChatSettings(chat) : {}),
    recentViewArgs: settings ? recentArgs(settings) : null,
  };
}

/** Settles one of this window's writes; increments `viewRefresh` when held/refused writes require fresh views. */
function settleWrite(
  data: Read<ThreadsData>,
  ask: string,
  outcome: { readonly ok: true } | { readonly ok: false; readonly failure: { readonly message: string } },
) {
  const writes = writeEnded(data.writes, ask, !outcome.ok);
  const refreshed = writes.refreshes !== data.writes.refreshes;
  const viewRefresh = refreshed ? data.viewRefresh + 1 : data.viewRefresh;
  return {
    writes,
    ...(data.linkSave !== null && data.linkSave === ask
      ? { linkSave: null, linkRefusal: outcome.ok ? null : outcome.failure.message }
      : {}),
    ...(refreshed ? { viewRefresh, tabViewKeys: makeTabViewKeys(data.tabs, viewRefresh) } : {}),
  };
}

/** Drops a gone thread from open tabs and chat; defers next-tab open when called from `chat.updated` to avoid view cycle. */
function dropThreadData(
  data: Read<ThreadsData>,
  threadId: string,
  deferNextOpen: boolean,
  send: (event: Read<ThreadsEvents>) => void,
) {
  const index = data.tabs.findIndex(t => t.id === threadId);
  const tabs = data.tabs.filter(t => t.id !== threadId);
  let activeTabId = data.activeTabId;
  if (data.activeTabId === threadId) {
    const nextTab = data.tabs[index + 1] ?? data.tabs[index - 1];
    activeTabId = nextTab && nextTab.id !== threadId ? nextTab.id : '';
  }
  const tabGroups = cleanupAndPersistGroups(tabs, data.tabGroups);
  const closingChat = data.currentThread?.id === threadId;
  const nextCurrentThread = closingChat ? { ...defaultChatThread, messages: [] } : data.currentThread;
  const shouldOpenNext = Boolean(activeTabId && activeTabId !== data.activeTabId);

  let chatFollowups: Record<string, { event: ChatFollowupEvent }> = {};
  let timerSeq = data.timerSeq;
  if (shouldOpenNext) {
    if (deferNextOpen) {
      timerSeq += 1;
      chatFollowups = { [`open:${activeTabId}:${timerSeq}`]: { event: { type: 'OPEN_THREAD_CHAT', threadId: activeTabId } } };
    } else {
      send({ type: 'OPEN_THREAD_CHAT', threadId: activeTabId });
    }
  }

  return {
    ...syncTabs(tabs, activeTabId, data.tabsRead, data.viewRefresh),
    tabGroups,
    ...(closingChat
      ? {
          chatThreadId: null,
          ...syncMessages(data, [], data.detailMessageIds, nextCurrentThread),
        }
      : {}),
    ...(deferNextOpen ? { chatFollowups, timerSeq } : {}),
  };
}

/** Removes all timer entries belonging to `threadId` from `overrideTimers`. */
function withoutOverrideTimer(
  timers: Readonly<Record<string, { readonly threadId: string; readonly durationMs: number }>>,
  threadId: string,
): Record<string, { threadId: string; durationMs: number }> {
  const next: Record<string, { threadId: string; durationMs: number }> = {};
  for (const [k, v] of Object.entries(timers)) {
    if (v.threadId !== threadId) next[k] = { threadId: v.threadId, durationMs: v.durationMs };
  }
  return next;
}

function openThreadTransition(
  data: Read<ThreadsData>,
  threadId: string,
  restore: boolean | undefined,
  isOpenChatAsk: boolean,
  call: (name: 'opened', input: Read<ThreadsAsks['OPEN_THREAD_CHAT']['args']>) => void,
) {
  if (isOpenChatAsk) {
    call('opened', { threadId, ...(restore && { restore }) });
  }
  const known = data.threadMap[threadId];
  const label = known?.topic || data.tabs.find(t => t.id === threadId)?.label || `Thread ${known?.shortCode || ''}`.trim();
  const tabs = data.tabs.some(t => t.id === threadId)
    ? data.tabs
    : [...data.tabs, { id: threadId, label, artifacts: [], ...(known?.pinned && { pinned: true }) }];

  const switchingChat = data.currentThread?.id !== threadId;
  const nextCurrentThread: AgentThreadData | null = switchingChat
    ? {
        ...defaultChatThread,
        ...(known && { topic: known.topic, shortCode: known.shortCode, status: known.status }),
        id: threadId as EARS.EntityId,
        messages: [],
      }
    : (data.currentThread as AgentThreadData | null);

  return {
    at: 'dashboard' as const,
    data: {
      ...leaveDetailData(data),
      navHistory: pushNavHistory(data.navHistory, 'dashboard'),
      ...syncTabs(tabs, threadId, data.tabsRead, data.viewRefresh),
      chatFollowups: {},
      ...(switchingChat
        ? {
            chatThreadId: threadId,
            chatLimit: MESSAGE_PAGE_SIZE,
            messagePagination: { hasMore: false, isLoading: true },
            openedThreadId: threadId,
            // A message sought in another thread is no longer the one to bring into view
            ...(data.focusMessage && data.focusMessage.threadId !== threadId ? { focusMessage: null } : {}),
            ...syncMessages(data, [], data.detailThreadId === null ? [] : data.detailMessageIds, nextCurrentThread),
          }
        : {}),
    },
  };
}

function navigateHistory(
  data: Read<ThreadsData>,
  direction: 'back' | 'forward',
  tell: (to: 'threads', event: { type: 'VIEW_THREAD'; threadId: string }) => void,
) {
  const canMove = direction === 'back' ? canGoBack(data.navHistory) : canGoForward(data.navHistory);
  if (!canMove) return undefined;
  const result = direction === 'back' ? goBack(data.navHistory) : goForward(data.navHistory);
  if (!result) return undefined;

  if (result.entry.startsWith('view:')) {
    const threadId = result.entry.replace('view:', '');
    const selectedThread = data.threadMap[threadId];
    tell('threads', { type: 'VIEW_THREAD', threadId });
    return {
      at: 'view' as const,
      data: {
        navHistory: result.history,
        detailThreadId: threadId,
        view: (selectedThread
          ? { ...data.view, ...selectedThread, id: threadId }
          : { ...data.view, id: threadId }) as ThreadViewData,
      },
    };
  }
  const entry = result.entry;
  const navData = { ...leaveDetailData(data), navHistory: result.history };
  if (entry === 'list') return { at: 'list' as const, data: navData };
  if (entry === 'kanban') return { at: 'kanban' as const, data: navData };
  if (entry === 'dashboard') return { at: 'dashboard' as const, data: navData };
  if (entry === 'create') return { at: 'create' as const, data: navData };
  return undefined;
}

// ---- Declarative Chrome ----

export const threadsChrome: SurfaceChrome<Value<ThreadsShape>> = {
  default: { label: 'Threads', target: 'list' },
  states: {
    list: {
      breadcrumb: { label: 'Threads', target: 'list' },
    },
    dashboard: {
      breadcrumb: { label: 'Dashboard', target: 'dashboard' },
    },
    kanban: {
      breadcrumb: { label: 'Board', target: 'kanban' },
    },
    create: {
      breadcrumb: { label: 'New Thread', target: 'create' },
    },
    view: {
      breadcrumb: ({ data }) => ({
        label: data.view.topic || 'Untitled Thread',
        target: 'view',
      }),
      menu: ({ data }) => {
        if (!data.view?.id) return [];
        return [
          ...(data.view.pinned ? [{
            label: 'Unpin Thread',
            icon: Pin,
            event: { type: 'UNPIN_THREAD' as const, threadId: data.view.id },
          }] : [{
            label: 'Pin Thread',
            icon: Pin,
            event: { type: 'PIN_THREAD' as const, threadId: data.view.id },
          }]),
          ...(data.view.archived ? [{
            label: 'Unarchive Thread',
            icon: Archive,
            event: { type: 'UNARCHIVE_THREAD' as const, threadId: data.view.id },
          }] : !data.view.pinned ? [{
            label: 'Archive Thread',
            icon: Archive,
            event: { type: 'ARCHIVE_THREAD' as const, threadId: data.view.id },
            confirm: `Archive thread "${data.view.topic || 'Untitled'}"? It will be hidden from all lists.`,
          }] : []),
          ...(!data.view.pinned ? [{
            label: 'Delete Thread',
            icon: Trash2,
            event: { type: 'DELETE_THREAD' as const, threadId: data.view.id },
            iconColor: 'text-red-400',
            confirm: `Are you sure you want to delete thread "${data.view.topic || 'Untitled'}"? This will permanently delete all messages and other data associated.`,
          }] : []),
          {
            label: 'Copy Id',
            icon: Copy,
            event: { type: 'APP_COPY_TO_CLIPBOARD' as const, text: data.view.id },
            separator: true,
          },
        ];
      },
    },
  },
};

// ---- State Machine ----

const threadsState = state<ThreadsShape, ThreadsEvents>()({
  initial: 'list',
  data: {
    // Thread management (normalized)
    threadMap: {},
    threadIds: [],
    selectedThreadIds: [],
    selectedThreadCode: undefined,
    view: {
      id: '' as ThreadEntity['id'],
      shortCode: '',
      status: '',
      timestamp: 0,
      ...defaultThread,
    } as ThreadViewData,
    create: { ...defaultThread },
    availableTags: [],
    settings: null,
    showArchived: false,
    filters: { statuses: [], tags: [], chatStates: [], search: '', showRootOnly: true },
    threadsImport: { status: 'idle', errors: [], importedCount: 0 },
    threadsExport: { status: 'idle', errors: [], filePath: '', threadCount: 0 },
    // Chat/agent
    currentThread: defaultChatThread,
    recentThreadIds: [],
    messageInput: '',
    pendingActionId: undefined,
    chatStates: {},
    chatStateOverrides: {},
    tabs: [],
    activeTabId: '',
    tabGroups: [],
    mode: '',
    phase: '',
    phaseByModeName: {},
    modes: [],
    hotkeys: {},
    chatSettings: { modes: [], hotkeys: {} },
    quickPromptCursor: null,
    pendingThreadCwd: undefined,
    pendingForceDirectoryPicker: undefined,
    navHistory: createNavHistory('list'),
    messagePagination: { hasMore: false, isLoading: false },
    sidebarArchivedThreads: [],
    messageSearch: { query: '', results: [], searching: false },
    focusMessage: null,
    lists: { list: [], recent: [], archived: [] },
    chatLimit: MESSAGE_PAGE_SIZE,
    chatMessageIds: [],
    detailMessageIds: [],
    messageContents: {},
    messageStreams: {},
    messageBlockStreams: {},
    messageViews: [],
    tabViews: [],
    tabsRead: [],
    openedThreadId: null,
    freshThreadIds: [],
    writes: viewWrites(),
    linkSave: null,
    linkRefusal: null,
    sendFailures: [],
    // View & timer orchestration
    started: false,
    viewRefresh: 0,
    recentViewArgs: null,
    detailThreadId: null,
    chatThreadId: null,
    tabViewKeys: [],
    searchQuery: '',
    overrideTimers: {},
    timerSeq: 0,
    chatFollowups: {},
  },
  run: () => {
    const initial = getInitialView();
    if (initial !== 'list') {
      return { at: initial, data: { navHistory: createNavHistory(initial) } };
    }
  },
  // Follows the pointer for as long as this surface runs, and takes its listener back when it stops.
  listen: () => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const follow = (event: MouseEvent) => { mouseX = event.clientX; mouseY = event.clientY; };
    window.addEventListener('mousemove', follow, { passive: true });
    return () => window.removeEventListener('mousemove', follow);
  },
  starts: (start) => ({
    newThreadTimers: start(newThreadFlagTimerState, {
      each: 'freshThreadIds',
      given: (threadId) => ({ threadId }),
    }),
    overrideTimers: start(chatStateOverrideTimerState, {
      each: 'overrideTimers',
      given: (key, data) => {
        const entry = data.overrideTimers[key];
        return { threadId: entry?.threadId ?? key, durationMs: entry?.durationMs ?? 3000 };
      },
    }),
    chatFollowups: start(chatFollowupState, {
      each: 'chatFollowups',
      given: (key, data) => ({ event: data.chatFollowups[key]!.event }),
    }),
  }),
  follows: (follow) => ({
    list: follow('threads', 'list', {
      from: ['started', 'viewRefresh'],
      args: ({ started }) => (started ? {} : false),
      updated: (update, { data }) => {
        if (!update.ok) return;
        const { writes, apply } = viewRead(data.writes);
        if (!apply) return { data: { writes } };
        return {
          data: {
            writes,
            ...threadStore(data.freshThreadIds, data.showArchived, {
              list: update.value as ThreadExtended[],
              recent: [...data.lists.recent],
              archived: [...data.lists.archived],
            }),
          },
        };
      },
    }),
    archived: follow('threads', 'archived', {
      from: ['recentViewArgs', 'viewRefresh'],
      args: ({ recentViewArgs }) => (recentViewArgs ? { sortOrder: recentViewArgs.sortOrder } : false),
      updated: (update, { data }) => {
        if (!update.ok) return;
        const { writes, apply } = viewRead(data.writes);
        if (!apply) return { data: { writes } };
        return {
          data: {
            writes,
            ...threadStore(data.freshThreadIds, data.showArchived, {
              list: [...data.lists.list],
              recent: [...data.lists.recent],
              archived: update.value as Partial<ThreadEntity>[],
            }),
          },
        };
      },
    }),
    recent: follow('threads', 'recent', {
      from: ['recentViewArgs', 'viewRefresh'],
      args: ({ recentViewArgs }) => (recentViewArgs ? { limit: recentViewArgs.limit, sortOrder: recentViewArgs.sortOrder } : false),
      updated: (update, { data }) => {
        if (!update.ok) return;
        const { writes, apply } = viewRead(data.writes);
        if (!apply) return { data: { writes } };
        return {
          data: {
            writes,
            ...threadStore(data.freshThreadIds, data.showArchived, {
              list: [...data.lists.list],
              recent: update.value as Partial<ThreadEntity>[],
              archived: [...data.lists.archived],
            }),
          },
        };
      },
    }),
    chat: follow('threads', 'chat', {
      from: ['chatThreadId', 'chatLimit', 'viewRefresh'],
      args: ({ chatThreadId, chatLimit }) => (chatThreadId ? { threadId: chatThreadId, limit: chatLimit } : false),
      updated: (update, { data, send }) => {
        if (!update.ok) return;
        const threadId = data.chatThreadId;
        if (!threadId || threadId !== data.currentThread?.id) return;
        const chat = update.value as ChatPage | null;
        if (chat === null) {
          if (writing(data.writes)) return;
          return { data: dropThreadData(data, threadId, true, send) };
        }
        const { writes, apply } = viewRead(data.writes);
        if (!apply) return { data: { writes } };
        const { messageIds, hasMore, ...header } = chat;
        const nextCurrentThread: AgentThreadData = { ...data.currentThread, ...header };
        const nextChatIds = messageIds as string[];

        // The thread this window just opened takes its forced mode once, as it opens
        let modePatch: Partial<ThreadsData> = {};
        if (data.openedThreadId === threadId) {
          const forcedMode = header.forcedMode;
          if (!forcedMode) {
            modePatch = { openedThreadId: null };
          } else {
            const modeConfig = data.modes.find(m => m.name === forcedMode);
            const phase = modeConfig?.phases?.length
              ? (forcedMode in data.phaseByModeName ? data.phaseByModeName[forcedMode] : modeConfig.phases[0].name)
              : undefined;
            modePatch = { openedThreadId: null, mode: forcedMode, phase: phase ?? '' };
          }
        }

        // Seek focused message: if not yet in this page, schedule next page in a fresh step (or give up if no more)
        let seekPatch: Partial<ThreadsData> = {};
        const wanted = data.focusMessage;
        if (wanted && wanted.threadId === threadId && !nextChatIds.includes(wanted.messageId)) {
          if (hasMore) {
            const seq = data.timerSeq + 1;
            seekPatch = {
              timerSeq: seq,
              chatFollowups: { [`seek:${threadId}:${data.chatLimit}:${seq}`]: { event: { type: 'LOAD_MORE_MESSAGES' } } },
            };
          } else {
            seekPatch = { focusMessage: null };
          }
        }

        return {
          data: {
            writes,
            messagePagination: { hasMore, isLoading: false },
            chatStates: { ...data.chatStates, [threadId]: ((header.chatState as ChatState | undefined) ?? 'idle') },
            ...modePatch,
            ...syncMessages(data, nextChatIds, data.detailMessageIds, nextCurrentThread),
            ...seekPatch,
          },
        };
      },
    }),
    tabs: follow('threads', 'tab', {
      each: 'tabViewKeys',
      args: (key) => ({ threadId: threadIdFromTabKey(key) }),
      updated: (update, { key, data, send }) => {
        if (!update.ok) return;
        const threadId = threadIdFromTabKey(key);
        const tab = update.value as ThreadTabView | null;
        if (tab === null) {
          return { data: dropThreadData(data, threadId, false, send) };
        }
        if (!data.tabs.some(t => t.id === threadId)) return;
        const { writes, apply } = viewRead(data.writes);
        if (!apply) return { data: { writes } };
        const firstRead = !data.tabsRead.includes(threadId);
        const tabs = data.tabs.map((existing) => {
          if (existing.id !== threadId) return existing;
          const known = new Set(existing.artifacts.map(a => a.id));
          // An artifact added since the tab was last read is the one to show; otherwise what was selected stays
          const added = firstRead ? undefined : tab.artifacts.find(a => !known.has(a.id));
          const kept = tab.artifacts.some(a => a.id === existing.selectedArtifactId) ? existing.selectedArtifactId : tab.artifacts[0]?.id;
          return {
            ...existing,
            label: tab.topic || existing.label,
            artifacts: tab.artifacts as Tab['artifacts'],
            selectedArtifactId: added?.id ?? kept,
            pinned: tab.pinned ?? false,
          };
        });
        saveTabsToStorage(tabs, data.activeTabId);
        return {
          data: {
            writes,
            tabs,
            tabsRead: firstRead ? [...data.tabsRead, threadId] : [...data.tabsRead],
            ...(data.currentThread?.id === threadId
              ? { currentThread: { ...data.currentThread, artifacts: tab.artifacts as unknown as AgentThreadData['artifacts'] } }
              : {}),
          },
        };
      },
    }),
    messages: follow('threads', 'message', {
      each: 'messageViews',
      args: (messageId) => ({ id: messageId }),
      updated: (update, { key: messageId, data }) => {
        if (!update.ok) return;
        if (!data.messageViews.includes(messageId)) return;
        const message = update.value as MessageEntity | null;
        const { [messageId]: _gone, ...rest } = data.messageContents;
        // A durable write caught the row up to the run, so the run has nothing left to add.
        const run = data.messageStreams[messageId];
        const caughtUp = runCaughtUp(message?.text, run);
        const { [messageId]: _spliced, ...streams } = data.messageStreams;
        const blockRun = data.messageBlockStreams[messageId];
        const blockCaughtUp = blockRunCaughtUp(message?.blocks, blockRun);
        const { [messageId]: _splicedBlock, ...blockStreams } = data.messageBlockStreams;
        const messageContents = message ? { ...rest, [messageId]: message } : rest;
        const messageStreams = caughtUp || !message ? streams : data.messageStreams;
        const messageBlockStreams = blockCaughtUp || !message ? blockStreams : data.messageBlockStreams;
        return {
          data: {
            messageContents,
            messageStreams,
            messageBlockStreams,
            ...composedMessages(
              data.currentThread,
              data.view,
              data.chatMessageIds,
              data.detailMessageIds,
              messageContents,
              messageStreams,
              messageBlockStreams,
            ),
          },
        };
      },
    }),
    messageSearch: follow('threads', 'messageSearch', {
      from: ['searchQuery'],
      args: ({ searchQuery }) => (searchQuery ? { query: searchQuery } : false),
      updated: (update, { data }) => {
        if (!update.ok) {
          return { data: { messageSearch: { ...data.messageSearch, searching: false } } };
        }
        return {
          data: {
            messageSearch: {
              query: data.searchQuery,
              results: update.value as MessageSearchResult[],
              searching: false,
            },
          },
        };
      },
    }),
  }),
  calls: ({ one, each, many }) => ({
    chatStart: one('threads', 'GET_CHAT_START', {
      done: (outcome, { data, send }) => {
        if (!outcome.ok) return;
        const start: ChatStart = outcome.value;
        const extracted = extractChatSettings(start.settings?.chat || { modes: [], hotkeys: {} });
        const visibleModes = extracted.modes.filter(m => !m.hidden);
        const { mode, phase } = resolveDefaultModePhase(
          extracted.chatSettings,
          extracted.modes,
          visibleModes[0]?.name ?? data.mode,
          visibleModes[0]?.phases?.[0]?.name,
        );

        // The tabs this window kept in its storage, after the ones every window opens; a thread gone since closes its
        // tab when the tab's view says so
        const backendTabs: Tab[] = start.tabs.map(tab => ({ id: tab.id, label: tab.label, artifacts: [], ...(tab.pinned && { pinned: true }) }));
        const stored = loadTabsFromStorage();
        const tabs: Tab[] = [...backendTabs];
        for (const storedTab of stored?.tabs ?? []) {
          const backend = tabs.find(t => t.id === storedTab.id);
          if (backend) {
            if (storedTab.groupId && !backend.groupId) backend.groupId = storedTab.groupId;
          } else {
            tabs.push({ id: storedTab.id, label: storedTab.label || 'Thread', artifacts: [], ...(storedTab.groupId && { groupId: storedTab.groupId }) });
          }
        }
        const activeTabId = stored?.activeTabId && tabs.some(t => t.id === stored.activeTabId)
          ? stored.activeTabId
          : (start.currentThreadId ?? tabs[0]?.id ?? '');

        const threadToLoad = activeTabId || start.currentThreadId;
        if (threadToLoad) send({ type: 'OPEN_THREAD_CHAT', threadId: threadToLoad, restore: true });

        return {
          data: {
            ...applySettings(start.settings),
            ...syncTabs(tabs, activeTabId, data.tabsRead, data.viewRefresh),
            tabGroups: loadThreadTabGroups(),
            mode,
            phase: phase ?? '',
          },
        };
      },
    }),
    created: each('threads', 'CREATE_THREAD', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => {
        const settled = settleWrite(data, key, outcome);
        if (!outcome.ok) return { data: settled };
        const freshThreadIds = data.freshThreadIds.includes(outcome.value.id)
          ? [...data.freshThreadIds]
          : [...data.freshThreadIds, outcome.value.id];
        return {
          data: {
            ...settled,
            freshThreadIds,
            create: { ...defaultThread },
            ...threadStore(freshThreadIds, data.showArchived, {
              list: [...data.lists.list],
              recent: [...data.lists.recent],
              archived: [...data.lists.archived],
            }),
          },
        };
      },
    }),
    opened: many('threads', 'OPEN_THREAD_CHAT', {
      done: (outcome, { data, send }) => {
        if (!outcome.ok && outcome.failure.kind === 'not-found') {
          return { data: dropThreadData(data, outcome.failure.threadId, false, send) };
        }
      },
    }),
    sent: many('threads', 'USER_MSG', {
      done: (outcome, { data, send }) => {
        if (!outcome.ok) {
          return { data: { sendFailures: [...data.sendFailures, { message: outcome.failure.message }] } };
        }
        if (outcome.value.started) {
          send({ type: 'SHOW_THREAD', threadId: outcome.value.threadId });
        }
      },
    }),
    sentCommand: many('threads', 'USER_COMMAND', {
      done: (outcome, { data, send }) => {
        if (!outcome.ok) {
          return { data: { sendFailures: [...data.sendFailures, { message: outcome.failure.message }] } };
        }
        if (outcome.value.started) {
          send({ type: 'SHOW_THREAD', threadId: outcome.value.threadId });
        }
      },
    }),
    forked: many('threads', 'FORK_THREAD', {
      done: (outcome, { data, send }) => {
        if (!outcome.ok) {
          return { data: { sendFailures: [...data.sendFailures, { message: outcome.failure.message }] } };
        }
        send({ type: 'SHOW_THREAD', threadId: outcome.value.threadId });
      },
    }),
    imported: many('threads', 'IMPORT_THREADS', {
      done: (outcome) => ({
        data: {
          threadsImport: outcome.ok
            ? { status: 'success' as const, errors: outcome.value.errors || [], importedCount: outcome.value.count }
            : { status: 'error' as const, errors: outcome.failure.message.split('\n'), importedCount: 0 },
        },
      }),
    }),
    exported: many('threads', 'EXPORT_THREADS', {
      done: (outcome) => ({
        data: {
          threadsExport: outcome.ok
            ? { status: 'success' as const, errors: [], filePath: outcome.value.filePath, threadCount: outcome.value.threadCount }
            : { status: 'error' as const, errors: [outcome.failure.message], filePath: '', threadCount: 0 },
        },
      }),
    }),
    statusWrite: each('threads', 'UPDATE_THREAD_STATUS', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWrite(data, key, outcome) }),
    }),
    fieldWrite: each('threads', 'UPDATE_THREAD_FIELD', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWrite(data, key, outcome) }),
    }),
    deleteWrite: each('threads', 'DELETE_THREAD', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWrite(data, key, outcome) }),
    }),
    parentWrite: each('threads', 'SET_THREAD_PARENT', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWrite(data, key, outcome) }),
    }),
  }),
  on: {
    OPEN_ENTITY: (event, { data, tell }) => {
      if (!entityIs<Contract['opens']>({ event }, { entity: 'Thread' })) return;
      tell('threads', { type: 'VIEW_THREAD', threadId: event.id });
      return {
        at: 'view',
        data: {
          ...selectedThreadData(data, event.id),
          detailThreadId: event.id,
          navHistory: pushNavHistory(data.navHistory, `view:${event.id}`),
        },
      };
    },
    SURFACE_STARTED: (_event, { call }) => {
      call('chatStart');
      return { data: { started: true } };
    },
    MESSAGE_TEXT_APPENDED: (ev, { data }) => {
      const { [ev.messageId]: held, ...others } = data.messageStreams;
      // `done` is taken whether or not this window is still following the message, so a finalized text is never
      // spliced over by an abandoned partial reply.
      if (ev.done) {
        if (!held) return;
        const completed = finishedRun(held, ev);
        const finished = completed ? { ...others, [ev.messageId]: completed } : others;
        return {
          data: {
            messageStreams: finished,
            ...composedMessages(
              data.currentThread,
              data.view,
              data.chatMessageIds,
              data.detailMessageIds,
              data.messageContents,
              finished,
              data.messageBlockStreams,
            ),
          },
        };
      }
      if (!data.messageViews.includes(ev.messageId)) return;
      const continues = held !== undefined && held.at + held.text.length === ev.at;
      const run = continues ? { at: held.at, text: held.text + ev.text } : { at: ev.at, text: ev.text };
      const messageStreams = { ...others, [ev.messageId]: run };
      return {
        data: {
          messageStreams,
          ...composedMessages(
            data.currentThread,
            data.view,
            data.chatMessageIds,
            data.detailMessageIds,
            data.messageContents,
            messageStreams,
            data.messageBlockStreams,
          ),
        },
      };
    },
    MESSAGE_BLOCK_TEXT_APPENDED: (ev, { data }) => {
      const { [ev.messageId]: held, ...others } = data.messageBlockStreams;
      if (ev.done) {
        if (!held) return;
        return {
          data: {
            messageBlockStreams: others,
            ...composedMessages(
              data.currentThread,
              data.view,
              data.chatMessageIds,
              data.detailMessageIds,
              data.messageContents,
              data.messageStreams,
              others,
            ),
          },
        };
      }
      if (!data.messageViews.includes(ev.messageId)) return;
      const continues = held !== undefined && held.blockId === ev.blockId && held.at + held.text.length === ev.at;
      const run = continues
        ? { blockId: ev.blockId, at: held.at, text: held.text + ev.text }
        : { blockId: ev.blockId, at: ev.at, text: ev.text };
      const messageBlockStreams = { ...others, [ev.messageId]: run };
      return {
        data: {
          messageBlockStreams,
          ...composedMessages(
            data.currentThread,
            data.view,
            data.chatMessageIds,
            data.detailMessageIds,
            data.messageContents,
            data.messageStreams,
            messageBlockStreams,
          ),
        },
      };
    },
    'CHAT.FAILURES_TOLD': (event, { data }) => ({
      data: { sendFailures: data.sendFailures.filter(failure => !event.told.includes(failure)) },
    }),
    SHOW_THREAD: (event, { data, call }) => openThreadTransition(data, event.threadId, event.restore, false, call),
    OPEN_THREAD_CHAT: (event, { data, call }) => openThreadTransition(data, event.threadId, event.restore, true, call),
    // Thread management events
    SHOW_CREATE_FORM: (_event, { data }) => ({
      at: 'create',
      data: {
        ...leaveDetailData(data),
        create: { ...defaultThread },
        navHistory: pushNavHistory(data.navHistory, 'create'),
      },
    }),
    SHOW_CREATE_FORM_AS_CHILD: (event, { data }) => {
      const parentThread = data.threadMap[event.parentThreadId];
      if (!parentThread) {
        console.warn(`Parent thread with id ${event.parentThreadId} not found`);
        return {
          at: 'create',
          data: leaveDetailData(data),
        };
      }
      return {
        at: 'create',
        data: {
          ...leaveDetailData(data),
          create: {
            ...defaultThread,
            parentThreadId: parentThread.id,
            parentThread: { ...parentThread },
          },
        },
      };
    },
    UPDATE_THREAD_STATUS: (event, { data, call }) => {
      const write = freshKey();
      call('statusWrite', write, { threadId: event.id, status: event.status });
      return { data: { writes: writeSent(data.writes, write) } };
    },
    VIEW_LIST: (_event, { data }) => ({
      at: 'list',
      data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'list') },
    }),
    VIEW_KANBAN: (_event, { data }) => ({
      at: 'kanban',
      data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'kanban') },
    }),
    VIEW_DASHBOARD: (_event, { data }) => ({
      at: 'dashboard',
      data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'dashboard') },
    }),
    CLEAR_NEW_THREAD_FLAG: (event, { data }) => ({
      data: {
        ...patchThread(data, event.id, { isNew: false }),
        freshThreadIds: data.freshThreadIds.filter(fresh => fresh !== event.id),
      },
    }),
    RENAME_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('fieldWrite', write, { threadId: event.threadId, key: 'topic', value: event.topic });
      return { data: optimisticFieldUpdate(data, write, event.threadId, 'topic', event.topic) };
    },
    FEATURE_SETTINGS_UPDATED: (event) => ({
      data: applySettings(event.settings),
    }),
    DELETE_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('deleteWrite', write, { threadId: event.threadId });
      return { data: { writes: writeSent(data.writes, write) } };
    },
    TOGGLE_VIEW_ARCHIVE: (_event, { data }) => {
      const showArchived = !data.showArchived;
      return {
        at: 'list',
        data: {
          ...leaveDetailData(data),
          showArchived,
          ...threadStore(data.freshThreadIds, showArchived, {
            list: [...data.lists.list],
            recent: [...data.lists.recent],
            archived: [...data.lists.archived],
          }),
        },
      };
    },
    ARCHIVE_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('fieldWrite', write, { threadId: event.threadId, key: 'archived', value: true });
      const tabs = data.tabs.filter(t => t.id !== event.threadId);
      const activeTabId = data.activeTabId === event.threadId
        ? (tabs[tabs.length - 1]?.id ?? '')
        : data.activeTabId;
      const tabGroups = cleanupAndPersistGroups(tabs, data.tabGroups);
      return {
        data: {
          writes: writeSent(data.writes, write),
          ...removeThread(data, event.threadId),
          ...syncTabs(tabs, activeTabId, data.tabsRead, data.viewRefresh),
          tabGroups,
        },
      };
    },
    UNARCHIVE_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('fieldWrite', write, { threadId: event.threadId, key: 'archived', value: false });
      return {
        data: {
          writes: writeSent(data.writes, write),
          ...removeThread(data, event.threadId),
        },
      };
    },
    UNPIN_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('fieldWrite', write, { threadId: event.threadId, key: 'pinned', value: false });
      return { data: optimisticFieldUpdate(data, write, event.threadId, 'pinned', false) };
    },
    PIN_THREAD: (event, { data, call }) => {
      const write = freshKey();
      call('fieldWrite', write, { threadId: event.threadId, key: 'pinned', value: true });
      return { data: optimisticFieldUpdate(data, write, event.threadId, 'pinned', true) };
    },
    // Import/Export events
    'THREADS.IMPORT': (event, { data, call }) => {
      call('imported', { directory: event.directory });
      return { data: { threadsImport: { ...data.threadsImport, status: 'importing' } } };
    },
    'THREADS.RESET_IMPORT_STATUS': () => ({
      data: { threadsImport: { status: 'idle', errors: [], importedCount: 0 } },
    }),
    'THREADS.EXPORT': (event, { data, call }) => {
      call('exported', { directory: event.directory });
      return { data: { threadsExport: { ...data.threadsExport, status: 'exporting' } } };
    },
    'THREADS.RESET_EXPORT_STATUS': () => ({
      data: { threadsExport: { status: 'idle', errors: [], filePath: '', threadCount: 0 } },
    }),
    // Filter events
    TOGGLE_FILTER_STATUS: (event, { data }) => {
      const current = data.filters.statuses;
      return {
        data: {
          filters: {
            ...data.filters,
            statuses: current.includes(event.status) ? current.filter(s => s !== event.status) : [...current, event.status],
          },
        },
      };
    },
    TOGGLE_FILTER_TAG: (event, { data }) => {
      const current = data.filters.tags;
      return {
        data: {
          filters: {
            ...data.filters,
            tags: current.includes(event.tag) ? current.filter(t => t !== event.tag) : [...current, event.tag],
          },
        },
      };
    },
    TOGGLE_FILTER_CHAT_STATE: (event, { data }) => {
      const current = data.filters.chatStates;
      return {
        data: {
          filters: {
            ...data.filters,
            chatStates: current.includes(event.chatState) ? current.filter(s => s !== event.chatState) : [...current, event.chatState],
          },
        },
      };
    },
    SET_SEARCH: (event, { data }) => ({
      data: { filters: { ...data.filters, search: event.keyword } },
    }),
    CLEAR_FILTERS: (_event, { data }) => ({
      data: { filters: { statuses: [], tags: [], chatStates: [], search: '', showRootOnly: data.filters.showRootOnly } },
    }),
    TOGGLE_ROOT_ONLY_FILTER: (_event, { data }) => ({
      data: { filters: { ...data.filters, showRootOnly: !data.filters.showRootOnly } },
    }),
    SELECT_THREAD_ITEMS: (event) => ({
      data: { selectedThreadIds: event.itemIds },
    }),
    SET_THREAD_PARENT: (event, { data, call }) => {
      const write = freshKey();
      call('parentWrite', write, { childIds: event.childIds, parentId: event.parentId });
      return { data: { writes: writeSent(data.writes, write) } };
    },
    NAVIGATE_BACK: (_event, { data, tell }) => navigateHistory(data, 'back', tell),
    NAVIGATE_FORWARD: (_event, { data, tell }) => navigateHistory(data, 'forward', tell),
    TRAIL_CLICK: (event, { data }) => {
      if (event.target === 'list') {
        return { at: 'list', data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'list') } };
      }
      if (event.target === 'kanban') {
        return { at: 'kanban', data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'kanban') } };
      }
      if (event.target === 'create') {
        return { at: 'create', data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'create') } };
      }
      if (event.target === 'view') {
        return { at: 'view' };
      }
      if (event.target === 'dashboard') {
        return { at: 'dashboard', data: { ...leaveDetailData(data), navHistory: pushNavHistory(data.navHistory, 'dashboard') } };
      }
    },
    SELECT_THREAD: (event, { data, tell }) => {
      tell('threads', { type: 'VIEW_THREAD', threadId: event.id });
      return {
        at: 'view',
        data: {
          ...selectedThreadData(data, event.id),
          detailThreadId: event.id,
          navHistory: pushNavHistory(data.navHistory, `view:${event.id}`),
        },
      };
    },
    // Chat/agent events (always active regardless of view state)
    HOTKEY_PRESSED: (event, { data, send }) => {
      const actionType = processHotkeys(event, data.hotkeys, {
        quickPrompts: 'TOGGLE_QUICK_PROMPTS',
        closeTab: 'CLOSE_ACTIVE_TAB',
      });
      if (actionType) send({ type: actionType });
    },
    OPEN_QUICK_PROMPTS: () => ({ data: { quickPromptCursor: { x: mouseX, y: mouseY } } }),
    CLOSE_QUICK_PROMPTS: () => ({ data: { quickPromptCursor: null } }),
    TOGGLE_QUICK_PROMPTS: (_event, { data }) => ({
      data: { quickPromptCursor: data.quickPromptCursor !== null ? null : { x: mouseX, y: mouseY } },
    }),
    VIEW_THREAD: (event, { send }) => {
      send({ type: 'SELECT_THREAD', id: event.threadId });
    },
    NAVIGATE_TO_SECRETS: () => {
      untypedOpenSurface(HOST_SETTINGS, [
        { type: 'TAB.SELECT', tab: 'general' },
        { type: 'GENERAL_NAV.SELECT', item: 'secrets' },
      ]);
    },
    RESPOND_TO_BLOCK_INTERACTION: (event, { data, tell }) => {
      if (!data.currentThread?.id) {
        console.error('Cannot respond to block interaction: no current thread');
        return;
      }
      tell('threads', {
        type: 'INTERACTIVE_MSG_RESPONSE',
        messageId: event.messageId,
        threadId: data.currentThread.id,
        response: event.response,
      });
    },
    LOAD_MORE_MESSAGES: (_event, { data }) => {
      const { hasMore, isLoading } = data.messagePagination;
      if (!data.currentThread?.id || !hasMore || isLoading) {
        return Object.keys(data.chatFollowups).length > 0 ? { data: { chatFollowups: {} } } : undefined;
      }
      return {
        data: {
          chatFollowups: {},
          chatLimit: data.chatLimit + MESSAGE_PAGE_SIZE,
          messagePagination: { hasMore, isLoading: true },
        },
      };
    },
    SEARCH_MESSAGES: (event) => {
      const query = event.query.trim();
      return {
        data: {
          searchQuery: query,
          messageSearch: { query, results: [], searching: query !== '' },
        },
      };
    },
    OPEN_MESSAGE: (event, { data, send }) => {
      send({ type: 'OPEN_THREAD_CHAT', threadId: event.threadId });
      const alreadyOpen = data.currentThread?.id === event.threadId;
      if (!alreadyOpen || data.messagePagination.isLoading || data.chatMessageIds.includes(event.messageId)) {
        return { data: { focusMessage: { threadId: event.threadId, messageId: event.messageId } } };
      }
      if (data.messagePagination.hasMore) {
        return {
          data: {
            focusMessage: { threadId: event.threadId, messageId: event.messageId },
            chatLimit: data.chatLimit + MESSAGE_PAGE_SIZE,
            messagePagination: { hasMore: true, isLoading: true },
          },
        };
      }
      return { data: { focusMessage: null } };
    },
    FOCUSED_MESSAGE_SHOWN: () => ({ data: { focusMessage: null } }),
    SEND_MESSAGE: (event, { data, call }) => {
      call('sent', {
        text: event.text,
        mode: data.mode,
        phase: data.phase,
        threadId: data.currentThread?.id,
        ...(event.references && { references: event.references }),
        ...(data.pendingThreadCwd && { cwdOverride: data.pendingThreadCwd }),
        ...(data.pendingForceDirectoryPicker && { forceDirectoryPicker: true }),
      });
      if (data.pendingThreadCwd || data.pendingForceDirectoryPicker) {
        return { data: { pendingThreadCwd: undefined, pendingForceDirectoryPicker: undefined } };
      }
    },
    SEND_COMMAND: (event, { data, call }) => {
      call('sentCommand', {
        command: event.command,
        text: event.text,
        mode: data.mode,
        phase: data.phase,
        threadId: data.currentThread?.id,
        ...(event.references && { references: event.references }),
        ...(data.pendingThreadCwd && { cwdOverride: data.pendingThreadCwd }),
      });
      if (data.pendingThreadCwd) {
        return { data: { pendingThreadCwd: undefined } };
      }
    },
    FLASH_CHAT_STATE: (event, { data, now }) => {
      const durationMs = event.durationMs ?? 3000;
      const expiresAt = now + durationMs;
      const nextSeq = data.timerSeq + 1;
      const timers = withoutOverrideTimer(data.overrideTimers, event.threadId);
      timers[`${event.threadId}:${nextSeq}`] = { threadId: event.threadId, durationMs };
      return {
        data: {
          chatStateOverrides: { ...data.chatStateOverrides, [event.threadId]: { id: event.stateId, expiresAt } },
          overrideTimers: timers,
          timerSeq: nextSeq,
        },
      };
    },
    CLEAR_CHAT_STATE_OVERRIDE: (event, { data }) => {
      const { [event.threadId]: _, ...rest } = data.chatStateOverrides;
      return {
        data: {
          chatStateOverrides: rest,
          overrideTimers: withoutOverrideTimer(data.overrideTimers, event.threadId),
        },
      };
    },
    SET_MODE: (event, { data }) => {
      const newMode = event.mode;
      const modeConfig = data.modes.find(m => m.name === newMode);
      const updatedPhaseByModeName = { ...data.phaseByModeName, [data.mode]: data.phase };
      const newPhase = modeConfig?.phases?.length
        ? (newMode in updatedPhaseByModeName ? updatedPhaseByModeName[newMode] : modeConfig.phases[0].name)
        : undefined;
      return { data: { mode: newMode, phase: newPhase ?? '', phaseByModeName: updatedPhaseByModeName } };
    },
    SET_PHASE: (event, { data }) => ({
      data: {
        phase: event.phase,
        phaseByModeName: { ...data.phaseByModeName, [data.mode]: event.phase },
      },
    }),
    CLEAR_THREAD: (_event, { data }) => {
      const { mode, phase } = resolveDefaultModePhase(data.chatSettings, data.modes, data.mode, data.phase);
      const nextThread = { ...defaultChatThread, messages: [] };
      return {
        data: {
          chatThreadId: null,
          chatFollowups: {},
          openedThreadId: null,
          mode,
          phase: phase ?? '',
          phaseByModeName: { ...data.phaseByModeName, [mode]: phase },
          pendingThreadCwd: undefined,
          pendingForceDirectoryPicker: undefined,
          ...syncMessages(data, [], data.detailMessageIds, nextThread),
        },
      };
    },
    NEW_THREAD_IN_PROJECT: (event, { data }) => {
      const { mode, phase } = resolveDefaultModePhase(data.chatSettings, data.modes, data.mode, data.phase);
      const nextThread = { ...defaultChatThread, messages: [] };
      return {
        data: {
          chatThreadId: null,
          chatFollowups: {},
          openedThreadId: null,
          mode,
          phase: phase ?? '',
          phaseByModeName: { ...data.phaseByModeName, [mode]: phase },
          pendingThreadCwd: event.directory,
          pendingForceDirectoryPicker: undefined,
          ...syncMessages(data, [], data.detailMessageIds, nextThread),
        },
      };
    },
    NEW_THREAD_NO_PROJECT: (_event, { data }) => {
      const { mode, phase } = resolveDefaultModePhase(data.chatSettings, data.modes, data.mode, data.phase);
      const nextThread = { ...defaultChatThread, messages: [] };
      return {
        data: {
          chatThreadId: null,
          chatFollowups: {},
          openedThreadId: null,
          mode,
          phase: phase ?? '',
          phaseByModeName: { ...data.phaseByModeName, [mode]: phase },
          pendingThreadCwd: undefined,
          pendingForceDirectoryPicker: true,
          ...syncMessages(data, [], data.detailMessageIds, nextThread),
        },
      };
    },
    CREATE_CHILD_THREAD: (event, { send }) => {
      send({ type: 'SHOW_CREATE_FORM_AS_CHILD', parentThreadId: event.parentThreadId });
    },
    FORK_THREAD: (event, { call }) => {
      call('forked', { messageId: event.messageId, threadId: event.threadId, threadTopic: event.threadTopic });
    },
    REVERT_THREAD: (event, { tell }) => {
      tell('threads', {
        type: 'REVERT_THREAD',
        messageId: event.messageId,
        threadId: event.threadId,
        ...(event.restoreFiles !== undefined && { restoreFiles: event.restoreFiles }),
        ...(event.userCliUuid !== undefined && { userCliUuid: event.userCliUuid }),
      });
    },
    SUMMARIZE_THREAD: (event, { tell }) => {
      tell('threads', { type: 'SUMMARIZE_THREAD', messageId: event.messageId, threadId: event.threadId });
    },
    PAUSE_TURN: (event, { tell }) => {
      tell('threads', { type: 'PAUSE_TURN', threadId: event.threadId });
    },
    UNQUEUE_MESSAGE: (event, { tell }) => {
      tell('threads', {
        type: 'FORWARD_BRAIN_EVENT',
        eventType: 'user.thread.unqueue',
        payload: { threadId: event.threadId, messageId: event.messageId },
      });
    },
    DISMISS_MESSAGE: (event, { data, tell }) => {
      tell('threads', { type: 'DELETE_MESSAGE', messageId: event.messageId });
      const nextChatIds = data.chatMessageIds.filter(listed => listed !== event.messageId);
      return { data: syncMessages(data, nextChatIds, data.detailMessageIds) };
    },
    SELECT_TAB: (event, { data }) => {
      saveTabsToStorage(data.tabs, event.tabId);
      return { data: { activeTabId: event.tabId } };
    },
    CLOSE_TAB: (event, { data, send }) => {
      const tab = data.tabs.find(t => t.id === event.tabId);
      if (!tab || tab.pinned) return;
      const idx = data.tabs.findIndex(t => t.id === event.tabId);
      const newTabs = data.tabs.filter(t => t.id !== event.tabId);
      let newActiveTabId = data.activeTabId;
      if (data.activeTabId === event.tabId) {
        const nextTab = data.tabs[idx + 1] ?? data.tabs[idx - 1];
        newActiveTabId = nextTab?.id ?? '';
      }
      if (data.activeTabId === event.tabId && newActiveTabId) {
        send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId });
      }
      const tabGroups = cleanupAndPersistGroups(newTabs, data.tabGroups);
      return {
        data: {
          ...syncTabs(newTabs, newActiveTabId, data.tabsRead, data.viewRefresh),
          tabGroups,
        },
      };
    },
    CLOSE_ACTIVE_TAB: (_event, { data, send }) => {
      const tabId = data.activeTabId;
      if (!tabId) return;
      const tab = data.tabs.find(t => t.id === tabId);
      if (!tab || tab.pinned) return;
      const idx = data.tabs.findIndex(t => t.id === tabId);
      const newTabs = data.tabs.filter(t => t.id !== tabId);
      const nextTab = data.tabs[idx + 1] ?? data.tabs[idx - 1];
      const newActiveTabId = nextTab?.id ?? '';
      if (newActiveTabId) {
        send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId });
      }
      const tabGroups = cleanupAndPersistGroups(newTabs, data.tabGroups);
      return {
        data: {
          ...syncTabs(newTabs, newActiveTabId, data.tabsRead, data.viewRefresh),
          tabGroups,
        },
      };
    },
    // Tab reorder & group events
    REORDER_TABS: (event, { data }) => {
      const tabs = [...data.tabs];
      const [moved] = tabs.splice(event.fromIndex, 1);
      tabs.splice(event.toIndex, 0, moved);
      saveTabsToStorage(tabs, data.activeTabId);
      return { data: { tabs } };
    },
    PIN_TAB_AT: (event, { data }) => {
      const tabs = data.tabs.map(t => t.id === event.tabId ? { ...t, pinned: true, groupId: undefined } : t);
      const sourceIdx = tabs.findIndex(t => t.id === event.tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === event.targetTabId);
      const insertIdx = event.side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      saveTabsToStorage(tabs, data.activeTabId);
      return { data: { tabs } };
    },
    UNPIN_TAB_AT: (event, { data }) => {
      const tabs = data.tabs.map(t => t.id === event.tabId ? { ...t, pinned: false, groupId: undefined } : t);
      const sourceIdx = tabs.findIndex(t => t.id === event.tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === event.targetTabId);
      const insertIdx = event.side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      saveTabsToStorage(tabs, data.activeTabId);
      return { data: { tabs } };
    },
    CREATE_TAB_GROUP: (event, { data }) => {
      const firstTab = event.tabIds?.[0] ? data.tabs.find(t => t.id === event.tabIds![0]) : undefined;
      const isPinned = firstTab?.pinned || false;
      const color = getNextAvailableColor(data.tabGroups, isPinned);
      const newGroup: ThreadTabGroup = {
        id: crypto.randomUUID(),
        name: 'New Group',
        color,
        isCollapsed: false,
        order: data.tabGroups.length,
        isPinned: isPinned || undefined,
      };
      const tabs = event.tabIds
        ? data.tabs.map(t => event.tabIds!.includes(t.id) ? { ...t, groupId: newGroup.id } : t)
        : [...data.tabs];
      const tabGroups = [...data.tabGroups, newGroup];
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups, tabs } };
    },
    RENAME_TAB_GROUP: (event, { data }) => {
      const tabGroups = data.tabGroups.map(g => g.id === event.groupId ? { ...g, name: event.name } : g);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups } };
    },
    CHANGE_TAB_GROUP_COLOR: (event, { data }) => {
      const tabGroups = data.tabGroups.map(g => g.id === event.groupId ? { ...g, color: event.color } : g);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups } };
    },
    DELETE_TAB_GROUP: (event, { data }) => {
      const tabGroups = data.tabGroups.filter(g => g.id !== event.groupId);
      const tabs = data.tabs.map(t => t.groupId === event.groupId ? { ...t, groupId: undefined } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups, tabs } };
    },
    TOGGLE_TAB_GROUP_COLLAPSE: (event, { data }) => {
      const tabGroups = data.tabGroups.map(g => g.id === event.groupId ? { ...g, isCollapsed: !g.isCollapsed } : g);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups } };
    },
    ADD_TAB_TO_GROUP: (event, { data }) => {
      const group = data.tabGroups.find(g => g.id === event.groupId);
      if (!group) return;
      const tabs = data.tabs.map(t => t.id === event.tabId ? { ...t, groupId: event.groupId, pinned: group.isPinned || false } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups([...data.tabGroups]);
      return { data: { tabs } };
    },
    ADD_TAB_TO_GROUP_AT: (event, { data }) => {
      const group = data.tabGroups.find(g => g.id === event.groupId);
      if (!group) return;
      const tabs = data.tabs.map(t => t.id === event.tabId ? { ...t, groupId: event.groupId, pinned: group.isPinned || false } : t);
      const sourceIdx = tabs.findIndex(t => t.id === event.tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === event.targetTabId);
      const insertIdx = event.side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups([...data.tabGroups]);
      return { data: { tabs } };
    },
    REMOVE_TAB_FROM_GROUP: (event, { data }) => {
      const tabs = data.tabs.map(t => t.id === event.tabId ? { ...t, groupId: undefined } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      return { data: { tabs } };
    },
    UNGROUP_ALL_IN_GROUP: (event, { data }) => {
      const tabGroups = data.tabGroups.filter(g => g.id !== event.groupId);
      const tabs = data.tabs.map(t => t.groupId === event.groupId ? { ...t, groupId: undefined } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups, tabs } };
    },
    CLOSE_ALL_IN_GROUP: (event, { data, send }) => {
      const tabsInGroup = data.tabs.filter(t => t.groupId === event.groupId);
      const remainingTabs = data.tabs.filter(t => t.groupId !== event.groupId);
      const needNewActive = tabsInGroup.some(t => t.id === data.activeTabId);
      const newActiveTabId = needNewActive
        ? (remainingTabs[remainingTabs.length - 1]?.id ?? '')
        : data.activeTabId;
      const tabGroups = data.tabGroups.filter(g => g.id !== event.groupId);
      if (needNewActive && newActiveTabId) {
        send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId });
      }
      saveThreadTabGroups(tabGroups);
      return {
        data: {
          ...syncTabs(remainingTabs, newActiveTabId, data.tabsRead, data.viewRefresh),
          tabGroups,
        },
      };
    },
    PIN_TAB_GROUP: (event, { data }) => {
      const tabGroups = data.tabGroups.map(g => g.id === event.groupId ? { ...g, isPinned: true } : g);
      const tabs = data.tabs.map(t => t.groupId === event.groupId ? { ...t, pinned: true } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups, tabs } };
    },
    UNPIN_TAB_GROUP: (event, { data }) => {
      const tabGroups = data.tabGroups.map(g => g.id === event.groupId ? { ...g, isPinned: undefined } : g);
      const tabs = data.tabs.map(t => t.groupId === event.groupId ? { ...t, pinned: false } : t);
      saveTabsToStorage(tabs, data.activeTabId);
      saveThreadTabGroups(tabGroups);
      return { data: { tabGroups, tabs } };
    },
    SELECT_ARTIFACT: (event, { data }) => ({
      data: {
        tabs: data.tabs.map(tab =>
          tab.id === data.activeTabId ? { ...tab, selectedArtifactId: event.artifactId } : tab,
        ),
      },
    }),
  },
  states: {
    dashboard: {
      run: () => { persistDashboardView(); },
    },
    list: {
      run: () => { persistListView(); },
    },
    kanban: {
      run: () => { persistKanbanView(); },
    },
    create: {
      on: {
        CREATE_THREAD: (_event, { data, call }) => {
          const { parentThread: _parentThread, ...createData } = data.create;
          const write = freshKey();
          call('created', write, {
            ...createData,
            parentThreadId: data.create.parentThreadId,
          });
          return { at: 'list', data: { writes: writeSent(data.writes, write) } };
        },
        CANCEL_CREATE: () => ({ at: 'list' }),
        UPDATE_THREAD_FIELD: (event, { data }) => ({
          data: {
            [event.state]: {
              ...data[event.state],
              [event.key]: event.value,
            },
          },
        }),
        TOGGLE_TAGS_SECTION: (event, { data }) => ({
          data: { create: { ...data.create, tagsExpanded: event.show } },
        }),
        TOGGLE_LINKED_SECTION: (event, { data }) => ({
          data: { create: { ...data.create, linkedExpanded: event.show } },
        }),
      },
    },
    view: {
      follows: (follow) => ({
        detail: follow('threads', 'detail', {
          from: ['detailThreadId', 'viewRefresh'],
          args: ({ detailThreadId }) => (detailThreadId ? { id: detailThreadId } : false),
          updated: (update, { data }) => {
            if (!update.ok) return;
            const threadId = data.detailThreadId;
            if (!threadId || threadId !== data.view.id) return;
            const detail = update.value as ThreadDetailView | null;
            if (detail === null) {
              if (writing(data.writes)) return;
              const emptyView = { ...defaultThread, id: '' as EARS.EntityId, shortCode: '', status: '', timestamp: 0 } as ThreadViewData;
              return {
                at: 'list',
                data: {
                  detailThreadId: null,
                  selectedThreadCode: undefined,
                  ...syncMessages(data, data.chatMessageIds, [], data.currentThread, emptyView),
                },
              };
            }
            const { writes, apply } = viewRead(data.writes);
            if (!apply) return { data: { writes } };
            const { messageIds, ...fields } = detail;
            const nextView = { ...data.view, ...fields, id: detail.id } as ThreadViewData;
            return {
              data: {
                writes,
                ...syncMessages(data, data.chatMessageIds, messageIds as string[], data.currentThread, nextView),
              },
            };
          },
        }),
      }),
      on: {
        UPDATE_THREAD_FIELD: (event, { data, call }) => {
          const { key, value, state: slice } = event;
          const write = freshKey();
          call('fieldWrite', write, {
            threadId: data.view.id,
            key,
            value,
          });
          const { messages: _messages, linkedThreads: _linkedThreads, ...rest } = data.view;
          const updatedViewSlice = { ...data[slice], [key]: value };
          const updatedThreadFields = { ...rest, [key]: value } as ThreadListItem;
          return {
            data: {
              [slice]: updatedViewSlice,
              threadMap: {
                ...data.threadMap,
                [data.view.id]: { ...data.threadMap[data.view.id], ...updatedThreadFields },
              },
              ...(data.currentThread && data.currentThread.id === data.view.id
                ? { currentThread: { ...data.currentThread, [key]: value } }
                : {}),
              writes: writeSent(data.writes, write),
              ...(key === 'linkedThreads' ? { linkSave: write, linkRefusal: null } : {}),
            },
          };
        },
      },
    },
  },
});

export default threadsState;
