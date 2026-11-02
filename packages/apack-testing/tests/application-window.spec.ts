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
  const page = { url: () => 'file:///app/index.html', evaluate: vi.fn(async () => ready) } as unknown as Page;
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
it.each(['closed', 'unresponsive'])('wakes on a new window beside a %s candidate', async (candidate) => {
  vi.useFakeTimers();
  const pages = [{ url: () => 'file:///app/index.html', evaluate: vi.fn(() => candidate === 'unresponsive' ? new Promise<boolean>(() => {}) : Promise.reject(Error('page closed'))) } as unknown as Page];
  const application = app(pages);
  let found: Page | undefined;
  const pending = waitForApplicationWindow(application, 45_000).then(page => { found = page; return page; });
  await vi.advanceTimersByTimeAsync(0);
  const page = { url: () => 'file:///app/index.html', evaluate: vi.fn(async () => true) } as unknown as Page;
  pages.push(page); application.emit('window', page);
  await vi.advanceTimersByTimeAsync(0);
  expect(found).toBe(page);
  expect(await pending).toBe(page);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([false, true])('retains the discovery deadline with an unresponsive window: %s', async (unresponsive) => {
  vi.useFakeTimers();
  const application = app(unresponsive ? [{ url: () => 'file:///app/index.html', evaluate: vi.fn(() => new Promise<boolean>(() => {})) } as unknown as Page] : []);
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

it.each([false, true])('selects the main renderer beside an already-ready popout (popout first: %s)', async popoutFirst => {
  vi.useFakeTimers();
  const main = { url: () => 'file:///app/index.html', evaluate: vi.fn(async () => true) } as unknown as Page;
  const popout = { url: () => 'file:///app/index.html?popout=surface&surfaceId=default-setup%2Fnotes', evaluate: vi.fn(async () => true) } as unknown as Page;
  const application = app(popoutFirst ? [popout, main] : [main, popout]);
  const pending = waitForApplicationWindow(application, 45_000);
  await vi.advanceTimersByTimeAsync(0);
  expect(await pending).toBe(main);
  expect(popout.evaluate).not.toHaveBeenCalled();
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('rechecks window role when navigation finishes during a readiness probe', async () => {
  vi.useFakeTimers();
  let url = 'about:blank', ready = false;
  let resolveProbe!: (ready: boolean) => void;
  const navigating = { url: () => url, evaluate: vi.fn(() => new Promise<boolean>(resolve => { resolveProbe = resolve; })) } as unknown as Page;
  const main = { url: () => 'file:///app/index.html', evaluate: vi.fn(async () => ready) } as unknown as Page;
  const application = app([navigating, main]);
  let found: Page | undefined;
  const pending = waitForApplicationWindow(application, 45_000).then(page => { found = page; return page; });
  await vi.advanceTimersByTimeAsync(0);
  url = 'file:///app/index.html?popout=surface&surfaceId=default-setup%2Fnotes';
  resolveProbe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(found).toBeUndefined();
  ready = true;
  await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toBe(main);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the discovery deadline when only a ready popout exists', async () => {
  vi.useFakeTimers();
  const popout = { url: () => 'file:///app/index.html?popout=surface&surfaceId=default-setup%2Fnotes', evaluate: vi.fn(async () => true) } as unknown as Page;
  const application = app([popout]);
  const pending = waitForApplicationWindow(application, 20);
  const rejected = expect(pending).rejects.toThrow(/within timeout/);
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  expect(popout.evaluate).not.toHaveBeenCalled();
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('accepts a main renderer with a surface selection query but no popout role', async () => {
  vi.useFakeTimers();
  const main = { url: () => 'file:///app/index.html?surfaceId=host%2Fsettings', evaluate: vi.fn(async () => true) } as unknown as Page;
  const application = app([main]);
  const pending = waitForApplicationWindow(application, 45_000);
  await vi.advanceTimersByTimeAsync(0);
  expect(await pending).toBe(main);
  expect(application.listenerCount('window')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
