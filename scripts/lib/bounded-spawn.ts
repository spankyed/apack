/**
 * Spawning with a wall-clock budget, because a run that can hang cannot fail.
 *
 * Without a bound one wedged step hangs the whole run until a person kills it: a test server that never
 * returns, a build lock waited on, a compile that stops making progress. Vitest's own timeouts cannot catch
 * these, because they bound a *test* and not the process around it, and a synchronous block
 * (`Atomics.wait`) is invisible to them entirely.
 *
 * Two rules this enforces, and both matter:
 *
 * - **A budget is a declared class, not a multiple of a measurement**, which would make it a function of one
 *   machine. Callers pass `TIMEOUT_MS[class]` (`scripts/lib/step-timeouts.ts`), which carries no machine. A
 *   bound longer than anyone will wait is the same as no bound, which keeps the ladder short.
 * - **A hang is no progress, not a long time.** A starved process is slow and still working, and a budget
 *   that measures the clock kills it for the machine being busy. So the watchdog below ends a run whose
 *   process tree has used no CPU and written no output for `IDLE_MS`, and the budget above it is a ceiling
 *   for the one hang the watchdog cannot see: a loop that spins.
 * - **The process group dies, not just the child.** `npm run x` is a shell that spawns node that spawns
 *   vitest that spawns workers. Killing the child alone orphans the rest, still running. And the group dies
 *   when the child exits however it ends, a pass included: nothing a run started outlives it.
 */
import { execFile, spawn } from 'node:child_process';
import { IDLE_MS, watchdogEnabled } from './step-timeouts.ts';

export interface BoundedResult {
  readonly code: number;
  readonly output: string;
  readonly ms: number;
  /** Set when the budget ran out, or with `stalled` when the watchdog ended it: either way it was killed */
  readonly timedOut?: true;
  /** Set when its process tree stopped working — no CPU and no output for the idle window — before the budget */
  readonly stalled?: true;
  /** Set when the caller stopped it. Distinct from a failure, which `code` alone cannot say. */
  readonly aborted?: true;
}

/** How long a killed group gets to exit on SIGTERM before SIGKILL */
const GRACE_MS = 2_000;

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
  const members = new Set(rows.filter((row) => row.pgid === leader).map((row) => row.pid));
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
 */
export function createStallTracker(idleMs: number, startedAt: number) {
  let last: ReadonlyMap<number, number> | undefined;
  let work = 0;
  let progressAt = startedAt;
  return {
    output(at: number): void { progressAt = at; },
    /** Records a reading and answers whether the tree has now gone `idleMs` without progress */
    reading(now: ReadonlyMap<number, number>, at: number): boolean {
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

const readTreeCpuMs = (leader: number): Promise<Map<number, number> | undefined> => new Promise((resolve) => {
  execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,time='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    resolve(error ? undefined : treeCpuMs(stdout, leader));
  });
});

/**
 * The groups this process started and has not seen close. A budget bounds a step that hangs, but nothing
 * bounded *this* process dying with steps still running: Ctrl-C at a chain, or an orchestrator throwing,
 * left a vitest and its workers alive and reparented to init. That is the same orphan the group-kill above
 * exists to prevent, arriving through the other door.
 *
 * Only pids this module spawned, killed by group — never a search for processes by name.
 */
const liveGroups = new Set<number>();
let reaperInstalled = false;
let stopping = false;

function reapOnExit(): void {
  if (reaperInstalled) return;
  reaperInstalled = true;
  const reap = (signal: NodeJS.Signals) => {
    for (const pid of liveGroups) {
      try { process.kill(-pid, signal); } catch { /* already gone */ }
    }
  };
  // 'exit' is synchronous-only, which process.kill is. It covers a normal end and an uncaught throw.
  process.on('exit', () => reap('SIGKILL'));
  // A signal does not run 'exit' handlers on its own, so each one reaps and then re-raises the default,
  // which keeps the exit status honest (130 for SIGINT) instead of turning a Ctrl-C into a clean 0.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      // Keep the snapshot after a shell exits: its grandchildren can still hold the process group.
      const groups = [...liveGroups];
      const kill = () => {
        for (const pid of groups) {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
        }
      };
      process.once('exit', kill);
      reap('SIGTERM');
      setTimeout(() => {
        kill();
        process.removeAllListeners(signal);
        process.kill(process.pid, signal);
      }, GRACE_MS);
    });
  }
}

