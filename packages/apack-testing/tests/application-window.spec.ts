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
it('passes over a surface popout ready before the main window', async () => {
  vi.useFakeTimers();
  // The predicate runs against each page's own window, as Playwright runs it in the page; the main window's
  // shell starts after the popout's, so taking any shell finds the popout
  let mainStarted = false;
  const shellPage = (main: boolean) => ({ evaluate: vi.fn(async (predicate: () => unknown) => {
    vi.stubGlobal('window', main && !mainStarted ? {}
      : { applicationState: { getSnapshot: () => ({ context: { ownsLastActiveSurface: main } }) } });
    try { return predicate(); } finally { vi.unstubAllGlobals(); }
  }) }) as unknown as Page;
  const popout = shellPage(false);
  const main = shellPage(true);
  const pending = waitForApplicationWindow(app([popout, main]), 45_000);
  await vi.advanceTimersByTimeAsync(0);
  mainStarted = true;
  await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toBe(main);
});
it.each(['closed', 'unresponsive'])('wakes on a new window beside a %s candidate', async (candidate) => {
  vi.useFakeTimers();
  const pages = [{ evaluate: vi.fn(() => candidate === 'unresponsive' ? new Promise<boolean>(() => {}) : Promise.reject(Error('page closed'))) } as unknown as Page];
  const application = app(pages);
  let found: Page | undefined;
  const pending = waitForApplicationWindow(application, 45_000).then(page => { found = page; return page; });
  await vi.advanceTimersByTimeAsync(0);
  const page = { evaluate: vi.fn(async () => true) } as unknown as Page;
  pages.push(page); application.emit('window', page);
  await vi.advanceTimersByTimeAsync(0);
  expect(found).toBe(page);
  expect(await pending).toBe(page);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([false, true])('retains the discovery deadline with an unresponsive window: %s', async (unresponsive) => {
  vi.useFakeTimers();
  const application = app(unresponsive ? [{ evaluate: vi.fn(() => new Promise<boolean>(() => {})) } as unknown as Page] : []);
  const pending = waitForApplicationWindow(application, 20);
  let expired = false;
  void pending.catch(() => { expired = true; });
  const result = expect(pending).rejects.toThrow(/within timeout/);
  await vi.advanceTimersByTimeAsync(20);
  expect(expired).toBe(true);
  await result;
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
