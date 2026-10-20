import type { ClaudeUiMountState, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply } from '#features/code/be/services/claude-code/ui-presentation.ts';
export type * from './export-types.ts';
import { type BaseEntity, EARS, type PackShapes, type ShortCodeOf } from '#generated/ears.ts';
type Simplify<T> = { [K in keyof T]: T[K] } & {};
import type { PermissionMode } from "#features/code/be/services/claude-code/types.ts";

import type { ArtifactItem } from '@apackdev/sdk/artifacts';

// Block-based interaction system (composable architecture)
export type BlockType = string;

export interface BlockConfig {
  type: string;
  props: Record<string, any>;
}

// Tool-activity block — collapsible group of Claude Code tool calls within one turn.
// Replaces the prior per-tool `> 🔧 name` blockquote spam with a single compact
// group that shows a live status label while streaming and freezes to a summary
// line once the turn ends. See design doc in `.claude/plans/` for full rationale.
export interface ToolActivityEntry {
  /** Stable id. Usually the CLI's `tool_use_id`. */
  id: string;
  /** Tool name as reported by the CLI: Read, Write, Edit, Glob, Grep, Bash, … */
  tool: string;
  /** One-line human summary of the input (e.g. a truncated file path). */
  summary: string;
  /** Row status drives the per-row icon and label. */
  status: 'running' | 'ok' | 'denied' | 'error';
  /** Wall-clock duration once the tool has reported progress/completion. */
  durationMs?: number;
  /** One-line output summary if the tool reported one (e.g. "3 matches"). */
  outputSummary?: string;
  /** Native agent matched by structured journal identity, independent of the Agent call's launch result. */
  nativeAgent?: { id: string; ownerId?: string; sessionId?: string; name: string; status: string; statusText?: string };
  /** Exact original result row; structured output remains owned by the native process. */
  nativeResult?: { uuid: string; sessionId: string };
  /** Optional full details revealed when the row is expanded. */
  handbacks?: import('#features/code/common/native-handback.ts').ClaudeAgentHandback[];
  details?: { input?: unknown; output?: string; error?: string };
}

export interface ToolActivityBlockProps {
  /** Tool entries in arrival order. Append-only during the turn. */
  entries: ToolActivityEntry[];
  /** Live status label shown when collapsed (e.g. "Reading 3 files…"). */
  label: string;
  /** Group state — drives spinner visibility and label tense. */
  state: 'streaming' | 'done' | 'error';
  /** Initial open/closed state. User toggles win after first interaction. */
  defaultOpen?: boolean;
  /** Optional pointer to a promoted artifact (Phase C). */
  artifactRef?: { artifactId: string; label: string };
}

// Thinking block — collapsible display of extended thinking content from Claude.
export interface ThinkingBlockProps {
  /** Accumulated thinking text. */
  content: string;
  nativeMessages?: readonly import('../../../content/actions/claude-code/_helpers/thinking-types.ts').ClaudeNativeThinkingMessage[];
  /** Collapsed header label (e.g. "Thinking…" or "Thought for 3s"). */
  label: string;
  /** Block state — drives spinner visibility. */
  state: 'streaming' | 'done';
  /** Initial open/closed state. Collapsed by default. */
  defaultOpen?: boolean;
}

// Button-group block types — canonical definitions live in the SDK

export interface FileReference {
  name: string;
  path: string;
  typeLabel: string;
  isImage: boolean;
  previewUrl?: string;
}

export interface ImageReference {
  url: string;
  name: string;
}

export type ContextReferenceType = 'thread' | 'document' | 'note' | 'task' | 'tasklist' | 'folder';

export interface ContextReference {
  refType: ContextReferenceType;
  refId: string;
  shortCode: string;
  label: string;
}

export interface MessageReferences {
  images?: ImageReference[];
  files?: FileReference[];
  context?: ContextReference[];
}

/**
 * Shapes a block can emit back to the backend when the user interacts
 * with it. Non-discriminated on purpose — text and choice blocks emit
 * raw primitives on submit (TextInput.vue:207, ChoiceInput.vue:225),
 * while approval and cancel blocks emit tagged objects
 * (InteractionContainer.vue:156-167). Wrapping the primitives into
 * `{ type: 'text', value: string }` etc. would be a wire-shape break,
 * so we encode the reality instead: a union of every observed shape
 * with no synthetic discriminator.
 *
 * Consumers MUST narrow before using the value, and each narrows where it
 * reads it rather than through a shared parser. Approval is the worked
 * example: `CC: Route Response` (content/actions/claude-code/route-response.ts)
 * counts a response as a deny only when it says so —
 * `approved === false || cancelled === true` — having already established
 * that it answers the pending control request it is routing.
 *
 * When adding a new block type, extend this union first and narrow at the
 * site that reads it.
 *
 * `blockResponse?: unknown` at the storage boundary is more defensive than
 * assuming the union is exhaustive; the event-level and field-level types use
 * the union, because every emit matches one of its arms.
 */
