/**
 * CC: Deny Tool — kills the CLI subprocess and stops the turn when the user
 * denies a tool approval or cancels an interaction.
 */

import type { ActionMeta, Services, EntityId } from '../../types';
import { killTurn, updateChatState } from './_helpers/thread-context';

export const meta: ActionMeta = {
  label: 'CC: Deny Tool',
  description: 'Kills the CLI subprocess and stops the turn on denial.',
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

  killTurn(services, threadId);
  updateChatState(services, threadId as EntityId, 'idle');

  // Move thread to "Open" on denial — idle isn't in the chatState→status
  // map so the sync in updateChatState won't fire for this case.
  services.emitter.sendToSystem('threads', {
    type: 'UPDATE_THREAD_STATUS',
    threadId,
    status: 'Open',
    userInduced: false,
  } as any);

  return { success: true };
}
