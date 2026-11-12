/**
 * Take Back Turn — puts the working tree back as it was when an agent's turn started, from the copy the turn
 * took then: what the turn changed is put back, and what it made is removed. Raised from the turn's diff artifact
 * (`user.turn.takeBack`), which is then marked as taken back.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Take Back Turn',
  description: "Puts the working tree back as it was when an agent's turn started.",
  category: 'git',
  input: {
    checkpoint: { type: 'string', description: 'The copy taken as the turn started', required: true },
    artifactId: { type: 'string', description: "The turn's diff artifact, marked once taken back", required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const { checkpoint, artifactId } = params as { checkpoint: string; artifactId?: string };
  if (!checkpoint) return { success: false, reason: 'missing checkpoint' };
  try {
    await services.cli.git.restoreCheckpoint(checkpoint);
  } catch (error) {
    services.logger.warn('the turn could not be taken back', { message: (error as Error)?.message });
    return { success: false, reason: (error as Error)?.message };
  }
  // The windows read the repository again: the files changed with no file event for each
  services.emitter.sendToSystem('default-setup/code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' });
  if (artifactId) {
    const content = services.artifact.contentOf(artifactId as EntityId) as Record<string, any> | undefined;
    if (content?.turn) services.artifact.update(artifactId as EntityId, { content: { ...content, turn: { ...content.turn, takenBack: true } } });
  }
  return { success: true };
}
