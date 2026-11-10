import {
  FitAddon, Ghostty, OSC8LinkProvider, Terminal, UrlRegexProvider,
  type IDisposable, type ILink, type ILinkProvider
} from 'ghostty-web'
import { terminalEventBus } from './terminal-events.ts'
import { openLink } from '@apackdev/sdk/fe'
import type { TerminalInfo } from '../features/terminal/state.ts'
import { TERMINAL_THEME } from '../../be/terminal-colors.ts'

/**
 * **The feature's seam to its emulator.** Every emulator instance the code surface has is here, and this is
 * the only module that imports `ghostty-web` at all — the hosts that draw a terminal hold a
 * `TerminalAttachment` and no emulator type, so replacing the emulator is an implementation swap behind this
 * file rather than a second rewrite of who owns what. That seam is what made it one.
 *
 * Each entry owns a detached wrapper div with a terminal mounted into it, and a host re-parents that wrapper
 * into its own container. The emulator survives a host's teardown, so there is no replay-on-remount cycle,
 * and measured, a reattach with 256 KiB of history costs 5.55 ms and not one message.
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

/**
 * An instance of the emulator's WebAssembly module, **one per terminal**.
 *
 * **Not shared, because a shared one is corrupted by closing a terminal.** Every terminal built on one
 * instance allocates from one heap, and the emulator's core does not clear a page it reuses: with the
 * module shared, a terminal opened after another was closed started with the closed one's cells already on
 * its screen, and in a run with emoji it then trapped with *memory access out of bounds* — reproduced on
 * the first cycle against the pinned build. An instance of its own gives each terminal a heap nothing else
 * has written to, and closing the terminal drops the whole of it.
 *
 * What that costs is about 7 MiB a terminal and an instantiation per open, against a module the browser
 * has already compiled once. The condition for sharing again is the core zeroing what it reuses.
 *
 * A failure is left to reject rather than swallowed: `ensure` is what a host awaits, so the host sees the
 * failure and can say so, where a pool that resolved anyway would hand back a terminal that draws nothing.
 */
const loadEmulator = (): Promise<Ghostty> => Ghostty.load()

/**
 * How many bytes of scrollback the emulator is given for each line the session keeps.
 *
 * **The emulator's `scrollback` is a size in bytes, and the session's is a count of lines.** Passing the
 * count as the size asked for a thousand bytes, which is below the emulator's floor, so a window kept
 * whatever the floor happened to hold: about a thousand lines at 80 columns, and 257 to 552 at 160 —
 * measured — against the thousand the host promises. A line costs about 14 bytes a column, so this is a
 * line of up to roughly 270 columns; measured at 250 columns it keeps 1,091 lines at the least.
 *
 * It is a floor and not an exact count, because the emulator drops history a page at a time: a narrow
 * terminal keeps several times what the host does.
 */
const SCROLLBACK_BYTES_PER_LINE = 4096

/**
 * One session's emulator and the bookkeeping that outlives a host.
 *
 * **Not exported**, which is what makes this module's public surface emulator-agnostic: it names `Terminal`
 * and `FitAddon`, and a host that could hold one would be coupled to the emulator through a type even while
 * calling nothing on it. What a host gets is a `TerminalAttachment`.
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
  // Scroll state lives here, not in a host's component, so it survives the unmount and remount that every
  // tab switch is — one session has one scroll position because it has one buffer, whichever host draws it.
  pinnedToBottom: boolean
  /**
   * Where the user had scrolled back to, as a line in the buffer, kept across the detached spell between
   * two hosts.
   *
   * **A line and not a fraction of a pixel height.** The emulator scrolls itself and draws its own
   * scrollbar, so there is no scrolling DOM element whose `scrollTop` could be saved — and a line is the
   * exact thing anyway, where a fraction of a `scrollHeight` that grows under live output is not.
   */
  savedViewportY: number | null
  /** An unfinished clipboard request, held until the read that completes it (`takeClipboardWrites`) */
  clipboardPending: string
  /**
   * Set while bytes are being written into the emulator, which is when anything it sends is its own.
   *
   * **The emulator answers a program's questions, and it must not.** A program that asks the terminal
   * where the cursor is, or what it is, is answered by the host, which holds the session whether or not a
   * window is drawing it. The emulator parses the same question and answers it too, through the channel
   * the user's keystrokes take — so the program read one answer and then found a second waiting as if it
   * had been typed, once per window. It answers inside the write that carried the question, and a
   * keystroke never arrives inside one, so that is what tells the two apart.
   */
  writing: boolean
  /** When the last paste was taken from the window, so the same paste arriving as a second event is not pasted twice */
  pastedAt: number
  /**
   * Set while the view is being put back where the user had it after a write moved it.
   *
   * The emulator raises its own scroll for both halves of that — the snap and the correction — and
   * reporting them would tell the host the session stopped following and then started again, twice per
   * chunk of output.
   */
  restoringScroll?: boolean
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
  /**
   * This host is done. Idempotent, and a no-op once another host has taken the terminal over.
   *
   * **Answers whether this call is what let the terminal go**, which a host needs in order to say so: the
   * backend holds a terminal's grid to the smallest fit of the windows showing it, and a window that has
   * stopped showing one tells it to drop that fit. A host another has taken over from has nothing to tell —
   * during a remount the new host attaches before the old one releases (F1), and a message from the old one
   * would drop the fit the new one just recorded.
   */
  release(): boolean
}

