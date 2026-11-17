// Stop must observe child exit before reload or quit can proceed. Real children cover that boundary;
// simulated children expose signal escalation, and how late an exit may arrive, without runner cleanup masking a
// defect.
import { describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { ProcessManager } from '../src/modules/api-server/process-manager.ts';
import { logWarn } from '../src/modules/api-server/logger.ts';

vi.mock('../src/modules/api-server/logger.ts', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

/** A child that goes on the first signal, which is what the API does. */
const obedient = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);

/**
 * A child that never exits, as the signals it was sent.
 *
 * **The force-kill is asserted as a decision, not as a dead process.** A real stubborn child dies anyway
 * under the test runner's own teardown, which made the first version of the case below pass with the
 * force-kill deleted — it was reading the runner's cleanup, not this code. What is actually being claimed
 * is "it escalates", and the signals are where that is observable.
 */
function unresponsive(): { child: ChildProcess; signals: NodeJS.Signals[] } {
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    killed: false,
    kill(signal?: NodeJS.Signals) {
      signals.push(signal ?? 'SIGTERM');
      this.killed = true;
      return true;
    },
    stdout: null,
    stderr: null,
  }) as unknown as ChildProcess;
  return { child, signals };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('stopping the API process', () => {
  /**
   * The claim the reload rests on. The departing API holds the port the next one prefers and the LMDB
   * store it is about to open, so "the signal was sent" is not the answer a caller can act on.
   */
  it('resolves only once the child has actually gone', async () => {
    const manager = new ProcessManager({});
    const child = obedient();
    const pid = child.pid!;
    manager.setProcess(child);

    expect(alive(pid), 'it is running before the stop').toBe(true);
    await manager.stop('SIGTERM', 2000);
    expect(alive(pid), 'and gone by the time stop resolves').toBe(false);
  });

  it('observes exit after an overdue escalation, then reports that nothing is running', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready');"],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    try {
      await once(child, 'message');
      const manager = new ProcessManager({});
      manager.setProcess(child);
      const stopped = manager.stop('SIGTERM', 5);
      // Both old deadlines become overdue; exit is delivered on a later I/O turn. This is no speed assertion.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
      await expect(stopped).resolves.toBeUndefined();
      expect(manager.isRunning()).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
  });

  /**
   * A process that ignores the signal is escalated to SIGKILL, and the wait goes on until it has gone.
   *
   * **SIGKILL cannot be refused, but the kernel can take a while to finish a process off**: seconds, on a
   * loaded machine or for one in the middle of a disk write. That is a stop arriving late, never a process
   * that survived it: a wait that refused on a clock left a quit cancelled with nothing to retry it, and the
   * app running, idle, until something killed it.
   *
   * **The guard here cannot be `child.killed`**, which Node sets as soon as a signal is *delivered* — so
   * it is already true when the force-kill timer runs, and a force-kill conditioned on it never fires.
   */
  it('escalates to SIGKILL for a child that will not take the signal, and waits however long its exit takes', async () => {
    vi.useFakeTimers();
    try {
      const manager = new ProcessManager({});
      const { child, signals } = unresponsive();
      manager.setProcess(child);
      let settled: string | undefined;
      const stopped = manager.stop('SIGTERM', 50).then(() => { settled = 'stopped'; }, (error: Error) => { settled = error.message; });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(signals, 'asked politely, then insisted').toEqual(['SIGTERM', 'SIGKILL']);
      expect(settled, 'still waiting for the kill to land').toBeUndefined();
      expect(logWarn, 'a slow kill is reported').toHaveBeenCalledWith(expect.stringContaining('has not exited 1s after SIGKILL'));

      child.emit('exit', null, 'SIGKILL');
      await stopped;
      expect(settled).toBe('stopped');
      expect(manager.isRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * And a child that does go is never escalated, because the timer sees it has gone.
   *
   * On fake timers because the assertion is about what the force-kill timer does when it *fires*: without
   * reaching it the case passes whether or not anything is checked, which is what the first version did.
   */
  it('does not escalate a child that exited on the first signal', async () => {
    vi.useFakeTimers();
    try {
      const manager = new ProcessManager({});
      const { child, signals } = unresponsive();
      manager.setProcess(child);

      const stopped = manager.stop('SIGTERM', 50);
      child.emit('exit', 0, null);
      await stopped;
      // Past the force-kill's deadline, so it has had its chance and declined to take it
      await vi.advanceTimersByTimeAsync(200);

      expect(signals, 'one signal was enough').toEqual(['SIGTERM']);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Nothing to stop is not an error: a reload may arrive before anything was ever launched. */
  it('resolves at once when there is no process', async () => {
    await expect(new ProcessManager({}).stop()).resolves.toBeUndefined();
  });

  it('joins concurrent stops without removing the first exit waiter', async () => {
    const manager = new ProcessManager({});
    const { child, signals } = unresponsive();
    manager.setProcess(child);
    const first = manager.stop();
    expect(manager.stop()).toBe(first);
    expect(manager.isRunning(), 'a delivered signal is not an exit').toBe(true);
    expect(signals).toEqual(['SIGTERM']);
    child.emit('exit', 0, null);
    await first;
    expect(manager.isRunning()).toBe(false);
  });

  /**
   * The exit is not reported as a crash, which is what keeps a reload off `handleProcessExit` — and so
   * away from `MAX_RESTART_ATTEMPTS`, whose exhaustion is a terminal error page the app cannot leave.
   */
  it('does not tell the exit handler, so a reload is never counted as a crash', async () => {
    const exits: unknown[] = [];
    const manager = new ProcessManager({ onExit: (code, signal) => exits.push({ code, signal }) });
    manager.setProcess(obedient());

    // **No wait is needed, and that is a property of `stop` rather than a shortcut.** It resolves *from*
    // the child's `exit`, so every listener that event has was called before this line runs — a surviving
    // `onExit` would already be in `exits`.
    await manager.stop('SIGTERM', 2000);

    expect(exits, 'the supervisor heard nothing to restart').toEqual([]);
  });
});
