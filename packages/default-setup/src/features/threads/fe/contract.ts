// The threads surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
import type { Simplify } from '@apackdev/sdk/helpers'
import type { HotkeysMap, NavHistory, SurfaceInbox } from '@apackdev/sdk/fe'
import type {
  AgentMode as AgentModeConfig, AgentSettings, AgentThreadData, MessageSearchResult, Tab, ThreadCreateData,
  ThreadEntity, ThreadTagOption, ThreadViewData, ThreadsSettings,
} from '#generated/types.ts'
import type { ThreadTabGroup } from './canvas/agent/tabs/types.ts'

export type ThreadListItem = Simplify<ThreadEntity & {
  tags?: string[];
  isNew?: boolean;
  parentId?: string;
}>;

export type ChatState = 'idle' | 'working' | 'paused' | 'error' | 'success';

export interface ThreadsContext {
  // Thread management (normalized)
  threadMap: Record<string, ThreadListItem>;
  threadIds: string[];
  selectedThreadIds: string[];
  selectedThreadCode?: string;
  view: ThreadViewData;
  create: ThreadCreateData & {
    parentThreadId?: string;
    parentThread?: ThreadListItem;
    tagsExpanded?: boolean;
    linkedExpanded?: boolean;
  };
  availableTags: ThreadTagOption[];
  settings: ThreadsSettings | null;
  showArchived: boolean;
  filters: {
    statuses: string[];
    tags: string[];
    chatStates: string[];
    search: string;
    showRootOnly: boolean;
  };
  threadsImport: { status: 'idle' | 'importing' | 'success' | 'error'; errors: string[]; importedCount: number };
  threadsExport: { status: 'idle' | 'exporting' | 'success' | 'error'; errors: string[]; filePath: string; threadCount: number };
  // Chat/agent
  currentThread: AgentThreadData | null;
  recentThreadIds: string[];
  messageInput: string;
  pendingActionId?: string;
  chatStates: Record<string, ChatState>;
  chatStateOverrides: Record<string, { id: string; expiresAt: number }>;
  tabs: Tab[];
  activeTabId: string;
  tabGroups: ThreadTabGroup[];
  mode: string;
  phase: string;
  phaseByModeName: Record<string, string | undefined>;
  modes: AgentModeConfig[];
  hotkeys: HotkeysMap;
  chatSettings: AgentSettings;
  quickPromptCursor: { x: number; y: number } | null;
  pendingThreadCwd?: string;
  pendingForceDirectoryPicker?: boolean;
  navHistory: NavHistory<string>;
  messagePagination: { hasMore: boolean; nextCursor: string | null; isLoading: boolean };
  sidebarArchivedThreads: ThreadListItem[];
  /** The panel's message search: the query typed, and the results answering it once they arrive */
  messageSearch: { query: string; results: MessageSearchResult[]; searching: boolean };
  /** A message the chat brings into view once its thread has loaded it, older pages included */
  focusMessageId: string | null;
}

/** What the artifact viewers, the dashboard and the tiptap command items ask of the threads surface */
export type ThreadsInboxEvent =
  | { type: 'SELECT_ARTIFACT'; artifactId: string }
  | { type: 'OPEN_THREAD_CHAT'; threadId: string }
  | { type: 'VIEW_THREAD'; threadId: string }
  | { type: 'SELECT_THREAD'; id: string }
  | { type: 'VIEW_DASHBOARD' }

export type Contract = {
  opens: 'Thread'
  state: ThreadsContext
  inbox: SurfaceInbox<{ pack: ThreadsInboxEvent }>
}
