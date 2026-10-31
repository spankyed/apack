/**
 * Claude Code Chat — the main conversational action.
 *
 * Starts a Claude Code CLI query, stores the handle, and kicks off a
 * fire-and-forget stream consumer that processes events in the background.
 * The action returns immediately so the brain's step actor is not blocked
 * for the duration of the CLI session.
 *
 * Stream processing, tool-activity tracking, control_request handling,
 * diff artifact creation, and queued-message drain all live in
 * `_helpers/stream-consumer.ts`.
 *
 * Triggered from the "Claude Code" flow when a user.message arrives with
 * `mode === 'Claude Code'`.
 */

import type { AppSettings } from '@apackdev/sdk/types';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z, EntityId } from '#generated/services.ts';
import { createStreamWriter } from './_helpers/stream-writer.ts';
import { createToolActivityWriter } from './_helpers/tool-activity-writer.ts';
import { createThinkingWriter } from './_helpers/thinking-writer.ts';
import { getClaudeState, persistClaudeState, setRunning, enqueueMessage, killTurn, ensureSessionMarker, updateChatState, extractStaleSessionId, markSessionBroken } from './_helpers/thread-context.ts';
import { consumeStream, finalizeSessionError } from './_helpers/stream-consumer.ts';
import { buildSessionBootstrapPrompt } from '../_helpers/session-bootstrap.ts';

export const meta: ActionMeta = {
  label: 'Claude Code Chat',
  description: 'Drives Claude Code in streaming mode for the current thread, resuming prior sessions and prompting the user for tool permissions.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Target thread', required: true },
    text: { type: 'string', description: 'User message text', required: true },
    mode: { type: 'string', description: 'Agent mode (passed through from user.message)', required: false },
    phase: { type: 'string', description: 'Sub-phase within mode (Plan/Edit/review)', required: false },
    model: { type: 'string', description: 'Override Claude model (alias or full id)', required: false },
    allowedTools: { type: 'array', description: 'Tools allowed without prompting', required: false },
    disallowedTools: { type: 'array', description: 'Tools always denied', required: false },
    systemPrompt: { type: 'string', description: 'Extra system prompt to append', required: false },
    messageId: { type: 'string', description: 'User message entity ID (for queued-state UI)', required: false },
  },
};

/**
 * Tools auto-approved without prompting — matches the CLI's `isReadOnly()` set.
 * With `--permission-prompt-tool stdio`, the CLI delegates ALL permission
 * decisions to our wrapper. Without this list, every read-only tool would
 * trigger an approval block.
 *
 * Excludes AskUserQuestion/ExitPlanMode (handled via control_request flow)
 * and Brief/SyntheticOutput (internal coordinator signals).
 */
const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep',
  'WebSearch', 'WebFetch',
  'Agent',
  'ToolSearch',
  'TaskList', 'TaskGet', 'TaskOutput',
  'CronList',
  'LSP',
  'ListMcpResources', 'ReadMcpResource',
  // 'EnterPlanMode', // TODO: need control_request to sync plan mode state with app UI
  'SyntheticOutput',
  // NOT AskUserQuestion or ExitPlanMode — we need control_requests for those
  // to show question blocks and plan approval blocks.
];

const PHASE_TIP_PROMPTS: Record<string, string> = {
  Plan: 'Plan Phase Tips System',
  Edit: 'Edit Phase Tips System',
};

