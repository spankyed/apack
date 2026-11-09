// One writer at a time, for work that changes files two processes would otherwise interleave on.
//
// The mechanism, not the policy: what the lock file is called and what the refusal says belong to whoever takes
// it. `database/write-lock.ts` is one caller (a tool changing a data dir's database), the CLI's code generation
// another (two `apack pack generate-entries` runs writing one pack's `src/__generated__/`, which is how this module
// came to exist — concurrent runs overwrote each other and the output read as stale).
//
// A check followed by a write cannot do this: every racer reads "nothing holds it" and then writes in turn. The
// create *is* the acquisition (`wx`, `O_EXCL`), and a lock whose holder has exited is taken over.
import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { lockIsHeld, sameWriter } from './process-liveness.ts';
// By path: the chain's own runner takes its lock through this module before any package is built, and
// `@apackdev/sdk` resolves to its `dist` outside a host build
import { createStallTracker, IDLE_MS, readTreeCpuMs } from '../../apack-sdk/src/progress.ts';

/**
 * What the file holds. `pid` answers the question the lock exists to ask, "is the holder still running";
 * `machine` says whether that pid is this machine's to check, since a pid from another host means nothing
 * against this one's process table. A file missing either can't be resolved, and an unresolved lock counts as held.
 */
export interface LockFile {
  pid: number;
  machine: string;
  /** What the holder is doing, for the message the next arrival sees */
  what: string;
  since: string;
  /** New claims identify this acquisition, independently of PID reuse or timestamp granularity. */
  token?: string;
}

/**
 * The interruptions a release can be hung on. `SIGBREAK` is Ctrl-Break, and Windows only: registering a listener
 * for it is harmless where it doesn't exist, and without it that key leaves the lock behind.
 *
 * What none of them reach is an unconditional end — `SIGKILL`, `taskkill /F`, power loss. There the file stays and
 * the next holder takes it over, or the user removes it; an advisory lock is what would close that
 * (docs/goals/goal-write-lock-advisory.md).
 */
export const INTERRUPTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const satisfies readonly NodeJS.Signals[];

export function readLock(file: string): LockFile | null {
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<LockFile>;
    if (typeof held.pid !== 'number' || typeof held.machine !== 'string') return null;
    return { pid: held.pid, machine: held.machine, what: String(held.what ?? 'a tool'), since: String(held.since ?? ''),
      ...(typeof held.token === 'string' ? { token: held.token } : {}) };
  } catch {
    return null;
  }
}

/**
 * Creates the lock with this process's details, or reports that the file is already there.
 *
 * `wx` is `O_EXCL`: the create *is* the acquisition, so two arriving together cannot both get it.
 */
function takeLock(file: string, mine: LockFile): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(mine));
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/**
 * Who holds `file` right now, described, or `null` when nobody does: a lock whose process has exited doesn't count.
 * Two cases can't be resolved and count as held: a lock this version can't read, and one naming another machine,
 * whose pid means nothing here.
 *
 * `lockIsHeld` errs toward held, which means a lock whose pid this boot reassigned keeps the next arrival out until
 * someone deletes it. Releasing on interrupt makes that rare to begin with.
 */
export function findLockHolder(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const held = readLock(file);
  if (!held) return "a tool whose lock can't be read";
  if (held.machine !== os.hostname()) return `${held.what} on ${held.machine}`;
  return lockIsHeld(held.pid) ? `${held.what} (pid ${held.pid})` : null;
}

/** A lock held; `release()` is safe to call more than once */
export interface ExclusiveLock {
  release(): void;
}

/**
 * Takes `file` for the duration of some work, or throws `refuse(holder)`. A lock left by a process that has exited
 * is taken over. The caller releases it, whatever happens.
 *
 * One holder, with no re-entrancy: a second take in this process is refused like any other, naming this pid. That
 * is deliberate — nothing nests today (the build takes this only through code generation, once), and a lock that
 * quietly succeeds when you already hold it is a lock that cannot tell you that you hold it twice.
 */
export function holdExclusiveLock(options: {
  file: string;
  what: string;
  refuse: (holder: string) => Error;
}): ExclusiveLock {
  const { file, what, refuse } = options;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let released = false, acquired = false;
  const mine: LockFile = { pid: process.pid, machine: os.hostname(), what, since: new Date().toISOString(), token: randomBytes(16).toString('hex') };
  const release = () => {
    if (released) return;
    released = true;
    // Nothing left to do on the way out; without this a process taking many locks in turn piles up listeners
    process.off('exit', release);
    for (const signal of INTERRUPTS) process.off(signal, onInterrupt);
    // A refused acquisition owns no file. A later acquisition in this PID may also have replaced ours.
    if (acquired && readLock(file)?.token === mine.token) fs.rmSync(file, { force: true });
  };
  /**
   * Node runs no `exit` handler for a signal, so without this Ctrl-C leaves the lock behind and the next reader has
   * to work out that its holder is gone. Re-raising after releasing keeps the caller's view of how it ended.
   */
  function onInterrupt(signal: NodeJS.Signals): void {
    release();
    process.kill(process.pid, signal);
  }
  // Before the lock exists, not after: a process descheduled between writing the file and getting here would be
  // killed by the default disposition and leave the lock behind — the very thing these handlers are for.
  process.once('exit', release);
  for (const signal of INTERRUPTS) process.once(signal, onInterrupt);

  const fail = (holder: string): never => {
    release();
    throw refuse(holder);
  };

  try {
    acquired = takeLock(file, mine);
    if (!acquired) {
      const leftover = readLock(file);
      const holder = findLockHolder(file);
      if (holder) fail(holder);
      // A lock a killed process left behind. Removing it and creating ours are two steps, so a racer that also
      // judged it stale can take it between them — narrow, and the one window `wx` cannot close, because a file's
      // existence carries no liveness. Re-read first, so this removes the leftover it judged.
      if (sameWriter(readLock(file), leftover)) fs.rmSync(file, { force: true });
      acquired = takeLock(file, mine);
      if (!acquired) fail(findLockHolder(file) ?? 'another tool that took it first');
    }
  } catch (err) {
    if (!released) release();
    throw err;
  }
  return { release };
}

