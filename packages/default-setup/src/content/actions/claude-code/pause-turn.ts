/**
 * Pause active native work through its original turn handle; print sessions and
 * tool-approval cancellation retain their process-stop lifecycle. Incoming MCP dialogs
 * can outlive their tool turn and are retired by their captured request identity.
 */

import { z } from 'zod';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

const nativeQuestionScope = z.object({ ownerId: z.string().min(1).max(512), sessionId: z.string().min(1).max(512), messageId: z.string().min(1).max(512), id: z.string().min(1).max(512), revision: z.string().min(1).max(512), requestId: z.string().min(1).max(512) }).strict();

export const meta: ActionMeta = {
  label: 'CC: Pause Turn',
  description: 'Interrupts active Claude Code work on user pause.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    nativeQuestion: { type: 'object', description: 'Captured native question identity for an addressed Cancel', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId } = params as { threadId: string };

  if (!threadId) return { success: false, reason: 'missing threadId' };

  // Busy metadata can lag submission; an explicit Pause targets the owning native process.
  const prior = getClaudeState(services, threadId);
  const native = services.cli.claudeCode.getNativeTerminal(threadId);
  if (params.nativeQuestion !== undefined) {
    const parsed = nativeQuestionScope.safeParse(params.nativeQuestion);
    const pending = prior?.pendingControlRequest, question = pending?.nativeTerminal;
    if (!parsed.success || !native || prior?.pendingElicitation || pending?.toolName !== 'AskUserQuestion'
      || native.state.ownerId !== parsed.data.ownerId || native.state.sessionId !== parsed.data.sessionId
      || pending.approvalMessageId !== parsed.data.messageId || question?.ownerId !== parsed.data.ownerId
      || question.sessionId !== parsed.data.sessionId || question.dialogId !== parsed.data.id
      || question.revision !== parsed.data.revision || question.requestId !== parsed.data.requestId) {
      return { success: false, reason: 'native question changed' };
    }
    // No await between the final identity check and retiring this question's process/flow.
    killTurn(services, threadId);
    updateChatState(services, threadId as EntityId, 'idle');
    return { success: true };
  }

  if (native && (!prior?.pendingControlRequest || native.state.mcpForm || native.state.mcpUrl) && !prior?.pendingElicitation) {
    const sessionId = native.state.sessionId, form = native.state.mcpForm ?? native.state.mcpUrl;
    const current = await native.uiTransport.request({ subtype: 'apack_turn_state', session_id: sessionId }) as { turn: { id: string; cancelled: boolean } | null };
    if (services.cli.claudeCode.getNativeTerminal(threadId) !== native) return { success: false, reason: 'native owner changed' };
    if (!current.turn || current.turn.cancelled) {
      if (form) { await native.cancelMcpInput(form); return { success: true, interrupted: true }; }
      return { success: true, noop: true };
    }
    const result = await native.uiTransport.request({ subtype: 'apack_abort_turn', session_id: sessionId, turn_id: current.turn.id }) as { cancelled: boolean };
    if (result.cancelled && form) {
      if (services.cli.claudeCode.getNativeTerminal(threadId) !== native) return { success: false, reason: 'native owner changed' };
      // Incoming MCP input can outlive its tools/call; retire only this original dialog.
      await native.cancelMcpInput({ id: form.id, revision: form.revision, sessionId: form.sessionId });
    }
    return result.cancelled ? { success: true, interrupted: true } : { success: true, noop: true };
  }
  if (!prior?.isRunning && !prior?.pendingControlRequest && !native && !services.cli.claudeCode.getHandle(threadId) && !services.cli.claudeCode.isConversationBusy(threadId)) {
    return { success: true, noop: true };
  }

  if (prior?.pendingElicitation) {
    const handle = services.cli.claudeCode.getHandle(threadId);
    if (handle) {
      try { await handle.interrupt(); } catch { /* Explicit Stop still retires an unresponsive owner. */ }
      if (services.cli.claudeCode.getHandle(threadId) !== handle) return { success: false, reason: 'MCP input owner changed' };
    }
  }

  killTurn(services, threadId);
  updateChatState(services, threadId as EntityId, 'idle');

  return { success: true };
}
