/**
 * Helpers for reading/writing `thread.context.claudeCode` and toggling
 * the `claude-code` tag.
 *
 * The Thread entity carries a free-form `context` field (see
 * `packages/api/src/systems/threads/types.ts` → `ThreadContext`). Claude
 * Code parks its per-thread session state under `context.claudeCode` so the
 * chat action can resume the right conversation on subsequent turns.
 *
 * The `claude-session` artifact is a **type marker only** — it exists so the
 * artifact list shows a session card, but its content is empty. All session
 * data lives here on thread context; the frontend reads it via
 * `THREAD_UPDATED` events.
 */

import type { Services, EntityId } from '../../../types';
import { resolvePlanDraft } from './plan-artifact';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Local mirror of `PermissionMode` (from `@/services/claude-code/types` on
 * the backend). Duplicated here so helper files in this folder can typecheck
 * without reaching across package boundaries.
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'auto';

/** Unified chat state used in backend events and on the frontend. */
export type ChatState = 'idle' | 'working' | 'paused' | 'error' | 'success';

export interface QueuedMessage {
  text: string;
  mode?: string;
  phase?: string;
  /** User message entity ID — for clearing the 'queued' status indicator on drain. */
  messageId?: string;
  /** Attached references (images, files, context) — preserved so they survive queuing. */
  references?: any;
}

export interface PendingControlRequest {
  /** The CLI's request_id for the control_response. */
  requestId: string;
  /** The messageId of the approval/choice block sent to the user. */
  approvalMessageId: string;
  /** The tool name from the control_request. */
  toolName: string;
  /** The original input from the control_request, echoed back on allow responses. */
  originalInput?: Record<string, unknown>;
}

export interface ClaudeCodeThreadState {
  sessionId?: string;
  /** History of previous sessionIds (oldest first), populated when compaction/fork/revert replaces the active session. */
  previousSessionIds?: string[];
  lastTurnAt?: number;
  /** Working directory for the Claude Code session. */
  cwd?: string;

  // ─── Persistent session data (single source of truth) ──────────────
  /** Model name reported by the CLI ("claude-sonnet-4-6" etc.). */
  model?: string;
  /** Epoch ms when the session was first created. */
  startedAt?: number;
  /** Number of turns executed in this session. */
  turns?: number;
  /** Running cost total in USD across all turns. */
  totalCostUsd?: number;
  /** High-level chat state. Drives the status indicator and pause button. */
  chatState?: ChatState;
  /** Total tool calls across all turns in this session. */
  toolCallCount?: number;
  /** The most recent tool the agent used (for the sidebar summary line). */
  lastTool?: { name: string; summary: string; at: number };
  /** Last 3 tools executed (rolling window, most recent last). */
  recentTools?: Array<{ name: string; summary: string; at: number }>;
  /** Permission policy for the next turn. */
  permissionMode?: PermissionMode;
  /** Whether to run in a git worktree for isolated file mutations. */
  useWorktree?: boolean;
  /** Whether the current sessionId was created with --worktree. */
  sessionWorktree?: boolean;
  /** Human-readable error when the session is broken (e.g. JSONL deleted). */
  sessionError?: string;
  /** Threshold percentages that have already fired an alert (avoids re-alerting). */
  alertedThresholds?: number[];
  /** Full context usage breakdown from CLI `/context` query. */
  contextUsage?: any;

