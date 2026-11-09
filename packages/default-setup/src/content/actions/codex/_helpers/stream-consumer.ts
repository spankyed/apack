/**
 * Callback-based stream consumer for the Codex app-server.
 *
 * Unlike the exec-based consumer (which used `for await` over an AsyncGenerator),
 * the app-server routes notifications to registered consumers via callbacks.
 * This module creates the handlers that process notifications and approval
 * requests, driving the writers and emitting brain events.
 */

import type { Services, EntityId } from '#generated/services.ts';
import type { StreamWriter } from '../../claude-code/_helpers/stream-writer.ts';
import type { ToolActivityWriter } from '../../claude-code/_helpers/tool-activity-writer.ts';
import type { ThinkingWriter } from '../../claude-code/_helpers/thinking-writer.ts';
import {
  persistCodexState,
  getCodexState,
  dequeueMessage,
  updateChatState,
} from './thread-context.ts';

export interface ConsumerContext {
  services: Services;
  /** App-level thread entity ID (not Codex thread ID). */
  threadId: EntityId;
  /** Codex app-server thread ID. */
  codexThreadId: string;
  /** Original user message text. */
  text: string;
  /** Current phase — 'plan' triggers plan approval flow on turn completion. */
  phase?: string;
  /** When true, finalize creates a compact marker instead of a normal completion. */
  isCompaction?: boolean;
}

export interface ConsumerWriters {
  writer: StreamWriter;
  toolActivity: ToolActivityWriter;
  thinking: ThinkingWriter;
  messageId: EntityId;
}

interface ConsumerHandlers {
  onNotification(method: string, params: any): void;
  onApproval(method: string, requestId: number, params: any): void;
  onCrash?(error: string): void;
  onUnregistered?(): void;
}

/**
 * Create a callback-based stream consumer. Returns handlers to register
 * with the app-server and a finalize function for cleanup.
 */
