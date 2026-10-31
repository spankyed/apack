import { EventEmitter } from 'node:events';
import type { ElectronApplication, Page } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { waitForApplicationWindow } from '../src/application-window.ts';

afterEach(() => vi.useRealTimers());
function app(pages: Page[]) {
  return Object.assign(new EventEmitter(), { windows: () => pages }) as unknown as ElectronApplication & EventEmitter;
}
it('finds readiness in an existing window without waiting for another window to be created', async () => {
  vi.useFakeTimers();
  let ready = false;
  const page = { evaluate: vi.fn(async () => ready) } as unknown as Page;
  const application = app([page]);
  let found: Page | undefined;
  const pending = waitForApplicationWindow(application, 45_000).then(page => { found = page; return page; });
  await vi.advanceTimersByTimeAsync(0);
  ready = true;
  await vi.advanceTimersByTimeAsync(200);
  expect(found).toBe(page);
  expect(await pending).toBe(page);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('wakes on a new window and ignores a closed or navigating candidate', async () => {
  vi.useFakeTimers();
  const pages = [{ evaluate: vi.fn(async () => { throw Error('page closed'); }) } as unknown as Page];
  const application = app(pages);
  const pending = waitForApplicationWindow(application, 45_000);
  await vi.advanceTimersByTimeAsync(0);
  const page = { evaluate: vi.fn(async () => true) } as unknown as Page;
  pages.push(page); application.emit('window', page);
  expect(await pending).toBe(page);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('retains the declared discovery deadline and removes its event listener', async () => {
  vi.useFakeTimers();
  const application = app([]);
  const pending = waitForApplicationWindow(application, 20);
  const result = expect(pending).rejects.toThrow(/within timeout/);
  await vi.advanceTimersByTimeAsync(20);
  await result;
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
