/**
 * CC: Route Response — thin router that classifies an interactive block
 * response and returns metadata for the downstream switch to branch on.
 *
 * No side effects — no handle.respond(), no handle.kill(), no state
 * mutations. The switch branches to CC: Deny Tool, CC: Answer Question,
 * or CC: Approve Tool based on this action's result.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';
import { getClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Route Response',
  description: 'Classifies an interactive block response for downstream routing.',
  category: 'claude-code',
  input: {
    messageId: { type: 'string', description: 'The interactive block message that was responded to', required: true },
    threadId: { type: 'string', description: 'Thread ID (from event payload)', required: true },
    response: { type: 'any', description: 'The user response (shape depends on block type)', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { messageId, threadId, response } = params as {
    messageId: string;
    threadId: string;
    response: any;
  };

  if (!messageId || !threadId) {
    return { success: false, reason: 'missing messageId or threadId' };
  }

  // Skip threads that aren't Claude Code threads (e.g. onboarding birth thread)
  const thread = services.repository.threadQueries.byId(threadId as any);
  if (thread?.forcedMode === 'Birth') {
    return { success: false, reason: 'birth thread — not a claude-code response' };
  }

  const state = getClaudeState(services, threadId);

  // Directory-picker response: no CLI handle needed, just re-invoke chat.
  if (state?.pendingDirectorySelect?.pickerMessageId === messageId) {
    return {
      success: true,
      directorySelect: true,
      threadId,
      response,
      pendingDirectorySelect: state.pendingDirectorySelect,
    };
  }

  if (state?.pendingElicitation?.approvalMessageId === messageId) return {
    success: true, elicitation: true, threadId, messageId,
    requestId: state.pendingElicitation.requestId, response,
  };

  const pending = state?.pendingControlRequest;

  if (!pending || pending.approvalMessageId !== messageId) {
    return { success: false, reason: 'no matching pending control request' };
  }

  const denied = response?.approved === false || response?.cancelled === true;

  // When denied, clear toolName for tools that have their own non-deny
  // branch (like AskUserQuestion) so the flow routes to CC: Deny Turn
  // instead of the tool-specific handler. Tools like ExitPlanMode need
  // toolName preserved so deny-tool can handle them specially.
  const toolName = (denied && pending.toolName === 'AskUserQuestion')
    ? undefined
    : pending.toolName;

  const clearContext = !pending.nativeTerminal && response?.clearContext === true;

  return {
    success: true,
    denied,
    clearContext,
    toolName,
    requestId: pending.requestId,
    originalInput: pending.originalInput,
    response,
    threadId,
  };
}
