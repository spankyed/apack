import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalEventBus } from './terminal-events.ts'
import { openLink } from '@apackdev/sdk/fe'
import type { TerminalInfo } from '../features/terminal/state.ts'
import '@xterm/xterm/css/xterm.css'

/**
 * **The feature's seam to its emulator.** Every xterm.js instance the code surface has is here, and this is
 * the only module that imports `@xterm/*` at all — the hosts that draw a terminal hold a `TerminalAttachment`
 * and no emulator type, so replacing xterm is an implementation swap behind this file rather than a second
 * rewrite of who owns what. That is what the goal's D10 keeps open and what its Phase P is for.
 *
 * Each entry owns a detached wrapper div with a terminal mounted into it, and a host re-parents that wrapper
 * into its own container. The emulator survives a host's teardown, so there is no replay-on-remount cycle
 * and no class of bugs where synthesized DA/DSR/OSC responses get forwarded to the pty — and measured, a
 * reattach with 256 KiB of history costs 5.55 ms and not one message.
 *
 * The pool is the sole subscriber to `terminalEventBus` for each terminal, so pty output is written into the
 * emulator whether or not any host is mounted.
 */

/**
 * How long a fit has to settle before the pty is told.
 *
 * **A coalescing window, not a deadline** — nothing fails when it elapses, and nothing waits on it: the
 * emulator has already reflowed and the user is already looking at the new size. What it bounds is how often
 * the *other* end hears, and the other end is a pty whose every resize sends `SIGWINCH` to whatever is
 * running in it. One frame of a drag is 16ms, so this is a handful of frames: short enough that releasing the
 * mouse feels immediate, long enough that a drag is one resize rather than the two dozen it observes.
 */
export const RESIZE_SETTLE_MS = 100

const THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
} as const

/**
 * One session's emulator and the bookkeeping that outlives a host.
 *
 * **Not exported**, which is what makes this module's public surface emulator-agnostic: it names `Terminal`,
 * `FitAddon` and `WebglAddon`, and a host that could hold one would be coupled to xterm through a type even
 * while calling nothing on it. What a host gets is a `TerminalAttachment`.
 */
interface PoolEntry {
  terminalId: string
  /**
   * The pty this entry's buffer was written by. A restored terminal keeps its id and gets a **new**
   * process (`restoreAll` in the backend's terminal service spawns one and calls `updatePid`), so the id
   * cannot say whether what is on screen came from the shell that is answering now. The pid can.
   */
  pid: number | null
  /** Whether this generation's death has already been written on the screen, so it is written once */
  exitNoted?: boolean
  /**
   * Set while a grid the host accepted is being applied, so the feed that reports what this window *fitted*
   * stays quiet.
   *
   * Applying is not fitting. The emulator raises its own `resize` either way, and reporting this one would
   * send the host back the very grid it had just sent — two windows handing one size to each other.
   */
  applying?: boolean
  term: Terminal
  fitAddon: FitAddon
  wrapper: HTMLDivElement
  disposables: IDisposable[]
  attachedContainer: HTMLElement | null
  isShowingLoadingContent: boolean
  // Scroll state lives here (not in TerminalView.vue) so it survives the
  // unmount/remount that happens on every tab switch. `wrapper.remove()` in
  // detach() also resets the scrolling element's scrollTop in Chromium, so on
  // every attach we re-drive the DOM scroll position ourselves rather than
  // relying on the emulator's own scroll-to-bottom, which xterm makes a no-op
  // when ydisp === ybase.
  pinnedToBottom: boolean
  savedScrollFraction: number | null
  webglLoaded: boolean
  webglAddon: WebglAddon | null
  /** The emulator's scrolling element once found, re-derived if the emulator rebuilds its DOM */
  scroller: HTMLElement | null
}

/**
 * Written into a terminal whose pty was replaced under it.
 *
 * A restored terminal is a new shell in the old one's working directory: the process that was running is
 * gone, and so is everything it had not yet printed. The buffer above the seam survived only because this
 * pool outlives the backend, which makes the screen read as one continuous session when it is two. Without
 * this line nothing distinguishes a shell that has been running all along from one that started a second
 * ago in the same directory.
 */
