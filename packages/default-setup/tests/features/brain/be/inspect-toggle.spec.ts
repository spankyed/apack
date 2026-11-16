// Inspect mode is a setting of the brain feature, not of a run: it toggles whether a flow is running, stopped or was
// never started, and every window hears what it became (`INSPECT_TOGGLED`), which is how the Brain surface's panel
// shows beside a surface that has none
import { describe, expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { importFlows, startApp } from '@apackdev/testing/harness'
import { entry, keepAlive } from '#generated/flow-helpers.ts'

const BRAIN = 'default-setup/brain'

/** Each `enabled` the bus carried to the Brain surface as `INSPECT_TOGGLED` */
function toggles() {
  const enabled: boolean[] = []
  const stop = testRootEvents.onSurfaceSend((message) => {
    if (message.to === BRAIN && message.event.type === 'INSPECT_TOGGLED') enabled.push(message.event.enabled as boolean)
  })
  return { enabled, stop }
}

async function toggledTwice(app: Awaited<ReturnType<typeof startApp>>): Promise<boolean[]> {
  const { enabled, stop } = toggles()
  try {
    await app.send('brain', { type: 'TOGGLE_INSPECT' })
    await app.settle()
    await app.send('brain', { type: 'TOGGLE_INSPECT' })
    await app.settle()
    return enabled
  } finally { stop() }
}

describe('inspect mode', () => {
  it('toggles while a flow runs', async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive()])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const [first, second] = await toggledTwice(app)
    expect(first, 'heard the first toggle').toBeTypeOf('boolean')
    expect(second).toBe(!first)
  })

  it('toggles with no flow to run, where the brain is stopped from the start', async () => {
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const [first, second] = await toggledTwice(app)
    expect(first, 'heard the first toggle').toBeTypeOf('boolean')
    expect(second).toBe(!first)
  })

  it('toggles after the brain is killed', async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive()])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    await app.send('brain', { type: 'KILL_BRAIN' })
    await app.settle()
    const [first, second] = await toggledTwice(app)
    expect(first, 'heard the first toggle').toBeTypeOf('boolean')
    expect(second).toBe(!first)
  })
})
