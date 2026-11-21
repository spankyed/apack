import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Whether the page this runs in is the app's main window, evaluated inside it. The shell
 * (`window.applicationState`) tells a window from the splash; owning the last active surface tells the main window
 * from a surface popout (`?popout=surface`, `packages/renderer/src/main.ts`), which runs the same shell over the one
 * surface it shows. A popout's shell takes `SELECT_SURFACE` and never renders the canvas it names, so a fixture
 * handed one drives a window `navigate` cannot move. One expression, so no helper a bundler adds is left behind
 * when Playwright serializes it into the page.
 */
export const isMainApplicationWindow = (): boolean =>
  (window as unknown as { applicationState?: { getSnapshot(): { context?: { ownsLastActiveSurface?: boolean } } } })
    .applicationState?.getSnapshot().context?.ownsLastActiveSurface === true;

/** The main window; one unresponsive renderer cannot block another window or the discovery deadline. */
export async function waitForApplicationWindow(application: ElectronApplication, timeout: number): Promise<Page> {
  const deadline = performance.now() + timeout;
  const pending = new Set<Page>();
  let found: Page | undefined;
  let stopped = false;
  let wake = () => {};
  try {
    while (performance.now() < deadline) {
      const changed = new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); application.off('window', done); resolve(); };
        const timer = setTimeout(done, Math.min(deadline - performance.now(), 100));
        application.once('window', done);
        wake = done;
      });
      for (const page of application.windows()) {
        if (pending.has(page)) continue;
        pending.add(page);
        void page.evaluate(isMainApplicationWindow)
          .then(ready => {
            if (!stopped && ready && performance.now() < deadline) { found = page; wake(); }
          })
          .catch(() => {})
          .finally(() => pending.delete(page));
      }
      await changed;
      if (found) return found;
    }
    throw Error('Main window with applicationState did not appear within timeout');
  } finally { stopped = true; wake(); }
}