/**
 * What a shell that died badly leaves on the screen.
 *
 * **The terminal stays open for this line.** A shell that exits 0 closes its terminal, and a user who typed
 * `exit` wants it gone; a shell that segfaults, is OOM-killed or fails under `set -e` leaves the reason on
 * the screen above, and closing the window takes the one thing they need with it.
 */
const exitedNotice = (code: number | null) =>
  `\r\n\x1b[31m── the shell ended ${code === null ? 'without a status (a signal)' : `with status ${code}`}`
  + ` — nothing below this line is from it ──\x1b[0m\r\n`

const restartedNotice = (pid: number) =>
  `\r\n\x1b[90m── new shell (pid ${pid}) — the previous session ended; nothing above is from this one ──\x1b[0m\r\n`

const showLoadingContent = (term: Terminal, info: TerminalInfo) => {
  term.write('\x1b[1;36m🚀 Starting terminal...\x1b[0m\r\n')
  term.write('\x1b[90mConnecting to shell: \x1b[0m' + (info.shell || 'default') + '\r\n')
  term.write('\x1b[90mWorking directory: \x1b[0m' + info.cwd + '\r\n\r\n')
}

/**
 * What a host that is drawing a terminal can do to it. **No emulator type crosses this line**: a host holds
 * one of these and a container, which is the whole of its reach into the terminal.
 *
 * It owns what belongs to *this* host — the size observer, the scroll and selection listeners — so a host
 * ends by releasing it rather than by unwinding a list of disposables and remembering to name its own
 * container. **That is F1 by construction**: a host that has been taken over from has already released, and
 * a released attachment detaches nothing.
 */
export interface TerminalAttachment {
  readonly terminalId: string
  /** What the user has selected, empty when nothing is */
  selection(): string
  selectAll(): void
  /**
   * Through the emulator, which wraps the text in the bracketed-paste markers when the application has asked
   * for them — how a shell or an editor tells a paste from typing. Sent as input, a pasted newline runs a
   * command (F12).
   */
  paste(text: string): void
  clear(): void
  /** Only where the user asked for it: an attach is not a request (F15) */
  focus(): void
  /**
   * Size the terminal to its host now, rather than waiting for the size observer.
   *
   * The observer covers every resize on its own; this is for a host that is *driving* one frame by frame —
   * the panel's list divider being dragged — where waiting a layout pass behind the drag is visible.
   */
  refit(): void
  /** Follow the output again, from wherever the user had scrolled back to */
  followOutput(): void
  /** This host is done. Idempotent, and a no-op once another host has taken the terminal over */
  release(): void
}

/** What a host wants to hear about. Each is optional: a host that does not draw a control does not ask */
export interface TerminalAttachmentHandlers {
  /** The emulator sized itself to this host, and the pty is the caller's to tell */
  onResize?(size: { cols: number; rows: number }): void
  onSelectionChange?(hasSelection: boolean): void
  /** Whether the session is following its output, which a host draws a scroll control from */
  onFollowingChange?(following: boolean): void
}

/**
 * The first element at or under `root` that scrolls vertically, depth-first so the search stops at it.
 *
 * Exported for its own cases: it is the whole of `getViewport`'s rule, it takes and returns nothing but DOM,
 * and the pool's own specs stand in for the emulator with an element that scrolls nothing.
 */
export function findScroller(root: HTMLElement): HTMLElement | null {
  const overflow = getComputedStyle(root).overflowY
  if (overflow === 'scroll' || overflow === 'auto') return root
  for (const child of root.children) {
    const found = findScroller(child as HTMLElement)
    if (found) return found
  }
  return null
}

class TerminalPool {
  private entries = new Map<string, PoolEntry>()

  get(terminalId: string): PoolEntry | undefined {
    return this.entries.get(terminalId)
  }

  /**
   * Says on the screen that the shell behind this terminal has gone.
   *
   * Written once per death: a second `CRASHED` for the same terminal is the same news arriving twice, and
   * two lines would read as two shells having died.
   */
  noteExit(terminalId: string, code: number | null): void {
    const entry = this.entries.get(terminalId)
    if (!entry || entry.exitNoted) return
    entry.exitNoted = true
    entry.term.write(exitedNotice(code))
  }

