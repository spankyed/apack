import { afterEach, expect, it, vi } from 'vitest';
import { createStartupPerformance } from '../../src/runtime/startup-performance.ts';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
const resource = vi.hoisted(() => ({ startup: undefined as ReturnType<typeof createStartupPerformance>, current: undefined as ReturnType<typeof createNodePerformanceController> | undefined }));
vi.mock('../../src/runtime/index.ts', () => ({ get appPerformance() { return resource.current; }, get appStartupPerformance() { return resource.startup; } }));
const { performanceRouter } = await import('../../src/transport/performance.ts');
const ownerClosed = new AbortController();
const owner = performanceRouter.createCaller({ client: 'owner', closed: ownerClosed.signal });
const stranger = performanceRouter.createCaller({ client: 'stranger', closed: new AbortController().signal });
afterEach(async () => { if (resource.current?.snapshot()) await owner.stop(); resource.current = undefined; });

it('refuses recording when production composition has no diagnostics resource', async () => {
  await expect(owner.start({ mode: 'lightweight' })).rejects.toThrow(/only in development and test/);
});

it('requires the initiating connection for snapshots and stop', async () => {
  resource.current = createNodePerformanceController();
  await owner.start({ mode: 'lightweight' });
  await expect(stranger.start({ mode: 'lightweight' })).rejects.toThrow(/already active/);
  await expect(stranger.snapshot()).rejects.toThrow(/does not own/);
  await expect(stranger.stop()).rejects.toThrow(/does not own/);
  const action = resource.current.begin('app.thread.open')!;
  action.end();
  expect(await owner.stop()).toMatchObject({ complete: true });
});

it('detaches and marks outstanding work incomplete when the owner disconnects', async () => {
  resource.current = createNodePerformanceController();
  const detached = vi.fn();
  resource.current.attach({ admin: { observe: () => detached } }, 'app');
  await owner.start({ mode: 'lightweight' });
  resource.current.begin('app.thread.open');
  ownerClosed.abort();
  expect(detached).toHaveBeenCalledTimes(1);
  const report = await resource.current.stop();
  expect(report).toMatchObject({ complete: false, unfinished: 1 });
  await expect(owner.snapshot()).rejects.toThrow(/does not own/);
});

it('adopts early startup capture through normal connection ownership without restarting it', async () => {
  resource.startup = createStartupPerformance('test', JSON.stringify({ mode: 'lightweight' }))!;
  resource.startup.finish();
  resource.current = resource.startup.controller;
  const startupOwner = performanceRouter.createCaller({ client: 'startup-owner', closed: new AbortController().signal });
  await expect(startupOwner.start({ mode: 'disabled', startup: true })).rejects.toThrow('matching startup');
  await startupOwner.start({ mode: 'lightweight', startup: true });
  await expect(stranger.snapshot()).rejects.toThrow('does not own');
  expect((await startupOwner.stop()).observations.some(value => JSON.parse(value).name === 'app.startup')).toBe(true);
  await expect(startupOwner.start({ mode: 'lightweight', startup: true })).rejects.toThrow('matching startup');
  resource.startup = undefined;
});

it('cleans up a connection closed during profiler admission without retaining its ownership', async () => {
  resource.current = createNodePerformanceController();
  let resume!: () => void;
  const ready = vi.spyOn(resource.current, 'ready').mockReturnValue(new Promise(resolve => { resume = resolve; }));
  const closed = new AbortController();
  const initializing = performanceRouter.createCaller({ client: 'initializing', closed: closed.signal });
  const pending = initializing.start({ mode: 'lightweight' });
  await vi.waitFor(() => expect(ready).toHaveBeenCalled());
  closed.abort();
  await resource.current.stop();
  const rejected = expect(pending).rejects.toThrow('connection is closed');
  resume();
  await rejected;
  ready.mockRestore();
  await stranger.start({ mode: 'disabled' });
  expect(await stranger.stop()).toMatchObject({ complete: true });
});
