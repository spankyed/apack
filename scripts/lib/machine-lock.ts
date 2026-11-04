// One expensive step at a time across this machine's checkouts.
//
// Each chain sizes its pools as though it owned the machine, so two checkouts running integration at once oversubscribe
// it, and cases die on their deadlines while they are working. Waiting costs the second one time and costs nobody a
// failure. Cargo's build lock is the same bargain, and it says so the same way.
//
// In the system's temporary directory because no checkout owns it, under a name `pruneStamps` has no reason to see.
import * as os from 'node:os';
import * as path from 'node:path';
import { holdExclusiveLockWaiting, type ExclusiveLock } from '@apackdev/host/exclusive-lock';

export const MACHINE_LOCK = path.join(os.tmpdir(), 'apack-expensive-steps.lock');

export class MachineLockHeld extends Error {
  constructor(readonly holder: string) {
    super(`An expensive step can't wait for ${holder}`);
  }
}

/**
 * Runs expensive steps under the machine's lock, which one chain holds for as long as any of its steps is inside: its own
 * steps overlap as its budget allows, and the lock goes back between them. A wait has no bound of its own, because the
 * holder's steps each have their ceiling and a holder that dies is taken over.
 */
export function expensiveSteps({ what, file = MACHINE_LOCK, onWait, pause }: {
  what: string;
  /** The spec passes its own: it runs inside a chain that may hold the real one */
  file?: string;
  onWait?: (holder: string) => void;
  pause?: (ms: number) => Promise<void>;
}) {
  let inside = 0;
  let holding: Promise<ExclusiveLock> | undefined;
  return async <T>(work: () => Promise<T>): Promise<T> => {
    inside++;
    holding ??= holdExclusiveLockWaiting({
      file, what, waitMs: Number.POSITIVE_INFINITY,
      refuse: (holder) => new MachineLockHeld(holder),
      ...(onWait && { onWait }),
      ...(pause && { pause }),
    });
    const held = holding;
    try {
      await held;
      return await work();
    } finally {
      inside--;
      if (inside === 0) {
        holding = undefined;
        void held.then((lock) => lock.release(), () => {});
      }
    }
  };
}
