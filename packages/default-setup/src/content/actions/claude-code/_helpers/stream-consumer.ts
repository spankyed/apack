import { createClaudeNativeMessageTracker } from './native-assistant-messages.ts';
import { projectClaudeInputReplay } from './native-input-replay.ts';
import type { ClaudeNestedActivity } from '#features/code/be/services/claude-code/nested-activity.ts';
import type { ClaudeConversationTurn } from '#features/code/be/services/claude-code/conversation.ts';
/**
 * Stream consumer — fire-and-forget async function that owns the `for await`
 * loop over a Claude Code CLI handle's event stream.
 *
 * Extracted from `chat.ts` so the chat action can return immediately after
 * starting the query. This function runs detached from the action lifecycle:
 * it processes all stream events, handles control_requests, and finalises
 * writers.
 *
 * Side effects are split between this consumer (ordering-critical state) and
 * flow actions (async-safe UI/artifact updates):
 * - Consumer: persistClaudeState, setRunning, writer/toolActivity, clearHandle,
 *   dequeueMessage → replayQueuedMessage (dequeue before setRunning to avoid race)
 * - Flow actions: updateClaudeState, diff artifact
 *   (triggered via cc.stream.* brain events → on() listeners in the flow)
 *
 * Error boundary: the entire body is wrapped in try/catch. Errors never
 * escape — the catch block logs, finalises writers, clears the handle, and
 * emits cc.stream.completed so the flow's Turn Completed action can clean up.
 */

import type { Services, EntityId } from '#generated/services.ts';
import { isPlanFileWrite, DONT_BYPASS } from './auto-approve.ts';
import { createStreamWriter } from './stream-writer.ts';
import { createToolActivityWriter } from './tool-activity-writer.ts';
import { createThinkingWriter } from './thinking-writer.ts';
import { createPlanDraft } from './plan-artifact.ts';
import { parseExitPlanModeInput, buildPlanApprovalContext } from './plan-approval.ts';
import { parseAskUserQuestionInput } from './ask-user-question.ts';
import { getClaudeState, persistClaudeState, cancelPendingControlRequest, setRunning, dequeueMessage, updateClaudeState, updateChatState, extractStaleSessionId, markSessionBroken } from './thread-context.ts';
import { refreshThreadContextUsage } from './context-usage.ts';

/** Tools whose execution mutates files and should roll up into a diff artifact. */
const FILE_MUTATION_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Sum per-model costUSD from the CLI's modelUsage map.
 * Falls back to 0 when the field is absent or malformed.
 */
function sumModelUsageCost(modelUsage: Record<string, any> | undefined): number {
  if (!modelUsage || typeof modelUsage !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(modelUsage)) {
    if (entry && typeof entry.costUSD === 'number') total += entry.costUSD;
  }
  return total;
}

export interface ConsumerContext {
  services: Services;
  threadId: EntityId;
  /** Original user message text — passed to cc.stream.completed for diff title. */
  text: string;
  phase?: string;
  /** The app's user message entity ID — used to store the CLI's user message UUID. */
  userMessageId?: string;
  /** Full input text, including app-injected bootstrap/reference context. */
  submittedPrompt?: string;
  nativeInputId?: string;
  // ── Resume diagnostics (for error logging) ──
  resumeSessionId?: string;
  sessionCwd?: string;
  /** True when forkFrom or revertTo was set on this turn. */
  isFork?: boolean;
  /** The --resume-session-at value when reverting. */
  revertCliUuid?: string;
  /** The --resume-session-at value when forking. */
  forkCliUuid?: string;
  /** Whether this turn was invoked with --worktree. */
  useWorktree?: boolean;
  persistent?: boolean;
  costBaseline?: number;
  activity?: ClaudeNestedActivity;
}

export interface ConsumerWriters {
  writer: ReturnType<typeof createStreamWriter>;
  toolActivity: ReturnType<typeof createToolActivityWriter>;
  thinking: ReturnType<typeof createThinkingWriter>;
  messageId: EntityId;
}

/** Map one owned native input/autonomous turn into app writers and persistence. */
export async function consumeConversationTurn(turn: ClaudeConversationTurn, ctx: ConsumerContext, initial?: ConsumerWriters): Promise<void> {
  const { services, threadId } = ctx;
  if (turn.stopped) {
    if (initial) {
      initial.thinking.finalise();
      initial.toolActivity.finalise('done');
      initial.writer.finalize(initial.writer.text || 'Claude Code stopped.');
    }
    return;
  }
  const messageId = initial?.messageId ?? services.chat.sendBlockMessage({ threadId, text: 'Thinking…', blocks: [], forkable: false }).messageId as EntityId;
  const thinking = initial?.thinking ?? createThinkingWriter(services, messageId, { intervalMs: 250 });
  const writers = initial ?? { messageId, thinking,
    writer: createStreamWriter(services, messageId, { intervalMs: 80 }),
    toolActivity: createToolActivityWriter(services, messageId, { intervalMs: 250, phase: ctx.phase, getThinkingBlock: () => thinking.buildBlock() }),
  };
  services.cli.claudeCode.storeHandle(threadId, turn.handle);
  setRunning(services, threadId, true);
  updateChatState(services, threadId, 'working');
  await consumeStream(turn.handle, { ...ctx, persistent: true, get costBaseline() { return turn.costBaseline; }, activity: turn.activity, nativeInputId: turn.inputId }, writers);
}

