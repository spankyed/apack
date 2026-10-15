/**
 * CC: Answer Question — sends the user's answer(s) to an AskUserQuestion
 * back to the CLI and resumes streaming.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, setRunning, updateChatState } from './_helpers/thread-context.ts';

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

  const handle = (services.cli as any).claudeCode.getHandle(threadId);

  // Post-restart fallback: CLI process is gone but the user answered the
  // pending question. Resume the session with the answer as prompt text.
  if (!handle) {
    persistClaudeState(services, threadId, { pendingControlRequest: undefined });
    const answerText = typeof response === 'string' ? response
      : Array.isArray(response) ? response.join(', ')
      : typeof response === 'object' ? Object.values(response).join(', ')
      : String(response ?? '');
    await services.action.executeIfFound('Claude Code Chat', {
      threadId,
      text: answerText || 'continue',
    });
    return { success: true, resumed: true };
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
  handle.respond(requestId, { behavior: 'allow', updatedInput });

  persistClaudeState(services, threadId, { pendingControlRequest: undefined });
  setRunning(services, threadId, true);
  updateChatState(services, threadId as EntityId, 'working');

  return { success: true };
}
