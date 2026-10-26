/**
 * Threads Service
 *
 * Thread-level state writes for actions and systems. A window sees each through the threads views.
 */

import { EARS } from '#generated/ears.ts';

import { repository } from '#generated/repository.ts';

/**
 * Update a thread's chatState.
 *
 * This is the canonical service-level write for chatState. The DSL helper
 * `updateChatState()` in thread-context.ts handles the thread context side,
 * then delegates here for the thread write.
 */
export function updateChatState(
  threadId: EARS.EntityId,
  chatState: string,
): void {
  try {
    repository.threadCommands.update(threadId, { chatState });
  } catch { /* thread may have been deleted */ }
}

/** `services.threads`: thread-level state writes */
export const threadsService = {
  updateChatState,
};