  // ─── Ephemeral coordination state ──────────────────────────────────
  /** True while a chat action invocation is actively running on this thread. */
  isRunning?: boolean;
  /** True while a non-streaming command (e.g. CC: Compact) owns chatState. Prevents Turn Completed from overwriting it with 'success'. */
  commandActive?: boolean;
  /** Message waiting to be processed after the current turn ends. */
  queuedMessage?: QueuedMessage;
  /**
   * Set when the CLI emits a `control_request` and we've sent an approval
   * block to the user. "CC: Route Response" reads this to match the user's
   * response back to the right CLI request_id. Cleared after the response
   * is routed.
   */
  pendingControlRequest?: PendingControlRequest;
  /**
   * Set when the chat action detects no CWD is configured and sends a
   * directory-picker block. Stores the original message params so the
   * query can be retried after the user picks a directory.
   */
  pendingDirectorySelect?: {
    pickerMessageId: string;
    text: string;
    mode?: string;
    phase?: string;
    model?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    systemPrompt?: string;
    messageId?: string;
    references?: any;
  };
  /**
   * Set mid-turn when the user checks "Auto-accept file edits" on an
   * approval block. The stream-consumer reads this to auto-approve
   * remaining file mutation control_requests in the current turn.
   */
  autoAcceptEdits?: boolean;
  /**
   * One-shot flag set by CC: Handle Fork. When present, the next chat action
   * invocation passes `forkSession: true` to the CLI so it creates a new
   * session JSONL file instead of appending to the source session. Cleared
   * after the query starts.
   */
  forkFrom?: { sessionId: string; cliUuid?: string };
  /**
   * Set by the backend forkThread action before navigation. While true,
   * the chat action queues incoming messages until handle-fork finishes
   * persisting session state (sessionId, forkFrom, cwd). Cleared by
   * CC: Handle Fork after state is ready.
   */
  forkPending?: boolean;
  /**
   * One-shot flag set by CC: Handle Revert. When present, the next chat
   * action passes `--resume-session-at <cliUuid> --fork-session` to the CLI
   * so it creates a new session truncated to the revert point. Cleared after
   * the query starts.
   */
  revertTo?: { cliUuid: string };
  /** Additional working directories added via /cc-add-dir. Passed as --add-dir on every query. */
  additionalDirs?: string[];
  /** Pre-set CWD from "new thread in project" menu. Consumed on first message, then cleared. */
  cwdOverride?: string;
  /** When true, force the directory picker on first message regardless of global defaultBaseDirectory. */
  forceDirectoryPicker?: boolean;
  /** Active goal-loop state. Set by CC: Goal, cleared on met/failed/clear. */
  goal?: {
    condition: string;
    setAt: number;
    status: 'active' | 'met' | 'failed';
    iterations: number;
    /** Permission mode before auto-elevation, restored when goal ends. */
    prevPermissionMode?: PermissionMode;
  };
}

export const CLAUDE_CODE_TAG = 'claude-code';

// ─── Core read/write ─────────────────────────────────────────────────────────

/** Set the global project directory used by Claude Code sessions. */
export function setProjectDirectory(services: Services, directory: string): void {
  services.settings.updatePluginSetting('code', ['defaultBaseDirectory'], directory);
}

/** Read the Claude Code state stashed on a thread. Returns `undefined` if none. */
export function getClaudeState(services: Services, threadId: string): ClaudeCodeThreadState | undefined {
  const thread = services.repository.threadQueries.byId(threadId as any) as any;
  return thread?.context?.claudeCode as ClaudeCodeThreadState | undefined;
}

/**
 * Persist a sessionId onto a thread (merging with any existing `context`)
 * and add the `claude-code` tag if missing. Idempotent.
 */
export function persistClaudeState(
  services: Services,
  threadId: string,
  state: ClaudeCodeThreadState,
): void {
  const thread = services.repository.threadQueries.byId(threadId as any) as any;
  if (!thread) return;

  const existing = (thread.context?.claudeCode || {}) as ClaudeCodeThreadState;

  // Auto-track session history when sessionId changes (compact/fork/revert).
  if (state.sessionId && existing.sessionId && state.sessionId !== existing.sessionId) {
    const prev = existing.previousSessionIds ?? [];
    if (!prev.includes(existing.sessionId)) {
      state = { ...state, previousSessionIds: [...prev, existing.sessionId] };
    }
  }

  const nextContext = {
    ...(thread.context || {}),
    claudeCode: { ...existing, ...state },
  };

  const existingTags: string[] = Array.isArray(thread.tags) ? thread.tags : [];
  const nextTags = existingTags.includes(CLAUDE_CODE_TAG)
    ? existingTags
    : [...existingTags, CLAUDE_CODE_TAG];

  const tagAdded = !existingTags.includes(CLAUDE_CODE_TAG);

  services.repository.threadCommands.update(threadId as any, {
    context: nextContext,
    tags: nextTags,
  });

  // Notify frontend so thread context is always in sync.
  services.emitter.sendToPlugin('threads', {
    type: 'THREAD_UPDATED',
    threadId,
    updates: {
      ...(tagAdded ? { tags: nextTags } : {}),
      context: nextContext,
    },
  });
}

// ─── Writers ─────────────────────────────────────────────────────────────────

/**
 * Merge a patch into the thread's Claude Code state. The frontend receives
 * the update via `THREAD_UPDATED` (emitted by `persistClaudeState`).
 *
 * The patch can be a plain object or a function that receives the current
 * state and returns the delta (useful for counters that need read-modify-write).
 */
