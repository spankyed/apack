// Backend sends to surfaces from outside a system's own `emit` (broadcast, services.emitter.broadcast) go
// through the app's bus, which drops them until a client connects and delivers them after. The code system's file
// watcher and terminal output, and the browser system's startup data, still reach their surfaces.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

interface Received { surface: string; type: string; data?: unknown; asked?: string; answer?: { savedBookmarks?: Array<{ url: string }> } }

type RecordingWindow = {
  __received?: Received[];
  applicationState: { onEvent(observer: (record: { to: string; event: Received }) => void): void };
};

/**
 * The id a built-in feature's system and surface run under. This spec reads the surfaces by id, which pack
 * code can't, so it writes the ids rather than the names.
 */
const builtIn = (feature: string) => `default-setup/${feature}`;

/** Records every event the code and browser surfaces receive from here on */
async function recordSurfaceEvents(appPage: Page): Promise<void> {
  await appPage.evaluate((ids) => {
    const win = window as unknown as RecordingWindow;
    if (win.__received) return;
    win.__received = [];
    win.applicationState.onEvent(({ to, event }) => {
      if (to === ids.code || to === ids.browser) {
        win.__received!.push({ ...(JSON.parse(JSON.stringify(event)) as Received), surface: to });
      }
    });
  }, { code: builtIn('code'), browser: builtIn('browser') });
}

async function received(appPage: Page, feature: string, type: string): Promise<Received[]> {
  return appPage.evaluate(({ surface, type }) => ((window as unknown as RecordingWindow).__received ?? [])
    .filter((event) => event.surface === surface && event.type === type), { surface: builtIn(feature), type });
}

let workDir: string | undefined;
test.afterEach(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

test("the code system's file watcher and a terminal's news reach the code surface", async ({ app, appPage }) => {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-surface-sends-')));
  // The code system watches a git working directory
  execFileSync('git', ['init', '-q'], { cwd: workDir });
  await recordSurfaceEvents(appPage);

  const changed = path.join(workDir, 'changed-outside.txt');
  fs.writeFileSync(changed, 'first');
  await app.send(builtIn('code'), { type: 'SET_BASE_DIRECTORY', path: workDir, fromUserNavigation: false });
  // The watcher reports changes to open files, and a read opens one. The system sets its base directory after
  // the send is accepted, and refuses a read asked before then, so the read is asked until it is answered with the file
  await expect.poll(async () => (await app.ask(builtIn('code'), { type: 'explorer.READ_FILE', path: changed })).type)
    .toBe('ASK_ANSWERED');
  // Written again on each check, since the watcher may be a moment from reporting when the read is answered.
  // The broadcast is what this test is about
  let writes = 0;
  await expect.poll(async () => {
    fs.writeFileSync(changed, `write ${++writes}`);
    return (await received(appPage, 'code', 'explorer.FILE_CHANGED_EXTERNALLY'))
      .some((event) => JSON.stringify(event.data).includes('changed-outside.txt'));
  }, { intervals: [500] }).toBe(true);

  // What a terminal is goes in the answer, to whoever asked; every window hears that one was made, by its id alone,
  // which is the news this test is about
  const opened = await app.ask(builtIn('code'), { type: 'terminal.CREATE_TERMINAL', title: 'e2e surface sends', cwd: workDir });
  expect(opened.type).toBe('ASK_ANSWERED');
  const terminalId = (opened.answer as { id: string }).id;
  await expect.poll(async () => (await received(appPage, 'code', 'terminal.CREATED'))
    .map((event) => (event.data as { terminalId: string }).terminalId)).toContain(terminalId);
  try {
    // What a program prints is drawn by the window from its session and is no event; what it *does* is.
    // This asks for text on the clipboard (OSC 52), which the system hands the surface as a claim
    await app.send(builtIn('code'), { type: 'terminal.TERMINAL_INPUT', terminalId, data: `printf '\\033]52;c;${Buffer.from('e2e-marker-42').toString('base64')}\\007'\r` });
    await expect.poll(async () => (await received(appPage, 'code', 'terminal.CLIPBOARD'))
      .filter((event) => (event.data as { terminalId: string }).terminalId === terminalId)
      .map((event) => (event.data as { text: string }).text)).toContain('e2e-marker-42');
  } finally {
    await app.send(builtIn('code'), { type: 'terminal.CLOSE_TERMINAL', terminalId });
  }
});

test("a reloaded pack's browser surface restores what its system saved, asking as it starts", async ({ app, appPage, connection }) => {
  const url = `https://example.com/e2e-surface-sends-${Date.now()}`;
  await recordSurfaceEvents(appPage);
  await app.send(builtIn('browser'), { type: 'SYNC_BOOKMARKS', bookmarks: [{ url, title: 'E2E bookmark', displayOrder: 0 }] });

  try {
    // The reload restarts the pack's systems and replaces its frontend's actors, each of which the shell starts
    // Asked once and awaited to its answer: a reload loads the pack's runtime from disk, which a busy disk makes
    // slow, and an assertion's backstop around the request would give up on one still in flight
    await connection.reloadPack('default-setup');

    // The answer is no event of the surface's: it is the output of the ask its machine invoked, so what shows it
    // arrived is the surface holding the bookmark
    await expect.poll(() => appPage.evaluate((ref) => {
      const surface = (window as unknown as { applicationState: { surface(id: string): { getSnapshot(): { context: { bookmarks: { url: string }[] } } } | undefined } })
        .applicationState.surface(ref);
      return (surface?.getSnapshot().context.bookmarks ?? []).map((bookmark) => bookmark.url);
    }, builtIn('browser'))).toContain(url);
  } finally {
    await app.send(builtIn('browser'), { type: 'SYNC_BOOKMARKS', bookmarks: [] });
  }
});
