// A terminal failure reaches the user once, through whoever can show it.
//
// A failed ask is answered to the window that asked, which shows it (the terminal panel's machine keeps it as
// `failure`, `fe/features/terminal/state.ts`), and is told to nobody else. What nobody asked for has no window to
// show it, so it is reported: `reportError` is what reaches the user there, the app turning a system error into a
// toast. Keystrokes are that case, and so is an ask sent with no asker.
//
// **Every case here fails over a terminal that does not exist, which is deliberate: it spawns no process.**
// A backend spec in this pack cannot stub the terminal service — `tests/setup.ts` is a setup file and imports
// `pack-entry.ts`, so the real service is in the module graph before any `vi.mock` in a test file registers.
import { describe, expect, it } from 'vitest'
import { startApp, takeSystemErrors } from '@apackdev/testing/harness'

/** The connection the ask arrived on, which is what makes it a window's */
const WINDOW = 'c-main'

describe('a terminal failure', () => {
  it('refuses the window that asked, which shows it, and is reported to nobody else', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    expect(await app.ask('code', { type: 'terminal.CLOSE_TERMINAL', terminalId: 'gone' }, { client: WINDOW }))
      .toMatchObject({ ok: false, failure: { message: expect.stringContaining('not found') } })
    await app.settle()

    expect(takeSystemErrors(), 'reported as well, the user would be told twice').toEqual([])
    expect(app.emitted('code'), 'and no other window hears of it').toEqual([])
  })

  it('says what failed in the refusal, so two failures are not one message', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    const tab = await app.ask('code', { type: 'terminal.OPEN_TERMINAL_TAB', terminalId: 'gone' }, { client: WINDOW })
    const keep = await app.ask('code', { type: 'terminal.KEEP_TERMINAL', terminalId: 'gone', kept: true }, { client: WINDOW })

    expect(tab).toMatchObject({ ok: false, failure: { message: 'Terminal not found' } })
    expect(keep).toMatchObject({ ok: false, failure: { message: expect.stringContaining('gone') } })
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
