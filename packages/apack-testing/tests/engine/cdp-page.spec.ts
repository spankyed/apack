// Finding the app's window among a connection's targets.
//
// **It is here rather than in the E2E attach spec because the E2E one cannot hold it.** `pages()[0]` is the
// right window in this app today, so an end-to-end assertion passes with the predicate replaced by "take
// the first" — measured, by doing exactly that. The thing under test is a choice among several targets, and
// only a fake can present several on purpose.
import { describe, expect, it } from 'vitest';
import { INSTALL_PLAYWRIGHT_CORE, _chromium, attachFailureMessage, findWindow, type AttachTargets } from '../../src/engine/cdp-page.ts';

/** A page that answers the predicate however the test says, and remembers being asked. */
const fakePage = (hasState: boolean | 'throws', url = 'pack://x') => ({
  url: () => url,
  evaluate: async () => {
    if (hasState === 'throws') throw new Error('Execution context was destroyed');
    return hasState;
  },
});

const browser = (...pages: ReturnType<typeof fakePage>[]): AttachTargets =>
  ({ contexts: () => [{ pages: () => pages }] });

describe("finding the window among a connection's targets", () => {
  it('takes the one with applicationState, not the first', async () => {
    const splash = fakePage(false, 'file:///splash.html');
    const main = fakePage(true, 'file:///index.html');
    // The order that makes "take the first" wrong, which is the whole case
    expect(await findWindow(browser(splash, main), 1_000)).toBe(main);
  });

  it('is unmoved by the order', async () => {
    const main = fakePage(true);
    expect(await findWindow(browser(main, fakePage(false)), 1_000)).toBe(main);
  });

  it('treats a page that cannot be evaluated as not it, rather than failing', async () => {
    // A window still loading, or one that navigated mid-check, throws from `evaluate`. That is "not yet",
    // not an error to report: the spike saw two live targets and one of them was transient.
    const main = fakePage(true);
    expect(await findWindow(browser(fakePage('throws'), main), 1_000)).toBe(main);
  });

  it('says what it saw when none of them is the app', async () => {
    const error = await findWindow(browser(fakePage(false, 'file:///splash.html')), 200).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    // The URLs, because "no window appeared" against a connection that exposed two is a different problem
    // from one that exposed none, and the message is the only place a caller can tell them apart
    expect((error as Error).message).toContain('file:///splash.html');
  });

  it('says the connection exposed nothing, where it exposed nothing', async () => {
    const error = await findWindow(browser(), 200).catch((e: Error) => e);
    expect((error as Error).message).toContain('exposed no pages');
  });

  it('waits for a window that is not there yet', async () => {
    const main = fakePage(true);
    let pages: ReturnType<typeof fakePage>[] = [];
    // Arrives after the first poll, which is the ordinary case: a connection can be made before the window
    setTimeout(() => { pages = [main]; }, 150);
    const late: AttachTargets = { contexts: () => [{ pages: () => pages }] };
    expect(await findWindow(late, 2_000)).toBe(main);
  });
});

/**
 * The absent optional peer.
 *
 * **This is the only way these two cases can exist.** `playwright-core` resolves in this checkout, so the
 * install hint is unreachable from any test that does not hand `_chromium` a loader — which is why the
 * loader is a parameter. Written against a hint that had no firing case and so had never been run.
 */
describe('a missing playwright-core', () => {
  it('is reported as the install to run, not as a module-not-found', async () => {
    await expect(_chromium(() => Promise.reject(new Error("Cannot find package 'playwright-core'"))))
      .rejects.toThrow(/npm i -D playwright-core/);
  });

  /**
   * A module that resolved without a `chromium` is the same failure: it cannot attach. Without this the
   * next line reads `connectOverCDP` off `undefined` and the caller gets a TypeError naming neither the
   * package nor the fix.
   */
  it('is reported the same way when the module has no chromium', async () => {
    await expect(_chromium(() => Promise.resolve({}))).rejects.toThrow(INSTALL_PLAYWRIGHT_CORE);
  });

  it('hands back the connect when the module has one', async () => {
    const connectOverCDP = async () => ({}) as never;
    expect(await _chromium(() => Promise.resolve({ chromium: { connectOverCDP } }))).toEqual({ connectOverCDP });
  });
});

describe('a connect that fails', () => {
  it('calls a refused connection a miss, naming the port', () => {
    expect(attachFailureMessage(9222, new Error('connect ECONNREFUSED 127.0.0.1:9222'))).toMatch(/^No app answered the debug port 9222/);
  });

  // The failure that read as a miss: the app answered, and a page it was closing went away while Playwright set it up
  it('does not call a failure after the app answered a miss', () => {
    const said = attachFailureMessage(9222, new Error('browserContext._wrapApiCall: Target page, context or browser has been closed'));
    expect(said).not.toMatch(/No app answered/);
    expect(said).toContain('Target page, context or browser has been closed');
  });
});