export const phaseTipPromptLabel = (phase: string | undefined) =>
  phase ? PHASE_TIP_PROMPTS[phase] : undefined;

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const {
    threadId,
    text,
    phase,
    model,
    allowedTools,
    disallowedTools,
    systemPrompt,
    messageId: userMessageId,
    references,
  } = params as {
    threadId: EntityId;
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

  const log = services.logger;
  log.debug('chat action invoked', { threadId, mode: params.mode, phase, textLen: text?.length });

  if (!threadId || !text?.trim()) {
    return { success: false, error: 'threadId and text are required' };
  }

  // Resume any prior conversation parked on this thread.
  const prior = getClaudeState(services, threadId);
  let resumeSessionId = prior?.sessionId || undefined;
  let forkFrom = prior?.forkFrom;
  let revertTo = prior?.revertTo;

  // Guard: fork/revert requires a valid sessionId to resume from.
  // If sessionId is missing (race with stream-consumer), drop the
  // fork/revert intent and start a fresh session instead.
  if ((forkFrom || revertTo) && !resumeSessionId) {
    log.warn('[revert-guard] fork/revert requested but no sessionId — starting fresh', {
      threadId,
      hadForkFrom: !!forkFrom,
      hadRevertTo: !!revertTo,
      revertCliUuid: revertTo?.cliUuid ?? null,
      forkCliUuid: forkFrom?.cliUuid ?? null,
      fullPriorState: JSON.stringify(prior ?? {}),
    });
    persistClaudeState(services, threadId, {
      revertTo: undefined,
      forkFrom: undefined,
    });
    // Notify the user — their revert/fork intent was silently dropped.
    services.chat.sendBlockMessage({
      threadId,
      text: '⚠️ Could not revert — session data is unavailable. Starting a fresh session.',
      blocks: [{ type: 'note', props: {
        content: 'The revert point could not be found because the session was lost. Your next message will start a new conversation.',
        variant: 'warning',
        label: 'Revert Skipped',
      }}],
      forkable: false,
    });
    forkFrom = undefined;
    revertTo = undefined;
  }

  log.debug('resume state resolved', {
    resumeSessionId: resumeSessionId ?? null,
    fork: !!forkFrom,
    revert: revertTo?.cliUuid ?? null,
  });

  // ─── Fork-pending guard ────────────────────────────────────────────
  // The backend forkThread action sets forkPending before navigation.
  // Queue the message until CC: Handle Fork finishes persisting state.
  if (prior?.forkPending) {
    log.debug('fork in progress — queuing message', { threadId });
    enqueueMessage(services, threadId, { text, mode: params.mode as string, phase, messageId: userMessageId, references });
    if (userMessageId) {
      services.chat.updateMessageState(userMessageId as any, { status: 'queued' } as any);
    }
    return { success: true, queued: true };
  }

  // ─── Concurrency guard ──────────────────────────────────────────────
  log.info('[concurrency-guard] state snapshot', {
    threadId,
    isRunning: prior?.isRunning ?? null,
    hasPendingControlRequest: !!prior?.pendingControlRequest,
    pendingToolName: prior?.pendingControlRequest?.toolName ?? null,
  });

  if (prior?.isRunning) {
    // Handle exists → CLI process is genuinely running, queue the message
    const handleExists = !!(services.cli as any).claudeCode.getHandle(threadId);
    if (handleExists) {
      log.debug('action already running — queuing message', { threadId });
      enqueueMessage(services, threadId, { text, mode: params.mode as string, phase, messageId: userMessageId, references });
      if (userMessageId) {
        services.chat.updateMessageState(userMessageId as any, { status: 'queued' } as any);
      }
      return { success: true, queued: true };
    }
    // No handle → stale isRunning from a previous process, clear and proceed
    log.info('[concurrency-guard] stale isRunning (no handle) — clearing', { threadId });
    setRunning(services, threadId, false);
  }

  // If the turn is paused on a permission prompt (isRunning=false but
  // pendingControlRequest exists), kill the old CLI subprocess so the old
  // consumer exits cleanly, then proceed with this message as a new turn.
  if (prior?.pendingControlRequest) {
    log.info('[concurrency-guard] killing paused turn — will invalidate approval block', {
      threadId,
      toolName: prior.pendingControlRequest.toolName,
      approvalMessageId: prior.pendingControlRequest.approvalMessageId,
    });
    killTurn(services, threadId);
  }

  // Mark this thread as having an active turn.
  setRunning(services, threadId, true);

  // Race guard: if a parallel invocation (from a duplicate flow actor)
  // already stored a CLI handle for this thread, bail out to prevent
  // creating orphaned "Thinking…" placeholder messages.
  const existingHandle = (services.cli as any).claudeCode.getHandle(threadId);
  if (existingHandle) {
    log.warn('[concurrency-guard] parallel invocation detected — bailing', { threadId });
    return { success: false, error: 'parallel invocation' };
  }

  // Disable fork on user messages in Claude Code threads. Forking from a
  // user message creates a mismatch: the app shows the message but the CLI
  // session truncates to the preceding assistant message, so the LLM has
  // no knowledge of what the user said. Only assistant messages (which
  // carry cliUuid) are safe fork points.
  if (userMessageId) {
    services.chat.updateMessageState(userMessageId as any, { forkable: false } as any);
  }

  // ─── CWD check — prompt for directory if none configured ────────────
  // Runs before the placeholder message so the empty bubble never appears.
  const cwdOverride = params.cwdOverride as string | undefined;
  const forceDirectoryPicker = params.forceDirectoryPicker as boolean | undefined;

  const codeSettings = services.settings.get({ kind: 'feature', featureRef: 'default-setup/code' }) as any;
  const hasCwd = codeSettings?.defaultBaseDirectory || codeSettings?.baseDirectory || prior?.cwd;
  if (forceDirectoryPicker || (!hasCwd && !cwdOverride)) {
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects;
    const blocks: any[] = [
      { type: 'prompt', props: { content: 'Select a project directory' } },
    ];
    blocks.push({
      type: 'project-select',
      props: { projects },
    });
    blocks.push(
      { type: 'file-picker', props: { fileType: 'directory' } },
      { type: 'toggles', props: { toggles: [
        { id: 'worktree', label: 'Worktree', description: 'Isolated file mutations', default: false },
      ] } },
    );
    const picker = services.chat.sendBlockMessage({
      threadId,
      text: 'Which project directory should I work in?',
      blocks,
      forkable: false,
      autoHide: true,
      asUser: true,
      asideContext: 'Project',
    });
    persistClaudeState(services, threadId, {
      pendingDirectorySelect: {
        pickerMessageId: picker.messageId as string,
        text,
        mode: params.mode,
        phase,
        model,
        allowedTools,
        disallowedTools,
        systemPrompt,
        messageId: userMessageId,
        references,
      },
    });
    setRunning(services, threadId, false);
    return { success: true, awaitingDirectory: true };
  }

  // Create the placeholder assistant message we'll stream into.
  // Shows "Thinking…" until the first text delta arrives and the stream
  // writer overwrites it. Non-forkable while streaming.
  const currentMessageId = services.chat.sendBlockMessage({
    threadId,
    text: 'Thinking…',
    blocks: [],
    forkable: false,
  }).messageId;
  log.debug('placeholder message created', { messageId: currentMessageId });

  const writer = createStreamWriter(services, currentMessageId, { intervalMs: 80 });
  const thinking = createThinkingWriter(services, currentMessageId, { intervalMs: 250 });
  const toolActivity = createToolActivityWriter(services, currentMessageId, { intervalMs: 250, phase, getThinkingBlock: () => thinking.buildBlock() });

  // Upsert the thread's claude-session artifact (type marker only).
  ensureSessionMarker(services, threadId);
  persistClaudeState(services, threadId, { startedAt: prior?.startedAt ?? Date.now(), sessionError: undefined });
  updateChatState(services, threadId, 'working');

  // Read the user's current permission-mode and worktree choices.
  const activePermissionMode = prior?.permissionMode ?? 'acceptEdits';
  const effectivePermissionMode = phase === 'Plan' ? 'plan' : activePermissionMode;
  const useWorktree = prior?.useWorktree ?? false;
  log.debug('active settings', { permissionMode: effectivePermissionMode, worktree: useWorktree });

  // Worktree mismatch: the CLI can't resume a session across CWD changes
  // because --worktree shifts the project bucket the JSONL is looked up from.
  // Treat undefined sessionWorktree as non-worktree (pre-tracking sessions).
  if (resumeSessionId && (prior?.sessionWorktree ?? false) !== useWorktree) {
    log.info('[worktree] session/toggle mismatch — clearing session', {
      threadId, resumeSessionId,
      sessionWorktree: prior?.sessionWorktree, useWorktree,
    });
    persistClaudeState(services, threadId, { sessionId: undefined, sessionWorktree: undefined });
    resumeSessionId = undefined;
  }

  // Phase-aware system-prompt nudging (plan/edit/review).
  const tipLabel = phaseTipPromptLabel(phase);
  const phaseTip = tipLabel ? services.prompt.usePrompt(tipLabel, {}) : undefined;
  const composedSystemPrompt = [phaseTip, systemPrompt].filter(Boolean).join('\n\n') || undefined;

  // Clear one-shot flags before the query — their purpose is consumed the
  // moment we read them. If the query throws, we don't want the next turn
  // to re-fork or re-revert.
  if (forkFrom || revertTo) {
    persistClaudeState(services, threadId, {
      ...(forkFrom && { forkFrom: undefined }),
      ...(revertTo && { revertTo: undefined }),
    });
  }

  // ─── Fire the query ─────────────────────────────────────────────────
  let sessionCwd: string | undefined; // TODO: remove — hoisted for debug logging in catch block
  try {
    // Resolve references inside try/catch so a failure doesn't permanently
    // lock the thread in isRunning=true.
    const resolved = await services.chat.resolveReferences(references);
    const fullText = resolved.textPrefix ? `${resolved.textPrefix}\n\n${text}` : text;
    const promptText = !resumeSessionId && !forkFrom && !revertTo
      ? buildSessionBootstrapPrompt(services, {
        threadId,
        currentMessageId: userMessageId,
        currentText: fullText,
        providerName: 'Claude Code',
      })
      : fullText;
    let prompt: any = promptText;
    if (resolved.imageBlocks.length > 0) {
      prompt = {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: promptText }, ...resolved.imageBlocks] },
        parent_tool_use_id: null,
      };
    }

    const addDirs = [...new Set([...(prior?.additionalDirs ?? []), ...(resolved.addDirs ?? [])])];

    log.debug('invoking claudeCode.query', {
      model,
      resumeSessionId: resumeSessionId ?? null,
      revertTo: revertTo?.cliUuid ?? null,
      forkFrom: forkFrom?.cliUuid ?? null,
      forkSession: !!(forkFrom || revertTo),
      permissionMode: effectivePermissionMode,
      hasSystemPrompt: !!composedSystemPrompt,
      imageCount: resolved.imageBlocks.filter((b: any) => b.type === 'image').length,
      fileCount: references?.files?.length ?? 0,
      contextCount: references?.context?.length ?? 0,
    });
    // When resuming, use the CWD where the session was originally created so
    // the CLI can locate the session JSONL in the correct project bucket.
    // For new sessions, fallback chain:
    //   cwdOverride — explicit directory from "New Thread in Project" menu (one-shot)
    //   prior?.cwd — thread already had a session (e.g. expired/broken); keep its project dir
    //                even if the user navigated elsewhere since then
    //   baseDirectory / defaultBaseDirectory — current base directory from settings
    sessionCwd = resumeSessionId
      ? prior?.cwd
      : (cwdOverride || prior?.cwd || codeSettings?.baseDirectory || codeSettings?.defaultBaseDirectory || undefined);

    // Fallback: if resuming but prior.cwd is missing, try project settings —
    // but only if the session file actually exists under that directory.
    // Blindly using defaultBaseDirectory when it differs from the thread's
    // original cwd causes "session not found" (wrong project bucket).
    if (resumeSessionId && !sessionCwd) {
      const fallbackCwd = codeSettings?.defaultBaseDirectory || codeSettings?.baseDirectory || undefined;
      if (fallbackCwd) {
        const exists = await services.cli.claudeCode.sessionExists(resumeSessionId, { cwd: fallbackCwd });
        if (exists) {
          sessionCwd = fallbackCwd;
          persistClaudeState(services, threadId, { cwd: fallbackCwd });
          log.info('[resume] recovered sessionCwd via fallback check', { threadId, fallbackCwd });
        } else {
          log.warn('[resume] session not found under fallback CWD either', {
            threadId, resumeSessionId, fallbackCwd,
          });
        }
      }
      if (!sessionCwd) {
        log.warn('[resume] cannot determine session CWD — aborting resume', {
          threadId, resumeSessionId, revertTo: revertTo?.cliUuid ?? null,
        });
        const isRevert = !!revertTo;
        toolActivity.finalise('error');
        setRunning(services, threadId, false);
        updateChatState(services, threadId, 'idle');
        writer.finalize(isRevert
          ? '⚠️ Could not revert — the project directory for this session is unknown. The session may predate directory tracking.'
          : '⚠️ Could not resume — the project directory for this session is unknown.');
        return { success: false, error: 'session CWD unknown', messageId: currentMessageId };
      }
    }

    // Eager persist: store CWD before the query fires so it survives if
    // the turn is killed before the CLI's system/init event arrives.
    if (sessionCwd && !prior?.cwd) {
      persistClaudeState(services, threadId, { cwd: sessionCwd });
    }

    // Pre-flight: verify the session JSONL exists before spawning the CLI.
    // Catches externally-deleted sessions (CLI cleanup, manual removal)
    // with a clear error instead of the generic "session not found" from
    // the CLI's stderr.
    if (resumeSessionId && sessionCwd) {
      const sessionValid = await services.cli.claudeCode.sessionExists(resumeSessionId, { cwd: sessionCwd });
      if (!sessionValid) {
        log.warn('[pre-flight] session file missing on disk', {
          threadId, resumeSessionId, sessionCwd, isRevert: !!revertTo,
        });
        const isRevert = !!revertTo;
        toolActivity.finalise('error');
        setRunning(services, threadId, false);
        writer.finalize(isRevert
          ? '⚠️ Could not revert — the CLI session file no longer exists on disk. It may have been cleaned up by the Claude CLI.'
          : '⚠️ Could not resume — the CLI session file no longer exists on disk.');
        markSessionBroken(services, threadId, `Session ${resumeSessionId} file missing`);
        return { success: false, error: 'session file missing', messageId: currentMessageId };
      }
    }

    const handle = await services.cli.claudeCode.query({
      ...(sessionCwd && { cwd: sessionCwd }),
      prompt,
      resume: resumeSessionId,
      model,
      includePartialMessages: true,
      permissionMode: effectivePermissionMode,
      allowedTools: allowedTools ?? DEFAULT_ALLOWED_TOOLS,
      disallowedTools,
      appendSystemPrompt: composedSystemPrompt,
      surfaceControlRequests: true,
      env: { CLAUDE_CODE_COORDINATOR_MODE: '1' },
      ...(useWorktree && { worktree: true }),
      ...(addDirs.length > 0 && { addDir: addDirs }),
      // Fork/revert: create a new CLI session JSONL file, truncated to the
      // fork/revert point via --resume-session-at.
      ...((forkFrom || revertTo) && { forkSession: true }),
      ...(revertTo && { resumeSessionAt: revertTo.cliUuid }),
      ...(forkFrom?.cliUuid && { resumeSessionAt: forkFrom.cliUuid }),
    } as any);

    // Store the handle so "CC: Route Response" and the stream consumer
    // can write control_responses back to the CLI's stdin.
    (services.cli as any).claudeCode.storeHandle(threadId, handle);

    log.debug('query handle received, kicking off stream consumer');

    // Fire-and-forget: the stream consumer runs in the background,
    // processing events until the CLI stream ends. The action returns
    // immediately so the brain's step actor is freed.
    consumeStream(handle, {
      services, threadId, text, phase, userMessageId,
      resumeSessionId: resumeSessionId ?? undefined,
      sessionCwd: sessionCwd ?? undefined,
      isFork: !!(forkFrom || revertTo),
      revertCliUuid: revertTo?.cliUuid,
      forkCliUuid: forkFrom?.cliUuid,
      useWorktree,
    }, {
      writer, toolActivity, thinking, messageId: currentMessageId as EntityId,
    }).catch((err) => {
      // Safety net — consumeStream has its own try/catch, but guard
      // against truly unexpected escapes. Mirror its cleanup path.
      log.error('consumeStream escaped error boundary', { err: err?.message });
      (services.cli as any).claudeCode.clearHandle(threadId);
      setRunning(services, threadId, false);
      updateChatState(services, threadId, 'idle');
      services.emitter.broadcastToSurface('default-setup/threads', {
        type: 'FLASH_CHAT_STATE', threadId, stateId: 'error', durationMs: 3000,
      });
    });

    return { success: true, streaming: true };
  } catch (err: any) {
    const message = err?.message || 'Claude Code query failed to start';
    log.error('chat action failed to start query', { message, stack: err?.stack });
    toolActivity.finalise('error');
    setRunning(services, threadId, false);

    // ─── Session-not-found: clear stale sessionId, mark session broken ──
    if (extractStaleSessionId(message)) {
      finalizeSessionError(services, threadId as EntityId, writer, message, undefined, { isRevert: !!revertTo });
      // Emit cc.stream.completed so CC: Turn Completed can run bookkeeping
      // (turn counts, cost tracking). Without this, the turn is "lost" from
      // the flow's perspective.
      services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
        eventType: 'cc.stream.completed',
        payload: { threadId, hadErrors: true, error: message },
      });
      return { success: false, error: message, messageId: currentMessageId };
    }

    // ─── Generic error ───────────────────────────────────────────────────
    updateChatState(services, threadId, 'idle');
    services.emitter.broadcastToSurface('default-setup/threads', {
      type: 'FLASH_CHAT_STATE', threadId, stateId: 'error', durationMs: 3000,
    });
    writer.finalize(`⚠️ ${message}`);
    return { success: false, error: message, messageId: currentMessageId };
  }
}