/** How often a waiter tries again. The take is the test, so this is only how long a loser sleeps */
const POLL_MS = 500;
/** How often a waiter reads the holder's CPU: a listing of every process is too costly for each poll */
const HOLDER_READ_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** How a wait on a held lock reads its holder: injected by a spec, so its bound is reached without waiting it out */
export interface HolderWatchOptions {
  /** How long the holder may do no work before the waiter gives up on it; half the watchdog's window by default */
  idleMs?: number;
  now?: () => number;
  /** The holder's process tree's CPU; nothing where it cannot be read */
  readWork?: (pid: number) => Promise<ReadonlyMap<number, number> | undefined>;
}

/**
 * Whether the process holding `file` has stopped working, asked once per look: the stall decision `watchWork`
 * takes, over readings of whoever holds the lock at each look. Each holder is watched from its own start, so one
 * holder's silence is never charged to the next, and a holder on another machine, or one whose lock cannot be
 * read, gives no reading and is bounded by its silence.
 */
function watchHolder(file: string, { idleMs = IDLE_MS / 2, now = Date.now, readWork = readTreeCpuMs }: HolderWatchOptions) {
  let watching: { pid: number | undefined; tracker: ReturnType<typeof createStallTracker>; readAt: number } | undefined;
  return async (): Promise<boolean> => {
    const holder = readLock(file);
    const pid = holder !== null && holder.machine === os.hostname() ? holder.pid : undefined;
    const at = now();
    const current = watching !== undefined && watching.pid === pid ? watching
      : { pid, tracker: createStallTracker(idleMs, at), readAt: Number.NEGATIVE_INFINITY };
    watching = current;
    if (at - current.readAt < Math.min(HOLDER_READ_MS, idleMs / 4)) return false;
    current.readAt = at;
    return current.tracker.reading((pid === undefined ? undefined : await readWork(pid)) ?? new Map(), at);
  };
}

/**
 * Waits while `file` is held, for as long as its holder works, without taking it: for a reader of output another
 * process is writing under the lock. Answers whether it was released, or `false` when the holder stopped working.
 */
export async function waitWhileHeld(file: string, options: HolderWatchOptions & { pause?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const stalled = watchHolder(file, options);
  const pause = options.pause ?? sleep;
  while (findLockHolder(file)) {
    if (await stalled()) return false;
    await pause(POLL_MS);
  }
  return true;
}

/**
 * `holdExclusiveLock`, waiting for a held lock instead of refusing at once when `wait` is set — for as long as its
 * holder keeps working, then refusing.
 *
 * **The holder's progress, not a clock, is the bound**: it returns the moment the holder is gone, and refuses
 * once the process the lock names has done no work for `idleMs`, which is a wedge rather than a queue. A holder
 * slow only because the machine is busy is waited for, however long it takes. Half the watchdog's window by
 * default, because a waiter does no work itself, and a run the watchdog bounds would otherwise be killed at the
 * moment it would have refused. `onWait` is told once, because a wait that prints nothing reads as a hang.
 *
 * **The retry is around the take, never a check and then a take.** The create is the test (`wx`), so two
 * waiters arriving together cannot both win and a loser simply waits again. Asking who holds it and taking
 * afterwards is the shape that lets every racer read "nothing holds it", which is what this module's header
 * was written against.
 *
 * **A lock this process already holds is refused *before* the take is attempted**, which is load-bearing twice
 * over. It keeps the no-re-entrancy rule above a refusal rather than a wedge, since waiting for yourself cannot
 * succeed. The synchronous take also preserves an incumbent after refusal; this precheck prevents a
 * waiting request from sleeping until its own timeout when that incumbent belongs to this process.
 *
 * Separate from `holdExclusiveLock` rather than an option on it, because that one is synchronous and its three
 * callers take it inline; an `await` there would reach every one of them for a wait none of them wants.
 */
export async function holdExclusiveLockWaiting(options: {
  file: string;
  what: string;
  refuse: (holder: string, waited: boolean) => Error;
  /** Whether to wait for a held lock at all: without it, a held lock is refused at once */
  wait: boolean;
  onWait?: (holder: string) => void;
  pause?: (ms: number) => Promise<void>;
} & HolderWatchOptions): Promise<ExclusiveLock> {
  const { file, what, refuse, wait, onWait, pause = sleep } = options;
  const stalled = watchHolder(file, options);
  let told = false;
  for (;;) {
    const mine = readLock(file);
    if (mine !== null && mine.pid === process.pid && mine.machine === os.hostname()) {
      throw refuse(findLockHolder(file) ?? mine.what, told);
    }
    try {
      return holdExclusiveLock({ file, what, refuse: (holder) => refuse(holder, told) });
    } catch (err) {
      if (!wait || await stalled()) throw err;
      if (!told) {
        told = true;
        onWait?.(findLockHolder(file) ?? what);
      }
      await pause(POLL_MS);
    }
  }
}
