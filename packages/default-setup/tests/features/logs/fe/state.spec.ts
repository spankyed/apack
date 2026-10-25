// The logs surface asks for the buffer where a delivery names it: when the shell starts it, and when the settings that
// filter the buffer change — never from its own entry, whose ask could not be answered.
import { beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

const sendToSystem = vi.hoisted(() => vi.fn())
vi.mock('#generated/events.ts', () => ({ sendToSystem }))
const { default: logsState } = await import('#features/logs/fe/state.ts')

const asks = () => sendToSystem.mock.calls.filter(([, event]) => event.type === 'GET_LOGS').length

beforeEach(() => { sendToSystem.mockReset() })

it('asks for the buffer when it starts and when its settings change, and shows what it is answered', () => {
  const actor = createActor(logsState).start()
  expect(asks()).toBe(0)
  actor.send({ type: 'SURFACE_STARTED' })
  expect(asks()).toBe(1)

  actor.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { maxLogs: 10, excludedSources: [] } as never })
  expect(asks()).toBe(2)

  actor.send({ type: 'LOGS_READ', logs: [{ id: 'l1', timestamp: 1, level: 'info', message: 'hello' }], settings: { maxLogs: 10, excludedSources: [] } as never })
  expect(actor.getSnapshot().context.logs.map((log) => log.message)).toEqual(['hello'])
  actor.stop()
})
