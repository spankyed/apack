/**
 * CC: Pause Turn — kills the CLI subprocess and ends the turn when the user
 * clicks the Pause button.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Pause Turn',
  description: 'Kills the CLI subprocess and ends the turn on user pause.',
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
  if (!prior?.isRunning && !prior?.pendingControlRequest && !services.cli.claudeCode.getNativeTerminal(threadId) && !services.cli.claudeCode.getHandle(threadId) && !services.cli.claudeCode.isConversationBusy(threadId)) {
    return { success: true, noop: true };
  }

  killTurn(services, threadId);
  updateChatState(services, threadId as EntityId, 'idle');

  return { success: true };
}