export function createStreamConsumer(
  ctx: ConsumerContext,
  writers: ConsumerWriters,
): { handlers: ConsumerHandlers; finalize(): void } {
  const { services, threadId, codexThreadId, text, phase, isCompaction } = ctx;
  const { writer, toolActivity, thinking, messageId } = writers;
  const log = services.logger;
  const isPlanMode = phase === 'plan';

  // Ownership check — prevents stale consumers from corrupting state
  const stillCurrent = () =>
    getCodexState(services, threadId as string)?.activeMessageId === (messageId as string);

  const mutatedPaths: string[] = [];
  const mutatedPathsSet = new Set<string>();
  let toolCallCount = 0;
  let hadErrors = false;
  let usage: { input: number; output: number; reasoning?: number } | undefined;
  const recentTools: Array<{ name: string; summary: string; at: number }> = [];
  let placeholderCleared = false;
  let activeAgentMessageItemId: string | undefined;
  const commandOutputBuffers = new Map<string, { output: string; command?: string; cwd?: string }>();

  // Plan mode state — accumulate plan text from item/plan/delta
  let planText = '';

  /**
   * Drops the `Thinking…` placeholder, once, and **only while the reply is still empty**.
   *
   * A write of `text` replaces the field and drops the segments the stream writer has appended to it,
   * while the writer goes on counting from the offset it thinks the row holds — so clearing after any
   * reply text has arrived loses it and puts the rest at an offset the row no longer has. Whole-field
   * writes used to heal that by rewriting everything; appends do not.
   */
  const clearPlaceholder = () => {
    if (!placeholderCleared && !writer.text) {
      placeholderCleared = true;
      services.chat.updateMessageState(messageId as any, { text: '' });
    }
  };

  const finaliseThinking = () => { if (thinking.isStreaming) thinking.finalise(); };

  // ─── Notification handler ───────────────────────────────────────────

  const onNotification = (method: string, params: any): void => {
    switch (method) {
      case 'item/agentMessage/delta': {
        const { delta, phase, itemId } = params;
        if (!delta) break;
        if (phase === 'reasoning') {
          clearPlaceholder();
          thinking.push(delta);
        } else {
          clearPlaceholder();
          finaliseThinking();
          if (itemId && activeAgentMessageItemId && itemId !== activeAgentMessageItemId && writer.text.trim()) {
            writer.push(writer.text.endsWith('\n') ? '\n' : '\n\n');
          }
          if (itemId) activeAgentMessageItemId = itemId;
          writer.push(delta);
        }
        break;
      }

      case 'item/agentMessage/completed': {
        finaliseThinking();
        writer.flush();
        activeAgentMessageItemId = undefined;
        break;
      }

      case 'item/plan/delta': {
        const delta = params.delta as string | undefined;
        if (delta) {
          planText += delta;
          clearPlaceholder();
          finaliseThinking();
          writer.push(delta);
        }
        break;
      }

      case 'item/commandExecution/delta': {
        const { delta, itemId } = params;
        if (!delta || !itemId) break;
        const buf = commandOutputBuffers.get(itemId);
        if (buf) {
          buf.output += delta;
          toolActivity.update(itemId, {
            details: { input: { command: buf.command, cwd: buf.cwd }, output: buf.output },
          });
        }
        break;
      }

      case 'item/started': {
        const item = params.item;
        if (!item) break;

        switch (item.type) {
          case 'commandExecution':
            toolCallCount++;
            finaliseThinking();
            writer.flush();
            commandOutputBuffers.set(item.id, { output: '', command: item.command, cwd: item.cwd });
            toolActivity.append({
              id: item.id,
              tool: 'command',
              summary: item.command || '',
              status: 'running',
              details: { input: { command: item.command, cwd: item.cwd } },
            });
            break;

          case 'fileChange':
            toolCallCount++;
            finaliseThinking();
            writer.flush();
            toolActivity.append({
              id: item.id,
              tool: 'file_change',
              summary: 'File changes',
              status: 'running',
            });
            break;

          case 'mcpToolCall':
            toolCallCount++;
            finaliseThinking();
            writer.flush();
            toolActivity.append({
              id: item.id,
              tool: `${item.server || 'mcp'}/${item.tool || '?'}`,
              summary: item.tool || '',
              status: 'running',
              details: { input: item.arguments },
            });
            break;
        }
        break;
      }

      case 'item/completed': {
        const item = params.item;
        if (!item) break;

        switch (item.type) {
          case 'commandExecution': {
            commandOutputBuffers.delete(item.id);
            const ok = item.status === 'completed' && (item.exitCode === 0 || item.exitCode == null);
            toolActivity.update(item.id, {
              status: ok ? 'ok' : 'error',
              details: { input: { command: item.command }, output: item.aggregatedOutput || '' },
            });
            recentTools.push({ name: 'command', summary: item.command || '', at: Date.now() });
            if (!ok) hadErrors = true;
            break;
          }

          case 'fileChange': {
            const changes = item.changes || [];
            for (const change of changes) {
              if (typeof change.path === 'string' && !mutatedPathsSet.has(change.path)) {
                mutatedPathsSet.add(change.path);
                mutatedPaths.push(change.path);
              }
            }
            const summary = changes.map((c: any) => `${c.kind}: ${c.path}`).join(', ');
            toolActivity.update(item.id, {
              summary: summary || 'File changes',
              status: item.status === 'completed' ? 'ok' : 'error',
            });
            recentTools.push({ name: 'file_change', summary: summary || 'File changes', at: Date.now() });
            if (item.status !== 'completed') hadErrors = true;
            break;
          }

          case 'mcpToolCall': {
            const toolName = `${item.server || 'mcp'}/${item.tool || '?'}`;
            toolActivity.update(item.id, {
              status: item.status === 'completed' ? 'ok' : 'error',
              ...(item.error ? { details: { output: item.error.message } } : {}),
            });
            recentTools.push({ name: toolName, summary: item.tool || '', at: Date.now() });
            break;
          }
        }
        break;
      }

      case 'item/autoApprovalReview/completed': {
        const review = params.review;
        if (review?.status !== 'approved') hadErrors = true;
        break;
      }

      case 'guardianWarning': {
        log.info('[codex consumer] guardian warning', { message: params.message });
        break;
      }

      case 'turn/started': {
        const turnId = params.turn?.id;
        if (turnId) {
          persistCodexState(services, threadId as string, { turnId });
          (services.codex as any).storeHandle(threadId, {
            codexThreadId,
            turnId,
            abort: () => (services.codex as any).interruptTurn(codexThreadId, turnId),
          });
        }
        updateChatState(services, threadId, 'working');
        break;
      }

      case 'turn/completed': {
        if (params.turn?.status === 'interrupted') {
          hadErrors = false;
        } else if (params.turn?.status === 'failed') {
          hadErrors = true;
        }

        // Plan mode: show plan approval block instead of immediately finalizing
        if (isPlanMode && planText.trim() && !hadErrors && params.turn?.status !== 'interrupted') {
          finalizePlan();
        } else {
          finalize();
        }
        break;
      }

      case 'thread/tokenUsage/updated': {
        if (params.tokenUsage) {
          usage = {
            input: params.tokenUsage.inputTokens || 0,
            output: params.tokenUsage.outputTokens || 0,
            reasoning: params.tokenUsage.reasoningTokens || 0,
          };
        }
        break;
      }

      case 'error': {
        hadErrors = true;
        log.error('[codex consumer] error notification', { message: params.message || params.error?.message });
        finalize();
        break;
      }
    }
  };

  // ─── Approval handler ───────────────────────────────────────────────

  const onApproval = (method: string, requestId: number, params: any): void => {
    log.info('[codex consumer] approval request', { method, requestId, threadId });

    // Freeze writers
    toolActivity.flush();
    finaliseThinking();

    const isCommand = method === 'item/commandExecution/requestApproval';
    const reason = params.reason || '';

    // Build approval text with details
    let approvalText: string;
    let summary: string;
    if (isCommand) {
      approvalText = `Codex wants to run: \`${params.command || '?'}\``;
      summary = params.command || '';
    } else {
      // Extract file paths from params for file change approvals
      const files: string[] = [];
      if (Array.isArray(params.changes)) {
        for (const c of params.changes) {
          if (typeof c?.path === 'string') files.push(c.path);
          else if (typeof c === 'string') files.push(c);
        }
      } else if (Array.isArray(params.files)) {
        for (const f of params.files) {
          if (typeof f === 'string') files.push(f);
          else if (typeof f?.path === 'string') files.push(f.path);
        }
      } else if (typeof params.path === 'string') {
        files.push(params.path);
      }

      if (files.length > 0) {
        const fileList = files.map(f => `\`${f}\``).join(', ');
        approvalText = `Codex wants to modify: ${fileList}`;
        summary = files.join(', ');
      } else {
        approvalText = 'Codex wants to modify files';
        summary = 'File changes';
      }
    }

    // Append reason if present
    if (reason) approvalText += `\n\n**Reason:** ${reason}`;

    // Auto-approve if auto_review mode is active (except plan approvals)
    const currentState = getCodexState(services, threadId as string);
    if (currentState?.approvalMode === 'auto_review' && method !== 'plan/approval') {
      try {
        (services.codex as any).respondToApproval(requestId, 'acceptForSession');
      } catch { /* app-server may be gone */ }

      const asideText = `✓ Approved — ${summary || 'tool request'}`;
      services.chat.sendBlockMessage({
        threadId,
        text: approvalText,
        blocks: [{
          type: 'approval',
          props: {
            content: reason,
            options: [
              { label: 'Allow', variant: 'primary', flags: { decision: 'accept' } },
              { label: 'Allow for session', variant: 'neutral', flags: { decision: 'acceptForSession' } },
              { label: 'Deny', variant: 'danger', flags: { decision: 'decline' } },
            ],
          },
        }],
        forkable: false,
        autoHide: true,
        asUser: true,
        asideText,
        asideContext: summary,
        state: {
          responseTimestamp: Date.now(),
          blockResponse: { approved: true, decision: 'acceptForSession' },
          asideText,
        },
      } as any);

      return;
    }

    // Send approval block to chat
    const approvalMsg = services.chat.sendBlockMessage({
      threadId,
      text: approvalText,
      blocks: [{
        type: 'approval',
        props: {
          content: reason,
          options: [
            { label: 'Allow', variant: 'primary', flags: { decision: 'accept' } },
            { label: 'Allow for session', variant: 'neutral', flags: { decision: 'acceptForSession' } },
            { label: 'Deny', variant: 'danger', flags: { decision: 'decline' } },
          ],
        },
      }],
      forkable: false,
      autoHide: true,
      asUser: true,
      asideContext: summary,
    } as any);

    // Persist pending approval state
    persistCodexState(services, threadId as string, {
      pendingApproval: {
        requestId,
        method,
        approvalMessageId: approvalMsg.messageId as string,
        summary,
        reason,
      },
      isRunning: false,
    });

    // Notify flow
    services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
      eventType: 'cdx.stream.paused',
      payload: { threadId, method, requestId },
    });
  };

  // ─── Plan approval gate ────────────────────────────────────────────

  function finalizePlan(): void {
    if (finalized) return;
    finalized = true;

    // Finalize writers — plan text was already streamed to the message
    finaliseThinking();
    writer.finalize(writer.text);
    toolActivity.finalise('done');
    services.chat.updateMessageState(messageId as any, { forkable: true } as any);

    if (!stillCurrent()) return;

    // Unregister consumer — the plan turn is fully complete
    try { (services.codex as any).unregisterConsumer(codexThreadId); } catch { /* ok */ }
    (services.codex as any).clearHandle(threadId);

    // Send plan approval block with feedback input
    const approvalMsg = services.chat.sendBlockMessage({
      threadId,
      text: 'Codex has a plan — review and approve, or provide feedback to refine it.',
      blocks: [
        { type: 'markdown', props: { content: planText.trim(), label: 'Plan' } },
        { type: 'prompt', props: { content: 'Approve this plan, or suggest changes.' } },
        { type: 'text', props: { placeholder: 'Suggest changes to the plan...', multiline: true } },
        { type: 'approval', props: {
          options: [
            { label: 'Approve', variant: 'primary', flags: { decision: 'accept' } },
            { label: 'Deny', variant: 'neutral', flags: { decision: 'decline' } },
          ],
        } },
      ],
      forkable: false,
      autoHide: true,
      asUser: true,
    });

    // Store as a pending plan approval (reuse pendingApproval with requestId = -1 sentinel)
    persistCodexState(services, threadId as string, {
      isRunning: false,
      turnId: undefined,
      activeMessageId: undefined,
      pendingApproval: {
        requestId: -1, // sentinel: plan approval, not a server-side request
        method: 'plan/approval',
        approvalMessageId: approvalMsg.messageId as string,
        summary: 'Plan approval',
      },
    });

    services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
      eventType: 'cdx.stream.paused',
      payload: { threadId, method: 'plan/approval', requestId: -1 },
    });
  }

  // ─── Crash handler ─────────────────────────────────────────────────

  const onCrash = (error: string): void => {
    log.error('[codex consumer] app-server crashed', { threadId, error });
    hadErrors = true;
    clearPlaceholder();
    finaliseThinking();
    writer.push(`\n\n--- App-server crashed: ${error} ---`);
    finalize();
  };

  // ─── Finalize ───────────────────────────────────────────────────────

  let finalized = false;
  function finalize(): void {
    if (finalized) return;
    finalized = true;

    // Always finalize writers (safe even if superseded)
    finaliseThinking();
    writer.finalize(writer.text);
    toolActivity.finalise(hadErrors ? 'error' : 'done');
    services.chat.updateMessageState(messageId as any, { forkable: true } as any);

    // Guard: only mutate shared state if we still own the handle.
    // If a new turn was started, our handle was replaced and we must
    // not clear it or overwrite isRunning/turnId.
    if (!stillCurrent()) return;

    // Compaction: create marker with summary text (hides all prior messages)
    if (isCompaction && writer.text.trim() && !hadErrors) {
      services.chat.createMarkerMessage({
        threadId,
        text: writer.text.trim(),
      });
    }

    // Unregister consumer
    try { (services.codex as any).unregisterConsumer(codexThreadId); } catch { /* ok */ }
    (services.codex as any).clearHandle(threadId);

    // Dequeue before clearing isRunning to avoid a race where a new incoming
    // message could interleave with the queued replay.
    const queued = dequeueMessage(services, threadId as string);

    persistCodexState(services, threadId as string, { isRunning: false, turnId: undefined, activeMessageId: undefined });

    if (queued) {
      void replayQueuedMessage(services, threadId, queued, log);
    }

    services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
      eventType: 'cdx.stream.completed',
      payload: {
        threadId, text, usage, hadErrors,
        mutatedPaths, toolCallCount,
        recentTools: recentTools.slice(-5),
      },
    });
  }

  // **`onUnregistered` is the release, and it is why `finalize` is idempotent.** `killTurn` interrupts the
  // turn and unregisters, so `turn/completed` never arrives and nothing else would finalise — the message
  // was left with a stale tail and no `responseTimestamp`. A turn that ends through a notification
  // finalises there and this does nothing
  return { handlers: { onNotification, onApproval, onCrash, onUnregistered: finalize }, finalize };
}

export async function replayQueuedMessage(
  services: Services,
  threadId: EntityId,
  queued: { text: string; mode?: string; phase?: string; messageId?: string; references?: any },
  log: any,
): Promise<void> {
  log.info('[codex consumer] replaying queued message', { threadId });
  if (queued.messageId) {
    services.chat.updateMessageState(queued.messageId as any, { status: null } as any);
  }

  try {
    await services.action.executeIfFound('Codex Chat', {
      threadId,
      text: queued.text,
      mode: queued.mode || 'Codex',
      phase: queued.phase,
      messageId: queued.messageId,
      references: queued.references,
    });
  } catch (drainErr: any) {
    const message = drainErr?.message || 'Queued message replay failed';
    log.error('[codex consumer] queued message drain failed', { message, stack: drainErr?.stack });
    persistCodexState(services, threadId as string, { isRunning: false });
    updateChatState(services, threadId, 'idle');
    services.chat.sendBlockMessage({
      threadId,
      text: `⚠️ Couldn't handle queued message: ${message}`,
      blocks: [],
      forkable: false,
    });
  }
}