export function updateClaudeState(
  services: Services,
  threadId: EntityId,
  patch: Partial<ClaudeCodeThreadState> | ((prev: ClaudeCodeThreadState) => Partial<ClaudeCodeThreadState>),
): boolean {
  const state = getClaudeState(services, threadId as string);
  if (!state) return false;

  const prev = state as ClaudeCodeThreadState;
  const delta = typeof patch === 'function' ? patch(prev) : patch;

  persistClaudeState(services, threadId as string, delta as any);
  return true;
}

/**
 * Ensure a claude-session artifact exists for the thread (type marker only).
 * The artifact has empty content — all session data lives on thread context.
 * This marker makes the artifact list show a session card in the UI.
 */
export function ensureSessionMarker(services: Services, threadId: EntityId): EntityId {
  const { artifactId } = services.artifact.findOrCreateByType(
    threadId,
    'claude-session',
    { title: 'Claude Code session', content: {}, color: 'purple' },
  );
  return artifactId;
}

/**
 * Map from chat-state to the kanban thread-status it implies.
 * `idle` and `error` are intentionally absent — they have no
 * meaningful kanban column equivalent.
 */
const CHAT_STATE_TO_STATUS: Partial<Record<ChatState, string>> = {
  working: 'In Progress',
  paused: 'In Review',
  success: 'Done',
};

/**
 * Update the chat state on the thread AND push a real-time event to the
 * frontend threads plugin. This is the single call site for chat state
 * transitions.
 *
 * Also syncs the thread's kanban status when the chat state implies a
 * specific column (e.g. working → "In Progress").
 */
export function updateChatState(
  services: Services,
  threadId: EntityId,
  chatState: ChatState,
): void {
  persistClaudeState(services, threadId as string, { chatState });
  services.threads.updateChatState(threadId, chatState);

  // Sync kanban status when chat state implies a specific column.
  const targetStatus = CHAT_STATE_TO_STATUS[chatState];
  if (targetStatus) {
    const thread = services.repository.threadQueries.byId(threadId as any) as any;
    if (thread && thread.status !== targetStatus) {
      services.emitter.sendToSystem('threads', {
        type: 'UPDATE_THREAD_STATUS',
        threadId: threadId as string,
        status: targetStatus,
        userInduced: false,
      } as any);
    }
  }
}

/**
 * Detect "No conversation found with session ID" from a CLI error message.
 * Returns the extracted session ID or undefined.
 */
export function extractStaleSessionId(errorMessage: string): string | undefined {
  // Direct "session not found" message from the CLI
  const match = errorMessage.match(/No conversation found with session ID:?\s*(\S+)/i);
  if (match) return match[1];
  // Message UUID not found during --resume-session-at (fork/revert)
  const uuidNotFound = errorMessage.match(/No message found with message\.uuid of:?\s*(\S+)/i);
  if (uuidNotFound) return uuidNotFound[1];
  // Generic resume failure (corrupt JSONL, OOM, etc.) — try to extract a UUID
  if (/Failed to resume session/i.test(errorMessage)) {
    const uuidMatch = errorMessage.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return uuidMatch?.[1];
  }
  return undefined;
}

/**
 * Mark the session as broken: set chatState to 'error', store the error
 * message, and clear the sessionId so the next turn starts fresh.
 */
export function markSessionBroken(
  services: Services,
  threadId: EntityId,
  errorMessage: string,
): void {
  persistClaudeState(services, threadId as string, {
    sessionError: errorMessage,
    sessionId: undefined,
    sessionWorktree: undefined,
  });
  updateChatState(services, threadId, 'error');
}

// ─── Goal helpers ────────────────────────────────────────────────────────────

/**
 * End an active goal: restore the prior permission mode and either update the
 * goal status (met/failed — kept for UI display) or remove it entirely
 * (explicit clear).
 */
export function endGoal(
  services: Services,
  threadId: string,
  status: 'met' | 'failed' | undefined,
): void {
  const state = getClaudeState(services, threadId);
  if (!state?.goal) return;
  const restore = state.goal.prevPermissionMode ?? 'default';
  if (status) {
    persistClaudeState(services, threadId, {
      goal: { ...state.goal, status },
      permissionMode: restore,
    });
  } else {
    persistClaudeState(services, threadId, {
      goal: undefined,
      permissionMode: restore,
    });
  }
}

// ─── Concurrency helpers ─────────────────────────────────────────────────────
// Used by chat.ts to serialize turns on the same thread. State is persisted to
// thread.context.claudeCode so it survives across compiled-action scopes.

