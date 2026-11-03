import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PackBuilder } from '../../src/build/build-process.ts';
import { startTestPackBuildWatcher } from '../_support/watch-builds.ts';

const fixture = vi.hoisted(() => ({
  builder: undefined as unknown as PackBuilder,
  build: vi.fn<PackBuilder['build']>(),
  close: vi.fn<PackBuilder['close']>(),
  start: vi.fn(),
  finish: () => {},
  deadlines: [] as Array<{ ms: number; controller: AbortController }>,
}));
vi.mock('../../src/build/build-process.ts', () => ({ createPackBuilder: () => fixture.builder }));
vi.mock('../../src/build/watch.ts', () => ({ startPackBuildWatcher: (...args: unknown[]) => fixture.start(...args) }));

beforeEach(() => {
  fixture.build.mockReset().mockResolvedValue(undefined);
  fixture.close.mockReset().mockResolvedValue(undefined);
  fixture.deadlines = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    fixture.deadlines.push({ ms, controller });
    return controller.signal;
  });
  fixture.builder = {
    build: fixture.build, ensurePackages: async () => {}, close: fixture.close, serveFrontend: async () => undefined,
    isFrontendCurrent: async () => true, subscribeFrontendInputs: () => () => {},
  };
  const done = new Promise<void>(resolve => { fixture.finish = resolve; });
  fixture.start.mockReset().mockImplementation(async (_root, options) => {
    await options.builder.build({ signal: options.signal });
    return { done, close: async () => { fixture.finish(); } };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

it.each(['accepted', 'refused'] as const)('waits for a requested %s build before caller notification checks', async state => {
  const watcher = await startTestPackBuildWatcher('/fixture');
  const error = new Error('Expected compiler refusal');
  if (state === 'refused') fixture.build.mockRejectedValueOnce(error);
  await expect(watcher.rebuildAfter(() => {
    void fixture.builder.build().catch(() => {});
  })).resolves.toBeUndefined();
  expect(fixture.deadlines.map(deadline => deadline.ms)).toEqual([120_000, 120_000]);
  await watcher.close();
});

it('fails a missing watch request at the request deadline without starting a compiler', async () => {
  const waitFor = vi.waitFor;
  const shortened = vi.spyOn(vi, 'waitFor').mockImplementation((callback, options) => {
    expect(options).toEqual({ timeout: 20_000 });
    return waitFor(callback, { timeout: 1 });
  });
  const watcher = await startTestPackBuildWatcher('/fixture');
  await expect(watcher.rebuildAfter(() => {})).rejects.toThrow('watch request did not start a rebuild');
  expect(fixture.build).toHaveBeenCalledTimes(1);
  shortened.mockRestore();
  await watcher.close();
});

it('cancels a hung rebuild through its operation signal and reports the interruption', async () => {
  const watcher = await startTestPackBuildWatcher('/fixture');
  fixture.build.mockImplementationOnce(({ signal } = {}) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  const rebuilding = watcher.rebuildAfter(() => { void fixture.builder.build().catch(() => {}); });
  const cause = new Error('Rebuild deadline');
  const failure = expect(rebuilding).rejects.toMatchObject({ message: 'Pack build for "/fixture" exceeded 120000ms', cause });
  fixture.deadlines[1]!.controller.abort(cause);
  await failure;
  await watcher.close();
});

it('drains the caller-owned builder before close completes', async () => {
  const watcher = await startTestPackBuildWatcher('/fixture');
  let finish!: () => void;
  fixture.close.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  let closed = false;
  const closing = watcher.close().then(() => { closed = true; });
  await vi.waitFor(() => expect(fixture.close).toHaveBeenCalled());
  expect(closed).toBe(false);
  finish();
  await closing;
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it('closes its builder when watcher startup refuses before returning a handle', async () => {
  fixture.start.mockRejectedValueOnce(new Error('Startup refused'));
  await expect(startTestPackBuildWatcher('/fixture')).rejects.toThrow('Startup refused');
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it('reports a stuck cleanup at its own deadline while retaining the pending owner', async () => {
  const watcher = await startTestPackBuildWatcher('/fixture');
  let finish!: () => void;
  fixture.close.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const waitFor = vi.waitFor;
  vi.spyOn(vi, 'waitFor').mockImplementation((callback, options) => {
    expect(options).toEqual({ timeout: 20_000 });
    return waitFor(callback, { timeout: 1 });
  });
  try { await expect(watcher.close()).rejects.toThrow('watcher cleanup did not settle'); }
  finally { finish(); await watcher.done; }
});
