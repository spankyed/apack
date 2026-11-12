import { BrokerViews, TerminalView, xtermPalette, type Detector, type Theme } from 'apack-terminal-view'
import { openLink, terminalViews, type TerminalViewStream } from '@apackdev/sdk/fe'
import type { TerminalInfo } from '../features/terminal/state.ts'
import { TERMINAL_COLORS, TERMINAL_THEME } from '../../be/terminal-colors.ts'

/**
 * **The feature's seam to what draws its terminals.** Every view the code surface has is here, and this is
 * the only module that imports `apack-terminal-view` at all — the hosts that show a terminal hold a
 * `TerminalAttachment` and a container, which is the whole of their reach into one.
 *
 * **A window interprets nothing.** The terminal's broker reads what a program writes and keeps its screen
 * and history; a view here is sent the rows that changed and paints them, and sends keys and the pointer
 * back to be encoded where the terminal's modes are known. So there is no emulator in a window, no copy of
 * the scrollback to keep in step, and nothing a window can get wrong about what a program meant.
 *
 * One connection to the broker carries every terminal this window shows (`terminalViews`,
 * `@apackdev/sdk/fe`). A view is made for a terminal's session and outlives the hosts that show it: a host
 * mounts it into its container and unmounts it on the way out, and while no host has it mounted the broker
 * sends it nothing at all.
 */

/**
 * How long a fit has to settle before the pty is told.
 *
 * **A coalescing window, not a deadline** — nothing fails when it elapses, and nothing waits on it. What it
 * bounds is how often the *other* end hears, and the other end is a pty whose every resize sends `SIGWINCH`
 * to whatever is running in it. One frame of a drag is 16ms, so this is a handful of frames: short enough
 * that releasing the mouse feels immediate, long enough that a drag is one resize rather than the two dozen
 * it observes.
 */
export const RESIZE_SETTLE_MS = 100

/** The strip beside the rows where each command's start is marked, in pixels */
const COMMAND_GUTTER = 8

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * `named` against `cwd` where it is not already a path from the root, with `.` and `..` taken out.
 *
 * **In the shape `cwd` is in**, which is the shell's own: a directory with a drive letter or a UNC host is
 * a Windows one, where either slash separates and the answer is written with backslashes.
 */
export function resolvePath(cwd: string, named: string): string {
  const drive = (path: string) => /^(?:[A-Za-z]:|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.exec(path)?.[0]
  const windows = drive(cwd) !== undefined || drive(named) !== undefined
  if (!windows) {
    const joined = named.startsWith('/') ? named : `${cwd}/${named}`
    return `/${withoutDots(joined.split('/')).join('/')}`
  }
  // From its own root, from the root of the directory's drive, or from the directory
  const root = drive(named) ?? drive(cwd) ?? ''
  const rest = drive(named) !== undefined ? named.slice(root.length)
    : /^[\\/]/.test(named) ? named
      : `${cwd.slice(root.length)}\\${named}`
  return `${root}\\${withoutDots(rest.split(/[\\/]/)).join('\\')}`
}

function withoutDots(parts: readonly string[]): string[] {
  const kept: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') kept.pop()
    else kept.push(part)
  }
  return kept
}

const FONT = { family: 'JetBrains Mono, Cascadia Code, Fira Code, Menlo, monospace', size: 14 }

const rgb = (color: string): number => Number.parseInt(color.slice(1), 16)

/**
 * The colours a terminal is drawn in. The sixteen a program names by number are the same sixteen the
 * session was told it has (`TERMINAL_COLORS`), so what a program asks the terminal for and what the person
 * sees are one palette.
 */
const THEME: Theme = {
  background: rgb(TERMINAL_THEME.background),
  foreground: rgb(TERMINAL_THEME.foreground),
  cursor: rgb(TERMINAL_THEME.cursor),
  cursorText: rgb(TERMINAL_THEME.cursorAccent),
  selectionBackground: 0x264f78,
  selectionForeground: null,
  palette: xtermPalette(TERMINAL_COLORS.ansi.map(rgb)),
}

