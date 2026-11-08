/**
 * Minimal localStorage for FE code under test.
 *
 * Deliberately not jsdom: the only browser API these tests touch is
 * localStorage, and jsdom installs a TextEncoder whose Uint8Array comes from
 * another realm, which trips esbuild's `encode("") instanceof Uint8Array`
 * invariant during transform and fails collection. That happens before
 * setupFiles run, so it cannot be patched from here.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  // FE code guards browser-only paths with `typeof window === 'undefined'`
  // (e.g. terminalEventBus.prunePersistedOutputs), so window must exist or
  // those paths silently no-op.
  globalThis.window ??= globalThis as unknown as Window & typeof globalThis;
  // And a surface may *listen* on it: the threads surface follows the pointer for as long as it runs, in a
  // child actor. Node's global is not an EventTarget, so without these the invoke throws as the surface
  // starts and every other child of it is lost with the actor — which is how four specs failed at once.
  // Recording nothing: a spec that cares about the listeners spies on them (or runs in jsdom, where this
  // branch is not taken at all).
  const events = new EventTarget();
  globalThis.window.addEventListener ??= events.addEventListener.bind(events);
  globalThis.window.removeEventListener ??= events.removeEventListener.bind(events);
  globalThis.window.dispatchEvent ??= events.dispatchEvent.bind(events);
  globalThis.localStorage = {
    get length() { return store.size; },
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
  } as Storage;
}
// The pack's runtime on the harness: in-memory EARS, systems, services and steps, no app host
import * as path from 'path';
import { setupPackTests } from '@apackdev/testing/harness';
import { contentRuntime } from '../src/__generated__/content-runtime.ts';
import { registration } from '../src/__generated__/pack-entry.ts';
import { setCompiledDir } from '../src/__generated__/appliers.ts';

// Where `apack pack build` writes this pack's compiled content, as the app points the pack module at them. Spelled
// out rather than taken from `PACK_LAYOUT`, which is `@apackdev/host`'s and no pack may import
setCompiledDir(path.resolve(__dirname, '..', 'dist', 'runtime', 'content'));
await setupPackTests({ contentRuntime, registration });
