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

/** What the pool built each emulator with, so a case can assert a bound it derives rather than pins */
const builtWith: Array<Record<string, unknown>> = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    element = document.createElement('div')
    cols = 80
    rows = 24
    constructor(options: Record<string, unknown> = {}) { builtWith.push(options) }
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
/**
 * The WebGL addon, which the pool drives two ways: it hands it a context-loss handler and disposes it at
 * teardown. A GL context cannot be lost in jsdom, so the handler is kept here for a case to fire.
 */
class WebglStub {
  disposals = 0
  loseContext: (() => void) | undefined
  activate() {}
  dispose() { this.disposals += 1 }
  onContextLoss(handler: () => void) { this.loseContext = handler }
}
const webglAddons: WebglStub[] = []
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class WebglAddon extends WebglStub {
    constructor() { super(); webglAddons.push(this) }
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@apackdev/sdk/fe', () => ({ openLink: () => {} }))

// jsdom has neither of these. The attachment uses both, and what is under test is its bookkeeping rather
// than the browser's layout — a size observer that never fires and an immediate frame are enough for that
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver
globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) => {
  callback(0)
  return 0
}) as typeof requestAnimationFrame

const { terminalPool, findScroller } = await import('#features/code/fe/utils/terminal-pool.ts')
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
/** Every session any case here could have made. The pool is a module singleton, so a case about its
 *  lifetime has to start from an empty one. */
const drain = () => {
  for (let i = 1; i <= next; i += 1) terminalPool.dispose(`t-${i}`)
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

  it('sends nothing to the shell when another host starts drawing it', () => {
    // A second host — a second window's, or the panel's — attaching is not something the user did to the
    // shell. Nothing is written on attach, and nothing is injected: whatever is on that screen stays what the
    // process put there. (Shell integration is injected once, at create, and never on an attach.)
    const terminal = info()
    const sent: string[] = []
    const entry = terminalPool.ensure(terminal, (data) => sent.push(data))
    terminalPool.attach(entry.terminalId, host())
    terminalPool.attach(entry.terminalId, host())

    expect(sent, 'attaching typed into the shell').toEqual([])
  })

  it('keeps one scroll policy per session, whichever host is drawing it', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    const first = host()
    const following: boolean[] = []
    const attachment = terminalPool.attach(entry.terminalId, first, {
      onFollowingChange: (is) => following.push(is),
    })!

    expect(following.at(-1), 'a new session follows its output').toBe(true)
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(true)

    // The user scrolls back in this host; the *session* stops following, so the other host stops too (F2)
    entry.pinnedToBottom = false
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(false)

    // And asking to follow again is the session's answer, *told* to this host — the control it draws is the
    // only reader, so a change it is not told about is a scroll control stuck in the wrong state
    const before = following.length
    attachment.followOutput()
    expect(following.slice(before)).toEqual([true])
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(true)

    // A second host is told where the session stands as it attaches, rather than assuming
    const second: boolean[] = []
    terminalPool.attach(entry.terminalId, host(), { onFollowingChange: (is) => second.push(is) })
    expect(second).toEqual([true])
  })

  it('reports a session it has never seen as following its output', () => {
    // A write can arrive before any host has opened it; not following by default would silently stop a
    // terminal from scrolling at all
    expect(terminalPool.isFollowingOutput('never-opened')).toBe(true)
  })

  it('gives each host its own listeners, and takes back only its own on release', () => {
    const terminal = info()
    const entry = terminalPool.ensure(terminal, () => {})
    const oldHost = host()
    const newHost = host()
    const oldResizes: unknown[] = []
    const newResizes: unknown[] = []

    const old = terminalPool.attach(entry.terminalId, oldHost, { onResize: (size) => oldResizes.push(size) })!
    const live = terminalPool.attach(entry.terminalId, newHost, { onResize: (size) => newResizes.push(size) })!
    old.release()

    // Releasing the host that was taken over from leaves the live one drawing and listening (F1)
    expect(newHost.contains(entry.wrapper)).toBe(true)
    live.refit()
    expect(newResizes, 'the live host still hears its own resizes').toHaveLength(1)
    old.refit()
    expect(oldResizes, 'a released attachment reports nothing').toHaveLength(0)
  })

  it('is the only module that reaches the emulator, which is what makes it the seam', () => {
    // Not a reading of the source — `check:specifiers`' `findEmulatorImports` is that, and is the gate. This
    // is the behavioural half: everything a host does to a terminal is on the attachment, so a host needs no
    // emulator at all
    const entry = terminalPool.ensure(info(), () => {})
    const attachment = terminalPool.attach(entry.terminalId, host())!

    expect(Object.keys(attachment).sort()).toEqual(
      ['clear', 'focus', 'followOutput', 'paste', 'refit', 'release', 'selectAll', 'selection', 'terminalId'],
    )
  })
})

/**
 * Which element the pool scrolls, which it finds by what the element **is**.
 *
 * It used to ask for `.xterm-viewport`, and that is the one dependence the ghostty-web plan's capability
 * matrix names — *without depending on xterm DOM classes*. These cases are over plain DOM, because the rule
 * is: jsdom computes `overflow-y` from the inline style, which is all the rule reads.
 */
