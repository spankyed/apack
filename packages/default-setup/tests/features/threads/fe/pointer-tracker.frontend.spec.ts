// Who owns the pointer listener this surface needs, and when it is taken back.
//
// A hotkey carries no coordinates, so the quick prompt opens where the pointer was last seen. The listener
// that knows is owned by the surface's root `listen` — never installed at module scope — so importing this
// module touches nothing on `window`, starting the surface attaches one listener without blocking `sys.idle()`,
// and stopping the surface removes it cleanly.
import { expect, it, vi } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import threadsState from '#features/threads/fe/state.ts';

/** The window's listeners, recorded rather than attached, so a case can ask what is left on it */
function recordingWindow() {
  const listening = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const add = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: never) => {
    (listening.get(type) ?? listening.set(type, new Set()).get(type)!).add(listener);
  }) as never);
  const remove = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, listener: never) => {
    listening.get(type)?.delete(listener);
  }) as never);
  return { held: (type: string) => listening.get(type)?.size ?? 0, restore: () => { add.mockRestore(); remove.mockRestore(); } };
}

function startSurface() {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.start('default-setup/threads', threadsState);
  return {
    sys,
    stop: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

/**
 * **Importing the module must install nothing**, and the import has to happen inside the recording for this
 * to be able to say so — a listener attached before the spy is one the spy never sees added *or* removed,
 * and the cases below would still look balanced. So this takes a fresh module registry and imports there.
 */
it('installs nothing by being imported', async () => {
  vi.resetModules();
  const windowListeners = recordingWindow();
  try {
    await import('#features/threads/fe/state.ts');

    expect(windowListeners.held('mousemove'), 'the module itself attached a listener').toBe(0);
  } finally {
    windowListeners.restore();
  }
});

it('follows the pointer while the surface runs without blocking idle, and takes the listener back when it stops', () => {
  const windowListeners = recordingWindow();
  try {
    const running = startSurface();
    expect(windowListeners.held('mousemove'), 'the running surface is following nothing').toBe(1);
    expect(running.sys.idle(), 'a root listen must not block sys.idle()').toBe(true);

    running.stop();

    expect(windowListeners.held('mousemove'), 'a stopped surface left its listener on the window').toBe(0);
  } finally {
    windowListeners.restore();
  }
});

it('leaves one listener per surface, so two windows worth of starts do not accumulate', () => {
  const windowListeners = recordingWindow();
  try {
    const first = startSurface();
    const second = startSurface();
    expect(windowListeners.held('mousemove')).toBe(2);

    first.stop();
    second.stop();

    expect(windowListeners.held('mousemove'), 'stopping both left a listener behind').toBe(0);
  } finally {
    windowListeners.restore();
  }
});
