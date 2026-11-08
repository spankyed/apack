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
})
