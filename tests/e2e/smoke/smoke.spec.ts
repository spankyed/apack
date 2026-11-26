import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';

test('app launches without crashing', async ({ electronApp, appPage }) => {
  const window = await electronApp.browserWindow(appPage);

  const state = await window.evaluate(
    (win): { isDevToolsOpened: boolean; isCrashed: boolean } => ({
      isDevToolsOpened: win.webContents.isDevToolsOpened(),
      isCrashed: win.webContents.isCrashed(),
    }),
  );

  expect(state.isCrashed).toBe(false);
  expect(state.isDevToolsOpened).toBe(false);
});

test('app reaches connected state', async ({ app }) => {
  const state = await app.getState();
  expect(state).toBe('running.connected');
});

test('applicationState is accessible with surfaces loaded', async ({ app }) => {
  const ctx = await app.getContext();
  expect(ctx.activeSurfaceId).toBeTruthy();
  expect(ctx.surfaceIds.length).toBeGreaterThan(0);
});

test('runs in an isolated per-worker test data dir', async ({ electronApp, appPage: _ready }) => {
  const { name, userData } = await electronApp.evaluate(({ app }) => ({
    name: app.getName(),
    userData: app.getPath('userData'),
  }));
  expect(name).toBe('apack-test');
  // A fresh temp dir per worker, never the shared ~/…/apack-test data dir
  expect(userData).toMatch(/[\\/]apack-e2e-[^\\/]+$/);
});

/**
 * **An attachable app is one that published a session, and a test app publishes none** — though it is
 * running with a debug port wide open, which is the fact that makes this worth a case.
 *
 * Playwright drives Electron over CDP, so it launches every app here with `--remote-debugging-port`, and
 * Chromium writes the number it chose to `DevToolsActivePort` in the data dir. So a tool that *inferred*
 * attachability — from the file, from a reachable port — would find this app and drive a test run's app
 * mid-suite. `@apackdev/host/dev-session`'s rule is that the file is declared instead: `apack pack dev` and the
 * `npm run dev` loop publish one because they mean their app to be driven, and nothing treats the absence of
 * one as "try anyway".
 *
 * That was an argument until this case. The port being asserted *present* is what stops the absence below
 * from being read off an empty or wrong directory — and is the same half of the claim, since it is what
 * there would be to infer from.
 */
test('publishes no session, though a test app has a debug port open', async ({ electronApp, appPage: _ready }) => {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));

  // What inference would have to go on, and it is there
  expect(fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf-8').split('\n')[0]).toMatch(/^\d+$/);
  // What a driver actually reads, and it is not
  expect(fs.existsSync(path.join(userData, 'session.json'))).toBe(false);
});
