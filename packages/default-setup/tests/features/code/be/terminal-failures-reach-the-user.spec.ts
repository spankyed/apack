// A terminal failure is reported, not only refused.
//
// A refusal settles the window's ask and shows nothing, so on its own every terminal failure is silent — a shell
// that would not spawn, a terminal already gone, the `maxTerminals` limit refusing a create. `reportError` is what reaches the user: the app turns a system error into a toast
// (F9 in the terminal integration review; decision 3 there chose this over a new `HostShell` command, which
// would publish a second way to say the same thing).
//
// **Every case here fails over a terminal that does not exist, which is deliberate: it spawns no process.**
// A backend spec in this pack cannot stub the terminal service — `tests/setup.ts` is a setup file and imports
// `pack-entry.ts`, so the real service is in the module graph before any `vi.mock` in a test file registers.
// The `not found` paths reach `failTerminal` through the same helper every other failure uses.
import { describe, expect, it } from 'vitest'
import { startApp, takeSystemErrors } from '@apackdev/testing/harness'

/** The connection the ask arrived on, which is what makes it a window's */
const WINDOW = 'c-main'

describe('a terminal failure', () => {
  it('is reported to the user, and refuses the window that asked', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    expect(await app.ask('code', { type: 'terminal.CLOSE_TERMINAL', terminalId: 'gone' }, { client: WINDOW }))
      .toMatchObject({ ok: false, failure: { message: expect.stringContaining('not found') } })
    await app.settle()

    const reported = takeSystemErrors()
    expect(reported, 'a refusal is shown by nothing, so it alone tells the user nothing').toHaveLength(1)
    expect(reported[0]).toMatchObject({ source: 'terminal', operation: 'close' })
  })

  it('names the operation that failed, so two failures are not one message', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    expect(await app.ask('code', { type: 'terminal.OPEN_TERMINAL_TAB', terminalId: 'gone' }, { client: WINDOW })).toMatchObject({ ok: false })
    await app.settle()

    expect(takeSystemErrors()[0]).toMatchObject({ source: 'terminal', operation: 'open-tab' })
  })

  // Keystrokes are answered by nothing: there are too many of them, and a terminal that is not there is the user's to hear of
  it('is reported for input that went to no terminal', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.TERMINAL_INPUT', terminalId: 'gone', data: 'ls\n' }, { client: WINDOW })
    await app.settle()

    const reported = takeSystemErrors()
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({ source: 'terminal', operation: 'input' })
    expect(app.emitted('code'), 'and nothing is sent to any window').toEqual([])
  })

  it('is reported once and not broadcast when nobody asked', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.OPEN_TERMINAL_TAB', terminalId: 'gone' })
    await app.settle()

    expect(takeSystemErrors(), 'a failure with no asker still reaches the user, once').toHaveLength(1)
    // An error is not news: broadcasting it raises a toast in every window, including the ones whose user did nothing
    expect(app.emitted('code')).toEqual([])
  })
})
