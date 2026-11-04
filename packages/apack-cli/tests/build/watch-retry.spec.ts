import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import type { PackBuilder } from '../../src/build/build-process.ts';
import * as packInputs from '@apackdev/host/build/pack-inputs';
import type { DevDelivery } from '../../src/build/dev-reload.ts';
import { startPackBuildWatcher, watchPackBuild } from '../../src/build/watch.ts';
import * as fs from 'node:fs';
import * as compilerWatch from '../../src/build/compiler-watch.ts';

const fixture = vi.hoisted(() => ({
  authored: 'first',
  changed: undefined as undefined | ((event: string, file: string) => void),
  watches: [] as Array<{ directory: string; watcher: EventEmitter & { close: ReturnType<typeof vi.fn> } }>,
  build: vi.fn<PackBuilder['build']>(async () => {}),
  ensurePackages: vi.fn<PackBuilder['ensurePackages']>(async () => {}),
  compilerSignature: 'compiler',
  frontendClose: vi.fn(async () => {}),
  frontendFailed: undefined as undefined | ((error: Error) => void),
  frontendInputs: undefined as undefined | Parameters<PackBuilder['subscribeFrontendInputs']>[0],
  unsubscribe: vi.fn(),
  close: vi.fn(async () => {}),
  reload: vi.fn<() => Promise<DevDelivery>>(async () => ({ status: 'delivered' })),
}));
vi.mock('node:fs', async importOriginal => {
  const { EventEmitter } = await import('node:events');
  return {
    ...await importOriginal<typeof import('node:fs')>(),
    watch: vi.fn((directory: string, _options: unknown, receive: (event: string, file: string) => void) => {
      if (directory === '/fixture') fixture.changed = receive;
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      fixture.watches.push({ directory, watcher });
      return watcher;
    }),
  };
});
vi.mock('../../src/build/build-process.ts', () => ({
  createPackBuilder: () => ({ build: fixture.build, ensurePackages: fixture.ensurePackages, close: fixture.close,
    subscribeFrontendInputs: (receive: Parameters<PackBuilder['subscribeFrontendInputs']>[0]) => { fixture.frontendInputs = receive; return fixture.unsubscribe; }, isFrontendCurrent: async () => true }),
}));
vi.mock('../../src/utils.ts', () => ({ readValidManifest: () => ({ id: 'fixture' }) }));
vi.mock('@apackdev/host/build/pack-inputs', () => ({
  isPackInputPath: () => true,
  packInputsHash: () => fixture.authored,
  packInputWatchTargets: () => [{ directory: '/fixture', relative: '' }],
}));
vi.mock('../../src/build/compiler-watch.ts', () => ({
  createCompilerWatchTools: () => ({ read: vi.fn(), changed: vi.fn() }),
  compilerWatchPaths: () => ({ paths: new Map(), staticPaths: new Map(), complete: true, signature: fixture.compilerSignature }),
  packageInputWatchPaths: () => new Map(),
  additionalCompilerObservations: (observations: unknown) => observations,
  mergeCompilerWatchPaths: () => new Map(),
  compilerWatchTargets: () => new Map(),
  createCompilerWatchMatcher: () => () => false,
}));
vi.mock('../../src/build/dev-reload.ts', () => ({ reloadPack: fixture.reload }));
vi.mock('../../src/build/frontend-watch.ts', () => ({
  createFrontendWatcher: (_root: string, _data: unknown, _changed: unknown, failed: (error: Error) => void) => {
    fixture.frontendFailed = failed;
    return {
      snapshot: () => ({ hash: 'frontend', current: () => true }),
      accept: vi.fn(async () => {}),
      close: fixture.frontendClose,
    };
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.authored = 'first';
  fixture.compilerSignature = 'compiler';
  fixture.watches = [];
  fixture.frontendFailed = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['build', 'install', 'reload', 'failed', 'unreachable'] as const)('retries identical inputs on a later save after %s fails', async failure => {
  const install = vi.fn(async () => {});
  const watcher = await startPackBuildWatcher('/fixture', { onBuilt: install });
  const save = async () => {
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
  };
  try {
    if (failure === 'build') fixture.build.mockRejectedValueOnce(new Error('fixture build refused'));
    if (failure === 'install') install.mockRejectedValueOnce(new Error('fixture install refused'));
    if (failure === 'reload') fixture.reload.mockRejectedValueOnce(new Error('fixture reload refused'));
    if (failure === 'failed' || failure === 'unreachable') fixture.reload.mockResolvedValueOnce({ status: failure, detail: 'fixture refusal' });
    fixture.authored = 'second';
    await save();
    if (failure === 'failed' || failure === 'unreachable') expect(console.warn).toHaveBeenCalled();
    else expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed'));
    expect(fixture.build).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_200);
    expect(fixture.build).toHaveBeenCalledTimes(2);

    // Another save may emit an event without changing the file bytes. The failed attempt
    // must not suppress its retry as if this input had already reached the running app.
    await save();
    expect(fixture.build).toHaveBeenCalledTimes(3);
    expect(install).toHaveBeenCalledTimes(failure === 'build' ? 1 : 2);
    expect(fixture.reload).toHaveBeenCalledTimes(['reload', 'failed', 'unreachable'].includes(failure) ? 2 : 1);

    // Once publication succeeds, duplicate saves still avoid unnecessary builds.
    await save();
    expect(fixture.build).toHaveBeenCalledTimes(3);
  } finally { await watcher.close(); }
});

it('asks for no reload when onBuilt delivered the build itself', async () => {
  const watcher = await startPackBuildWatcher('/fixture', { onBuilt: async () => ({ status: 'delivered' as const }) });
  try {
    fixture.authored = 'second';
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(2);
    expect(fixture.reload).not.toHaveBeenCalled();
  } finally { await watcher.close(); }
});

it('publishes one build for a package edit whose refresh rewrites what the pack builds against', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  try {
    fixture.ensurePackages.mockImplementationOnce(async () => { fixture.compilerSignature = 'refreshed'; });
    fixture.changed!('change', '../apack-sdk/src/index.ts');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fixture.build).toHaveBeenCalledTimes(2);
  } finally { await watcher.close(); }
});

