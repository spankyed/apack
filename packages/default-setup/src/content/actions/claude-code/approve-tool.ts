/**
 * CC: Approve Tool — sends a tool approval to the CLI and resumes streaming.
 * Handles generic tool approvals (Write, Edit, Bash) and ExitPlanMode.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { expirePendingControlRequest, getClaudeState, persistClaudeState, setRunning, updateClaudeState, updateChatState } from './_helpers/thread-context.ts';
import { resolvePlanDraft } from './_helpers/plan-artifact.ts';

export const meta: ActionMeta = {
  label: 'CC: Approve Tool',
  description: 'Sends tool approval to the CLI and resumes streaming.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    requestId: { type: 'string', description: 'CLI control_request ID', required: true },
    toolName: { type: 'string', description: 'Tool being approved', required: false },
    originalInput: { type: 'object', description: 'Original tool input from the control_request', required: false },
    response: { type: 'object', description: 'User response from the approval block', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, requestId, toolName, originalInput, response } = params as {
    threadId: string;
    requestId: string;
    toolName?: string;
    originalInput?: Record<string, unknown>;
    response?: { autoAccept?: boolean; choice?: string; reason?: string; plan?: string; choiceToken?: string; prefix?: string };
  };

  if (!threadId || !requestId) return { success: false, reason: 'missing threadId or requestId' };

  const pending = getClaudeState(services, threadId)?.pendingControlRequest;
  if (pending?.requestId !== requestId || (toolName && pending.toolName !== toolName)) {
    return { success: false, reason: 'approval is no longer pending' };
  }

  if (pending.nativeTerminal) {
    const owner = services.cli.claudeCode.getNativeTerminal(threadId);
    const native = pending.nativeTerminal;
    if (!owner || owner.state.ownerId !== native.ownerId || owner.state.sessionId !== native.sessionId) {
      expirePendingControlRequest(services, threadId, requestId);
      return { success: false, reason: 'Native approval expired' };
    }
    try {
      if (pending.toolName === 'EnterPlanMode' || pending.toolName === 'ExitPlanMode') await owner.answerPlanDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, choice: typeof response?.choice === 'string' ? response.choice : '', feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined, plan: typeof response?.plan === 'string' ? response.plan : undefined });
      else if (pending.toolName === 'Workflow' && native.workflow) await owner.answerWorkflowDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'allow', choice: typeof response?.choice === 'string' ? response.choice : undefined, choiceToken: typeof response?.choiceToken === 'string' ? response.choiceToken : native.workflow.token, feedback: typeof response?.reason === 'string' ? response.reason.trim() : undefined });
      else if (pending.toolName === 'Bash') await owner.answerBashDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'allow', choice: typeof response?.choice === 'string' ? response.choice : undefined, choiceToken: typeof response?.choiceToken === 'string' ? response.choiceToken : undefined, prefix: typeof response?.prefix === 'string' ? response.prefix : undefined });
      else if (['Read', 'Write', 'Edit'].includes(pending.toolName)) await owner.answerFileDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, decision: 'allow', ...(typeof response?.choice === 'string' ? { choice: response.choice } : {}), ...(typeof response?.choiceToken === 'string' ? { choiceToken: response.choiceToken } : {}) });
      else throw new Error('Unsupported native approval');
    } catch {
      expirePendingControlRequest(services, threadId, requestId);
      return { success: false, reason: 'Native approval changed or could not be answered' };
    }
    if (getClaudeState(services, threadId)?.pendingControlRequest?.requestId === requestId)
      persistClaudeState(services, threadId, { pendingControlRequest: undefined });
    return { success: true };
  }

  const handle = (services.cli as any).claudeCode.getHandle(threadId);

  if (!handle) {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code request expired' };
  }

  try {
    handle.respond(requestId, { behavior: 'allow', updatedInput: originalInput ?? {} });
  } catch {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code response could not be sent' };
  }

  if (toolName === 'ExitPlanMode') {
    resolvePlanDraft(services, threadId as EntityId, 'approved');
    services.emitter.broadcastToSurface('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
  }

  // If the user checked "auto-accept file edits", switch for current + future turns.
  if (response?.autoAccept) {
    updateClaudeState(services, threadId as EntityId, { permissionMode: 'acceptEdits' });
    persistClaudeState(services, threadId, { pendingControlRequest: undefined, autoAcceptEdits: true });
  } else {
    persistClaudeState(services, threadId, { pendingControlRequest: undefined });
  }
  setRunning(services, threadId, true);
  updateChatState(services, threadId as EntityId, 'working');

  return { success: true };
}
