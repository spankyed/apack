/** Send a correlated native tool denial; explicit interaction cancellation stops the turn. */
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { expirePendingControlRequest, getClaudeState, killTurn, persistClaudeState, setRunning, updateChatState } from './_helpers/thread-context.ts';
import { resolvePlanDraft } from './_helpers/plan-artifact.ts';

export const meta: ActionMeta = {
  label: 'CC: Deny Tool',
  description: 'Denies the pending native tool request, or stops the turn on explicit cancellation.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    requestId: { type: 'string', description: 'CLI control_request ID', required: true },
    response: { type: 'object', description: 'Denial reason or explicit cancellation from the interaction', required: false },
  },
};

export async function action(params: Record<string, unknown>, services: Services) {
  const threadId = typeof params.threadId === 'string' ? params.threadId : '';
  const requestId = typeof params.requestId === 'string' ? params.requestId : '';
  if (!threadId || !requestId) return { success: false, reason: 'missing threadId or requestId' };
  const pending = getClaudeState(services, threadId)?.pendingControlRequest;
  if (pending?.requestId !== requestId) return { success: false, reason: 'denial is no longer pending' };
  const response = params.response as { cancelled?: unknown; reason?: unknown; choice?: unknown; choiceToken?: unknown } | undefined;
  if (response?.cancelled === true) {
    killTurn(services, threadId);
    updateChatState(services, threadId as EntityId, 'idle');
    return { success: true };
  }
  if (pending.nativeTerminal) {
    const owner = services.cli.claudeCode.getNativeTerminal(threadId);
    const native = pending.nativeTerminal;
    if (!owner || owner.state.ownerId !== native.ownerId || owner.state.sessionId !== native.sessionId) {
      expirePendingControlRequest(services, threadId, requestId);
      return { success: false, reason: 'Native approval expired' };
    }
    try {
      if (pending.toolName === 'EnterPlanMode' || pending.toolName === 'ExitPlanMode') await owner.answerPlanDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, choice: 'no', feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined,  });
      else if (pending.toolName === 'Workflow' && native.workflow) await owner.answerWorkflowDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'deny', choice: typeof response?.choice === 'string' ? response.choice : undefined, choiceToken: typeof response?.choiceToken === 'string' ? response.choiceToken : native.workflow.token, feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined });
      else if (pending.toolName === 'WebFetch' || pending.toolName === 'Skill') await owner.answerToolPermissionDialog({ decision: 'deny', id: native.dialogId, revision: native.revision, sessionId: native.sessionId, toolName: pending.toolName, choice: typeof response?.choice === 'string' ? response.choice : '', choiceToken: typeof response?.choiceToken === 'string' ? response.choiceToken : '', feedback: typeof response?.reason === 'string' ? response.reason : undefined });
      else if (pending.toolName === 'Bash') await owner.answerBashDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'deny', feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined });
      else if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(pending.toolName)) await owner.answerFileDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'deny', feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined, ...(typeof response?.choice === 'string' ? { choice: response.choice } : {}), ...(typeof response?.choiceToken === 'string' ? { choiceToken: response.choiceToken } : {}) });
      else throw new Error('Unsupported native approval');
    } catch {
      expirePendingControlRequest(services, threadId, requestId);
      return { success: false, reason: 'Native approval changed or could not be answered' };
    }
    if (getClaudeState(services, threadId)?.pendingControlRequest?.requestId === requestId)
      persistClaudeState(services, threadId, { pendingControlRequest: undefined });
    return { success: true };
  }

  const handle = services.cli.claudeCode.getHandle(threadId);
  if (!handle) {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code request expired' };
  }
  const reason = typeof response?.reason === 'string' ? response.reason.trim() : '';
  try {
    handle.respond(requestId, { behavior: 'deny', message: reason || 'The user denied this tool request.' });
  } catch {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code response could not be sent' };
  }
  if (pending.toolName === 'ExitPlanMode') resolvePlanDraft(services, threadId as EntityId, 'rejected');
  persistClaudeState(services, threadId, { pendingControlRequest: undefined });
  setRunning(services, threadId, true);
  updateChatState(services, threadId as EntityId, 'working');
  return { success: true };
}
