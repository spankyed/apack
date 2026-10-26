import type { ActionMeta } from '@apackdev/sdk/build';
import type { EntityId, Services, Z } from '#generated/services.ts';
import { getOnboardingState } from './onboarding-helpers.ts';

export const meta: ActionMeta = {
  label: 'Handle Onboarding Response',
  description: 'Validates an interactive block response and returns step + response for flow-level branching',
  category: 'onboarding',
  input: {
    messageId: { type: 'string', description: 'The message ID that was responded to', required: true },
    threadId: { type: 'string', description: 'The thread ID', required: true },
    response: { type: 'any', description: 'The block response data', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { response } = params;
  const threadId = params.threadId as EntityId;

  const state = getOnboardingState(services, threadId);

  if (!state) {
    await services.logger.warn('No onboarding state found on thread context', { threadId });
    return { success: false, reason: 'no-state' };
  }

  if (state.step === 'complete') {
    if (response && typeof response === 'string') {
      services.chat.showThread(response as EntityId);
    }
    return { success: true, step: 'complete', threadId, response };
  }

  if (params.messageId !== state.pendingMessageId) {
    await services.logger.info('Ignoring response for non-pending message', {
      received: params.messageId,
      expected: state.pendingMessageId,
      step: state.step,
    });
    return { success: false, reason: 'message-id-mismatch' };
  }

  return { success: true, step: state.step, threadId, response };
}
