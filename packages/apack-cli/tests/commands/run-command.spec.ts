import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../_support/run-command.ts';

const { spawn, stopGroup } = vi.hoisted(() => ({ spawn: vi.fn(), stopGroup: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('../../src/build/compiler-process-group.ts', () => ({ stopCompilerProcessGroup: stopGroup }));

// These commands have a made-up pid and CPU reader. Their storage state must be
// made up too: a real ps callback cannot advance with this test's fake clock.
vi.mock('@apackdev/sdk/progress', async importOriginal => {
  const progress = await importOriginal<typeof import('@apackdev/sdk/progress')>();
  return { ...progress, processWork: (...args: Parameters<typeof progress.processWork>) =>
    Object.assign(progress.processWork(...args), { held: async () => undefined }) };
});

// A tree that spends a second of CPU every reading: what a command spinning towards its ceiling reads as
const spinning = () => { let cpu = 0; return async () => new Map([[12345, cpu += 1_000]]); };

let child: EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValue(child as unknown as ChildProcess);
  stopGroup.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('process-tree command ownership', () => {
  it('keeps a real command refusal distinct from a timeout and waits for close', async () => {
    const run = runCommand('node', ['apack.mjs', 'pack', 'validate'], '/pack');
    child.stdout.write('checking\n');
    child.stderr.write('invalid manifest\n');
    let settled = false;
    void run.then(() => { settled = true; });
    child.emit('exit', 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', 1);
    // Stdout alone is kept beside the combined output, for a caller that parses it
    await expect(run).resolves.toEqual({ code: 1, output: 'checking\ninvalid manifest\n', stdout: 'checking\n' });
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attributes running past the ceiling after graceful shutdown rather than accepting its exit code', async () => {
    const run = runCommand('node', ['apack.mjs', 'pack', 'build'], '/pack', { ceiling: 100, readTree: spinning() });
    const refused = expect(run).rejects.toThrow('node apack.mjs pack build: spent its 0.1s CPU budget');
    // Spend counts from the first reading, so the second is the first that can pass the ceiling
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a command whose tree stopped working, and not one still working however long it takes', async () => {
    const quiet = runCommand('node', ['wedged'], '/pack', { readTree: async () => new Map([[12345, 1_000]]) });
    const refused = expect(quiet).rejects.toThrow('node wedged: stalled, it did no work for 120s');
    await vi.advanceTimersByTimeAsync(130_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
    await refused;

    child.kill.mockClear();
    let cpu = 0;
    const busy = runCommand('node', ['slow'], '/pack', { readTree: async () => new Map([[12345, cpu += 4_000]]) });
    // Past the old clock ceiling of 900s, at five seconds of CPU a reading: slow on the clock, inside its CPU
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('close', 0);
    await expect(busy).resolves.toMatchObject({ code: 0 });
  });

  it('aborts a running command but waits for closure before settling', async () => {
    const controller = new AbortController();
    const run = runCommand('node', ['apack.mjs'], '/pack', { signal: controller.signal });
    const refused = expect(run).rejects.toThrow('node apack.mjs: cancelled');
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a command after its test has been cancelled', async () => {
    await expect(runCommand('node', [], '/pack', { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('awaits descendant retirement after the direct child closes', async () => {
    let retire!: () => void;
    stopGroup.mockReturnValueOnce(new Promise<void>(resolve => { retire = resolve; }));
    const run = runCommand('node', [], '/pack');
    let settled = false;
    void run.then(() => { settled = true; });
    child.emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopGroup).toHaveBeenCalledWith(child.pid);
    expect(settled).toBe(false);
    retire();
    await expect(run).resolves.toEqual({ code: 0, output: '', stdout: '' });
  });

  it('escalates a stuck command through the existing process owner, then awaits closure', async () => {
    const run = runCommand('node', [], '/pack', { ceiling: 100, readTree: spinning() });
    const refused = expect(run).rejects.toThrow('spent its 0.1s CPU budget');
    await vi.advanceTimersByTimeAsync(10_000 + 2_100);
    if (process.platform === 'win32') expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    else expect(stopGroup).toHaveBeenCalledWith(child.pid);
    child.emit('close', null);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a separate bounded cleanup failure if the process never closes', async () => {
    const run = runCommand('node', [], '/pack', { ceiling: 100, readTree: spinning() });
    const refused = expect(run).rejects.toThrow('process did not close within the 20s cleanup limit');
    await vi.advanceTimersByTimeAsync(10_000 + 20_100);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attributes a missing executable rather than returning a normal CLI refusal', async () => {
    const run = runCommand('missing', [], '/pack');
    const refused = expect(run).rejects.toThrow('ENOENT');
    child.emit('error', new Error('ENOENT'));
    child.emit('close', -2);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });
});