/**
 * A path a program printed, with the line it names where it names one: `src/view.ts:42`, `./a/b.rs:7:3`.
 *
 * **Opened by the app, which decides what a path is relative to.** What a view finds is the text; whether
 * it names a file, and where, is the host's to work out from where the terminal's shell is.
 */
const paths: Detector = {
  kind: 'path',
  find(text) {
    const found: Array<{ start: number; end: number }> = []
    for (const match of text.matchAll(/(?:\.{0,2}\/)?(?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][\w]{0,7}(?::\d+(?::\d+)?)?/g)) {
      // A bare word with a dot in it is a version or a sentence, not a file: it needs a directory or a line
      if (!match[0].includes('/') && !/:\d+/.test(match[0])) continue
      found.push({ start: match.index, end: match.index + match[0].length })
    }
    return found
  },
}

interface PoolEntry {
  terminalId: string
  /** The terminal as it was last described, which is what its view is drawn again from */
  info: TerminalInfo
  /** The session the view is drawing, by the broker's name for it. A restart puts a new one under the terminal */
  session: string | undefined
  /**
   * The pty this entry's view was drawn from. A restored terminal keeps its id and gets a **new** process,
   * so the id cannot say whether what is on screen came from the shell that is answering now. The pid can.
   */
  pid: number | null
  view: TerminalView | null
  /** What the terminal is mounted into while a host has it, which holds the view and what is said over it */
  wrapper: HTMLDivElement
  /** Said over the terminal: that its shell ended, or that the one answering is new */
  notice: HTMLDivElement
  attachedContainer: HTMLElement | null
  /** What the host showing this terminal asked to hear. Replaced by each host that attaches */
  handlers: TerminalAttachmentHandlers
  /** Whether the view was following its output when the last host let go, which the next one starts from */
  following: boolean
  /** The connection its view is drawn over ended and was not made again (`lost`) */
  unreachable: boolean
}

/**
 * What a host that is drawing a terminal can do to it. **Nothing of the view crosses this line**: a host
 * holds one of these and a container, which is the whole of its reach into the terminal.
 *
 * It owns what belongs to *this* host, so a host ends by releasing it. A host that has been taken over from
 * has already released, and a released attachment detaches nothing.
 */
export interface TerminalAttachment {
  readonly terminalId: string
  /** Copies what the user has selected. Answers whether there was anything to copy */
  copy(): Promise<boolean>
  selectAll(): void
  /**
   * Pastes into the program, which is told it is a paste where it asked to be. Text that could run a
   * command is shown to the person first and sent only if they say so.
   */
  paste(text: string): void
  /** Clears the screen the way the keyboard does, by asking the program to */
  clear(): void
  /** Opens the bar for finding text in the terminal and its history */
  find(): void
  /** Copies what the last finished command printed, answering whether there was one */
  copyLastOutput(): Promise<boolean>
  /** Whether the shell has marked any command, which is what the command actions need */
  hasCommands(): boolean
  /** Only where the user asked for it: an attach is not a request */
  focus(): void
  /**
   * Measure the terminal against its host now, rather than waiting for the size observer.
   *
   * The observer covers every resize on its own; this is for a host that is *driving* one frame by frame —
   * the panel's list divider being dragged — where waiting a layout pass behind the drag is visible.
   */
  refit(): void
  /** Follow the output again, from wherever the user had scrolled back to */
  followOutput(): void
  /**
   * This host is done. Idempotent, and a no-op once another host has taken the terminal over.
   *
   * **Answers whether this call is what let the terminal go**, which a host needs in order to say so: the
   * backend holds a terminal's grid to the smallest fit of the windows showing it, and a window that has
   * stopped showing one tells it to drop that fit. A host another has taken over from has nothing to tell —
   * during a remount the new host attaches before the old one releases, and a message from the old one
   * would drop the fit the new one just recorded.
   */
  release(): boolean
}