  /**
   * A new generation is running under this terminal.
   *
   * **One seam per boundary, wherever the news arrives from.** A crash already drew the line, so this takes
   * the new pid quietly; a restart of a shell that was still running has drawn nothing, so it draws. Without
   * taking the pid, the next list to arrive would find a pid it did not know and write a second seam below
   * whatever the new shell had printed by then — a line about a death, placed after the life that followed
   * it.
   */
  noteRestart(terminalId: string, pid: number | null): void {
    const entry = this.entries.get(terminalId)
    if (entry) this.markRestart(entry, pid)
  }

  /**
   * Marks the seam when an entry's pty has been replaced, and records the one answering now.
   *
   * **The one-seam rule lives here and not in its callers**, because the news reaches this screen by two
   * routes and only one of them is `terminal.RESTARTED`. `restoreAll` broadcasts nothing, so after a backend
   * restart a replaced pty is learnt from a refreshed list instead — `syncProcesses`, straight into here —
   * and a window that had already drawn the crash line would draw a restart line under it for the same
   * death. The same holds for any window that missed a broadcast: a surface starting, a reconnect, an
   * explicit refresh.
   */
  private markRestart(entry: PoolEntry, pid: number | null): void {
    if (pid === entry.pid) return
    // **An unknown pid on either side cannot tell one shell from another, so it draws nothing.** The host
    // answers none for a session it took up again rather than started, and that is the case where there is
    // certainly no boundary: the shell is the one whose output is already on this screen. Taking the value
    // quietly is what keeps the next real change a boundary again.
    if (pid === null || entry.pid === null) {
      entry.pid = pid
      // The boundary is real even where neither side can be told apart by a number, so the next death is
      // news again. Left set, a terminal whose first shell was an adopted session — pid unknown — had its
      // crash drawn, took a restart with a real pid here, and then died with nothing written on the screen
      entry.exitNoted = false
      return
    }
    // A crash already drew the line for this boundary, so the new pid is taken quietly; a restart of a shell
    // that was still running has drawn nothing, so it draws. Either way a new shell is running, which makes
    // the next death news again
    const drawn = entry.exitNoted === true
    entry.pid = pid
    entry.exitNoted = false
    if (!drawn) entry.term.write(restartedNotice(pid))
  }

  /**
   * Draws this terminal at the grid its pty is actually running at.
   *
   * **A window renders the accepted grid rather than the one it fitted** (M2). A pty has one `(cols, rows)`,
   * so one window owns the size and the rest are told what is in force — and a window that is told and does
   * nothing with it goes on drawing at a width nothing agreed to, which is the whole symptom the refusal
   * exists to remove. Storing the number without applying it leaves the contract half-kept.
   *
   * Nothing is reported back: see `applying`.
   */
  applyGrid(terminalId: string, cols: number, rows: number): void {
    const entry = this.entries.get(terminalId)
    if (!entry || cols < 1 || rows < 1) return
    if (entry.term.cols === cols && entry.term.rows === rows) return
    entry.applying = true
    try { entry.term.resize(cols, rows) } finally { entry.applying = false }
  }

  /**
   * Reconciles the pool against the backend's list of terminals.
   *
   * Called wherever that list arrives rather than from `ensure`, which runs on mount: a backend that
   * restarts while the terminal view is open replaces every pty without unmounting anything, which is
   * exactly the case where the screen is most misleading and `ensure` is never reached.
   */
  syncProcesses(infos: readonly TerminalInfo[]): void {
    for (const info of infos) {
      const entry = this.entries.get(info.id)
      if (entry) this.markRestart(entry, info.pid)
    }
  }

