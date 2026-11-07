// One session, one attached host, one input registration, one scroll policy.
//
// F1 and F2 are the two halves of not having that. `detach` took the wrapper out of whichever host held it, so
// during a remount — where the new host attaches before the old one unmounts — the live host went blank. And the
// panel scrolled to the bottom on every write while the canvas honoured pinning, so the same terminal jumped
// under the user in one host and not in the other.
//
// xterm needs a canvas and a GL context jsdom does not have, so the emulator is a stand-in. What is under test
// is the pool's bookkeeping over it: which host holds the wrapper, how many times input is wired, and where the
// pin state lives. Nothing here asserts anything about how xterm draws.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const onDataHandlers: Array<(data: string) => void> = []
const keyHandlers: Array<(event: KeyboardEvent) => boolean> = []
const pasted: string[] = []
const written: string[] = []
let focused = 0

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    element = document.createElement('div')
    cols = 80
    rows = 24
    unicode = { activeVersion: '6' }
    loadAddon() {}
    open(host: HTMLElement) { host.appendChild(this.element) }
    write(data: string, done?: () => void) { written.push(data); done?.() }
    paste(data: string) { pasted.push(data) }
    onData(handler: (data: string) => void) { onDataHandlers.push(handler); return { dispose() {} } }
    onResize() { return { dispose() {} } }
    onWriteParsed() { return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { keyHandlers.push(handler) }
    getSelection() { return '' }
    selectAll() {}
    clear() {}
    focus() { focused += 1 }
    scrollToBottom() {}
    dispose() {}
    resize() {}
  },
}))
class StubAddon {
  activate() {}
  dispose() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 } }
  onContextLoss() {}
}
vi.mock('@xterm/addon-fit', () => ({ FitAddon: StubAddon }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: StubAddon }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: StubAddon }))
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: StubAddon }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: StubAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@apackdev/sdk/fe', () => ({ openLink: () => {} }))

const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')
const { terminalEventBus } = await import('#features/code/fe/utils/terminal-events.ts')

let next = 0
const info = () => {
  next += 1
  return { id: `t-${next}`, title: 'sh', cwd: '/tmp', pid: 100 + next, shell: '/bin/zsh', active: true, cols: 80, rows: 24 } as never
}
const host = () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return element
}

beforeEach(() => {
  onDataHandlers.length = 0
  keyHandlers.length = 0
  pasted.length = 0
  written.length = 0
  focused = 0
})

/** The one key handler `ensure` wired, driven as the emulator would drive it */
const press = (init: Partial<KeyboardEvent>) => {
  const event = { type: 'keydown', ctrlKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...init } as KeyboardEvent
  return keyHandlers.map((handler) => handler(event))
}

describe('one session, one host', () => {
  it('leaves the wrapper where it is when a host that no longer holds it detaches', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    const oldHost = host()
    const newHost = host()

    terminalPool.attach(entry.terminalId, oldHost)
    // A remount: the new host mounts and attaches before the old one unmounts
    terminalPool.attach(entry.terminalId, newHost)
    terminalPool.detach(entry.terminalId, oldHost)

    expect(newHost.contains(entry.wrapper), 'the live host kept the terminal').toBe(true)
    expect(entry.attachedContainer).toBe(newHost)
  })

  it('detaches when the host that holds it asks', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    const only = host()
    terminalPool.attach(entry.terminalId, only)

    terminalPool.detach(entry.terminalId, only)

    expect(only.contains(entry.wrapper)).toBe(false)
    expect(entry.attachedContainer).toBeNull()
  })

  it('wires input once per session, however many hosts draw it', () => {
    const terminal = info()
    const sent: string[] = []
    const entry = terminalPool.ensure(terminal, (data) => sent.push(data))
    const first = host()
    const second = host()

    terminalPool.attach(entry.terminalId, first)
    terminalPool.detach(entry.terminalId, first)
    terminalPool.attach(entry.terminalId, second)
    // Each host calls `ensure` on mount; a second registration would send every keystroke twice
    terminalPool.ensure(terminal, (data) => sent.push(data))

    expect(onDataHandlers).toHaveLength(1)
    for (const handler of onDataHandlers) handler('x')
    expect(sent, 'one keystroke, sent once').toEqual(['x'])
  })

  it('keeps one scroll policy per session, whichever host reads it', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    terminalPool.attach(entry.terminalId, host())

    expect(terminalPool.isPinned(entry.terminalId), 'a new session follows its output').toBe(true)
    // The panel's write handler and the canvas's both read this one value (F2)
    terminalPool.setPinned(entry.terminalId, false)
    expect(terminalPool.isPinned(entry.terminalId)).toBe(false)
  })

  it('reports a session it has never seen as following its output', () => {
    // The panel reads the policy on a write that can arrive before the entry exists; unpinned by default
    // would silently stop a terminal from scrolling at all
    expect(terminalPool.isPinned('never-opened')).toBe(true)
  })
})

describe('what the pool draws, and what it refuses to', () => {
  it('replays nothing into a fresh emulator, so a cleared terminal stays cleared', () => {
    const terminal = info()
    // Output arriving while nothing is drawing it: the bus keeps no copy, so there is nothing to replay
    terminalEventBus.emit((terminal as unknown as { id: string }).id, 'before anyone looked\r\n')

    terminalPool.ensure(terminal, () => {})

    // F11: the only thing that ever un-cleared a terminal was a replay of a persisted byte log. A fresh
    // emulator shows the banner and nothing else — history for that case is the broker's to serve
    expect(written.join(''), 'something was replayed into the new emulator').not.toContain('before anyone looked')
    expect(written.some((chunk) => chunk.includes('Starting terminal'))).toBe(true)
  })

  it('takes no focus when a host attaches', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    terminalPool.attach(entry.terminalId, host())
    // F15: an attach happens on a tab switch, a panel drag and an actor replacement, none of them a request
    expect(focused).toBe(0)
  })

  it('pastes through the emulator rather than as input', async () => {
    const terminal = info()
    const sent: string[] = []
    terminalPool.ensure(terminal, (data) => sent.push(data))
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.resolve('rm -rf /\n') },
      configurable: true,
    })

    expect(press({ ctrlKey: true, shiftKey: true, key: 'V' })).toEqual([false])
    await Promise.resolve()
    await Promise.resolve()

    // F12: through `paste`, which wraps it in the bracketed-paste markers when the application asked for
    // them. Sent as input, that trailing newline runs the command
    expect(pasted).toEqual(['rm -rf /\n'])
    expect(sent, 'a paste must not arrive as keystrokes').toEqual([])
  })

  it('swallows a clipboard the window may not read', async () => {
    const terminal = info()
    terminalPool.ensure(terminal, () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.reject(new Error('denied')), writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    })

    press({ ctrlKey: true, shiftKey: true, key: 'V' })
    press({ ctrlKey: true, shiftKey: true, key: 'C' })
    await Promise.resolve()
    await Promise.resolve()

    // F16: unhandled, each is a console error nobody can act on — and an unhandled rejection fails this run,
    // which is what makes this case a guard rather than a description
    expect(pasted).toEqual([])
  })
})