export type BlockResponse =
  | { nativeQuestionAnswer: import('#features/code/common/native-question.ts').ClaudeQuestionAnswer; nativeQuestionRenderToken?: string; nativeQuestionDraftStarted?: boolean }
  /** Approval buttons: InteractionContainer `handleApprove`/`handleDeny`. */
  | { approved: boolean; reason?: string }
  /** Cancel path: InteractionContainer `handleCancel`. */
  | { cancelled: true }
  /** Text input (single or multiline) and single-select choice emit a raw string. */
  | string
  /** Multi-select choice emits a raw string array (of choice ids). */
  | string[];

export interface MessageEntity extends BaseEntity {
  entityType: EARS.Entity.Message;
  text: string;
  sender: 'user' | 'assistant' | 'system' | 'marker';
  timestamp: number;
  // Block-based interaction system
  responseTimestamp?: number; // Timestamp when the message was responded to
  blocks?: BlockConfig[];
  /**
   * Response data for block-based interactions. See the `BlockResponse`
   * union above for the full set of observed shapes. Always narrow
   * before use via a parse helper — the raw field is stored as the
   * exact value the frontend emitted, which may be a primitive
   * (string / string[]) or a tagged object.
   */
  blockResponse?: BlockResponse;
  forkable?: boolean;
  references?: MessageReferences;
  isCommand?: boolean;
  command?: string;
  /** Ephemeral UI state (e.g. 'queued' while waiting behind an active turn). */
  status?: 'queued' | 'cancelled' | null;
  /** Free-form per-message metadata. Feature-namespaced (e.g. `{ cliUuid: '...' }`). */
  context?: Record<string, unknown>;
  /** When true, collapse to a compact aside after the user responds. */
  autoHide?: boolean;
  /** When true, the collapsed aside aligns to the user (right) side. */
  asUser?: boolean;
  /** Backend-computed summary text shown when collapsed (e.g. "✓ Approved"). */
  asideText?: string;
  /** Caller-supplied context label for the collapsed aside (overrides auto-derived context). */
  asideContext?: string;
  /** When true, message is hidden because a marker message compacted it. */
  compacted?: boolean;
}

/**
 * Free-form per-thread scratchpad for features that need to persist small
 * amounts of state alongside a thread. Keys are namespaced by feature name
 * (e.g. `claudeCode`) so multiple features don't collide. Anything goes
 * under a feature key — this is intentionally untyped at the container
 * level so new contributors don't need to edit this file.
 */
export interface ThreadContext {
  claudeCode?: {
    sessionId?: string;
    lastTurnAt?: number;
    cwd?: string;
    // Persistent session data (single source of truth — artifact is derived)
    model?: string;
    startedAt?: number;
    turns?: number;
    totalCostUsd?: number;
    chatState?: string;
    toolCallCount?: number;
    permissionMode?: string;
    useWorktree?: boolean;
    sessionError?: string;
    [key: string]: unknown;
  };
  [featureKey: string]: unknown;
}

/**
 * The fields a thread declares, which apack.json names as Thread's shape. Its short code is not one of them: the
 * engine numbers it from the prefix Thread's entry declares, and the generated facade adds it to the row
 */
export interface ThreadShape extends BaseEntity {
  entityType: EARS.Entity.Thread;
  topic: string;
  instructions: string;
  sideTopics?: string[];
  timestamp: number;
  lastMessageTimestamp?: number;
  lastVisitedTimestamp?: number;
  status: string; // Dynamic statuses from settings
  tags?: string[]; // Tag names from settings
  forcedMode?: string; // Forced mode name for this thread
  pinned?: boolean; // Thread tab should stay pinned in the UI
  archived?: boolean; // Thread is archived and hidden from lists
  chatState?: string; // Chat state indicator (idle, working, paused, error, success)
  context?: ThreadContext; // Free-form per-feature state (e.g. claudeCode.sessionId)
}

