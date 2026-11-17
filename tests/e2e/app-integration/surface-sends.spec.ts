// Backend sends to surfaces from outside a system's own `emit` (broadcastToSurface, services.emitter.broadcastToSurface) go
// through the app's bus, which drops them until a client connects and delivers them after. The code system's file
// watcher and terminal output, and the browser system's startup data, still reach their surfaces.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { API_TOKEN_HEADER } from '@apackdev/sdk/utils/pure';
import { test, expect } from '@apackdev/testing';

interface Received { surface: string; type: string; data?: unknown; savedBookmarks?: Array<{ url: string }> }

type RecordingWindow = {
  __received?: Received[];
  applicationState: { system: { inspect(observer: (event: { type: string; actorRef: { id: string }; event: Received }) => void): void } };
};

/**
 * The id a built-in feature's system and surface run under. This spec reads the surfaces' actors by id, which pack
 * code can't, so it writes the ids rather than the names.
 */
const builtIn = (feature: string) => `default-setup/${feature}`;

/** Records every event the code and browser surface actors receive from here on */
async function recordSurfaceEvents(appPage: Page): Promise<void> {
  await appPage.evaluate((ids) => {
    const win = window as unknown as RecordingWindow;
    if (win.__received) return;
    win.__received = [];
    win.applicationState.system.inspect((inspection) => {
      const surface = inspection.actorRef?.id;
      if (inspection.type === '@xstate.event' && (surface === ids.code || surface === ids.browser)) {
        win.__received!.push({ ...(JSON.parse(JSON.stringify(inspection.event)) as Received), surface });
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
    .toBe('explorer.FILE_CONTENT');
  // Written again on each check, since the watcher may be a moment from reporting when the read is answered.
  // The broadcast is what this test is about
  let writes = 0;
  await expect.poll(async () => {
    fs.writeFileSync(changed, `write ${++writes}`);
    return (await received(appPage, 'code', 'explorer.FILE_CHANGED_EXTERNALLY'))
      .some((event) => JSON.stringify(event.data).includes('changed-outside.txt'));
  }, { intervals: [500] }).toBe(true);

  // What a terminal is goes in `terminal.OPENED`, to whoever asked; every window hears that one was made, by its
  // id alone, which is the news this test is about
  const opened = await app.ask(builtIn('code'), { type: 'terminal.CREATE_TERMINAL', title: 'e2e surface sends', cwd: workDir });
  expect(opened.type).toBe('terminal.OPENED');
  const terminalId = (opened.data as { id: string }).id;
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

test("a reloaded pack's browser surface restores what its system saved, asking as it starts", async ({ app, appPage }) => {
  const url = `https://example.com/e2e-surface-sends-${Date.now()}`;
  await recordSurfaceEvents(appPage);
  await app.send(builtIn('browser'), { type: 'SYNC_BOOKMARKS', bookmarks: [{ url, title: 'E2E bookmark', displayOrder: 0 }] });
  const { apiPort, apiToken } = await appPage.evaluate(() => {
    const api = (window as { electronAPI?: { apiPort?: number; apiToken?: string } }).electronAPI;
    return { apiPort: api?.apiPort, apiToken: api?.apiToken ?? '' };
  });
  expect(apiPort, 'the renderer knows the API port').toBeTruthy();
  expect(apiToken, 'the renderer knows the API token').toBeTruthy();

  try {
    // The reload restarts the pack's systems and replaces its frontend's actors, each of which the shell starts
    await expect.poll(async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/dev/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [API_TOKEN_HEADER]: apiToken },
        body: JSON.stringify({ packId: 'default-setup' }),
      });
      return response.status;
    }).toBe(200);

    await expect.poll(async () => (await received(appPage, 'browser', 'SAVED_SESSION_READ'))
      .some((event) => (event.savedBookmarks ?? []).some((bookmark) => bookmark.url === url))).toBe(true);
  } finally {
    await app.send(builtIn('browser'), { type: 'SYNC_BOOKMARKS', bookmarks: [] });
  }
});
