import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { _RendererPerformanceResources } from '@apackdev/sdk/runtime';
import { createRendererCapture } from '../src/modules/performance/capture.ts';
const state = vi.hoisted(() => ({ env: 'test', handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(name, handler) },
  BrowserWindow: { fromWebContents: (contents: unknown) => ({ webContents: contents }) },
}));
vi.mock('../src/app-environment.ts', () => ({ getAppEnvironment: () => ({ env: state.env }) }));
const { createPerformanceModule } = await import('../src/modules/performance/index.ts');
function port() {
  let tick = 0;
  return { pid: 42, close: vi.fn(), post: vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'Performance.getMetrics') return { metrics: [{ name: 'TaskDuration', value: ++tick }, { name: 'JSHeapUsedSize', value: 1000 }] };
    return { profile: { nodes: [], head: {} } };
  }) };
}
beforeEach(() => { state.env = 'test'; state.handlers.clear(); });

it('retains actual metric units and closes a lightweight target exactly once', async () => {
  const transport = port();
  const capture = createRendererCapture(transport, 'lightweight');
  await capture.ready;
  const pending = capture.stop();
  expect(capture.stop()).toBe(pending);
  expect(await pending).toMatchObject({ complete: true, statistics: { pid: 42, metrics: [
    { name: 'TaskDuration', unit: 'seconds', before: 1, after: 2 }, { name: 'JSHeapUsedSize', unit: 'bytes' },
  ] } });
  expect(transport.close).toHaveBeenCalledTimes(1);
  expect(transport.post.mock.calls.some(([method]) => method.startsWith('Profiler.'))).toBe(false);
});

it('retains profiles and releases both profiler agents before detaching', async () => {
  const transport = port();
  const capture = createRendererCapture(transport, 'detailed');
  await capture.ready;
  const report = await capture.stop();
  expect(report.complete).toBe(true);
  expect(report.profiles?.cpu).toBeDefined(); expect(report.profiles?.allocation).toBeDefined();
  expect(transport.post).toHaveBeenCalledWith('Profiler.disable', undefined);
  expect(transport.post).toHaveBeenCalledWith('HeapProfiler.disable', undefined);
  expect(transport.close).toHaveBeenCalledTimes(1);
});

it('marks a lost target incomplete while still detaching it', async () => {
  const transport = port();
  const capture = createRendererCapture(transport, 'lightweight');
  await capture.ready;
  transport.post.mockRejectedValueOnce(Error('target gone'));
  expect(await capture.stop()).toMatchObject({ complete: false });
  expect(transport.close).toHaveBeenCalledTimes(1);
});

it('refuses production, subframes and stale leases without disturbing the current owner', async () => {
  const app = new EventEmitter();
  await createPerformanceModule().enable({ app: app as unknown as Electron.App });
  const contents = Object.assign(new EventEmitter(), { id: 7, mainFrame: {}, getOSProcessId: () => 42, debugger: Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => attached), attach: vi.fn(() => { attached = true; }), detach: vi.fn(() => { attached = false; }), sendCommand: port().post,
  }) });
  let attached = false;
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const start = (source = event) => state.handlers.get('performance:renderer:start')!(source, 'lightweight') as Promise<{ id: string }>;
  const stop = (id: string) => state.handlers.get('performance:renderer:stop')!(event, id) as Promise<_RendererPerformanceResources>;
  state.env = 'production';
  await expect(start()).rejects.toThrow('unavailable');
  state.env = 'test';
  await expect(start({ ...event, senderFrame: {} })).rejects.toThrow('unavailable');
  const first = await start();
  await expect(start()).rejects.toThrow('active or stopping');
  await stop(first.id);
  const second = await start();
  expect(() => stop(first.id)).toThrow('No matching');
  expect(attached).toBe(true);
  await stop(second.id);
  expect(attached).toBe(false);
  const third = await start();
  attached = false;
  contents.debugger.emit('detach', {}, 'replaced');
  attached = true; // A different owner attached after our session was detached.
  const calls = contents.debugger.sendCommand.mock.calls.length;
  expect((await stop(third.id)).complete).toBe(false);
  expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(calls);
  expect(attached).toBe(true);
});
