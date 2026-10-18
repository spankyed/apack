/**
 * CC: Answer Question — sends the user's answer(s) to an AskUserQuestion
 * back to the CLI and resumes streaming.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { expirePendingControlRequest, getClaudeState, persistClaudeState, setRunning, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Answer Question',
  description: 'Sends AskUserQuestion answers to the CLI and resumes streaming.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    requestId: { type: 'string', description: 'CLI control_request ID', required: true },
    originalInput: { type: 'object', description: 'Original tool input from the control_request', required: false },
    response: { type: 'object', description: 'User response (string, string[], or Record)', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, requestId, originalInput, response } = params as {
    threadId: string;
    requestId: string;
    originalInput?: Record<string, unknown>;
    response: any;
  };

  if (!threadId || !requestId) return { success: false, reason: 'missing threadId or requestId' };

  const pending = getClaudeState(services, threadId)?.pendingControlRequest;
  if (pending?.requestId !== requestId || pending.toolName !== 'AskUserQuestion') {
    return { success: false, reason: 'question is no longer pending' };
  }

  if (pending.nativeTerminal) {
    const native = pending.nativeTerminal, owner = services.cli.claudeCode.getNativeTerminal(threadId);
    if (!owner || owner.state.ownerId !== native.ownerId || owner.state.sessionId !== native.sessionId) {
      expirePendingControlRequest(services, threadId, requestId);
      return { success: false, reason: 'Native question expired' };
    }
    try {
      if (!response || typeof response !== 'object' || !response.nativeQuestionAnswer || typeof response.nativeQuestionAnswer !== 'object') throw new Error('Missing native card answer');
      await owner.answerQuestionDialog({ id: native.dialogId, revision: native.revision, sessionId: native.sessionId, answer: response.nativeQuestionAnswer });
    } catch {
      if (getClaudeState(services, threadId)?.pendingControlRequest?.requestId === requestId) {
        services.chat.updateMessageState(pending.approvalMessageId as EntityId, { responseTimestamp: undefined, blockResponse: undefined });
        persistClaudeState(services, threadId, { pendingControlRequest: { ...pending, nativeTerminal: { ...native, problem: 'Claude Code did not accept that answer. Review it and try again.' } } });
      }
      return { success: false, reason: 'Native question changed or did not accept the answer' };
    }
    if (getClaudeState(services, threadId)?.pendingControlRequest?.requestId === requestId)
      persistClaudeState(services, threadId, { pendingControlRequest: undefined });
    return { success: true };
  }

  const handle = (services.cli as any).claudeCode.getHandle(threadId);

  if (!handle) {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code request expired' };
  }

  // Build the answers Record from the response.
  const isMultiAnswer = typeof response === 'object' && response !== null && !Array.isArray(response);
  let answers: Record<string, string>;
  if (isMultiAnswer) {
    // Multi-question wizard: response is already { questionText: answer }
    answers = response;
  } else {
    // Single question: wrap in a Record keyed by the question text
    const answer = typeof response === 'string' ? response
      : Array.isArray(response) ? response.join(', ')
      : String(response ?? '');
    const questions = Array.isArray(originalInput?.questions) ? originalInput.questions : [];
    const questionText = (questions[0] as any)?.question ?? '';
    answers = { [questionText]: answer };
  }

  const updatedInput = { ...originalInput, answers };
  try {
    handle.respond(requestId, { behavior: 'allow', updatedInput });
  } catch {
    expirePendingControlRequest(services, threadId, requestId);
    return { success: false, reason: 'Claude Code response could not be sent' };
  }

  persistClaudeState(services, threadId, { pendingControlRequest: undefined });
  setRunning(services, threadId, true);
  updateChatState(services, threadId as EntityId, 'working');

  return { success: true };
}
