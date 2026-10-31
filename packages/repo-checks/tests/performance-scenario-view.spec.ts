import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installViewCompletion } from '../../../tests/performance/view-completion.ts';
import type { PerformanceViewCompletion, PerformanceViewDelivery, PerformanceWindow } from '../../../tests/performance/window.ts';

const delivery: PerformanceViewDelivery = { request: { ref: 'test/feature', view: 'chat' }, update: { ok: true, value: {}, commit: 1 }, generation: 1, delivery: 1 };
let receive: (value: PerformanceViewDelivery) => void;
let mutate: () => void;
const detach = vi.fn();
const disconnect = vi.fn();
const flushView = vi.fn(async () => {});
let win: PerformanceWindow;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  win = { __performance: { flushView, onView: (listener: typeof receive) => { receive = listener; return detach; } } } as unknown as PerformanceWindow;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { mutate = callback; }
    observe() {}
    disconnect = disconnect;
  });
  // Playwright serializes this function; it must not depend on module-local values.
  new Function(`(${installViewCompletion.toString()})()`)();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function wait(overrides: Partial<PerformanceViewCompletion> = {}) {
  return win.__waitForPerformanceView({ accept: () => true, check: () => true, dispatch() {}, errors: ['page-bound'], ...overrides });
}
it('requires a matching receipt and ready DOM, then releases all completion resources', async () => {
  let accepted = false;
  let ready = false;
  const check = vi.fn(() => ready);
  const result = wait({ accept: () => accepted, check });
  receive(delivery); mutate();
  await Promise.resolve();
  expect(check).not.toHaveBeenCalled();
  accepted = true;
  receive(delivery);
  await Promise.resolve();
  expect(check).toHaveBeenCalledTimes(1);
  expect(detach).not.toHaveBeenCalled();
  ready = true; mutate();
  await result;
  expect(detach).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('times out a missing completion even if the DOM would be ready', async () => {
  const check = vi.fn(() => true);
  const result = expect(wait({ accept: () => false, check })).rejects.toThrow('missing-view-ready');
  receive(delivery); mutate();
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
  expect(check).not.toHaveBeenCalled();
  expect(detach).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});
it.each([['page-bound', 'page-bound'], ['unexpected payload', 'view-correctness']])('preserves allowed failure %s and excludes arbitrary error text', async (message, expected) => {
  const result = expect(wait({ check: () => { throw Error(message); } })).rejects.toThrow(expected);
  receive(delivery);
  await result;
  expect(detach).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});
it('cleans up a failed dispatch without waiting for its deadline', async () => {
  await expect(wait({ dispatch: () => { throw Error('dispatch failed'); } })).rejects.toThrow('dispatch failed');
  expect(detach).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not complete from an in-flight view flush after the timeout', async () => {
  let release!: () => void;
  flushView.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const check = vi.fn(() => true);
  const result = expect(wait({ check })).rejects.toThrow('missing-view-ready');
  receive(delivery);
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
  release(); await Promise.resolve();
  expect(check).not.toHaveBeenCalled();
  expect(detach).toHaveBeenCalledTimes(1);
});

it('preserves a dispatch rejection even when its thrown value is undefined', async () => {
  await expect(wait({ dispatch: () => { throw undefined; } })).rejects.toBeUndefined();
  expect(detach).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('serializes the helper under the tsx loader without capturing transpiler globals', () => {
  const script = `
    import { runInNewContext } from 'node:vm';
    import { installViewCompletion } from './tests/performance/view-completion.ts';
    let receive, cleaned = 0;
    const window = { __performance: {
      flushView: async () => {}, onView(listener) { receive = listener; return () => { cleaned++; }; },
    } };
    runInNewContext('(' + installViewCompletion.toString() + ')()', {
      window, document: { body: {} }, setTimeout, clearTimeout,
      MutationObserver: class { observe() {} disconnect() { cleaned++; } },
    });
    await window.__waitForPerformanceView({ accept: () => true, check: () => true,
      dispatch: () => receive({}), errors: [] });
    if (cleaned !== 2) throw Error('Serialized completion did not release resources');
  `;
  expect(() => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '../../..'), timeout: 10_000,
  })).not.toThrow();
});
