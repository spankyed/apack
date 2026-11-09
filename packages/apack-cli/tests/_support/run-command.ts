import { spawn } from 'node:child_process';
import { describeRefusal, processWork, readTreeCpuMs, watchWork, type Watch } from '@apackdev/sdk/progress';
import { stopCompilerProcessGroup } from '../../src/build/compiler-process-group.ts';
/**
 * How much CPU a command's tree may spend: for the one hang the idle watch can't see, a loop that spins. CPU rather
 * than the clock wherever the tree can be read, since a busy machine stretches a command's wall time and leaves its CPU
 * alone; the clock only where it cannot, on Windows and under `APACK_WATCHDOG=off`.
 */
const CEILING_MS = 900_000;

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
 * (`@apackdev/sdk/progress`) is `promisify(execFile)` bounded the same way.
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
  let watch: Watch | undefined;
  child.stdout.on('data', chunk => { output += chunk.toString(); stdout += chunk.toString(); watch?.output(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); watch?.output(); });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const stop = (reason: Error) => {
        if (failure) return;
        failure = reason;
        watch?.stop();
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
      // Bounded by its progress and the CPU its tree spends (`watchWork`); on the clock only where the tree cannot be
      // read — Windows has no process groups or `ps` — or the watchdog is off
      if (grouped && process.env.APACK_WATCHDOG !== 'off' && child.pid !== undefined) {
        watch = watchWork({
          work: processWork(child.pid, readTree), fallbackMs: ceiling, watchesOutput: true,
          ceilingMs: ceiling,
          onRefused: (refusal) => stop(new Error(`${label}: ${refusal.kind === 'stalled' ? 'stalled, it ' : ''}${describeRefusal(refusal)}\n${output}`)),
        });
      } else {
        budget = setTimeout(() => stop(new Error(`${label}: running past the ${ceiling}ms ceiling\n${output}`)), ceiling);
      }
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', error => { failure ??= error; });
      child.once('close', code => {
        clearTimeout(budget);
        watch?.stop();
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
    watch?.stop();
    clearTimeout(escalation);
    clearTimeout(shutdown);
    if (abort) signal?.removeEventListener('abort', abort);
    console.info(`[run] ${label}: ${Math.round(performance.now() - started)}ms`);
  }
}
