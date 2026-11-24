import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Ignore Onboarding Message',
  description: 'Marks a user message as cancelled when sent during onboarding',
  category: 'onboarding',
  input: {
    threadId: { type: 'string', description: 'The thread ID', required: true },
    messageId: { type: 'string', description: 'The message ID to cancel', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  // If onboarding is already complete, do nothing
  if (services.onboarding.isComplete()) {
    return { success: true, skipped: true };
  }

  // Only cancel messages on the birth thread — never touch other threads
  const { threadId, messageId } = params;
  if (threadId) {
    const thread = services.repository.threadQueries.byId(threadId) as any;
    if (thread?.forcedMode !== 'Birth') {
      return { success: true, skipped: true };
    }
  }

  if (messageId) {
    services.chat.updateMessageState(messageId, { status: 'cancelled' });
  }

  return { success: true };
}
