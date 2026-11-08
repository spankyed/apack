// Whether a process tree is still working: the CPU it adds and the output it writes, for whatever bounds a process by
// its progress rather than a clock (`scripts/lib/bounded-spawn.ts`, `apack-cli/tests/_support/run-command.ts`). A starved
// process is slow and still working, and a budget that measures the clock kills it for the machine being busy, which is
// why the ceiling counts CPU time where a tree can be read.
import { execFile } from 'node:child_process';

/**
 * How long a process tree may go without CPU or output before whatever watches it ends it as stalled: one number
 * for every watcher — `boundedSpawn`, `runCommand` and the vitest progress guard — so a stall means the same at
 * every layer.
 */
export const IDLE_MS = 120_000;

/**
 * How much CPU a tree has to add to count as working. Not any increase: an idle Node process still runs its
 * timers, and macOS reports CPU to the hundredth of a second, so a tree wedged on a lock with one
 * `setInterval` in it would read as progressing for ever. A second of CPU is ten seconds at a tenth of a
 * core, which a starved compiler clears and a wedged one does not.
 */
const PROGRESS_CPU_MS = 1_000;

/** `[[dd-]hh:]mm:ss[.ss]`, which is `ps -o time` on both macOS and Linux, in milliseconds */
export function parseCpuTime(text: string): number {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  const seconds = clock!.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round((Number(days) * 86_400 + seconds) * 1000);
}

/**
 * The CPU time of each process in the tree rooted at `leader`'s process group, from one `ps` listing
 * (`pid ppid pgid time`).
 *
 * The group and every descendant of a member, because a group is not a tree: Playwright starts Electron in a
 * group of its own, so a test run whose runner only waits does its work outside the group it was spawned in.
 * A process reparented to init on its parent's exit is outside both, and the group-kill reaches it anyway.
 */
export function treeCpuMs(listing: string, leader: number): Map<number, number> {
  const rows = listing.trim().split('\n').map((line) => line.trim().split(/\s+/)).filter((row) => row.length === 4)
    .map(([pid, ppid, pgid, time]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), ms: parseCpuTime(time!) }));
  // The leader itself too, for a root that leads no group of its own: a vitest worker, which its pool started
  const members = new Set(rows.filter((row) => row.pgid === leader || row.pid === leader).map((row) => row.pid));
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (!members.has(row.pid) && members.has(row.ppid)) { members.add(row.pid); grew = true; }
    }
  }
  return new Map(rows.filter((row) => members.has(row.pid)).map((row) => [row.pid, row.ms]));
}

/**
 * The CPU a tree spent between two readings: what each process added, a new one's whole time included.
 *
 * Per process, never the difference of two totals. A process that exits takes its time out of the total, so a
 * tree that keeps starting short builds — a test pool does — reads lower after each one ends, and a total
 * compared with an earlier one says it has done nothing while it works flat out.
 */
export function cpuAdded(before: ReadonlyMap<number, number>, after: ReadonlyMap<number, number>): number {
  let added = 0;
  for (const [pid, ms] of after) added += Math.max(0, ms - (before.get(pid) ?? 0));
  return added;
}

/**
 * Whether a tree has stalled, from its readings and its output, with the times given rather than read: the
 * watchdog's whole decision, so it is tested over made-up readings and no clock.
 *
 * It also keeps what the tree has spent, which is what a ceiling measures: a busy machine or a slow disk
 * stretches a run's wall time and leaves its CPU time where it was, so a CPU ceiling is reached by a loop that
 * spins and never by a run that is slow. `spentMs` is a lower bound — a process that starts and exits between
 * two readings is never seen — which errs toward leaving a run alone.
 */
export function createStallTracker(idleMs: number, startedAt: number) {
  let last: ReadonlyMap<number, number> | undefined;
  let work = 0;
  let spent = 0;
  let progressAt = startedAt;
  let outputAt: number | undefined;
  return {
    output(at: number): void { progressAt = at; outputAt = at; },
    /** The CPU the tree has spent since it started, as far as the readings saw */
    get spentMs(): number { return spent; },
    /** When the tree last wrote output, or nothing if it never has */
    get lastOutputAt(): number | undefined { return outputAt; },
    /** Records a reading and answers whether the tree has now gone `idleMs` without progress */
    reading(now: ReadonlyMap<number, number>, at: number): boolean {
      // The first reading counts whole toward what was spent, its processes having started with the tree;
      // toward progress it is only the baseline, so a tree has to keep working to count as working
      spent += cpuAdded(last ?? new Map(), now);
      if (last !== undefined) work += cpuAdded(last, now);
      last = now;
      if (work >= PROGRESS_CPU_MS) {
        work = 0;
        progressAt = at;
        return false;
      }
      return at - progressAt >= idleMs;
    },
  };
}