export interface ArtifactEntity extends BaseEntity {
  /** Optional display colour, set when the artifact is created. */
  color?: string;
  entityType: EARS.Entity.Artifact;
  title?: string;
  // biome-ignore lint/suspicious/noExplicitAny: Content can be various types
  content: string | any;
  artifactType: ArtifactType;
}

/** The kinds a thread links to another thread with, which the link form offers */
export const ThreadRelations = [EARS.RelKind.PARENT_OF, EARS.RelKind.BLOCKS, EARS.RelKind.BLOCKED_BY, EARS.RelKind.DUPLICATES] as const;
export type ThreadLinkRelation = typeof ThreadRelations[number];

export type ThreadLinkItem = Pick<ThreadEntity, 'id' | 'status' | 'timestamp' | 'topic'> & {
  shortCode: ThreadTypeShortCode;
  relation: ThreadLinkRelation
};

export type ThreadEditFields = Simplify<
  Pick<ThreadEntity, 'topic' | 'instructions'>
  & { status?: ThreadEntity['status'] }
  & { tags?: string[] }  // Just tag names
  & { context?: ThreadContext }  // Free-form per-feature state (see ThreadContext)
  & ThreadLinkedFields
>;
export type ThreadLinkedFields = {
  linkedThreads?: ThreadLinkItem[];
}

export type ThreadCreateData = Simplify<
  ThreadEditFields
  & {
    role?: EARS.RoleKind;  // Optional role to grant (e.g., for special threads like birth)
    forcedMode?: string;  // Optional forced mode name for special threads
    pinned?: boolean;  // Pin the thread tab in the UI
  }
>;
export type ThreadViewData = Simplify<
  ThreadCreateData
  & {
    id: ThreadEntity['id'];
    /** `''` while the view holds a thread not yet created */
    shortCode: ThreadTypeShortCode | '';
    status: ThreadEntity['status'];
    timestamp: ThreadEntity['timestamp'];
    archived?: ThreadEntity['archived'];
    lastMessageTimestamp?: ThreadEntity['lastMessageTimestamp'];
    messages?: ThreadExtendedData['messages'];
  }
>;

export type ThreadExtended = Simplify<ThreadEntity & ThreadExtendedData & { parentId?: string }>;
export type ThreadExtendedData = ThreadLinkedFields & {
  messages?: Partial<MessageEntity>[];
  tags?: string[];  // Tag names from thread entity
  // Core fields included so SET_VIEW_DATA can populate the view even when
  // the thread isn't in the frontend's context.threads list.
  topic?: string;
  instructions?: string;
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  shortCode?: ThreadTypeShortCode;
  timestamp?: number;
  lastMessageTimestamp?: number;
}

/** A thread as a read gives it back: its declared fields and its short code */
export type ThreadEntity = PackShapes['Thread'];

/** A thread's short code, `THR-<n>`: the engine numbers it with the prefix Thread's apack.json entry declares */
export type ThreadTypeShortCode = ShortCodeOf<'Thread'>;

export type ThreadConnectedData = {
  threads: ThreadExtended[];
  availableTags: ThreadTagOption[];  // Tags from settings
  settings?: ThreadsSettings | null; // Full thread settings
  chatStates?: Record<string, string>;
}

// ---- Chat/Agent types (merged from agent system) ----

