/**
 * CC: Start From Status — kicks off a Claude Code turn when a thread is
 * dragged to "In Progress" on the kanban board.
 *
 * Reads the thread's `instructions` field and sends a `USER_MSG` event to
 * the threads system, which persists the user message and emits a
 * `user.message` brain event. The claude-code-flow picks that up and starts
 * streaming via the "Claude Code Chat" action.
 */

import type { ActionMeta, Services, EntityId } from '../../types';

export const meta: ActionMeta = {
  label: 'CC: Start From Status',
  description: 'Starts a Claude Code turn from a kanban status change using the thread instructions.',
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

  const thread = services.repository.threadQueries.byId(threadId as EntityId) as any;
  if (!thread?.instructions?.trim()) {
    return { success: false, reason: 'Thread has no instructions' };
  }

  services.emitter.sendToSystem('threads', {
    type: 'USER_MSG',
    text: thread.instructions,
    mode: 'work',
    phase: 'plan',
    threadId,
  } as any);

  return { success: true };
}
