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
  __sendToSystem: (systemId: string, event: Record<string, unknown>) => void;
  applicationState: { system: { inspect(observer: (event: { type: string; actorRef: { id: string }; event: Received }) => void): void } };
};

/**
 * The id a built-in feature's system and surface run under. This spec drives the app the way pack code
 * can't — the raw `sendToSystem` and the actor ids — so it writes the ids rather than the names.
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

/**
 * Sends a backend system an event as a surface does, through `window.__sendToSystem` — the renderer's door
 * for this suite (`packages/renderer/src/main.ts`), which is the SDK's `untypedSendToSystem`. A pack writes
 * the typed `sendToSystem` its `#generated/events` builds, which `defineEvents` wraps around that one.
 */
async function sendToSystem(appPage: Page, feature: string, event: Record<string, unknown>): Promise<void> {
  await appPage.evaluate(({ systemId, event }) => {
    (window as unknown as RecordingWindow).__sendToSystem(systemId, event);
  }, { systemId: builtIn(feature), event });
}

let workDir: string | undefined;
test.afterEach(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

test("the code system's file watcher and terminal output reach the code surface", async ({ appPage }) => {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-surface-sends-')));
  // The code system watches a git working directory
  execFileSync('git', ['init', '-q'], { cwd: workDir });
  await recordSurfaceEvents(appPage);

  const changed = path.join(workDir, 'changed-outside.txt');
  fs.writeFileSync(changed, 'first');
  await sendToSystem(appPage, 'code', { type: 'SET_BASE_DIRECTORY', path: workDir, fromUserNavigation: false });
  // The watcher reports changes to open files
  await expect.poll(async () => {
    await sendToSystem(appPage, 'code', { type: 'explorer.READ_FILE', path: changed });
    return (await received(appPage, 'code', 'explorer.FILE_CONTENT')).some((event) => (event.data as { path?: string }).path === changed);
  }, { timeout: 15_000, intervals: [1000] }).toBe(true);
  let writes = 0;
  // Written again on each check: the watcher starts after the base directory changes
  await expect.poll(async () => {
    fs.writeFileSync(changed, `write ${++writes}`);
    return (await received(appPage, 'code', 'explorer.FILE_CHANGED_EXTERNALLY'))
      .some((event) => JSON.stringify(event.data).includes('changed-outside.txt'));
  }, { timeout: 20_000, intervals: [500] }).toBe(true);

  await sendToSystem(appPage, 'code', { type: 'terminal.CREATE_TERMINAL', title: 'e2e surface sends', cwd: workDir });
  await expect.poll(async () => (await received(appPage, 'code', 'terminal.CREATED'))
    .some((event) => (event.data as { title?: string }).title === 'e2e surface sends'), { timeout: 15_000 }).toBe(true);
  const terminalId = (await received(appPage, 'code', 'terminal.CREATED'))
    .map((event) => event.data as { id: string; title?: string })
    .find((terminal) => terminal.title === 'e2e surface sends')!.id;
  try {
    await sendToSystem(appPage, 'code', { type: 'terminal.TERMINAL_INPUT', terminalId, data: 'echo "e2e-marker-$((6 * 7))"\r' });
    await expect.poll(async () => (await received(appPage, 'code', 'terminal.OUTPUT'))
      .filter((event) => (event.data as { terminalId: string }).terminalId === terminalId)
      .map((event) => (event.data as { data: string }).data).join(''), { timeout: 15_000 }).toContain('e2e-marker-42');
  } finally {
    await sendToSystem(appPage, 'code', { type: 'terminal.CLOSE_TERMINAL', terminalId });
  }
});

test("a reloaded pack's browser surface restores what its system saved, asking as it starts", async ({ appPage }) => {
  const url = `https://example.com/e2e-surface-sends-${Date.now()}`;
  await recordSurfaceEvents(appPage);
  await sendToSystem(appPage, 'browser', { type: 'SYNC_BOOKMARKS', bookmarks: [{ url, title: 'E2E bookmark', displayOrder: 0 }] });
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
    }, { timeout: 15_000 }).toBe(200);

    await expect.poll(async () => (await received(appPage, 'browser', 'SAVED_SESSION_READ'))
      .some((event) => (event.savedBookmarks ?? []).some((bookmark) => bookmark.url === url)), { timeout: 15_000 }).toBe(true);
  } finally {
    await sendToSystem(appPage, 'browser', { type: 'SYNC_BOOKMARKS', bookmarks: [] });
  }
});