/**
 * Consume the CLI event stream in the background. The chat action calls this
 * without awaiting it, so the action returns immediately while this function
 * continues processing events.
 */
export async function consumeStream(
  handle: any,
  ctx: ConsumerContext & { activity: ClaudeNestedActivity },
  initialWriters: ConsumerWriters,
): Promise<void> {
  const { services, threadId, text } = ctx;
  let phase = ctx.phase;
  const log = services.logger;

  // True when this consumer still owns the thread's handle slot. False after
  // killTurn() cleared it, or after any caller stored a replacement handle.
  // When false, we must not call clearHandle / persistClaudeState / emit
  // cc.stream.completed — those belong to whoever owns the slot now.
  const stillCurrent = () => ctx.persistent
    ? services.cli.claudeCode.isCurrentTurn(threadId, handle)
    : services.cli.claudeCode.getHandle(threadId) === handle;

  let currentMessageId: EntityId = initialWriters.messageId;
  let writer = initialWriters.writer;
  let toolActivity = initialWriters.toolActivity;
  let thinking = initialWriters.thinking;
  let currentMessageHasCliUuid = false;
  let currentMessageCliUuid: string | undefined;
  let nativeMessages = createClaudeNativeMessageTracker();
  let nativeSessionId = ctx.resumeSessionId;
  const activity = ctx.activity;
  let nestedToolCount = 0;
  let nestedToolErrors = false;
  let priorSegmentToolCount = 0;
  let priorSegmentsHadToolErrors = false;

  /** Idempotent — safe to call from every finalization path. */
  const finaliseThinking = () => { if (thinking.isStreaming) thinking.finalise(); };

  // Set by the control_request handler after a user-interactive flow.
  // The next `message_start` will split into a new message.
  let splitOnNextMessageStart = false;

  // Track file-mutation paths across all messages for the diff artifact.
  const mutatedPathsSet = new Set<string>();
  const mutatedPaths: string[] = [];

  function collectNestedAccounting(): void {
    const nested = activity.takeAccounting();
    nestedToolCount += nested.toolCallCount;
    nestedToolErrors ||= nested.hadErrors;
    for (const path of nested.mutatedPaths) {
      if (!mutatedPathsSet.has(path)) { mutatedPathsSet.add(path); mutatedPaths.push(path); }
    }
  }


  // Track whether we've captured the CLI's user message UUID for this turn.
  // The first `user` event echoes the prompt with the UUID the CLI assigned.
  let userUuidTracked = false;

  // Extracted from the `result` line directly — survives even if handle.result
  // rejects (error subtypes like error_during_execution).
  let resultFromLine: { sessionId: string; text: string; totalCostUsd: number; durationMs: number; subtype?: string; isError?: boolean; errors?: string[] } | undefined;

  /** Finalize the current message and create a new "Thinking…" placeholder. */
  function splitMessage() {
    writer.finalize(writer.text);
    finaliseThinking();
    services.chat.updateMessageState(currentMessageId as any, { forkable: currentMessageHasCliUuid } as any);
    const segmentHadErrors = toolActivity.entries.some(e => e.status === 'error');
    priorSegmentToolCount += toolActivity.entries.length;
    priorSegmentsHadToolErrors ||= segmentHadErrors;
    toolActivity.finalise(segmentHadErrors ? 'error' : 'done');

    const msg = services.chat.sendBlockMessage({ threadId, text: 'Thinking…', blocks: [], forkable: false });
    log.debug('message split', { previousId: currentMessageId, nextId: msg.messageId });
    const newThinking = createThinkingWriter(services, msg.messageId as EntityId, { intervalMs: 250 });
    return {
      currentMessageId: msg.messageId as EntityId,
      writer: createStreamWriter(services, msg.messageId as EntityId, { intervalMs: 80 }),
      toolActivity: createToolActivityWriter(services, msg.messageId as EntityId, { intervalMs: 250, phase, getThinkingBlock: () => newThinking.buildBlock() }),
      thinking: newThinking,
      currentMessageHasCliUuid: false,
    };
  }

  try {
    // ─── Drain the event stream ──────────────────────────────────────────
    let eventCount = 0;
    for await (const ev of handle.events) {
      if (!stillCurrent()) throw new Error('Claude turn was superseded');
      const line = ev as any;
      eventCount++;

      if (eventCount <= 5 || eventCount % 20 === 0) {
        log.debug('stream event', { n: eventCount, type: line?.type, line });
      }

      // Split into a new message after approval/question answer — but only
      // when the CLI actually starts a new assistant message turn, not on
      // intermediate events (tool results, text deltas) that may arrive
      // between the approval and the stream resuming.
      const isMessageStart = line.type === 'assistant' || (line.type === 'stream_event' && (line as any).event?.type === 'message_start');
      if (splitOnNextMessageStart && isMessageStart) {
        splitOnNextMessageStart = false;
        nativeMessages = createClaudeNativeMessageTracker();
        currentMessageCliUuid = undefined;
        ({ currentMessageId, writer, toolActivity, thinking, currentMessageHasCliUuid } = splitMessage());
      }

      // First `system/init` event carries sessionId/model/cwd.
      if (line.type === 'system' && line.subtype === 'init') {
        if (line.session_id) {
          nativeSessionId = line.session_id;
          log.debug('[stream] persisting sessionId from system/init', {
            threadId, sessionId: line.session_id, cwd: line.cwd || 'NONE',
          });
          persistClaudeState(services, threadId, {
            sessionId: line.session_id,
            lastTurnAt: Date.now(),
            cwd: line.cwd || undefined,
            sessionWorktree: ctx.useWorktree ?? false,
          });
        }
        services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
          eventType: 'cc.stream.started',
          payload: {
            threadId,
            sessionId: line.session_id || '',
            model: line.model || '',
            cwd: line.cwd || '',
          },
        });
        continue;
      }

      if (line.type === 'stream_event') {
        const evt = (line as any).event;

        // New text content block starting after prior text → inject separator
        // so successive assistant segments don't concatenate without whitespace.
        if (evt?.type === 'content_block_start' && evt?.content_block?.type === 'text') {
          if (writer.text) {
            writer.push('\n');
          }
        }

        // Anthropic text deltas.
        const delta = evt?.delta;

        // Extended thinking deltas — accumulate into the thinking writer.
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          // Clear the "Thinking…" placeholder text on the first thinking delta
          // so only the thinking block is visible, not redundant text below it.
          if (!thinking.hasContent) {
            services.chat.updateMessageState(currentMessageId as any, { text: '' });
          }
          thinking.push(delta.thinking);
          continue;
        }

        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          // Finalize thinking when the first text delta arrives.
          finaliseThinking();
          writer.push(delta.text);
          continue;
        }
      }

      if (line.type === 'assistant') {
        // Track the CLI's message UUID so revert can use --resume-session-at.
        if (line.uuid) {
          currentMessageCliUuid = line.uuid;
          currentMessageHasCliUuid = true;
        }
        const blocks = line.message?.content || [];
        for (const block of blocks) {
          if (block?.type === 'tool_use') {
            if (block.name === 'ExitPlanMode') continue;

            // Finalize thinking and hand blocks ownership to tool-activity.
            finaliseThinking();
            thinking.stopDirectWrites();
            writer.flush();
            const summary = block.input ? shortenInput(block.input) : '';
            const toolId = block.id || `tu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            toolActivity.append({
              id: toolId,
              tool: block.name,
              summary,
              status: 'running',
              details: { input: block.input },
            });
            {
              const target = toolActivity;
              activity.register(toolId, event => {
                const nested = event as any;
                if (!Array.isArray(nested.message?.content)) return;
                const parts: string[] = [];
                for (const block of nested.message.content) {
                  if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
                  else if (block?.type === 'tool_use' && typeof block.name === 'string') {
                    parts.push(`${block.name}: ${block.input && typeof block.input === 'object' ? shortenInput(block.input) : ''}`);
                  } else if (block?.type === 'tool_result') {
                    parts.push(`${block.is_error ? 'Tool error' : 'Tool result'}: ${extractToolResultText(block.content)}`);
                  }
                }
                const content = parts.join('\n').trim();
                if (!content) return;
                const previous = target.entries.find(entry => entry.id === toolId)?.details?.output ?? '';
                const output = `${previous}${previous ? '\n\n' : ''}${content}`;
                target.update(toolId, { outputSummary: 'Subagent activity', details: { output: output.length > 65536 ? `${output.slice(0, 65536)}\n[Subagent activity truncated]` : output } });
                // Flush late output now so teardown cannot leave a pending writer timer.
                target.flush();
              });
            }
            if (FILE_MUTATION_TOOLS.has(block.name) && block.input) {
              const p = (block.input as any).file_path || (block.input as any).path;
              if (typeof p === 'string' && !mutatedPathsSet.has(p)) {
                mutatedPathsSet.add(p);
                mutatedPaths.push(p);
              }
            }
            // Update the thread's recent-tools list (last 3).
            updateClaudeState(services, threadId, (prev) => {
              const recent = (prev.recentTools ?? []).slice(-2);
              recent.push({ name: block.name, summary, at: Date.now() });
              return { recentTools: recent };
            });
          }
        }
        const nativeText = blocks.filter((block: { type?: string; text?: unknown }) => block?.type === 'text' && typeof block.text === 'string').map((block: { text: string }) => block.text).join('\n');
        const projected = nativeMessages.accept(writer.text, {
          uuid: line.uuid,
          sessionId: line.session_id || nativeSessionId,
          apiMessageId: line.message?.id,
          text: nativeText,
          parentToolUseId: line.parent_tool_use_id,
        });
        if (projected.text.length > writer.text.length) writer.push(projected.text.slice(writer.text.length));
        if (currentMessageCliUuid || projected.rows.length) services.chat.updateMessageState(currentMessageId as any, {
          context: { ...(currentMessageCliUuid ? { cliUuid: currentMessageCliUuid } : {}), ...(projected.rows.length ? { claudeNativeMessages: projected.rows } : {}) },
        } as any);
        continue;
      }

      if (line.type === 'tool_progress') {
        if (line.tool_use_id && typeof line.elapsed_time_seconds === 'number') {
          toolActivity.update(line.tool_use_id, {
            durationMs: Math.round(line.elapsed_time_seconds * 1000),
          });
        }
        continue;
      }

      if (line.type === 'user') {
        // Tool results also carry user-event UUIDs. Only the native input replay
        // identifies the host prompt's persisted user row for file rewind.
        if (!userUuidTracked && line.isReplay === true && !line.parent_tool_use_id && (!ctx.nativeInputId || line.uuid === ctx.nativeInputId)) {
          if (!ctx.userMessageId) {
            log.warn('input replay without userMessageId — cliUuid tracking skipped', { threadId });
            userUuidTracked = true;
          } else if (line.uuid) {
            const accepted = projectClaudeInputReplay(line.message?.content, ctx.text, ctx.submittedPrompt);
            services.chat.updateMessageState(ctx.userMessageId as any, {
              ...(accepted.text !== undefined ? { text: accepted.text } : {}),
              context: { cliUuid: line.uuid, ...(accepted.claudeSubmittedText !== undefined ? { claudeSubmittedText: accepted.claudeSubmittedText } : {}) },
            } as any);
            userUuidTracked = true;
          }
        }
        const content = (line.message as { content?: unknown })?.content;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
          const b = block as { type?: string; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
          if (b?.type !== 'tool_result') continue;
          const toolUseId = b.tool_use_id;
          if (typeof toolUseId !== 'string') continue;

          const resultText = extractToolResultText(b.content);
          const isError = b.is_error === true;
          const displayText = isError ? stripToolUseErrorEnvelope(resultText) : resultText;
          const outputSummary = displayText.length > 120
            ? displayText.slice(0, 117) + '…'
            : displayText;

          toolActivity.update(toolUseId, {
            status: isError ? 'error' : 'ok',
            outputSummary: outputSummary || undefined,
            details: isError ? { error: displayText } : { output: displayText },
          });

          if (isError) {
            log.warn('tool execution failed', {
              tool_use_id: toolUseId,
              preview: displayText.slice(0, 200),
            });
          }
        }
        continue;
      }

      // ─── Control requests (surfaced by pump) ────────────────────────
      if (line.type === 'control_request') {
        const req = (line as any).request ?? {};
        const requestId = (line as any).request_id ?? '';

        if (req.subtype === 'request_user_dialog') {
          handle.cancelUserDialog(requestId);
          services.chat.sendBlockMessage({ threadId, text: 'Claude Code requested a dialog that this app cannot display. The request was cancelled.', blocks: [], forkable: false });
          continue;
        }

        // Reject malformed requests missing a tool name.
        if (!req.tool_name) {
          log.warn('control_request missing tool_name, denying', { requestId });
          handle.respond(requestId, { behavior: 'deny', message: 'Invalid request: missing tool_name' });
          continue;
        }

        // Auto-approve plan-file writes during plan phase.
        if (phase === 'Plan' && req.subtype === 'can_use_tool' && isPlanFileWrite(req.tool_name, req.input)) {
          log.debug('auto-approved plan-file write', { tool: req.tool_name });
          handle.respond(requestId, { behavior: 'allow', updatedInput: req.input });
          continue;
        }

        // Read permission state once for all auto-approve checks below.
        const ccState = getClaudeState(services, threadId as string);
        const permMode = ccState?.permissionMode ?? 'acceptEdits';

        // Auto-approve tool requests when bypass mode is active (mid-turn aware).
        // Exclude interaction-point tools that aren't permission prompts.
        if (req.subtype === 'can_use_tool' && !DONT_BYPASS.has(req.tool_name) && permMode === 'bypassPermissions') {
          log.debug('bypass: auto-approved tool', { tool: req.tool_name });
          handle.respond(requestId, { behavior: 'allow', updatedInput: req.input });
          continue;
        }

        // Auto-approve file edits when permission mode is 'acceptEdits'
        // (the "Auto" toggle) OR the user opted in mid-turn.
        if (req.subtype === 'can_use_tool' && FILE_MUTATION_TOOLS.has(req.tool_name)) {
          if (ccState?.autoAcceptEdits || permMode === 'acceptEdits') {
            log.debug('auto-approved file edit', { tool: req.tool_name, source: ccState?.autoAcceptEdits ? 'mid-turn' : 'setting' });
            handle.respond(requestId, { behavior: 'allow', updatedInput: req.input });
            continue;
          }
        }

        // Freeze the tool-activity block so it stops showing "Working…".
        writer.flush();
        finaliseThinking();
        toolActivity.finalise('done');

        // Send the appropriate interactive block.
        let approvalMessageId: string;

        if (req.tool_name === 'ExitPlanMode') {
          const parsed = parseExitPlanModeInput(req.input ?? {});
          // Grab git branch + PR for the plan header (best-effort, non-blocking).
          let planBranch: string | undefined;
          let planPR: string | undefined;
          try {
            planBranch = await services.cli.git.getCurrentBranch();
            const pr = await services.cli.gh.findPRForBranch(planBranch);
            if (pr?.number) planPR = String(pr.number);
          } catch { /* non-critical */ }
          createPlanDraft(services, threadId, parsed.plan, undefined, {
            branch: planBranch,
            prNumber: planPR,
          });
          const planContext = buildPlanApprovalContext(parsed);
          const approval = services.chat.sendBlockMessage({
            threadId,
            text: 'Claude Code is ready to implement — review the plan and approve.',
            blocks: [
              { type: 'markdown', props: { content: planContext, label: 'Plan' } },
              { type: 'prompt', props: { content: 'Approve this plan and start implementing?' } },
              { type: 'approval', props: {
                options: [
                  { label: 'Yes, start a new thread and auto-accept edits', variant: 'primary', flags: { clearContext: true, autoAccept: true } },
                  { label: 'Yes, auto-accept edits', variant: 'secondary', flags: { autoAccept: true } },
                  { label: 'Deny', variant: 'neutral', flags: { approved: false } },
                ],
              } },
            ],
            forkable: false,
            autoHide: true,
            asUser: true,
          });
          approvalMessageId = approval.messageId;
        } else if (req.tool_name === 'AskUserQuestion') {
          const { questions } = parseAskUserQuestionInput(req.input ?? {});
          // Guard: if the CLI sends an AskUserQuestion with no parseable questions,
          // auto-approve rather than rendering an empty block.
          if (questions.length > 0) {
            const questionMsg = services.chat.sendQuestionBlock({
              threadId,
              text: questions[0].header || 'Select an option',
              prompt: questions[0].header || 'Select an option',
              questions: questions.map(q => ({
                question: q.question,
                header: q.header,
                options: q.options.map(o => ({ id: o.label, label: o.label, description: o.description || undefined })),
                multiSelect: q.multiSelect,
                allowCustom: true,
              })),
              forkable: false,
              autoHide: true,
              asUser: true,
            });
            approvalMessageId = questionMsg.messageId;
          } else {
            handle.respond(requestId, { behavior: 'allow', updatedInput: req.input });
            continue;
          }
        } else {
          const approval = services.chat.sendBlockMessage({
            threadId,
            text: `Claude Code wants to run ${req.tool_name}`,
            blocks: [
              { type: 'prompt', props: { content: `Allow \`${req.tool_name}\`?` } },
              { type: 'tool-input' as any, props: { toolName: req.tool_name, input: req.input } },
              { type: 'approval', props: { requireReason: false, allowReason: false, autoAcceptOption: FILE_MUTATION_TOOLS.has(req.tool_name) } },
            ],
            forkable: false,
            autoHide: true,
            asUser: true,
          });
          approvalMessageId = approval.messageId;
        }

        log.debug('interactive block sent for control_request', {
          requestId,
          toolName: req.tool_name,
          approvalMessageId,
        });

        // Critical state: must be set before user can respond.
        persistClaudeState(services, threadId, {
          pendingControlRequest: {
            requestId,
            approvalMessageId,
            toolName: req.tool_name ?? 'unknown',
            originalInput: req.input ?? {},
          },
        });
        setRunning(services, threadId, false);

        splitOnNextMessageStart = true;
        // After plan approval, the agent transitions to the edit phase.
        if (req.tool_name === 'ExitPlanMode') phase = 'Edit';
        // Emit to flow → CC: Stream Paused action updates artifact status.
        services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
          eventType: 'cc.stream.paused',
          payload: { threadId, toolName: req.tool_name ?? 'unknown' },
        });
        continue;
      }

      // ─── Control cancellation (surfaced by pump) ───────────────────
      if (line.type === 'control_cancel_request') {
        if (stillCurrent()) cancelPendingControlRequest(services, threadId, line.request_id);
        continue;
      }

      if (line.type === 'tool_use_summary') {
        const ids: string[] = Array.isArray(line.preceding_tool_use_ids)
          ? line.preceding_tool_use_ids
          : [];
        const summaryText: string = typeof line.summary === 'string' ? line.summary : '';
        if (!summaryText) continue;
        for (const id of ids) {
          toolActivity.update(id, { outputSummary: summaryText });
        }
        continue;
      }

      // The `result` event is the CLI's terminal signal. Extract cost/duration
      // directly — handle.result may reject for error subtypes, losing this data.
      if (line.type === 'result') {
        log.debug('result line received', {
          subtype: (line as any).subtype,
          total_cost_usd: (line as any).total_cost_usd,
          modelUsage: (line as any).modelUsage ? Object.keys((line as any).modelUsage) : undefined,
          duration_ms: (line as any).duration_ms,
          num_turns: (line as any).num_turns,
          result: ((line as any).result || '').slice(0, 200),
          errors: (line as any).errors,
        });
        resultFromLine = {
          sessionId: (line as any).session_id ?? '',
          text: (line as any).result ?? '',
          totalCostUsd: Math.max(0, ((line as any).total_cost_usd || sumModelUsageCost((line as any).modelUsage)) - (ctx.costBaseline ?? 0)),
          durationMs: (line as any).duration_ms ?? 0,
          subtype: (line as any).subtype,
          isError: (line as any).is_error === true,
          errors: (line as any).errors,
        };
        // Native background completion can trigger another assistant turn after this result.
        if (!ctx.persistent && (line as any).subtype === 'success' && (line as any).is_error !== true && handle.hasPendingBackgroundTasks(line)) {
          splitOnNextMessageStart = true;
          continue;
        }
        break;
      }
    }

    if (!stillCurrent()) throw new Error('Claude turn was superseded before finalization');

    // ─── Stream drained — check for silent failures ─────────────────────
    // If no events arrived, the CLI likely failed immediately (wrong binary,
    // auth error, protocol mismatch, etc.). Await handle.result to surface
    // the actual error (exit code + stderr) instead of silently completing.
    if (eventCount === 0) {
      await handle.result;
    }

    // ─── Stream drained — finalize ─────────────────────────────────────
    // Use the result data extracted directly from the result line in the loop.
    // No need to await handle.result — it may reject for error subtypes
    // (error_during_execution, etc.) or SIGTERM kills, losing cost/duration.
    const result = resultFromLine ?? { sessionId: '', text: '', totalCostUsd: 0, durationMs: 0 };
    log.debug('stream drained', {
      eventCount,
      sessionId: result.sessionId,
      costUsd: result.totalCostUsd,
      durationMs: result.durationMs,
    });

    // ─── Error-result guard: don't re-persist broken sessions ─────────
    // The CLI emits `subtype: 'error_during_execution'` (or similar non-success
    // subtypes) when it fails to load/resume a session. Without this guard,
    // the broken sessionId gets re-persisted at line ~540, locking the thread
    // to a permanently un-resumable session.
    const isErrorResult = result.isError === true || (result.subtype != null && result.subtype !== 'success');

    collectNestedAccounting();
    const hadToolErrors = nestedToolErrors || priorSegmentsHadToolErrors || toolActivity.entries.some(e => e.status === 'error');

    if (isErrorResult) {
      const errorText = result.errors?.length ? result.errors.join('; ') : result.text || `CLI error: ${result.subtype}`;
      log.error('CLI returned error result', {
        subtype: result.subtype,
        errors: result.errors,
        eventCount,
        resumeSessionId: ctx.resumeSessionId ?? null,
        sessionCwd: ctx.sessionCwd ?? null,
        isFork: ctx.isFork ?? false,
        revertCliUuid: ctx.revertCliUuid ?? null,
        forkCliUuid: ctx.forkCliUuid ?? null,
      });

      finalizeSessionError(services, threadId, writer, errorText, undefined, { isHistoryChange: !!ctx.isFork });

      finaliseThinking();
      toolActivity.finalise('error');
      services.chat.updateMessageState(currentMessageId as any, { forkable: currentMessageHasCliUuid } as any);
    } else {
      // Critical state: persist sessionId for resume.
      if (result.sessionId) {
        persistClaudeState(services, threadId, {
          sessionId: result.sessionId,
          lastTurnAt: Date.now(),
        });
      }

      // Finalize writers (needs closure references).
      finaliseThinking();
      toolActivity.finalise(hadToolErrors ? 'error' : 'done');
      // If the stream produced text (either via streamed deltas into `writer`
      // or a terminal `result.result` string), finalize with it. Otherwise
      // leave `text` untouched and mark the message complete — mirrors the
      // paused-turn guard in the catch branch below (lines ~506-516). Without
      // this check, tool-only turns or turns where the CLI's assistant prose
      // arrived on a non-streaming code path would clobber the "Thinking…"
      // placeholder with an empty string.
      if (writer.text || result.text) {
        writer.finalize(writer.text || result.text);
        services.chat.updateMessageState(currentMessageId as any, { forkable: currentMessageHasCliUuid } as any);
      } else {
        services.chat.updateMessageState(currentMessageId as any, {
          responseTimestamp: Date.now(),
          forkable: currentMessageHasCliUuid,
        } as any);
      }
    }
    log.debug('stream consumer completed');

    // Close stdin so the CLI subprocess exits cleanly (prevents child leak).
    if (!ctx.persistent) {
      try { await handle.close(); } catch (closeErr: any) {
        log.debug('handle.close failed', { message: closeErr?.message });
      }
    }

    // Superseded by killTurn() + a new turn (e.g. user sent a new message
    // while awaiting permission). Writer finalization above applied to our
    // own message; do NOT touch thread-scoped state (clearHandle / isRunning)
    // or emit cc.stream.completed — those belong to the new turn's consumer.
    if (!stillCurrent()) {
      log.debug('stream consumer superseded before completion — skipping thread cleanup & emit');
      return;
    }

    // Critical cleanup: clear handle, mark not running, reset mid-turn flags, drain queue.
    // Dequeue before setRunning(false) to close the race window where a new
    // message could interleave between the two calls.
    (services.cli as any).claudeCode.clearHandle(threadId);
    const queued = dequeueMessage(services, threadId);
    persistClaudeState(services, threadId, { isRunning: false, autoAcceptEdits: undefined });
    if (queued) await replayQueuedMessage(services, threadId, queued, log);

    // Emit to flow → CC: Turn Completed action handles:
    //   updateClaudeState, diff artifact
    services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
      eventType: 'cc.stream.completed',
      payload: {
        threadId,
        sessionId: result.sessionId,
        costUsd: result.totalCostUsd,
        durationMs: result.durationMs,
        toolCallCount: priorSegmentToolCount + toolActivity.entries.length + nestedToolCount,
        mutatedFileCount: mutatedPaths.length,
        mutatedPaths,
        hadErrors: !!hadToolErrors || !!isErrorResult,
        userText: text,
      },
    });

    // Fire-and-forget: read native context in the background AFTER all turn
    // cleanup (clearHandle, setRunning, queued replay, cc.stream.completed)
    // so a concurrent new turn doesn't race with this instance for the
    // same session JSONL.
    if (!isErrorResult && result.sessionId) {
      void refreshThreadContextUsage(services, threadId, { sessionId: result.sessionId, cwd: ctx.sessionCwd })
        .catch(err => log.debug('native context summary failed (non-critical)', { message: err?.message }));
    }

  } catch (err: any) {
    const message = err?.message || 'Claude Code request failed';

    // If the handle has been cleared by another operation (revert,
    // summarize, or a new turn replacing this one), this consumer is
    // superseded. The superseding operation already handled state cleanup
    // and the placeholder message may have been soft-deleted — touching
    // any shared state or emitting events could corrupt the session.
    if (!stillCurrent()) {
      log.debug('stream consumer superseded — finalizing message, skipping thread cleanup');
      // Finalize the message so "Thinking…" doesn't persist if not soft-deleted.
      // Thread-scoped state (handle, isRunning, cc.stream.completed) is left to
      // whoever superseded this consumer.
      finaliseThinking();
      toolActivity.finalise('done');
      services.chat.updateMessageState(currentMessageId as any, {
        responseTimestamp: Date.now(),
        forkable: currentMessageHasCliUuid,
      } as any);
      return;
    }

    collectNestedAccounting();

    // If pause-turn already ran (isRunning=false), the kill was intentional.
    // Finalize writers cleanly and skip cleanup — pause-turn handled it.
    const state = getClaudeState(services, threadId);
    if (!state?.isRunning) {
      log.debug('stream consumer exiting — turn was paused');
      finaliseThinking();
      const segmentHadErrors = nestedToolErrors || toolActivity.entries.some(e => e.status === 'error');
      toolActivity.finalise(segmentHadErrors ? 'error' : 'done');
      if (writer.text) {
        writer.finalize(writer.text);
        services.chat.updateMessageState(currentMessageId as any, { forkable: currentMessageHasCliUuid } as any);
      } else {
        // Nothing streamed — don't let the writer overwrite the "Thinking…"
        // placeholder with its empty buffer. Mark the message complete in one shot.
        services.chat.updateMessageState(currentMessageId as any, {
          responseTimestamp: Date.now(),
          forkable: currentMessageHasCliUuid,
        } as any);
      }

      // Emit cc.stream.completed so Turn Completed updates the thread context
      // (turn count, tool call count, cost). Cost is best-effort: resultFromLine
      // is only set if the CLI's terminal `result` event arrived before the kill
      // signal took effect — typically it hasn't, so cost will be 0.
      services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
        eventType: 'cc.stream.completed',
        payload: {
          threadId,
          sessionId: resultFromLine?.sessionId || state?.sessionId || '',
          costUsd: resultFromLine?.totalCostUsd ?? 0,
          durationMs: resultFromLine?.durationMs ?? 0,
          toolCallCount: priorSegmentToolCount + toolActivity.entries.length + nestedToolCount,
          mutatedFileCount: mutatedPaths.length,
          mutatedPaths,
          hadErrors: !!segmentHadErrors,
          userText: text,
        },
      });

      return;
    }

    // Real error — not a user-initiated pause.
    log.error('stream consumer failed', { message, stack: err?.stack });
    finaliseThinking();
    toolActivity.finalise('error');

    // Session-not-found mid-stream: clear stale session and mark broken.
    finalizeSessionError(services, threadId, writer, message, writer.text, { isHistoryChange: !!ctx.isFork });
    services.chat.updateMessageState(currentMessageId as any, { forkable: currentMessageHasCliUuid } as any);

    // Kill the CLI subprocess on error (it may be in a bad state).
    try { handle.kill(); } catch { /* already gone */ }

    // Critical cleanup — dequeue before setRunning(false) to avoid race.
    (services.cli as any).claudeCode.clearHandle(threadId);
    const queued = dequeueMessage(services, threadId);
    persistClaudeState(services, threadId, { isRunning: false, autoAcceptEdits: undefined });
    if (queued) await replayQueuedMessage(services, threadId, queued, log);

    // Emit to flow → CC: Turn Completed action handles:
    //   updateChatState(services, threadId, 'idle')
    services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
      eventType: 'cc.stream.completed',
      payload: { threadId, hadErrors: true, error: message },
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Finalize a session error: detect stale sessions, display warning, and mark
 * the session broken. Shared by the success-path error-result handler and the
 * catch-path error handler.
 */
