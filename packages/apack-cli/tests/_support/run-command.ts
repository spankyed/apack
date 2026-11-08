import { spawn } from 'node:child_process';
import { IDLE_MS, createStallTracker, readTreeCpuMs } from '@apackdev/host/build/process-progress';
import { stopCompilerProcessGroup } from '../../src/build/compiler-process-group.ts';
/**
 * How much CPU a command's tree may spend: for the one hang the idle watch can't see, a loop that spins. CPU rather
 * than the clock wherever the tree can be read, since a busy machine stretches a command's wall time and leaves its CPU
 * alone; the clock only where it cannot, on Windows and under `APACK_WATCHDOG=off`.
 */
const CEILING_MS = 900_000;
/** How often a running command's process tree is read, which stops at the first reading still in flight */
const READ_EVERY_MS = 5_000;

/**
 * Runs a command that starts a process tree — the CLI, a nested `vitest run` — off Vitest's event loop, and
 * stops its whole process group however it ends. A synchronous call would block the worker, so no case
 * timeout could fire and Vitest's RPC window would expire.
 *
 * A command is ended when its tree goes `IDLE_MS` with no CPU and no output, not after a time: a busy machine
 * makes a command slow and never stalled. The case's own deadline still applies around it.
 *
 * Resolves with the exit code, the combined output and stdout alone (for a caller that parses it); rejects, naming the command, when it exceeds `timeout`,
 * is cancelled through `signal`, or cannot start. A single process needs none of this: `execFileWhileWorking`
 * (`@apackdev/host/build/process-progress`) is `promisify(execFile)` bounded the same way.
 */
export async function runCommand(command: string, args: string[], cwd: string,
  { signal, env, ceiling = CEILING_MS, readTree = readTreeCpuMs }: {
    signal?: AbortSignal; env?: NodeJS.ProcessEnv; ceiling?: number; readTree?: typeof readTreeCpuMs;
  } = {},
): Promise<{ code: number; output: string; stdout: string }> {
  signal?.throwIfAborted();
  const started = performance.now();
  const label = [command, ...args].join(' ');
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, FORCE_COLOR: '0' },
  });
  let output = '';
  let stdout = '';
  let failure: Error | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let shutdown: ReturnType<typeof setTimeout> | undefined;
  let budget: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let forced: Promise<void> | undefined;
  // Windows has no process groups or `ps`, so there the ceiling is the only bound, as it is under `APACK_WATCHDOG=off`
  const stall = grouped && process.env.APACK_WATCHDOG !== 'off' ? createStallTracker(IDLE_MS, Date.now()) : undefined;
  let watching: ReturnType<typeof setInterval> | undefined;
  child.stdout.on('data', chunk => { output += chunk.toString(); stdout += chunk.toString(); stall?.output(Date.now()); });
  child.stderr.on('data', chunk => { output += chunk.toString(); stall?.output(Date.now()); });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const stop = (reason: Error) => {
        if (failure) return;
        failure = reason;
        clearInterval(watching);
        // Public builds drain their compiler owners on SIGTERM; escalate only after that grace period.
        child.kill('SIGTERM');
        escalation = setTimeout(() => {
          forced = grouped && child.pid ? stopCompilerProcessGroup(child.pid)
            : Promise.resolve().then(() => { child.kill('SIGKILL'); });
          void forced.catch(reject);
        }, 2_000);
        shutdown = setTimeout(() => reject(new Error(`${label}: process did not close within the 20s cleanup limit`, { cause: reason })), 20_000);
      };
      abort = () => stop(new Error(`${label}: cancelled`, { cause: signal?.reason }));
      const startClock = () => {
        budget ??= setTimeout(() => stop(new Error(`${label}: running past the ${ceiling}ms ceiling\n${output}`)), ceiling);
      };
      if (!stall) startClock();
      if (stall && child.pid !== undefined) {
        let reading = false;
        watching = setInterval(() => {
          if (reading) return;
          reading = true;
          void readTree(child.pid!).then((tree) => {
            reading = false;
            // `ps` failing leaves the CPU unknowable, so from then the clock is the bound rather than nothing
            if (tree === undefined) { startClock(); return; }
            if (stall.reading(tree, Date.now())) {
              stop(new Error(`${label}: stalled, no CPU or output for ${IDLE_MS / 1000}s\n${output}`));
            } else if (process.env.APACK_CEILING !== 'off' && stall.spentMs >= ceiling) {
              stop(new Error(`${label}: running past the ${ceiling}ms ceiling, in CPU: ${Math.round(stall.spentMs / 1000)}s of CPU `
                + `in ${Math.round((performance.now() - started) / 1000)}s\n${output}`));
            }
          });
        }, READ_EVERY_MS);
      }
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', error => { failure ??= error; });
      child.once('close', code => {
        clearTimeout(budget);
        clearInterval(watching);
        if (abort) signal?.removeEventListener('abort', abort);
        resolve(code ?? 1);
      });
      if (signal?.aborted) abort();
    });
    clearTimeout(escalation);
    await forced;
    // The compiler has its own process owner; this group covers direct toolchain descendants.
    if (grouped && child.pid) await stopCompilerProcessGroup(child.pid);
    if (failure) throw failure;
    return { code, output, stdout };
  } finally {
    clearTimeout(budget);
    clearInterval(watching);
    clearTimeout(escalation);
    clearTimeout(shutdown);
    if (abort) signal?.removeEventListener('abort', abort);
    console.info(`[run] ${label}: ${Math.round(performance.now() - started)}ms`);
  }
}