/** One reading of the tree's CPU, or nothing when `ps` couldn't give one */
export const readTreeCpuMs = (leader: number): Promise<Map<number, number> | undefined> => new Promise((resolve) => {
  execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,time='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    resolve(error ? undefined : treeCpuMs(stdout, leader));
  });
});

/** How much work a party has done in all, in milliseconds of CPU, or nothing where it cannot be read */
export type WorkReading = () => Promise<number | undefined>;

/**
 * A process tree's work, from the readings the watchdog takes: what each process in it added, summed over every
 * reading, so a process that exits keeps the work it did (`cpuAdded`). Nothing where `ps` gives no reading.
 */
export function processWork(pid: number, read: typeof readTreeCpuMs = readTreeCpuMs): WorkReading {
  let last = new Map<number, number>();
  let total = 0;
  return async () => {
    const tree = await read(pid);
    if (tree === undefined) return undefined;
    total += cpuAdded(last, tree);
    last = tree;
    return total;
  };
}

/**
 * A worker thread's work: its own CPU, which a thread sharing its process's pid can't be read for any other way.
 * `Worker.cpuUsage` is newer than the Node types this repo compiles against, so it is reached as optional, and a
 * runtime without it reads as nothing, which bounds the wait by silence.
 */
export function threadWork(worker: object): WorkReading {
  const usage = (worker as { cpuUsage?: () => Promise<{ user: number; system: number }> }).cpuUsage?.bind(worker);
  return async () => {
    if (usage === undefined) return undefined;
    try {
      const { user, system } = await usage();
      return (user + system) / 1000;
    } catch {
      // A thread that has exited has no usage to read, and its exit is what its waiter hears instead
      return undefined;
    }
  };
}

/**
 * Waits for another process or thread to answer for as long as it is working, rather than for a fixed time.
 *
 * A party that is busy answers late and never fails to, so a deadline on the clock refuses it for the load it ran
 * under: a compiler worker given two seconds to accept a request missed them at a load of 40. So the wait ends only
 * when the party goes `idleMs` without adding work — the stall decision the watchdog makes (`createStallTracker`) —
 * or when the answer arrives, whichever is first.
 *
 * A reading that cannot be taken repeats the last one that could, so it adds no work: a party nothing can read is
 * still bounded, by `idleMs` of silence, and a reading that fails between two good ones cannot pass off the whole
 * total as new work. `ceilingMs` is the other hang, a party that keeps spending CPU and never answers: the wait is
 * refused once the party has spent that much since it began.
 */
export function answerWhileWorking<T>(answer: Promise<T>, { work, what, idleMs = IDLE_MS, ceilingMs }: {
  readonly work: WorkReading; readonly what: string; readonly idleMs?: number; readonly ceilingMs?: number;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tracker = createStallTracker(idleMs, Date.now());
    let lastTotal: number | undefined;
    // The first reading is where the wait began: what the party did before it is not what the ceiling is about
    let firstTotal: number | undefined;
    let reading = false;
    let done = false;
    const refuse = (why: string) => {
      done = true;
      clearInterval(timer);
      reject(new Error(`${what} did not answer, and ${why}`));
    };
    const timer = setInterval(() => {
      if (reading || done) return;
      reading = true;
      // A reader that throws has given no reading, which is the same as one that cannot be taken
      void work().catch(() => undefined).then((total) => {
        reading = false;
        if (done) return;
        lastTotal = total ?? lastTotal;
        firstTotal ??= lastTotal;
        const spent = (lastTotal ?? 0) - (firstTotal ?? 0);
        if (tracker.reading(new Map([[0, lastTotal ?? 0]]), Date.now())) refuse(`did no work for ${idleMs / 1000}s`);
        else if (ceilingMs !== undefined && spent >= ceilingMs) refuse(`spent ${Math.round(spent / 1000)}s of CPU trying`);
      });
    }, Math.min(5_000, idleMs / 4));
    timer.unref?.();
    answer.then(
      (value) => { if (!done) { done = true; clearInterval(timer); resolve(value); } },
      (error: unknown) => { if (!done) { done = true; clearInterval(timer); reject(error); } },
    );
  });
}
