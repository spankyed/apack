// One session, one attached host, one input registration, one scroll policy.
//
// F1 and F2 are the two halves of not having that. `detach` took the wrapper out of whichever host held it, so
// during a remount — where the new host attaches before the old one unmounts — the live host went blank. And the
// panel scrolled to the bottom on every write while the canvas honoured pinning, so the same terminal jumped
// under the user in one host and not in the other.
//
// The emulator refuses to open without a 2D canvas context, which jsdom does not implement, so it is a
// stand-in here. What is under test is the pool's bookkeeping over it: which host holds the wrapper, how many
// times input is wired, and where the pin state lives. Nothing here asserts anything about how it draws.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const onDataHandlers: Array<(data: string) => void> = []
const keyHandlers: Array<(event: KeyboardEvent) => boolean> = []
const pasted: string[] = []
const written: string[] = []
/** Every grid the emulator was resized to, and the handlers it would raise its own `resize` to */
const resizedTo: Array<{ cols: number; rows: number }> = []
const onResizeHandlers: Array<(size: { cols: number; rows: number }) => void> = []
let focused = 0

/** What the pool built each emulator with, so a case can assert a bound it derives rather than pins */
const builtWith: Array<Record<string, unknown>> = []
/** Each emulator the pool constructed, so a case can drive the one it just made */
const builtEmulators: Array<{ viewportY: number; scrollbackLength: number }> = []

/** The fit addon the pool loads. Inert: what it does needs a renderer, and none of it is under test */
class StubAddon {
  activate() {}
  dispose() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 } }
  observeResize() {}
}

/** A link provider of the library's, offering whatever a case put in `StubProvider.links` */
class StubProvider {
  static links: Array<{ text: string; activate: () => void }> = []
  provideLinks(_y: number, callback: (links: unknown[] | undefined) => void) {
    callback(StubProvider.links.length ? StubProvider.links : undefined)
  }
  dispose() {}
}

/** Each emulator's scroll position, and the handlers it would raise its own `scroll` to */
const onScrollHandlers: Array<(viewportY: number) => void> = []
/** The link providers the pool registered, each already wrapped by the pool */
const linkProviders: Array<{ provideLinks(y: number, cb: (links: unknown[] | undefined) => void): void }> = []
/** What the emulator's module load is, held open by a case that wants to act during it */
let loadGate: { promise: Promise<void>; release: () => void } | undefined

vi.mock('ghostty-web', () => ({
  init: () => loadGate?.promise ?? Promise.resolve(),
  FitAddon: StubAddon,
  // Both of the library's providers are the same shape to the pool, which wraps each one
  OSC8LinkProvider: StubProvider,
  UrlRegexProvider: StubProvider,
  Terminal: class {
    element = document.createElement('div')
    cols = 80
    rows = 24
    viewportY = 0
    // The real emulator refuses write, clear, paste, input, reset, scrollLines and registerLinkProvider
    // before `open`, by name. Registering the providers during construction passed here and failed in the
    // app, so the stand-in refuses what the emulator refuses.
    opened = false
    assertOpen(what: string) { if (!this.opened) throw new Error(`Terminal must be opened before ${what}`) }
    constructor(options: Record<string, unknown> = {}) { builtWith.push(options); builtEmulators.push(this) }
    loadAddon() {}
    registerLinkProvider(provider: { provideLinks(y: number, cb: (links: unknown[] | undefined) => void): void }) {
      this.assertOpen('registering link providers')
      linkProviders.push(provider)
    }
    open(host: HTMLElement) { host.appendChild(this.element); this.opened = true }
    scrollbackLength = 0
    write(data: string, done?: () => void) {
      this.assertOpen('use')
      written.push(data)
      // **As the emulator does**: a write appends to the scrollback and, if the view is scrolled back,
      // snaps it to the bottom. That second part is what the pool has to undo, so the stand-in has to do
      // it or the case asserts nothing.
      this.scrollbackLength += (data.match(/\n/g) ?? []).length
      if (this.viewportY !== 0) this.viewportY = 0
      done?.()
    }
    paste(data: string) { this.assertOpen('use'); pasted.push(data) }
    onData(handler: (data: string) => void) { onDataHandlers.push(handler); return { dispose() {} } }
    onResize(handler: (size: { cols: number; rows: number }) => void) {
      onResizeHandlers.push(handler)
      return { dispose() {} }
    }
    onRender() { return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
    onScroll(handler: (viewportY: number) => void) {
      onScrollHandlers.push(handler)
      return { dispose() { onScrollHandlers.splice(onScrollHandlers.indexOf(handler), 1) } }
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { keyHandlers.push(handler) }
    getSelection() { return '' }
    selectAll() {}
    clear() { this.assertOpen('use') }
    focus() { focused += 1 }
    scrollToBottom() { this.viewportY = 0 }
    scrollLines(amount: number) { this.assertOpen('use'); this.viewportY = Math.max(0, this.viewportY - amount) }
    getScrollbackLength() { return this.scrollbackLength }
    dispose() {}
    // As the emulator's does: the grid changes and it raises its own `resize` for it, which is the feed
    // the pool reports what this window fitted through
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      resizedTo.push({ cols, rows })
      for (const handler of onResizeHandlers) handler({ cols, rows })
    }
  },
}))

/** Every URL the app was asked to open, which is where a link's activation must end up */
const opened: string[] = []
vi.mock('@apackdev/sdk/fe', () => ({ openLink: (url: string) => { opened.push(url) } }))

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

const { terminalPool, openedByTheApp, takeClipboardWrites, RESIZE_SETTLE_MS } = await import('#features/code/fe/utils/terminal-pool.ts')
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
  resizedTo.length = 0
  onResizeHandlers.length = 0
  onScrollHandlers.length = 0
  linkProviders.length = 0
  opened.length = 0
  StubProvider.links = []
  loadGate = undefined
  focused = 0
})

