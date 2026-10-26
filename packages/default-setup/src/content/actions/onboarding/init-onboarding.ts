import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { persistOnboardingState, type OnboardingState } from './onboarding-helpers.ts';

export const meta: ActionMeta = {
  label: 'Init Onboarding',
  description: 'Creates the birth thread and sends the welcome artifact for onboarding',
  category: 'onboarding',
  input: {},
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const ASSISTANT_BIRTH_ROLE = 'assistant_birth';

  // Check if birth thread already exists and has valid data
  const existingBirthThreadId = services.repository.threadQueries.idByRole(ASSISTANT_BIRTH_ROLE);

  if (existingBirthThreadId) {
    const threadData = services.repository.threadQueries.byId(existingBirthThreadId);
    if (threadData && Object.keys(threadData).length > 1) {
      await services.logger.info('Birth thread already exists, skipping onboarding init', {
        threadId: existingBirthThreadId,
      });
      services.chat.showThread(existingBirthThreadId);
      return { threadId: existingBirthThreadId, success: true, created: false };
    }
    await services.logger.info('Stale birth thread reference found, cleaning up', {
      threadId: existingBirthThreadId,
    });
    services.repository.threadCommands.destroyStale(existingBirthThreadId);
  }

  // Create the onboarding thread; progress lives in its context.
  const { id: threadId } = services.chat.createThread({
    topic: 'Getting Started',
    instructions: '',
    tags: [],
    role: ASSISTANT_BIRTH_ROLE,
    forcedMode: 'Birth',
    pinned: true,
  });

  // Send welcome message with "Let's go" button
  const { messageId } = services.chat.sendChoiceBlock({
    threadId,
    text: "Welcome! Ready to get started?",
    prompt: '',
    choices: [{ id: 'continue', label: "Let's go", description: '' }],
    allowCustom: false,
    forkable: false,
    autoHide: true,
    asUser: true,
  });

  services.threads.updateChatState(threadId, 'paused');

  // Persist onboarding state to thread context
  const onboardingState: OnboardingState = {
    step: 'welcome',
    threadId,
    pendingMessageId: messageId,
    data: {},
  };
  persistOnboardingState(services, threadId, onboardingState);

  // Open the thread first so the frontend is listening for artifact events
  services.chat.showThread(threadId);

  // Create note artifact pointing to the welcome note (after thread is open)
  const notes = services.repository.noteQueries.allDTOs();
  const welcomeNote = notes.find((n: any) => n.title === 'welcome');

  if (welcomeNote) {
    services.artifact.create({
      artifactType: 'note',
      title: 'Welcome',
      content: welcomeNote.id,
      threadId,
    });
  }

  await services.logger.info('Onboarding initialized', { threadId });

  return { threadId, success: true, created: true };
}
