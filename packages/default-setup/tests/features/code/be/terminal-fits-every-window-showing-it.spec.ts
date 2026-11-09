// A pty's grid is the smallest fit of the windows showing it — M2, answered a second time.
//
// A pty has one `(cols, rows)` and emits one stateful stream — the alternate screen, the cursor, the scroll
// regions all live in it — so two windows fitting the same session to their own widths is not a race to
// resolve but a contradiction. The first answer was ownership: the window that opened a terminal sized it
// and every other window's fit was refused.
//
// **That could not survive a reconnect, and a reconnect is ordinary.** The owner was a `client`, which the
// API mints per WebSocket connection, and a window that reloads, sleeps or drops its socket comes back as a
// different connection. Nothing released the old id — the bus has no client-left event — so the terminal
// was owned by a connection that no longer existed, the window that had been sizing it was refused its own
// terminal, and it stayed refused for the life of the API process. Dev reloads do this every time.
//
// So nothing is owned. Every window's fit is recorded against the connection it arrived on, the pty runs at
// the smallest of them, and an entry leaves when its window stops showing the terminal or its connection
// ends. The smallest fit is the one every window can draw whole; a window drawing at a bigger grid would
// draw columns the program cannot write to.
//
// What a window asked for is still not always what it gets, so the announcement half of the old contract is
// unchanged: a grid that moved is news, and a fit that was not honoured is answered to its asker alone.
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'

/** The sizes that reached the pty, without the session they reached — one terminal per case here */
const sizes = (broker: ReturnType<typeof recordingBroker>) =>
  broker.resized.map(({ cols, rows }) => ({ cols, rows }))

/** Every grid the windows were told about, whoever was told */
const announced = (app: Awaited<ReturnType<typeof startApp>>) =>
  app.emitted('code')
    .filter((event) => event.type === 'terminal.RESIZED')
    .map((event) => {
      const { cols, rows } = (event as unknown as { data: { cols: number; rows: number } }).data
      return { cols, rows }
    })

const CODE = 'default-setup/code'
/** Two connections: the API mints one per WebSocket, so two windows are two of these */
const BIG = 'c-big'
const SMALL = 'c-small'

/** A terminal, created by `BIG`, with its id */
async function aTerminal() {
  const broker = recordingBroker()
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: BIG })
  const opened = await app.nextEmit('code', 'terminal.OPENED')
  await app.settle()
  return { broker, app, terminalId: (opened as unknown as { data: { id: string } }).data.id }
}

