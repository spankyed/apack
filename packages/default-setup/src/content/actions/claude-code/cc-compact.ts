import { claudeProfileOptions } from '../../../features/code/common/native-profile.ts';
/**
 * CC: Compact — compacts a Claude Code session's context and creates a marker message.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, updateChatState, dequeueMessage } from './_helpers/thread-context.ts';
import { replayQueuedMessage } from './_helpers/stream-consumer.ts';

export const meta: ActionMeta = {
  label: 'CC: Compact',
  description: 'Compact a Claude Code session context',
  category: 'claude-code',
  input: {
    command: { type: 'string', required: true },
    text: { type: 'string', required: false },
    threadId: { type: 'string', required: false },
    references: { type: 'object', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { text, threadId } = params;
  const args = text?.trim() ? text.trim().split(/\s+/) : [];

  let result: { text: string; data?: any; skipMessage?: boolean };

  try {
    result = await handleCompact(args, services, threadId);
  } catch (error: any) {
    result = { text: `cc-compact failed: ${error?.message || 'Unknown error'}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({ threadId, text: result.text, blocks: [] });
  }

  return { success: true, command: 'cc-compact', text: result.text };
}

async function handleCompact(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any; skipMessage?: boolean }> {
  if (!threadId) return { text: 'No active thread — run a Claude Code turn first.' };

  const ccState = getClaudeState(services, threadId);
  const sessionId = ccState?.sessionId;
  if (!sessionId) return { text: 'No active session — run a Claude Code turn first.' };
  if (ccState?.isRunning) return { text: 'A turn is already running — wait for it to finish before compacting.' };

  persistClaudeState(services, threadId, { isRunning: true, commandActive: true });
  updateChatState(services, threadId as any, 'working');
  try {
    const sessionCwd = ccState?.cwd;
    const prompt = args.length > 0 ? `/compact ${args.join(' ')}` : '/compact';
    const handle = await services.cli.claudeCode.query({
    ...claudeProfileOptions(ccState),
      ...(sessionCwd && { cwd: sessionCwd }),
      prompt,
      resume: sessionId,
      permissionMode: 'plan',
    });

    const result = await handle.result;

    // The CLI forks the session during /compact — persist the new ID
    // so subsequent turns resume the compacted session, not the stale one.
    if (result.sessionId && result.sessionId !== sessionId) {
      persistClaudeState(services, threadId, { sessionId: result.sessionId });
    }

    const summaryText = result.text || 'Session compacted.';

    const { compactedMessageIds } = services.chat.createMarkerMessage({
      threadId: threadId as any,
      text: summaryText,
    });

    return { text: summaryText, skipMessage: compactedMessageIds.length > 0 };
  } finally {
    // Dequeue before clearing isRunning to close the race window (same
    // pattern as stream-consumer.ts). Any message sent during compaction
    // was queued by chat.ts's isRunning guard — replay it now.
    const queued = dequeueMessage(services, threadId);
    persistClaudeState(services, threadId, { isRunning: false, commandActive: false });
    if (!queued) updateChatState(services, threadId as any, 'idle');
    if (queued) await replayQueuedMessage(services, threadId as any, queued, services.logger);
  }
}