/** What a host wants to hear about. Each is optional: a host that does not draw a control does not ask */
export interface TerminalAttachmentHandlers {
  /**
   * The emulator sized itself to this host, and the pty is the caller's to tell. The cell is one cell in
   * pixels where the emulator has measured one, for a program that asks the terminal its size in pixels
   */
  onResize?(size: { cols: number; rows: number; cellWidth?: number; cellHeight?: number }): void
  onSelectionChange?(hasSelection: boolean): void
  /** Whether the session is following its output, which a host draws a scroll control from */
  onFollowingChange?(following: boolean): void
}

/**
 * The characters a paste may not carry, each replaced by a space.
 *
 * **Pasted text is whatever was on the clipboard, and a terminal acts on control characters.** The
 * emulator wraps a paste in the bracketed-paste markers and sends it as it is, so text holding the closing
 * marker ended the bracket early and everything after it reached the shell as if typed — a newline there
 * ran a command. With `ESC` gone no marker can be forged. The rest are the characters a pty's line
 * discipline acts on even inside a bracket (interrupt, quit, kill-line, suspend, the flow-control pair,
 * word-erase, literal-next, reprint, discard) and the ones with no business in pasted text at all. It is
 * the list Ghostty and xterm use. Tabs, newlines and carriage returns stay: they are what a paste is.
 */
const UNSAFE_IN_A_PASTE = new Set([
  0x00, 0x03, 0x04, 0x05, 0x08, 0x0f, 0x11, 0x12, 0x13, 0x15, 0x16, 0x17, 0x1a, 0x1b, 0x1c, 0x7f,
])

/** `text` with every character a paste may not carry replaced by a space */
export function pasteSafe(text: string): string {
  let safe = ''
  for (const character of text) {
    safe += UNSAFE_IN_A_PASTE.has(character.codePointAt(0)!) ? ' ' : character
  }
  return safe
}

/**
 * How far back to put the view after a write moved it, in lines from the bottom.
 *
 * The user is reading *content*, so the distance from the bottom to that content grows by the lines the
 * write added. Normally that is how much the scrollback grew. **Not when the emulator dropped history**:
 * it drops a page at a time, hundreds of lines, so the scrollback *shrinks* across such a write and the
 * difference is negative — which put the view hundreds of lines below where the user was, usually at the
 * bottom. Then the lines added are counted from the output itself, which undercounts a line that wrapped
 * and is close; and the answer never points above the top of what is left.
 */
export function viewAfterWrite(wasBack: number, before: number, after: number, written: string): number {
  const grew = after - before
  const added = grew >= 0 ? grew : lineFeeds(written)
  return Math.min(wasBack + added, after)
}

function lineFeeds(text: string): number {
  let count = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1
  return count
}

/**
 * The emulator's frame loop, which it does not expose.
 *
 * It draws on every animation frame from `open` until `dispose`, whether or not its canvas is in the
 * document — so a terminal no host is showing went on painting a canvas nobody could see, for every frame
 * of output it received. These two fields are the loop's own, reached by name because there is no public
 * way to stop it; a build of the emulator without them is left running, which is what it did before.
 */
