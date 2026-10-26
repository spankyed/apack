// A terminal is announced to every window and opened in one — the backend half of that split.
//
// `code/fe/features/terminal/state.ts`'s spec covers what each window does with the two events; this covers
// which window is sent which. The pair is the same one the flows system makes, and the case that pins it is
// the second: an ask with nobody to answer must produce the news and no answer at all. Swap the `reply` for
// a broadcast and that case fails.
//
// The service is stubbed because creating a terminal spawns a process, and nothing here is about pty.
import { describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  terminalService: {
    create: vi.fn((options: { title?: string }) => ({ id: 't-1', title: options.title ?? 'Terminal', cwd: '/tmp' })),
    onData: vi.fn(),
    onExit: vi.fn(),
    list: vi.fn(() => []),
    updateCwd: vi.fn(),
    close: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
  },
}))
vi.mock('#features/code/be/services/terminal.ts', () => service)

const { startApp } = await import('@apackdev/testing/harness')

const CODE = 'default-setup/code'
/** The connection the ask arrived on, which is what makes it a window's */
const WINDOW = 'c-main'

const sentToCode = (app: Awaited<ReturnType<typeof startApp>>) =>
  app.emitted('code').map((event) => event.type)

describe('creating a terminal', () => {
  it('answers the window that asked, and tells every window separately', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()

    const types = sentToCode(app)
    expect(types, "the news, on which every window asks for its list again").toContain('terminal.CREATED')
    expect(types, 'and the answer, which opens it for the asker alone').toContain('terminal.OPENED')
  })

  // The case that tells a reply from a broadcast: with nobody asking there is news and no answer
  it('still tells every window when nobody asked, and opens it for no one', async () => {
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'two' })
    await app.nextEmit('code', 'terminal.CREATED')
    await app.settle()

    expect(sentToCode(app).filter((type) => type === 'terminal.OPENED'), 'nobody to answer').toEqual([])
  })
})
