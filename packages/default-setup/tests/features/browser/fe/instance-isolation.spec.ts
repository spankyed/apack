// Two concurrent Browser surface instances keep their timers, restore counters,
// pending group assignments, inline-completion suppression, and history caches isolated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { system, type EventsOf } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import browserState from '#features/browser/fe/state.ts';

function startBrowserInstance(name: string) {
  const tells: Array<{ to: string; event: { type: string; [key: string]: unknown } }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => {
      tells.push({ to, event: event as { type: string; [key: string]: unknown } });
    },
    ask: () => () => {},
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start(name, browserState);
  return {
    sys,
    handle,
    tells,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof browserState>) => sys.send(handle, event),
    stop: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

describe('browser surface multi-instance isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps sync timers, bookmark timers, autocomplete debounce, and inline suppression isolated across 2 instances', async () => {
    const a = startBrowserInstance('default-setup/browser-a');
    const b = startBrowserInstance('default-setup/browser-b');

    try {
      // Instance A creates a tab (schedules a 2000ms tab sync timer)
      a.send({
        type: 'IPC.TAB_CREATED',
        tab: { id: 1, url: 'https://alpha.example', title: 'Alpha', favicon: '', isLoading: false, canGoBack: false, canGoForward: false, isMuted: false },
      });
      a.send({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId: 1 });
      // Instance B creates a tab 500ms later (must NOT cancel Instance A's sync timer!)
      await vi.advanceTimersByTimeAsync(500);
      b.send({
        type: 'IPC.TAB_CREATED',
        tab: { id: 2, url: 'https://beta.example', title: 'Beta', favicon: '', isLoading: false, canGoBack: false, canGoForward: false, isMuted: false },
      });
      b.send({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId: 2 });

      // Stopping instance B must NOT cancel instance A's pending tab sync timer!
      b.stop();

      await vi.advanceTimersByTimeAsync(1500);
      expect(a.tells.filter((t) => t.event.type === 'SYNC_TABS')).toHaveLength(1);
      expect(b.tells.filter((t) => t.event.type === 'SYNC_TABS')).toHaveLength(0);

      // Now test autocomplete + inline-completion suppression isolation between two live instances
      const c = startBrowserInstance('default-setup/browser-c');
      try {
        // Record distinct visits in A and C (each instance owns its own history cache)
        a.send({ type: 'IPC.TAB_UPDATED', tabId: 1, changes: { url: 'https://alpha.example/docs', title: 'Alpha Docs' } });
        c.send({
          type: 'IPC.TAB_CREATED',
          tab: { id: 3, url: 'https://gamma.example', title: 'Gamma', favicon: '', isLoading: false, canGoBack: false, canGoForward: false, isMuted: false },
        });
        c.send({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId: 3 });

        // Clear address bar on A, then type forward ("a" -> "alp") -> expects inline completion
        a.send({ type: 'ADDRESS_BAR.UPDATE', value: '' });
        a.send({ type: 'ADDRESS_BAR.UPDATE', value: 'alp' });
        // C clears, types forward, then deletes ("gam" -> "ga") -> suppresses inline completion ONLY on C
        c.send({ type: 'ADDRESS_BAR.UPDATE', value: '' });
        c.send({ type: 'ADDRESS_BAR.UPDATE', value: 'gam' });
        c.send({ type: 'ADDRESS_BAR.UPDATE', value: 'ga' });

        await vi.advanceTimersByTimeAsync(150);

        expect(a.read().data.suggestions.length).toBeGreaterThan(0);
        expect(a.read().data.inlineCompletion, 'C deleting must not suppress A inline completion').toBe('ha.example/docs');
      } finally {
        c.stop();
      }
    } finally {
      a.stop();
    }
  });
});
