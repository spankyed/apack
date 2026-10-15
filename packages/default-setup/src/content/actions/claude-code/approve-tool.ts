/**
 * CC: Approve Tool — sends a tool approval to the CLI and resumes streaming.
 * Handles generic tool approvals (Write, Edit, Bash) and ExitPlanMode.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, setRunning, updateClaudeState, updateChatState } from './_helpers/thread-context.ts';
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
    response?: { autoAccept?: boolean };
  };

  if (!threadId || !requestId) return { success: false, reason: 'missing threadId or requestId' };

  const pending = getClaudeState(services, threadId)?.pendingControlRequest;
  if (pending?.requestId !== requestId || (toolName && pending.toolName !== toolName)) {
    return { success: false, reason: 'approval is no longer pending' };
  }

  const handle = (services.cli as any).claudeCode.getHandle(threadId);

  // Handle post-restart: CLI process is gone but the user can still approve
  // the pending plan/tool. Start a new turn to resume the session.
  if (!handle) {
    if (toolName === 'ExitPlanMode') {
      resolvePlanDraft(services, threadId as EntityId, 'approved');
      services.emitter.broadcastToSurface('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
    }
    persistClaudeState(services, threadId, { pendingControlRequest: undefined });
    // Start a new turn that resumes the session — mirrors replayQueuedMessage.
    await services.action.executeIfFound('Claude Code Chat', {
      threadId,
      text: 'continue',
      phase: toolName === 'ExitPlanMode' ? 'Edit' : undefined,
    });
    return { success: true, resumed: true };
  }

  handle.respond(requestId, { behavior: 'allow', updatedInput: originalInput ?? {} });

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
