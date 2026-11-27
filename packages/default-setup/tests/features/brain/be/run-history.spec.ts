// The brain's runs in the run history: a session's root and everything it ran stay there after a kill or a restart,
// stopped rather than cleared, and the Brain surface climbs a subflow back to its parent through the history alone
import { describe, expect, it, vi } from 'vitest'
import { importFlows, startApp } from '@apackdev/testing/harness'
import { action, entry, keepAlive, kill, on, subflow, transform } from '#generated/flow-helpers.ts'
import { repository } from '#generated/repository.ts'
import { services } from '#generated/services.ts'
import { reportError } from '@apackdev/sdk/logger'
import type { RunTree } from '@apackdev/sdk/steps'

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

    const answered = await app.ask('brain', { type: 'GO_BACK_RUN_NODE', currentFlowRunNodeId: inner.id }, { client: 'c-main' })
    if (!answered.ok) throw new Error(answered.failure.message)
    const opened = answered.value as { runNodeId: string; data: { flowHierarchy: unknown[] } }
    expect(opened.runNodeId).toBe(sessionRoot()!.id)
    expect(opened.data.flowHierarchy).toHaveLength(1)
  })

  function flattenTree(tree: RunTree): RunTree[] {
    return [tree, ...tree.children.flatMap(flattenTree)]
  }

  it('stops active child steps, non-drained events, and descendant subflows when a subflow is killed', async () => {
    importFlows({
      Outer: { root: true, tracks: [entry([subflow('Inner', { label: 'run inner' })], [keepAlive('stay-outer')])] },
      Inner: {
        tracks: [
          entry([keepAlive('inner-wait')], [subflow('GrandChild', { label: 'run grandchild' })]),
          on('stop-inner', [[kill()]]),
        ],
      },
      GrandChild: { tracks: [entry([keepAlive('grandchild-wait')])] },
    })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()

    const innerBefore = services.runHistory.findRuns().find((r) => r.label === 'run inner' && r.status === 'active')!
    const grandBefore = services.runHistory.findRuns().find((r) => r.label === 'run grandchild' && r.status === 'active')!
    expect(innerBefore).toBeDefined()
    expect(grandBefore).toBeDefined()

    await app.send('brain', { type: 'HANDLE_BRAIN_EVENT', eventType: 'stop-inner', targetFlowId: innerBefore.id })
    await app.settle()

    const innerTree = services.runHistory.tree(innerBefore.id)!
    const allUnderInner = flattenTree(innerTree)
    expect(allUnderInner.filter((n) => n.status === 'active')).toEqual([])
    expect(services.runHistory.get(grandBefore.id)?.status).toBe('stopped')

    const stoppedBroadcasts = app.emitted('brain')
      .flatMap((e) => {
        if (e.type !== 'RUN_NODE_UPDATED') return []
        const update = e.data as { runNodeId?: string; status?: string } | undefined
        return update?.status === 'stopped' && update.runNodeId ? [update.runNodeId] : []
      })
    expect(stoppedBroadcasts).toContain(grandBefore.id)
    const innerWait = allUnderInner.find((n) => n.label === 'inner-wait')!
    const grandWait = allUnderInner.find((n) => n.label === 'grandchild-wait')!
    expect(innerWait.status).toBe('stopped')
    expect(grandWait.status).toBe('stopped')
    expect(stoppedBroadcasts).toContain(innerWait.id)
    expect(stoppedBroadcasts).toContain(grandWait.id)
  })

  it('stops active child steps, non-drained events, and descendant subflows when a subflow finishes early via final: true', async () => {
    importFlows({
      Outer: { root: true, tracks: [entry([subflow('Inner', { label: 'run inner' })], [keepAlive('stay-outer')])] },
      Inner: {
        tracks: [
          entry([keepAlive('inner-wait')], [subflow('GrandChild', { label: 'run grandchild' })]),
          on('finish-inner', [[transform('return { done: true }', { label: 'finish early', final: true })]]),
        ],
      },
      GrandChild: { tracks: [entry([keepAlive('grandchild-wait')])] },
    })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()

    const innerBefore = services.runHistory.findRuns().find((r) => r.label === 'run inner' && r.status === 'active')!
    const grandBefore = services.runHistory.findRuns().find((r) => r.label === 'run grandchild' && r.status === 'active')!
    expect(innerBefore).toBeDefined()
    expect(grandBefore).toBeDefined()

    await app.send('brain', { type: 'HANDLE_BRAIN_EVENT', eventType: 'finish-inner', targetFlowId: innerBefore.id })
    await vi.waitFor(() => {
      expect(services.runHistory.get(innerBefore.id)?.status).toBe('completed')
    })
    await app.settle()

    const innerTree = services.runHistory.tree(innerBefore.id)!
    const allUnderInner = flattenTree(innerTree)
    expect(allUnderInner.filter((n) => n.status === 'active')).toEqual([])
    expect(services.runHistory.get(innerBefore.id)?.status).toBe('completed')
    expect(services.runHistory.get(grandBefore.id)?.status).toBe('stopped')
  })

  it('does not overwrite a stopped RunNode result when a late async action rejects after KILL_BRAIN', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.actionCommands.create({
      label: 'SlowFail',
      actionFn: 'await new Promise((resolve) => setTimeout(resolve, 40)); throw new Error("late boom")',
    })
    importFlows({
      Root: { root: true, tracks: [entry([action('SlowFail', { label: 'slow-fail' })], [keepAlive('stay')])] },
    })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()

    const root = sessionRoot()!
    const stepRun = services.runHistory
      .findChildren(root.id)
      .flatMap((ev) => services.runHistory.findChildren(ev.id))
      .find((n) => n.label === 'slow-fail')!
    expect(stepRun).toBeDefined()

    await app.send('brain', { type: 'KILL_BRAIN' })
    expect(services.runHistory.get(stepRun.id)?.status).toBe('stopped')

    // Simulate late reportError after stopActive()
    reportError({
      error: new Error('late boom'),
      source: 'brain-action',
      step: { phase: 'action.execute', runNodeId: stepRun.id, nodeType: 'action', eventType: 'flow.entry' },
    })

    const after = services.runHistory.get(stepRun.id)
    expect(after?.status).toBe('stopped')
    expect(after && 'result' in after ? after.result : undefined).toBeUndefined()
  })
})
