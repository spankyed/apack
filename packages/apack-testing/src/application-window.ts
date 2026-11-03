import type { ElectronApplication, Page } from '@playwright/test';

/** One unresponsive renderer cannot block another window or the discovery deadline. */
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
        void page.evaluate(() => !!(window as unknown as { applicationState?: unknown }).applicationState)
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