export type AgentThreadData = {
  id?: ThreadEntity['id'];
  shortCode?: ThreadTypeShortCode;
  topic: ThreadEntity['topic'];
  instructions: ThreadEntity['instructions'];
  status: ThreadEntity['status'];
  timestamp: ThreadEntity['timestamp'];
  messages: ThreadExtendedData['messages'];
  artifacts: ArtifactEntity[];
  forcedMode?: ThreadEntity['forcedMode'];
  pinned?: boolean;
  chatState?: string;
  context?: ThreadContext;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export type RecentThreadRefreshData = {
  recentThreads: Partial<ThreadEntity>[];
};

export type AgentConnectedData = {
  currentThread: AgentThreadData | null;
  threads: Partial<ThreadEntity>[];
  recentThreads: Partial<ThreadEntity>[];
  tabs: Tab[];
  settings?: AgentSettings;
};


export interface Tab {
  id: string;
  label: string;
  artifacts: ArtifactItem[];
  selectedArtifactId?: string;
  pinned?: boolean;
  groupId?: string;
}

export type ArtifactType = string;

// ─── Claude Code artifact content shapes ─────────────────────────────────────
// Documentation types — `ArtifactEntity.content` is `any` at the storage
// layer, these shapes just describe the expected payload for each artifact
// so renderers can be written against a known structure.

export interface ClaudeSessionArtifactContent {
  /** Claude CLI session id (empty string until the first system/init event). */
  sessionId: string;
  /** Model name reported by the CLI ("claude-sonnet-4-6" etc.). */
  model: string;
  /** Working directory the CLI is running in. */
  cwd: string;
  /** Epoch ms when the session artifact was created. */
  startedAt: number;
  /** Epoch ms of the most recent turn. */
  lastTurnAt: number;
  /** Number of turns executed in this session. */
  turns: number;
  /** Running cost total in USD across all turns. */
  totalCostUsd: number;
  /** High-level chat state. Drives the status indicator and pause button. */
  chatState: 'idle' | 'working' | 'paused';
  /** Total tool calls across all turns in this session. */
  toolCallCount: number;
  /** Last 3 tools executed (rolling window, most recent last). */
  recentTools?: Array<{ name: string; summary: string; at: number }>;
  /**
   * Permission policy for the next turn. Mutated by the user via the
   * session artifact's segmented control in the right panel and read by
   * `chat.ts` at action entry. The three useful values are:
   *   - `'default'` — CLI emits `can_use_tool` per Edit/Write/Bash (Ask mode)
   *   - `'acceptEdits'` — CLI auto-approves Edit/Write (Auto mode); Bash still prompts
   *   - `'plan'` — read-only; CLI produces a plan, makes no file changes
   * Other `PermissionMode` variants are allowed by the type but not
   * surfaced in the UI. Optional for backwards compat with artifacts
   * persisted before this field existed; readers coalesce to `'default'`.
   */
  permissionMode?: PermissionMode;
  /** Threshold percentages that have already fired an alert (avoids re-alerting). */
  alertedThresholds?: number[];
  /** Full context usage breakdown from CLI `/context` query (populated after each turn). */
  contextUsage?: {
    model: string;
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    categories: Array<{ name: string; tokens: number; percentage: number }>;
    memoryFiles?: Array<{ type: string; path: string; tokens: number }>;
    skills?: Array<{ name: string; source: string; tokens: number }>;
  };
}

export interface DiffArtifactContent {
  files: Array<{
    path: string;
    /** Unified diff text for this file. */
    patch: string;
    added: number;
    removed: number;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  }>;
  /** Aggregate summary e.g. "12 files, +420 -87". */
  summary: string;
}

/** A plan artifact's status: the plan-approval block moves it from draft */
export type PlanStatus = 'draft' | 'approved' | 'in-progress' | 'completed' | 'rejected';

/** A plan artifact's content, as the plan action helper writes it and the plan viewer reads it */
export interface PlanArtifactContent {
  /** Raw markdown notes body. Phase D-min uses this as the only content field. */
  notes: string;
  /** Overall plan status. Approve/Reject buttons mutate this. */
  status: PlanStatus;
  /** Structured steps. Phase D-min leaves this empty; full Phase D will parse from notes. */
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'in-progress' | 'done' | 'skipped';
  }>;
  /** Git branch the plan was created on. */
  branch?: string;
  /** PR number associated with this plan. */
  prNumber?: string;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export interface AgentPhase {
  id: string;
  name: string;
  description: string;
  color?: string; // optional hex (e.g. '#3B82F6') — tints the chat phase selector
}

export interface AgentMode {
  id: string;
  name: string;
  description: string;
  phases?: AgentPhase[];
  hidden?: boolean;
  disabled?: boolean;
}

export interface QuickPrompt {
  id: string;
  text: string;
}

// ── Settings types ────────────────────────────────────────────────────────

export interface ThreadStatusOption {
  label: string;
  color: string; // Hex color value
}

export interface ThreadTagOption {
  name: string;
  color?: string; // Optional hex color value
}

export interface ChatStateConfig {
  id: string;
  label: string;
  color: string;
  busy: boolean;
}

export type ThreadsSettings = import('#generated/settings.ts').SettingsOf<'threads'>;

export type AgentSettings = ThreadsSettings['chat'];

// System-private entity type

export type ClaudeUiMountRequest = { type: 'CLAUDE_UI_MOUNT'; promptFocused: boolean; threadId: string; mountId: string; resumeKey?: string; nativeView?: import('#features/code/common/native-terminal.ts').ClaudeNativeAgentUiTarget; messageIds?: string[]; userExpansion?: Record<string, boolean>; blockExpansion?: Record<string, number[]> }

export type ClaudeUiViewRequest =
  | { type: 'CLAUDE_UI_COMMAND_PANEL'; threadId: string; mountId: string; revision: number; panelId: string; text?: string }
  | { type: 'CLAUDE_UI_COMMAND_DECISION'; threadId: string; mountId: string; revision: number; commandId: string; decision: 'confirm' | 'cancel' }
  | { type: 'CLAUDE_UI_AGENT_INPUT'; threadId: string; mountId: string; revision: number; text: string }
  | ({ type: 'CLAUDE_PROMPT_HOST_RESPONSE'; threadId: string; mountId: string } & import('#generated/types.ts').ClaudePromptHostResponse)
  | ({ type: 'CLAUDE_UI_FOCUS'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusEvent)
  | ({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE'; threadId: string; mountId: string } & ClaudePromptCompletionRequest)
  | ({ type: 'CLAUDE_PROMPT_EDIT'; threadId: string; mountId: string } & ClaudePromptEdit)
  | ({ type: 'CLAUDE_UI_NOTICE'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiNoticeEvent)
  | ({ type: 'CLAUDE_UI_SCROLL'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiScrollEvent)
  | ({ type: 'CLAUDE_UI_PANE'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiPaneEvent)
  | ClaudeUiMountRequest
  | { type: 'CLAUDE_UI_UNMOUNT'; threadId: string; mountId: string; resumeKey?: string }
  | ({ type: 'CLAUDE_UI_CLIENT'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiClientEvent)
  | ({ type: 'CLAUDE_UI_FIELD'; threadId: string; mountId: string } & import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFieldEvent)
  | { type: 'CLAUDE_UI_PRESS'; threadId: string; mountId: string; actionId: string; href?: string };

export type IncomingThreadsEvents =
  | import('./claude-terminal-views.ts').ClaudeTerminalViewRequest
  | ClaudeUiViewRequest
  // Thread management events
  | { type: 'CREATE_THREAD'; topic: string; tags?: string[]; instructions: string; linkedThreads?: { id: string; relation: ThreadLinkRelation }[]; parentThreadId?: string }
  | { type: 'VIEW_THREAD'; threadId: string }
  | { type: 'UPDATE_THREAD_STATUS'; threadId: string; status: string }
  | { type: 'UPDATE_THREAD_FIELD'; threadId: string; key: string; value: any }
  | { type: 'DELETE_THREAD'; threadId: string }
  | { type: 'SET_THREAD_PARENT'; childIds: string[]; parentId: string }
  | { type: 'EXPORT_THREADS'; directory: string }
  | { type: 'IMPORT_THREADS'; directory: string }
  // Chat/agent events (merged from agent system)
  | { type: 'USER_MSG'; text: string; mode?: string; phase?: string; threadId?: string; references?: { images?: { url: string; name: string }[]; files?: { name: string; path: string; typeLabel: string; isImage: boolean }[]; context?: { refType: 'thread' | 'document' | 'note' | 'task' | 'tasklist' | 'folder'; refId: string; shortCode: string; label: string }[] }; cwdOverride?: string; forceDirectoryPicker?: boolean }
  | { type: 'OPEN_THREAD_CHAT'; threadId: string; restore?: boolean }
  | { type: 'OPEN_THREAD_TAB'; threadId: string; label: string; pinned?: boolean }
  | { type: 'PAUSE_TURN'; threadId: string }
  | { type: 'INTERACTIVE_MSG_RESPONSE'; messageId: string; threadId: string; response: any }
  | { type: 'FORK_THREAD'; messageId: string; threadId?: string; threadTopic?: string }
  | { type: 'REVERT_THREAD'; messageId: string; threadId: string; restoreFiles?: boolean; userCliUuid?: string }
  | { type: 'SUMMARIZE_THREAD'; messageId: string; threadId: string }
  | { type: 'USER_COMMAND'; command: string; text: string; mode?: string; phase?: string; threadId?: string; references?: { images?: { url: string; name: string }[]; files?: { name: string; path: string; typeLabel: string; isImage: boolean }[]; context?: { refType: 'thread' | 'document' | 'note' | 'task' | 'tasklist' | 'folder'; refId: string; shortCode: string; label: string }[] }; cwdOverride?: string }
  | { type: 'TOGGLE_COMPACTED'; markerId: string; compacted: boolean }
  | { type: 'DELETE_MESSAGE'; messageId: string }
  | { type: 'SET_CLAUDE_PERMISSION_MODE'; threadId: string; mode: PermissionMode }
  | { type: 'FORWARD_BRAIN_EVENT'; eventType: string; payload?: any }
  | { type: 'GET_ARCHIVED_THREADS' }
  | { type: 'REFRESH_THREADS' }
  | { type: 'LOAD_MORE_MESSAGES'; threadId: string; cursor: string }

  | { type: 'CLIENT_CONNECTED' }
  | { type: 'THREAD_DELETED'; threadId: string }

export type OutgoingThreadsEvents =
  | { type: 'CLAUDE_PERMISSION_MODE_RESULT'; threadId: string; success: boolean; reason?: string }
  | import('./claude-terminal-views.ts').ClaudeTerminalViewReply
  | { type: 'CLAUDE_PROMPT_COMPLETIONS'; threadId: string; mountId: string; result: ClaudePromptCompletionReply }
  | { type: 'CLAUDE_PROMPT_STATE'; threadId: string; mountId: string; result: ClaudePromptReply }
  | { type: 'CLAUDE_PROMPT_HOST_REQUEST'; threadId: string; mountId: string; request: import('#generated/types.ts').ClaudePromptHostRequest }
  | { type: 'CLAUDE_UI_FOCUS_STATE'; threadId: string; mountId: string; result: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusReply }
  | { type: 'CLAUDE_UI_STATE'; threadId: string; mountId: string; resumeKey: string; attachmentId?: string; state: ClaudeUiMountState }
  | { type: 'CLAUDE_UI_LEASE_EXPIRED'; threadId: string; mountId: string; resumeKey: string }
  // Thread management events
  | { type: 'THREAD_CONNECTED'; data: ThreadConnectedData }
  | { type: 'SET_VIEW_DATA', id: EARS.EntityId, data: ThreadExtendedData }
  | { type: 'THREAD_CREATED', id: EARS.EntityId, shortCode: string, entityType: EARS.Entity, timestamp: number, topic?: string, instructions?: string, status?: string }
  | { type: 'THREAD_UPDATED', threadId: string, updates: Partial<Pick<ThreadEntity, 'status' | 'tags' | 'context' | 'pinned' | 'topic' | 'instructions'>> }
  | { type: 'THREAD_DELETED', threadId: string }
  | { type: 'THREADS_EXPORTED'; filePath: string; threadCount: number }
  | { type: 'THREADS_EXPORT_FAILED'; errors: string[] }
  | { type: 'THREADS_IMPORTED'; count: number; errors?: string[] }
  | { type: 'THREADS_IMPORT_FAILED'; errors: string[] }
  | { type: 'ARCHIVED_THREADS_DATA'; threads: Partial<ThreadEntity>[] }
  // Chat/agent events (merged from agent system)
  | { type: 'AGENT_CONNECTED'; data: AgentConnectedData }
  | { type: 'LOAD_CHAT_THREAD', data: AgentThreadData, restore?: boolean }
  | { type: 'REFRESH_RECENT_THREADS'; data: RecentThreadRefreshData }
  | { type: 'ARTIFACT_ADDED'; tabId: string; artifact: any }
  | { type: 'ARTIFACT_UPDATED'; tabId: string; artifact: any }
  | { type: 'THREAD_TAB_REQUESTED'; threadId: string; topic: string; artifacts: any[]; pinned?: boolean }
  | { type: 'AGENT_SETTINGS_UPDATED'; settings: AgentSettings }
  | { type: 'UPDATE_MESSAGE_STATE'; messageId: string; references?: MessageReferences; text?: string; blocks?: BlockConfig[]; responseTimestamp?: number; blockResponse?: BlockResponse; forkable?: boolean; status?: 'queued' | 'cancelled' | null; context?: Record<string, unknown>; asideText?: string; asideContext?: string; compacted?: boolean }
  | { type: 'MESSAGE_ADDED'; threadId: string; message: MessageEntity }
  | { type: 'SET_MODE'; mode: string }
  | { type: 'SET_PHASE'; phase: string; threadId?: string; source?: 'native' }
  | { type: 'SET_CHAT_STATE'; threadId: string; chatState: string }
  | { type: 'FLASH_CHAT_STATE'; threadId: string; stateId: string; durationMs?: number }
  | { type: 'THREAD_CHAT_ERROR'; threadId: string; error: string }
  | { type: 'OLDER_MESSAGES_LOADED'; threadId: string; messages: Partial<MessageEntity>[]; hasMore: boolean; nextCursor: string | null }

export interface ThreadsContext {}
