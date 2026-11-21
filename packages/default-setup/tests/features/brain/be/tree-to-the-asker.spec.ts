// What the brain sends the Brain surface. A run's tree is in the run history, which no view can watch, so a window asks
// for it and the system answers that window alone, with the brain's state beside it for a window just started. The
// brain publishes that state to every window too — whether it runs, is paused, is inspected — and the run's live feed
// (`RUN_NODE_SPAWNED`, `RUN_NODE_UPDATED`) is news for every window; a start alone is announced as one
// (`BRAIN_STARTED`), on which each window asks for the new tree.
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
      const answered = await app.ask('brain', { type: 'REQUEST_SURFACE_DATA' }, { client: MAIN })
      if (!answered.ok) throw new Error(answered.failure.message)
      const { data, state } = answered.value as { data: { runNodeTree: unknown[] }; state: { type: string; rootFlowId?: string } }
      expect(data.runNodeTree.length).toBeGreaterThan(0)
      expect(state, 'the state, not news of a start').toMatchObject({ type: 'BRAIN_STATE', rootFlowId: expect.any(String) })
      await app.settle()
      expect(sent, 'and nothing to any other window').toEqual([])
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
      expect(sent.filter((message) => message.type === 'ASK_ANSWERED'), 'nobody asked for a tree').toEqual([])
      expect(sent.filter((message) => message.type === 'BRAIN_STARTED').map((message) => message.client), 'news of the restart, for every window')
        .toEqual([undefined])
      expect(sent.filter((message) => message.type === 'BRAIN_STATE').map((message) => message.client), 'the published state, for every window')
        .toEqual([undefined])
    } finally { stop() }
  })
})
