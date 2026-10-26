import type { ActionMeta } from '@apackdev/sdk/build';
import type { EntityId, Services } from '#generated/services.ts';
import { getOnboardingState, persistOnboardingState, showChooseModeOrFinish, finishOnboarding } from '../onboarding-helpers.ts';

export const meta: ActionMeta = {
  label: 'Handle Pick Thread Step',
  description: 'Opens a selected thread, then advances to mode chooser or finishes',
  category: 'onboarding',
  input: {
    threadId: { type: 'string', required: true },
    response: { type: 'any', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const threadId = params.threadId as EntityId;
  const response = typeof params.response === 'string' ? params.response : '';
  const state = getOnboardingState(services, threadId);
  if (!state) return { success: false, reason: 'no-state' };

  if (response && response !== 'skip') {
    services.chat.showThread(response as EntityId);
    finishOnboarding(services, state, threadId, { skipCompletionMessage: true });
  } else {
    showChooseModeOrFinish(services, state, threadId);
  }
  persistOnboardingState(services, threadId, state);
  return { success: true, step: state.step };
}