/** The emulator's module load, as a case drives it: held until the returned function is called */
const holdTheModuleLoad = () => {
  let release = () => {}
  loadGate = { promise: new Promise<void>((resolve) => { release = resolve }), release: () => release() }
  return () => loadGate?.release()
}

/** The emulator the pool built last, which is the one the case just asked for */
const lastBuilt = () => {
  const term = builtEmulators.at(-1)
  if (!term) throw new Error('nothing has built an emulator')
  return term
}

/** The one key handler `ensure` wired, driven as the emulator would drive it */
const press = (init: Partial<KeyboardEvent>) => {
  const event = { type: 'keydown', ctrlKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...init } as KeyboardEvent
  return keyHandlers.map((handler) => handler(event))
}

describe('one session, one host', () => {
  it('leaves the wrapper where it is when a host that no longer holds it detaches', async () => {
    const terminal = info()
    const entry = (await terminalPool.ensure(terminal, () => {}))!
    const oldHost = host()
    const newHost = host()

    terminalPool.attach(entry.terminalId, oldHost)
    // A remount: the new host mounts and attaches before the old one unmounts
    terminalPool.attach(entry.terminalId, newHost)
    terminalPool.detach(entry.terminalId, oldHost)

    expect(newHost.contains(entry.wrapper), 'the live host kept the terminal').toBe(true)
    expect(entry.attachedContainer).toBe(newHost)
  })

  it('detaches when the host that holds it asks', async () => {
    const terminal = info()
    const entry = (await terminalPool.ensure(terminal, () => {}))!
    const only = host()
    terminalPool.attach(entry.terminalId, only)

    terminalPool.detach(entry.terminalId, only)

    expect(only.contains(entry.wrapper)).toBe(false)
    expect(entry.attachedContainer).toBeNull()
  })

  it('wires input once per session, however many hosts draw it', async () => {
    const terminal = info()
    const sent: string[] = []
    const entry = (await terminalPool.ensure(terminal, (data) => sent.push(data)))!
    const first = host()
    const second = host()

    terminalPool.attach(entry.terminalId, first)
    terminalPool.detach(entry.terminalId, first)
    terminalPool.attach(entry.terminalId, second)
    // Each host calls `ensure` on mount; a second registration would send every keystroke twice
    await terminalPool.ensure(terminal, (data) => sent.push(data))

    expect(onDataHandlers).toHaveLength(1)
    for (const handler of onDataHandlers) handler('x')
    expect(sent, 'one keystroke, sent once').toEqual(['x'])
  })

  it('sends nothing to the shell when another host starts drawing it', async () => {
    // A second host — a second window's, or the panel's — attaching is not something the user did to the
    // shell. Nothing is written on attach, and nothing is injected: whatever is on that screen stays what the
    // process put there. (Shell integration is injected once, at create, and never on an attach.)
    const terminal = info()
    const sent: string[] = []
    const entry = (await terminalPool.ensure(terminal, (data) => sent.push(data)))!
    terminalPool.attach(entry.terminalId, host())
    terminalPool.attach(entry.terminalId, host())

    expect(sent, 'attaching typed into the shell').toEqual([])
  })

  it('keeps one scroll policy per session, whichever host is drawing it', async () => {
    const terminal = info()
    const entry = (await terminalPool.ensure(terminal, () => {}))!
    const first = host()
    const following: boolean[] = []
    const attachment = terminalPool.attach(entry.terminalId, first, {
      onFollowingChange: (is) => following.push(is),
    })!

    expect(following.at(-1), 'a new session follows its output').toBe(true)
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(true)

    // The user scrolls back in this host. The emulator raises its own scroll with how far back it now is,
    // and `0` is the bottom — so the *session* stops following, and the other host stops too (F2)
    for (const handler of onScrollHandlers) handler(12)
    expect(following.at(-1), 'the host drawing it was not told').toBe(false)
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(false)

    // And back to the bottom is following again, by the same route
    for (const handler of onScrollHandlers) handler(0)
    expect(terminalPool.isFollowingOutput(entry.terminalId)).toBe(true)
    for (const handler of onScrollHandlers) handler(3)

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

  it('gives each host its own listeners, and takes back only its own on release', async () => {
    const terminal = info()
    const entry = (await terminalPool.ensure(terminal, () => {}))!
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

  /**
   * **A drag is one pty resize, not one per frame** (F18's other half).
   *
   * Every notification a host gets here ends in a pty resize, and a pty resize sends `SIGWINCH` to whatever
   * is running in it — so an unthrottled feed told `vim` to redraw once per observed frame, two dozen times
   * for one drag, and sent two dozen events across the bus to do it. The emulator reflows locally either
   * way, so nothing the user looks at waits for this.
   *
   * The timers are fake because the subject is how many notifications a burst produces, not how long a
   * window takes: a case that slept would be asserting the clock.
   */
  it('tells its host once for a burst of fits, and once more when they settle', async () => {
    vi.useFakeTimers()
    try {
      const entry = (await terminalPool.ensure(info(), () => {}))!
      const sizes: unknown[] = []
      const attachment = terminalPool.attach(entry.terminalId, host(), { onResize: (size) => sizes.push(size) })!

      // A quiet host hears the first fit at once, which is what an attach and a tab switch are
      attachment.refit()
      expect(sizes, 'the first fit waited').toHaveLength(1)

      for (let frame = 0; frame < 24; frame += 1) attachment.refit()
      expect(sizes, 'a burst was reported per fit rather than coalesced').toHaveLength(1)

      vi.advanceTimersByTime(RESIZE_SETTLE_MS)
      expect(sizes, 'the settled size never arrived').toHaveLength(2)

      attachment.release()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is the only module that reaches the emulator, which is what makes it the seam', async () => {
    // Not a reading of the source — `check:specifiers`' `findEmulatorImports` is that, and is the gate. This
    // is the behavioural half: everything a host does to a terminal is on the attachment, so a host needs no
    // emulator at all
    const entry = (await terminalPool.ensure(info(), () => {}))!
    const attachment = terminalPool.attach(entry.terminalId, host())!

    expect(Object.keys(attachment).sort()).toEqual(
      ['clear', 'focus', 'followOutput', 'paste', 'refit', 'release', 'selectAll', 'selection', 'terminalId'],
    )
  })
})

/**
 * Who opens a link the emulator found.
 *
 * The library's providers build each link's `activate` themselves, and what it does by default is go at the
 * window. That is the one part not theirs to decide: the text they matched is whatever a program printed
 * into a terminal, so it goes through the app's one door and its URL policy.
 */
describe('the link the emulator found, and who opens it', () => {
  const offer = (provider: { provideLinks(y: number, cb: (links: unknown[] | undefined) => void): void }) => {
    let offered: unknown[] | undefined
    provider.provideLinks(0, (links) => { offered = links })
    return offered as Array<{ text: string; activate: (event: MouseEvent) => void }> | undefined
  }

  it('sends an activation to the app rather than wherever the provider would have', () => {
    const wentSomewhereElse: string[] = []
    const link = {
      text: 'https://example.com/x',
      range: { start: { x: 1, y: 1 }, end: { x: 20, y: 1 } },
      activate: () => { wentSomewhereElse.push('provider') }
    }
    const wrapped = openedByTheApp({ provideLinks: (_y, cb) => cb([link]) })

    offer(wrapped)![0].activate({} as MouseEvent)

    expect(opened, 'the app was not asked to open it').toEqual(['https://example.com/x'])
    expect(wentSomewhereElse, "the provider's own activation ran").toEqual([])
  })

  it('passes a row with no links through as none, rather than an empty list', () => {
    const wrapped = openedByTheApp({ provideLinks: (_y, cb) => cb(undefined) })
    expect(offer(wrapped)).toBeUndefined()
  })

  it('keeps everything else about a link, since only activation is the app s', () => {
    const range = { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } }
    const wrapped = openedByTheApp({
      provideLinks: (_y, cb) => cb([{ text: 'https://example.com', range, activate: () => {} }])
    })
    expect((offer(wrapped)![0] as unknown as { range: unknown }).range).toBe(range)
  })

  it('disposes the provider it wrapped, which is what the emulator will ask of it', () => {
    let disposed = 0
    openedByTheApp({ provideLinks: (_y, cb) => cb(undefined), dispose: () => { disposed += 1 } }).dispose!()
    expect(disposed).toBe(1)
  })

  it('wraps every provider the pool registers, so neither family opens its own links', async () => {
    StubProvider.links = [{ text: 'https://example.com/y', activate: () => {} }]
    await terminalPool.ensure(info(), () => {})

    expect(linkProviders.length, 'the pool registered neither provider').toBe(2)
    for (const provider of linkProviders) offer(provider)![0].activate({} as MouseEvent)

    expect(opened).toEqual(['https://example.com/y', 'https://example.com/y'])
  })
})


describe('what the pool draws, and what it refuses to', () => {
  it('replays nothing into a fresh emulator, so a cleared terminal stays cleared', async () => {
    const terminal = info()
    // Output arriving while nothing is drawing it: the bus keeps no copy, so there is nothing to replay
    terminalEventBus.emit((terminal as unknown as { id: string }).id, 'before anyone looked\r\n')

    await terminalPool.ensure(terminal, () => {})

    // F11: the only thing that ever un-cleared a terminal was a replay of a persisted byte log. A fresh
    // emulator shows the banner and nothing else — history for that case is the broker's to serve
    expect(written.join(''), 'something was replayed into the new emulator').not.toContain('before anyone looked')
    expect(written.some((chunk) => chunk.includes('Starting terminal'))).toBe(true)
  })

  it('marks the seam when a window meets a terminal whose process was replaced', async () => {
    // M4. A restored terminal keeps its id and gets a **new** shell, so the id cannot say whether what is on
    // screen came from the process answering now. The pid can, and the buffer above the seam survived only
    // because this pool outlives the backend — which is what makes the screen read as one session when it is
    // two.
    const terminal = info() as unknown as { id: string; pid: number }
    await terminalPool.ensure(terminal as never, () => {})
    written.length = 0

    // The backend came back with a new shell under the same id, and the list arrives before any host mounts
    terminalPool.syncProcesses([{ ...terminal, pid: terminal.pid + 1 } as never])

    expect(written.join(''), 'nothing told the user the shell under this buffer is a different one')
      .toContain(`new shell (pid ${terminal.pid + 1})`)
  })

  it('draws one seam for one death, however the new shell is learnt', async () => {
    const terminal = info() as unknown as { id: string; pid: number }
    await terminalPool.ensure(terminal as never, () => {})
    terminalPool.noteExit(terminal.id, 139)
    written.length = 0

    // The crash drew its line already. `restoreAll` broadcasts nothing, so after a backend restart the
    // replaced pty reaches this window through a refreshed list rather than `terminal.RESTARTED` — which
    // lands in `markRestart`, where the one-seam rule has to hold too. Any window that merely missed the
    // broadcast gets here the same way: a surface starting, a reconnect, an explicit refresh.
    terminalPool.syncProcesses([{ ...terminal, pid: terminal.pid + 1 } as never])

    expect(written.join(''), 'one death reported twice, once as an exit and again as a restart')
      .not.toContain('new shell')
  })

  // **M2's other half.** One window owns a pty's size and the rest are told what is in force — which buys
  // nothing until the window that was told draws at it.
  it('draws at the grid the host accepted, not the one it fitted', async () => {
    const terminal = info() as unknown as { id: string }
    await terminalPool.ensure(terminal as never, () => {})

    terminalPool.applyGrid(terminal.id, 90, 25)

    expect(resizedTo, 'the window kept drawing at whatever it had fitted for itself')
      .toEqual([{ cols: 90, rows: 25 }])
  })

  it('reports nothing back when it applies one, so two windows cannot trade a size', async () => {
    const terminal = info() as unknown as { id: string }
    await terminalPool.ensure(terminal as never, () => {})
    const fitted: Array<{ cols: number; rows: number }> = []
    terminalPool.attach(terminal.id, host(), { onResize: (size) => fitted.push(size) })
    fitted.length = 0

    terminalPool.applyGrid(terminal.id, 90, 25)

    // The emulator raises its own `resize` either way, and that feed is how this window says what it fitted.
    // Reporting a grid the host just sent would send it straight back
    expect(fitted, 'the accepted grid was reported back as something this window had fitted').toEqual([])
  })

  it('draws no seam for a mounting host\'s stale descriptor', async () => {
    // `ensure` runs on every mount and a host can hold a frozen descriptor — `TerminalView` is handed
    // `props.terminalInfo` and never refreshes it. Read as a boundary, a tab switched away and back drew a
    // seam naming the *previous* shell and set the entry's pid to it, which made the next list a boundary
    // again: one death, a seam per switch, oscillating
    const terminal = info() as unknown as { id: string; pid: number };
    await terminalPool.ensure(terminal as never, () => {})
    terminalPool.syncProcesses([{ ...terminal, pid: terminal.pid + 1 } as never]);
    written.length = 0;

    await terminalPool.ensure(terminal as never, () => {})

    expect(written.join(''), 'the stale pid was read as a new shell').not.toContain('new shell');
    // And the entry still names the shell that is answering, so the next list is not a boundary either
    terminalPool.syncProcesses([{ ...terminal, pid: terminal.pid + 1 } as never]);
    expect(written.join('')).not.toContain('new shell');
  });

  it('says nothing when the process is the one the buffer came from', async () => {
    const terminal = info() as unknown as { id: string; pid: number }
    await terminalPool.ensure(terminal as never, () => {})
    written.length = 0

    terminalPool.syncProcesses([terminal as never])
    await terminalPool.ensure(terminal as never, () => {})

    // A seam on every list would be noise in the one place a user is reading output
    expect(written.join('')).not.toContain('new shell')
  })

  it('takes no focus when a host attaches', async () => {
    const terminal = info()
    const entry = (await terminalPool.ensure(terminal, () => {}))!
    terminalPool.attach(entry.terminalId, host())
    // F15: an attach happens on a tab switch, a panel drag and an actor replacement, none of them a request
    expect(focused).toBe(0)
  })

  it('pastes through the emulator rather than as input', async () => {
    const terminal = info()
    const sent: string[] = []
    await terminalPool.ensure(terminal, (data) => sent.push(data))
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
  it('takes its paste listener back with the last session, and installs one per pool rather than per module', async () => {
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
    await terminalPool.ensure(first, () => {})
    await terminalPool.ensure(second, () => {})

    expect(added.length, 'one listener for the pool, not one per session').toBe(1)
    expect(removed, 'the pool still has sessions').toEqual([])

    terminalPool.dispose((first as unknown as { id: string }).id)
    expect(removed, 'a session went, but the pool still has one').toEqual([])

    terminalPool.dispose((second as unknown as { id: string }).id)
    expect(removed.length, 'the last session went and the listener stayed').toBe(1)

    // And it comes back for the next session, so taking it back is not a one-way door
    await terminalPool.ensure(info(), () => {})
    expect(added.length).toBe(2)

    vi.restoreAllMocks()
  })

  it('swallows a clipboard the window may not read', async () => {
    const terminal = info()
    await terminalPool.ensure(terminal, () => {})
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


/**
 * What happens during the emulator's module load.
 *
 * **The load is awaited, so everything else can happen in the middle of it** — and the two that matter are
 * a session closed before its emulator exists and a second mount arriving while the first is still
 * building. Neither was possible while construction was synchronous, which is why they are here rather
 * than inferred from the shape of the code.
 */
describe('a session that is still opening', () => {
  it('builds one emulator for two mounts that arrive together', async () => {
    const release = holdTheModuleLoad()
    const terminal = info()
    const built = builtWith.length

    const both = Promise.all([
      terminalPool.ensure(terminal, () => {}),
      terminalPool.ensure(terminal, () => {})
    ])
    release()
    const [first, second] = await both

    expect(builtWith.length - built, 'a second emulator was built for one session').toBe(1)
    expect(first, 'the two mounts got different entries').toBe(second)
    // And one input registration, which is what two emulators would have doubled
    expect(onDataHandlers).toHaveLength(1)
  })

  it('registers nothing for a session closed while it was opening', async () => {
    const release = holdTheModuleLoad()
    const terminal = info() as unknown as { id: string }
    const opening = terminalPool.ensure(terminal as never, () => {})

    // The backend finished with it before its emulator existed
    terminalPool.dispose(terminal.id)
    release()

    expect(await opening, 'a closed session was handed back as an open one').toBeNull()
    // Nothing is left in the pool to find, and nothing is left subscribed: a later write reaches no
    // emulator rather than one nobody can see
    written.length = 0
    terminalEventBus.emit(terminal.id, 'after')
    expect(written.join(''), 'a discarded emulator was still taking output').toBe('')
  })

  it('answers the same entry once it is built, without building again', async () => {
    const terminal = info()
    const built = builtWith.length
    const entry = (await terminalPool.ensure(terminal, () => {}))!

    expect((await terminalPool.ensure(terminal, () => {}))!, 'a built session was rebuilt').toBe(entry)
    expect(builtWith.length - built).toBe(1)
  })
})

/**
 * What a program asked to be put on the clipboard (OSC 52).
 *
 * The emulator does not surface it, where the previous one had an addon for it, so this is what keeps a
 * remote `vim`'s yank and `tmux save-buffer` working. The sequence arrives split across reads as often as
 * not, which is the whole reason the function is pure and takes its own carry.
 */
/**
 * Where the view stays while output arrives.
 *
 * **The emulator snaps to the bottom on every write once the user has scrolled back** — its
 * `writeInternal` ends with `viewportY !== 0 && scrollToBottom()`, and a driven run confirmed it: the
 * canvas fingerprint while scrolled back and after one more line were different, so the screen had moved.
 * A session reading its own history being dragged to the end by output it is not looking at is one of the
 * journeys the terminal complaint was about, so the pool puts it back.
 */
describe('the view while output arrives', () => {
  const emulator = () => {
    const term = lastBuilt()
    return term
  }

  it('keeps the user where they were, allowing for what the write added', async () => {
    const terminal = info()
    await terminalPool.ensure(terminal, () => {})
    const term = emulator()
    const id = (terminal as unknown as { id: string }).id

    // The user scrolls back twelve lines
    term.viewportY = 12

    // Three lines arrive, which the emulator appends and then snaps to the bottom for
    terminalEventBus.emit(id, 'one\ntwo\nthree\n')

    // Back where they were *in the content*: twelve from the old bottom is fifteen from the new one
    expect(term.viewportY, 'output dragged the view to the end').toBe(15)
  })

  it('leaves a session that is following its output at the bottom', async () => {
    const terminal = info()
    await terminalPool.ensure(terminal, () => {})
    const term = emulator()
    const id = (terminal as unknown as { id: string }).id

    expect(term.viewportY).toBe(0)
    terminalEventBus.emit(id, 'more output\n')

    expect(term.viewportY, 'a following session was scrolled off the end').toBe(0)
  })

  it('does not tell the host the session stopped and started following for one write', async () => {
    const terminal = info()
    await terminalPool.ensure(terminal, () => {})
    const term = emulator()
    const id = (terminal as unknown as { id: string }).id
    const following: boolean[] = []
    terminalPool.attach(id, host(), { onFollowingChange: (is) => following.push(is) })
    following.length = 0
    term.viewportY = 9

    terminalEventBus.emit(id, 'a line\n')

    // The snap and the correction each raise a scroll; neither is the user moving
    expect(following, 'the scroll control was told the session moved').toEqual([])
  })
})

describe('a clipboard request in the output', () => {
  const osc52 = (payload: string, terminator = '\x07') => `\x1b]52;c;${payload}${terminator}`
  const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

  it('reads one out of a chunk, whichever terminator ends it', () => {
    for (const terminator of ['\x07', '\x1b\\']) {
      const taken = takeClipboardWrites('', `before${osc52(base64('copied'), terminator)}after`)
      expect(taken.writes, terminator === '\x07' ? 'BEL' : 'ST').toEqual(['copied'])
      expect(taken.pending).toBe('')
    }
  })

  it('reads one delivered a byte at a time, which is how it usually arrives', () => {
    const stream = `x${osc52(base64('split across reads'))}y`
    let pending = ''
    const writes: string[] = []
    for (const byte of stream) {
      const taken = takeClipboardWrites(pending, byte)
      pending = taken.pending
      writes.push(...taken.writes)
    }
    expect(writes).toEqual(['split across reads'])
    expect(pending, 'it held onto a finished sequence').toBe('')
  })

  it('reads every one in a chunk, not only the first', () => {
    const chunk = `${osc52(base64('one'))}between${osc52(base64('two'))}`
    expect(takeClipboardWrites('', chunk).writes).toEqual(['one', 'two'])
  })

  it('decodes what was copied rather than the bytes it travelled as', () => {
    // Not ASCII, because base64 of UTF-8 is the part a latin1 decode gets wrong
    expect(takeClipboardWrites('', osc52(base64('héllo — 日本語'))).writes).toEqual(['héllo — 日本語'])
  })

  it('answers a read request with nothing, which is a decision', () => {
    // `ESC ] 52 ; c ; ?` asks the terminal to send the clipboard *to the program* — including a program on
    // the other end of an ssh connection. Nothing is written and nothing is sent back
    const taken = takeClipboardWrites('', '\x1b]52;c;?\x07')
    expect(taken.writes).toEqual([])
    expect(taken.pending).toBe('')
  })

  it('ignores a payload that is not base64, and holds nothing after it', () => {
    const taken = takeClipboardWrites('', osc52('not base64 at all!!'))
    expect(taken.writes).toEqual([])
    expect(taken.pending).toBe('')
  })

  it('holds nothing for ordinary output, however much of it there is', () => {
    const taken = takeClipboardWrites('', 'line one\r\nline two\r\n\x1b[31mred\x1b[0m')
    expect(taken.writes).toEqual([])
    expect(taken.pending).toBe('')
  })

  it('gives up on a sequence that never terminates rather than holding it forever', () => {
    const runaway = `\x1b]52;c;${'A'.repeat(1_048_600)}`
    expect(takeClipboardWrites('', runaway).pending, 'it held a megabyte of unterminated output').toBe('')
  })

  it('puts what a program copied on the clipboard, through the terminal that received it', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
      configurable: true,
    })
    const terminal = info()
    await terminalPool.ensure(terminal, () => {})

    terminalEventBus.emit((terminal as unknown as { id: string }).id, osc52(base64('from the shell')))
    await Promise.resolve()

    expect(written).toEqual(['from the shell'])
  })
})

describe('the scrollback the emulator is built with', () => {
  /**
   * **One number, and it is the host's.** The pool pinned 10,000 while the broker kept 1,000, so a window
   * that stayed open showed nine tenths more than any reattach could reproduce — the broker is what answers
   * a screen read once no window holds the bytes. `TerminalInfo.scrollback` carries the broker's own, from
   * its handshake, and this asserts the pool uses it rather than a constant of its own.
   */
  it('comes from the session rather than a number of the pool s own', async () => {
    const info = { id: 't-scroll', title: 't', cwd: '/tmp', cols: 80, rows: 24, scrollback: 1_234 } as never

    await terminalPool.ensure(info, () => {})

    expect(builtWith.at(-1)?.scrollback, 'the pool built the emulator with a bound of its own').toBe(1_234)
  })
})
