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
 * Long-lived xterm.js instance pool keyed by terminal id.
 *
 * Each entry owns a detached wrapper div with a Terminal mounted into it.
 * TerminalView.vue re-parents the wrapper into its own container on mount and
 * removes it on unmount. The xterm instance survives tab switches, so there
 * is no replay-on-remount cycle and no class of bugs where synthesized DA/DSR/
 * OSC responses get forwarded to the pty.
 *
 * The pool is the sole subscriber to terminalEventBus for each terminal, so
 * pty output is written into the xterm whether or not any view is mounted.
 */

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

export interface PoolEntry {
  terminalId: string
  /**
   * The pty this entry's buffer was written by. A restored terminal keeps its id and gets a **new**
   * process (`restoreAll` in the backend's terminal service spawns one and calls `updatePid`), so the id
   * cannot say whether what is on screen came from the shell that is answering now. The pid can.
   */
  pid: number
  term: Terminal
  fitAddon: FitAddon
  wrapper: HTMLDivElement
  disposables: IDisposable[]
  attachedContainer: HTMLElement | null
  isShowingLoadingContent: boolean
  // Scroll state lives here (not in TerminalView.vue) so it survives the
  // unmount/remount that happens on every tab switch. `wrapper.remove()` in
  // detach() also resets .xterm-viewport.scrollTop in Chromium, so on every
  // attach we re-drive the DOM scroll position ourselves rather than relying
  // on xterm's scrollToBottom() — which is a no-op when ydisp === ybase.
  pinnedToBottom: boolean
  savedScrollFraction: number | null
  webglLoaded: boolean
  webglAddon: WebglAddon | null
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
const restartedNotice = (pid: number) =>
  `\r\n\x1b[90m── new shell (pid ${pid}) — the previous session ended; nothing above is from this one ──\x1b[0m\r\n`

const showLoadingContent = (term: Terminal, info: TerminalInfo) => {
  term.write('\x1b[1;36m🚀 Starting terminal...\x1b[0m\r\n')
  term.write('\x1b[90mConnecting to shell: \x1b[0m' + (info.shell || 'default') + '\r\n')
  term.write('\x1b[90mWorking directory: \x1b[0m' + info.cwd + '\r\n\r\n')
}

class TerminalPool {
  private entries = new Map<string, PoolEntry>()

  get(terminalId: string): PoolEntry | undefined {
    return this.entries.get(terminalId)
  }

  /** Marks the seam when an entry's pty has been replaced, and records the one answering now. */
  private markRestart(entry: PoolEntry, pid: number): void {
    if (pid === entry.pid) return
    entry.pid = pid
    entry.term.write(restartedNotice(pid))
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
      this.markRestart(existing, info.pid)
      return existing
    }

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Cascadia Code, Fira Code, Menlo, monospace',
      fontSize: 14,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10_000,
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
      webglAddon: null
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
        if (selection) navigator.clipboard.writeText(selection)
        return false
      }

      // Ctrl+Shift+V → paste from clipboard (Windows/Linux terminal convention)
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          if (text) sendInput(text)
        })
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

  /** Attach (or re-attach) the entry's wrapper into a host container. */
  attach(terminalId: string, host: HTMLElement): PoolEntry | null {
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
      try { entry.term.loadAddon(addon); entry.webglAddon = addon } catch { /* falls back to canvas renderer */ }
      entry.webglLoaded = true
    }
    return entry
  }

  /** Detach the wrapper from its host without disposing the xterm. */
  detach(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
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

  /** Update pin-to-bottom state. View layer calls this from its scroll listener. */
  setPinned(terminalId: string, pinned: boolean): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    entry.pinnedToBottom = pinned
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

  private getViewport(entry: PoolEntry): HTMLElement | null {
    return entry.term.element?.querySelector('.xterm-viewport') as HTMLElement | null
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
  }
}

export const terminalPool = new TerminalPool()

document.addEventListener('apack:paste', ((e: CustomEvent<{ text: string }>) => {
  const el = e.target as HTMLElement
  const entry = terminalPool.findByElement(el)
  if (!entry) return
  e.preventDefault()
  el.focus()
  entry.term.paste(e.detail.text)
}) as EventListener)