it('refreshes a package the pack does not build against and publishes nothing', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  try {
    fixture.ensurePackages.mockClear();
    fixture.changed!('change', '../apack-testing/src/index.ts');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fixture.ensurePackages).toHaveBeenCalledTimes(1);
    expect(fixture.build).toHaveBeenCalledTimes(1);
  } finally { await watcher.close(); }
});

it('keeps the accepted build when a package refresh fails, and takes the next edit', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  try {
    fixture.ensurePackages.mockRejectedValueOnce(new Error('fixture package refused'));
    fixture.compilerSignature = 'broken source';
    fixture.changed!('change', '../apack-sdk/src/index.ts');
    await vi.advanceTimersByTimeAsync(300);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fixture package refused'));
    expect(fixture.build).toHaveBeenCalledTimes(1);
    fixture.compilerSignature = 'repaired source';
    fixture.changed!('change', '../apack-sdk/src/index.ts');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(2);
  } finally { await watcher.close(); }
});

it('keeps duplicate-save suppression when building without a running app', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  try {
    fixture.reload.mockResolvedValueOnce({ status: 'not-running', detail: 'no app' });
    fixture.authored = 'offline';
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(2);
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(2);
    expect(fixture.reload).toHaveBeenCalledTimes(1);
  } finally { await watcher.close(); }
});

it('does not recreate input subscriptions when an active build fails during close', async () => {
  vi.spyOn(compilerWatch, 'compilerWatchTargets').mockReturnValue(new Map([
    ['/outside', { paths: new Map([['/outside/value', 'file']]), recursive: false }],
  ]));
  const watcher = await startPackBuildWatcher('/fixture');
  let rejectBuild!: (error: Error) => void;
  fixture.build.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectBuild = reject; }));
  fixture.authored = 'second';
  fixture.changed!('change', 'apack.json');
  await vi.advanceTimersByTimeAsync(300);
  const stopping = watcher.close();
  const subscriptions = vi.mocked(fs.watch).mock.calls.length;
  rejectBuild(new Error('Build cancelled'));
  await stopping;
  expect(fs.watch).toHaveBeenCalledTimes(subscriptions);
});

it('cancels pending startup and drains its owner before rejecting without a watcher handle', async () => {
  const controller = new AbortController();
  let finish!: () => void;
  fixture.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  let settled = false;
  const starting = startPackBuildWatcher('/fixture', { signal: controller.signal }).then(
    () => { settled = true; },
    error => { settled = true; return error; },
  );
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.build).not.toHaveBeenCalled();
  expect(fixture.close).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  finish();
  expect(await starting).toBe(controller.signal.reason);
  for (const entry of fixture.watches) expect(entry.watcher.close).toHaveBeenCalledTimes(1);
});

it.each(['root', 'dependency', 'authored'] as const)('drains and attributes an asynchronous %s watch failure', async kind => {
  if (kind === 'dependency') vi.spyOn(compilerWatch, 'compilerWatchTargets').mockReturnValue(new Map([
    ['/outside', { paths: new Map([['/outside/value', 'file']]), recursive: false }],
  ]));
  if (kind === 'authored') vi.spyOn(packInputs, 'packInputWatchTargets').mockReturnValue([
    { directory: '/fixture', relative: '' }, { directory: '/linked', relative: 'linked' },
  ]);
  const watcher = await startPackBuildWatcher('/fixture');
  const directory = kind === 'root' ? '/fixture' : kind === 'dependency' ? '/outside' : '/linked';
  const active = fixture.watches.filter(entry => entry.directory === directory && !entry.watcher.close.mock.calls.length).at(-1)!;
  const failure = Object.assign(new Error('watch limit'), { code: 'EMFILE' });
  try {
    expect(() => active.watcher.emit('error', failure)).not.toThrow();
    await expect(watcher.done).rejects.toMatchObject({ message: expect.stringContaining(directory), cause: failure });
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(fixture.frontendClose).toHaveBeenCalledTimes(1);
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
    for (const entry of fixture.watches) expect(entry.watcher.close).toHaveBeenCalledTimes(1);
    const builds = fixture.build.mock.calls.length;
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(builds);
  } finally { await watcher.close(); }
});

