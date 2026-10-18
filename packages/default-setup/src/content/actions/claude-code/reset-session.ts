/**
 * Claude Code Reset Session — drops the Claude Code state off a thread.
 *
 * Clears `thread.context.claudeCode` and removes the `claude-code` tag.
 * The next `Claude Code Chat` turn in the thread will start a brand-new
 * Claude Code session. The on-disk JSONL from the prior session is NOT
 * deleted — it's still recoverable via `claudeCode.sessions.list()`.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z, EntityId } from '#generated/services.ts';
import { clearClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'Claude Code Reset Session',
  description: 'Disconnect a thread from its Claude Code session. The next work-mode turn starts fresh.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Target thread', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { threadId } = params as { threadId: EntityId };

  if (!threadId) {
    return { success: false, error: 'threadId is required' };
  }

  try {
    if (!await services.cli.claudeCode.closeIdleConversation(threadId)) {
      const error = 'Pause the current Claude turn before resetting its session.';
      services.chat.sendBlockMessage({ threadId, text: error, blocks: [] });
      return { success: false, error };
    }
    clearClaudeState(services, threadId);
    services.chat.sendBlockMessage({
      threadId,
      text: 'Claude Code session reset for this thread.',
      blocks: [],
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reset Claude Code session' };
  }
}
