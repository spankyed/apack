import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, type AppDriver } from '@apackdev/testing';
import { richThreadFixture } from '../../_support/conversations.ts';
interface PagingWindow {
  __sendToSystem(system: string, event: Record<string, unknown>): void;
  applicationState: {
    system: { get(ref: string): { getSnapshot(): { context: {
      currentThread?: { id: string };
      threadMap: Record<string, unknown>;
      chatMessageIds: string[];
      chatLimit: number;
      messagePagination: unknown;
      focusMessage?: unknown;
    } } } };
  };
}

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
    await page.evaluate(directory => (window as unknown as PagingWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await page.waitForFunction(id => {
      const context = (window as unknown as PagingWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return !!context.threadMap[id];
    }, threads[1].id);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  return threads.map(thread => thread.id);
}

async function open(app: AppDriver, page: Page, threadId: string, fixtureIndex = 0) {
  await app.sendEvent({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId }] });
  await page.waitForFunction(id => (window as unknown as PagingWindow).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.id === id, threadId);
  await expectRows(page, 50, 50, fixtureIndex);
  // A viewport baseline taken during the message's entrance translation is not a reading position.
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.querySelectorAll('[data-message-id]'))
      .flatMap(row => row.getAnimations()).map(animation => animation.finished));
  });
  await frames(page);
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function expectRows(page: Page, first: number, count: number, fixtureIndex = 0) {
  // Observe readiness in the renderer instead of adding a tracing snapshot for every external poll.
  await page.waitForFunction(({ first, count, fixtureIndex }) => {
    const elements = Array.from(document.querySelectorAll('[data-message-id]'));
    return elements.length === count
      && new Set(elements.map(row => row.getAttribute('data-message-id'))).size === count
      && elements.every((row, offset) => {
        const text = row.querySelector('.tiptap-body')?.textContent ?? '';
        const match = text.match(/Fixture thread (\d+) message (\d+)\./);
        return match?.[1] === String(fixtureIndex) && Number(match[2]) === first + offset
          && text.includes(`Rich end ${fixtureIndex}/${first + offset}.`) && row.getClientRects().length > 0;
      });
  }, { first, count, fixtureIndex });
}

function measureAnchor(row: Element, scrollToTop: boolean) {
  const container = row.closest<HTMLElement>('.overflow-y-auto')!;
  if (scrollToTop) container.scrollTop = 0;
  const rect = row.getBoundingClientRect();
  return { id: row.getAttribute('data-message-id')!, top: rect.top, height: rect.height,
    scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight,
    containerTop: container.getBoundingClientRect().top, fonts: document.fonts.status, transform: getComputedStyle(row).transform };
}

async function restoreAnchor(page: Page, anchor: ReturnType<typeof measureAnchor>, info: TestInfo) {
  const row = page.locator(`[data-message-id="${anchor.id}"]`);
  try {
    await frames(page);
    await expect.poll(() => row.evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), anchor.top)).toBeLessThan(3);
  } finally {
    await info.attach('anchor-geometry', { body: Buffer.from(JSON.stringify({ before: anchor, after: await row.evaluate(measureAnchor, false) })), contentType: 'application/json' });
  }
}

test.beforeEach(async ({ appPage }) => {
  await appPage.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
});

test.afterEach(async ({ appPage }, info) => {
  const failed = info.status !== info.expectedStatus;
  const trace = info.outputPath('paging-browser-trace.zip');
  await appPage.context().tracing.stop(failed ? { path: trace } : {});
  if (!failed) return;
  await info.attach('paging-browser-trace', { path: trace, contentType: 'application/zip' });
  await info.attach('paging-window', { body: await appPage.screenshot(), contentType: 'image/png' });
  const state = await appPage.evaluate(() => {
    const context = (window as unknown as PagingWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const row = document.querySelector('[data-message-id]');
    const container = row?.closest<HTMLElement>('.overflow-y-auto');
    return { thread: context.currentThread?.id, ids: context.chatMessageIds, limit: context.chatLimit,
      pagination: context.messagePagination, focus: context.focusMessage,
      scrollTop: container?.scrollTop, scrollHeight: container?.scrollHeight,
      renderedIds: Array.from(document.querySelectorAll('[data-message-id]'), row => row.getAttribute('data-message-id')) };
  });
  await info.attach('paging-state', { body: Buffer.from(JSON.stringify(state)), contentType: 'application/json' });
});

test('manual paging prepends complete rows without moving the reading position', async ({ app, appPage }, info) => {
  const [thread] = await prepare(app, appPage, 'manual');
  await open(app, appPage, thread);
  await expect(older(appPage)).toHaveCount(1);
  const anchor = await rows(appPage).last().evaluate(measureAnchor, false);
  // A normal Playwright click scrolls the button into view, exercising automatic paging first.
  await older(appPage).evaluate((button: HTMLButtonElement) => button.click());
  await expectRows(appPage, 0, 100);
  await restoreAnchor(appPage, anchor, info);
  await expect(older(appPage)).toHaveCount(0);
});

test('scrolling to the top automatically prepends one page and preserves its anchor', async ({ app, appPage }, info) => {
  const [thread] = await prepare(app, appPage, 'automatic');
  await open(app, appPage, thread);
  const anchor = await rows(appPage).first().evaluate(measureAnchor, true);
  await expectRows(appPage, 0, 100);
  await restoreAnchor(appPage, anchor, info);
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
    await appPage.waitForFunction(() => !((window as unknown as PagingWindow).applicationState.system.get('default-setup/threads').getSnapshot().context).focusMessage);
    await frames(appPage);
    // Exercise paging at the focused position without scrolling the target away ourselves.
    await target.evaluate(row => row.closest('.overflow-y-auto')!.dispatchEvent(new Event('scroll')));
    await expectRows(appPage, 0, 100);
    await frames(appPage);
    await expect(target).toBeInViewport({ ratio: 1 });
  }
});
