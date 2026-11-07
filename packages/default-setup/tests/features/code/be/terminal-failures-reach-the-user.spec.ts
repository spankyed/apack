// A terminal failure is reported, not only answered.
//
// The surface took `terminal.ERROR` and wrote its message into a context field nothing rendered, so every
// terminal failure was silent — a shell that would not spawn, a terminal already gone, the `maxTerminals`
// limit refusing a create. `reportError` is what reaches the user: the app turns a system error into a toast
// (F9 in the terminal integration review; decision 3 there chose this over a new `HostShell` command, which
// would publish a second way to say the same thing).
//
// **Every case here fails over a terminal that does not exist, which is deliberate: it spawns no process.**
// A backend spec in this pack cannot stub the terminal service — `tests/setup.ts` is a setup file and imports
// `pack-entry.ts`, so the real service is in the module graph before any `vi.mock` in a test file registers.
// The `not found` paths reach `failTerminal` through the same helper every other failure uses.
import { describe, expect, it } from 'vitest'
import { startApp, takeSystemErrors } from '@apackdev/testing/harness'

const CODE = 'default-setup/code'
/** The connection the ask arrived on, which is what makes it a window's */
const WINDOW = 'c-main'

describe('a terminal failure', () => {
  it('is reported to the user, and answered to the window that asked', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.TERMINAL_INPUT', terminalId: 'gone', data: 'ls\n' }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.ERROR')
    await app.settle()

    const reported = takeSystemErrors()
    expect(reported, 'nothing renders terminal.ERROR, so the reply alone tells the user nothing').toHaveLength(1)
    expect(reported[0]).toMatchObject({ source: 'terminal', operation: 'input' })
  })

  it('names the operation that failed, so two failures are not one message', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.OPEN_TERMINAL_TAB', terminalId: 'gone' }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.ERROR')
    await app.settle()

    expect(takeSystemErrors()[0]).toMatchObject({ source: 'terminal', operation: 'open-tab' })
  })

  it('is reported and not broadcast when nobody asked', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.TERMINAL_INPUT', terminalId: 'gone', data: 'ls\n' })
    await app.settle()

    expect(takeSystemErrors(), 'a failure with no asker still reaches the user').toHaveLength(1)
    // An error is not news: broadcasting it raises a toast in every window, including the ones whose user did nothing
    expect(app.emitted('code').map(event => event.type)).not.toContain('terminal.ERROR')
  })
})
