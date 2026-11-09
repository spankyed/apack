// What the canvas host does with the attachment the pool hands it.
//
// The pool's own cases cover its bookkeeping over a stand-in emulator; what they cannot reach is the half
// that lives in a component — a host's lifecycle, and the wiring between the emulator and the actor that
// owns the pty. Mounted in the code surface's scope, that half is a case rather than a reading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', async () => ({ Terminal: (await import('../_support/terminal-emulator.ts')).RecordedTerminal }))
vi.mock('@xterm/addon-fit', async () => ({ FitAddon: (await import('../_support/terminal-emulator.ts')).StubAddon }))
vi.mock('@xterm/addon-web-links', async () => ({ WebLinksAddon: (await import('../_support/terminal-emulator.ts')).StubAddon }))
vi.mock('@xterm/addon-unicode11', async () => ({ Unicode11Addon: (await import('../_support/terminal-emulator.ts')).StubAddon }))
vi.mock('@xterm/addon-clipboard', async () => ({ ClipboardAddon: (await import('../_support/terminal-emulator.ts')).StubAddon }))
vi.mock('@xterm/addon-webgl', async () => ({ WebglAddon: (await import('../_support/terminal-emulator.ts')).StubAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const { emulators, lastEmulator, installDomStubs } = await import('../_support/terminal-emulator.ts')
const { startCodeSurface, terminalInfo } = await import('../_support/terminal-host.ts')
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')
const TerminalView = (await import('#features/code/fe/canvas/TerminalView.vue')).default

installDomStubs()

let surface: ReturnType<typeof startCodeSurface> | undefined
let next = 0
/** A session of this case's own: the pool is a module singleton, so two cases must not share one */
const session = () => terminalInfo(`view-${(next += 1)}`)

beforeEach(() => { emulators.length = 0 })
afterEach(() => {
  surface?.stop()
  surface = undefined
  for (let i = 1; i <= next; i += 1) terminalPool.dispose(`view-${i}`)
  document.body.replaceChildren()
})

describe('the canvas terminal host', () => {
  it('draws the terminal and lets go of it on unmount, leaving the session in the pool', async () => {
    const info = session()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await surface.settle()
    const entry = terminalPool.ensure(info, () => {})
    expect(surface.root.contains(entry.wrapper), 'the host is not drawing the terminal').toBe(true)

    surface.unmount()

    // A tab switch unmounts this host; what the pool holds is not the host's to end, and the emulator
    // outliving it is the whole of why a reattach replays nothing
    expect(entry.attachedContainer, 'the host unmounted still holding the terminal').toBeNull()
    expect(lastEmulator().disposed, 'the session was disposed with the host drawing it').toBe(0)
    expect(terminalPool.ensure(info, () => {}), 'the pool lost the session').toBe(entry)
  })

  it('tells the terminal that owns the pty what was typed and what size the emulator settled on', async () => {
    const info = session()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await surface.settle()

    lastEmulator().type('ls\r')
    lastEmulator().resizeTo(120, 40)

    // Two things only this host can do: the pool owns the emulator and the actor owns the pty, and nothing
    // else joins them. A size the pty is never told leaves a shell drawing its line editing at the wrong
    // width, and a keystroke that never leaves the window is a terminal that looks alive and does nothing
    expect(surface.sent).toContainEqual({ type: 'terminal.INPUT', terminalId: info.id, data: 'ls\r' })
    expect(surface.sent).toContainEqual({ type: 'terminal.RESIZE', terminalId: info.id, cols: 120, rows: 40 })
  })

  it('takes no focus when it mounts, and focuses when the surface asks it to', async () => {
    const info = session()
    surface = startCodeSurface({ terminals: [info] })
    const view = surface.mount<{ focus(): void }>(TerminalView, { terminalInfo: info })
    await surface.settle()

    // F15. A terminal mounts on a tab switch, a panel drag and an actor replacement, none of which is the
    // user asking for it — and taking focus from what they were typing in is the defect
    expect(lastEmulator().focused, 'mounting took the focus').toBe(0)

    view.value!.focus()

    expect(lastEmulator().focused, 'the surface asked for focus and nothing was focused').toBe(1)
  })
})
