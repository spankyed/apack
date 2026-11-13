// What a drop on the canvas terminal does: files insert their quoted paths as a paste, text does nothing, and
// nothing takes focus. The view is the stand-in from `_support`, which records each paste it is handed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('apack-terminal-view', async () => (await import('../_support/terminal-view.ts')).viewModule())

const { views, lastView } = await import('../_support/terminal-view.ts')
const { startCodeSurface, terminalInfo } = await import('../_support/terminal-host.ts')
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')
const TerminalView = (await import('#features/code/fe/canvas/TerminalView.vue')).default

let surface: ReturnType<typeof startCodeSurface> | undefined
let next = 0
const terminal = (shell: string) => terminalInfo(`drop-${(next += 1)}`, { shell })

/** A drag event with the types and files a browser would give it; `files` maps each File to the path the bridge answers */
function dragEvent(type: 'dragover' | 'drop', types: string[], files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } })
  return event
}

let paths: Map<File, string>

beforeEach(() => {
  views.length = 0
  paths = new Map()
  vi.stubGlobal('electronAPI', { fileUtils: { getPathForFile: (file: File) => paths.get(file) ?? '' } })
})
afterEach(() => {
  surface?.stop()
  surface = undefined
  for (let i = 1; i <= next; i += 1) terminalPool.dispose(`drop-${i}`)
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/** Mounts the terminal and returns the element a drop lands on, which is the canvas's own container */
async function mounted(shell: string) {
  const info = terminal(shell)
  surface = startCodeSurface({ terminals: [info] })
  surface.mount(TerminalView, { terminalInfo: info })
  await surface.settle()
  return { view: lastView(), target: lastView().element.parentElement as HTMLElement }
}

describe('dropping files on the canvas terminal', () => {
  it('pastes both files as quoted paths, separated by a space, with no newline', async () => {
    const { view, target } = await mounted('/bin/zsh')
    const a = new File(['a'], 'a.txt')
    const b = new File(['b'], "it's here.md")
    paths.set(a, '/Users/me/My Docs/a.txt')
    paths.set(b, "/Users/me/it's here.md")

    target.dispatchEvent(dragEvent('drop', ['Files'], [a, b]))

    expect(view.pasted).toEqual(["'/Users/me/My Docs/a.txt' '/Users/me/it'\\''s here.md'"])
  })

  it('does not take focus', async () => {
    const { view, target } = await mounted('/bin/zsh')
    const a = new File(['a'], 'a.txt')
    paths.set(a, '/a.txt')
    const before = view.focused

    target.dispatchEvent(dragEvent('drop', ['Files'], [a]))

    expect(view.focused, 'a drop took focus from what the person was doing').toBe(before)
  })

  it('pastes nothing for a drop of text, and leaves the drop to the browser', async () => {
    const { view, target } = await mounted('/bin/zsh')
    const event = dragEvent('drop', ['text/plain'])

    target.dispatchEvent(event)

    expect(view.pasted, 'a text drop pasted something').toEqual([])
    expect(event.defaultPrevented, 'a text drop was taken over from the browser').toBe(false)
  })

  it('pastes nothing on a shell whose quoting is not implemented', async () => {
    const { view, target } = await mounted('cmd.exe')
    const a = new File(['a'], 'a.txt')
    paths.set(a, 'C:\\a.txt')

    target.dispatchEvent(dragEvent('drop', ['Files'], [a]))

    expect(view.pasted).toEqual([])
  })
})

describe('dragging over the canvas terminal', () => {
  it('takes a drag that carries files as a copy', async () => {
    const { target } = await mounted('/bin/zsh')
    const event = dragEvent('dragover', ['Files'])

    target.dispatchEvent(event)

    expect(event.defaultPrevented, 'a file drag was not accepted').toBe(true)
    expect((event as Event & { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy')
  })

  it('does not accept a drag that carries no files', async () => {
    const { target } = await mounted('/bin/zsh')
    const event = dragEvent('dragover', ['text/plain'])

    target.dispatchEvent(event)

    expect(event.defaultPrevented, 'a text drag was accepted as a drop target').toBe(false)
  })
})
