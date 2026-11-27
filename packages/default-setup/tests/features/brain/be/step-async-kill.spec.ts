// Async step self-kill safety: when an async step calls ctx.runtime.killFlow(ctx.flowRunNodeId)
// after an await and immediately sends COMPLETE, stepState defers the kill so the step's RunNode
// finishes cleanly as 'completed' rather than being aborted mid-settlement.
import { describe, expect, it } from 'vitest'
import { system } from '@apackdev/state'
import { defectGuard } from '@apackdev/state/testing'
import { testPacks } from '@apackdev/sdk/testing'
import { state } from '#generated/state.ts'
import { services } from '#generated/services.ts'
import { stepState } from '#features/brain/be/step-system.ts'

describe('stepState async self-kill safety', () => {
  it('completes the killing step RunNode cleanly when killFlow(flowRunNodeId) is called after await before COMPLETE', async () => {
    const flowNode = services.runHistory.start({ kind: 'flow', label: 'AsyncKillFlow' })
    const eventNode = services.runHistory.start({
      kind: 'event',
      label: 'go',
      eventType: 'go',
      triggerType: 'listener',
      parentId: flowNode.id,
    })
    const stepNode = services.runHistory.start({
      kind: 'step',
      label: 'async killer',
      stepNodeType: 'kill',
      parentId: eventNode.id,
    })

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    testPacks.steps.set('kill', {
      type: 'kill',
      runtime: {
        isAsync: true,
        handler: async (_input, _node, ctx, actor: any) => {
          await gate
          ctx.runtime.killFlow(ctx.flowRunNodeId)
          actor.send({ type: 'COMPLETE', result: { clean: true } })
        },
      },
    })

    const reports: unknown[] = []
    const guard = defectGuard()
    const sys = system({ side: 'backend', onDefect: guard.onDefect })
    sys.attach({
      tell: () => {},
      ask: () => () => {},
      follow: (_feature, _view, _args, _updated, failed) => {
        failed({ kind: 'unavailable', message: 'not used' })
        return { stop: () => {} }
      },
    })

    const host = state<{ starts: { step: typeof stepState } }, any>()({
      starts: (start) => ({
        step: start(stepState, {
          given: () => ({
            spec: {
              runNodeId: stepNode.id,
              flowRunNodeId: flowNode.id,
              step: { id: 'Node-async-kill' as never, nodeType: 'kill', label: 'async killer' } as never,
              input: { runNodeId: stepNode.id, settings: {}, params: {} },
              eventRunNodeId: eventNode.id,
              event: { type: 'go', data: {}, timestamp: Date.now() },
              steps: [],
            },
          }),
        }),
      }),
      on: {
        STEP_COMPLETED: (ev: unknown) => { reports.push(ev) },
        KILL_FLOW: (ev: unknown) => { reports.push(ev) },
      },
    })

    try {
      sys.start('test/step-host', host)
      release()
      await sys.idle()

      expect(services.runHistory.get(stepNode.id)).toMatchObject({
        status: 'completed',
        result: { clean: true },
      })
      expect(reports).toEqual([
        expect.objectContaining({
          type: 'STEP_COMPLETED',
          runNodeId: stepNode.id,
          killFlowId: flowNode.id,
        }),
      ])
      guard.assertNone()
    } finally {
      testPacks.steps.delete('kill')
      sys.stop()
      guard[Symbol.dispose]()
    }
  })
})
