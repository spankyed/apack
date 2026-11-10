// `apack-terminal-view`, as much of it as the code surface's pool uses, standing in for the real one.
//
// The real view paints on a canvas and speaks to a broker, neither of which a case about the pool or a
// host has: what they are about is which session a terminal is drawn from, where it is mounted, and what
// the host is told. So the stand-in records exactly that — every view made, with the session it was made
// for and what was asked of it — and lets a case say what a real view would have reported.
import type { ViewOptions } from 'apack-terminal-view'

export interface FakeView {
  readonly session: string
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
  /** What a real view reports once it has measured how many cells fit its host */
  reportFit(columns: number, rows: number, cellWidth?: number, cellHeight?: number): void
  reportFollowing(following: boolean): void
  reportSelection(selected: boolean): void
}

/** Every view the pool has made, oldest first */
export const views: FakeView[] = []
/** How many connections to the broker have been asked for */
export const connections = { opened: 0, closed: 0 }

export const lastView = (): FakeView => {
  const view = views.at(-1)
  if (!view) throw new Error('The pool has made no view')
  return view
}

/** What `vi.mock('apack-terminal-view', …)` answers with */
export function viewModule(): Record<string, unknown> {
  class BrokerViews {
    constructor() { connections.opened += 1 }
    open(session: string): { session: string } { return { session } }
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

    constructor(source: { session: string }, readonly options: ViewOptions) {
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
    fit(): void { this.fits += 1 }
    follow(): void { this.followed += 1; this.options.onFollowingChange?.(true) }
    clear(): void { this.cleared += 1 }
    selectAll(): void { this.selectedAll += 1 }
    async paste(text: string): Promise<void> { this.pasted.push(text) }
    async copy(): Promise<boolean> { this.copies += 1; return true }

    reportFit(columns: number, rows: number, cellWidth = 8, cellHeight = 16): void {
      this.options.onFit?.({ columns, rows, cellWidth, cellHeight })
    }
    reportFollowing(following: boolean): void { this.options.onFollowingChange?.(following) }
    reportSelection(selected: boolean): void { this.options.onSelectionChange?.(selected) }
  }

  return { BrokerViews, TerminalView, xtermPalette: (ansi: readonly number[]) => [...ansi] }
}
