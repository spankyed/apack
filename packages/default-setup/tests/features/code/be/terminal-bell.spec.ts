// What a terminal's bell carries to the windows: one id per bell, so a notification asked for by several windows for
// the same bell is shown once, and two bells on the same terminal are two notifications.
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

describe('a bell is identified where it is emitted', () => {
  it('gives each of two bells on the same terminal a different bellId', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id
    const session = broker.opened[0]!.id

    broker.happens(session, { kind: 'bell' })
    broker.happens(session, { kind: 'bell' })
    await app.settle()

    const bells = app.emitted('code').filter(event => event.type === 'terminal.BELL')
      .map(event => (event as unknown as { data: { terminalId: string; bellId: string } }).data)
    expect(bells).toHaveLength(2)
    expect(bells.map(bell => bell.terminalId)).toEqual([terminalId, terminalId])
    expect(bells[0]!.bellId).not.toEqual(bells[1]!.bellId)
    await app.stop()
    resetTestData()
  })
})
