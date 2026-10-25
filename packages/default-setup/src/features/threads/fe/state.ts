import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('threads'))
import { entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe';
import { targetIs, type TrailClickEvent } from '@apackdev/sdk/fe';
import { safeEvents } from '@apackdev/sdk/fe';
import { setup, assign, enqueueActions, fromCallback, spawnChild, stopChild, type AnyEventObject } from 'xstate';
import { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward } from '@apackdev/sdk/fe';
import type { ActorRefFrom } from 'xstate';
import type { ThreadEntity, ThreadCreateData, ThreadViewData, ThreadEditFields, ThreadsSettings, MessageEntity, AgentThreadData, Tab, AgentSettings, AgentMode as AgentModeConfig, MessageReferences, BlockResponse, ChatPage, ChatStart, ThreadDetailView, ThreadExtended, ThreadTabView } from '#generated/types.ts';
import { viewRead, viewWrites, writeAnswered, writeSent, writing, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe';
import { fromView } from '#generated/fe.ts';
import type { Contract, ChatState, ThreadListItem, ThreadsContext } from './contract.ts';
import type { OutgoingThreadsEvents } from '#features/threads/be/types.ts';
import { sendToSystem } from '#generated/events.ts';
import { Archive, Copy, Pin, Trash2 } from 'lucide-vue-next';
import { contextMenuFn } from '@apackdev/sdk/fe';
import { untypedOpenSurface } from '@apackdev/sdk/fe'
import { resolveName } from '@apackdev/sdk/ids'

const HOST_SETTINGS = resolveName('settings', 'host');
import { type HotkeyEvent, type HotkeysMap, createHotkeyProcessor } from '@apackdev/sdk/fe';
import type { ThreadTabGroup, TabGroupColor } from '#features/threads/fe/canvas/agent/tabs/types.ts';
import { getNextAvailableColor } from '#features/threads/fe/canvas/agent/tabs/types.ts';
import { saveThreadTabGroups, loadThreadTabGroups } from '#features/threads/fe/canvas/agent/tabs/tab-groups.ts';
import type { EARS } from '@apackdev/sdk';

export const id = 'threads' as const;

// The threads surface over its views. It is drawn in several places — the list, the board, a thread's page and the
// dashboard as canvas routes, and the chat beside every surface — so no one component holds its views: the machine
// follows each as a child actor (`fromView`), spawned with its arguments and replaced when they change. The list, the
// recent threads and the archived ones are three views from which the thread map is derived; the open thread's chat,
// its detail page and each open tab are one view each; and each message either lists is its own view, so a reply
// streaming into one message re-runs that message's view alone. This window's thread writes hold the thread-level
// views back until each is answered (`ViewWrites`), so a result from before an edit never undoes it on screen.
//
// What it starts from — the thread to open, the tabs every window opens, the settings — is asked for when the shell
// starts the surface (`SURFACE_STARTED`), in a delivery naming it, which is what lets the system answer.

/** How many messages a page of the chat holds, and how many more each `LOAD_MORE_MESSAGES` asks for */
const MESSAGE_PAGE_SIZE = 50;

// Module-level mouse position tracker (read when hotkey fires)
let mouseX = 0;
let mouseY = 0;
window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });


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

function saveTabsToStorage(tabs: Tab[], activeTabId: string) {
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
  modes: AgentModeConfig[],
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

export type ThreadsState = ActorRefFrom<typeof threadsState>;

const defaultThread: ThreadCreateData | ThreadViewData = {
  topic: '',
  instructions: '',
  tags: [],
  linkedThreads: [],
}

const defaultChatThread: AgentThreadData = {
  id: undefined,
  topic: '',
  instructions: '',
  status: 'backlog',
  timestamp: Date.now(),
  messages: [],
  artifacts: [],
};

// ---- Event types ----

type SystemEvent =
  | OutgoingThreadsEvents
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: ThreadsSettings }
  | SurfaceLifecycleEvent

/** What the views this surface follows hand it: each one's result, or that it failed (kept showing what it showed) */
type ViewEvent =
  | { type: 'THREADS.READ'; threads: ThreadExtended[] }
  | { type: 'ARCHIVED.READ'; threads: Partial<ThreadEntity>[] }
  | { type: 'RECENT.READ'; threads: Partial<ThreadEntity>[] }
  | { type: 'DETAIL.READ'; id: string; detail: ThreadDetailView | null }
  | { type: 'CHAT.READ'; threadId: string; chat: ChatPage | null }
  | { type: 'MESSAGE.READ'; id: string; message: MessageEntity | null }
  | { type: 'TAB.READ'; threadId: string; tab: ThreadTabView | null }
  | { type: 'VIEW.FAILED'; view: string; error: string }

type UIEvent =
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
  | { type: 'HOTKEY_PRESSED'; } & HotkeyEvent
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
  | { type: 'NAVIGATE_FORWARD' }

type ThreadEvents =
  | OpenEntity
  | UIEvent
  | SystemEvent
  | ViewEvent
  | TrailClickEvent;

const typeOf = safeEvents<ThreadEvents>();

export type { ChatState, ThreadListItem } from './contract.ts';

// ---- Context ----

// ---- Helpers ----

type ThreadLike = Partial<ThreadEntity> & { id: string };

export function threadsFromStore<T>(threadMap: Record<string, T>, threadIds: string[]): T[] {
  return threadIds.map(id => threadMap[id]).filter((thread): thread is T => Boolean(thread));
}

function threadIdsFrom(threads: ThreadLike[]): string[] {
  return threads.map(t => t.id);
}

function mergeThreadMap(threadMap: Record<string, ThreadListItem>, threads: ThreadLike[]): Record<string, ThreadListItem> {
  const next = { ...threadMap };
  for (const thread of threads) {
    next[thread.id] = { ...next[thread.id], ...thread } as ThreadListItem;
  }
  return next;
}

/** Update a single thread in the map (no-op if not found) */
function patchThread(ctx: ThreadsContext, threadId: string, patch: Partial<ThreadListItem>) {
  const existing = ctx.threadMap[threadId];
  if (!existing) return { threadMap: ctx.threadMap };
  return { threadMap: { ...ctx.threadMap, [threadId]: { ...existing, ...patch } } };
}

/** Remove a thread from the map and id list */
function removeThread(ctx: ThreadsContext, threadId: string) {
  const { [threadId]: _, ...rest } = ctx.threadMap;
  return { threadMap: rest, threadIds: ctx.threadIds.filter(id => id !== threadId) };
}

function optimisticFieldUpdate(context: ThreadsContext, threadId: string, key: string, value: unknown) {
  const call = sendToSystem(id, { type: 'UPDATE_THREAD_FIELD', threadId, key, value });
  return {
    writes: writeSent(context.writes, call),
    ...patchThread(context, threadId, { [key]: value } as any),
    tabs: context.tabs.map(t => t.id === threadId ? { ...t, [key]: value, ...(key === 'topic' ? { label: value as string } : {}) } : t),
    ...(context.currentThread?.id === threadId ? { currentThread: { ...context.currentThread, [key]: value } } : {}),
    ...(context.view.id === threadId ? { view: { ...context.view, [key]: value } } : {}),
  };
}

/**
 * The thread map and the lists the surface shows, derived from what the list, recent and archived views last gave:
 * a thread deleted anywhere leaves all three, and so the map
 */
function threadStore(ctx: ThreadsContext, lists: ThreadsContext['lists']): Partial<ThreadsContext> {
  const threadMap = mergeThreadMap({}, [...lists.archived, ...lists.recent, ...lists.list] as ThreadLike[]);
  for (const fresh of ctx.freshThreadIds) {
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
    threadIds: threadIdsFrom((ctx.showArchived ? lists.archived : lists.list) as ThreadLike[]),
    recentThreadIds: threadIdsFrom(lists.recent as ThreadLike[]),
    sidebarArchivedThreads: lists.archived as ThreadListItem[],
  };
}

/** The messages `ids` name, as their views last gave them */
function messagesOf(ctx: ThreadsContext, ids: string[]): Partial<MessageEntity>[] {
  return ids.flatMap((messageId) => (ctx.messageContents[messageId] ? [ctx.messageContents[messageId]] : []));
}

/** The chat's and the detail page's messages, composed again from their ids and each message's view */
function composedMessages(ctx: ThreadsContext): Partial<ThreadsContext> {
  return {
    currentThread: ctx.currentThread ? { ...ctx.currentThread, messages: messagesOf(ctx, ctx.chatMessageIds) } : ctx.currentThread,
    view: { ...ctx.view, messages: messagesOf(ctx, ctx.detailMessageIds) },
  };
}

/** What the surface's views are spawned as: one id per view, and one per open tab and per listed message */
const viewChild = {
  list: 'view.list',
  archived: 'view.archived',
  recent: 'view.recent',
  detail: 'view.detail',
  chat: 'view.chat',
  tab: (threadId: string) => `view.tab:${threadId}`,
  message: (messageId: string) => `view.message:${messageId}`,
} as const;

