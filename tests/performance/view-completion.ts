import type { PerformanceWindow } from './window.ts';

/** Installed once in the owned page; all callbacks remain in the renderer's execution context. */
export function installViewCompletion() {
  const win = window as unknown as PerformanceWindow;
  win.__waitForPerformanceView = ({ accept, check: ready, dispatch, errors }) => new Promise<void>((resolve, reject) => {
    const recording = win.__performance;
    let checking = false;
    let delivered = false;
    let finished = false;
    const finish = (failure?: { error: unknown }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      observer.disconnect();
      detach();
      if (failure) reject(failure.error); else resolve();
    };
    const check = async () => {
      if (checking || finished || !delivered) return;
      checking = true;
      try {
        await recording.flushView();
        if (!finished && ready()) finish();
      } catch (error) {
        finish({ error: Error(error instanceof Error && errors.includes(error.message) ? error.message : 'view-correctness') });
      } finally { checking = false; }
    };
    const detach = recording.onView(delivery => {
      if (!accept(delivery)) return;
      delivered = true;
      void check();
    });
    const observer = new MutationObserver(() => { void check(); });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const timeout = setTimeout(() => finish({ error: Error('missing-view-ready') }), 15_000);
    try { dispatch(); } catch (error) { finish({ error }); }
  });
}