export function finalizeSessionError(
  services: Services,
  threadId: EntityId,
  writer: ReturnType<typeof createStreamWriter>,
  errorText: string,
  prefix?: string,
  context?: { isHistoryChange?: boolean },
): void {
  const staleId = extractStaleSessionId(errorText);
  let warning: string;
  if (context?.isHistoryChange) {
    warning = `Could not apply the requested history change: ${errorText} Reset or resume a session before continuing.`;
  } else if (staleId) {
    warning = '⚠️ Session expired — the conversation file was deleted or is invalid. Your next message will start a fresh session in the same project directory. Previous messages are still visible for reference.';
  } else {
    warning = `⚠️ ${errorText}`;
  }

  writer.finalize(prefix ? `${prefix}\n\n${warning}`.trim() : warning);
  if (context?.isHistoryChange) {
    persistClaudeState(services, threadId, {historyError: errorText});
    updateChatState(services, threadId, 'error');
    return;
  }
  markSessionBroken(services, threadId, staleId ? `Session ${staleId} not found` : errorText);
}

/**
 * Replay a previously-dequeued message by re-invoking the chat action.
 *
 * The caller dequeues the message *before* calling `setRunning(false)` so
 * there is no race window where a new incoming message could interleave.
 */
export async function replayQueuedMessage(
  services: Services,
  threadId: EntityId,
  queued: { text: string; mode?: string; phase?: string; messageId?: string; references?: any },
  log: any,
): Promise<void> {
  log.debug('draining queued message', { threadId, textLen: queued.text?.length });
  if (queued.messageId) {
    services.chat.updateMessageState(queued.messageId as any, { status: null } as any);
  }

  try {
    await services.action.executeIfFound('Claude Code Chat', {
      threadId,
      text: queued.text,
      mode: queued.mode,
      phase: queued.phase,
      messageId: queued.messageId,
      references: queued.references,
    });
  } catch (drainErr: any) {
    // If the replayed chat action threw *before* its own try/catch (lines
    // 137-234 of chat.ts — setRunning / placeholder / artifact setup), it
    // leaves isRunning=true and chatState='working' behind with no turn
    // actually running. Every subsequent user message would then queue
    // forever. Normalise state and surface the failure to the thread.
    const message = drainErr?.message || 'Queued message replay failed';
    log.error('queued message drain failed', { message, stack: drainErr?.stack });
    persistClaudeState(services, threadId, { isRunning: false, autoAcceptEdits: undefined });
    updateChatState(services, threadId, 'idle');
    services.chat.sendBlockMessage({
      threadId,
      text: `⚠️ Couldn't handle queued message: ${message}`,
      blocks: [],
      forkable: false,
    });
  }
}

/** Extract primary field from tool input for the inline tool-use note. */
function shortenInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  const primary = (input as any).path || (input as any).file_path || (input as any).command || (input as any).pattern;
  if (typeof primary === 'string') return primary;
  return keys.slice(0, 3).join(', ');
}

/**
 * Normalise a `tool_result` block's `content` field to a plain string.
 */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text?: unknown }).text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Strip the `<tool_use_error>…</tool_use_error>` envelope the CLI wraps
 * around tool-failure messages.
 */
function stripToolUseErrorEnvelope(raw: string): string {
  const m = raw.match(/^\s*<tool_use_error>([\s\S]*?)<\/tool_use_error>\s*$/);
  return m ? m[1].trim() : raw.trim();
}
