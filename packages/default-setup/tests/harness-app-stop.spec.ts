// What the brain keeps outside its actors (cron jobs, ad-hoc listeners, the flow actor registry) goes when the pack's
// backend stops: default-setup's boot.onShutdown clears it, and @apackdev/testing runs it when a test's last app stops
// (the harness stops apps after each test), so a real schedule from one test never ticks into the next
//
// @slow: the wait is the assertion
// It starts and stops real pack backends and then waits to prove a cron schedule does *not* tick into the
// next test; shortening the wait removes what the test checks.
import { describe, expect, it, vi } from 'vitest'
import { importFlows, startApp, type TestApp } from '@apackdev/testing/harness'
import { settles, testRootEvents } from '@apackdev/sdk/testing'
import { action, schedule } from '#generated/flow-helpers.ts'
import { repository } from '#generated/repository.ts'
import { onShutdown } from '#features/hooks.ts'
import { registerSchedule } from '#features/brain/be/services/scheduler.ts'
import { listen, notify } from '#features/brain/be/services/brain.ts'
import { getAllFlowActorIds } from '#features/brain/be/flow-system.ts'

const EVERY_SECOND = '* * * * * *'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("default-setup's onShutdown", () => {
  it('stops cron jobs and removes ad-hoc brain listeners', async () => {
    const tick = vi.fn()
    const heard = vi.fn()
    registerSchedule('shutdown-test:job', EVERY_SECOND, tick)
    listen('shutdown.test', heard)

    onShutdown()

    notify('shutdown.test')
    await wait(1_500)
    expect(tick).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('a real schedule', () => {
  // An action step, which has a runtime handler: its run node completes only once the brain ran it
  const startEverySecond = async () => {
    repository.actionCommands.create({ label: 'Tick', actionFn: 'return { ticked: true }' })
    importFlows({ 'Every Second': { root: true, tracks: [schedule(EVERY_SECOND, [[action('Tick', { label: 'tick' })]])] } })
    const app = await startApp({ systems: ['brain'] })
    await app.connect()
    return app
  }
  const ranTick = (app: TestApp) => expect(app.flowSteps('Every Second')).toContainEqual(expect.objectContaining({ label: 'tick', status: 'completed', result: { ticked: true } }))

  it("doesn't tick once its app stopped, as the harness stops it after each test", async () => {
    const app = await startEverySecond()
    await settles(() => ranTick(app))
    // from the app running, so the empty list after stopping means stopped rather than never started
    expect(getAllFlowActorIds()).not.toEqual([])

    app.stop()

    const ticks: unknown[] = []
    const unsubscribe = testRootEvents.onIncoming(({ event }) => {
      if (event.type === 'TRIGGER_BRAIN_EVENT') ticks.push(event)
    })
    try {
      await wait(2_200)
    } finally {
      unsubscribe()
    }
    expect(ticks).toEqual([])
    expect(getAllFlowActorIds()).toEqual([])
  })
})
