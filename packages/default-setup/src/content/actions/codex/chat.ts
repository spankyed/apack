/**
 * Codex Chat — starts/resumes a thread on the app-server and begins a turn.
 *
 * Registers a callback-based stream consumer, then calls startTurn.
 * The action returns immediately; notifications stream via callbacks.
 */

import type { AppSettings } from '@apackdev/sdk/types';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z, EntityId } from '#generated/services.ts';
import { createStreamWriter } from '../claude-code/_helpers/stream-writer.ts';
import { createToolActivityWriter } from '../claude-code/_helpers/tool-activity-writer.ts';
import { createThinkingWriter } from '../claude-code/_helpers/thinking-writer.ts';
import {
  getCodexState, persistCodexState, setRunning, enqueueMessage,
  killTurn, ensureSessionMarker, updateChatState,
} from './_helpers/thread-context.ts';
import { createStreamConsumer } from './_helpers/stream-consumer.ts';
import { buildSessionBootstrapPrompt } from '../_helpers/session-bootstrap.ts';
import {
  renderContinuationPrompt, renderBudgetLimitPrompt, renderObjectiveUpdatedPrompt,
} from './_helpers/goal-prompts.ts';

export const meta: ActionMeta = {
  label: 'Codex Chat',
  description: 'Drives Codex via app-server for the current thread.',
  category: 'codex',
  input: {
    threadId: { type: 'string', description: 'Target thread', required: true },
    text: { type: 'string', description: 'User message text', required: true },
    mode: { type: 'string', required: false },
    phase: { type: 'string', description: 'plan or edit', required: false },
    model: { type: 'string', required: false },
    messageId: { type: 'string', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services, _z: Z, _flowId: string) {
  const { threadId, text, phase, model, messageId: userMessageId, references } = params as {
    threadId: EntityId; text: string; mode?: string; phase?: string; model?: string; messageId?: string; references?: any;
  };

  const log = services.logger;
  if (!threadId || !text?.trim()) return { success: false, error: 'threadId and text are required' };

  const prior = getCodexState(services, threadId);
  const codexThreadId = prior?.threadId;
  const effectiveModel = model || prior?.model;
  const approvalMode = prior?.approvalMode ?? 'user';
  const sandbox = prior?.sandbox ?? 'workspace-write';

  // ─── Fork-pending guard ────────────────────────────────────────────
  if (prior?.forkPending) {
    enqueueMessage(services, threadId, { text, mode: params.mode as string, phase, messageId: userMessageId, references });
    if (userMessageId) services.chat.updateMessageState(userMessageId as any, { status: 'queued' } as any);
    return { success: true, queued: true };
  }

  // ─── Concurrency guard ──────────────────────────────────────────────
  if (prior?.isRunning) {
    const handleExists = !!(services.codex as any).getHandle(threadId);
    if (handleExists) {
      enqueueMessage(services, threadId, { text, mode: params.mode as string, phase, messageId: userMessageId, references });
      if (userMessageId) services.chat.updateMessageState(userMessageId as any, { status: 'queued' } as any);
      return { success: true, queued: true };
    }
    // No handle → stale isRunning from a previous process, clear and proceed
    setRunning(services, threadId, false);
  }

  // Kill paused turn if pending approval
  if (prior?.pendingApproval) {
    killTurn(services, threadId);
  }

  setRunning(services, threadId, true);

  // Race guard: if a parallel invocation (from a duplicate flow actor)
  // already stored a handle for this thread, bail out.
  const existingHandle = (services.codex as any).getHandle(threadId);
  if (existingHandle) {
    log.warn('[concurrency-guard] parallel invocation detected — bailing', { threadId });
    return { success: false, error: 'parallel invocation' };
  }

  if (userMessageId) services.chat.updateMessageState(userMessageId as any, { forkable: false } as any);

  // ─── CWD check ──────────────────────────────────────────────────────
  const cwdOverride = params.cwdOverride as string | undefined;
  const forceDirectoryPicker = params.forceDirectoryPicker as boolean | undefined;
  const codeSettings = services.settings.get({ kind: 'feature', featureRef: 'default-setup/code' }) as any;
  const hasCwd = codeSettings?.defaultBaseDirectory || codeSettings?.baseDirectory || prior?.cwd;

  if (forceDirectoryPicker || (!hasCwd && !cwdOverride)) {
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects;
    const picker = services.chat.sendBlockMessage({
      threadId, text: 'Which project directory should I work in?',
      blocks: [
        { type: 'prompt', props: { content: 'Select a project directory' } },
        { type: 'project-select', props: { projects } },
        { type: 'file-picker', props: { fileType: 'directory' } },
      ],
      forkable: false, autoHide: true, asUser: true, asideContext: 'Project',
    });
    persistCodexState(services, threadId, {
      pendingDirectorySelect: { pickerMessageId: picker.messageId as string, text, mode: params.mode, phase, model: effectiveModel, messageId: userMessageId, references },
    });
    setRunning(services, threadId, false);
    return { success: true, awaitingDirectory: true };
  }

  // ─── Placeholder message + writers ──────────────────────────────────
  const currentMessageId = services.chat.sendBlockMessage({ threadId, text: 'Thinking…', blocks: [], forkable: false }).messageId;
  services.chat.updateMessageState(currentMessageId as any, { context: { agent: 'Codex' } } as any);
  const thinking = createThinkingWriter(services, currentMessageId);
  const writer = createStreamWriter(services, currentMessageId, { intervalMs: 80 });
  const toolActivity = createToolActivityWriter(services, currentMessageId, { getThinkingBlock: () => thinking.buildBlock() });

  ensureSessionMarker(services, threadId);
  persistCodexState(services, threadId, { startedAt: prior?.startedAt ?? Date.now(), sessionError: undefined, ...(effectiveModel && { model: effectiveModel }) });

  persistCodexState(services, threadId, { activeMessageId: currentMessageId as string });
  updateChatState(services, threadId, 'working');

  const codex = services.codex as any;
  let activeThreadId: string | undefined;

  try {
    // Ensure app-server is running
    if (codex.status !== 'ready') {
      await codex.start();
    }

    // Resolve CWD — fallback chain:
    //   cwdOverride — explicit directory from "New Thread in Project" menu (one-shot)
    //   prior?.cwd — thread already had a session (e.g. expired/broken); keep its project dir
    //                even if the user navigated elsewhere since then
    //   baseDirectory / defaultBaseDirectory — current base directory from settings
    const sessionCwd = codexThreadId
      ? prior?.cwd
      : (cwdOverride || prior?.cwd || codeSettings?.baseDirectory || codeSettings?.defaultBaseDirectory || undefined);

    if (sessionCwd && !prior?.cwd) persistCodexState(services, threadId, { cwd: sessionCwd });
    if (codexThreadId) {
      try {
        const result = await codex.resumeThread(codexThreadId, {
          ...(effectiveModel && { model: effectiveModel }),
          approvalsReviewer: approvalMode,
          sandbox,
        });
        activeThreadId = result.threadId;
      } catch (resumeErr: any) {
        // Session expired/deleted/corrupted — fall back to a fresh thread
        log.warn('[codex] resume failed, starting fresh thread', { codexThreadId, error: resumeErr?.message });
        const result = await codex.startThread({
          cwd: sessionCwd || prior?.cwd,
          model: effectiveModel,
          sandbox,
          approvalsReviewer: approvalMode,
        });
        activeThreadId = result.threadId;
        persistCodexState(services, threadId, { threadId: activeThreadId, cwd: result.cwd || sessionCwd, approvalMode, sandbox });
      }
    } else {
      const result = await codex.startThread({
        cwd: sessionCwd,
        model: effectiveModel,
        sandbox,
        approvalsReviewer: approvalMode,
      });
      activeThreadId = result.threadId;
      persistCodexState(services, threadId, { threadId: activeThreadId, cwd: result.cwd || sessionCwd, approvalMode, sandbox });
    }

    if (!activeThreadId) {
      throw new Error('Codex did not return a thread id from startThread/resumeThread');
    }

    // Create stream consumer + register
    const { handlers } = createStreamConsumer(
      { services, threadId, codexThreadId: activeThreadId, text, phase },
      { writer, toolActivity, thinking, messageId: currentMessageId as EntityId },
    );
    codex.registerConsumer(activeThreadId, handlers);

    // Map collaboration mode from phase
    const collaborationMode = phase === 'plan'
      ? { mode: 'plan' as const, settings: { model: effectiveModel, developer_instructions: null } }
      : undefined;

    let turnText = !codexThreadId
      ? buildSessionBootstrapPrompt(services, {
        threadId,
        currentMessageId: userMessageId,
        currentText: text,
        providerName: 'Codex',
      })
      : text;

    // ─── Goal prompt injection ───────────────────────────────────────
    const goalState = prior?.goal;
    if (goalState && goalState.status === 'active') {
      const goalPrompt = goalState.objectiveEdited
        ? renderObjectiveUpdatedPrompt(goalState)
        : renderContinuationPrompt(goalState);
      turnText = turnText + '\n\n' + goalPrompt;
    } else if (goalState?.status === 'budget_limited') {
      turnText = turnText + '\n\n' + renderBudgetLimitPrompt(goalState);
    }

    // Start turn
    const turnResult = await codex.startTurn({
      threadId: activeThreadId,
      input: [{ type: 'text', text: turnText }],
      ...(sessionCwd && { cwd: sessionCwd }),
      ...(effectiveModel && { model: effectiveModel }),
      ...(collaborationMode && { collaborationMode }),
      approvalsReviewer: approvalMode,
    });

    // Store handle for pause/abort
    const turnId = turnResult.turnId;
    persistCodexState(services, threadId, { turnId, activeMessageId: currentMessageId as string });
    codex.storeHandle(threadId, {
      codexThreadId: activeThreadId,
      turnId,
      abort: () => codex.interruptTurn(activeThreadId, turnId),
    });

    return { success: true, streaming: true };
  } catch (err: any) {
    const message = err?.message || 'Codex query failed to start';
    log.error('[codex] chat failed', { message, stack: err?.stack });
    // Clean up consumer if it was registered
    if (activeThreadId) {
      try { codex.unregisterConsumer(activeThreadId); } catch { /* may not exist */ }
    }
    toolActivity.finalise('error');
    setRunning(services, threadId, false);
    updateChatState(services, threadId, 'idle');
    writer.finalize(`⚠️ ${message}`);
    return { success: false, error: message, messageId: currentMessageId };
  }
}
