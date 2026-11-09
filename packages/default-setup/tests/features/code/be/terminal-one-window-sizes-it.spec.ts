// A session has one resize authority, which is M2.
//
// A pty has one `(cols, rows)` and emits one stateful stream — the alternate screen, the cursor, the scroll
// regions all live in it — so two windows fitting the same session to their own widths is not a race to
// resolve but a contradiction: last writer wins and the other window's screen is wrong until something makes
// it fit again. The window that opened a terminal owns its size; a second window observes.
//
// `client` is what makes that checkable. It names the connection a message arrived on, the API stamps it on
// the way in, and nobody can forge it — so the system can tell one window's fit from another's without the
// windows having to say who they are.
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
const OWNER = 'c-owner'
const OBSERVER = 'c-observer'

describe('which window sizes a terminal', () => {
  it('takes the fit of the window that opened it, and ignores a second window\'s', async () => {
    const broker = recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: OWNER })
    await app.settle()
    // The second window fits its own host and sends what it fitted — a view cannot know it is the second one
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: OBSERVER })
    await app.settle()

    expect(sizes(broker), "the observer's fit never reached the pty").toEqual([{ cols: 120, rows: 40 }])
    await app.stop()
    resetTestData()
  })

  it('lets the owner keep sizing it after the observer has tried', async () => {
    const broker = recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: OBSERVER })
    await app.settle()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 100, rows: 30 },
      { sender: CODE, client: OWNER })
    await app.settle()

    // A refusal that stuck would leave the owner unable to resize its own terminal after any observer fit,
    // which is the shape a naive "first writer wins" takes
    expect(sizes(broker)).toEqual([{ cols: 100, rows: 30 }])
    await app.stop()
    resetTestData()
  })

  it('gives a terminal nobody opened to the first window that fits it', async () => {
    // A restored terminal has no owner: the window that opened it is from a previous run. The first fit
    // takes it, which is what makes a restored terminal usable at all rather than stuck at its stored size
    const broker = recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    // What `restoreAll` leaves behind: a live session with no connection owning its size
    const restored = terminalService.get(terminalId)!
    ;(restored as unknown as { sizedBy: string | undefined }).sizedBy = undefined

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 90, rows: 25 },
      { sender: CODE, client: OBSERVER })
    await app.settle()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 70, rows: 15 },
      { sender: CODE, client: OWNER })
    await app.settle()

    expect(sizes(broker), 'the first window to fit it took it, and the other was ignored')
      .toEqual([{ cols: 90, rows: 25 }])
    await app.stop()
    resetTestData()
  })
  /**
   * **A window renders the accepted grid, so it has to be told what was accepted** (F18).
   *
   * The owner's fit moves the pty, which every window showing the terminal needs: each builds its emulator
   * from the `TerminalInfo` it holds, so one that keeps the creation size draws at a grid nothing agreed to.
   * News, because nobody asked and every window needs it.
   */
  it('tells every window the grid the pty is running at', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: OWNER })
    await app.nextEmit('code', 'terminal.RESIZED')
    await app.settle()

    expect(announced(app), 'the accepted grid reached the windows').toEqual([{ cols: 120, rows: 40 }])
    await app.stop()
    resetTestData()
  })

  /**
   * **The refusal is answered, and is nobody else's business.**
   *
   * A second window's fit is ignored, and a window that is not told goes on rendering at the size it asked
   * for — which is the whole of F18. So the asker is told the grid in force. It is a reply rather than news
   * because nothing moved: broadcasting it would tell every other window a thing that had not happened.
   */
  it('answers the window whose fit it refused with the grid in force', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: OWNER })
    await app.settle()
    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: OBSERVER })
    await app.settle()

    expect(announced(app), "the observer was told the owner's grid rather than left believing its own")
      .toEqual([{ cols: 120, rows: 40 }, { cols: 120, rows: 40 }])
    await app.stop()
    resetTestData()
  })

  /**
   * **The case that tells that answer from news**: it is stamped as answering the fit it refused.
   *
   * Broadcasting it instead would tell every other window a grid change that had not happened. `answering`
   * is on the envelope rather than the event, so this is the only way a pack test can see which it was.
   */
  it('stamps that answer as answering the fit it refused', async () => {
    recordingBroker()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: OWNER })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()
    const terminalId = (opened as unknown as { data: { id: string } }).data.id

    await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 120, rows: 40 },
      { sender: CODE, client: OWNER })
    await app.settle()
    const refused = await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId, cols: 60, rows: 20 },
      { sender: CODE, client: OBSERVER })

    const answer = await app.nextEmit('code', 'terminal.RESIZED', { answering: refused })

    expect((answer as unknown as { data: { cols: number; rows: number } }).data)
      .toEqual({ terminalId, cols: 120, rows: 40 })
    await app.stop()
    resetTestData()
  })
})