/** What a host wants to hear about. Each is optional: a host that does not draw a control does not ask */
export interface TerminalAttachmentHandlers {
  /**
   * How many cells fit this host, and the size of one in pixels. The grid a session runs at is the
   * backend's to decide — several windows may be showing it — so this is a report of what would fit here.
   */
  onResize?(size: { cols: number; rows: number; cellWidth?: number; cellHeight?: number }): void
  onSelectionChange?(hasSelection: boolean): void
  /** Whether the session is following its output, which a host draws a scroll control from */
  onFollowingChange?(following: boolean): void
  /** A path a program printed was clicked: the file it names, and where in it when the program said */
  onOpenPath?(path: string, at: { line: number; column: number } | undefined): void
}

const exitedNotice = (info: TerminalInfo, code: number | null) =>
  info.exited?.unreached
    ? `Not connected to ${info.target?.label ?? 'its target'}. Restart the terminal to connect.`
    : `The shell ended ${code === null ? 'without a status (a signal)' : `with status ${code}`}. Nothing new will appear here.`

const unreachableNotice = 'The connection this terminal is drawn over ended and could not be made again. Restart the terminal, or reload the window.'

/**
 * Text as a person can read all of it: a control character as the symbol that names it, so a paste hiding
 * a backspace or an escape shows that it does. Line ends and tabs are left as what they are.
 */
const shown = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, character => String.fromCodePoint(0x2400 + character.codePointAt(0)!))
    .replace(/\u007f/g, '\u2421')

/** One connection to a broker: the bytes, what speaks the view protocol over them, and whether it ever answered */
interface BrokerConnection {
  stream: TerminalViewStream
  views: BrokerViews
  heard: boolean
}

const restartedNotice = (pid: number | null) =>
  `New shell${pid === null ? '' : ` (pid ${pid})`}. The previous session ended; this is a new one.`

class TerminalPool {
  private entries = new Map<string, PoolEntry>()
  /**
   * Every terminal as the surface last described it (`describe`), which is what a host mounted with an
   * older description is drawn from
   */
  private latest = new Map<string, TerminalInfo>()
  /** The brokers a connection has been made again to since anything last said to try: `lost` tries once */
  private retried = new Set<string>()
  /** By broker: `''` for the app's own, and a target's key for one somewhere else */
  private connections = new Map<string, BrokerConnection>()

  /**
   * This window's connection to the broker a terminal's session is on: the app's own, or the one a
   * target's key names. One for each broker, however many of its sessions are drawn.
   */
  private connection(target: string | undefined): BrokerViews {
    const key = target ?? ''
    const open = this.connections.get(key)
    if (open) return open.views
    const stream = terminalViews(target)
    const connection: BrokerConnection = { stream, views: new BrokerViews(stream), heard: false }
    this.connections.set(key, connection)
    stream.onData(() => { connection.heard = true })
    // Over either way: the socket went, or what arrived on it was not the protocol
    stream.onClose(() => this.lost(key, connection))
    connection.views.onClose(() => this.lost(key, connection))
    return connection.views
  }

  /**
   * A connection ended that nothing here closed, taking the frames of every terminal drawn over it.
   *
   * **A connection that worked is made again, once.** A terminal's session does not end because a window's
   * socket did — the window slept, a target's `ssh` dropped — so its view is drawn again over a new one.
   * Once, because a peer that answers and then leaves every time would otherwise be asked for ever, and
   * for a target each ask runs a command: the next try waits for a person to show the terminal again or
   * for the surface to describe it. A connection that never answered is not tried again at all.
   */
  private lost(key: string, connection: BrokerConnection): void {
    if (this.connections.get(key) !== connection) return
    this.connections.delete(key)
    connection.stream.close()
    const again = connection.heard && !this.retried.has(key)
    if (again) this.retried.add(key)
    for (const entry of this.entries.values()) {
      if (entry.session === undefined || (entry.info.target?.key ?? '') !== key) continue
      if (again) {
        this.draw(entry, entry.info)
      } else {
        entry.unreachable = true
        this.say(entry, unreachableNotice, 'unreachable')
      }
    }
  }

