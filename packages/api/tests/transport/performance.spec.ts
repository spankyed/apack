import { afterEach, expect, it, vi } from 'vitest';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
const resource = vi.hoisted(() => ({ current: undefined as ReturnType<typeof createNodePerformanceController> | undefined }));
vi.mock('../../src/runtime/index.ts', () => ({ get appPerformance() { return resource.current; } }));
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
