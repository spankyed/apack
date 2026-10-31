import type { ElectronApplication, Page } from '@playwright/test';

/** Readiness can arrive in an existing window without another Electron window event. */
export async function waitForApplicationWindow(application: ElectronApplication, timeout: number): Promise<Page> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    for (const page of application.windows()) {
      const ready = await page.evaluate(() => !!(window as unknown as { applicationState?: unknown }).applicationState).catch(() => false);
      if (ready) return page;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); application.off('window', done); resolve(); };
      const timer = setTimeout(done, Math.min(remaining, 100));
      application.once('window', done);
    });
  }
  throw Error('Main window with applicationState did not appear within timeout');
}