  /** Draws an entry again whose connection could not be made, because something has said to try */
  private reach(entry: PoolEntry): void {
    if (!entry.unreachable) return
    this.retried.delete(entry.info.target?.key ?? '')
    this.draw(entry, entry.info)
    this.say(entry, null)
  }

  /**
   * Says on the terminal that its shell has gone, where the user is already looking. The screen as it
   * ended stays: a shell that died badly leaves the reason on it.
   */
  noteExit(terminalId: string, code: number | null): void {
    const entry = this.entries.get(terminalId)
    if (entry) this.say(entry, exitedNotice(entry.info, code), 'ended')
  }

  /**
   * The surface's word on one terminal: whatever changed about it — a new shell under it, its shell
   * ending, its directory, whether it is kept. Everything the pool knows of a terminal comes through
   * here or `syncProcesses`.
   */
  describe(info: TerminalInfo): void {
    this.latest.set(info.id, info)
    const entry = this.entries.get(info.id)
    if (entry) this.follow(entry, info)
  }

  /**
   * What the backend now says of every terminal. A terminal keeps its id across a backend restart but not
   * always its shell, so this is where an entry learns the one under it was replaced.
   */
  syncProcesses(infos: readonly TerminalInfo[]): void {
    this.latest = new Map(infos.map(info => [info.id, info]))
    for (const info of infos) {
      const entry = this.entries.get(info.id)
      if (entry) this.follow(entry, info)
    }
  }

  /** Makes the entry draw the session the terminal has now, saying so when it is not the one it was drawing */
  private follow(entry: PoolEntry, info: TerminalInfo): void {
    entry.info = info
    // **A shell that ended leaves its screen.** The terminal is kept so what the shell last said can be
    // read, and its view is what holds that: it goes when a new shell is drawn or the terminal does
    if (info.session === undefined) return
    if (info.session === entry.session) {
      // Described again with the shell it had: worth one more try at a connection that could not be made
      this.reach(entry)
      return
    }
    const replaced = entry.session !== undefined && info.session !== undefined
    this.draw(entry, info)
    if (replaced) this.say(entry, restartedNotice(info.pid), 'restarted')
    else if (info.session !== undefined) this.say(entry, null)
  }

  private say(entry: PoolEntry, text: string | null, kind?: 'ended' | 'restarted' | 'unreachable'): void {
    entry.notice.textContent = text ?? ''
    entry.notice.style.display = text === null ? 'none' : 'block'
    entry.notice.dataset.terminalNotice = kind ?? ''
  }

  /** Replaces the entry's view with one of the session `info` names, mounted where the old one was */
  private draw(entry: PoolEntry, info: TerminalInfo): void {
    const mounted = entry.attachedContainer !== null
    entry.view?.dispose()
    entry.view = null
    entry.info = info
    entry.session = info.session
    entry.pid = info.pid
    entry.unreachable = false
    if (info.session === undefined) return

    const source = this.connection(info.target?.key).open(info.session)
    const view = new TerminalView(source, {
      font: FONT,
      theme: THEME,
      // A path is opened as a file on this machine, which a path printed on another machine does not name
      detectors: info.target ? [] : [paths],
      // Where each command began, coloured by how it ended
      gutter: COMMAND_GUTTER,
      onKey: (event) => this.shortcut(entry, event),
      onFit: (fit) => entry.handlers.onResize?.({ cols: fit.columns, rows: fit.rows, cellWidth: fit.cellWidth, cellHeight: fit.cellHeight }),
      onFollowingChange: (following) => {
        entry.following = following
        entry.handlers.onFollowingChange?.(following)
      },
      onSelectionChange: (selected) => entry.handlers.onSelectionChange?.(selected),
      // A URL from a terminal is whatever a program printed, so it goes through the app's own policy for
      // what may be opened; a path is the feature's to resolve against where the shell is
      onLink: (link) => {
        if (link.kind === 'path') this.openPath(entry, link.target)
        else openLink(link.target)
      },
      confirmPaste: (text) => this.confirmPaste(entry, text),
    })
    view.element.dataset.apackTerminal = entry.terminalId
    entry.view = view
    if (mounted) view.mount(entry.wrapper)
  }

