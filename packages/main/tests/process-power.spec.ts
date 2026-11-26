import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ProcessManager, type ManagedProcess } from '../src/modules/api-server/process-manager.ts';

function fakeProcess(): { child: ManagedProcess; messages: unknown[] } {
  const emitter = new EventEmitter();
  const messages: unknown[] = [];
  const child = Object.assign(emitter, {
    pid: 1234,
    stdout: null,
    stderr: null,
    postMessage(message: unknown) { messages.push(message); },
    kill() { return true; },
  }) as ManagedProcess;
  return { child, messages };
}

describe('ProcessManager power-state forwarding', () => {
  it('forwards suspend/resume transitions, deduplicates repeats, and replays suspended state to a restarted process', () => {
    const manager = new ProcessManager();
    const first = fakeProcess();
    manager.setProcess(first.child);

    manager.setPowerState('suspended');
    manager.setPowerState('suspended'); // duplicate ignored
    expect(first.messages).toEqual([{ type: 'power', state: 'suspended' }]);

    // A restarted API process spawned while the machine is suspended receives the current state immediately
    const second = fakeProcess();
    manager.setProcess(second.child);
    expect(second.messages).toEqual([{ type: 'power', state: 'suspended' }]);

    manager.setPowerState('active');
    manager.setPowerState('active'); // duplicate ignored
    expect(second.messages).toEqual([
      { type: 'power', state: 'suspended' },
      { type: 'power', state: 'active' },
    ]);
  });
});
