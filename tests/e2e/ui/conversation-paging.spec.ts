import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, type AppDriver } from '@apackdev/testing';
import { richThreadFixture } from '../../performance/fixture.ts';
import type { PerformanceWindow } from '../../performance/window.ts';

const rows = (page: Page) => page.locator('[data-message-id]');
const older = (page: Page) => page.getByRole('button', { name: 'Load older messages', exact: true });

async function prepare(app: AppDriver, page: Page, name: string) {
  const fixture = richThreadFixture().data;
  const threads = fixture.threads.map((thread, index) => ({ ...thread, id: `Thread-paging-${name}-${index}` }));
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-paging-'));
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify({ ...fixture, threads }));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await page.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await page.waitForFunction(id => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return !!(context as unknown as { threadMap: Record<string, unknown> }).threadMap[id];
    }, threads[1].id);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  return threads.map(thread => thread.id);
}

async function open(app: AppDriver, page: Page, threadId: string, fixtureIndex = 0) {
  await app.sendEvent({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId }] });
  await page.waitForFunction(id => (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.id === id, threadId);
  await expectRows(page, 50, 50, fixtureIndex);
  await frames(page);
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function expectRows(page: Page, first: number, count: number, fixtureIndex = 0) {
  await expect.poll(() => rows(page).evaluateAll(elements => elements.map(row => {
    const text = row.querySelector('.tiptap-body')?.textContent ?? '';
    const match = text.match(/Fixture thread (\d+) message (\d+)\./);
    return match && text.includes(`Rich end ${match[1]}/${match[2]}.`) && row.getClientRects().length ? `${match[1]}/${match[2]}` : 'incomplete';
  }))).toEqual(Array.from({ length: count }, (_, index) => `${fixtureIndex}/${first + index}`));
  const ids = await rows(page).evaluateAll(elements => elements.map(row => row.getAttribute('data-message-id')));
  expect(new Set(ids).size).toBe(count);
}

async function restoreAnchor(page: Page, id: string, top: number) {
  await frames(page);
  await expect.poll(() => page.locator(`[data-message-id="${id}"]`).evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), top)).toBeLessThan(3);
}


test.afterEach(async ({ appPage }, info) => {
  if (info.status === info.expectedStatus) return;
  const state = await appPage.evaluate(() => {
    const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const paging = context as typeof context & { messagePagination: unknown; focusMessage: unknown };
    const row = document.querySelector('[data-message-id]');
    const container = row?.closest<HTMLElement>('.overflow-y-auto');
    return { thread: context.currentThread?.id, ids: context.chatMessageIds, limit: context.chatLimit,
      pagination: paging.messagePagination, focus: paging.focusMessage,
      scrollTop: container?.scrollTop, scrollHeight: container?.scrollHeight,
      renderedIds: Array.from(document.querySelectorAll('[data-message-id]'), row => row.getAttribute('data-message-id')) };
  });
  await info.attach('paging-state', { body: Buffer.from(JSON.stringify(state)), contentType: 'application/json' });
});

test('manual paging prepends complete rows without moving the reading position', async ({ app, appPage }) => {
  const [thread] = await prepare(app, appPage, 'manual');
  await open(app, appPage, thread);
  await expect(older(appPage)).toHaveCount(1);
  const anchor = await rows(appPage).last().evaluate(row => ({ id: row.getAttribute('data-message-id')!, top: row.getBoundingClientRect().top }));
  // A normal Playwright click scrolls the button into view, exercising automatic paging first.
  await older(appPage).evaluate((button: HTMLButtonElement) => button.click());
  await expectRows(appPage, 0, 100);
  await restoreAnchor(appPage, anchor.id, anchor.top);
  await expect(older(appPage)).toHaveCount(0);
});

test('scrolling to the top automatically prepends one page and preserves its anchor', async ({ app, appPage }) => {
  const [thread] = await prepare(app, appPage, 'automatic');
  await open(app, appPage, thread);
  const anchor = await rows(appPage).first().evaluate(row => {
    const container = row.closest<HTMLElement>('.overflow-y-auto')!;
    container.scrollTop = 0;
    return { id: row.getAttribute('data-message-id')!, top: row.getBoundingClientRect().top };
  });
  await expectRows(appPage, 0, 100);
  await restoreAnchor(appPage, anchor.id, anchor.top);
  await expect(older(appPage)).toHaveCount(0);
});

test('cross-thread search focus survives paging for loaded and older targets', async ({ app, appPage }) => {
  const [thread, other] = await prepare(app, appPage, 'focus');
  await open(app, appPage, thread);
  const loadedId = await rows(appPage).first().getAttribute('data-message-id');
  await older(appPage).evaluate((button: HTMLButtonElement) => button.click());
  await expectRows(appPage, 0, 100);
  const oldestId = await rows(appPage).first().getAttribute('data-message-id');
  for (const messageId of [loadedId, oldestId]) {
    await open(app, appPage, other, 1);
    await app.sendEvent({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_MESSAGE', threadId: thread, messageId }] });
    const target = appPage.locator(`[data-message-id="${messageId}"]`);
    await expect(target).toHaveClass(/focused/);
    await expect(target).toBeInViewport({ ratio: 1 });
    await appPage.waitForFunction(() => !((window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { focusMessage?: unknown }).focusMessage);
    await frames(appPage);
    await expect(target).toBeInViewport({ ratio: 1 });
  }
});