export interface BoundedOptions {
  readonly cwd?: string;
  /** Required for command wrappers such as npm.cmd on Windows. */
  readonly shell?: boolean;
  /** Inherit stdio instead of capturing it: what a direct run wants, where output is read as it happens */
  readonly stream?: boolean;
  /**
   * The child's environment, where this process's own will not do — a measured command needs a preload
   * and a destination its parent must not also carry.
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Stop it before the budget does, down the same group-kill path.
   *
   * It exists so that a caller with a process to stop early does not register interrupt handlers of its
   * own. It cannot: the reaper above calls `removeAllListeners` before re-raising, so of two handlers for
   * one signal the second never runs — and the one that goes unrun is whichever was registered later,
   * which is not something a caller can see. One reaper, and everything it must kill goes through here.
   */
  readonly signal?: AbortSignal;
  /**
   * How long its tree may go without CPU or output before the watchdog ends it, `IDLE_MS` by default.
   * `false` for a command whose work is not in its process tree — one run in the Linux container, whose CPU
   * is the VM's — which leaves the budget as its only bound.
   */
  readonly idleMs?: number | false;
}

export function boundedSpawn(command: string, args: readonly string[], budgetMs: number, options: BoundedOptions = {}): Promise<BoundedResult> {
  const { cwd = process.cwd(), stream = false, env = process.env, signal } = options;
  // Windows has no process groups or `ps`, so there the budget is the only bound
  const idleMs = process.platform === 'win32' || !watchdogEnabled() ? false : options.idleMs ?? IDLE_MS;
  const started = Date.now();
  reapOnExit();
  if (stopping || signal?.aborted === true) {
    return Promise.resolve({ code: 1, output: '', ms: 0, aborted: true });
  }
  return new Promise((resolve) => {
    // Its own process group, so one kill reaches the whole tree rather than orphaning it
    const child = spawn(command, [...args], {
      cwd, env, detached: true, shell: options.shell,
      stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) liveGroups.add(child.pid);
    let output = '';
    let timedOut: true | undefined;
    let stalled: true | undefined;
    let aborted: true | undefined;
    const stall = idleMs === false ? undefined : createStallTracker(idleMs, Date.now());
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); stall?.output(Date.now()); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); stall?.output(Date.now()); });

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      // Negative pid is the group. It throws once the group is gone, which is the normal case on the
      // SIGKILL that follows, so a failure here is nothing to report.
      try { process.kill(-child.pid, signal); } catch { /* already gone */ }
    };

    let closed: number | null = null;
    const done = () => resolve({
      code: timedOut ? 124 : closed ?? 1,
      output,
      ms: Date.now() - started,
      ...(timedOut ? { timedOut } : {}),
      ...(stalled ? { stalled } : {}),
      ...(aborted ? { aborted } : {}),
    });

    /**
     * One ending for both ways a run is cut short, because they need the same two kills.
     *
     * The escalation is not unref'd, and it is what resolves: an unref'd one never fires, because the
     * process ends as soon as the child closes. A child that ignores SIGTERM would then have survived the
     * run that started it, which is the whole failure this exists to prevent.
     */
    let terminating = false;
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      clearTimeout(budget);
      clearInterval(watchdog);
      killGroup('SIGTERM');
      setTimeout(() => { killGroup('SIGKILL'); done(); }, GRACE_MS);
    };

    const budget = setTimeout(() => { timedOut = true; terminate(); }, budgetMs);
    budget.unref();

    // A reading of the tree on a timer, because nothing announces that a process has stopped working. Each
    // reading waits for the last: under load `ps` itself can be slow, and two in flight would race the last reading.
    let inFlight = false;
    const watchdog = idleMs === false || stall === undefined || child.pid === undefined ? undefined : setInterval(() => {
      if (inFlight || terminating) return;
      inFlight = true;
      void readTreeCpuMs(child.pid!).then((now) => {
        inFlight = false;
        if (now === undefined || terminating) return;
        if (stall.reading(now, Date.now())) {
          const why = `\n[bounded] no CPU or output from its process tree for ${idleMs / 1000}s: stalled, so its process group was killed\n`;
          output += why;
          if (stream) process.stderr.write(why);
          timedOut = true;
          stalled = true;
          terminate();
        }
      });
    }, Math.min(5_000, idleMs / 4));
    watchdog?.unref();
    const abort = () => { aborted = true; terminate(); };
    signal?.addEventListener('abort', abort, { once: true });

    child.on('error', (error) => {
      output += `${error.message}\n`;
      if (stream) console.error(error.message);
      closed = 1;
    });

    // What is still in the group once its leader has exited was orphaned: a vitest that died on one worker's
    // native abort leaves the others running, reparented to init. They hold the pipes, so 'close' waits on them.
    child.on('exit', () => { killGroup('SIGKILL'); });

    child.on('close', (code) => {
      clearTimeout(budget);
      clearInterval(watchdog);
      signal?.removeEventListener('abort', abort);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      closed ??= code;
      // On a timeout or an abort the escalation resolves, so the group is hard-killed before this returns
      if (!timedOut && !aborted) done();
    });
  });
}
