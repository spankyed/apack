import fs from 'node:fs';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { setTimeout as delay } from 'node:timers/promises';

export const COMPILER_PROCESS_GROUP_ENV = 'APACK_COMPILER_PROCESS_GROUP';

// `timeout` is the CPU `ps` may spend, so a busy machine slows a reading and never fails one
const execute = execFileWhileWorking;
// SIGKILL has no graceful shutdown phase; bound OS scheduling/state checks before refusing publication.
const SHUTDOWN_MS = 2_000;

/**
 * Whether one `/proc/<pid>/stat` line is a live member of `group`. The process name sits in parentheses and
 * may itself hold spaces or `)`, so the fields are read after the last `)`: state, parent, then group.
 * Zombies (`Z`) and dead tasks (`X`) cannot run or write output, and some container inits never reap them.
 */
export function liveInGroup(stat: string, group: number): boolean {
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  const [state, , pgrp] = fields;
  return Number(pgrp) === group && state !== undefined && state !== 'Z' && state !== 'X';
}

/** Linux reads the kernel's own records, so no `ps` is needed: slim images ship none, and busybox rejects its flags. */
export function linuxGroupRunning(group: number, proc = '/proc'): boolean {
  for (const entry of fs.readdirSync(proc)) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    // A process that exits between listing and reading is not running
    try { stat = fs.readFileSync(`${proc}/${entry}/stat`, 'utf8'); } catch { continue; }
    if (liveInGroup(stat, group)) return true;
  }
  return false;
}

async function psGroupRunning(group: number, timeout: number): Promise<boolean> {
  let stdout: string;
  try { ({ stdout } = await execute('/bin/ps', ['-axo', 'pgid=,stat='], { timeout })); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Stopping a compiler process group needs /bin/ps, which this system does not have', { cause: error });
    }
    throw error;
  }
  return stdout.trim().split('\n').some(line => {
    const [pgid, state] = line.trim().split(/\s+/);
    return Number(pgid) === group && !!state && !state.startsWith('Z');
  });
}

/** Stop only the POSIX group created for this compiler worker and its inherited subprocesses. */
export async function stopCompilerProcessGroup(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Compiler process group requires a positive worker PID');
  let signalError: unknown;
  const kill = () => {
    signalError = undefined;
    try { process.kill(-pid, 'SIGKILL'); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      // Signal failure alone cannot distinguish live tasks from a terminal group; confirm state below.
      signalError = error;
      return true;
    }
  };
  if (!kill()) return;
  const deadline = performance.now() + SHUTDOWN_MS;
  for (;;) {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) {
      if (signalError) throw new Error(`Could not stop live compiler process group ${pid}: ${String(signalError)}`, { cause: signalError });
      throw new Error(`Compiler process group ${pid} did not stop; refusing publication`);
    }
    // Orphaned zombies are not counted: they cannot execute or write output, and some container inits don't reap them
    const running = process.platform === 'linux' ? linuxGroupRunning(pid) : await psGroupRunning(pid, remaining);
    if (!running) return;
    // A denied signal can race natural shutdown; require terminal state within the same fixed budget.
    if (!kill()) return;
    await delay(10);
  }
}
