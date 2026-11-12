/**
 * An agent's turn as a checkpoint: a copy of the working tree taken as the turn starts, and what differs from it
 * once the turn ends, which is what the turn changed, whatever wrote it. The copy is kept outside the repository by
 * the git engine (`checkpoint`), so taking a turn back puts the files as they were and touches nothing of git's.
 */
import type { Services } from '#generated/services.ts';

/** What a turn changed, and the copy it can be taken back to */
export interface TurnChanges {
  checkpoint: string;
  changes: { path: string; change: 'added' | 'modified' | 'deleted' }[];
}

/** A copy of the working tree as a turn starts; nothing where the folder is in no repository, or it could not be taken */
export async function checkpointTurn(services: Services): Promise<string | undefined> {
  return services.cli.git.checkpoint().catch((error: unknown) => {
    services.logger.debug('no checkpoint for this turn', { message: (error as Error)?.message });
    return undefined;
  });
}

/** What differs from a turn's copy now that it has ended; nothing when it had none, or it could not be read */
export async function turnChanges(services: Services, checkpoint: string | undefined): Promise<TurnChanges | undefined> {
  if (!checkpoint) return undefined;
  try {
    return { checkpoint, changes: await services.cli.git.changedSince(checkpoint) };
  } catch (error) {
    services.logger.warn('what the turn changed could not be read', { message: (error as Error)?.message });
    return undefined;
  }
}
