/** Restore native file checkpoints after the thread owner's dry-run preflight. */
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Handle Rewind',
  description: 'Revert plus restoring files through native file checkpoints.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    messageId: { type: 'string', description: 'Message ID being reverted to', required: true },
    userCliUuid: { type: 'string', description: 'CLI UUID of the reverted user message', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const {threadId, messageId} = params as {threadId: string; messageId: string};
  if (!threadId) return {success: false, reason: 'missing threadId', filesRestored: false};
  const state = getClaudeState(services, threadId);
  const recordedId = services.repository.chatQueries.messageById(messageId as EntityId)?.context?.cliUuid;
  const userMessageId = recordedId ?? params.userCliUuid;
  const fail = (reason: string) => {
    services.chat.sendBlockMessage({threadId: threadId as EntityId, text: `Could not restore files: ${reason}`, blocks: [], forkable: false});
    return {success: false, reason, filesRestored: false};
  };
  if (typeof recordedId === 'string' && params.userCliUuid && recordedId !== params.userCliUuid) return fail('The file checkpoint identity changed. Retry from the current message.');
  if (!state?.sessionId || !state.cwd) return fail('The native session or project directory is unavailable.');
  if (typeof userMessageId !== 'string' || !userMessageId.trim()) return fail('No native file checkpoint identity is recorded for this message.');
  const options = {sessionId: state.sessionId, userMessageId, cwd: state.cwd};
  try {
    const preview = await services.cli.claudeCode.getFileRewindPreview(options);
    if (!preview.canRewind) return fail(preview.error ?? 'The native file checkpoint is unavailable.');
    const reverted = await services.action.executeIfFound('CC: Handle Revert', {threadId, messageId});
    if (!reverted?.success) return fail('Conversation revert did not complete.');
    const verdict = await services.cli.claudeCode.rewindFiles(options);
    if (!verdict.canRewind) return fail(verdict.error ?? 'The native file checkpoint could not be restored.');
    if (verdict.skippedLinks !== 0) return fail('Native rewind did not report complete restoration; some files may have been restored.');
    return {success: true, filesRestored: true};
  } catch (error: any) {
    services.logger.warn('Native file rewind failed', {threadId, message: error?.message});
    return fail(error?.message ?? 'Native file rewind failed.');
  }
}
