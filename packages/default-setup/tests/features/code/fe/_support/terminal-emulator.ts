// The emulator, as jsdom can hold one.
//
// xterm needs a canvas and a GL context jsdom has neither of, so a terminal host's cases stand in for it
// with this. What the stand-in is for is the *driving*: a host wires itself to the emulator through the
// pool's attachment, and the only way to assert what it does with what the emulator reports is to report
// something. So each instance records what was done to it and hands back the handlers it was given.
//
// Nothing here asserts anything about how xterm draws, and no case over it should.

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

export class StubTerminal {
  element = document.createElement('div')
  cols = 80
  rows = 24
  unicode = { activeVersion: '6' }
  /** Everything written into this emulator, the pool's own banners included */
  written: string[] = []
  pasted: string[] = []
  focused = 0
  cleared = 0
  disposed = 0
  selection = ''
  readonly data = new Emitter<string>()
  readonly resized = new Emitter<{ cols: number; rows: number }>()
  readonly writeParsed = new Emitter<void>()
  readonly selectionChanged = new Emitter<void>()

  loadAddon() {}
  open(host: HTMLElement) { host.appendChild(this.element) }
  write(data: string, done?: () => void) { this.written.push(data); done?.() }
  paste(data: string) { this.pasted.push(data) }
  onData(handler: (data: string) => void) { return this.data.listen(handler) }
  onResize(handler: (size: { cols: number; rows: number }) => void) { return this.resized.listen(handler) }
  onWriteParsed(handler: () => void) { return this.writeParsed.listen(handler) }
  onSelectionChange(handler: () => void) { return this.selectionChanged.listen(handler) }
  attachCustomKeyEventHandler() {}
  getSelection() { return this.selection }
  selectAll() { this.selection = this.written.join('') }
  clear() { this.cleared += 1 }
  focus() { this.focused += 1 }
  scrollToBottom() {}
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
}

/** Every addon the pool loads. Each is inert: what they do needs a renderer, and none of it is under test */
export class StubAddon {
  activate() {}
  dispose() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 } }
  onContextLoss() {}
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