  /**
   * Returns an existing entry or constructs a new one. Pass `sendInput` as the
   * callback to forward xterm's onData (user input + synthesized responses
   * from live queries) to the backend pty. The callback is wired only AFTER
   * any replay from terminalEventBus has been fully parsed, so
   * synthesized responses during the replay are dropped.
   */
  ensure(info: TerminalInfo, sendInput: (data: string) => void): PoolEntry {
    const existing = this.entries.get(info.id)
    if (existing) {
      // **A mounting component's descriptor does not decide which shell is answering.** This runs on every
      // mount, and a host can hold a frozen one — `TerminalView` is handed `props.terminalInfo` and never
      // refreshes it — so reconciling the pid here read a stale number as a boundary: a tab switched away
      // and back drew a seam naming the *previous* shell and set the entry's pid to it, which made the next
      // list a boundary again, and so on. What is authoritative is where the news arrives, `noteRestart`
      // and `syncProcesses`, and the surface asks for a list as it starts, so nothing is missed by this
      // saying nothing.
      return existing
    }
    this.listenForPaste()

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Cascadia Code, Fira Code, Menlo, monospace',
      fontSize: 14,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      // **The host's number, not one pinned here.** The emulator must not hold more than the session does:
      // a window drawing 10,000 lines against a broker keeping 1,000 showed nine tenths that no reattach
      // could reproduce. `info.scrollback` comes from the broker's handshake.
      scrollback: info.scrollback,
      cols: info.cols || 80,
      rows: info.rows || 24,
      theme: { ...THEME }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon((_event, url) => {
      openLink(url)
    }))
    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'
    term.loadAddon(new ClipboardAddon())

    const wrapper = document.createElement('div')
    wrapper.style.height = '100%'
    wrapper.style.width = '100%'

    term.open(wrapper)
    // WebGL addon is loaded later in attach() — see comment there.
    if (term.element) term.element.style.height = '100%'

    const entry: PoolEntry = {
      terminalId: info.id,
      // Recorded, never announced: a buffer with nothing above the seam has no continuity to correct
      pid: info.pid,
      term,
      fitAddon,
      wrapper,
      disposables: [],
      attachedContainer: null,
      isShowingLoadingContent: false,
      pinnedToBottom: true,
      savedScrollFraction: null,
      webglLoaded: false,
      webglAddon: null,
      scroller: null
    }

