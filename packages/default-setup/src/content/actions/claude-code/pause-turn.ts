/**
 * Pause active native work through its original turn handle; print sessions and
 * tool-approval cancellation retain their process-stop lifecycle. Incoming MCP dialogs
 * can outlive their tool turn and are retired by their captured request identity.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Pause Turn',
  description: 'Interrupts active Claude Code work on user pause.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
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
