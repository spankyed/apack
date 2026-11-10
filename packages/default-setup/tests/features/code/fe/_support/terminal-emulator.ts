// The emulator, as jsdom can hold one.
//
// The emulator draws to a canvas and refuses to open without a 2D context, which jsdom does not implement,
// so a terminal host's cases stand in for it with this. What the stand-in is for is the *driving*: a host
// wires itself to the emulator through the pool's attachment, and the only way to assert what it does with
// what the emulator reports is to report something. So each instance records what was done to it and hands
// back the handlers it was given.
//
// Nothing here asserts anything about how the emulator draws, and no case over it should.

/** A handler the emulator was given, with the emitter's dispose face around it */
class Emitter<T> {
  readonly handlers: Array<(value: T) => void> = []
  listen = (handler: (value: T) => void) => {
    this.handlers.push(handler)
    return { dispose: () => { this.handlers.splice(this.handlers.indexOf(handler), 1) } }
  }
  /** A copy, so a handler that disposes itself as it runs does not shorten what is being iterated */
  fire = (value: T) => { for (const handler of this.handlers.slice()) handler(value) }
}

/**
 * The emulator's WebAssembly load, which the pool awaits once per realm.
 *
 * **Holdable, because the pool's hardest cases are the ones that happen during it.** A session can be
 * closed, and a host unmounted, while this is still pending — so a case that wants to drive that calls
 * `holdEmulatorLoad()` first and releases it when it has done whatever should be survived.
 */
let held: Promise<void> | undefined
let release: (() => void) | undefined

export const init = (): Promise<void> => held ?? Promise.resolve()

/** Holds every `init` open until the returned function is called */
export function holdEmulatorLoad(): () => void {
  held = new Promise<void>((resolve) => { release = resolve })
  return () => {
    release?.()
    held = undefined
    release = undefined
  }
}

export class StubTerminal {
  element = document.createElement('div')
  cols = 80
  rows = 24
  /** How far back from the bottom the view is scrolled; `0` is following the output */
  viewportY = 0
  scrollback: string[] = []
  /** Everything written into this emulator, the pool's own banners included */
  written: string[] = []
  pasted: string[] = []
  focused = 0
  cleared = 0
  disposed = 0
  selection = ''
  readonly data = new Emitter<string>()
  readonly resized = new Emitter<{ cols: number; rows: number }>()
  readonly rendered = new Emitter<{ start: number; end: number }>()
  readonly selectionChanged = new Emitter<void>()
  readonly scrolled = new Emitter<number>()
  /** The link providers the pool registered, so a case can offer one a link and see who opens it */
  readonly linkProviders: unknown[] = []

  /**
   * **The real emulator refuses almost everything before `open`**, and says so by name: `write`, `clear`,
   * `paste`, `input`, `reset`, `scrollLines` and `registerLinkProvider` each throw. A stand-in that
   * accepted them passed an ordering the app then failed on — which is how registering the link providers
   * during construction reached a build, so this is here rather than in a comment.
   */
  private opened = false
  private assertOpen(what: string) {
    if (!this.opened) throw new Error(`Terminal must be opened before ${what}`)
  }

  loadAddon() {}
  registerLinkProvider(provider: unknown) {
    this.assertOpen('registering link providers')
    this.linkProviders.push(provider)
  }
  open(host: HTMLElement) { host.appendChild(this.element); this.opened = true }
  write(data: string, done?: () => void) { this.assertOpen('use'); this.written.push(data); done?.() }
  paste(data: string) { this.assertOpen('use'); this.pasted.push(data) }
  onData(handler: (data: string) => void) { return this.data.listen(handler) }
  onResize(handler: (size: { cols: number; rows: number }) => void) { return this.resized.listen(handler) }
  onRender(handler: (range: { start: number; end: number }) => void) { return this.rendered.listen(handler) }
  onSelectionChange(handler: () => void) { return this.selectionChanged.listen(handler) }
  onScroll(handler: (viewportY: number) => void) { return this.scrolled.listen(handler) }
  attachCustomKeyEventHandler() {}
  attachCustomWheelEventHandler() {}
  getSelection() { return this.selection }
  selectAll() { this.selection = this.written.join('') }
  clear() { this.assertOpen('use'); this.cleared += 1 }
  focus() { this.focused += 1 }
  scrollToBottom() { this.viewportY = 0 }
  scrollLines(amount: number) { this.assertOpen('use'); this.viewportY = Math.max(0, this.viewportY - amount) }
  scrollToTop() { this.viewportY = this.scrollback.length }
  getScrollbackLength() { return this.scrollback.length }
  dispose() { this.disposed += 1 }
  resize() {}

  /** What the pty would have sent, as the emulator delivers it */
  type(data: string) { this.data.fire(data) }
  /** The emulator settled on a new size, which is the half of a resize a host is told about */
  resizeTo(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.resized.fire({ cols, rows })
  }
  select(text: string) {
    this.selection = text
    this.selectionChanged.fire()
  }
  /** The user scrolled back this many lines from the bottom, which is the half a host is told about */
  scrollBackTo(viewportY: number) {
    this.viewportY = viewportY
    this.scrolled.fire(viewportY)
  }
}

/** The fit addon the pool loads. Inert: what it does needs a renderer, and none of it is under test */
export class StubAddon {
  activate() {}
  dispose() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 } }
  observeResize() {}
}

/** A link provider the pool wraps. Offers nothing unless a case gives it something to offer */
export class StubLinkProvider {
  static links: Array<{ text: string; activate: () => void }> = []
  provideLinks(_y: number, callback: (links: unknown[] | undefined) => void) {
    callback(StubLinkProvider.links.length ? StubLinkProvider.links : undefined)
  }
  dispose() {}
}

/**
 * Everything the pool imports from the emulator's package, as a `vi.mock` factory.
 *
 * One place, because six specs mocking the same package separately is how they drift — and the pool's own
 * spec deliberately does not use it, needing to record what each emulator was *built* with.
 */
export async function emulatorModule() {
  const support = await import('./terminal-emulator.ts')
  return {
    init: support.init,
    Terminal: support.RecordedTerminal,
    FitAddon: support.StubAddon,
    OSC8LinkProvider: support.StubLinkProvider,
    UrlRegexProvider: support.StubLinkProvider
  }
}

/** The emulators the pool has constructed, in the order it constructed them — one per session */
export const emulators: StubTerminal[] = []

export class RecordedTerminal extends StubTerminal {
  constructor() {
    super()
    emulators.push(this)
  }
}

/** The emulator of the session created last, which in a host's case is the one it is drawing */
export const lastEmulator = (): StubTerminal => {
  const emulator = emulators.at(-1)
  if (!emulator) throw new Error('No emulator has been constructed: nothing has called terminalPool.ensure')
  return emulator
}

/**
 * The size observer the pool's attachment takes per host, which jsdom has no notion of. One that never
 * fires is enough for a host's cases: nothing in jsdom lays anything out, so a resize a host is told about
 * is one a case drives through the emulator.
 */
export function installDomStubs(): void {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver
}