    // Shift+Enter inserts a newline instead of executing. Wired once here
    // because attachCustomKeyEventHandler is a setter, not an event.
    term.attachCustomKeyEventHandler((event) => {
      // Shift+Enter → literal newline
      if (event.type === 'keydown' && (event.key === 'Enter' || event.keyCode === 13) && event.shiftKey) {
        sendInput('\n')
        event.preventDefault()
        event.stopPropagation()
        return false
      }

      // Ctrl+Shift+C → copy selection (Windows/Linux terminal convention)
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = term.getSelection()
        // A clipboard permission the window does not have rejects; unhandled, that is a console error
        // nobody can act on (F16)
        if (selection) void navigator.clipboard.writeText(selection).catch(() => {})
        return false
      }

      // Ctrl+Shift+V → paste from clipboard (Windows/Linux terminal convention)
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'V') {
        // **`term.paste` rather than a raw write** (F12): xterm wraps it in the bracketed-paste markers
        // when the application has asked for them, which is how a shell or an editor tells a paste from
        // typing — without it, a pasted newline runs a command.
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text)
        }).catch(() => {})
        return false
      }

      return true
    })

    // Subscribe to pty output for this terminal. This happens BEFORE the replay
    // so writes are queued in order behind it (xterm processes writes
    // FIFO, so cbReplay fires before any live data is parsed).
    const unsubscribe = terminalEventBus.subscribe(info.id, (_id, data) => {
      if (entry.isShowingLoadingContent) {
        term.clear()
        entry.isShowingLoadingContent = false
      }
      term.write(data)
    })
    entry.disposables.push({ dispose: unsubscribe })

    // **Nothing is replayed, because nothing keeps a copy to replay from.** The byte log and its window
    // storage are deleted (F3, F6): the scrollback lives in this emulator, which the pool keeps alive across
    // a host's teardown — so a tab switch costs 5.55 ms and no bytes, measured. A *fresh* emulator starts
    // fresh, and serving history for that case is the broker's bounded history, where one copy belongs.
    showLoadingContent(term, info)
    entry.isShowingLoadingContent = true
    entry.disposables.push(term.onData(sendInput))

    this.entries.set(info.id, entry)
    return entry
  }

  /**
   * Draws this terminal in `host`, and hands back what that host may do to it.
   *
   * Everything a host used to wire for itself is wired here once: the fit on the next frame, the viewport's
   * scroll listener, the pin-aware scroll on each write, the selection tracking and the size observer. Two
   * hosts wired them separately before, and the two halves of that are F1 and F2 — one of them scrolled on
   * every write while the other honoured where the user had scrolled back to.
   */
  attach(terminalId: string, host: HTMLElement, handlers: TerminalAttachmentHandlers = {}): TerminalAttachment | null {
    const entry = this.attachWrapper(terminalId, host)
    if (!entry) return null

    const term = entry.term
    const own: Array<() => void> = []
    let released = false

    /**
     * Tells the host what this emulator fitted to — **once per settled drag, not once per frame.**
     *
     * Every notification here ends in a pty resize, and a pty resize sends `SIGWINCH` to the foreground
     * process: a drag produces one fit per observed frame (24 per action, measured), so an unthrottled feed
     * told `vim` to redraw two dozen times mid-drag and sent two dozen events across the bus to do it. The
     * emulator reflows locally on its own `resize`, so what the window shows is already immediate; the only
     * thing waiting is the pty learning the final grid, which is the one thing that need not be per frame.
     *
     * A quiet call fires at once, which is what an attach and a tab switch are. A burst coalesces to its
     * last, read when the timer fires rather than when it was set, so the grid sent is the grid now.
     */
    let settling: ReturnType<typeof setTimeout> | undefined
    let toldAt = 0
    const tell = () => {
      if (released || entry.applying) return
      toldAt = Date.now()
      handlers.onResize?.({ cols: term.cols, rows: term.rows })
    }
    const tellSettled = () => {
      if (released || settling || entry.applying) return
      const since = Date.now() - toldAt
      if (since >= RESIZE_SETTLE_MS) { tell(); return }
      settling = setTimeout(() => { settling = undefined; tell() }, RESIZE_SETTLE_MS - since)
    }
    own.push(() => { if (settling) clearTimeout(settling) })

    const report = () => {
      const viewport = this.getViewport(entry)
      if (!viewport) return
      const following = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 10
      entry.pinnedToBottom = following
      handlers.onFollowingChange?.(following)
    }

    // Deferred a frame so the browser has laid out the re-attached wrapper and the host's dimensions are
    // what the cols/rows are computed from
    requestAnimationFrame(() => {
      if (released) return
      entry.fitAddon.fit()
      tellSettled()
      this.syncViewport(terminalId)
    })

    const viewport = this.getViewport(entry)
    if (viewport) {
      viewport.addEventListener('scroll', report, { passive: true })
      own.push(() => viewport.removeEventListener('scroll', report))
    }

    const selection = term.onSelectionChange(() => handlers.onSelectionChange?.(term.getSelection() !== ''))
    const written = term.onWriteParsed(() => {
      // **One policy per session, whichever host is drawing it** (F2): during a live write the emulator's own
      // follow works, so this is the cheap in-tree scroll rather than a round trip through the viewport
      if (entry.pinnedToBottom) term.scrollToBottom()
    })
    const resized = term.onResize(() => tellSettled())
    own.push(() => selection.dispose(), () => written.dispose(), () => resized.dispose())

    const observer = new ResizeObserver(() => {
      entry.fitAddon.fit()
      tellSettled()
      if (entry.pinnedToBottom) this.syncViewport(terminalId)
    })
    observer.observe(host)
    own.push(() => observer.disconnect())

    handlers.onFollowingChange?.(entry.pinnedToBottom)

    return {
      terminalId,
      selection: () => term.getSelection(),
      selectAll: () => term.selectAll(),
      paste: (text) => term.paste(text),
      clear: () => term.clear(),
      focus: () => term.focus(),
      refit: () => {
        if (released) return
        entry.fitAddon.fit()
        tellSettled()
      },
      followOutput: () => {
        entry.pinnedToBottom = true
        handlers.onFollowingChange?.(true)
        this.syncViewport(terminalId)
      },
      release: () => {
        if (released) return
        released = true
        for (const undo of own) {
          try { undo() } catch { /* a listener on an element already gone */ }
        }
        own.length = 0
        this.detach(terminalId, host)
      },
    }
  }

  /** The wrapper into the host, and the renderer that needs live DOM metrics to size itself */
  private attachWrapper(terminalId: string, host: HTMLElement): PoolEntry | null {
    const entry = this.entries.get(terminalId)
    if (!entry) return null

    if (entry.attachedContainer && entry.attachedContainer !== host) {
      entry.wrapper.remove()
    }
    host.appendChild(entry.wrapper)
    entry.attachedContainer = host
    // Load WebGL on first in-DOM attach so the GL canvas is sized from live
    // DOM metrics rather than a detached wrapper with zero dimensions.
    if (!entry.webglLoaded) {
      const addon = new WebglAddon()
      // **A lost GL context draws nothing until something gives it up** (F10). The browser takes the context
      // back under memory pressure, on a GPU reset, or when too many are live — and xterm's addon reports it
      // rather than recovering, so the terminal goes blank and stays blank. Disposing the addon drops xterm
      // to its DOM renderer, which is slower and still draws.
      addon.onContextLoss(() => {
        try { addon.dispose() } catch { /* already disposed with the context */ }
        if (entry.webglAddon === addon) entry.webglAddon = null
      })
      try { entry.term.loadAddon(addon); entry.webglAddon = addon } catch { /* falls back to canvas renderer */ }
      entry.webglLoaded = true
    }
    return entry
  }

  /**
   * Detach the wrapper from its host without disposing the xterm.
   *
   * **`host` is checked, not trusted** (F1). Two hosts can be mounted for one terminal during a remount —
   * the new one attaches before the old one unmounts — and a detach that did not say whose it was tore the
   * wrapper out of whichever host happened to hold it, leaving the live one blank. A host that is no longer
   * the attached one detaches nothing.
   */
  detach(terminalId: string, host?: HTMLElement): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    if (host && entry.attachedContainer !== host) return
    // Capture scrollTop before wrapper.remove() — Chromium zeroes it on
    // document-remove. Used by syncViewport() on the next attach when the
    // user isn't pinned to bottom.
    const viewport = this.getViewport(entry)
    if (viewport && viewport.scrollHeight > 0) {
      entry.savedScrollFraction = viewport.scrollTop / viewport.scrollHeight
    }
    entry.wrapper.remove()
    entry.attachedContainer = null
  }

  /**
   * Whether this session is following its output — **one policy per session, whichever host is drawing it**
   * (F2). The canvas honoured it and the panel scrolled to the bottom on every write, so the same terminal
   * jumped under the user in one host and not the other, and scrolling back in the panel was impossible
   * while anything was writing. A session has one scroll position because it has one buffer.
   *
   * A host reads it through its attachment's `onFollowingChange`; this answers for a session no host has
   * opened, which is a new one and follows its output.
   */
  isFollowingOutput(terminalId: string): boolean {
    return this.entries.get(terminalId)?.pinnedToBottom ?? true
  }

  /**
   * Force the native scrollbar to match the desired viewport position after
   * attach/fit. Uses term.write('', cb) as the wait primitive so the callback
   * fires only after every queued xterm write has been fully parsed — this
   * handles a large replay that may still be parsing when we'd otherwise race.
   * Reading scrollHeight synchronously forces layout, so the viewport spacer
   * is up to date when we write scrollTop.
   *
   * We write scrollTop directly (rather than calling term.scrollToBottom())
   * because xterm's scrollToBottom is a no-op when ydisp === ybase — always
   * true on tab-switch remount, when wrapper.remove() has just zeroed the
   * DOM scrollTop but the xterm buffer pointers are unchanged.
   */
  syncViewport(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    entry.term.write('', () => {
      const current = this.entries.get(terminalId)
      if (!current || !current.attachedContainer) return
      // Defer to next frame so the browser has laid out the re-attached wrapper
      // and scrollHeight reflects the current content.
      requestAnimationFrame(() => {
        const viewport = this.getViewport(current)
        if (!viewport) return
        if (current.pinnedToBottom) {
          viewport.scrollTop = viewport.scrollHeight
        } else if (current.savedScrollFraction != null) {
          viewport.scrollTop = current.savedScrollFraction * viewport.scrollHeight
        }
      })
    })
  }

  /**
   * The element the emulator scrolls, found by what it **is** rather than by what it is called.
   *
   * A scroller is an element whose computed `overflow-y` scrolls, which is true of whichever emulator draws
   * here; a class name is true of one of them. That matters because this file is the seam the emulator is
   * replaceable behind (the goal's D10), and the replacement's own capability matrix asks for exactly this —
   * *observe scroll position and restore pinned/unpinned state without depending on xterm DOM classes*.
   *
   * Cached per entry, because this is read on every scroll event and `getComputedStyle` resolves style. The
   * cache is checked against the emulator's own root rather than `isConnected`, so it survives the detached
   * spell between two hosts — a re-parent is the pool's normal lifecycle, not a rebuild.
   */
  private getViewport(entry: PoolEntry): HTMLElement | null {
    const root = entry.term.element
    if (!root) return null
    if (entry.scroller && root.contains(entry.scroller)) return entry.scroller
    entry.scroller = findScroller(root)
    return entry.scroller
  }

  /** Find a pool entry whose wrapper contains the given DOM element. */
  findByElement(el: HTMLElement): PoolEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.wrapper.contains(el)) return entry
    }
    return undefined
  }

  /** Dispose xterm + all wire-level disposables. Call on terminal.CLOSED. */
  dispose(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return

    for (const d of entry.disposables) {
      try { d.dispose() } catch (e) { console.error('[terminalPool] dispose failed:', e) }
    }
    entry.disposables.length = 0

    // Dispose WebGL addon explicitly before the terminal — its internal
    // disposables can reference a lost GL context, which crashes inside
    // xterm's generic AddonManager.dispose() iteration.
    if (entry.webglAddon) {
      try { entry.webglAddon.dispose() } catch { /* GL context may already be lost */ }
      entry.webglAddon = null
    }

    // Detach from DOM before disposing so the GL canvas tears down cleanly.
    entry.wrapper.remove()
    entry.attachedContainer = null

    try { entry.term.dispose() } catch (e) { console.error('[terminalPool] term.dispose failed:', e) }
    this.entries.delete(terminalId)
    if (this.entries.size === 0) this.stopListeningForPaste()
  }

  /**
   * Every emulator this pool is holding, disposed.
   *
   * **For the end of the frontend that holds the pool, which is the only lifetime a module singleton has.**
   * A component releases its terminal on unmount and deliberately does not dispose it, so a remount draws
   * the same emulator again — right while this bundle is alive, and a leak once it is not: a reload imports
   * a fresh module with a fresh pool, and the last one's xterm instances, DOM and GL contexts are kept alive
   * by the window with nothing left that could reach them.
   *
   * The code surface's machine calls this as it stops, which is when the shell replaces this pack's
   * frontend. **It ends no shell**: a session lives in the broker and survives the window that drew it, so
   * what this disposes is the drawing and never the terminal (`services.terminal`'s `kill` is that, and only
   * the user asks for it).
   */
  disposeAll(): void {
    // Taken first, because `dispose` removes from the map it would otherwise be iterating
    const held = Array.from(this.entries.keys())
    for (const terminalId of held) this.dispose(terminalId)
  }

  /**
   * A paste the window delivered as an event, pasted through the emulator rather than sent as input.
   *
   * **The listener is the pool's, and its lifetime is the pool's sessions** — installed with the first and
   * taken back with the last. Registered at module scope instead it was never removed, so each reload of this
   * pack's frontend left another one behind holding a pool whose emulators were disposed. The pool itself is
   * owned by the code surface's machine, which disposes it as it stops (`poolOwner`, `fe/state.ts`); within
   * that, its sessions are the only lifetime this listener has to offer.
   */
  private paste: EventListener | null = null

  private listenForPaste(): void {
    if (this.paste) return
    this.paste = ((event: CustomEvent<{ text: string }>) => {
      const el = event.target as HTMLElement
      const entry = this.findByElement(el)
      if (!entry) return
      event.preventDefault()
      el.focus()
      entry.term.paste(event.detail.text)
    }) as EventListener
    document.addEventListener('apack:paste', this.paste)
  }

  private stopListeningForPaste(): void {
    if (!this.paste) return
    document.removeEventListener('apack:paste', this.paste)
    this.paste = null
  }
}

export const terminalPool = new TerminalPool()
