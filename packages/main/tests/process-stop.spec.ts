// Stop must observe child exit before reload or quit can proceed. Real children cover that boundary;
// simulated children expose graceful-shutdown -> force-kill escalation, and how late an exit may arrive, without
// runner cleanup masking a defect.
import { describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { ProcessManager, type ManagedProcess } from '../src/modules/api-server/process-manager.ts';
import { logWarn } from '../src/modules/api-server/logger.ts';

vi.mock('../src/modules/api-server/logger.ts', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

/** Wraps a real Node `ChildProcess` (with stdio `'ipc'`) as a `ManagedProcess`, bridging `postMessage` -> `send`. */
function asManaged(child: ChildProcess): ManagedProcess {
  return Object.assign(child, {
    postMessage(message: unknown) {
      child.send(message as Parameters<ChildProcess['send']>[0]);
    },
  }) as unknown as ManagedProcess;
}

/** A real child that exits cleanly when asked `{ type: 'shutdown' }` over IPC, as the API does over `parentPort`. */
const obedient = () =>
  spawn(
    process.execPath,
    ['-e', "process.on('message', (m) => { if (m?.type === 'shutdown') process.exit(0); }); setInterval(() => {}, 1000); process.send('ready');"],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );

/**
 * A child that never exits, recording shutdown messages and kills.
 *
 * **The force-kill is asserted as a decision, not as a dead process.** A real stubborn child dies anyway
 * under the test runner's own teardown, which made the first version of the case below pass with the
 * force-kill deleted — it was reading the runner's cleanup, not this code. What is actually being claimed
 * is "it asks politely via postMessage, then escalates", and the recorded actions are where that is observable.
 */
function unresponsive(options: { pid?: number; failPostMessage?: boolean } = {}): {
  child: ManagedProcess;
  actions: string[];
  forceKillPid: (pid: number) => void;
} {
  const actions: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: options.pid,
    stdout: null,
    stderr: null,
    postMessage(message: unknown) {
      if (options.failPostMessage) throw new Error('port closed');
      actions.push(`postMessage:${JSON.stringify(message)}`);
    },
    kill() {
      actions.push('child.kill');
      return true;
    },
  }) as unknown as ManagedProcess;
  const forceKillPid = (pid: number) => {
    actions.push(`SIGKILL:${pid}`);
  };
  return { child, actions, forceKillPid };
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
   * store it is about to open, so "the shutdown message was sent" is not the answer a caller can act on.
   */
  it('resolves only once the child has actually gone', async () => {
    const child = obedient();
    await once(child, 'message');
    const manager = new ProcessManager({});
    const pid = child.pid!;
    manager.setProcess(asManaged(child));

    expect(alive(pid), 'it is running before the stop').toBe(true);
    await manager.stop(2000);
    expect(alive(pid), 'and gone by the time stop resolves').toBe(false);
  });

  it('observes exit after an overdue escalation, then reports that nothing is running', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('message', () => {}); setInterval(() => {}, 1000); process.send('ready');"],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    try {
      await once(child, 'message');
      const manager = new ProcessManager({});
      manager.setProcess(asManaged(child));
      const stopped = manager.stop(5);
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
   * A process that ignores `{ type: 'shutdown' }` is escalated to an unignorable kill, and the wait goes on
   * until it has gone.
   */
  it('escalates to SIGKILL for a child that ignores shutdown, and waits however long its exit takes', async () => {
    vi.useFakeTimers();
    try {
      const { child, actions, forceKillPid } = unresponsive({ pid: 4242 });
      const manager = new ProcessManager({ forceKillPid });
      manager.setProcess(child);
      let settled: string | undefined;
      const stopped = manager.stop(50).then(() => { settled = 'stopped'; }, (error: Error) => { settled = error.message; });

      await vi.advanceTimersByTimeAsync(60_000);
      const expectedKill = process.platform === 'win32' ? 'child.kill' : 'SIGKILL:4242';
      expect(actions, 'asked politely, then insisted').toEqual(['postMessage:{"type":"shutdown"}', expectedKill]);
      expect(settled, 'still waiting for the kill to land').toBeUndefined();
      expect(logWarn, 'a slow kill is reported').toHaveBeenCalledWith(expect.stringContaining('has not exited 1s after SIGKILL'));

      child.emit('exit', 137);
      await stopped;
      expect(settled).toBe('stopped');
      expect(manager.isRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to child.kill() when escalating before a pid is assigned', async () => {
    vi.useFakeTimers();
    try {
      const { child, actions, forceKillPid } = unresponsive({ pid: undefined });
      const manager = new ProcessManager({ forceKillPid });
      manager.setProcess(child);
      const stopped = manager.stop(50);

      await vi.advanceTimersByTimeAsync(50);
      expect(actions).toEqual(['postMessage:{"type":"shutdown"}', 'child.kill']);

      child.emit('exit', 1);
      await stopped;
      expect(manager.isRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back immediately to force kill when postMessage throws', async () => {
    const { child, actions, forceKillPid } = unresponsive({ pid: 9999, failPostMessage: true });
    const manager = new ProcessManager({ forceKillPid });
    manager.setProcess(child);
    const stopped = manager.stop(5000);

    const expectedKill = process.platform === 'win32' ? 'child.kill' : 'SIGKILL:9999';
    expect(actions).toEqual([expectedKill]);
    child.emit('exit', 1);
    await stopped;
    expect(manager.isRunning()).toBe(false);
  });

  /**
   * And a child that does go is never escalated, because the timer sees it has gone.
   */
  it('does not escalate a child that exited on the shutdown message', async () => {
    vi.useFakeTimers();
    try {
      const { child, actions, forceKillPid } = unresponsive({ pid: 1234 });
      const manager = new ProcessManager({ forceKillPid });
      manager.setProcess(child);

      const stopped = manager.stop(50);
      child.emit('exit', 0);
      await stopped;
      // Past the force-kill's deadline, so it has had its chance and declined to take it
      await vi.advanceTimersByTimeAsync(200);

      expect(actions, 'one graceful shutdown message was enough').toEqual(['postMessage:{"type":"shutdown"}']);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Nothing to stop is not an error: a reload may arrive before anything was ever launched. */
  it('resolves at once when there is no process', async () => {
    await expect(new ProcessManager({}).stop()).resolves.toBeUndefined();
  });

  it('joins concurrent stops without removing the first exit waiter', async () => {
    const { child, actions, forceKillPid } = unresponsive({ pid: 5678 });
    const manager = new ProcessManager({ forceKillPid });
    manager.setProcess(child);
    const first = manager.stop();
    expect(manager.stop()).toBe(first);
    expect(manager.isRunning(), 'a posted shutdown is not an exit').toBe(true);
    expect(actions).toEqual(['postMessage:{"type":"shutdown"}']);
    child.emit('exit', 0);
    await first;
    expect(manager.isRunning()).toBe(false);
  });

  /**
   * The exit is not reported as a crash, which is what keeps a reload off `handleProcessExit` — and so
   * away from `MAX_RESTART_ATTEMPTS`, whose exhaustion is a terminal error page the app cannot leave.
   */
  it('does not tell the exit handler, so a reload is never counted as a crash', async () => {
    const exits: unknown[] = [];
    const child = obedient();
    await once(child, 'message');
    const manager = new ProcessManager({ onExit: (code, signal) => exits.push({ code, signal }) });
    manager.setProcess(asManaged(child));

    await manager.stop(2000);

    expect(exits, 'the supervisor heard nothing to restart').toEqual([]);
  });
});
