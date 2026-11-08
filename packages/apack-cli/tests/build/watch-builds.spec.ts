import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PackBuilder } from '../../src/build/build-process.ts';
import { startTestPackBuildWatcher } from '../_support/watch-builds.ts';

const fixture = vi.hoisted(() => ({
  builder: undefined as unknown as PackBuilder,
  build: vi.fn<PackBuilder['build']>(),
  close: vi.fn<PackBuilder['close']>(),
  start: vi.fn(),
  finish: () => {},
  signals: [] as AbortController[],
}));
vi.mock('../../src/build/build-process.ts', () => ({ createPackBuilder: () => fixture.builder }));
// Each build's signal is the helper's progress bound; the cases hold it, to abort one as a stalled build would be
vi.mock('@apackdev/sdk/testing/waiting', async (original) => ({
  ...await original<typeof import('@apackdev/sdk/testing/waiting')>(),
  _workingSignal: () => {
    const controller = new AbortController();
    fixture.signals.push(controller);
    return controller.signal;
  },
}));
vi.mock('../../src/build/watch.ts', () => ({ startPackBuildWatcher: (...args: unknown[]) => fixture.start(...args) }));

beforeEach(() => {
  fixture.build.mockReset().mockResolvedValue(undefined);
  fixture.close.mockReset().mockResolvedValue(undefined);
  fixture.signals = [];
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
  // One bound per build: the watcher's first, and the one the edit requested
  expect(fixture.signals).toHaveLength(2);
  await watcher.close();
});


it('cancels a hung rebuild through its operation signal and reports the interruption', async () => {
  const watcher = await startTestPackBuildWatcher('/fixture');
  fixture.build.mockImplementationOnce(({ signal } = {}) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  const rebuilding = watcher.rebuildAfter(() => { void fixture.builder.build().catch(() => {}); });
  const cause = new Error('The work did no work for 120s');
  const failure = expect(rebuilding).rejects.toMatchObject({ message: `Pack build for "/fixture" was stopped: ${String(cause)}`, cause });
  fixture.signals[1]!.abort(cause);
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

