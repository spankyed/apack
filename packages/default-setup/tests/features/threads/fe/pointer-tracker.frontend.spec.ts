// Who owns the pointer listener this surface needs, and when it is taken back.
//
// A hotkey carries no coordinates, so the quick prompt opens where the pointer was last seen. The listener
// that knows was added at module scope: never removed, so every replacement of this pack's frontend left
// another one behind writing into a module nothing could still reach, and it touched `window` at *import*,
// which is why a pure helper of `state.ts` had to be split into its own file before a test could import it.
import { afterAll, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import threadsState from '#features/threads/fe/state.ts'

afterAll(startFeTestRuntime({ client: { send() {}, watchView: () => () => {} } }))

/** The window's listeners, recorded rather than attached, so a case can ask what is left on it */
function recordingWindow() {
  const listening = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const add = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: never) => {
    (listening.get(type) ?? listening.set(type, new Set()).get(type)!).add(listener)
  }) as never)
  const remove = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, listener: never) => {
    listening.get(type)?.delete(listener)
  }) as never)
  return { held: (type: string) => listening.get(type)?.size ?? 0, restore: () => { add.mockRestore(); remove.mockRestore() } }
}

/**
 * **Importing the module must install nothing**, and the import has to happen inside the recording for this
 * to be able to say so — a listener attached before the spy is one the spy never sees added *or* removed,
 * and the cases below would still look balanced. So this takes a fresh module registry and imports there.
 *
 * Put the listener back at module scope and this is the case that fails; the two below do not.
 */
it('installs nothing by being imported', async () => {
  vi.resetModules()
  const windowListeners = recordingWindow()
  try {
    await import('#features/threads/fe/state.ts')

    expect(windowListeners.held('mousemove'), 'the module itself attached a listener').toBe(0)
  } finally {
    windowListeners.restore()
  }
})

it('follows the pointer while the surface runs, and takes the listener back when it stops', () => {
  const windowListeners = recordingWindow()
  try {
    const actor = createActor(threadsState).start()
    expect(windowListeners.held('mousemove'), 'the running surface is following nothing').toBe(1)

    actor.stop()

    expect(windowListeners.held('mousemove'), 'a stopped surface left its listener on the window').toBe(0)
  } finally {
    windowListeners.restore()
  }
})

it('leaves one listener per surface, so two windows worth of starts do not accumulate', () => {
  const windowListeners = recordingWindow()
  try {
    const first = createActor(threadsState).start()
    const second = createActor(threadsState).start()
    expect(windowListeners.held('mousemove')).toBe(2)

    first.stop()
    second.stop()

    expect(windowListeners.held('mousemove'), 'stopping both left a listener behind').toBe(0)
  } finally {
    windowListeners.restore()
  }
})
