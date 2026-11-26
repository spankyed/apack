// The brain tracks each running flow by its own RunNode id in `data.flows`, and each flow tracks its running
// steps by their own RunNode ids in `data.steps`, so stopping a flow or the brain tears down every active child.
import { describe, expect, it } from 'vitest'
import { importFlows, startApp } from '@apackdev/testing/harness'
import { entry, keepAlive, on, subflow, transform } from '#generated/flow-helpers.ts'
import { services } from '#generated/services.ts'

const step = (label: string) => transform('return true', { label })

describe('a flow’s spawned children', () => {
  it('are tracked by their own ids, one per flow and step, not collapsed onto a single key', async () => {
    importFlows({
      Outer: {
        root: true,
        tracks: [
          entry([subflow('ChildA')], [subflow('ChildB')], [keepAlive('stay-outer')]),
          on('go', [[step('one'), step('two'), step('three')]]),
        ],
      },
      ChildA: { tracks: [entry([keepAlive('stay-a')])] },
      ChildB: { tracks: [entry([keepAlive('stay-b')])] },
    })
    const app = await startApp({ systems: ['brain'] })

    await app.runFlow('Outer', { event: 'go' })
    await app.settle()

    const snap = app.system('brain').read() as {
      at?: string
      data: { flows?: Record<string, unknown> }
    }
    const flowKeys = Object.keys(snap.data.flows ?? {})
    expect(snap.at).toBe('running.active')
    expect(flowKeys, `flows were ${JSON.stringify(flowKeys)}`).toHaveLength(3)
    expect(flowKeys).not.toContain('undefined')
    expect(new Set(flowKeys).size).toBe(flowKeys.length)

    // Killing the brain stops all active flows and steps cleanly
    await app.send('brain', { type: 'KILL_BRAIN' })
    await app.settle()
    expect(services.runHistory.findRuns().filter((r) => r.status === 'active')).toEqual([])
  })
})
