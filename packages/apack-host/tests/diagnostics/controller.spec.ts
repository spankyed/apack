import { expect, it, vi } from 'vitest';
import { ROOT_CONTEXT, createContextKey } from '@opentelemetry/api';
import { createPerformanceController } from '../../src/diagnostics/controller.ts';
import { BrowserRecordingContext } from '../../src/diagnostics/browser-context.ts';

it('keeps a stable execution port across recordings without observing while idle', async () => {
  const factory = vi.fn(() => new BrowserRecordingContext());
  const controller = createPerformanceController(factory);
  const detach = vi.fn();
  const observe = vi.fn(() => detach);
  controller.attach({ admin: { observe } }, 'app');
  const port = controller.execution;
  expect(port.capture()).toEqual({});
  expect(factory).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
  controller.start('lightweight');
  const action = controller.begin('app.thread.open')!;
  expect(action.within(() => port.capture()).traceparent).toBeTruthy();
  expect(() => controller.start('lightweight')).toThrow(/already active/);
  action.end();
  const pending = controller.stop();
  expect(port.capture()).toEqual({});
  expect(controller.stop()).toBe(pending);
  expect((await pending).complete).toBe(true);
  expect(detach).toHaveBeenCalledTimes(1);
  controller.start('disabled');
  controller.begin('app.thread.open')!.end();
  expect((await controller.stop()).observations).toEqual([]);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
});

it('unwinds prior attachments if an observer cannot attach', async () => {
  const controller = createPerformanceController(() => new BrowserRecordingContext());
  const detach = vi.fn();
  controller.attach({ admin: { observe: () => detach } }, 'app');
  controller.attach({ admin: { observe: () => { throw Error('observe unavailable'); } } }, 'runHistory');
  expect(() => controller.start('lightweight')).toThrow('observe unavailable');
  expect(detach).toHaveBeenCalledTimes(1);
  await controller.stop();
  expect(controller.execution.capture()).toEqual({});
});

it('restores browser callback context after return, throw and asynchronous scheduling', async () => {
  const manager = new BrowserRecordingContext();
  const key = createContextKey('test');
  const scope = ROOT_CONTEXT.setValue(key, 42);
  expect(manager.with(scope, () => manager.active().getValue(key))).toBe(42);
  expect(() => manager.with(scope, () => { throw Error('business error'); })).toThrow('business error');
  expect(manager.active()).toBe(ROOT_CONTEXT);
  const read = manager.bind(scope, () => manager.active().getValue(key));
  expect(read()).toBe(42);
  await manager.with(scope, async () => { await Promise.resolve(); expect(manager.active()).toBe(ROOT_CONTEXT); });
  expect(manager.active()).toBe(ROOT_CONTEXT);
});
