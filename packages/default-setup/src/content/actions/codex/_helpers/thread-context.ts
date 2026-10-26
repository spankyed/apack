/** Helpers for reading/writing `thread.context.codex`. */

import type { Services, EntityId } from '#generated/services.ts';

export type ChatState = 'idle' | 'working' | 'paused' | 'error' | 'success';

export interface QueuedMessage {
  text: string;
  mode?: string;
  phase?: string;
  messageId?: string;
  references?: any;
}

export interface PendingApproval {
  /** JSON-RPC request ID from the app-server — needed for respondToApproval. */
  requestId: number;
  /** The approval method (item/commandExecution/requestApproval or item/fileChange/requestApproval). */
  method: string;
  /** The messageId of the approval block shown to the user. */
  approvalMessageId: string;
  /** Human-readable summary (command line or file path). */
  summary?: string;
  /** Reason from the server. */
  reason?: string;
}

export interface CodexThreadState {
  /** Codex app-server thread ID — for resume. */
  threadId?: string;
  /** Active turn ID — for interrupt. */
  turnId?: string;
  /** Current apack assistant message receiving Codex stream updates. */
  activeMessageId?: string;
  lastTurnAt?: number;
  cwd?: string;
  model?: string;
  approvalMode?: 'user' | 'auto_review';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  networkAccess?: boolean;
  webSearch?: 'live' | 'cached' | 'disabled';
  startedAt?: number;
  turns?: number;
  totalTokens?: { input: number; output: number; reasoning?: number };
  chatState?: ChatState;
  toolCallCount?: number;
  recentTools?: Array<{ name: string; summary: string; at: number }>;
  sessionError?: string;
  isRunning?: boolean;
  /** Set by backend forkThread; cleared by CDX: Handle Fork after state is ready. */
  forkPending?: boolean;
  queuedMessage?: QueuedMessage;
  pendingApproval?: PendingApproval;
  pendingDirectorySelect?: {
    pickerMessageId: string;
    text: string;
    mode?: string;
    phase?: string;
    model?: string;
    messageId?: string;
    references?: any;
  };
  additionalDirs?: string[];
  cwdOverride?: string;
  forceDirectoryPicker?: boolean;
  goal?: {
    objective: string;
    status: 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited' | 'complete';
    tokenBudget?: number;
    tokensUsed?: number;
    objectiveEdited?: boolean;
    continuationTurns?: number;
  };
}

const CODEX_TAG = 'codex';

export function getCodexState(services: Services, threadId: string): CodexThreadState | undefined {
  const thread = services.repository.threadQueries.byId(threadId as any) as any;
  return thread?.context?.codex as CodexThreadState | undefined;
}

export function persistCodexState(services: Services, threadId: string, state: CodexThreadState): void {
  const thread = services.repository.threadQueries.byId(threadId as any) as any;
  if (!thread) return;

  const existing = (thread.context?.codex || {}) as CodexThreadState;
  const nextContext = { ...thread.context, codex: { ...existing, ...state } };

  const existingTags: string[] = Array.isArray(thread.tags) ? thread.tags : [];
  const tagAdded = !existingTags.includes(CODEX_TAG);
  const nextTags = tagAdded ? [...existingTags, CODEX_TAG] : existingTags;

  services.repository.threadCommands.update(threadId as any, { context: nextContext, tags: nextTags });
}

export function updateCodexState(
  services: Services, threadId: EntityId,
  patch: Partial<CodexThreadState> | ((prev: CodexThreadState) => Partial<CodexThreadState>),
): boolean {
  const state = getCodexState(services, threadId as string);
  if (!state) return false;
  persistCodexState(services, threadId as string, (typeof patch === 'function' ? patch(state) : patch) as any);
  return true;
}

export function ensureSessionMarker(services: Services, threadId: EntityId): EntityId {
  return services.artifact.findOrCreateByType(threadId, 'codex-session', { title: 'Codex session', content: {}, color: 'blue' }).artifactId;
}

