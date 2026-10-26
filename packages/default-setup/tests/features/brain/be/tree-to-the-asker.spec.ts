// What the brain sends the Brain surface. A run's tree is in the run history, which no view can watch, so a window asks
// for it and the system answers that window alone, with the brain's state beside it for a window just started. The
// brain's state is news for every window — whether it runs, is paused, is inspected — and so is the run's live feed
// (`RUN_NODE_SPAWNED`, `RUN_NODE_UPDATED`); a run starting again is announced, and each window asks for the new tree.
import { describe, expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { importFlows, startApp } from '@apackdev/testing/harness'
import { entry, keepAlive } from '#generated/flow-helpers.ts'

const BRAIN = 'default-setup/brain'
const MAIN = 'c-main'

/** Every message the bus carried to the Brain surface, with the connection it was addressed to */
function recording() {
  const sent: Array<{ type: string; client?: string }> = []
  const stop = testRootEvents.onSurfaceSend((message) => {
    if (message.to === BRAIN) sent.push({ type: message.event.type, client: message.client })
  })
  return { sent, stop }
}

describe('the Brain surface', () => {
  it("is answered its run's tree, with the brain's state, and no other window is", async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive()])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const { sent, stop } = recording()
    try {
      const call = await app.send('brain', { type: 'REQUEST_SURFACE_DATA' }, { sender: BRAIN, client: MAIN })
      const tree = await app.nextEmit('brain', 'RECEIVE_SURFACE_DATA', { answering: call }) as unknown as { data: { runNodeTree: unknown[] } }
      expect(tree.data.runNodeTree.length).toBeGreaterThan(0)
      await app.settle()
      expect(sent.map((message) => message.type)).toEqual(['RECEIVE_SURFACE_DATA', 'BRAIN_STARTED', 'INSPECT_TOGGLED'])
      expect(sent.every((message) => message.client === MAIN), 'all of it to the window that asked').toBe(true)
    } finally { stop() }
  })

  it("announces a restart to every window, without the tree, and publishes the brain's state without it", async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive()])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const { sent, stop } = recording()
    try {
      await app.send('brain', { type: 'RESTART_BRAIN' })
      await app.send('brain', { type: 'SEND_STATE' })
      await app.settle()
      expect(sent.filter((message) => message.type === 'RECEIVE_SURFACE_DATA'), 'nobody asked for a tree').toEqual([])
      expect(sent.filter((message) => message.type === 'BRAIN_STARTED').map((message) => message.client), 'news for every window')
        .toEqual([undefined, undefined])
    } finally { stop() }
  })
})
