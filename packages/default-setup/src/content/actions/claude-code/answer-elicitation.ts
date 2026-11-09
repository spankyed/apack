import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { cancelPendingElicitation, getClaudeState, persistClaudeState, setRunning, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Answer MCP Elicitation', description: 'Answer the current native MCP form or URL request.', category: 'claude-code',
  input: { threadId: { type: 'string', required: true }, messageId: { type: 'string', required: true }, requestId: { type: 'string', required: true }, response: { type: 'object', required: true } },
};
export async function action(params: { threadId: string; messageId: string; requestId: string; response: { buttonId?: string; cancelled?: boolean; content?: Record<string, unknown> } }, services: Services) {
  const { threadId, messageId, requestId, response } = params;
  const pending = getClaudeState(services, threadId)?.pendingElicitation;
  if (!pending || pending.requestId !== requestId || pending.approvalMessageId !== messageId) return { success: false, reason: 'elicitation is no longer pending' };
  const choice = response?.cancelled ? 'cancel' : response?.buttonId;
  if (choice !== 'accept' && choice !== 'decline' && choice !== 'cancel') return { success: false, reason: 'invalid elicitation response' };
  const owner = services.cli.claudeCode.getConversation(threadId)?.owner;
  const handle = services.cli.claudeCode.getHandle(threadId);
  const expire = () => {
    if (cancelPendingElicitation(services, threadId, requestId)) {
      if (!getClaudeState(services, threadId)?.pendingControlRequest) {
        setRunning(services, threadId, false); updateChatState(services, threadId as EntityId, 'error');
      }
      services.chat.sendBlockMessage({ threadId: threadId as EntityId, text: 'This MCP input request expired. Continue the conversation to retry.', blocks: [], forkable: false });
    }
    return { success: false, reason: 'MCP input request expired' };
  };
  if (!handle || !owner?.hasPendingElicitation(requestId) || handle.pid !== pending.ownerPid || owner.handle.pid !== pending.ownerPid) return expire();
  let content;
  if (choice === 'accept' && pending.mode === 'form') {
    if (!pending.form) return expire();
    const checked = services.cli.claudeCode.validateMcpElicitationForm(pending.form, response.content);
    if (!checked.valid) {
      services.chat.updateMessageState(messageId as EntityId, { responseTimestamp: Date.now(), blockResponse: { validationFailed: true } });
      const retry = services.chat.sendBlockMessage({ threadId: threadId as EntityId, text: pending.message, blocks: [{ type: 'mcp-elicitation', props: { form: pending.form, initialValues: response.content, errors: checked.errors } }], forkable: false, autoHide: true, asUser: true });
      persistClaudeState(services, threadId, { pendingElicitation: { ...pending, approvalMessageId: retry.messageId } });
      return { success: false, reason: 'invalid form content' };
    }
    content = checked.content;
  }
  try { handle.respondElicitation(requestId, { action: choice, ...(content === undefined ? {} : { content }) }); }
  catch { return expire(); }
  if (getClaudeState(services, threadId)?.pendingElicitation?.requestId === requestId) persistClaudeState(services, threadId, { pendingElicitation: undefined });
  setRunning(services, threadId, true); updateChatState(services, threadId as EntityId, 'working');
  return { success: true };
}
