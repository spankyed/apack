// The cursor default a terminal is given. The settings choose the shape a program's cursor returns to and
// whether it blinks; the broker holds it (`SetCursorDefaults`), so the app's part is to send it at spawn, at
// take-up, and again when the setting changes. Each case reads what the recording broker was sent.
import { afterEach, describe, expect, it } from 'vitest'
import { getTestSettings, resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/recording-broker.ts'
import { cursorDefaultsOf } from '../../../../src/features/code/be/services/terminal.ts'
import { featureSettings } from '#generated/settings.ts'
import { answered } from './_support/answered.ts'
import type { TerminalInfo } from '#features/code/be/types.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

async function openATerminal(app: Awaited<ReturnType<typeof startApp>>) {
  const opened = answered<TerminalInfo>(await app.ask('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { client: WINDOW }))
  await app.settle()
  return opened.id
}

/** The broker's name for the session a terminal was given, which is what the recording names it by */
const sessionOf = (broker: ReturnType<typeof recordingBroker>) => broker.opened[0]!.id

describe('the cursor default a terminal is given', () => {
  afterEach(() => resetTestData())

  it('is a bar whose blink is left to programs when the settings say nothing, or say what is not a blink', () => {
    expect(cursorDefaultsOf(undefined)).toEqual({ style: 'bar', blink: 'program' })
    expect(cursorDefaultsOf({ cursorBlink: 'sometimes' } as never)).toEqual({ style: 'bar', blink: 'program' })
  })

  it('sends the style and the blink the settings chose, each blink as it is', () => {
    expect(cursorDefaultsOf({ cursorStyle: 'underline', cursorBlink: 'off' } as never)).toEqual({ style: 'underline', blink: 'off' })
    expect(cursorDefaultsOf({ cursorStyle: 'block', cursorBlink: 'program' } as never)).toEqual({ style: 'block', blink: 'program' })
    expect(cursorDefaultsOf({ cursorBlink: 'on' } as never)).toEqual({ style: 'bar', blink: 'on' })
  })

  it('is sent to a terminal at spawn, with the settings values', async () => {
    featureSettings.forFeature('code').set({ path: ['cursorStyle'], value: 'underline' })
    featureSettings.forFeature('code').set({ path: ['cursorBlink'], value: 'off' })
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)

    expect(broker.cursors, 'the terminal was given its cursor default once, at spawn').toEqual([
      { id: sessionOf(broker), style: 'underline', blink: 'off' },
    ])
    await app.stop()
  })

  it('sends a blink a person chose as it is, where one left alone is the program\'s', async () => {
    featureSettings.forFeature('code').set({ path: ['cursorBlink'], value: 'on' })
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)

    expect(broker.cursors.at(-1)).toEqual({ id: sessionOf(broker), style: 'bar', blink: 'on' })
    await app.stop()
  })

  it('reaches a terminal that is already open when the setting changes', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code', 'host/settings'] })
    await app.connect()
    await openATerminal(app)
    const before = broker.cursors.length

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: CODE }, path: ['cursorStyle'], value: 'block' }, { settingsAccess: { kind: 'host', service: getTestSettings() } })
    await app.settle()

    expect(broker.cursors.slice(before), 'the open terminal was sent the new style').toContainEqual({ id: sessionOf(broker), style: 'block', blink: 'program' })
    await app.stop()
  })
})
