/** Prepare the next native turn at the remaining assistant boundary after a validated menu revert. */
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { persistClaudeState, getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Handle Revert',
  description: 'Cleans up Claude Code state and sets up CLI session truncation on revert.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    messageId: { type: 'string', description: 'Message ID being reverted to', required: true },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const {threadId} = params as {threadId: string};
  if (!threadId) return {success: false, reason: 'missing threadId'};
  const state = getClaudeState(services, threadId);
  const readSnapshot = () => JSON.stringify({state: getClaudeState(services, threadId),
    messages: services.repository.chatQueries.threadData(threadId as EntityId)?.messages?.map(message => [message.id, message.context?.cliUuid])});
  const snapshot = readSnapshot();
  const messages = services.repository.chatQueries.threadData(threadId as EntityId)?.messages ?? [];
  const assistant = [...messages].reverse().find(message => message.sender === 'assistant' && typeof message.context?.cliUuid === 'string');
  const cliUuid = assistant?.context?.cliUuid as string | undefined;
  const fail = (reason: string, block = false) => {
    if (block && snapshot === readSnapshot()) persistClaudeState(services, threadId, {historyError: reason});
    services.chat.sendBlockMessage({threadId: threadId as EntityId, text: `Could not prepare revert: ${reason}`, blocks: [], forkable: false});
    return {success: false, reason};
  };
  if (!await services.cli.claudeCode.closeIdleConversation(threadId)) return fail('Pause the current turn before reverting.');
  if (state?.isRunning || services.cli.claudeCode.getHandle(threadId)) return fail('Pause the current turn before reverting.');
  if (cliUuid) {
    if (!state?.sessionId || !state.cwd) return fail('The native session or project directory is unavailable.', true);
    try {
      await services.cli.claudeCode.validateResumeTarget({sessionId: state.sessionId, messageUuid: cliUuid, cwd: state.cwd});
    } catch (error: any) { return fail(error?.message ?? 'The native history boundary is unavailable.', true); }
  }
  if (snapshot !== readSnapshot() || services.cli.claudeCode.getHandle(threadId)) return fail('The conversation changed while validating the revert. Try again.');
  killTurn(services, threadId);
  persistClaudeState(services, threadId, cliUuid ? {revertTo: {cliUuid}, forkFrom: undefined} : {
    sessionId: undefined, forkFrom: undefined, revertTo: undefined,
  });
  persistClaudeState(services, threadId, {historyError: undefined});
  updateChatState(services, threadId as EntityId, 'idle');
  return {success: true, hadActiveHandle: false, cliUuid};
}