  /**
   * A path a program printed, as the file it names: without the line and column a compiler puts after
   * it, and against the directory the shell is in when it is not a path from the root.
   */
  private openPath(entry: PoolEntry, target: string): void {
    const [, named = target, line, column] = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(target) ?? []
    entry.handlers.onOpenPath?.(
      resolvePath(entry.info.cwd, named),
      line === undefined ? undefined : { line: Math.max(1, Number(line)), column: Math.max(1, Number(column ?? 1)) },
    )
  }

  /** The keys that are the app's rather than the program's: finding text on the screen */
  private shortcut(entry: PoolEntry, event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || event.code !== 'KeyF' || event.altKey) return false
    // Control-F belongs to the shell everywhere but here, where Command is the app's key
    const held = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey
    if (!held) return false
    this.openFind(entry)
    return true
  }

  /**
   * A bar over the terminal for finding text in it and its history: what to find, which match of how
   * many, and the way to the next and the one before.
   *
   * Asked of the session, not of the rows this window holds — a window keeps only the lines it has been
   * shown — so a match in history nobody has scrolled to is found too.
   */
  private openFind(entry: PoolEntry): void {
    const open = entry.wrapper.querySelector<HTMLInputElement>('[data-terminal-find] input')
    if (open) {
      open.focus()
      open.select()
      return
    }
    const bar = document.createElement('div')
    bar.dataset.terminalFind = ''
    bar.style.cssText = 'position:absolute;top:6px;right:18px;z-index:4;display:flex;align-items:center;gap:6px;'
      + 'padding:4px 6px;border-radius:6px;background:#2d2d2d;border:1px solid #444;color:#ddd;'
      + 'font:12px system-ui,sans-serif;box-shadow:0 4px 16px rgb(0 0 0 / 0.5)'
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'Find'
    input.setAttribute('aria-label', 'Find in terminal')
    input.style.cssText = 'width:180px;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1e1e1e;color:inherit;font:inherit;outline:none'
    const count = document.createElement('span')
    count.dataset.terminalFindCount = ''
    count.style.cssText = 'min-width:56px;text-align:center;color:#999'
    const said = () => {
      const { current, total } = entry.view?.found ?? { current: 0, total: 0 }
      count.textContent = input.value === '' ? '' : total === 0 ? 'No results' : `${current} of ${total}`
    }
    const step = (direction: -1 | 1) => {
      entry.view?.findNext(direction)
      said()
    }
    const close = () => {
      bar.remove()
      void entry.view?.find('')
      entry.view?.focus()
    }
    const button = (label: string, title: string, act: () => void) => {
      const made = document.createElement('button')
      made.textContent = label
      made.title = title
      made.setAttribute('aria-label', title)
      made.style.cssText = 'padding:2px 6px;border-radius:4px;border:none;background:transparent;color:inherit;font:inherit;cursor:pointer'
      made.addEventListener('click', act)
      return made
    }
    input.addEventListener('input', () => {
      void entry.view?.find(input.value).then(said)
    })
    bar.addEventListener('keydown', (event) => {
      // Typed here, not at the program under the bar
      event.stopPropagation()
      if (event.key === 'Escape') close()
      else if (event.key === 'Enter') step(event.shiftKey ? -1 : 1)
    })
    bar.append(input, count, button('↑', 'Older match', () => step(1)), button('↓', 'Newer match', () => step(-1)), button('✕', 'Close', close))
    entry.wrapper.appendChild(bar)
    input.focus()
  }

  /**
   * Copies what the last command to finish printed. Answers whether there was one to copy — a shell that
   * marks no commands has none, and neither has one whose output has left the history.
   */
  private async copyLastOutput(entry: PoolEntry): Promise<boolean> {
    const view = entry.view
    const last = view?.commands.filter(command => command.outcome.kind !== 'running' && command.output !== null).at(-1)
    if (!view || !last || !view.selectOutput(last)) return false
    return view.copy()
  }

  /**
   * Shows the person a paste that could run a command, and answers whether they said to send it.
   *
   * Asked over the terminal it is for, and with the text itself: what makes a paste dangerous is what is
   * in it, and a question without the answer on screen is one nobody can answer.
   */
  private confirmPaste(entry: PoolEntry, text: string): Promise<boolean> {
    return new Promise((resolve) => {
      const asking = document.createElement('div')
      asking.dataset.terminalPasteConfirm = ''
      asking.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;z-index:4;padding:10px 12px;border-radius:6px;'
        + 'background:#2d2d2d;color:#e5e5e5;font:12px system-ui,sans-serif;box-shadow:0 4px 16px rgb(0 0 0 / 0.5)'
      const lines = text.split(/\r\n|\r|\n/)
      const title = document.createElement('div')
      title.textContent = `This paste has ${lines.length} line${lines.length === 1 ? '' : 's'} and would run as it is pasted.`
      // All of it, in a box that scrolls: the line that does the damage need not be among the first
      const pasting = document.createElement('pre')
      pasting.textContent = shown(lines.join('\n'))
      pasting.style.cssText = 'margin:8px 0;padding:6px 8px;max-height:120px;overflow:auto;background:#1e1e1e;border-radius:4px;'
        + `font:12px ${FONT.family};white-space:pre-wrap;word-break:break-all`
      const answer = (pasted: boolean) => {
        asking.remove()
        entry.view?.focus()
        resolve(pasted)
      }
      const button = (label: string, pasted: boolean) => {
        const made = document.createElement('button')
        made.textContent = label
        made.dataset.terminalPasteAnswer = pasted ? 'paste' : 'cancel'
        made.style.cssText = 'margin-right:8px;padding:4px 10px;border-radius:4px;border:1px solid #555;'
          + `background:${pasted ? '#0e639c' : 'transparent'};color:inherit;font:inherit;cursor:pointer`
        made.addEventListener('click', () => answer(pasted))
        return made
      }
      asking.append(title, pasting, button('Paste anyway', true), button('Cancel', false))
      asking.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') answer(false)
      })
      entry.wrapper.appendChild(asking)
      ;(asking.lastElementChild as HTMLButtonElement).focus()
    })
  }

  /** The entry for a terminal, made the first time it is asked for */
  /**
   * **A host's description is used only where the surface has given none.** A host is mounted with the
   * terminal as it was when its tab was made, and the surface says what becomes of every terminal
   * (`describe`, `syncProcesses`) — so what a host holds can name a session that has ended,
   * and drawing that would put a dead screen over a terminal whose shell is running.
   */
  ensure(described: TerminalInfo): PoolEntry {
    const info = this.latest.get(described.id) ?? described
    const existing = this.entries.get(info.id)
    if (existing) {
      this.follow(existing, info)
      return existing
    }
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:relative;height:100%;width:100%'
    const notice = document.createElement('div')
    notice.style.cssText = 'display:none;position:absolute;left:0;right:0;bottom:0;z-index:3;padding:4px 10px;'
      + 'background:rgb(30 30 30 / 0.92);color:#bbb;border-top:1px solid #444;font:12px system-ui,sans-serif;pointer-events:none'
    wrapper.appendChild(notice)
    const entry: PoolEntry = {
      terminalId: info.id, info, session: undefined, pid: info.pid, view: null, wrapper, notice,
      attachedContainer: null, handlers: {}, following: true, unreachable: false,
    }
    this.entries.set(info.id, entry)
    this.draw(entry, info)
    if (info.exited) this.say(entry, exitedNotice(info, info.exited.code), 'ended')
    return entry
  }

  /**
   * Shows a terminal in `host` and answers what that host may do with it.
   *
   * The newest host wins: one terminal is drawn in one place in a window, so attaching takes it from
   * whichever host had it, whose own release then detaches nothing.
   */
  attach(terminalId: string, host: HTMLElement, handlers: TerminalAttachmentHandlers = {}): TerminalAttachment | null {
    const entry = this.entries.get(terminalId)
    if (!entry) return null

    let released = false
    let settling: ReturnType<typeof setTimeout> | undefined
    let toldAt = 0
    let fitted: Parameters<NonNullable<TerminalAttachmentHandlers['onResize']>>[0] | undefined
    const tell = () => {
      if (released || !fitted) return
      toldAt = Date.now()
      handlers.onResize?.(fitted)
    }
    entry.handlers = {
      ...handlers,
      // A drag reports a fit a frame; the pty hears once it has settled
      onResize: (size) => {
        if (released) return
        fitted = size
        if (settling) return
        const since = Date.now() - toldAt
        if (since >= RESIZE_SETTLE_MS) tell()
        else settling = setTimeout(() => { settling = undefined; tell() }, RESIZE_SETTLE_MS - since)
      },
    }

    // A person is looking at it: a reason to try a connection that could not be made
    this.reach(entry)
    if (entry.attachedContainer !== host) {
      entry.view?.unmount()
      host.appendChild(entry.wrapper)
      entry.attachedContainer = host
      entry.view?.mount(entry.wrapper)
    }
    handlers.onFollowingChange?.(entry.following)

    return {
      terminalId,
      copy: () => entry.view?.copy() ?? Promise.resolve(false),
      selectAll: () => entry.view?.selectAll(),
      paste: (text) => { void entry.view?.paste(text) },
      clear: () => entry.view?.clear(),
      find: () => this.openFind(entry),
      copyLastOutput: () => this.copyLastOutput(entry),
      hasCommands: () => (entry.view?.commands.length ?? 0) > 0,
      focus: () => entry.view?.focus(),
      refit: () => { if (!released) entry.view?.fit() },
      followOutput: () => entry.view?.follow(),
      release: () => {
        if (released) return false
        released = true
        if (settling) clearTimeout(settling)
        return this.detach(terminalId, host)
      },
    }
  }

  /** Takes a terminal out of `host`, if `host` is where it is. Answers whether it was */
  detach(terminalId: string, host?: HTMLElement): boolean {
    const entry = this.entries.get(terminalId)
    if (!entry) return false
    if (host && entry.attachedContainer !== host) return false
    entry.view?.unmount()
    entry.wrapper.remove()
    entry.attachedContainer = null
    entry.handlers = {}
    return true
  }

  isFollowingOutput(terminalId: string): boolean {
    return this.entries.get(terminalId)?.following ?? true
  }

  /** The terminal is gone: its view with it */
  dispose(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    entry.view?.dispose()
    entry.wrapper.remove()
    this.entries.delete(terminalId)
    this.latest.delete(terminalId)
  }

  /** The surface is going: every view, and every connection they were drawn over */
  disposeAll(): void {
    for (const id of this.entries.keys()) this.dispose(id)
    const open = [...this.connections.values()]
    // Emptied first, so a connection closing here is not one that was lost
    this.connections.clear()
    this.latest.clear()
    this.retried.clear()
    for (const { views, stream } of open) {
      views.close()
      stream.close()
    }
  }
}

export const terminalPool = new TerminalPool()
