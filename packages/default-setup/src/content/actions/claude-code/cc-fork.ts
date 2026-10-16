/**
 * CC: Fork — forks the current thread from the last assistant message.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { getClaudeState, persistClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Fork',
  description: 'Fork thread from last assistant message',
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
  const { threadId } = params;

  let result: { text: string; skipMessage?: boolean; success?: boolean };

  try {
    result = await handleFork(services, threadId);
  } catch (error: any) {
    result = { text: `cc-fork failed: ${error?.message || 'Unknown error'}`, success: false };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({ threadId, text: result.text, blocks: [] });
  }

  return { success: result.success ?? false, command: 'cc-fork', text: result.text };
}

async function handleFork(
  services: Services,
  threadId?: string,
): Promise<{ text: string; skipMessage?: boolean; success?: boolean }> {
  if (!threadId) return { text: 'No active thread.' };

  const threadData = services.repository.chatQueries.threadData(threadId as any);
  const messages = (threadData?.messages ?? []) as any[];
  const lastAssistant = [...messages].reverse().find(m =>
    m.sender === 'assistant' && m.forkable !== false && typeof m.context?.cliUuid === 'string'
  );
  if (!lastAssistant?.id) return { text: 'No Claude Code assistant message with a session checkpoint to fork from.' };

  const state = getClaudeState(services, threadId);
  if (!state?.sessionId || !state.cwd) return { text: 'Cannot fork — the native session or project directory is unavailable.' };
  if (!await services.cli.claudeCode.closeIdleConversation(threadId)) return { text: 'Pause the current turn before forking.' };
  if (state.isRunning || services.cli.claudeCode.getHandle(threadId)) return { text: 'Pause the current turn before forking.' };
  const snapshot = JSON.stringify({ sessionId: state.sessionId, cwd: state.cwd, lastTurnAt: state.lastTurnAt,
    messages: messages.map(message => [message.id, message.context?.cliUuid]) });
  await services.cli.claudeCode.validateResumeTarget({sessionId: state.sessionId, messageUuid: lastAssistant.context.cliUuid, cwd: state.cwd});
  const current = getClaudeState(services, threadId);
  const currentMessages = services.repository.chatQueries.threadData(threadId as any)?.messages ?? [];
  if (current?.isRunning || services.cli.claudeCode.getHandle(threadId)
    || snapshot !== JSON.stringify({ sessionId: current?.sessionId, cwd: current?.cwd, lastTurnAt: current?.lastTurnAt,
      messages: currentMessages.map((message: any) => [message.id, message.context?.cliUuid]) })) {
    return { text: 'The conversation changed while validating the fork. Try again.' };
  }

  const topic = threadData?.topic || 'Untitled';
  const forkCount = services.repository.threadCommands.forkCount(threadId as any);
  const forkTopic = `Fork ${forkCount + 1} - ${topic}`;

  const { id: newThreadId } = services.chat.createThreadAndNotify({ topic: forkTopic, instructions: '' });
  services.repository.threadCommands.linkFork(threadId as any, newThreadId);
  services.repository.chatCommands.copyMessagesUpTo({
    sourceThreadId: threadId as any,
    targetThreadId: newThreadId,
    upToMessageId: lastAssistant.id,
  });

  persistClaudeState(services, newThreadId, {
    sessionId: state.sessionId, cwd: state.cwd, sessionWorktree: state.sessionWorktree, lastTurnAt: state.lastTurnAt,
    forkFrom: {sessionId: state.sessionId, cliUuid: lastAssistant.context.cliUuid},
  });

  return { text: `Forked to: ${forkTopic}`, skipMessage: true, success: true };
}
