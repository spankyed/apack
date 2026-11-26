/**
 * The whole of a live drive session, for a shim that has a page and wants to be driven.
 *
 * Everything it needs it already has from the fixture — the app is launched, onboarding bypassed, the
 * viewport pinned and the output captured — so this adds the channel and the waiting, and nothing about
 * launching an app. `attachedSession` below assembles the same four pieces over a page nobody here
 * launched, which is what lets `createSession` not know which it was given.
 *
 * **It returns when the session ends**, which is the one structural requirement. The fixture's teardown
 * is the code after `await use(...)`: a body that never returns skips `app.close()`, the listener
 * removal and the data-dir policy. So `/close` resolves this, and a signal resolves this, rather than
 * either killing the process where it stands.
 */
import * as fs from 'node:fs';
import type { Page } from '@playwright/test';
import { DRIVE_REF, createSession, type EngineSession, type SessionPage } from './session.ts';
import { createAppDriver, waitForAppReady } from '../index.ts';
import { CLAIM_CONFLICT, connectApiClient, type ApiClient } from './api-client.ts';

/** The `AppDriver` members the engine serves, taken whole rather than one callback at a time */
export type EngineAppDriver = {
  readonly screenshot: (name: string) => Promise<unknown>;
  readonly waitForState: (check: string, timeoutMs?: number) => Promise<unknown>;
  readonly waitForSurface: (surfaceId: string, timeoutMs?: number) => Promise<unknown>;
};

/**
 * The real window, for a session someone is looking at.
 *
 * One method, because one act needs it: a viewport Playwright sets is emulated *inside* the window, so in
 * a shown run it letterboxes the app against the desktop. Given this port, `/set-viewport` moves the
 * window itself and what the agent sees is what a user would; given none, it sets the emulated viewport,
 * which is what keeps a suite's layout deterministic. `src/launch-env.ts`'s `pinsViewport` is the one
 * decision of which run is which. An attached session has no window at all, and takes the emulated one.
 */
export type EngineWindow = {
  /** Resizes the window and answers with the size it actually took, which need not be the one asked for */
  readonly setContentSize: (width: number, height: number) => Promise<{ width: number; height: number }>;
};

/** The app's state value as the window exposes it, which is all these waits read */
type AppWindow = {
  applicationState?: { getSnapshot(): { value?: Record<string, unknown> | string } };
  __disableOnboardingUI?: () => void;
};

async function reloadWindow(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => {
    const app = window as unknown as AppWindow;
    const value = app.applicationState?.getSnapshot().value;
    if (typeof value === 'string') {
      if (value === 'onboarding' || value.startsWith('onboarding.')) app.__disableOnboardingUI?.();
      return value === 'running.connected';
    }
    if (typeof value !== 'object' || value === null) return false;
    // The fixture dismisses onboarding once, as the app launches, so a reloaded window comes back sitting
    // in it. Dismissed from inside the poll because it can arrive at any point during the boot
    if ('onboarding' in value) app.__disableOnboardingUI?.();
    return value.running === 'connected';
  }, null, { timeout: 60_000 });
}


export const asSessionPage = (page: Page, app: EngineAppDriver, window?: EngineWindow): SessionPage => ({
  evaluateExpression: (source) => page.evaluate(source),
  // Playwright's argument type is `Unboxed<A>`, which unwraps a `JSHandle` into what it points at. The
  // engine never passes one — every argument here is a plain JSON value from a request body — so the two
  // are the same type at every call, and the cast is where that is stated rather than inferred
  evaluateWith: (fn, arg) =>
    page.evaluate(fn as (value: unknown) => unknown, arg as unknown),
  exposeFunction: (name, callback) => page.exposeFunction(name, callback),
  reload: () => reloadWindow(page),
  click: (selector) => page.click(selector),
  fill: (selector, text) => page.fill(selector, text),
  press: (key, selector) => (selector === undefined ? page.keyboard.press(key) : page.press(selector, key)),
  ariaSnapshot: () => page.locator('body').ariaSnapshot(),
  setViewport: async (width, height) => {
    // An emulated viewport is applied exactly, and `setViewportSize` resolves once it has been; a real
    // window clamps, so only it can say what the answer is
    if (window === undefined) {
      await page.setViewportSize({ width, height });
      return { width, height };
    }
    return window.setContentSize(width, height);
  },
  screenshot: (name) => app.screenshot(name),
  waitForState: (check, timeoutMs) => app.waitForState(check, timeoutMs),
  waitForSurface: (surfaceId, timeoutMs) => app.waitForSurface(surfaceId, timeoutMs),
});

/**
 * Where the API is, asked of the app window rather than read off disk.
 *
 * The port file would do, but the **token file is not always written**: `publishApiFiles` skips it unless
 * `NODE_ENV` is development or the API invented its own token, and a packaged app satisfies neither. So reading
 * from disk would work in a checkout and fail against `apack pack drive --channel beta`, which is the worst split to
 * ship. The window has both from the preload, which is also how `tests/e2e/app-integration/api-access.spec.ts`
 * gets them.
 */