interface FrameLoop {
  animationFrameId?: number
  startRenderLoop?(): void
}

/** Stops the emulator drawing. What is written meanwhile is kept and drawn when it starts again */
function stopDrawing(term: Terminal): void {
  const loop = term as unknown as FrameLoop
  if (loop.animationFrameId === undefined) return
  cancelAnimationFrame(loop.animationFrameId)
  loop.animationFrameId = undefined
}

function startDrawing(term: Terminal): void {
  const loop = term as unknown as FrameLoop
  if (loop.animationFrameId === undefined) loop.startRenderLoop?.()
}

/**
 * The most of an unfinished clipboard request this will hold while it waits for a terminator.
 *
 * A clipboard payload is as big as what is being copied, and it arrives split across reads like anything
 * else. The cap is what stops a sequence that never terminates — a program that wrote `ESC ] 52 ;` and then
 * megabytes of ordinary output — from being held forever: past it the hold is dropped and the stream is
 * read as itself again.
 */
const CLIPBOARD_HOLD_CAP = 1_048_576

/** How long after a paste the same paste arriving as a second event is taken to be the first again */
const PASTE_ECHO_MS = 100

/** What starts one: `OSC 52 ;` */
const CLIPBOARD_INTRODUCER = '\x1b]52;'

/**
 * A program's clipboard writes, taken out of a chunk of its output.
 *
 * **OSC 52 is how a program running in a terminal puts something on the clipboard** — `tmux save-buffer`,
 * a remote `vim`'s yank, anything over ssh that cannot reach the local clipboard any other way. The
 * emulator does not surface it, where the previous one had an addon for it, so without this the behaviour
 * is simply gone.
 *
 * **Pure, and the chunking is the reason.** The sequence arrives split across reads as often as not, so the
 * caller holds `pending` between chunks and this decides what is complete. A case can hand it a sequence
 * one byte at a time, which is where an implementation that only looked at whole chunks would be wrong.
 *
 * **Nothing is consumed.** The bytes still go to the emulator, which ignores them, so this neither rewrites
 * the stream nor depends on being called before or after the write.
 *
 * **A read request is deliberately not answered.** `ESC ] 52 ; c ; ? ST` asks the terminal to *send the
 * clipboard back* to the program, which would let anything running in a terminal — including something on
 * the other end of an ssh connection — read what the user last copied. Returning nothing is what this app
 * answers, and it is a decision rather than an omission.
 */
export function takeClipboardWrites(pending: string, chunk: string): { writes: string[]; pending: string } {
  const text = pending + chunk
  const writes: string[] = []
  let from = 0
  let held = ''
  for (;;) {
    const start = text.indexOf(CLIPBOARD_INTRODUCER, from)
    if (start === -1) break
    const after = start + CLIPBOARD_INTRODUCER.length
    // A terminator is either BEL or ST, whichever comes first. Searched rather than matched, because a
    // regex naming them is a regex of control characters, which `no-control-regex` refuses and is right to
    const bell = text.indexOf('\x07', after)
    const stop = text.indexOf('\x1b\\', after)
    const terminator = bell === -1 ? stop : stop === -1 ? bell : Math.min(bell, stop)
    if (terminator === -1) { held = text.slice(start); break }
    const end = terminator - after
    const body = text.slice(after, after + end)
    const payload = body.slice(body.indexOf(';') + 1)
    if (body.includes(';') && payload !== '?') {
      const decoded = decodeClipboardPayload(payload)
      if (decoded !== null) writes.push(decoded)
    }
    from = after + end + (text.startsWith('\x1b\\', after + end) ? 2 : 1)
  }
  // **A half-arrived introducer is held too**, which a search for the whole of it cannot see: fed a byte at
  // a time, `\x1b` then `]` then `5` each match nothing, and dropping them loses the sequence that follows.
  if (!held) held = partialIntroducer(text.slice(from))
  return { writes, pending: held.length > CLIPBOARD_HOLD_CAP ? '' : held }
}

/** The longest tail of `text` that could still become `CLIPBOARD_INTRODUCER` once more bytes arrive */
function partialIntroducer(text: string): string {
  const most = Math.min(text.length, CLIPBOARD_INTRODUCER.length - 1)
  for (let length = most; length > 0; length -= 1) {
    const tail = text.slice(text.length - length)
    if (CLIPBOARD_INTRODUCER.startsWith(tail)) return tail
  }
  return ''
}

