// The logs surface asks for the buffer where a delivery names it: when the shell starts it, and when the settings that
// filter the buffer change — never from its own entry, whose ask could not be answered.
import { beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

/** The reads of the buffer the machine has asked for, each answered by the spec */
const reads = vi.hoisted(() => [] as Array<(outcome: unknown) => void>)
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate')
  return {
    tell: vi.fn(),
    fromAsk: (_to: string, _type: string) => fromPromise(() => new Promise((resolve) => { reads.push(resolve) })),
  }
})
const { default: logsState } = await import('#features/logs/fe/state.ts')

beforeEach(() => { reads.length = 0 })

it('asks for the buffer when it starts and when its settings change, and shows what it is answered', async () => {
  const actor = createActor(logsState).start()
  expect(reads).toHaveLength(0)
  actor.send({ type: 'SURFACE_STARTED', ownsAppLayout: true })
  expect(reads).toHaveLength(1)

  actor.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { maxLogs: 10, excludedSources: [] } as never })
  expect(reads).toHaveLength(2)

  reads[1]({ ok: true, value: { logs: [{ id: 'l1', timestamp: 1, level: 'info', message: 'hello' }], settings: { maxLogs: 10, excludedSources: [] } } })
  await vi.waitFor(() => expect(actor.getSnapshot().context.logs.map((log) => log.message)).toEqual(['hello']))
  actor.stop()
})
