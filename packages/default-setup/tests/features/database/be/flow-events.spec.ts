// The run history viewer's events: a flow run's events, a page at a time, newest first, each with what it ran
import { expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { services } from '#generated/services.ts'
import type { RunNodeId } from '@apackdev/sdk/steps'

/** A flow run that heard three events, each running one step */
function aRunThatHeardThree(): { flow: RunNodeId; events: RunNodeId[] } {
  const flow = services.runHistory.start({ kind: 'flow', label: 'Root' }).id
  const events = ['first', 'second', 'third'].map((label) => {
    const event = services.runHistory.start({ kind: 'event', label, eventType: label, triggerType: 'listener', parentId: flow }).id
    services.runHistory.start({ kind: 'step', label: `${label} step`, stepNodeType: 'transform', parentId: event })
    return event
  })
  return { flow, events }
}

type EventsPage = { events: Array<{ id: string; children: Array<{ label: string }> }>; hasMore: boolean; offset: number }

it('pages a run\'s events newest first, each with what it ran, saying when there are more', async () => {
  const { flow, events: [first, second, third] } = aRunThatHeardThree()
  const app = await startApp({ systems: ['database'] })
  await app.connect()

  // Asked as the surface asks: a fetch is answered to its asker, and nobody else
  const asked = { client: 'c-main' }
  const page = async (offset: number) => {
    const outcome = await app.ask('database', { type: 'GET_FLOW_EVENTS', flowId: flow, offset, limit: 2 }, asked)
    if (!outcome.ok) throw new Error(outcome.failure.message)
    return outcome.value as EventsPage
  }
  const one = await page(0)
  expect(one.events.map((event) => event.id)).toEqual([third, second])
  expect(one.events[0].children.map((child) => child.label)).toEqual(['third step'])
  expect(one.hasMore).toBe(true)

  const two = await page(2)
  expect(two.events.map((event) => event.id)).toEqual([first])
  expect(two.hasMore).toBe(false)
})
