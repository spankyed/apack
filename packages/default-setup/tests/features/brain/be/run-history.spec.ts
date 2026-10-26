// The brain's runs in the run history: a session's root and everything it ran stay there after a kill or a restart,
// stopped rather than cleared, and the Brain surface climbs a subflow back to its parent through the history alone
import { describe, expect, it } from 'vitest'
import { importFlows, startApp } from '@apackdev/testing/harness'
import { entry, keepAlive, on, subflow, transform } from '#generated/flow-helpers.ts'
import { services } from '#generated/services.ts'

const step = (label: string) => transform('return true', { label })

/** The session's root run: the root the brain started, still running */
const sessionRoot = () => services.runHistory.findRuns().find((run) => run.parentId === undefined && run.status === 'active')

describe('the brain in the run history', () => {
  it('stops what a kill ends, and keeps it', async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive('waiting')])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const root = sessionRoot()!
    const waiting = services.runHistory.findChildren(root.id).flatMap((event) => services.runHistory.findChildren(event.id))

    await app.send('brain', { type: 'KILL_BRAIN' })

    expect(services.runHistory.get(root.id)?.status).toBe('stopped')
    expect(waiting.map((node) => services.runHistory.get(node.id)?.status)).toEqual(['stopped'])
    expect(sessionRoot()).toBeUndefined()
  })

  it('starts a new root on a restart, and stops the one before it', async () => {
    importFlows({ Root: { root: true, tracks: [entry([keepAlive()])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    const first = sessionRoot()!

    await app.send('brain', { type: 'RESTART_BRAIN' })
    await app.settle()

    const second = sessionRoot()!
    expect(second.id).not.toBe(first.id)
    expect(services.runHistory.get(first.id)?.status).toBe('stopped')
    expect(second.flowId).toBe(first.flowId)
  })

  it('goes back from a subflow to the flow that ran it', async () => {
    importFlows({
      Outer: { root: true, tracks: [on('go', [[subflow('Inner', { label: 'run inner' })]])] },
      Inner: { tracks: [entry([keepAlive()]), on('ping', [[step('pong')]])] },
    })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    await app.runFlow('Outer', { event: 'go' })
    const inner = services.runHistory.findRuns().find((run) => run.parentId !== undefined && run.kind === 'flow')!

    const call = await app.send('brain', { type: 'GO_BACK_RUN_NODE', currentFlowRunNodeId: inner.id }, { sender: 'default-setup/brain', client: 'c-main' })

    const opened = await app.nextEmit('brain', 'RUN_NODE_OPENED', { answering: call }) as unknown as { runNodeId: string; data: { flowHierarchy: unknown[] } }
    expect(opened.runNodeId).toBe(sessionRoot()!.id)
    expect(opened.data.flowHierarchy).toHaveLength(1)
  })
})