/** The recent threads' limit and order, as the settings hold them */
function recentArgs(settings: ThreadsSettings | null) {
  const limit = settings?.recentThreadsLimit;
  const sortOrder = settings?.recentThreadsSortOrder;
  return {
    limit: typeof limit === 'number' && limit > 0 ? limit : 7,
    sortOrder: sortOrder === 'visited' || sortOrder === 'message' ? sortOrder : 'created' as const,
  };
}

/** A view's failure: it keeps showing what it showed, and the failure is reported to nothing but the console */
const failed = (view: string, error: string) => ({ type: 'VIEW.FAILED' as const, view, error });

// ---- State machine ----

/*
 * The timers below are callback actors, which never finish on their own: the handler of the event a timer sends
 * stops it, or it would stay among the surface's children for the session. Spawning one stops the thread's
 * earlier timer first, since a spawn under an id already taken replaces the entry without stopping the actor,
 * which would then fire early.
 */
const newThreadFlagTimer = (threadId: string) => `clear-new-thread-flag-${threadId}`;
const chatStateOverrideTimer = (threadId: string) => `clear-expired-override-${threadId}`;

const threadsState = setup({
  types: { context: {} as ThreadsContext, events: {} as ThreadEvents },
  actors: {
    clearNewThreadFlag: fromCallback<AnyEventObject, { id: string }>(({ input, sendBack }) => {
      const ANIMATION_DURATION = 1000;
      const timer = setTimeout(() => sendBack({ type: 'CLEAR_NEW_THREAD_FLAG', id: input.id }), ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }),
    clearExpiredOverride: fromCallback<AnyEventObject, { threadId: string; durationMs: number }>(({ input, sendBack }) => {
      const timer = setTimeout(() => sendBack({ type: 'CLEAR_CHAT_STATE_OVERRIDE', threadId: input.threadId }), input.durationMs);
      return () => clearTimeout(timer);
    }),
    listView: fromView('threads', 'list', (update) =>
      (update.ok ? { type: 'THREADS.READ' as const, threads: update.value } : failed('list', update.error))),
    archivedView: fromView('threads', 'archived', (update) =>
      (update.ok ? { type: 'ARCHIVED.READ' as const, threads: update.value } : failed('archived', update.error))),
    recentView: fromView('threads', 'recent', (update) =>
      (update.ok ? { type: 'RECENT.READ' as const, threads: update.value } : failed('recent', update.error))),
    detailView: fromView('threads', 'detail', (update, args) =>
      (update.ok ? { type: 'DETAIL.READ' as const, id: args.id, detail: update.value } : failed('detail', update.error))),
    chatView: fromView('threads', 'chat', (update, args) =>
      (update.ok ? { type: 'CHAT.READ' as const, threadId: args.threadId, chat: update.value } : failed('chat', update.error))),
    messageView: fromView('threads', 'message', (update, args) =>
      (update.ok ? { type: 'MESSAGE.READ' as const, id: args.id, message: update.value } : failed('message', update.error))),
    tabView: fromView('threads', 'tab', (update, args) =>
      (update.ok ? { type: 'TAB.READ' as const, threadId: args.threadId, tab: update.value } : failed('tab', update.error))),
  },
  actions: {
    // ---- Following the views ----
    /** Asks for what the chat starts from, and follows the list: the shell's start, in a delivery naming the surface */
    startSurface: enqueueActions(({ enqueue }) => {
      enqueue(() => sendToSystem(id, { type: 'GET_CHAT_START' }));
      enqueue('followList');
    }),
    followList: enqueueActions(({ enqueue }) => {
      enqueue.stopChild(viewChild.list);
      enqueue.spawnChild('listView', { id: viewChild.list });
    }),
    /** The archived and the recent threads, whose order and number the settings hold */
    followSettingsViews: enqueueActions(({ context, enqueue }) => {
      enqueue.stopChild(viewChild.archived);
      enqueue.stopChild(viewChild.recent);
      if (!context.settings) return;
      const args = recentArgs(context.settings);
      enqueue.spawnChild('archivedView', { id: viewChild.archived, input: { sortOrder: args.sortOrder } });
      enqueue.spawnChild('recentView', { id: viewChild.recent, input: args });
    }),
    followDetail: enqueueActions(({ context, enqueue }) => {
      enqueue.stopChild(viewChild.detail);
      if (context.view.id) enqueue.spawnChild('detailView', { id: viewChild.detail, input: { id: context.view.id } });
    }),
    stopDetail: enqueueActions(({ enqueue }) => {
      enqueue.stopChild(viewChild.detail);
      enqueue.assign({ detailMessageIds: [] });
      enqueue('followMessages');
    }),
    followChat: enqueueActions(({ context, enqueue }) => {
      enqueue.stopChild(viewChild.chat);
      const threadId = context.currentThread?.id;
      if (threadId) enqueue.spawnChild('chatView', { id: viewChild.chat, input: { threadId, limit: context.chatLimit } });
    }),
    /** A view per open tab: spawned as a tab opens, stopped as it closes */
    followTabs: enqueueActions(({ context, enqueue }) => {
      const open = context.tabs.map(tab => tab.id);
      for (const threadId of context.tabViews) {
        if (!open.includes(threadId)) enqueue.stopChild(viewChild.tab(threadId));
      }
      for (const threadId of open) {
        if (!context.tabViews.includes(threadId)) enqueue.spawnChild('tabView', { id: viewChild.tab(threadId), input: { threadId } });
      }
      enqueue.assign({ tabViews: open, tabsRead: context.tabsRead.filter(threadId => open.includes(threadId)) });
    }),
    /** A view per message the chat or the detail page lists, and nothing kept of a message neither lists any more */
    followMessages: enqueueActions(({ context, enqueue }) => {
      const listed = [...new Set([...context.chatMessageIds, ...context.detailMessageIds])];
      for (const messageId of context.messageViews) {
        if (!listed.includes(messageId)) enqueue.stopChild(viewChild.message(messageId));
      }
      for (const messageId of listed) {
        if (!context.messageViews.includes(messageId)) enqueue.spawnChild('messageView', { id: viewChild.message(messageId), input: { id: messageId } });
      }
      enqueue.assign({
        messageViews: listed,
        messageContents: Object.fromEntries(listed.flatMap(messageId => (context.messageContents[messageId] ? [[messageId, context.messageContents[messageId]]] : []))),
      });
    }),
    /**
     * Reads every thread-level view again, once this window's writes are answered and a result was held behind them
     * or one was refused: a fresh subscription's first result is computed after every answered write
     */
    refollowThreadViews: enqueueActions(({ context, enqueue }) => {
      enqueue('followList');
      enqueue('followSettingsViews');
      enqueue('followDetail');
      enqueue('followChat');
      for (const threadId of context.tabViews) {
        enqueue.stopChild(viewChild.tab(threadId));
        enqueue.spawnChild('tabView', { id: viewChild.tab(threadId), input: { threadId } });
      }
    }),
    /** An answer to one of this window's writes */
    settleWrite: enqueueActions(({ context, event, enqueue }) => {
      const writes = writeAnswered(context.writes, event as unknown as Record<string, unknown>, event.type === 'THREAD_WRITE_FAILED');
      enqueue.assign({ writes });
      if (writes.refreshes !== context.writes.refreshes) enqueue('refollowThreadViews');
    }),

    // ---- What the views gave ----
    readThreads: enqueueActions(({ context, event, enqueue }) => {
      const { threads } = typeOf('THREADS.READ', event);
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (apply) enqueue.assign(({ context }) => threadStore(context, { ...context.lists, list: threads }));
    }),
    readArchived: enqueueActions(({ context, event, enqueue }) => {
      const { threads } = typeOf('ARCHIVED.READ', event);
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (apply) enqueue.assign(({ context }) => threadStore(context, { ...context.lists, archived: threads }));
    }),
    readRecent: enqueueActions(({ context, event, enqueue }) => {
      const { threads } = typeOf('RECENT.READ', event);
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (apply) enqueue.assign(({ context }) => threadStore(context, { ...context.lists, recent: threads }));
    }),
    readDetail: enqueueActions(({ context, event, enqueue }) => {
      const { id: threadId, detail } = typeOf('DETAIL.READ', event);
      if (threadId !== context.view.id || !detail) return;
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (!apply) return;
      const { messageIds, ...fields } = detail;
      enqueue.assign(({ context }) => ({
        view: { ...context.view, ...fields, id: detail.id } as ThreadViewData,
        detailMessageIds: messageIds as string[],
      }));
      enqueue('followMessages');
      enqueue.assign(({ context }) => composedMessages(context));
    }),
    readChat: enqueueActions(({ context, event, enqueue }) => {
      const { threadId, chat } = typeOf('CHAT.READ', event);
      if (threadId !== context.currentThread?.id || !chat) return;
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (!apply) return;
      const { messageIds, hasMore, ...header } = chat;
      enqueue.assign(({ context }) => ({
        currentThread: { ...context.currentThread!, ...header },
        chatMessageIds: messageIds as string[],
        messagePagination: { hasMore, isLoading: false },
        chatStates: { ...context.chatStates, [threadId]: ((header.chatState as ChatState | undefined) ?? 'idle') },
      }));
      // The thread this window just opened takes its forced mode once, as it opens
      if (context.openedThreadId === threadId) {
        enqueue.assign(({ context }) => {
          const forcedMode = header.forcedMode;
          if (!forcedMode) return { openedThreadId: null };
          const modeConfig = context.modes.find(m => m.name === forcedMode);
          const phase = modeConfig?.phases?.length
            ? (forcedMode in context.phaseByModeName ? context.phaseByModeName[forcedMode] : modeConfig.phases[0].name)
            : undefined;
          return { openedThreadId: null, mode: forcedMode, phase: phase ?? '' };
        });
      }
      enqueue('followMessages');
      enqueue.assign(({ context }) => composedMessages(context));
    }),
    readMessage: assign(({ context, event }) => {
      const { id: messageId, message } = typeOf('MESSAGE.READ', event);
      if (!context.messageViews.includes(messageId)) return {};
      const { [messageId]: _gone, ...rest } = context.messageContents;
      const next = { ...context, messageContents: message ? { ...rest, [messageId]: message } : rest };
      return { messageContents: next.messageContents, ...composedMessages(next) };
    }),
    readTab: enqueueActions(({ context, event, enqueue }) => {
      const { threadId, tab } = typeOf('TAB.READ', event);
      if (!tab || !context.tabs.some(t => t.id === threadId)) return;
      const { writes, apply } = viewRead(context.writes);
      enqueue.assign({ writes });
      if (!apply) return;
      enqueue.assign(({ context }) => {
        const firstRead = !context.tabsRead.includes(threadId);
        const tabs = context.tabs.map((existing) => {
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
        return {
          tabs,
          tabsRead: firstRead ? [...context.tabsRead, threadId] : context.tabsRead,
          ...(context.currentThread?.id === threadId
            ? { currentThread: { ...context.currentThread, artifacts: tab.artifacts as unknown as AgentThreadData['artifacts'] } }
            : {}),
        };
      });
      enqueue('persistTabs');
    }),
    /**
     * A thread this window shows is gone — deleted here or elsewhere, or it could not be opened: its tab closes, the
     * chat leaves it, and the next tab opens in its place
     */
    dropThread: enqueueActions(({ context, event, enqueue, self }) => {
      const { threadId } = event as { type: string; threadId: string };
      const index = context.tabs.findIndex(t => t.id === threadId);
      const tabs = context.tabs.filter(t => t.id !== threadId);
      let activeTabId = context.activeTabId;
      if (context.activeTabId === threadId) {
        const nextTab = context.tabs[index + 1] ?? context.tabs[index - 1];
        activeTabId = nextTab && nextTab.id !== threadId ? nextTab.id : '';
      }
      enqueue.assign({ tabs, activeTabId });
      if (context.currentThread?.id === threadId) {
        enqueue.assign({ currentThread: { ...defaultChatThread, messages: [] }, chatMessageIds: [] });
        enqueue('followChat');
        enqueue('followMessages');
      }
      if (activeTabId && activeTabId !== context.activeTabId) {
        enqueue(() => self.send({ type: 'OPEN_THREAD_CHAT', threadId: activeTabId }));
      }
      enqueue('cleanupEmptyGroups');
      enqueue('tabsChanged');
      enqueue('persistTabGroups');
    }),
    /** The detail page's thread is gone, so the page closes */
    leaveGoneDetail: assign(() => ({
      view: { ...defaultThread, id: '' as EARS.EntityId, shortCode: '', status: '', timestamp: 0 } as ThreadViewData,
      selectedThreadCode: undefined,
    })),

    // ---- Thread management actions ----
    /**
     * Opens a thread in the chat: the thread this window asked to open (`OPEN_THREAD_CHAT`, which also tells the
     * system it was visited), or one the system says to show (`SHOW_THREAD`: the thread a first message started, a
     * fork, or a flow's). Its tab opens and becomes the active one, and its chat view follows it.
     */
    openThread: enqueueActions(({ context, event, enqueue, self }) => {
      const { threadId, restore } = typeOf(['OPEN_THREAD_CHAT', 'SHOW_THREAD'], event);
      enqueue(() => self.send({ type: 'VIEW_DASHBOARD' }));
      if (event.type === 'OPEN_THREAD_CHAT') {
        enqueue(() => sendToSystem(id, { type: 'OPEN_THREAD_CHAT', threadId, ...(restore && { restore }) }));
      }
      const known = context.threadMap[threadId];
      const label = known?.topic || context.tabs.find(t => t.id === threadId)?.label || `Thread ${known?.shortCode || ''}`.trim();
      if (!context.tabs.some(t => t.id === threadId)) {
        enqueue.assign({ tabs: [...context.tabs, { id: threadId, label, artifacts: [], ...(known?.pinned && { pinned: true }) }] });
      }
      enqueue.assign({ activeTabId: threadId });
      if (context.currentThread?.id !== threadId) {
        enqueue.assign({
          currentThread: { ...defaultChatThread, ...(known && { topic: known.topic, shortCode: known.shortCode, status: known.status }), id: threadId as EARS.EntityId, messages: [] },
          chatLimit: MESSAGE_PAGE_SIZE,
          chatMessageIds: [],
          messagePagination: { hasMore: false, isLoading: true },
          openedThreadId: threadId,
        });
        enqueue('followChat');
        enqueue('followMessages');
      }
      enqueue('tabsChanged');
    }),
    setupParentThread: assign(({ event, context }) => {
      const typedEvent = typeOf('SHOW_CREATE_FORM_AS_CHILD', event);
      const parentThread = context.threadMap[typedEvent.parentThreadId];

      if (!parentThread) {
        console.warn(`Parent thread with id ${typedEvent.parentThreadId} not found`);
        return {};
      }

      return {
        create: {
          ...defaultThread,
          parentThreadId: parentThread.id,
          parentThread: parentThread
        }
      };
    }),
    /** The thread this window created: marked new in the list, for its animation, and the form emptied */
    markCreated: assign(({ context, event }) => {
      const created = typeOf('THREAD_CREATED', event).id as string;
      const freshThreadIds = [...context.freshThreadIds, created];
      return { freshThreadIds, create: defaultThread, ...threadStore({ ...context, freshThreadIds }, context.lists) };
    }),
    sendCreateThread: assign(({ context }) => {
      const { parentThread: _parentThread, ...createData } = context.create;
      const call = sendToSystem(id, {
        type: 'CREATE_THREAD',
        ...createData,
        parentThreadId: context.create.parentThreadId,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    recordThreadNavigation: assign(({ context, event }) => ({
      navHistory: pushNavHistory(context.navHistory, `view:${typeOf(['SELECT_THREAD', 'OPEN_ENTITY'], event).id}`),
    })),
    sendViewThread: ({ event }) => {
      const threadId = typeOf(['SELECT_THREAD', 'OPEN_ENTITY'], event).id;
      sendToSystem(id, {
        type: 'VIEW_THREAD',
        threadId,
      });
    },
    setSelectedThread: assign(({ event, context }) => {
      const typedEvent = typeOf(['SELECT_THREAD', 'OPEN_ENTITY'], event);
      const selectedThread = context.threadMap[typedEvent.id];
      if (!selectedThread) {
        // Thread not in threadMap (e.g. archived, or tab restored from storage).
        // Reset view to defaults with the target id, for its detail view to fill.
        return {
          selectedThreadCode: undefined,
          view: {
            ...defaultThread,
            id: typedEvent.id as ThreadEntity['id'],
            shortCode: '' as const,
            status: '',
            timestamp: 0,
          },
        };
      }

      const { id, shortCode, status, timestamp, topic, instructions, tags, pinned } = selectedThread;

      return {
        selectedThreadCode: shortCode,
        view: {
          ...defaultThread,
          id, shortCode, status, timestamp, topic, instructions,
          tags: tags as string[],
          pinned,
        },
      };
    }),
    updateThreadData: assign(({ event, context }) => {
      const typedEvent = typeOf('UPDATE_THREAD_FIELD', event);
      const { key, value, state } = typedEvent;

      return {
        [state]: {
          ...context[state],
          [key]: value,
        },
      } as Pick<typeof context, typeof state>;
    }),
    updateThreadInThreads: assign(({ event, context }) => {
      const typedEvent = typeOf('UPDATE_THREAD_FIELD', event);

      const { messages: _messages, linkedThreads: _linkedThreads, ...rest } = context.view;
      (rest as any)[typedEvent.key] = typedEvent.value as any;
      const newThread = rest as ThreadListItem;
      return {
        threadMap: { ...context.threadMap, [context.view.id]: { ...context.threadMap[context.view.id], ...newThread } },
      };
    }),
    updateCurrentThread: assign(({ event, context }) => {
      const typedEvent = typeOf('UPDATE_THREAD_FIELD', event);
      if (!context.currentThread || context.currentThread.id !== context.view.id) return {};
      return {
        currentThread: {
          ...context.currentThread,
          [typedEvent.key]: typedEvent.value,
        },
      };
    }),
    clearNewThreadFlag: assign(({ context, event }) => {
      const clearId = typeOf('CLEAR_NEW_THREAD_FLAG', event).id;
      return { ...patchThread(context, clearId, { isNew: false }), freshThreadIds: context.freshThreadIds.filter(fresh => fresh !== clearId) };
    }),
    updateThreadStatus: assign(({ context, event }) => {
      const typedEvent = typeOf('UPDATE_THREAD_STATUS', event);
      const call = sendToSystem(id, {
        type: 'UPDATE_THREAD_STATUS',
        threadId: typedEvent.id,
        status: typedEvent.status,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    sendUpdateThreadField: assign(({ event, context }) => {
      const { key, value } = typeOf('UPDATE_THREAD_FIELD', event);
      const call = sendToSystem(id, {
        type: 'UPDATE_THREAD_FIELD',
        threadId: context.view.id,
        key,
        value,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    renameThread: assign(({ event, context }) => {
      const { threadId, topic } = typeOf('RENAME_THREAD', event);
      return optimisticFieldUpdate(context, threadId, 'topic', topic);
    }),
    setThreadsSettings: assign(({ event }) => {
      const settings = event.type === 'CHAT_STARTED' ? event.data.settings : typeOf('FEATURE_SETTINGS_UPDATED', event).settings;
      const chat = (settings as any)?.chat as AgentSettings | undefined;
      return {
        settings,
        availableTags: settings?.tags || [],
        ...(chat ? extractChatSettings(chat) : {}),
      };
    }),
    deleteThread: assign(({ context, event }) => {
      const { threadId } = typeOf('DELETE_THREAD', event);
      const call = sendToSystem(id, {
        type: 'DELETE_THREAD',
        threadId,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    archiveThread: assign(({ context, event }) => {
      const { threadId } = typeOf('ARCHIVE_THREAD', event);
      const call = sendToSystem(id, {
        type: 'UPDATE_THREAD_FIELD',
        threadId,
        key: 'archived',
        value: true,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    unpinThread: assign(({ event, context }) => {
      const { threadId } = typeOf('UNPIN_THREAD', event);
      return optimisticFieldUpdate(context, threadId, 'pinned', false);
    }),
    pinThread: assign(({ event, context }) => {
      const { threadId } = typeOf('PIN_THREAD', event);
      return optimisticFieldUpdate(context, threadId, 'pinned', true);
    }),
    toggleViewArchive: assign(({ context }) => {
      const next = { ...context, showArchived: !context.showArchived };
      return { showArchived: next.showArchived, ...threadStore(next, context.lists) };
    }),
    unarchiveThread: assign(({ context, event }) => {
      const { threadId } = typeOf('UNARCHIVE_THREAD', event);
      const call = sendToSystem(id, {
        type: 'UPDATE_THREAD_FIELD',
        threadId,
        key: 'archived',
        value: false,
      });
      return { writes: writeSent(context.writes, call) };
    }),
    removeUnarchivedThread: assign(({ event, context }) => {
      const { threadId } = typeOf('UNARCHIVE_THREAD', event);
      return removeThread(context, threadId);
    }),
    removeArchivedThread: assign(({ event, context }) => {
      const { threadId } = typeOf('ARCHIVE_THREAD', event);
      const tabs = context.tabs.filter(t => t.id !== threadId);
      const activeTabId = context.activeTabId === threadId
        ? (tabs[tabs.length - 1]?.id ?? '')
        : context.activeTabId;
      return {
        ...removeThread(context, threadId),
        tabs,
        activeTabId,
      };
    }),
    persistListView: () => { try { storage.set('view-preference', 'list'); } catch {} },
    persistKanbanView: () => { try { storage.set('view-preference', 'kanban'); } catch {} },
    persistDashboardView: () => { try { storage.set('view-preference', 'dashboard'); } catch {} },
    /* ── Threads Import actions ────────────────────────────── */
    setImportingThreads: assign(({ context }) => ({
      threadsImport: { ...context.threadsImport, status: 'importing' as const },
    })),
    sendImportThreads: ({ event }) => {
      if (event.type === 'THREADS.IMPORT') {
        sendToSystem(id, { type: 'IMPORT_THREADS', directory: event.directory })
      }
    },
    handleThreadsImported: assign(({ event }) => {
      if (event.type === 'THREADS_IMPORTED') {
        return { threadsImport: { status: 'success' as const, errors: event.errors || [], importedCount: event.count } }
      }
      return {}
    }),
    handleThreadsImportFailed: assign(({ event }) => {
      if (event.type === 'THREADS_IMPORT_FAILED') {
        return { threadsImport: { status: 'error' as const, errors: event.errors, importedCount: 0 } }
      }
      return {}
    }),
    resetImportThreadsStatus: assign({
      threadsImport: { status: 'idle' as const, errors: [] as string[], importedCount: 0 },
    }),

    /* ── Threads Export actions ────────────────────────────── */
    setExportingThreads: assign(({ context }) => ({
      threadsExport: { ...context.threadsExport, status: 'exporting' as const },
    })),
    sendExportThreads: ({ event }) => {
      if (event.type === 'THREADS.EXPORT') {
        sendToSystem(id, { type: 'EXPORT_THREADS', directory: event.directory })
      }
    },
    handleThreadsExported: assign(({ event }) => {
      if (event.type === 'THREADS_EXPORTED') {
        return { threadsExport: { status: 'success' as const, errors: [] as string[], filePath: event.filePath, threadCount: event.threadCount } }
      }
      return {}
    }),
    handleThreadsExportFailed: assign(({ event }) => {
      if (event.type === 'THREADS_EXPORT_FAILED') {
        return { threadsExport: { status: 'error' as const, errors: event.errors, filePath: '', threadCount: 0 } }
      }
      return {}
    }),
    resetExportThreadsStatus: assign({
      threadsExport: { status: 'idle' as const, errors: [] as string[], filePath: '', threadCount: 0 },
    }),

    /* ── Filter actions ────────────────────────────────────── */
    toggleFilterStatus: assign(({ context, event }) => {
      const status = typeOf('TOGGLE_FILTER_STATUS', event).status;
      const current = context.filters.statuses;
      return {
        filters: { ...context.filters, statuses: current.includes(status) ? current.filter(s => s !== status) : [...current, status] },
      };
    }),
    toggleFilterTag: assign(({ context, event }) => {
      const tag = typeOf('TOGGLE_FILTER_TAG', event).tag;
      const current = context.filters.tags;
      return {
        filters: { ...context.filters, tags: current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag] },
      };
    }),
    toggleFilterChatState: assign(({ context, event }) => {
      const chatState = typeOf('TOGGLE_FILTER_CHAT_STATE', event).chatState;
      const current = context.filters.chatStates;
      return {
        filters: { ...context.filters, chatStates: current.includes(chatState) ? current.filter(s => s !== chatState) : [...current, chatState] },
      };
    }),
    setSearch: assign(({ context, event }) => ({
      filters: { ...context.filters, search: typeOf('SET_SEARCH', event).keyword },
    })),
    clearFilters: assign(({ context }) => ({
      filters: { statuses: [] as string[], tags: [] as string[], chatStates: [] as string[], search: '', showRootOnly: context.filters.showRootOnly },
    })),

    /* ── Selection & drag-drop actions ─────────────────────── */
    selectThreadItems: assign(({ event }) => ({
      selectedThreadIds: typeOf('SELECT_THREAD_ITEMS', event).itemIds,
    })),
    toggleRootOnlyFilter: assign(({ context }) => ({
      filters: { ...context.filters, showRootOnly: !context.filters.showRootOnly },
    })),
    sendSetThreadParent: assign(({ context, event }) => {
      const { childIds, parentId } = typeOf('SET_THREAD_PARENT', event);
      const call = sendToSystem(id, {
        type: 'SET_THREAD_PARENT',
        childIds,
        parentId,
      });
      return { writes: writeSent(context.writes, call) };
    }),

    // ---- Chat/agent actions ----
    flashChatState: assign(({ context, event }) => {
      const { threadId, stateId, durationMs } = typeOf('FLASH_CHAT_STATE', event);
      const expiresAt = Date.now() + (durationMs ?? 3000);
      return { chatStateOverrides: { ...context.chatStateOverrides, [threadId]: { id: stateId, expiresAt } } };
    }),
    setMode: assign(({ context, event }) => {
      const newMode = typeOf('SET_MODE', event).mode;
      const modeConfig = context.modes.find(m => m.name === newMode);

      const updatedPhaseByModeName = { ...context.phaseByModeName, [context.mode]: context.phase };
      const newPhase = modeConfig?.phases?.length
        ? (newMode in updatedPhaseByModeName ? updatedPhaseByModeName[newMode] : modeConfig.phases[0].name)
        : undefined;

      return { mode: newMode, phase: newPhase, phaseByModeName: updatedPhaseByModeName };
    }),
    setPhase: assign(({ context, event }) => {
      const newPhase = typeOf('SET_PHASE', event).phase;
      return {
        phase: newPhase,
        phaseByModeName: { ...context.phaseByModeName, [context.mode]: newPhase }
      };
    }),
    navigateToSecrets: () => {
      untypedOpenSurface(HOST_SETTINGS, [
        { type: 'TAB.SELECT', tab: 'general' },
        { type: 'GENERAL_NAV.SELECT', item: 'secrets' }
      ]);
    },
    sendMessage: enqueueActions(({ enqueue, context, event }) => {
      const { text, references } = typeOf('SEND_MESSAGE', event);
      sendToSystem(id, {
        type: 'USER_MSG',
        text,
        mode: context.mode,
        phase: context.phase,
        threadId: context.currentThread?.id,
        ...(references && { references }),
        ...(context.pendingThreadCwd && { cwdOverride: context.pendingThreadCwd }),
        ...(context.pendingForceDirectoryPicker && { forceDirectoryPicker: true }),
      });
      if (context.pendingThreadCwd || context.pendingForceDirectoryPicker) {
        enqueue.assign({ pendingThreadCwd: undefined, pendingForceDirectoryPicker: undefined });
      }
    }),
    sendCommand: enqueueActions(({ enqueue, context, event }) => {
      const { command, text, references } = typeOf('SEND_COMMAND', event);
      sendToSystem(id, {
        type: 'USER_COMMAND',
        command,
        text,
        mode: context.mode,
        phase: context.phase,
        threadId: context.currentThread?.id,
        ...(references && { references }),
        ...(context.pendingThreadCwd && { cwdOverride: context.pendingThreadCwd }),
      });
      if (context.pendingThreadCwd) {
        enqueue.assign({ pendingThreadCwd: undefined });
      }
    }),
    clearThread: assign(({ context }) => {
      const { mode, phase } = resolveDefaultModePhase(
        context.chatSettings, context.modes, context.mode, context.phase,
      );
      return {
        currentThread: { ...defaultChatThread, messages: [] },
        chatMessageIds: [] as string[],
        openedThreadId: null,
        mode,
        phase: phase ?? '',
        phaseByModeName: { ...context.phaseByModeName, [mode]: phase },
        pendingThreadCwd: undefined,
        pendingForceDirectoryPicker: undefined,
      };
    }),
    newThreadInProject: assign(({ context, event }) => {
      const { directory } = typeOf('NEW_THREAD_IN_PROJECT', event);
      const { mode, phase } = resolveDefaultModePhase(
        context.chatSettings, context.modes, context.mode, context.phase,
      );
      return {
        currentThread: { ...defaultChatThread, messages: [] },
        chatMessageIds: [] as string[],
        openedThreadId: null,
        mode,
        phase: phase ?? '',
        phaseByModeName: { ...context.phaseByModeName, [mode]: phase },
        pendingThreadCwd: directory,
        pendingForceDirectoryPicker: undefined,
      };
    }),
    newThreadNoProject: assign(({ context }) => {
      const { mode, phase } = resolveDefaultModePhase(
        context.chatSettings, context.modes, context.mode, context.phase,
      );
      return {
        currentThread: { ...defaultChatThread, messages: [] },
        chatMessageIds: [] as string[],
        openedThreadId: null,
        mode,
        phase: phase ?? '',
        phaseByModeName: { ...context.phaseByModeName, [mode]: phase },
        pendingThreadCwd: undefined,
        pendingForceDirectoryPicker: true,
      };
    }),
    /**
     * What the chat starts from, which the system answered the shell's start with: the settings, the mode, the tabs —
     * the ones this window kept and the ones every window opens — and the thread to open
     */
    startChat: enqueueActions(({ enqueue, context, event, self }) => {
      const start: ChatStart = typeOf('CHAT_STARTED', event).data;
      const extracted = extractChatSettings(start.settings?.chat || { modes: [], hotkeys: {} });
      const visibleModes = extracted.modes.filter(m => !m.hidden);
      const { mode, phase } = resolveDefaultModePhase(
        extracted.chatSettings, extracted.modes, visibleModes[0]?.name ?? context.mode, visibleModes[0]?.phases?.[0]?.name,
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

      enqueue('setThreadsSettings');
      enqueue.assign({ tabs, activeTabId, tabGroups: loadThreadTabGroups(), mode, phase: phase ?? '' });
      enqueue('followSettingsViews');
      enqueue('tabsChanged');
      const threadToLoad = activeTabId || start.currentThreadId;
      if (threadToLoad) enqueue(() => self.send({ type: 'OPEN_THREAD_CHAT', threadId: threadToLoad, restore: true }));
    }),
    sendOpenThreadView: ({ self, event }) => {
      const threadId = typeOf('VIEW_THREAD', event).threadId;
      self.send({ type: 'SELECT_THREAD', id: threadId });
    },
    createChildThread: ({ self, event }) => {
      const parentThreadId = typeOf('CREATE_CHILD_THREAD', event).parentThreadId;
      self.send({ type: 'SHOW_CREATE_FORM_AS_CHILD', parentThreadId });
    },
    selectTab: assign(({ event }) => ({
      activeTabId: typeOf('SELECT_TAB', event).tabId
    })),
    closeTab: enqueueActions(({ enqueue, context, event, self }) => {
      const tabId = typeOf('CLOSE_TAB', event).tabId;
      const tab = context.tabs.find(t => t.id === tabId);
      if (!tab || tab.pinned) return;

      const idx = context.tabs.findIndex(t => t.id === tabId);
      const newTabs = context.tabs.filter(t => t.id !== tabId);

      let newActiveTabId = context.activeTabId;
      if (context.activeTabId === tabId) {
        const nextTab = context.tabs[idx + 1] ?? context.tabs[idx - 1];
        newActiveTabId = nextTab?.id ?? '';
      }

      enqueue(assign({ tabs: newTabs, activeTabId: newActiveTabId }));
      if (context.activeTabId === tabId && newActiveTabId) {
        enqueue(() => self.send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId }));
      }
    }),
    closeActiveTab: enqueueActions(({ enqueue, context, self }) => {
      const tabId = context.activeTabId;
      if (!tabId) return;
      const tab = context.tabs.find(t => t.id === tabId);
      if (!tab || tab.pinned) return;

      const idx = context.tabs.findIndex(t => t.id === tabId);
      const newTabs = context.tabs.filter(t => t.id !== tabId);
      const nextTab = context.tabs[idx + 1] ?? context.tabs[idx - 1];
      const newActiveTabId = nextTab?.id ?? '';

      enqueue(assign({ tabs: newTabs, activeTabId: newActiveTabId }));
      if (newActiveTabId) {
        enqueue(() => self.send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId }));
      }
    }),
    persistTabs: ({ context }) => saveTabsToStorage(context.tabs, context.activeTabId),
    /** The open tabs changed: kept in this window's storage, and each open one's view followed */
    tabsChanged: enqueueActions(({ enqueue }) => {
      enqueue('persistTabs');
      enqueue('followTabs');
    }),
    persistTabGroups: ({ context }) => saveThreadTabGroups(context.tabGroups),

    // ---- Tab reorder & group actions ----
    reorderTabs: assign(({ context, event }) => {
      const { fromIndex, toIndex } = typeOf('REORDER_TABS', event);
      const tabs = [...context.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),
    pinTabAt: assign(({ context, event }) => {
      const { tabId, targetTabId, side } = typeOf('PIN_TAB_AT', event);
      const tabs = context.tabs.map(t => t.id === tabId ? { ...t, pinned: true, groupId: undefined } : t);
      const sourceIdx = tabs.findIndex(t => t.id === tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === targetTabId);
      const insertIdx = side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      return { tabs };
    }),
    unpinTabAt: assign(({ context, event }) => {
      const { tabId, targetTabId, side } = typeOf('UNPIN_TAB_AT', event);
      const tabs = context.tabs.map(t => t.id === tabId ? { ...t, pinned: false, groupId: undefined } : t);
      const sourceIdx = tabs.findIndex(t => t.id === tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === targetTabId);
      const insertIdx = side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      return { tabs };
    }),
    createTabGroup: assign(({ context, event }) => {
      const { tabIds } = typeOf('CREATE_TAB_GROUP', event) as { type: string; tabIds?: string[] };
      const firstTab = tabIds?.[0] ? context.tabs.find(t => t.id === tabIds[0]) : undefined;
      const isPinned = firstTab?.pinned || false;
      const color = getNextAvailableColor(context.tabGroups, isPinned);
      const newGroup: ThreadTabGroup = {
        id: crypto.randomUUID(),
        name: 'New Group',
        color,
        isCollapsed: false,
        order: context.tabGroups.length,
        isPinned: isPinned || undefined,
      };
      const tabs = tabIds
        ? context.tabs.map(t => tabIds.includes(t.id) ? { ...t, groupId: newGroup.id } : t)
        : context.tabs;
      return { tabGroups: [...context.tabGroups, newGroup], tabs };
    }),
    renameTabGroup: assign(({ context, event }) => {
      const { groupId, name } = typeOf('RENAME_TAB_GROUP', event);
      return {
        tabGroups: context.tabGroups.map(g => g.id === groupId ? { ...g, name } : g),
      };
    }),
    changeTabGroupColor: assign(({ context, event }) => {
      const { groupId, color } = typeOf('CHANGE_TAB_GROUP_COLOR', event);
      return {
        tabGroups: context.tabGroups.map(g => g.id === groupId ? { ...g, color } : g),
      };
    }),
    deleteTabGroup: assign(({ context, event }) => {
      const { groupId } = typeOf('DELETE_TAB_GROUP', event);
      return {
        tabGroups: context.tabGroups.filter(g => g.id !== groupId),
        tabs: context.tabs.map(t => t.groupId === groupId ? { ...t, groupId: undefined } : t),
      };
    }),
    toggleTabGroupCollapse: assign(({ context, event }) => {
      const { groupId } = typeOf('TOGGLE_TAB_GROUP_COLLAPSE', event);
      return {
        tabGroups: context.tabGroups.map(g => g.id === groupId ? { ...g, isCollapsed: !g.isCollapsed } : g),
      };
    }),
    addTabToGroup: assign(({ context, event }) => {
      const { tabId, groupId } = typeOf('ADD_TAB_TO_GROUP', event);
      const group = context.tabGroups.find(g => g.id === groupId);
      if (!group) return {};
      return {
        tabs: context.tabs.map(t => t.id === tabId ? { ...t, groupId, pinned: group.isPinned || false } : t),
      };
    }),
    addTabToGroupAt: assign(({ context, event }) => {
      const { tabId, groupId, targetTabId, side } = typeOf('ADD_TAB_TO_GROUP_AT', event);
      const group = context.tabGroups.find(g => g.id === groupId);
      if (!group) return {};
      const tabs = context.tabs.map(t => t.id === tabId ? { ...t, groupId, pinned: group.isPinned || false } : t);
      const sourceIdx = tabs.findIndex(t => t.id === tabId);
      const [moved] = tabs.splice(sourceIdx, 1);
      const targetIdx = tabs.findIndex(t => t.id === targetTabId);
      const insertIdx = side === 'left' ? targetIdx : targetIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      return { tabs };
    }),
    removeTabFromGroup: assign(({ context, event }) => {
      const { tabId } = typeOf('REMOVE_TAB_FROM_GROUP', event);
      return {
        tabs: context.tabs.map(t => t.id === tabId ? { ...t, groupId: undefined } : t),
      };
    }),
    ungroupAllInGroup: assign(({ context, event }) => {
      const { groupId } = typeOf('UNGROUP_ALL_IN_GROUP', event);
      return {
        tabGroups: context.tabGroups.filter(g => g.id !== groupId),
        tabs: context.tabs.map(t => t.groupId === groupId ? { ...t, groupId: undefined } : t),
      };
    }),
    closeAllInGroup: enqueueActions(({ enqueue, context, event, self }) => {
      const { groupId } = typeOf('CLOSE_ALL_IN_GROUP', event);
      const tabsInGroup = context.tabs.filter(t => t.groupId === groupId);
      const remainingTabs = context.tabs.filter(t => t.groupId !== groupId);
      const needNewActive = tabsInGroup.some(t => t.id === context.activeTabId);
      const newActiveTabId = needNewActive
        ? (remainingTabs[remainingTabs.length - 1]?.id ?? '')
        : context.activeTabId;

      enqueue(assign({
        tabs: remainingTabs,
        activeTabId: newActiveTabId,
        tabGroups: context.tabGroups.filter(g => g.id !== groupId),
      }));

      if (needNewActive && newActiveTabId) {
        enqueue(() => self.send({ type: 'OPEN_THREAD_CHAT', threadId: newActiveTabId }));
      }
    }),
    pinTabGroup: assign(({ context, event }) => {
      const { groupId } = typeOf('PIN_TAB_GROUP', event);
      return {
        tabGroups: context.tabGroups.map(g => g.id === groupId ? { ...g, isPinned: true } : g),
        tabs: context.tabs.map(t => t.groupId === groupId ? { ...t, pinned: true } : t),
      };
    }),
    unpinTabGroup: assign(({ context, event }) => {
      const { groupId } = typeOf('UNPIN_TAB_GROUP', event);
      return {
        tabGroups: context.tabGroups.map(g => g.id === groupId ? { ...g, isPinned: undefined } : g),
        tabs: context.tabs.map(t => t.groupId === groupId ? { ...t, pinned: false } : t),
      };
    }),
    cleanupEmptyGroups: assign(({ context }) => {
      const tabGroupIds = new Set(context.tabs.map(t => t.groupId).filter(Boolean));
      const tabGroups = context.tabGroups.filter(g => tabGroupIds.has(g.id));
      return { tabGroups };
    }),

    selectArtifact: assign(({ context, event }) => {
      const artifactId = typeOf('SELECT_ARTIFACT', event).artifactId;
      const tabs = context.tabs.map(tab =>
        tab.id === context.activeTabId ? { ...tab, selectedArtifactId: artifactId } : tab
      );
      return { tabs };
    }),
    handleHotkey: createHotkeyProcessor({
      quickPrompts: 'TOGGLE_QUICK_PROMPTS',
      closeTab: 'CLOSE_ACTIVE_TAB',
    }),
    openQuickPromptsAtCursor: assign(() => ({
      quickPromptCursor: { x: mouseX, y: mouseY },
    })),
    closeQuickPrompts: assign({ quickPromptCursor: null }),
    respondToBlockInteraction: ({ context, event }) => {
      const { messageId, response } = typeOf('RESPOND_TO_BLOCK_INTERACTION', event);

      if (!context.currentThread?.id) {
        console.error('Cannot respond to block interaction: no current thread');
        return;
      }

      sendToSystem(id, {
        type: 'INTERACTIVE_MSG_RESPONSE',
        messageId,
        threadId: context.currentThread.id,
        response,
      });
    },
    dismissMessage: assign(({ context, event }) => {
      const { messageId } = typeOf('DISMISS_MESSAGE', event);
      const next = { ...context, chatMessageIds: context.chatMessageIds.filter(listed => listed !== messageId) };
      return { chatMessageIds: next.chatMessageIds, ...composedMessages(next) };
    }),
    /** The chat's view asks for a page more of the open thread's messages */
    loadMoreMessages: enqueueActions(({ context, enqueue }) => {
      const { hasMore, isLoading } = context.messagePagination;
      if (!context.currentThread?.id || !hasMore || isLoading) return;
      enqueue.assign({ chatLimit: context.chatLimit + MESSAGE_PAGE_SIZE, messagePagination: { hasMore, isLoading: true } });
      enqueue('followChat');
    }),
    forkThread: ({ event }) => {
      const { messageId, threadId, threadTopic } = typeOf('FORK_THREAD', event);
      sendToSystem(id, { type: 'FORK_THREAD', messageId, threadId, threadTopic });
    },
    revertThread: ({ event }) => {
      const { messageId, threadId, restoreFiles, userCliUuid } = typeOf('REVERT_THREAD', event);
      sendToSystem(id, {
        type: 'REVERT_THREAD',
        messageId,
        threadId,
        ...(restoreFiles !== undefined && { restoreFiles }),
        ...(userCliUuid !== undefined && { userCliUuid }),
      });
    },
    summarizeThread: ({ event }) => {
      const { messageId, threadId } = typeOf('SUMMARIZE_THREAD', event);
      sendToSystem(id, { type: 'SUMMARIZE_THREAD', messageId, threadId });
    },
    pauseTurn: ({ event }) => {
      const { threadId } = typeOf('PAUSE_TURN', event);
      sendToSystem(id, { type: 'PAUSE_TURN', threadId });
    },
    unqueueMessage: ({ event }) => {
      const { threadId, messageId } = typeOf('UNQUEUE_MESSAGE', event);
      sendToSystem(id, { type: 'FORWARD_BRAIN_EVENT', eventType: 'user.thread.unqueue', payload: { threadId, messageId } });
    },
    persistDismissMessage: ({ event }) => {
      const { messageId } = typeOf('DISMISS_MESSAGE', event);
      sendToSystem(id, { type: 'DELETE_MESSAGE', messageId });
    },
  },
  guards: { entityIs: entityIs<Contract['opens']>,
    targetIs,
    quickPromptsOpen: ({ context }) => context.quickPromptCursor !== null,
    /** A read saying a thread this window shows is gone — and nothing of this window's is unanswered that a result was held behind */
    detailGone: ({ context, event }) => event.type === 'DETAIL.READ' && event.id === context.view.id && event.detail === null && !writing(context.writes),
    chatGone: ({ context, event }) => event.type === 'CHAT.READ' && event.threadId === context.currentThread?.id && event.chat === null && !writing(context.writes),
    tabGone: ({ event }) => event.type === 'TAB.READ' && event.tab === null,
  }
}).createMachine({
  id,
  initial: getInitialView(),
  context: () => ({
    // Thread management (normalized)
    threadMap: {} as Record<string, ThreadListItem>,
    threadIds: [] as string[],
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
    threadsImport: { status: 'idle' as const, errors: [], importedCount: 0 },
    threadsExport: { status: 'idle' as const, errors: [], filePath: '', threadCount: 0 },
    // Chat/agent
    currentThread: defaultChatThread,
    recentThreadIds: [] as string[],
    messageInput: "",
    chatStates: {} as Record<string, ChatState>,
    chatStateOverrides: {} as Record<string, { id: string; expiresAt: number }>,
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
    navHistory: createNavHistory(getInitialView()),
    messagePagination: { hasMore: false, isLoading: false },
    sidebarArchivedThreads: [],
    lists: { list: [], recent: [], archived: [] },
    chatLimit: MESSAGE_PAGE_SIZE,
    chatMessageIds: [],
    detailMessageIds: [],
    messageContents: {},
    messageViews: [],
    tabViews: [],
    tabsRead: [],
    openedThreadId: null,
    freshThreadIds: [],
    writes: viewWrites(),
  }),
  on: {
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Thread' } }, target: '.view', actions: ['setSelectedThread', 'sendViewThread', 'recordThreadNavigation', 'followDetail'] },
    SURFACE_STARTED: { actions: 'startSurface' },
    CHAT_STARTED: { actions: 'startChat' },
    // What the views gave
    'THREADS.READ': { actions: 'readThreads' },
    'ARCHIVED.READ': { actions: 'readArchived' },
    'RECENT.READ': { actions: 'readRecent' },
    'DETAIL.READ': [
      { guard: 'detailGone', target: '.list', actions: 'leaveGoneDetail' },
      { actions: 'readDetail' },
    ],
    'CHAT.READ': [
      { guard: 'chatGone', actions: 'dropThread' },
      { actions: 'readChat' },
    ],
    'MESSAGE.READ': { actions: 'readMessage' },
    'TAB.READ': [
      { guard: 'tabGone', actions: 'dropThread' },
      { actions: 'readTab' },
    ],
    // Answers to this window's writes
    THREAD_WRITTEN: { actions: 'settleWrite' },
    THREAD_WRITE_FAILED: { actions: 'settleWrite' },
    SHOW_THREAD: { actions: 'openThread' },
    // Thread management events
    SHOW_CREATE_FORM: {
      target: '.create',
      actions: assign(({ context }) => ({
        create: { ...defaultThread },
        navHistory: pushNavHistory(context.navHistory, 'create'),
      }))
    },
    UPDATE_THREAD_STATUS: {
      actions: 'updateThreadStatus',
    },
    VIEW_LIST: { target: '.list', actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'list') })) },
    VIEW_KANBAN: { target: '.kanban', actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'kanban') })) },
    VIEW_DASHBOARD: { target: '.dashboard', actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'dashboard') })) },
    OPEN_THREAD_CHAT: {
      actions: 'openThread'
    },
    CLEAR_NEW_THREAD_FLAG: {
      actions: ['clearNewThreadFlag', stopChild(({ event }) => newThreadFlagTimer(typeOf('CLEAR_NEW_THREAD_FLAG', event).id))]
    },
    THREAD_CREATED: {
      actions: [
        'settleWrite',
        'markCreated',
        stopChild(({ event }) => newThreadFlagTimer(typeOf('THREAD_CREATED', event).id)),
        spawnChild('clearNewThreadFlag', {
          id: ({ event }) => newThreadFlagTimer(typeOf('THREAD_CREATED', event).id),
          input: ({ event }) => ({ id: typeOf('THREAD_CREATED', event).id })
        })
      ]
    },
    RENAME_THREAD: {
      actions: 'renameThread',
    },
    FEATURE_SETTINGS_UPDATED: {
      actions: ['setThreadsSettings', 'followSettingsViews'],
    },
    DELETE_THREAD: {
      actions: 'deleteThread',
    },
    TOGGLE_VIEW_ARCHIVE: {
      actions: 'toggleViewArchive',
      target: '.list',
    },
    ARCHIVE_THREAD: {
      actions: ['archiveThread', 'removeArchivedThread', 'cleanupEmptyGroups', 'tabsChanged', 'persistTabGroups'],
    },
    UNARCHIVE_THREAD: {
      actions: ['unarchiveThread', 'removeUnarchivedThread'],
    },
    UNPIN_THREAD: {
      actions: 'unpinThread',
    },
    PIN_THREAD: {
      actions: 'pinThread',
    },

    // Import/Export events
    'THREADS.IMPORT': {
      actions: ['setImportingThreads', 'sendImportThreads'],
    },
    'THREADS.RESET_IMPORT_STATUS': {
      actions: 'resetImportThreadsStatus',
    },
    THREADS_IMPORTED: {
      actions: 'handleThreadsImported',
    },
    THREADS_IMPORT_FAILED: {
      actions: 'handleThreadsImportFailed',
    },
    THREAD_CHAT_ERROR: {
      actions: 'dropThread',
    },
    'THREADS.EXPORT': {
      actions: ['setExportingThreads', 'sendExportThreads'],
    },
    'THREADS.RESET_EXPORT_STATUS': {
      actions: 'resetExportThreadsStatus',
    },
    THREADS_EXPORTED: {
      actions: 'handleThreadsExported',
    },
    THREADS_EXPORT_FAILED: {
      actions: 'handleThreadsExportFailed',
    },

    // Filter events
    TOGGLE_FILTER_STATUS: { actions: 'toggleFilterStatus' },
    TOGGLE_FILTER_TAG: { actions: 'toggleFilterTag' },
    TOGGLE_FILTER_CHAT_STATE: { actions: 'toggleFilterChatState' },
    SET_SEARCH: { actions: 'setSearch' },
    CLEAR_FILTERS: { actions: 'clearFilters' },
    TOGGLE_ROOT_ONLY_FILTER: { actions: 'toggleRootOnlyFilter' },
    SELECT_THREAD_ITEMS: { actions: 'selectThreadItems' },
    SET_THREAD_PARENT: { actions: 'sendSetThreadParent' },

    NAVIGATE_BACK: [
      {
        guard: ({ context }) => canGoBack(context.navHistory) && context.navHistory.stack[context.navHistory.index - 1].startsWith('view:'),
        target: '.view',
        actions: [
          assign(({ context }) => {
            const result = goBack(context.navHistory)!;
            const threadId = result.entry.replace('view:', '');
            const selectedThread = context.threadMap[threadId];
            return {
              navHistory: result.history,
              view: selectedThread
                ? { ...context.view, ...selectedThread, id: threadId }
                : { ...context.view, id: threadId },
            } as any;
          }),
          ({ context }) => {
            sendToSystem(id, { type: 'VIEW_THREAD', threadId: context.view.id });
          },
          'followDetail',
        ],
      },
      {
        guard: ({ context }) => canGoBack(context.navHistory) && context.navHistory.stack[context.navHistory.index - 1] === 'list',
        target: '.list',
        actions: assign(({ context }) => ({ navHistory: goBack(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoBack(context.navHistory) && context.navHistory.stack[context.navHistory.index - 1] === 'kanban',
        target: '.kanban',
        actions: assign(({ context }) => ({ navHistory: goBack(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoBack(context.navHistory) && context.navHistory.stack[context.navHistory.index - 1] === 'dashboard',
        target: '.dashboard',
        actions: assign(({ context }) => ({ navHistory: goBack(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoBack(context.navHistory) && context.navHistory.stack[context.navHistory.index - 1] === 'create',
        target: '.create',
        actions: assign(({ context }) => ({ navHistory: goBack(context.navHistory)!.history })),
      },
    ],
    NAVIGATE_FORWARD: [
      {
        guard: ({ context }) => canGoForward(context.navHistory) && context.navHistory.stack[context.navHistory.index + 1].startsWith('view:'),
        target: '.view',
        actions: [
          assign(({ context }) => {
            const result = goForward(context.navHistory)!;
            const threadId = result.entry.replace('view:', '');
            const selectedThread = context.threadMap[threadId];
            return {
              navHistory: result.history,
              view: selectedThread
                ? { ...context.view, ...selectedThread, id: threadId }
                : { ...context.view, id: threadId },
            } as any;
          }),
          ({ context }) => {
            sendToSystem(id, { type: 'VIEW_THREAD', threadId: context.view.id });
          },
          'followDetail',
        ],
      },
      {
        guard: ({ context }) => canGoForward(context.navHistory) && context.navHistory.stack[context.navHistory.index + 1] === 'list',
        target: '.list',
        actions: assign(({ context }) => ({ navHistory: goForward(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoForward(context.navHistory) && context.navHistory.stack[context.navHistory.index + 1] === 'kanban',
        target: '.kanban',
        actions: assign(({ context }) => ({ navHistory: goForward(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoForward(context.navHistory) && context.navHistory.stack[context.navHistory.index + 1] === 'dashboard',
        target: '.dashboard',
        actions: assign(({ context }) => ({ navHistory: goForward(context.navHistory)!.history })),
      },
      {
        guard: ({ context }) => canGoForward(context.navHistory) && context.navHistory.stack[context.navHistory.index + 1] === 'create',
        target: '.create',
        actions: assign(({ context }) => ({ navHistory: goForward(context.navHistory)!.history })),
      },
    ],
    // Breadcrumb trail clicks
    TRAIL_CLICK: [
      {
        guard: { type: 'targetIs', params: { view: 'list' } },
        target: '.list',
        actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'list') })),
      },
      {
        guard: { type: 'targetIs', params: { view: 'kanban' } },
        target: '.kanban',
        actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'kanban') })),
      },
      {
        guard: { type: 'targetIs', params: { view: 'create' } },
        target: '.create',
        actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'create') })),
      },
      {
        guard: { type: 'targetIs', params: { view: 'view' } },
        target: '.view',
      },
      {
        guard: { type: 'targetIs', params: { view: 'dashboard' } },
        target: '.dashboard',
        actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, 'dashboard') })),
      },
    ],
    SELECT_THREAD: {
      target: '.view',
      actions: [
        'setSelectedThread',
        'sendViewThread',
        'recordThreadNavigation',
        'followDetail',
      ],
    },

    // ---- Chat/agent events (always active regardless of view state) ----
    HOTKEY_PRESSED: { actions: ['handleHotkey'] },
    OPEN_QUICK_PROMPTS: { actions: 'openQuickPromptsAtCursor' },
    CLOSE_QUICK_PROMPTS: { actions: 'closeQuickPrompts' },
    TOGGLE_QUICK_PROMPTS: [
      { guard: 'quickPromptsOpen', actions: 'closeQuickPrompts' },
      { actions: 'openQuickPromptsAtCursor' },
    ],
    VIEW_THREAD: { actions: 'sendOpenThreadView' },
    NAVIGATE_TO_SECRETS: { actions: 'navigateToSecrets' },
    RESPOND_TO_BLOCK_INTERACTION: {
      actions: [
        'respondToBlockInteraction',
      ],
    },
    LOAD_MORE_MESSAGES: { actions: 'loadMoreMessages' },
    SEND_MESSAGE: { actions: 'sendMessage' },
    SEND_COMMAND: { actions: 'sendCommand' },
    FLASH_CHAT_STATE: {
      actions: [
        'flashChatState',
        stopChild(({ event }) => chatStateOverrideTimer(typeOf('FLASH_CHAT_STATE', event).threadId)),
        spawnChild('clearExpiredOverride', {
          // Per thread: without an id two flashes at once share a key and the first is left untracked
          id: ({ event }: any) => chatStateOverrideTimer(event.threadId),
          input: ({ event }: any) => ({
            threadId: event.threadId,
            durationMs: event.durationMs ?? 3000,
          }),
        }),
      ],
    },
    CLEAR_CHAT_STATE_OVERRIDE: {
      actions: [
        assign(({ context, event }) => {
          const { threadId } = typeOf('CLEAR_CHAT_STATE_OVERRIDE', event);
          const { [threadId]: _, ...rest } = context.chatStateOverrides;
          return { chatStateOverrides: rest };
        }),
        stopChild(({ event }) => chatStateOverrideTimer(typeOf('CLEAR_CHAT_STATE_OVERRIDE', event).threadId)),
      ],
    },
    SET_MODE: { actions: 'setMode' },
    SET_PHASE: { actions: 'setPhase' },
    CLEAR_THREAD: { actions: ['clearThread', 'followChat', 'followMessages'] },
    NEW_THREAD_IN_PROJECT: { actions: ['newThreadInProject', 'followChat', 'followMessages'] },
    NEW_THREAD_NO_PROJECT: { actions: ['newThreadNoProject', 'followChat', 'followMessages'] },
    CREATE_CHILD_THREAD: { actions: 'createChildThread' },
    FORK_THREAD: { actions: 'forkThread' },
    REVERT_THREAD: { actions: 'revertThread' },
    SUMMARIZE_THREAD: { actions: 'summarizeThread' },
    PAUSE_TURN: {
      actions: 'pauseTurn',
    },
    UNQUEUE_MESSAGE: {
      actions: 'unqueueMessage',
    },
    DISMISS_MESSAGE: { actions: ['dismissMessage', 'followMessages', 'persistDismissMessage'] },
    SELECT_TAB: { actions: ['selectTab', 'persistTabs'] },
    CLOSE_TAB: { actions: ['closeTab', 'cleanupEmptyGroups', 'tabsChanged', 'persistTabGroups'] },
    CLOSE_ACTIVE_TAB: { actions: ['closeActiveTab', 'cleanupEmptyGroups', 'tabsChanged', 'persistTabGroups'] },
    // Tab reorder & group events
    REORDER_TABS: { actions: ['reorderTabs', 'persistTabs'] },
    PIN_TAB_AT: { actions: ['pinTabAt', 'persistTabs'] },
    UNPIN_TAB_AT: { actions: ['unpinTabAt', 'persistTabs'] },
    CREATE_TAB_GROUP: { actions: ['createTabGroup', 'persistTabs', 'persistTabGroups'] },
    RENAME_TAB_GROUP: { actions: ['renameTabGroup', 'persistTabGroups'] },
    CHANGE_TAB_GROUP_COLOR: { actions: ['changeTabGroupColor', 'persistTabGroups'] },
    DELETE_TAB_GROUP: { actions: ['deleteTabGroup', 'persistTabs', 'persistTabGroups'] },
    TOGGLE_TAB_GROUP_COLLAPSE: { actions: ['toggleTabGroupCollapse', 'persistTabGroups'] },
    ADD_TAB_TO_GROUP: { actions: ['addTabToGroup', 'persistTabs', 'persistTabGroups'] },
    ADD_TAB_TO_GROUP_AT: { actions: ['addTabToGroupAt', 'persistTabs', 'persistTabGroups'] },
    REMOVE_TAB_FROM_GROUP: { actions: ['removeTabFromGroup', 'persistTabs'] },
    UNGROUP_ALL_IN_GROUP: { actions: ['ungroupAllInGroup', 'persistTabs', 'persistTabGroups'] },
    CLOSE_ALL_IN_GROUP: { actions: ['closeAllInGroup', 'tabsChanged', 'persistTabGroups'] },
    PIN_TAB_GROUP: { actions: ['pinTabGroup', 'persistTabs', 'persistTabGroups'] },
    UNPIN_TAB_GROUP: { actions: ['unpinTabGroup', 'persistTabs', 'persistTabGroups'] },
    SELECT_ARTIFACT: { actions: 'selectArtifact' },
  },
  states: {
    'dashboard': {
      entry: 'persistDashboardView',
      meta: { ...breadcrumb('dashboard', 'Dashboard') },
      on: {},
    },
    'list': {
      entry: 'persistListView',
      meta: { ...breadcrumb('list', 'Threads', true) },
      on: {},
    },
    'kanban': {
      entry: 'persistKanbanView',
      meta: { ...breadcrumb('kanban', 'Board') },
      on: {
        UPDATE_THREAD_STATUS: {
          actions: 'updateThreadStatus',
        },
      },
    },
    'create': {
      meta: { ...breadcrumb('create', 'New Thread') },
      on: {
        CREATE_THREAD: {
          target: 'list',
          actions: 'sendCreateThread',
        },
        CANCEL_CREATE: { target: 'list' },
        UPDATE_THREAD_FIELD: {
          actions: 'updateThreadData',
        },
        TOGGLE_TAGS_SECTION: {
          actions: assign({
            create: ({ context, event }) => ({
              ...context.create,
              tagsExpanded: typeOf('TOGGLE_TAGS_SECTION', event).show
            })
          })
        },
        TOGGLE_LINKED_SECTION: {
          actions: assign({
            create: ({ context, event }) => ({
              ...context.create,
              linkedExpanded: typeOf('TOGGLE_LINKED_SECTION', event).show
            })
          })
        },
      },
    },
    'view': {
      exit: 'stopDetail',
      meta: {
        ...breadcrumbWithParams<ThreadsContext>({
          target: 'view',
          getLabel: (ctx) => ctx.view.topic || 'Untitled Thread'
        }),
        ...contextMenuFn<ThreadsContext>((ctx) => {
          if (!ctx.view?.id) return []
          return [
            ...(ctx.view.pinned ? [{
              label: 'Unpin Thread',
              icon: Pin,
              event: { type: 'UNPIN_THREAD' as const, threadId: ctx.view.id },
            }] : [{
              label: 'Pin Thread',
              icon: Pin,
              event: { type: 'PIN_THREAD' as const, threadId: ctx.view.id },
            }]),
            ...(ctx.view.archived ? [{
              label: 'Unarchive Thread',
              icon: Archive,
              event: { type: 'UNARCHIVE_THREAD' as const, threadId: ctx.view.id },
            }] : !ctx.view.pinned ? [{
              label: 'Archive Thread',
              icon: Archive,
              event: { type: 'ARCHIVE_THREAD' as const, threadId: ctx.view.id },
              confirm: `Archive thread "${ctx.view.topic || 'Untitled'}"? It will be hidden from all lists.`,
            }] : []),
            ...(!ctx.view.pinned ? [{
              label: 'Delete Thread',
              icon: Trash2,
              event: { type: 'DELETE_THREAD' as const, threadId: ctx.view.id },
              iconColor: 'text-red-400',
              confirm: `Are you sure you want to delete thread "${ctx.view.topic || 'Untitled'}"? This will permanently delete all messages and other data associated.`,
            }] : []),
            {
              label: 'Copy Id',
              icon: Copy,
              event: { type: 'APP_COPY_TO_CLIPBOARD' as const, text: ctx.view.id },
              separator: true,
            },
          ]
        }),
      },
      on: {
        SHOW_CREATE_FORM_AS_CHILD: {
          target: 'create',
          actions: 'setupParentThread'
        },
        UPDATE_THREAD_FIELD: {
          actions: ['updateThreadData', 'updateThreadInThreads', 'updateCurrentThread', 'sendUpdateThreadField'],
        },
      },
    },
  },
});

export default threadsState;
