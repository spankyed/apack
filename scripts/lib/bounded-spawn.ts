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
 * - **The process group dies, not just the child.** `npm run x` is a shell that spawns node that spawns
 *   vitest that spawns workers. Killing the child alone orphans the rest, still running. And the group dies
 *   when the child exits however it ends, a pass included: nothing a run started outlives it.
 */
import { spawn } from 'node:child_process';

export interface BoundedResult {
  readonly code: number;
  readonly output: string;
  readonly ms: number;
  /** Set when the budget ran out: what it was doing, for a message that names the cause */
  readonly timedOut?: true;
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
}

export function boundedSpawn(command: string, args: readonly string[], budgetMs: number, options: BoundedOptions = {}): Promise<BoundedResult> {
  const { cwd = process.cwd(), stream = false, env = process.env, signal } = options;
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
    let aborted: true | undefined;
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });

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
      killGroup('SIGTERM');
      setTimeout(() => { killGroup('SIGKILL'); done(); }, GRACE_MS);
    };

    const budget = setTimeout(() => { timedOut = true; terminate(); }, budgetMs);
    budget.unref();
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
      signal?.removeEventListener('abort', abort);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      closed ??= code;
      // On a timeout or an abort the escalation resolves, so the group is hard-killed before this returns
      if (!timedOut && !aborted) done();
    });
  });
}