async function apiAddressFromWindow(page: SessionPage): Promise<{ port: number; token: string }> {
  const found = await page.evaluateExpression(
    '(() => { const api = window.electronAPI; return { port: api?.apiPort, token: api?.apiToken }; })()',
  ) as { port?: number; token?: string };
  if (typeof found?.port !== 'number' || !found.token) {
    throw new Error(
      "The app window didn't offer the API's port and token (window.electronAPI), so the drive session has no way "
      + 'to reach the bus. That bridge is the preload\'s (packages/preload), and without it only the page verbs '
      + '(/eval, /state, /wait, /navigate, /screenshot) could work.',
    );
  }
  return { port: found.port, token: found.token };
}

/**
 * Runs `work` with an unwind stack, closing any registered handles in reverse order if it throws.
 *
 * **A handle left open does not fail, it hangs.** Node keeps running while one is, so a refused claim left
 * both the CDP connection and the socket open and `npm run dev:drive -- --eval` printed its refusal and then sat
 * there for ever — which reads as the verb hanging rather than as a refusal that was reported. Every handle
 * opened during attach is registered as soon as it is acquired, so a failure rethrows unchanged while closing
 * everything already open.
 *
 * **A failure in the cleanup must not replace the one being cleaned up after.** `close` here is a socket
 * and a CDP connection, either of which can throw on a connection that has already gone — and letting that
 * through would hand the caller an error about tidying up in place of the refusal or timeout it needs,
 * which is the one thing this function exists to deliver. So each close is attempted and its own failure
 * dropped; the work's error is always what is rethrown.
 *
 * @internal
 */
export async function _attachRollback<T>(
  work: (deferClose: (close: () => Promise<void> | void) => void) => Promise<T>,
): Promise<T> {
  await using unwind = new AsyncDisposableStack();
  const result = await work((close) => {
    unwind.defer(async () => {
      // Dropped, never rethrown: see above — a close that fails must not become the reason the caller is given
      try {
        await close();
      } catch { /* the handle is gone, which is what closing wanted */ }
    });
  });
  unwind.move();
  return result;
}

/**
 * Takes `host/drive`, waiting out a holder that is about to let go.
 *
 * **The claim is refused rather than taken over**, which is right — two drivers running at once must not
 * receive each other's answers — but every claim is now a *question's*, held for about a second, so two
 * agents asking at once is ordinary rather than a conflict to report. Waiting is compatible with that
 * design: it never takes a live claim, it waits for one to end.
 *
 * The window is short because the thing being waited for is short. A claim still held after it is a driver
 * that is genuinely running, and the refusal says so.
 */
const CLAIM_WAIT_MS = 10_000;

export async function _claimDrive(api: Pick<ApiClient, 'claim'>, windowMs = CLAIM_WAIT_MS): Promise<void> {
  const deadline = Date.now() + windowMs;
  for (;;) {
    try {
      await api.claim(DRIVE_REF);
      return;
    } catch (error) {
      const conflict = (error as { code?: string }).code === CLAIM_CONFLICT;
      if (!conflict || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function attachedSession(options: AttachedSessionOptions): Promise<AttachedSession> {
  const { attachToApp } = await import('./cdp-page.ts');
  return _attachRollback(async (deferClose) => {
    const { page, detach } = await attachToApp({ debugPort: options.debugPort });
    deferClose(detach);
    await waitForAppReady(page);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`[page error] ${error.stack ?? error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`[console.error] ${message.text()}`);
    });

    const sessionPage = asSessionPage(page, createAppDriver(page, options.screenshotDir));

    const api = await connectApiClient(await apiAddressFromWindow(sessionPage));
    deferClose(() => api.close());
    await _claimDrive(api);

    const session = createSession({
      page: sessionPage,
      api,
      takeErrors: () => errors.splice(0, errors.length),
      // Read per call, as the launched session does: the app writes to it for as long as it is up
      readLog: () => (options.logPath !== undefined && fs.existsSync(options.logPath) ? fs.readFileSync(options.logPath, 'utf-8') : ''),
    });
    // `ready` is what listens on the session's connection, where every addressed answer arrives. The serving
    // session runs it before its first verb; a one-off question gets its session from here, so it runs here too
    await session.ready();

    return {
      session,
      // Lets go without closing: the app was not this connection's to open and is not its to end
      detach: async () => {
        api.close();
        await detach();
      },
    };
  });
}

export interface AttachedSessionOptions {
  /** From the app's session file — the port it published */
  readonly debugPort: number;
  /** Where `/screenshot` writes */
  readonly screenshotDir: string;
  /** The app's log, which `/logs` reads. Absent means `/logs` answers empty rather than guessing */
  readonly logPath?: string;
}

export interface AttachedSession {
  readonly session: EngineSession;
  readonly detach: () => Promise<void>;
}

export { connectApiClient, type ApiAddress, type ApiClient, type BusMessage } from './api-client.ts';
export type { EngineResult, EngineSession, SessionApi, SessionPage } from './session.ts';