export function updateChatState(services: Services, threadId: EntityId, chatState: ChatState): void {
  persistCodexState(services, threadId as string, { chatState });
  services.threads.updateChatState(threadId, chatState);
}

export function setRunning(services: Services, threadId: string, running: boolean): void {
  persistCodexState(services, threadId, { isRunning: running });
}

export function enqueueMessage(services: Services, threadId: string, msg: QueuedMessage): void {
  const prior = getCodexState(services, threadId);
  const prevMessageId = prior?.queuedMessage?.messageId;
  if (prevMessageId && prevMessageId !== msg.messageId) {
    services.chat.updateMessageState(prevMessageId as any, { status: 'cancelled' } as any);
  }
  persistCodexState(services, threadId, { queuedMessage: msg });
}

export function dequeueMessage(services: Services, threadId: string): QueuedMessage | undefined {
  const prior = getCodexState(services, threadId);
  const msg = prior?.queuedMessage;
  if (msg) persistCodexState(services, threadId, { queuedMessage: undefined });
  return msg;
}

/** Request interruption while leaving the stream consumer registered to receive turn/completed. */
export function requestTurnInterrupt(services: Services, threadId: string): boolean {
  const prior = getCodexState(services, threadId);
  if (!prior?.threadId || !prior?.turnId) return false;

  try {
    if (prior.pendingApproval?.requestId) {
      try { (services.codex as any).respondToApproval(prior.pendingApproval.requestId, 'cancel'); } catch { /* best effort */ }
    }
    if (prior.pendingApproval?.approvalMessageId) {
      services.chat.updateMessageState(prior.pendingApproval.approvalMessageId as any, {
        responseTimestamp: Date.now(),
        blockResponse: { cancelled: true },
        asideText: `Cancelled — ${prior.pendingApproval.summary || 'tool request'}`,
      } as any);
    }
    (services.codex as any).interruptTurn(prior.threadId, prior.turnId)?.catch?.(() => {});

    // Cancel queued message so finalize() doesn't replay it after the interrupt
    const queued = dequeueMessage(services, threadId);
    if (queued?.messageId) {
      services.chat.updateMessageState(queued.messageId as any, { status: 'cancelled' } as any);
    }

    persistCodexState(services, threadId, {
      isRunning: false,
      pendingApproval: undefined,
      chatState: 'idle',
    });
    return true;
  } catch (error: any) {
    services.logger.warn('[codex] failed to interrupt turn', { threadId, error: error?.message });
    return false;
  }
}

/**
 * Interrupt the active turn, unregister the consumer, invalidate pending
 * approval blocks, and clear all mid-turn flags.
 */
export function killTurn(services: Services, threadId: string): void {
  const prior = getCodexState(services, threadId);

  // Interrupt the turn via app-server
  if (prior?.threadId && prior?.turnId) {
    try { (services.codex as any).interruptTurn(prior.threadId, prior.turnId)?.catch?.(() => {}); } catch { /* best effort */ }
  }

  // Unregister consumer so stale notifications don't route
  if (prior?.threadId) {
    try { (services.codex as any).unregisterConsumer(prior.threadId); } catch { /* ok */ }
  }

  // Clear handle
  const handle = (services.codex as any).getHandle(threadId);
  if (handle) {
    try { handle.abort()?.catch?.(() => {}); } catch { /* already gone */ }
    (services.codex as any).clearHandle(threadId);
  }

  // Invalidate pending approval block
  if (prior?.pendingApproval?.approvalMessageId) {
    services.chat.updateMessageState(prior.pendingApproval.approvalMessageId as any, {
      responseTimestamp: Date.now(),
      blockResponse: { cancelled: true },
      asideText: `Cancelled — ${prior.pendingApproval?.summary || 'tool request'}`,
    } as any);
  }

  // Invalidate queued message
  const queued = dequeueMessage(services, threadId);
  if (queued?.messageId) {
    services.chat.updateMessageState(queued.messageId as any, { status: 'cancelled' } as any);
  }

  persistCodexState(services, threadId, {
    isRunning: false,
    turnId: undefined,
    activeMessageId: undefined,
    pendingApproval: undefined,
  });
}