/** The payload is base64 of UTF-8 bytes; anything that is not is not a clipboard write */
function decodeClipboardPayload(payload: string): string | null {
  try {
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * A link provider's links, with their activation replaced by the app's.
 *
 * **Detecting a link and deciding what opening one means are different jobs.** The emulator's providers do
 * the first, and the `activate` they build does the second by going at the window — which is not theirs to
 * decide, because the text they matched is whatever a program printed into a terminal. `openLink` is the
 * app's one door for that, with the URL policy behind it.
 *
 * Exported for its own cases: it is pure, and a case can hand it a provider that offers one link and assert
 * that activating it reached `openLink` with the text rather than anywhere else.
 */
export function openedByTheApp(provider: ILinkProvider): ILinkProvider {
  return {
    provideLinks: (y, callback) => provider.provideLinks(y, (links) => callback(
      links?.map((link): ILink => ({ ...link, activate: () => { openLink(link.text) } }))
    )),
    dispose: () => provider.dispose?.()
  }
}

class TerminalPool {
  private entries = new Map<string, PoolEntry>()

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
    this.write(entry, exitedNotice(code))
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
    if (!drawn) this.write(entry, restartedNotice(pid))
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
   * Returns an existing entry or constructs a new one.
   *
   * `sendInput` is what the emulator sends the pty: the user's keystrokes and what they paste. **Not the
   * replies it makes to a program's questions** — the host answers those, and the emulator's own are
   * dropped (`PoolEntry.writing`).
   */
  async ensure(info: TerminalInfo, sendInput: (data: string) => void): Promise<PoolEntry | null> {
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
    // **A second mount while the first is still building awaits that build**, rather than constructing a
    // second emulator for one session. Two hosts mounting together is the normal remount, and the
    // emulator's module load is what makes the window between them wide enough to matter.
    const building = this.building.get(info.id)
    if (building) return building

    const build = this.build(info, sendInput)
    this.building.set(info.id, build)
    try { return await build } finally { this.building.delete(info.id) }
  }

  /** Builds per session while `ensure` is awaiting, so one id is only ever built once */
  private building = new Map<string, Promise<PoolEntry | null>>()

  /**
   * Sessions closed while they were being built.
   *
   * **A terminal can be closed before its emulator exists.** The module load is awaited, so a `CLOSED` for
   * this session can arrive in between — and registering what was built after that would resurrect a
   * session the backend has finished with, attached to no host and subscribed to a bus nobody writes to.
   * `dispose` records the id and `build` throws away what it made.
   */
  private discarded = new Set<string>()

  private async build(info: TerminalInfo, sendInput: (data: string) => void): Promise<PoolEntry | null> {
    const ghostty = await loadEmulator()
    this.listenForPaste()

    const term = new Terminal({
      ghostty,
      fontFamily: 'JetBrains Mono, Cascadia Code, Fira Code, Menlo, monospace',
      fontSize: 14,
      // **No end-of-line conversion.** A pty already turns a program's line feed into a carriage return
      // and a line feed unless the program asked it not to, and a program that asked — every full-screen
      // one — means a bare line feed as "down one row, same column". Converting it here moved the cursor
      // to the first column where the host's screen, and the program, had it further right.
      cursorBlink: true,
      cursorStyle: 'bar',
      // **The host's number of lines, as the bytes the emulator counts in** (`SCROLLBACK_BYTES_PER_LINE`).
      // `info.scrollback` comes from the broker's handshake.
      scrollback: info.scrollback * SCROLLBACK_BYTES_PER_LINE,
      cols: info.cols || 80,
      rows: info.rows || 24,
      theme: { ...TERMINAL_THEME }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    const wrapper = document.createElement('div')
    wrapper.style.height = '100%'
    wrapper.style.width = '100%'
    // **The app's own name for a drawn terminal**, so anything that needs to find one — the performance
    // scenarios do — asks for this rather than for whatever the emulator calls its elements. Reading the
    // emulator's DOM is what the old viewport lookup did, and replacing the emulator is what broke it.
    wrapper.dataset.apackTerminal = info.id

    // **Everything below here has to come after `open`**, and the emulator says so rather than misbehaving:
    // `write`, `clear`, `paste`, `input`, `reset`, `scrollLines` and `registerLinkProvider` each refuse a
    // terminal that has not been opened. `open` takes the element it is given as its own and appends the
    // canvas and the textarea to it, so there is nothing to size afterwards either.
    term.open(wrapper)

    // **A paste is taken before the emulator sees it**, in the capture phase, because the emulator sends
    // pasted text as it is (`pasteSafe`). It listens for the same two events on this element and on the
    // input inside it; stopping them here is what makes this the only door a paste has.
    const takePaste = (event: Event) => {
      const paste = event as ClipboardEvent & InputEvent
      if (event.type === 'beforeinput' && paste.inputType !== 'insertFromPaste') return
      event.preventDefault()
      event.stopPropagation()
      const text = paste.clipboardData?.getData('text/plain') ?? paste.dataTransfer?.getData('text/plain') ?? paste.data ?? ''
      // One paste can arrive as both events; the second is the first again
      const now = Date.now()
      if (!text || now - entry.pastedAt < PASTE_ECHO_MS) return
      entry.pastedAt = now
      this.pasteInto(entry, text)
    }
    wrapper.addEventListener('paste', takePaste, { capture: true })
    wrapper.addEventListener('beforeinput', takePaste, { capture: true })

    // **Links are detected by the emulator and opened by the app.** Both providers are the library's —
    // `OSC8LinkProvider` reads the hyperlink a program declared as a sequence, `UrlRegexProvider` finds the
    // rest in the drawn text — and each link they hand back carries an `activate` of its own. That is the
    // one thing not theirs to decide: a URL from a terminal is whatever a program printed, so it goes
    // through `openLink` and the app's URL policy rather than straight at the window.
    //
    // Nothing is left for a grapheme or width addon to do: clustering is what the core does.
    for (const provider of [new OSC8LinkProvider(term), new UrlRegexProvider(term)]) {
      term.registerLinkProvider(openedByTheApp(provider))
    }

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
      savedViewportY: null,
      clipboardPending: '',
      restoringScroll: false,
      writing: false,
      pastedAt: 0
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
        // **`term.paste` rather than a raw write** (F12): the emulator wraps it in the bracketed-paste
        // markers when the application has asked for them, which is how a shell or an editor tells a paste
        // from typing — without it, a pasted newline runs a command.
        void navigator.clipboard.readText().then((text) => {
          if (text) this.pasteInto(entry, text)
        }).catch(() => {})
        return false
      }

      return true
    })

    // **Subscribed before the banner is written, so the first live byte is ordered behind it.** The emulator
    // parses writes FIFO, and the subscriber clears the banner on the first byte it delivers: subscribing
    // after the banner would let output that arrived in between be cleared along with it.
    const unsubscribe = terminalEventBus.subscribe(info.id, (_id, data) => {
      if (entry.isShowingLoadingContent) {
        term.clear()
        entry.isShowingLoadingContent = false
      }
      entry.writing = true
      // **The emulator snaps the view to the bottom on every write once the user has scrolled back**, so
      // a session reading its own history is dragged to the end by output it is not looking at. That is one
      // of the journeys the terminal complaint was about, and the window is where it has to be undone: the
      // behaviour is `writeInternal`'s, in a dependency.
      //
      // Undone by putting the view back where it was, plus however many lines the write added — the user
      // is reading *content*, and the distance from the bottom to that content is what grew. Both the
      // snap and this correction happen before the frame that paints, so nothing flickers.
      const wasScrolledBack = term.viewportY
      const linesBefore = term.getScrollbackLength()
      // **Raised before the write, not after it.** The snap is the emulator's own scroll and it fires
      // during `write`; a flag set afterwards would let that one through, and the host would be told the
      // session had started following its output when the next line is what just took it there.
      entry.restoringScroll = wasScrolledBack !== 0
      try {
        term.write(data)
        if (wasScrolledBack !== 0) {
          term.scrollToBottom()
          term.scrollLines(-viewAfterWrite(wasScrolledBack, linesBefore, term.getScrollbackLength(), data))
        }
      } finally {
        entry.restoringScroll = false
        entry.writing = false
      }

      // **What the emulator does not surface** (OSC 52). The bytes have already gone to it, which ignores
      // them; this reads the same chunk for what a program asked to be put on the clipboard.
      const clipboard = takeClipboardWrites(entry.clipboardPending, data)
      entry.clipboardPending = clipboard.pending
      for (const text of clipboard.writes) {
        // A clipboard permission the window does not have rejects; unhandled, that is a console error
        // nobody can act on (F16), which is the same reason the copy shortcut swallows it
        void navigator.clipboard.writeText(text).catch(() => {})
      }
    })
    entry.disposables.push({ dispose: unsubscribe })

    // **Nothing is replayed, because nothing keeps a copy to replay from.** The byte log and its window
    // storage are deleted (F3, F6): the scrollback lives in this emulator, which the pool keeps alive across
    // a host's teardown — so a tab switch costs 5.55 ms and no bytes, measured. A *fresh* emulator starts
    // fresh, and serving history for that case is the broker's bounded history, where one copy belongs.
    entry.writing = true
    try { showLoadingContent(term, info) } finally { entry.writing = false }
    entry.isShowingLoadingContent = true
    // What the emulator sends while it is being written to is its own answer to a program's question, and
    // the host has already answered it (see `writing`). Everything else is the user's
    entry.disposables.push(term.onData((data) => { if (!entry.writing) sendInput(data) }))
    entry.disposables.push({ dispose: () => {
      wrapper.removeEventListener('paste', takePaste, { capture: true })
      wrapper.removeEventListener('beforeinput', takePaste, { capture: true })
    } })

    // **Closed while this was being built**, so nothing is registered and what was made is thrown away.
    // Registering it would put an emulator for a finished session in the pool, holding its WebAssembly
    // state and subscribed to a bus nothing writes to, until the whole frontend went.
    if (this.discarded.delete(info.id)) {
      unsubscribe()
      try { term.dispose() } catch { /* nothing drew it */ }
      return null
    }

    // No host has it yet, so there is nothing to draw into; `attach` starts the emulator drawing
    stopDrawing(term)
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
      // One cell as the emulator drew it, in whole pixels; absent before it has measured a font
      const metrics = term.renderer?.getMetrics()
      const cell = metrics && metrics.width > 0 && metrics.height > 0
        ? { cellWidth: Math.round(metrics.width), cellHeight: Math.round(metrics.height) }
        : {}
      handlers.onResize?.({ cols: term.cols, rows: term.rows, ...cell })
    }
    const tellSettled = () => {
      if (released || settling || entry.applying) return
      const since = Date.now() - toldAt
      if (since >= RESIZE_SETTLE_MS) { tell(); return }
      settling = setTimeout(() => { settling = undefined; tell() }, RESIZE_SETTLE_MS - since)
    }
    own.push(() => { if (settling) clearTimeout(settling) })

    /**
     * Whether the session is following its output, **asked of the emulator rather than measured.**
     *
     * `viewportY` is the distance scrolled back from the bottom, so following is `0` exactly — where the
     * same question over a scrolling DOM element was `scrollTop + clientHeight >= scrollHeight - 10`, a
     * comparison with a ten-pixel tolerance because the three numbers it read were pixels of a height that
     * grows under live output. There is no element to read now: the emulator scrolls itself and draws its
     * own scrollbar.
     */
    const report = (viewportY: number) => {
      // Both halves of a restore raise a scroll of their own; neither is the user moving (see
      // `restoringScroll`)
      if (entry.restoringScroll) return
      const following = viewportY === 0
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

    const scrolled = term.onScroll(report)
    own.push(() => scrolled.dispose())

    const selection = term.onSelectionChange(() => handlers.onSelectionChange?.(term.getSelection() !== ''))
    const written = term.onRender(() => {
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
      paste: (text) => this.pasteInto(entry, text),
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
        if (released) return false
        released = true
        for (const undo of own) {
          try { undo() } catch { /* a listener on an element already gone */ }
        }
        own.length = 0
        return this.detach(terminalId, host)
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
    startDrawing(entry.term)
    return entry
  }

  /**
   * Detach the wrapper from its host without disposing the emulator.
   *
   * **`host` is checked, not trusted** (F1). Two hosts can be mounted for one terminal during a remount —
   * the new one attaches before the old one unmounts — and a detach that did not say whose it was tore the
   * wrapper out of whichever host happened to hold it, leaving the live one blank. A host that is no longer
   * the attached one detaches nothing.
   */
  detach(terminalId: string, host?: HTMLElement): boolean {
    const entry = this.entries.get(terminalId)
    if (!entry) return false
    // A host another has already taken over from detaches nothing (F1), and says so
    if (host && entry.attachedContainer !== host) return false
    // Where the user had scrolled back to, for `syncViewport` on the next attach. Read off the emulator, so
    // taking the wrapper out of the document cannot disturb it — which is what reading a DOM `scrollTop`
    // here had to be careful of, Chromium zeroing it on remove.
    entry.savedViewportY = entry.term.viewportY
    entry.wrapper.remove()
    entry.attachedContainer = null
    // Nothing is showing it, so nothing is drawn; what arrives meanwhile is kept for the next attach
    stopDrawing(entry.term)
    return true
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
   * Puts the view back where this session was, after an attach or a fit.
   *
   * **There is no wait primitive any more, because there is nothing to wait for.** This used to write an
   * empty string and act in the callback: the previous emulator parsed writes on a queue, so that callback
   * was how you got behind a burst of live output that was still being parsed. This one parses inside
   * `write` — the bytes are in the terminal when it returns — and its callback is nothing but a
   * `requestAnimationFrame`, so the frame is all that was ever being bought here.
   *
   * It also **threw**: an empty write reaches `Uint8Array.set` with an offset past the end and raises
   * `RangeError: offset is out of bounds`, which is what the first driven journey hit, twice per attach.
   * So the frame is asked for directly, which is both what the callback did and the thing that does not
   * crash.
   *
   * What it does once the frame comes is two calls on the emulator. Following the output is `scrollToBottom`;
   * a user who had scrolled back is put back the lines they were back by, because `viewportY` counts up
   * from the bottom and `scrollLines` takes lines down. Neither reads or writes the DOM, so there is no
   * layout to force and no frame to wait for — and the three things this had to work around are all gone
   * with the element they were about: a `scrollTop` Chromium zeroes on remove, a `scrollHeight` that had to
   * be read to force layout, and a `scrollToBottom` that did nothing when the buffer pointers were equal.
   */
  syncViewport(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    requestAnimationFrame(() => {
      const current = this.entries.get(terminalId)
      if (!current || !current.attachedContainer) return
      current.term.scrollToBottom()
      const back = current.savedViewportY
      if (!current.pinnedToBottom && back != null && back > 0) current.term.scrollLines(-back)
    })
  }

  /** Find a pool entry whose wrapper contains the given DOM element. */
  findByElement(el: HTMLElement): PoolEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.wrapper.contains(el)) return entry
    }
    return undefined
  }

  /** Dispose the emulator and all wire-level disposables. Call on terminal.CLOSED. */
  dispose(terminalId: string): void {
    // **A session can be closed while its emulator is still being built**, the module load being awaited in
    // between, and there is no entry to dispose yet. Recording it is what stops `build` registering what it
    // made: an emulator for a session the backend has finished with, attached to nothing.
    if (this.building.has(terminalId)) this.discarded.add(terminalId)
    const entry = this.entries.get(terminalId)
    if (!entry) return

    for (const d of entry.disposables) {
      try { d.dispose() } catch (e) { console.error('[terminalPool] dispose failed:', e) }
    }
    entry.disposables.length = 0

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
   * a fresh module with a fresh pool, and the last one's emulators, their canvases and their WebAssembly
   * state are kept alive by the window with nothing left that could reach them.
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
      this.pasteInto(entry, event.detail.text)
    }) as EventListener
    document.addEventListener('apack:paste', this.paste)
  }

  /**
   * Pastes through the emulator, which wraps the text in the bracketed-paste markers when the program asked
   * for them — after the characters a paste may not carry are taken out (`pasteSafe`). Every paste goes
   * through here.
   */
  private pasteInto(entry: PoolEntry, text: string): void {
    entry.term.paste(pasteSafe(text))
  }

  /** Writes the pool's own text into the emulator, marked as a write so nothing it sends back is input */
  private write(entry: PoolEntry, text: string): void {
    entry.writing = true
    try { entry.term.write(text) } finally { entry.writing = false }
  }

  private stopListeningForPaste(): void {
    if (!this.paste) return
    document.removeEventListener('apack:paste', this.paste)
    this.paste = null
  }
}

export const terminalPool = new TerminalPool()
