// What the canvas host does with the attachment the pool hands it.
//
// The pool's own cases cover its bookkeeping over a stand-in view; what they cannot reach is the half that
// lives in a component — a host's lifecycle, and the wiring between the view and the actor that owns the
// pty. Mounted in the code surface's scope, that half is a case rather than a reading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESIZE_SETTLE_MS } from '#features/code/fe/utils/terminal-pool.ts'

vi.mock('apack-terminal-view', async () => (await import('../_support/terminal-view.ts')).viewModule())

const { views, lastView } = await import('../_support/terminal-view.ts')
const { startCodeSurface, terminalInfo } = await import('../_support/terminal-host.ts')
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')
const TerminalView = (await import('#features/code/fe/canvas/TerminalView.vue')).default

let surface: ReturnType<typeof startCodeSurface> | undefined
let next = 0
/** A terminal of this case's own: the pool is a module singleton, so two cases must not share one */
const terminal = () => terminalInfo(`view-${(next += 1)}`)

beforeEach(() => { views.length = 0 })
afterEach(() => {
  vi.useRealTimers()
  surface?.stop()
  surface = undefined
  for (let i = 1; i <= next; i += 1) terminalPool.dispose(`view-${i}`)
  document.body.replaceChildren()
})

describe('the canvas terminal host', () => {
  it('draws the terminal and lets go of it on unmount, leaving its view in the pool', async () => {
    const info = terminal()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await surface.settle()
    const entry = terminalPool.ensure(info)
    expect(surface.root.contains(lastView().element), 'the host is not drawing the terminal').toBe(true)

    surface.unmount()

    // A tab switch unmounts this host; what the pool holds is not the host's to end, and the view
    // outliving it is why coming back to the tab asks for nothing it already has
    expect(entry.attachedContainer, 'the host unmounted still holding the terminal').toBeNull()
    expect(lastView().disposed, 'the view was disposed with the host drawing it').toBe(false)
    expect(lastView().mountedIn, 'a view no host has is still mounted, and so still being sent frames').toBeNull()
    expect(terminalPool.ensure(info), 'the pool lost the terminal').toBe(entry)
  })

  it('tells the terminal that owns the pty what size fits here, once it has settled', async () => {
    vi.useFakeTimers()
    const info = terminal()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await vi.advanceTimersByTimeAsync(0)

    lastView().reportFit(120, 40, 9, 18)
    // A drag reports a fit a frame; the pty hears the one it stopped at
    lastView().reportFit(121, 40, 9, 18)
    lastView().reportFit(122, 41, 9, 18)
    await vi.advanceTimersByTimeAsync(RESIZE_SETTLE_MS)

    const resizes = surface.sent.filter((event) => event.type === 'terminal.RESIZE')
    expect(resizes.at(-1)).toEqual({ type: 'terminal.RESIZE', terminalId: info.id, cols: 122, rows: 41, cellWidth: 9, cellHeight: 18 })
    expect(resizes.length, 'every frame of a drag was sent to the pty').toBeLessThanOrEqual(2)
    // What is typed goes from the view to its session: this host carries no key
    expect(surface.sent.filter((event) => event.type === 'terminal.INPUT')).toEqual([])
  })

  it('paints the flash while the state says the terminal is flashing, and no longer once it does not', async () => {
    const info = terminal()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await surface.settle()
    const container = () => surface!.root.querySelector<HTMLElement>('[data-bell-flash]') ?? null
    expect(container(), 'a terminal not flashing is painted as one').toBeNull()

    await surface.setBells({ [info.id]: 'flashing' })
    expect(container(), 'the flash was not painted').not.toBeNull()
    expect(container()!.classList.contains('bg-neutral-600')).toBe(true)

    // The window that is still open after the flash is not a flash: the state ends it, and the paint follows
    await surface.setBells({ [info.id]: 'quiet' })
    expect(container(), 'the flash was still painted after it ended').toBeNull()
  })

  it('takes no focus when it mounts, and focuses when the surface asks it to', async () => {
    const info = terminal()
    surface = startCodeSurface({ terminals: [info] })
    const view = surface.mount<{ focus(): void }>(TerminalView, { terminalInfo: info })
    await surface.settle()

    // F15. A terminal mounts on a tab switch, a panel drag and an actor replacement, none of which is the
    // user asking for it — and taking focus from what they were typing in is the defect
    expect(lastView().focused, 'mounting took the focus').toBe(0)

    view.value!.focus()

    expect(lastView().focused, 'the surface asked for focus and nothing was focused').toBe(1)
  })

  it('lists the shell\'s commands newest first, highlights one that failed, and copies or runs one again on request', async () => {
    const info = terminal()
    surface = startCodeSurface({ terminals: [info] })
    surface.mount(TerminalView, { terminalInfo: info })
    await surface.settle()
    const view = lastView()
    const command = (id: number, text: string, outcome: object) => ({ id, command: text, cwd: null, startedMs: null, finishedMs: null, outcome, prompt: 0, output: 1, end: 2 })
    view.options.onCommands?.([
      command(1, 'ls', { kind: 'exited', code: 0 }),
      command(2, 'make', { kind: 'exited', code: 2 }),
    ] as never)
    await surface.settle()

    const toggle = surface.root.querySelector<HTMLButtonElement>('[data-testid="command-blocks-toggle"]')
    expect(toggle?.textContent?.trim()).toBe('Commands (2)')
    toggle!.click()
    await surface.settle()

    const rows = [...surface.root.querySelectorAll<HTMLElement>('[data-testid="command-block"]')]
    expect(rows.map((row) => row.querySelector('.font-mono')?.textContent?.trim())).toEqual(['make', 'ls'])
    expect(rows[0]!.dataset.failed, 'a command with a non-zero status is highlighted').toBe('true')
    expect(rows[1]!.dataset.failed).toBeUndefined()

    rows[0]!.querySelectorAll('button')[0]!.click()
    rows[0]!.querySelectorAll('button')[1]!.click()
    await surface.settle()
    expect(view.copiedCommands).toEqual([2])
    expect(view.typed).toEqual(['make\r'])
  })
})