describe('the element the pool scrolls', () => {
  const styled = (overflow: string) => {
    const element = document.createElement('div')
    element.style.overflowY = overflow
    return element
  }

  it('finds the root itself when the root is what scrolls', () => {
    const root = styled('scroll')
    expect(findScroller(root)).toBe(root)
  })

  it('finds a descendant that scrolls under a root that does not', () => {
    const root = styled('visible')
    const screen = styled('visible')
    const viewport = styled('auto')
    root.append(screen, viewport)
    expect(findScroller(root)).toBe(viewport)
  })

  it('finds one nested deeper than a direct child', () => {
    const root = styled('visible')
    const middle = styled('visible')
    const viewport = styled('scroll')
    middle.append(viewport)
    root.append(middle)
    expect(findScroller(root)).toBe(viewport)
  })

  // What makes it a rule rather than a lucky query: nothing is named, so nothing scrolling is nothing found
  it('finds nothing when nothing scrolls, whatever anything is called', () => {
    const root = styled('visible')
    const named = document.createElement('div')
    named.className = 'xterm-viewport'
    root.append(named)
    expect(findScroller(root)).toBeNull()
  })

  it('takes the first in document order, so one emulator gives one answer', () => {
    const root = styled('visible')
    const first = styled('scroll')
    const second = styled('scroll')
    root.append(first, second)
    expect(findScroller(root)).toBe(first)
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

  it('marks the seam when a window meets a terminal whose process was replaced', () => {
    // M4. A restored terminal keeps its id and gets a **new** shell, so the id cannot say whether what is on
    // screen came from the process answering now. The pid can, and the buffer above the seam survived only
    // because this pool outlives the backend — which is what makes the screen read as one session when it is
    // two.
    const terminal = info() as unknown as { id: string; pid: number }
    terminalPool.ensure(terminal as never, () => {})
    written.length = 0

    // The backend came back with a new shell under the same id, and the list arrives before any host mounts
    terminalPool.syncProcesses([{ ...terminal, pid: terminal.pid + 1 } as never])

    expect(written.join(''), 'nothing told the user the shell under this buffer is a different one')
      .toContain(`new shell (pid ${terminal.pid + 1})`)
  })

  it('says nothing when the process is the one the buffer came from', () => {
    const terminal = info() as unknown as { id: string; pid: number }
    terminalPool.ensure(terminal as never, () => {})
    written.length = 0

    terminalPool.syncProcesses([terminal as never])
    terminalPool.ensure(terminal as never, () => {})

    // A seam on every list would be noise in the one place a user is reading output
    expect(written.join('')).not.toContain('new shell')
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

  /**
   * **F17**: the `apack:paste` listener was registered at module scope and never removed, so every reload of
   * this pack's frontend left another one behind holding a pool whose emulators had been disposed. The leak's
   * only observable is the registration itself, which is why this case watches `document` rather than a
   * getter written for it — and why it fails on the old code, where neither call is ever made.
   */
  it('takes its paste listener back with the last session, and installs one per pool rather than per module', () => {
    drain()
    const added: string[] = []
    const removed: string[] = []
    const add = document.addEventListener.bind(document)
    const remove = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, ...rest: never[]) => {
      if (type === 'apack:paste') added.push(type)
      return add(type as keyof DocumentEventMap, ...(rest as never[]))
    }) as typeof document.addEventListener)
    vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, ...rest: never[]) => {
      if (type === 'apack:paste') removed.push(type)
      return remove(type as keyof DocumentEventMap, ...(rest as never[]))
    }) as typeof document.removeEventListener)

    const first = info()
    const second = info()
    terminalPool.ensure(first, () => {})
    terminalPool.ensure(second, () => {})

    expect(added.length, 'one listener for the pool, not one per session').toBe(1)
    expect(removed, 'the pool still has sessions').toEqual([])

    terminalPool.dispose((first as unknown as { id: string }).id)
    expect(removed, 'a session went, but the pool still has one').toEqual([])

    terminalPool.dispose((second as unknown as { id: string }).id)
    expect(removed.length, 'the last session went and the listener stayed').toBe(1)

    // And it comes back for the next session, so taking it back is not a one-way door
    terminalPool.ensure(info(), () => {})
    expect(added.length).toBe(2)

    vi.restoreAllMocks()
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

describe('the renderer the pool draws with', () => {
  /**
   * **F10.** The browser takes a GL context back under memory pressure, on a GPU reset, or when too many
   * are live, and xterm's addon reports the loss rather than recovering: whatever still holds it draws
   * nothing. Disposing it is what drops xterm to its DOM renderer, which is slower and still draws.
   */
  it('gives up the WebGL renderer when the context is lost, and disposes that addon once', () => {
    const entry = terminalPool.ensure(info(), () => {})
    terminalPool.attach(entry.terminalId, host())
    const addon = webglAddons.at(-1)!
    expect(entry.webglAddon as unknown, 'the addon the attach loaded').toBe(addon)

    addon.loseContext!()

    expect(addon.disposals).toBe(1)
    // And the entry stops naming it, so teardown does not reach an addon that is already gone: disposing
    // one over a lost context crashes inside xterm's own addon iteration
    expect(entry.webglAddon).toBeNull()
    terminalPool.dispose(entry.terminalId)
    expect(addon.disposals).toBe(1)
  })
})

describe('the scrollback the emulator is built with', () => {
  /**
   * **One number, and it is the host's.** The pool pinned 10,000 while the broker kept 1,000, so a window
   * that stayed open showed nine tenths more than any reattach could reproduce — the broker is what answers
   * a screen read once no window holds the bytes. `TerminalInfo.scrollback` carries the broker's own, from
   * its handshake, and this asserts the pool uses it rather than a constant of its own.
   */
  it('comes from the session rather than a number of the pool s own', () => {
    const info = { id: 't-scroll', title: 't', cwd: '/tmp', cols: 80, rows: 24, scrollback: 1_234 } as never

    terminalPool.ensure(info, () => {})

    expect(builtWith.at(-1)?.scrollback, 'the pool built the emulator with a bound of its own').toBe(1_234)
  })
})