describe('the grid a terminal runs at', () => {
  it('is the smaller of two windows showing it, whichever fitted first', async () => {
    const { broker, app, terminalId } = await aTerminal()

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.settle()
    // The second window fits its own host and sends what it fitted — a view cannot know it is the second one
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()

    expect(sizes(broker), 'the pty went to the big fit, then down to the one both windows can draw')
      .toEqual([{ cols: 120, rows: 40 }, { cols: 60, rows: 20 }])
    await app.stop()
    resetTestData()
  })

  it('takes each axis from whichever window is smaller on it', async () => {
    // A tall narrow window beside a short wide one: neither fit is the answer, and taking one window's
    // whole grid would leave the other drawing columns or rows the pty does not have
    const { broker, app, terminalId } = await aTerminal()

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 50 },
      { sender: CODE, client: BIG })
    await app.settle()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 200, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()

    expect(sizes(broker).at(-1)).toEqual({ cols: 60, rows: 20 })
    await app.stop()
    resetTestData()
  })

  it('is not held down by a window whose connection has ended', async () => {
    // **The defect this replaced.** The small window goes; the big one is still showing the terminal and
    // has already said what it fits, so the pty grows back to it without anything being asked again
    const { broker, app, terminalId } = await aTerminal()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()

    await app.endConnection(SMALL)

    expect(sizes(broker).at(-1), 'the pty is back at the fit of the window still showing it')
      .toEqual({ cols: 120, rows: 40 })
    expect(announced(app).at(-1), 'and every window was told').toEqual({ cols: 120, rows: 40 })
    await app.stop()
    resetTestData()
  })

  it('lets the same window fit it again after reconnecting as a new connection', async () => {
    // **The case that makes this daily.** A reload, a sleep or a dropped socket brings the same window back
    // as a different `client`. Under ownership that window was refused its own terminal for the life of the
    // process, because nothing could release the id it used to hold
    const { broker, app, terminalId } = await aTerminal()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.settle()

    await app.endConnection(BIG)
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 90, rows: 30 },
      { sender: CODE, client: 'c-big-again' })
    await app.settle()

    expect(sizes(broker).at(-1)).toEqual({ cols: 90, rows: 30 })
    await app.stop()
    resetTestData()
  })

  it('is not held down by a window that has stopped showing it', async () => {
    // **Detaching is not disconnecting**, and leaving this out would have traded one freeze for another: a
    // popped-out window that fitted a terminal small and then switched to a different one would hold every
    // other window to that grid for as long as its connection lived
    const { broker, app, terminalId } = await aTerminal()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()

    await app.send('code', { type: 'terminal.STOPPED_FITTING', terminalId }, { sender: CODE, client: SMALL })
    await app.settle()

    expect(sizes(broker).at(-1)).toEqual({ cols: 120, rows: 40 })
    await app.stop()
    resetTestData()
  })

  it('keeps the size it was created at until a window fits it', async () => {
    // **A size is not a fit.** `CREATE_TERMINAL` carries no grid, so the 80x24 the service defaults to is
    // its own number and not anything a window measured. Recorded as the creating window's fit it would be
    // the smallest one, and so the grid every other window was held to — including a terminal created by an
    // action, whose creator is not a window at all
    const { broker, app, terminalId } = await aTerminal()

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 200, rows: 50 },
      { sender: CODE, client: SMALL })
    await app.settle()

    expect(sizes(broker), 'the first window to fit it is the only constraint there is')
      .toEqual([{ cols: 200, rows: 50 }])
    await app.stop()
    resetTestData()
  })

  it('does not let a resize still in flight write back a grid that has been superseded', async () => {
    // **Two decisions about one pty are in flight together, and they answer in whatever order the broker
    // gets to them.** A fit is a round trip; a window going decides a new grid while that trip is open. If
    // the older answer writes last, `info` describes a size the pty is not running at — which every window
    // is then told, and which the next fit reads as a move.
    const { broker, app, terminalId } = await aTerminal()
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.settle()

    broker.deferResize('broker-1')
    const inFlight = terminalService.resize(terminalId, 50, 15, SMALL)
    // Decided while that one is still open, and it answers first
    await terminalService.forgetClient(SMALL)
    broker.settleResize('broker-1')
    await inFlight

    expect(terminalService.get(terminalId)!.info, 'the grid in force is the one that was decided last')
      .toMatchObject({ cols: 120, rows: 40 })
    await app.stop()
    resetTestData()
  })

  /**
   * **A window renders the accepted grid, so it has to be told what was accepted** (F18).
   *
   * Each window builds its emulator from the `TerminalInfo` it holds, so one that keeps the creation size
   * draws at a grid nothing agreed to. News, because nobody asked and every window needs it.
   */
  it('tells every window the grid the pty is running at', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: BIG })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: BIG })
    await app.nextEmit('code', 'terminal.RESIZED')
    await app.settle()

    expect(announced(app), 'the accepted grid reached the windows').toEqual([{ cols: 120, rows: 40 }])
    await app.stop()
    resetTestData()
  })

  /**
   * **A fit that was not honoured is answered, and is nobody else's business.**
   *
   * A window that asked for 200 columns and got 60 goes on rendering at 200 unless it is told, which is
   * F18. It is a reply rather than news because nothing moved: broadcasting it would tell every other
   * window a thing that had not happened.
   */
  it('answers a window whose fit it did not honour with the grid in force', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: BIG })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    // The small window first, so the big one's fit is the one that changes nothing
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 200, rows: 50 },
      { sender: CODE, client: BIG })
    await app.settle()

    expect(announced(app), "the big window was told the grid in force rather than left believing its own")
      .toEqual([{ cols: 60, rows: 20 }, { cols: 60, rows: 20 }])
    await app.stop()
    resetTestData()
  })

  /**
   * **The case that tells that answer from news**: it is stamped as answering the fit it did not honour.
   *
   * Broadcasting it instead would tell every other window a grid change that had not happened. `answering`
   * is on the envelope rather than the event, so this is the only way a pack test can see which it was.
   */
  it('stamps that answer as answering the fit it did not honour', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: BIG })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: SMALL })
    await app.settle()
    const notHonoured = await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 200, rows: 50 },
      { sender: CODE, client: BIG })

    const answer = await app.nextEmit('code', 'terminal.RESIZED', { answering: notHonoured })

    expect((answer as unknown as { data: { cols: number; rows: number } }).data)
      .toEqual({ terminalId, cols: 60, rows: 20 })
    await app.stop()
    resetTestData()
  })
})