/** Mark whether a chat action is currently running on this thread. */
export function setRunning(services: Services, threadId: string, running: boolean): void {
  persistClaudeState(services, threadId, { isRunning: running });
}

/**
 * Queue a message for processing after the current turn ends. Last write
 * wins (burst debounce) — if a prior message was already queued on this
 * thread, mark its status as 'cancelled' so the user sees the "Queued"
 * indicator flip to "Cancelled — resend" instead of silently overwriting
 * and leaving a misleading amber pulse on a message that will never run.
 */
export function enqueueMessage(services: Services, threadId: string, msg: QueuedMessage): void {
  const prior = getClaudeState(services, threadId);
  const prevMessageId = prior?.queuedMessage?.messageId;
  if (prevMessageId && prevMessageId !== msg.messageId) {
    services.chat.updateMessageState(prevMessageId as any, { status: 'cancelled' } as any);
  }
  persistClaudeState(services, threadId, { queuedMessage: msg });
}

/** Pop the queued message (if any) and clear it from the thread context. */
export function dequeueMessage(services: Services, threadId: string): QueuedMessage | undefined {
  const prior = getClaudeState(services, threadId);
  const msg = prior?.queuedMessage;
  if (msg) {
    persistClaudeState(services, threadId, { queuedMessage: undefined });
  }
  return msg;
}

/**
 * Kill the CLI handle, invalidate any pending interactive block, resolve
 * plan drafts, and clear all mid-turn flags. Shared by pause-turn, deny-tool,
 * and the stale-turn cleanup in chat.ts.
 */
export function killTurn(services: Services, threadId: string): void {
  const log = services.logger;
  const prior = getClaudeState(services, threadId);

  log.info('[killTurn] entered', {
    threadId,
    hasPrior: !!prior,
    isRunning: prior?.isRunning ?? null,
    pendingToolName: prior?.pendingControlRequest?.toolName ?? null,
    approvalMessageId: prior?.pendingControlRequest?.approvalMessageId ?? null,
  });

  // Kill CLI subprocess.
  const handle = (services.cli as any).claudeCode.getHandle(threadId);
  if (handle) {
    try { handle.kill(); } catch { /* already gone */ }
    (services.cli as any).claudeCode.clearHandle(threadId);
  }

  // Reject plan draft if killed during ExitPlanMode approval.
  if (prior?.pendingControlRequest?.toolName === 'ExitPlanMode') {
    log.info('[killTurn] rejecting plan draft for ExitPlanMode', { threadId });
    resolvePlanDraft(services, threadId as EntityId, 'rejected');
  }

  // Invalidate the stale interactive block so it's greyed out in the UI.
  if (prior?.pendingControlRequest) {
    log.info('[killTurn] invalidating approval block', {
      threadId,
      approvalMessageId: prior.pendingControlRequest.approvalMessageId,
    });
    services.chat.updateMessageState(prior.pendingControlRequest.approvalMessageId as any, {
      responseTimestamp: Date.now(),
      blockResponse: { cancelled: true },
    } as any);
  }

  // Invalidate queued message so the user knows to resend.
  const queued = dequeueMessage(services, threadId);
  if (queued?.messageId) {
    services.chat.updateMessageState(queued.messageId as any, { status: 'cancelled' } as any);
  }

  // Clear all mid-turn flags.
  persistClaudeState(services, threadId, {
    pendingControlRequest: undefined,
    pendingDirectorySelect: undefined,
    autoAcceptEdits: undefined,
    isRunning: false,
  });
}

/**
 * Clear Claude Code state from a thread and remove the `claude-code` tag.
 * Used by the reset action.
 */
export function clearClaudeState(services: Services, threadId: string): void {
  const thread = services.repository.threadQueries.byId(threadId as any) as any;
  if (!thread) return;

  const nextContext = { ...(thread.context || {}) };
  delete nextContext.claudeCode;

  const existingTags: string[] = Array.isArray(thread.tags) ? thread.tags : [];
  const nextTags = existingTags.filter((t) => t !== CLAUDE_CODE_TAG);

  const tagRemoved = existingTags.includes(CLAUDE_CODE_TAG);

  services.repository.threadCommands.update(threadId as any, {
    context: nextContext,
    tags: nextTags,
  });

  // Notify frontend so tag filters update without a page refresh
  if (tagRemoved) {
    services.emitter.sendToPlugin('threads', {
      type: 'THREAD_UPDATED',
      threadId,
      updates: { tags: nextTags },
    });
  }
}
