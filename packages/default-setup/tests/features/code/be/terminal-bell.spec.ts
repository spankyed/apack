// What a terminal's bell carries to the windows: one id per bell, so a notification asked for by several windows for
// the same bell is shown once, and two bells on the same terminal are two notifications.
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/recording-broker.ts'
import { answered } from './_support/answered.ts'
import type { TerminalInfo } from '#features/code/be/types.ts'

const WINDOW = 'c-main'

describe('a bell is identified where it is emitted', () => {
  it('gives each of two bells on the same terminal a different bellId', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const opened = answered<TerminalInfo>(await app.ask('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { client: WINDOW }))
    await app.settle()
    const terminalId = opened.id
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
