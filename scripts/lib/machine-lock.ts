// One chain at a time on the expensive steps across this machine's checkouts.
//
// Each chain sizes its pools as though it owned the machine, so two checkouts running integration at once oversubscribe
// it, and cases die on their deadlines while they are working. Waiting costs the second one time and costs nobody a
// failure. Cargo's build lock is the same bargain, and it says so the same way.
//
// Which steps are expensive is the steps' own declaration (`ChainStep.expensive`). Asked at admission (`ScheduleOptions.admission`), so a step waiting for the lock holds no cores and its chain
// runs what else it can, and a chain that has already failed never starts one.
import * as os from 'node:os';
import * as path from 'node:path';
import { holdExclusiveLock, readLock, type ExclusiveLock } from '@apackdev/host/exclusive-lock';
import { TIMEOUT_MS } from './step-timeouts.ts';

/** Under the home directory, since no checkout owns it and `TMPDIR` differs between two shells on one machine */
export const MACHINE_LOCK = path.join(os.homedir(), '.cache', 'apack', 'expensive-steps.lock');

/** How long a chain waits for a holder that looks alive: as long as the longest step it could be running */
export const MACHINE_WAIT_MS = TIMEOUT_MS.acceptance.ms;
/**
 * How long a chain waits on a lock nothing can resolve: unreadable, naming another machine (macOS's hostname moves with the
 * network) or naming this process, which holds none. Not at once, because `wx` makes the file before it writes it
 */
export const UNRESOLVED_WAIT_MS = 30_000;

const POLL_MS = 2_000;

type ExpensiveStep = { readonly name: string; readonly expensive?: true };

/** A lock this chain won't wait any longer for, naming what to do about it: a refusal rather than a bug in the chain */
export class MachineLockRefused extends Error {
  constructor(holder: string, file: string) {
    super(`The expensive steps are held by ${holder}. If that isn't running any more, delete ${file} and run this again.`);
  }
}

const HELD = new Error('held');

const sleep = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, POLL_MS); });

/**
 * What a chain's scheduler asks before an expensive step starts and tells when it ends. One hold for as long as any of its
 * steps is inside, so its own steps overlap as its budget allows, and the lock goes back between them.
 */
export function expensiveSteps({ what, file = MACHINE_LOCK, onWait, now = Date.now, pause = sleep }: {
  what: string;
  /** The spec passes its own: it runs inside a chain that may hold the real one */
  file?: string;
  onWait?: (holder: string) => void;
  now?: () => number;
  pause?: () => Promise<void>;
}) {
  let inside = 0;
  let held: ExclusiveLock | undefined;
  let waitingSince: number | undefined;
  let unresolvedSince: number | undefined;

  /** Notes a turn spent behind another's lock, refusing once it has gone on too long */
  const wait = (): void => {
    const at = now();
    const lock = readLock(file);
    const holder = lock === null ? "a tool whose lock can't be read" : `${lock.what} (pid ${lock.pid}, on ${lock.machine})`;
    if (waitingSince === undefined) {
      waitingSince = at;
      onWait?.(`${holder}\n  lock: ${file}`);
    }
    const resolvable = lock !== null && lock.machine === os.hostname() && lock.pid !== process.pid;
    unresolvedSince = resolvable ? undefined : unresolvedSince ?? at;
    const tooLong = at - waitingSince >= MACHINE_WAIT_MS;
    if (tooLong || (unresolvedSince !== undefined && at - unresolvedSince >= UNRESOLVED_WAIT_MS)) {
      throw new MachineLockRefused(holder, file);
    }
  };

  return {
    /** Takes the lock for an expensive step, answering whether it may start; only a lock actually held is waited for */
    admit(step: ExpensiveStep): boolean {
      if (step.expensive !== true) return true;
      try {
        held ??= holdExclusiveLock({ file, what, refuse: () => HELD });
      } catch (error) {
        if (error !== HELD) throw error;
        wait();
        return false;
      }
      waitingSince = undefined;
      unresolvedSince = undefined;
      inside++;
      return true;
    },
    leave(step: ExpensiveStep): void {
      if (step.expensive !== true) return;
      inside--;
      if (inside > 0) return;
      held?.release();
      held = undefined;
    },
    pause,
  };
}
