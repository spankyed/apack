// The claim the attach design rests on: a page that arrived over CDP answers a verb the same as a page a
// launch handed back, so one `SessionPage` serves both and `drive` stops needing to own the app it drives.
//
// It earns a place here on the two counts this directory asks for (root `CLAUDE.md`, "E2E visual testing"):
// it needs the real process boundary — two Playwright connections to one Electron over a real debug port,
// which no harness has — and a future change could break it, since the whole of `drive` moves onto the
// attached path.
//
// **Which window the attach path picks is not asserted here**, and cannot usefully be: `pages()[0]` is the
// right one in this app today, so this spec passes with the predicate replaced by "take the first" —
// measured, by doing that. The choice among targets is held by `apack-testing`'s `cdp-page.spec.ts`
// against a fake that presents several on purpose.
//
// **It launches its own app rather than using the fixture, and must.** `appLaunchEnv` sets
// `PLAYWRIGHT_TEST=true`, so a fixture-launched app resolves the `test` environment, and the debug port is
// `development` only. So this is the one spec here that drives `_electron.launch` directly, with its own
// temp data dir.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, createAppDriver, attachToApp, waitForAppReady, type AttachedApp } from '@apackdev/testing';

const APP_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * The port Chromium picked, read here rather than imported.
 *
 * `--remote-debugging-port=0` means it chooses, and it writes the number into `DevToolsActivePort` in the
 * data dir. Six lines inline, because the production reader belongs to the CLI (`app/session-file.ts`) and
 * its one caller is the command that publishes a session — a test reading a file it just caused to be
 * written needs nothing from that module.
 */
async function devToolsPort(dataDir: string, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const port = Number(fs.readFileSync(path.join(dataDir, 'DevToolsActivePort'), 'utf-8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No debug port appeared in ${dataDir} within ${timeoutMs}ms`);
}

/** The main window among the app's targets, by the same predicate the fixture and the attach path use. */
async function mainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const has = await candidate.evaluate(() => !!(window as { applicationState?: unknown }).applicationState).catch(() => false);
      if (has) return candidate;
    }
    await app.waitForEvent('window', { timeout: 2_000 }).catch(() => {});
  }
  throw new Error('No window with applicationState appeared');
}

test.describe('a connected page and a launched one', () => {
  let app: ElectronApplication;
  let launched: Page;
  let attached: AttachedApp;
  let dataDir: string;

  test.beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-attach-'));
    app = await _electron.launch({
      executablePath: path.join(APP_ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
      args: [APP_ROOT, '--remote-debugging-port=0'],
      cwd: APP_ROOT,
      // `development`, which is what the debug port is for, and a data dir of this spec's own. Playwright's
      // own `PLAYWRIGHT_TEST` is deliberately not set: it would make the app resolve `test` instead.
      env: { ...process.env, APACK_ENV: 'development', APACK_USER_DATA_DIR: dataDir, PLAYWRIGHT_VISIBLE: '' },
    });
    launched = await mainWindow(app);
    await waitForAppReady(launched);

    // Read rather than assumed: `--remote-debugging-port=0` means Chromium picks one, and the number it
    // picked is the only thing that can say which
    attached = await attachToApp({ debugPort: await devToolsPort(dataDir) });
  });

  test.afterAll(async () => {
    // The fixture's close, bounded by the app's work: under load a bare `close()` waited on Chromium writing a profile
    // this hook deletes next, and ran past the hook's clock after every test had passed
    test.setTimeout(0);
    await attached?.detach();
    if (app) await closeApp(app, { userDataDir: dataDir, keepProfile: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('answer the same verb identically', async () => {
    const dir = path.join(dataDir, 'screenshots');
    const viaLaunch = createAppDriver(launched, dir);
    const viaAttach = createAppDriver(attached.page, dir);

    // Three answers rather than one, because they read different parts of the app: the machine's state
    // value, the surfaces it registered, and an evaluate of this spec's own
    expect(await viaAttach.getState()).toEqual(await viaLaunch.getState());
    expect(await viaAttach.getContext()).toEqual(await viaLaunch.getContext());
    expect(await attached.page.evaluate(() => (window as { appVersion?: string }).appVersion))
      .toBe(await launched.evaluate(() => (window as { appVersion?: string }).appVersion));
  });

  test('see each other writes, being one app', async () => {
    // The two are connections to one renderer, not two apps that happen to agree. A write through one is
    // the cheapest thing that can tell those apart — equal answers alone cannot.
    await attached.page.evaluate(() => { (window as unknown as Record<string, unknown>).__attachParity = 'written by the attached page'; });
    expect(await launched.evaluate(() => (window as unknown as Record<string, string>).__attachParity))
      .toBe('written by the attached page');
  });

  test('survive the connection going away, which is what a launch cannot', async () => {
    // The row that decided the design: a launched `Page` dies with its window, where a CDP client can let
    // go and come back. A session that reconnects is why an app outlives the questions asked of it.
    const port = await devToolsPort(dataDir);
    await attached.detach();
    attached = await attachToApp({ debugPort: port });
    expect(await attached.page.evaluate(() => (window as unknown as Record<string, string>).__attachParity))
      .toBe('written by the attached page');
  });
});
