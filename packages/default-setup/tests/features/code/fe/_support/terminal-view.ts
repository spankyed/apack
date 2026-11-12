// `apack-terminal-view`, as much of it as the code surface's pool uses, standing in for the real one.
//
// The real view paints on a canvas and speaks to a broker, neither of which a case about the pool or a
// host has: what they are about is which session a terminal is drawn from, where it is mounted, and what
// the host is told. So the stand-in records exactly that — every view made, with the session it was made
// for and what was asked of it — and lets a case say what a real view would have reported.
import type { Command, ViewOptions } from 'apack-terminal-view'

export interface FakeView {
  readonly session: string
  /** Whether a selection is copied as the pointer is let go, as the view was last told */
  readonly copyOnSelect: boolean
  setCopyOnSelect(on: boolean): void
  readonly element: HTMLDivElement
  readonly options: ViewOptions
  /** The element it is mounted in, or `null` while no host has it */
  mountedIn: HTMLElement | null
  mounts: number
  disposed: boolean
  focused: number
  fits: number
  followed: number
  cleared: number
  selectedAll: number
  readonly pasted: string[]
  copies: number
  /** What the view was asked to find, in order, and how many matches each search is said to have */
  readonly searches: string[]
  matches: number
  /** Which match it is on, from one */
  current: number
  /** The commands the session's shell is said to have marked, and the ones whose output was selected */
  commands: Command[]
  readonly selectedOutputs: number[]
  /** What a real view reports once it has measured how many cells fit its host */
  reportFit(columns: number, rows: number, cellWidth?: number, cellHeight?: number): void
  reportFollowing(following: boolean): void
  reportSelection(selected: boolean): void
}

/** A connection to a broker that a case holds the far end of: what arrives on it and when it ends are the case's to say */
export interface FakeStream {
  readonly target: string | undefined
  closed: number
  /** Bytes arrive, as they do once a broker has answered */
  answer(): void
  /** The connection ends without the window having closed it */
  drop(): void
  send(): void
  onData(listener: (chunk: Uint8Array) => void): () => void
  onClose(listener: () => void): () => void
  close(): void
}

export function fakeStream(target?: string): FakeStream {
  const data = new Set<(chunk: Uint8Array) => void>()
  const closing = new Set<() => void>()
  return {
    target,
    closed: 0,
    answer() { for (const listener of data) listener(Uint8Array.of(0)) },
    drop() { for (const listener of closing) listener() },
    send() {},
    onData(listener) { data.add(listener); return () => { data.delete(listener) } },
    onClose(listener) { closing.add(listener); return () => { closing.delete(listener) } },
    close() { this.closed += 1 },
  }
}

/** Every view the pool has made, oldest first */
export const views: FakeView[] = []
/** How many connections to the broker have been asked for */
export const connections: { opened: number; closed: number; targets: Array<string | undefined> } = { opened: 0, closed: 0, targets: [] }

export const lastView = (): FakeView => {
  const view = views.at(-1)
  if (!view) throw new Error('The pool has made no view')
  return view
}

/** What `vi.mock('apack-terminal-view', …)` answers with */
export function viewModule(): Record<string, unknown> {
  class BrokerViews {
    private readonly closing = new Set<() => void>()
    constructor(stream: { target?: string }) { connections.opened += 1; connections.targets.push(stream?.target) }
    open(session: string): { session: string } { return { session } }
    onClose(listener: () => void): () => void { this.closing.add(listener); return () => { this.closing.delete(listener) } }
    close(): void { connections.closed += 1 }
  }

  class TerminalView implements FakeView {
    readonly session: string
    readonly element = document.createElement('div')
    mountedIn: HTMLElement | null = null
    mounts = 0
    disposed = false
    focused = 0
    fits = 0
    followed = 0
    cleared = 0
    selectedAll = 0
    readonly pasted: string[] = []
    copies = 0
    readonly searches: string[] = []
    matches = 0
    current = 0
    commands: Command[] = []
    readonly selectedOutputs: number[] = []
    /** Whether a selection is copied as the pointer is let go, as the view was last told */
    copyOnSelect: boolean

    constructor(source: { session: string }, readonly options: ViewOptions) {
      this.copyOnSelect = options.copyOnSelect ?? false
      this.session = source.session
      views.push(this)
    }

    mount(host: HTMLElement): void {
      host.appendChild(this.element)
      this.mountedIn = host
      this.mounts += 1
    }
    unmount(): void {
      this.element.remove()
      this.mountedIn = null
    }
    dispose(): void {
      this.unmount()
      this.disposed = true
    }
    focus(): void { this.focused += 1 }
    setCopyOnSelect(on: boolean): void { this.copyOnSelect = on }
    fit(): void { this.fits += 1 }
    follow(): void { this.followed += 1; this.options.onFollowingChange?.(true) }
    clear(): void { this.cleared += 1 }
    selectAll(): void { this.selectedAll += 1 }
    async paste(text: string): Promise<void> { this.pasted.push(text) }
    async copy(): Promise<boolean> { this.copies += 1; return true }
    async find(needle: string): Promise<number> {
      this.searches.push(needle)
      const total = needle === '' ? 0 : this.matches
      this.current = total > 0 ? 1 : 0
      return total
    }
    get found(): { current: number; total: number } {
      return { current: this.current, total: this.searches.at(-1) ? this.matches : 0 }
    }
    findNext(direction: -1 | 1 = 1): void {
      if (this.matches > 0) this.current = ((this.current - 1 + direction + this.matches) % this.matches) + 1
    }
    selectOutput(command: Command): boolean {
      this.selectedOutputs.push(command.id)
      return command.output !== null
    }

    reportFit(columns: number, rows: number, cellWidth = 8, cellHeight = 16): void {
      this.options.onFit?.({ columns, rows, cellWidth, cellHeight })
    }
    reportFollowing(following: boolean): void { this.options.onFollowingChange?.(following) }
    reportSelection(selected: boolean): void { this.options.onSelectionChange?.(selected) }
  }

  return { BrokerViews, TerminalView, xtermPalette: (ansi: readonly number[]) => [...ansi] }
}
