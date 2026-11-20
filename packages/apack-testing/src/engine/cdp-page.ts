/**
 * Attaching to an app somebody else launched.
 *
 * `_electron` has no `connect`, which is where *"whoever launches owns the page"* came from. But an
 * Electron renderer is Chromium, so `chromium.connectOverCDP` attaches to one that was started with
 * `--remote-debugging-port` and hands back a real `Page` — and every verb is a call on a `Page`, so the
 * same `asSessionPage(page, createAppDriver(page, dir))` serves a connected page and a launched one with no
 * second implementation. That is the whole of what this module adds: the connect, and finding the window.
 *
 * **What an attached page cannot do is reach the main process.** `electronApp.browserWindow(page)` has no
 * CDP equivalent, so a real window resize is unavailable and `asSessionPage`'s `window` is left out —
 * which it already treats as "nobody is watching" and answers with the emulated viewport.
 *
 * `playwright-core` is imported lazily and is an optional peer: a published CLI must not drag 11MB into an
 * install of someone who only runs `apack pack build`, and nothing but this path needs it.
 */
// **The published types come from `@playwright/test`, not from `playwright-core`.** The runtime import is
// `playwright-core` — that is the package this needs and declares — but typing the exported surface from it
// made tsc write bare `playwright` as the specifier in this package's declarations, which it does not
// depend on and which `published-imports` refuses. One hoisted `playwright-core` is what lets the two be
// the same `Page`, so the public type can be the one the fixture already hands round.
import type { Browser, Page } from '@playwright/test';
import { isMainApplicationWindow } from '../application-window.ts';

/** What the app published, and what this needs to find it */
export interface AttachOptions {
  /** The port the app's `--remote-debugging-port` ended up on, from its session file */
  readonly debugPort: number;
  /** How long to wait for a window with `applicationState` on it (default 15s) */
  readonly timeoutMs?: number;
}

export interface AttachedApp {
  readonly page: Page;
  /**
   * Lets go of the app without closing it — the point of attaching is that it outlives the connection.
   *
   * The `Browser` stays off this surface: nothing outside needs one, since this is what closes it.
   */
  readonly detach: () => Promise<void>;
}

/** What this needs of `playwright-core`: the one call that attaches. */
interface ChromiumConnect {
  connectOverCDP: (endpoint: string) => Promise<Browser>;
}

/**
 * What a reader is told when the optional peer is absent — the install, rather than a module-not-found
 * from inside a bundle, which is what a missing optional peer otherwise looks like to whoever hits it.
 * `@apackdev/sdk` uses this pattern for `typescript` and `esbuild`.
 */
export const INSTALL_PLAYWRIGHT_CORE = 'Attaching to a running app needs `playwright-core`, which is an'
  + ' optional peer of @apackdev/testing.\n  Install it: npm i -D playwright-core';

/**
 * Chromium's connect, loaded only when something attaches.
 *
 * **The loader is a parameter because nothing else can make this path run.** In any checkout or install
 * that can attach at all, `playwright-core` resolves — so the absent-peer branch is unreachable from a
 * test that does not hand it a loader, and an unreachable remedy is one nobody finds out has stopped
 * being the right one. `_chromium` is host-side only (`@apackdev/testing`'s own spec); the default is the
 * import every caller gets.
 *
 * @internal
 */
export async function _chromium(load: () => Promise<unknown> = () => import('playwright-core')): Promise<ChromiumConnect> {
  let loaded: unknown;
  try {
    loaded = await load();
  } catch {
    throw new Error(INSTALL_PLAYWRIGHT_CORE);
  }
  const connect = (loaded as { chromium?: ChromiumConnect } | null)?.chromium;
  // A module that loaded without one is the same failure as one that did not load: it cannot attach, and
  // the fix is the same install. Reading `connectOverCDP` off `undefined` would say neither
  if (connect === undefined) throw new Error(INSTALL_PLAYWRIGHT_CORE);
  return connect;
}

/** What finding a window needs of a connection: the pages it exposes, and `applicationState` on one. */
export interface AttachTargets {
  contexts: () => readonly { pages: () => readonly { evaluate: (fn: () => unknown) => Promise<unknown>; url: () => string }[] }[];
}

/**
 * The app's main window among the targets the connection exposes.
 *
 * **Never `pages()[0]`.** A connected app had two live targets in the spike — the window and a second one
 * — and which comes first is not something to rely on. The predicate is the fixture's own,
 * `isMainApplicationWindow`: the page whose shell owns the last active surface, which tells it from the splash and
 * from a surface popout.
 *
 * It waits rather than asking once, because a window that is still loading has no `applicationState` yet
 * and a page can appear after the connection does.
 */
export async function findWindow<T extends AttachTargets>(browser: T, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<unknown>();
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (seen.has(page)) continue;
        seen.add(page);
        const has = await page.evaluate(isMainApplicationWindow).catch(() => false);
        if (has) return page as unknown as Page;
      }
    }
    // A page that was loading when it was checked gets looked at again
    seen.clear();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const targets = browser.contexts().flatMap((context) => context.pages().map((page) => page.url()));
  throw new Error(
    `No main window appeared within ${timeoutMs}ms. `
    + (targets.length === 0 ? 'The connection exposed no pages.' : `Saw: ${targets.join(', ')}.`),
  );
}

/**
 * What a failed connect says. Only a refused connection is "no app answered": that is the ordinary miss, a session
 * file outliving the app that wrote it. Anything else happened to an app that did answer — a page closing while
 * Playwright set it up, among them — and saying nobody answered sends whoever reads it to the wrong place.
 */
export function attachFailureMessage(debugPort: number, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED/.test(reason)
    ? `No app answered the debug port ${debugPort}: ${reason}`
    : `Attaching over the debug port ${debugPort} failed: ${reason}`;
}

/**
 * Attaches to an app on `debugPort` and returns its main window.
 *
 * A connection refused is the ordinary case rather than a fault — a session file outlives the app that
 * wrote it — so it is reported as what it is, with the port, for a caller to treat as a miss.
 */
export async function attachToApp({ debugPort, timeoutMs = 15_000 }: AttachOptions): Promise<AttachedApp> {
  const connect = await _chromium();
  let browser: Browser;
  try {
    browser = await connect.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  } catch (error) {
    throw new Error(attachFailureMessage(debugPort, error));
  }
  try {
    const page = await findWindow(browser, timeoutMs);
    return { page, detach: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}
