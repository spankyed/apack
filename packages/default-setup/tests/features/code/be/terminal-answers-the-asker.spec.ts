// A terminal is announced to every window and opened in one — the backend half of that split.
//
// `code/fe/features/terminal/state.ts`'s spec covers what each window does with the two events; this covers
// which window is sent which. The pair is the same one the flows system makes, and the case that pins it is
// the second: an ask with nobody to answer must produce the news and no answer at all. Swap the `reply` for
// a broadcast and that case fails.
//
// The host's terminal service is mocked, so no process is spawned and nothing here is about pty.
import { describe, expect, it } from 'vitest'
import { mockService, startApp } from '@apackdev/testing/harness'

/**
 * **The host's terminal service is what gets mocked, and that is the only thing that works here.**
 *
 * This file used to `vi.mock('#features/code/be/services/terminal.ts')`, which never applied: `tests/setup.ts`
 * is a setup file and imports `pack-entry.ts`, so the pack's modules are in the graph before a test file's
 * mock registers. The mock was inert and this spec spawned a real pty on every run, passing either way.
 * `mockService` overlays the host service the pack reaches through `services`, which is a seam a test can
 * actually take.
 */
const openedWith: Array<{ cols: number; rows: number; shell?: string; cwd?: string }> = []

function mockTerminalSessions() {
  openedWith.length = 0
  let next = 0
  mockService('terminal', {
    open: async (options) => {
      openedWith.push(options)
      next += 1
      const id = `broker-${next}`
      return {
        id,
        pid: 1000 + next,
        write: async () => {},
        resize: async () => {},
        terminate: async () => {},
      }
    },
  })
}

const CODE = 'default-setup/code'
/** The connection the ask arrived on, which is what makes it a window's */
const WINDOW = 'c-main'

const sentToCode = (app: Awaited<ReturnType<typeof startApp>>) =>
  app.emitted('code').map((event) => event.type)

describe('creating a terminal', () => {
  it('answers the window that asked, and tells every window separately', async () => {
    mockTerminalSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()

    const types = sentToCode(app)
    // The mock is live, which the inert `vi.mock` it replaced never was: a real session would have spawned
    expect(openedWith, 'the pack asked the host for a session').toEqual([{ cols: 80, rows: 24, shell: expect.any(String), cwd: expect.any(String) }])
    expect(types, "the news, on which every window asks for its list again").toContain('terminal.CREATED')
    expect(types, 'and the answer, which opens it for the asker alone').toContain('terminal.OPENED')
  })

  // The case that tells a reply from a broadcast: with nobody asking there is news and no answer
  it('still tells every window when nobody asked, and opens it for no one', async () => {
    mockTerminalSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'two' })
    await app.nextEmit('code', 'terminal.CREATED')
    await app.settle()

    expect(sentToCode(app).filter((type) => type === 'terminal.OPENED'), 'nobody to answer').toEqual([])
  })
})