it('ignores errors from retired subscriptions and resolves done after normal close', async () => {
  vi.spyOn(compilerWatch, 'compilerWatchTargets').mockReturnValue(new Map([
    ['/outside', { paths: new Map([['/outside/value', 'file']]), recursive: false }],
  ]));
  const watcher = await startPackBuildWatcher('/fixture');
  try {
    const retired = fixture.watches.find(entry => entry.directory === '/outside' && entry.watcher.close.mock.calls.length)!;
    expect(() => retired.watcher.emit('error', new Error('late error'))).not.toThrow();
    fixture.authored = 'second';
    fixture.changed!('change', 'apack.json');
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.build).toHaveBeenCalledTimes(2);
    expect(fixture.close).not.toHaveBeenCalled();
  } finally { await watcher.close(); }
  await expect(watcher.done).resolves.toBeUndefined();
});

it('cancels and drains an active build before reporting subscription failure', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  let cancelled = false;
  let finish!: () => void;
  fixture.build.mockImplementationOnce(options => new Promise<void>((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => {
      cancelled = true;
      finish = () => reject(options!.signal!.reason);
    }, { once: true });
  }));
  fixture.authored = 'second';
  fixture.changed!('change', 'apack.json');
  await vi.advanceTimersByTimeAsync(300);
  let delivered = false;
  const outcome = watcher.done.catch(error => { delivered = true; return error; });
  const failure = new Error('watch limit');
  fixture.watches.find(entry => entry.directory === '/fixture')!.watcher.emit('error', failure);
  await vi.advanceTimersByTimeAsync(0);
  expect(cancelled).toBe(true);
  expect(delivered).toBe(false);
  finish();
  expect(await outcome).toMatchObject({ cause: failure });
  await watcher.close();
});

it('delivers frontend subscription failure through the same terminal owner', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  const failure = new Error('frontend input watch limit');
  fixture.frontendFailed!(failure);
  await expect(watcher.done).rejects.toBe(failure);
  await watcher.close();
  expect(fixture.frontendClose).toHaveBeenCalledTimes(1);
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it('drains every cleanup before reporting a cleanup failure', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  let finish!: () => void;
  fixture.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const failure = new Error('frontend cleanup failed');
  fixture.frontendClose.mockRejectedValueOnce(failure);
  let delivered = false;
  const outcome = watcher.done.catch(error => { delivered = true; return error; });
  const stopped = expect(watcher.close()).rejects.toBeInstanceOf(AggregateError);
  await vi.advanceTimersByTimeAsync(0);
  expect(delivered).toBe(false);
  expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
  finish();
  await stopped;
  expect(await outcome).toMatchObject({ errors: [failure] });
});

it('cleans up when the first native subscription cannot be created', async () => {
  const failure = Object.assign(new Error('watch limit'), { code: 'EMFILE' });
  vi.mocked(fs.watch).mockImplementationOnce(() => { throw failure; });
  await expect(startPackBuildWatcher('/fixture')).rejects.toMatchObject({
    message: expect.stringContaining('/fixture'), cause: failure,
  });
  expect(fixture.close).toHaveBeenCalledTimes(1);
  expect(fixture.frontendClose).toHaveBeenCalledTimes(1);
  expect(fixture.build).not.toHaveBeenCalled();
});

it('returns fatal subscription failure from the public watch command', async () => {
  const watching = watchPackBuild('/fixture');
  await vi.advanceTimersByTimeAsync(0);
  const failure = new Error('watch limit');
  fixture.watches.find(entry => entry.directory === '/fixture')!.watcher.emit('error', failure);
  await expect(watching).rejects.toMatchObject({ cause: failure });
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it('leaves a caller-owned builder for that caller to close', async () => {
  const builder = { build: fixture.build, ensurePackages: fixture.ensurePackages, close: fixture.close,
    subscribeFrontendInputs: () => fixture.unsubscribe, isFrontendCurrent: async () => true };
  const watcher = await startPackBuildWatcher('/fixture', { builder });
  const failure = new Error('watch limit');
  fixture.watches.find(entry => entry.directory === '/fixture')!.watcher.emit('error', failure);
  await expect(watcher.done).rejects.toMatchObject({ cause: failure });
  await watcher.close();
  expect(fixture.close).not.toHaveBeenCalled();
});

it('owns a subscription replacement failure during frontend input delivery', async () => {
  const watcher = await startPackBuildWatcher('/fixture');
  vi.spyOn(compilerWatch, 'compilerWatchTargets').mockReturnValue(new Map([
    ['/outside', { paths: new Map([['/outside/value', 'file']]), recursive: false }],
  ]));
  const failure = new Error('watch limit');
  vi.mocked(fs.watch).mockImplementationOnce(() => { throw failure; });
  expect(() => fixture.frontendInputs!({ paths: new Map([['/outside/value', 'file']]), changed: true })).not.toThrow();
  await expect(watcher.done).rejects.toMatchObject({ cause: failure });
  await watcher.close();
  expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
  expect(fixture.close).toHaveBeenCalledTimes(1);
});
