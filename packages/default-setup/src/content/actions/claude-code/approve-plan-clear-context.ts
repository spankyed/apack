/**
 * CC: Approve Plan Clear Context — kills the current CLI session,
 * creates a fresh thread, injects the plan as the first user message,
 * switches the frontend, and fires a new chat query with acceptEdits.
 *
 * apack owns the fresh-thread transition and preserves the approved plan
 * as the new session's initial user message.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, ensureSessionMarker, updateChatState } from './_helpers/thread-context.ts';
import { resolvePlanDraft, type PlanArtifactContent } from './_helpers/plan-artifact.ts';

export const meta: ActionMeta = {
  label: 'CC: Approve Plan Clear Context',
  description: 'Approves the plan, kills the session, creates a fresh thread, and re-invokes with the plan.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Current thread ID', required: true },
    requestId: { type: 'string', description: 'Pending ExitPlanMode request ID', required: true },
    response: { type: 'object', description: 'User response from the approval block', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, requestId } = params as { threadId: string; requestId: string };
  const log = services.logger;

  if (!threadId || !requestId) return { success: false, reason: 'missing threadId or requestId' };
  const pending = getClaudeState(services, threadId)?.pendingControlRequest;
  if (pending?.requestId !== requestId || pending.toolName !== 'ExitPlanMode') {
    return { success: false, reason: 'plan approval is no longer pending' };
  }

  // 1. Read plan content from draft artifact
  const artifacts = services.repository.chatQueries.threadArtifacts(threadId as EntityId) as Array<{
    id: EntityId;
    type: string;
    title?: string;
    content: unknown;
  }>;
  const draft = artifacts.find(
    a => a.type === 'plan' && (a.content as Partial<PlanArtifactContent>)?.status === 'draft',
  );
  const notes = (draft?.content as Partial<PlanArtifactContent>)?.notes;
  const planContent = typeof notes === 'string' ? notes : '';
  if (!planContent.trim()) return { success: false, reason: 'plan content is unavailable' };
  const planTitle = draft?.title || 'Implementation';
  const planPrompt = `Implement the following plan:\n\n${planContent}`;

  // 2. Kill CLI handle on old thread
  const handle = (services.cli as any).claudeCode.getHandle(threadId);
  if (handle) {
    handle.kill();
    (services.cli as any).claudeCode.clearHandle(threadId);
  }

  // 3. Clean up old thread state
  persistClaudeState(services, threadId, {
    pendingControlRequest: undefined,
    isRunning: false,
  });
  resolvePlanDraft(services, threadId as EntityId, 'approved');

  // 4. Create new thread
  const { id: newThreadId } = services.chat.createThread({
    topic: planTitle,
    instructions: '',
  });
  log.debug('clear-context: created new thread', { oldThreadId: threadId, newThreadId });

  // 5. Add plan as user message in new thread
  services.repository.chatCommands.addMessage({
    threadId: newThreadId,
    text: planPrompt,
    sender: 'user',
    forkable: false,
  });

  // 6. Set permission mode and create session marker on new thread
  ensureSessionMarker(services, newThreadId as EntityId);
  persistClaudeState(services, newThreadId as string, { permissionMode: 'acceptEdits' });

  // 7. Switch frontend to new thread and set edit phase
  services.chat.showThread(newThreadId);
  services.emitter.broadcastToSurface('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
  updateChatState(services, newThreadId as EntityId, 'working');

  // 8. Fire chat action on new thread (fresh CLI session, no resume)
  await services.action.executeIfFound('Claude Code Chat', {
    threadId: newThreadId,
    text: planPrompt,
  });

  return { success: true, newThreadId };
}
