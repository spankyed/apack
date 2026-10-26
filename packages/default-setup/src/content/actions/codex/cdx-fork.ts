/**
 * CDX: Fork - forks the current thread from the last assistant message.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'CDX: Fork',
  description: 'Fork Codex thread from the last assistant message.',
  category: 'codex',
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
  const { threadId } = params;

  let result: { text: string; skipMessage?: boolean };
  try {
    result = await handleFork(services, threadId);
  } catch (error: any) {
    result = { text: `cdx-fork failed: ${error?.message || 'Unknown error'}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({ threadId, text: result.text, blocks: [] });
  }

  return { success: true, command: 'cdx-fork', text: result.text };
}

async function handleFork(
  services: Services,
  threadId?: string,
): Promise<{ text: string; skipMessage?: boolean }> {
  if (!threadId) return { text: 'No active thread.' };

  const threadData = services.repository.chatQueries.threadData(threadId as any);
  const messages = (threadData?.messages ?? []) as any[];
  const lastAssistant = [...messages].reverse().find(m => m.sender === 'assistant');
  if (!lastAssistant?.id) return { text: 'No assistant message to fork from.' };

  const topic = threadData?.topic || 'Untitled';
  const forkCount = services.repository.threadCommands.forkCount(threadId as any);
  const forkTopic = `Fork ${forkCount + 1} - ${topic}`;

  const { id: newThreadId } = services.chat.createThread({ topic: forkTopic, instructions: '' });
  services.repository.threadCommands.linkFork(threadId as any, newThreadId);
  services.repository.chatCommands.copyMessagesUpTo({
    sourceThreadId: threadId as any,
    targetThreadId: newThreadId,
    upToMessageId: lastAssistant.id,
  });

  await services.action.executeIfFound('CDX: Handle Fork', {
    sourceThreadId: threadId,
    sourceMessageId: lastAssistant.id,
    newThreadId,
  });

  return { text: `Forked to: ${forkTopic}`, skipMessage: true };
}
