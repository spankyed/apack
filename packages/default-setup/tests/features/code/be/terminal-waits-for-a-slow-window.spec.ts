// A program that writes faster than a window draws is made to wait, rather than buffered by the app.
//
// The host bounds what is in flight to this process; nothing bounded what was then sent on to the windows.
// So each `terminal.OUTPUT` carries where the stream stands, a window answers with how far it has drawn, and
// the session is paused while one is too far behind — which stops its pty being read, so the program blocks
// on its own write. `terminal-flow.spec.ts` has the arithmetic; this is the wiring, through the system.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { OUTPUT_HIGH_WATER } from '#features/code/be/services/terminal-flow.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-window'

async function aTerminal() {
  const broker = recordingBroker()
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
  const opened = await app.nextEmit('code', 'terminal.OPENED')
  await app.settle()
  return { broker, app, terminalId: (opened as unknown as { data: { id: string } }).data.id, session: broker.opened[0]!.id }
}

/** Where the last output sent to the windows said the stream stands */
const lastPosition = (app: Awaited<ReturnType<typeof startApp>>) => {
  const outputs = app.emitted('code').filter((event) => event.type === 'terminal.OUTPUT')
  return (outputs.at(-1) as unknown as { data: { position: number } }).data.position
}

const drew = (app: Awaited<ReturnType<typeof startApp>>, terminalId: string, position: number, client = WINDOW) =>
  app.send('code', { type: 'terminal.OUTPUT_DRAWN', terminalId, position }, { sender: CODE, client })

describe('a window that falls behind a terminal', () => {
  it('pauses the session, and catching up has it read again', async () => {
    const { broker, app, terminalId, session } = await aTerminal()

    broker.emit(session, 'prompt')
    await app.settle()
    expect(lastPosition(app), 'the output did not say where the stream stands').toBe('prompt'.length)
    await drew(app, terminalId, lastPosition(app))
    await app.settle()

    broker.emit(session, 'x'.repeat(OUTPUT_HIGH_WATER + 1))
    await app.settle()
    expect(broker.flow, 'the program was left writing into a window that had stopped keeping up')
      .toEqual([{ id: session, kind: 'pause' }])

    await drew(app, terminalId, lastPosition(app))
    await app.settle()
    expect(broker.flow).toEqual([{ id: session, kind: 'pause' }, { id: session, kind: 'resume' }])
  })

  it('is not waited for once its connection has ended', async () => {
    const { broker, app, terminalId, session } = await aTerminal()
    broker.emit(session, 'prompt')
    await app.settle()
    await drew(app, terminalId, lastPosition(app))
    await app.settle()
    broker.emit(session, 'x'.repeat(OUTPUT_HIGH_WATER + 1))
    await app.settle()

    await app.endConnection(WINDOW)
    await app.settle()

    expect(broker.flow.at(-1), 'a session stayed paused for a window that had gone')
      .toEqual({ id: session, kind: 'resume' })
  })

  it('pauses nothing while no window has answered', async () => {
    const { broker, app, session } = await aTerminal()

    broker.emit(session, 'x'.repeat(OUTPUT_HIGH_WATER * 2))
    await app.settle()

    expect(broker.flow, 'a session was paused with no window to wait for').toEqual([])
  })
})

describe('what a session is told about the window drawing it', () => {
  it('is started with the colours the terminal is drawn in', async () => {
    const { broker } = await aTerminal()

    expect(broker.opened[0]!.options.colors?.background, 'the session was not told its background').toBe('#1e1e1e')
    expect(broker.opened[0]!.options.colors?.ansi).toHaveLength(16)
  })

  it('is told the size of a cell with the grid a window fitted', async () => {
    const { broker, app, terminalId } = await aTerminal()

    await app.send('code',
      { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 100, rows: 30, cellWidth: 9, cellHeight: 18 },
      { sender: CODE, client: WINDOW })
    await app.settle()

    expect(broker.resized.at(-1)).toMatchObject({ cols: 100, rows: 30, cell: { width: 9, height: 18 } })
  })
})
