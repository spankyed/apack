/**
 * Spawning with a budget, because a run that can hang cannot fail.
 *
 * Without a bound one wedged step hangs the whole run until a person kills it: a test server that never
 * returns, a build lock waited on, a compile that stops making progress. Vitest's own timeouts cannot catch
 * these, because they bound a *test* and not the process around it, and a synchronous block
 * (`Atomics.wait`) is invisible to them entirely.
 *
 * Two rules this enforces, and both matter:
 *
 * - **A budget is a declared class, not a multiple of a measurement**, which would make it a function of one
 *   machine. Callers pass `BUDGET_MS[class]` (`scripts/lib/step-budgets.ts`), which carries no machine. A
 *   bound longer than anyone will wait is the same as no bound, which keeps the ladder short.
 * - **A hang is no progress, not a long time.** A starved process is slow and still working, and a budget
 *   that measures the clock kills it for the machine being busy. So the watchdog below ends a run whose
 *   process tree has used no CPU and written no output for `IDLE_MS`, and the budget above it is a ceiling
 *   for the one hang the watchdog cannot see: a loop that spins.
 * - **The ceiling counts CPU time, not the clock.** A spin is what spends CPU without end, and load or a slow
 *   disk stretches a run's wall time without adding to its CPU, so a CPU ceiling is reached by the one and never
 *   by the other. The clock is the bound only where the tree cannot be read — Windows, `APACK_WATCHDOG=off`, a
 *   tree whose work is in a VM (`idleMs: false`), and from the moment `ps` fails. A tree *inside* a VM that
 *   accounts no steal time — the Linux test container — reads the host's load as its own CPU, so it runs with
 *   the watchdog alone (`APACK_CEILING=off`, which `test:linux` sets). What neither catches is a
 *   loop that sleeps and prints for ever: its output is progress by the watchdog's rule, and it spends no CPU.
 * - **The process group dies, not just the child.** `npm run x` is a shell that spawns node that spawns
 *   vitest that spawns workers. Killing the child alone orphans the rest, still running. And the group dies
 *   when the child exits however it ends, a pass included: nothing a run started outlives it.
 */
import { spawn } from 'node:child_process';
import { describeRefusal, processWork, watchWork } from '@apackdev/host/build/process-progress';
import { IDLE_MS, ceilingEnabled, watchdogEnabled } from './step-budgets.ts';



export interface BoundedResult {
  readonly code: number;
  readonly output: string;
  readonly ms: number;
  /**
   * The CPU its process tree spent, where the watchdog could read the tree: a lower bound, since a process that
   * starts and exits between two readings is never seen. A reading, which decides nothing but the ceiling.
   */
  readonly cpuMs?: number;
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
      ...(watch !== undefined ? { cpuMs: watch.spentMs() } : {}),
      ...(timedOut ? { timedOut } : {}),
      ...(stalled ? { stalled } : {}),
      ...(aborted ? { aborted } : {}),
    });

    /**
     * One ending for every way a run is cut short, because they need the same two kills.
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
      watch?.stop();
      killGroup('SIGTERM');
      setTimeout(() => { killGroup('SIGKILL'); done(); }, GRACE_MS);
    };

    const say = (why: string) => {
      output += why;
      if (stream) process.stderr.write(why);
    };

    // A tree the watchdog reads is bounded by its progress and the CPU it spends (`watchWork`), and only a tree it
    // cannot read by the clock. `APACK_CEILING=off` leaves the watchdog alone, for a VM whose CPU is not work
    const watch = idleMs === false || child.pid === undefined ? undefined : watchWork({
      work: processWork(child.pid), idleMs, watchesOutput: true, ceilingMs: ceilingEnabled() ? budgetMs : undefined, fallbackMs: budgetMs,
      onRefused: (refusal) => {
        stalled = refusal.kind === 'stalled' ? true : undefined;
        say(`\n[bounded] ${refusal.kind === 'stalled'
          ? `no CPU or output from its process tree for ${idleMs / 1000}s: stalled`
          : describeRefusal(refusal)}, so its process group was killed\n`);
        timedOut = true;
        terminate();
      },
    });
    const budget = watch !== undefined ? undefined : setTimeout(() => {
      say(`\n[bounded] ran past its ${budgetMs / 1000}s budget on the clock, its CPU unreadable: its process group was killed\n`);
      timedOut = true;
      terminate();
    }, budgetMs);
    budget?.unref();
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); watch?.output(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); watch?.output(); });

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
      watch?.stop();
      signal?.removeEventListener('abort', abort);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      closed ??= code;
      // On a timeout or an abort the escalation resolves, so the group is hard-killed before this returns
      if (!timedOut && !aborted) done();
    });
  });
}
