// What the one bridge between a window and the main process does, asked of the object it hands over.
//
// **Why this package has a suite at all.** It is the narrowest layer in the repo and the only one a
// renderer — and every pack's frontend, which runs in the same window — can reach directly, so a mistake
// here is reachable by code the app did not write. The two claims below are the ones nothing else holds:
// where the API token comes from and that every subscription can be
// undone. Everything else about this module is a list of channels, which `CLAUDE.md` tables and a spec
// could only restate.
import { describe, expect, it, vi } from 'vitest';
import type { contextBridge as Bridge, ipcRenderer as Renderer } from '../tests/electron-stub';

/**
 * The bridge runs its side effect on import and reads `process.argv` as it does, so each case loads it
 * fresh with the arguments it wants to ask about.
 *
 * **The stub comes out of the same fresh registry as the module**, which is the trap `@app/main`'s guide
 * records: `vi.resetModules()` hands the module a new copy of every import, so a stub taken at the top of
 * this file is a different object from the one the bridge just called and every case reads an empty map.
 */
async function load(argv: string[] = []): Promise<{
  api: Record<string, any>;
  bridge: typeof Bridge;
  renderer: typeof Renderer;
}> {
  process.argv = ['electron', 'app', ...argv];
  vi.resetModules();
  const { contextBridge, ipcRenderer } = await import('../tests/electron-stub');
  ipcRenderer.syncAnswers.set('api:token', 'a-token-from-main');
  await import('../src/index.ts');
  return {
    api: contextBridge.exposed.get('electronAPI') as Record<string, any>,
    bridge: contextBridge,
    renderer: ipcRenderer,
  };
}

describe('the API token', () => {
  /**
   * **It is read from main, never from the command line**, and that is the whole of why this case exists:
   * `process.argv` is readable by any process on the machine, so a token passed that way would be a token
   * every other process on the box has. Main sends it over a synchronous channel as the preload loads.
   */
  it('comes from main over api:token', async () => {
    const { api } = await load();

    expect(api.apiToken).toBe('a-token-from-main');
  });

  /** The firing case for that claim: an argument offering one is not where the token comes from. */
  it('is not taken from an argument, however the argument is spelled', async () => {
    const { api } = await load(['--api-token=from-the-command-line', '--apiToken=from-the-command-line']);

    expect(api.apiToken).toBe('a-token-from-main');
  });
});

describe('every subscription', () => {
  /**
   * The guide says each `on*` returns an unsubscribe; this is what holds it. A listener left behind after
   * its component has gone is a leak that only shows as a callback into a dead view — and the two that
   * register *several* listeners for one subscription (`apiStatus.onEvent` takes five channels) are where
   * a partial unsubscribe would hide.
   */
  it('can be undone, and leaves no listener behind', async () => {
    const { api, renderer } = await load();
    const listening = (): number => [...renderer.listeners.values()].reduce((total, each) => total + each.length, 0);
    const subscriptions: [string, () => void][] = [
      ['speechRecognition.onEvent', api.speechRecognition.onEvent(() => {})],
      ['apiStatus.onEvent', api.apiStatus.onEvent(() => {})],
      ['protocolAction.onAction', api.protocolAction.onAction(() => {})],
      ['browser.onTabCreated', api.browser.onTabCreated(() => {})],
      ['browser.onTabRemoved', api.browser.onTabRemoved(() => {})],
      ['browser.onTabUpdated', api.browser.onTabUpdated(() => {})],
      ['browser.onActiveTabChanged', api.browser.onActiveTabChanged(() => {})],
      ['browser.onFocusAddressBar', api.browser.onFocusAddressBar(() => {})],
    ];
    // The subject is not empty, which is the half that keeps failing: a renamed member would otherwise
    // leave this asserting that nothing leaks nothing
    expect(listening()).toBeGreaterThanOrEqual(subscriptions.length);

    for (const [name, unsubscribe] of subscriptions) {
      expect(typeof unsubscribe, name).toBe('function');
      unsubscribe();
    }

    expect(listening()).toBe(0);
  });
});

describe('what reaches the window', () => {
  /**
   * One global, so there is one surface to reason about. A second name exposed here would be a second
   * thing every pack frontend in the window can reach, and nothing outside this file would say so.
   */
  it('is one named object and nothing else', async () => {
    const { bridge } = await load();

    expect([...bridge.exposed.keys()]).toEqual(['electronAPI']);
  });
});
