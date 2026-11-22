/**
 * Pause active native work through its original turn handle; print sessions and
 * tool-approval cancellation retain their process-stop lifecycle. Incoming MCP dialogs
 * can outlive their tool turn and are retired by their captured request identity.
 */

import { parseClaudeDecisionPauseScope } from '../../../features/code/common/native-decision-pause.ts';
import type { ClaudeNativePauseScope } from '../../../features/code/common/native-terminal.ts';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Pause Turn',
  description: 'Interrupts active Claude Code work on user pause.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    nativePause: { type: 'object', description: 'Captured native composer turn or MCP dialog identity', required: false },
    nativeDecision: { type: 'object', description: 'Captured native decision identity for an addressed Cancel', required: false },
  },
};

function nativeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function parseNativePause(value: unknown): ClaudeNativePauseScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { ownerId, sessionId, turnId, mcp } = value as Record<string, unknown>;
  if (!nativeId(ownerId) || !nativeId(sessionId) || (turnId !== undefined && !nativeId(turnId))) return;
  if (mcp !== undefined) {
    if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return;
    const { id, revision } = mcp as Record<string, unknown>;
    if (!nativeId(id) || !nativeId(revision)) return;
    return { ownerId, sessionId, turnId, mcp: { id, revision } };
  }
  return turnId === undefined ? undefined : { ownerId, sessionId, turnId };
}

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId } = params as { threadId: string };

  if (!threadId) return { success: false, reason: 'missing threadId' };

  // Busy metadata can lag submission; an explicit Pause targets the owning native process.
  const prior = getClaudeState(services, threadId);
  const native = services.cli.claudeCode.getNativeTerminal(threadId);
  if (params.nativePause !== undefined) {
    const target = parseNativePause(params.nativePause);
    const state = native?.state;
    if (!target || !native || !state || state.ownerId !== target.ownerId || state.sessionId !== target.sessionId) {
      return { success: false, reason: 'native owner changed' };
    }
    const form = state.mcpForm ?? state.mcpUrl;
    if (target.mcp && (!form || form.id !== target.mcp.id || form.revision !== target.mcp.revision || form.sessionId !== target.sessionId)) {
      return { success: false, reason: 'native MCP input changed' };
    }
    if (prior?.pendingElicitation || (prior?.pendingControlRequest && !target.mcp)) {
      return { success: false, reason: 'native decision changed' };
    }
    if (target.turnId) {
      const current = await native.uiTransport.request({ subtype: 'apack_turn_state', session_id: target.sessionId }) as { turn: { id: string; cancelled: boolean } | null };
      if (services.cli.claudeCode.getNativeTerminal(threadId) !== native || native.state.sessionId !== target.sessionId || current.turn?.id !== target.turnId) {
        return { success: false, reason: 'native turn changed' };
      }
      if (current.turn.cancelled) return { success: true, noop: true };
      const result = await native.uiTransport.request({ subtype: 'apack_abort_turn', session_id: target.sessionId, turn_id: target.turnId }) as { cancelled: boolean };
      if (!result.cancelled) return { success: true, noop: true };
    }
    if (target.mcp) {
      if (services.cli.claudeCode.getNativeTerminal(threadId) !== native || native.state.sessionId !== target.sessionId) {
        return { success: false, reason: 'native owner changed' };
      }
      await native.cancelMcpInput({ ...target.mcp, sessionId: target.sessionId });
    }
    return { success: true, interrupted: true };
  }

  if (params.nativeDecision !== undefined) {
    const parsed = parseClaudeDecisionPauseScope(params.nativeDecision);
    const pending = prior?.pendingControlRequest, decision = pending?.nativeTerminal;
    if (!parsed || !native || !pending || prior?.pendingElicitation || pending?.toolName !== parsed.toolName
      || native.state.ownerId !== parsed.ownerId || native.state.sessionId !== parsed.sessionId
      || pending.approvalMessageId !== parsed.messageId || decision?.ownerId !== parsed.ownerId
      || decision.sessionId !== parsed.sessionId || decision.dialogId !== parsed.id
      || decision.revision !== parsed.revision || decision.requestId !== parsed.requestId) {
      return { success: false, reason: 'native decision changed' };
    }
    // No await between the final identity check and retiring this decision's process/flow.
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
