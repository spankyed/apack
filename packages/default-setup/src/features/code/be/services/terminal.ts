import { featureSettings } from '#generated/settings.ts';

import { newId } from '#generated/ears.ts';
import * as path from 'path'
import type { TerminalInfo, TerminalCreate } from '../types.ts'
import type { TerminalEntity } from '../repository/index.ts'
import { EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { services } from '#generated/services.ts'
import type { TerminalCellSize, TerminalEvent, TerminalRewind, TerminalSession, TerminalSessionSummary } from '@apackdev/sdk/services'
import { resolveAppEnvironment } from '@apackdev/sdk/env'
import { TERMINAL_COLORS } from '../terminal-colors.ts'
import { directoryToStart, shellToStart, submitFor } from './known-shells.ts'
import { cwdAsReported } from '../utils/osc-cwd.ts'
import { integrationDirectory, integrationFor } from './shell-integration.ts'

const logger = createLogger('terminal');

/** A shell that is running, and the session it is running in */
interface RunningShell {
  /** The host's session. The process is the broker's, so this holds no pty and no handle to one */
  session: TerminalSession
  /**
   * Which open this terminal's exits must come from.
   *
   * **A terminal outlives its shells, so an exit has to say which one it was.** Every session's `onExit` is
   * a closure over the terminal's id, so a restart leaves two of them pointing at one terminal; the first
   * one's exit, arriving after the replacement, would describe a generation the window has already been
   * told started — marking a fresh terminal crashed, or trashing the row the restart just rebuilt. A
   * restart records the terminal as having no shell before it ends the old one, so the old closure's exit
   * finds a state carrying no token at all; this tells any later arrival from the replacement's own exit.
   */
  opening: number
}

/**
 * **What this terminal's shell is doing, as one fact rather than four flags.**
 *
 * A terminal is not its shell, so what the terminal is and what its shell is doing are two questions — and
 * the second has exactly three answers. Spread across a session handle, an `active` boolean, an `exited`
 * record and a `closing` flag, three states become sixteen combinations, and the ones that cannot be true
 * are reachable: a reopen that throws leaves `active: false` with no `exited` over a session that has gone,
 * which is a shell nobody has reported dying. Every window then draws that terminal as live, writes to it
 * answer success, and the exit that would have cleaned it up was already dropped as stale.
 *
 * One discriminated field cannot hold two answers at once, and `active` and `exited` are derived from it
 * where a terminal is published, so no code path can describe a terminal that is running and dead.
 */
type TerminalState =
  | ({ kind: 'live' } & RunningShell)
  /**
   * Something asked for this terminal to end, so the exit that follows is a close rather than a crash.
   *
   * **The exit code cannot carry the intent.** The broker's kill is a signal — `portable-pty` sends SIGHUP
   * and reports a signal death as a non-zero code, and Windows is `TerminateProcess(…, 127)` — so a
   * terminal the user closed arrives here looking exactly like a shell that died on its own. Asking the
   * code was reading the consequence; this is the request.
   */
  | ({ kind: 'closing' } & RunningShell)
  /**
   * The terminal has no session and was kept, holding what its shell ended with — or, `unreached`, it is on
   * a target this run has not connected to, where its shell may still be.
   */
  | { kind: 'exited'; code: number | null; unreached?: true }

interface Terminal {
  /**
   * What is published about this terminal, less what its shell is doing.
   *
   * `state` owns that, and `published` derives `active` and `exited` from it — rather than a second copy
   * kept in step by hand, which is what let the two disagree.
   */
  info: Omit<TerminalInfo, 'active' | 'exited'>
  state: TerminalState
  /**
   * The session this terminal last had on a target, offered to the target again when its shell is started.
   *
   * **A target's shell does not end because this app lost its way to it.** A connection that drops, and an
   * app that starts while the target cannot be reached, both leave a terminal with no session here and
   * possibly a running one there — so starting it again asks for that one first, and starts a shell only
   * when the target says it is gone.
   */
  resumes?: string
  /**
   * What each window showing this terminal fitted, by the connection it fitted on.
   *
   * **A pty has one `(cols, rows)`, so the grid it runs at is a question about every window at once** —
   * which is why this is a map and not an owner. It used to be one connection, the one that opened the
   * terminal, and every other window's fit was refused. That could not survive a reconnect: the id is
   * minted per socket, so a window that dropped and came back was a different connection, was refused its
   * own terminal, and stayed refused for the life of the process.
   *
   * So the grid is derived instead — `gridInForce`, the smallest of these — and an entry leaves when its
   * window stops showing the terminal or its connection ends. Nothing is owned, so there is nothing to hand
   * over and nothing to go stale.
   */
  fittedBy: Map<string, Grid>
  /**
   * The grid this service has decided the pty should run at, which is **not** what windows have been told.
   *
   * `info` is told after the round trip, so mid-flight it still names the grid before this one. Asking
   * "did it move?" of `info` therefore answers about the wrong baseline: a fit in flight, then a window
   * going, and the second decision reads the grid as unmoved and does nothing — leaving the first one's
   * answer to write a size that is no longer wanted. Two fields because they are two facts: what was
   * decided, and what has been published.
   */
  decided: Grid
  /**
   * Which decision's write-back is still the current one.
   *
   * `session.resize` is a round trip, so two decisions about one pty are open together and answer in
   * whichever order the broker reaches them. Bumped per decision, and a write-back whose token has moved is
   * dropped — `opening`'s trick, for the same shape of problem.
   */
  sizing: number
}

/** A pty's grid, and one cell of it in pixels where a window has measured one */
interface Grid {
  cols: number
  rows: number
  cell?: TerminalCellSize
}

const sameCell = (a: TerminalCellSize | undefined, b: TerminalCellSize | undefined): boolean =>
  a?.width === b?.width && a?.height === b?.height

/**
 * The terminal as everything outside this service sees it: what it is, plus what its shell is doing.
 *
 * **Derived on the way out and never stored.** `active` and `exited` are two readings of one state, so
 * holding them would be holding the same fact three times and hoping every path updated all three —
 * which is exactly what let a terminal be live and dead at once.
 */
const published = (terminal: Terminal): TerminalInfo => ({
  ...terminal.info,
  active: terminal.state.kind !== 'exited',
  ...(terminal.state.kind === 'live' && { session: terminal.state.session.id }),
  ...(terminal.state.kind === 'exited' && {
    exited: { code: terminal.state.code, ...(terminal.state.unreached && { unreached: true as const }) },
  }),
})

/**
 * Where a terminal's output and exit go, **given before the session exists**.
 *
 * That ordering is the whole of F8's fix: the listeners used to be registered after `create` returned, so
 * whatever the shell wrote first — its prompt, and anything a command printed before the handler landed —
 * was dropped. `services.terminal.open` takes them, so there is no window in which output has nowhere to go.
 */
/**
 * The grid a pty is running at, and whether this call is what moved it.
 *
 * `changed` is the difference between news and a refusal: a grid that moved is every window's business and
 * is broadcast, where a request that was refused — or that asked for the grid already in force — is the
 * asker's alone.
 */
export interface AcceptedGrid {
  cols: number
  rows: number
  changed: boolean
}

/**
 * What closing a terminal did.
 *
 * **A boolean cannot say it.** Its caller reads a falsy answer as "no such terminal" and tells the user so,
 * which is true of exactly one of these: a broker that refuses to end a session is not a terminal that was
 * never there, and a close that completed here is not a failure at all.
 */
export type TerminalClose =
  /** The broker was asked to end the shell. The exit it sends back is what completes the close */
  | 'ending'
  /** The shell had already gone, so there was no exit to wait for and the close completed here */
  | 'closed'
  /** The broker would not end it. The terminal is closed here anyway, its session being unreachable */
  | 'refused'
  /** There is no such terminal */
  | 'unknown'

export interface TerminalHandlers {
  /**
   * The terminal's program did something that is not on its screen: set a title, rang the bell, finished
   * a command. **What was on its screen is not here at all** — a window draws a terminal from the rows its
   * session sends it, so this service is handed the events and never the bytes.
   */
  onEvent(terminalId: string, event: TerminalEvent): void
  /**
   * The shell ended and the terminal is gone with it.
   *
   * **No status, because the terminal is gone and nothing asks why.** `terminal.CLOSED` carries the id and
   * nothing else, so a code here was read by no one — and reporting `0` for a shell that ended without one,
   * to satisfy a non-nullable parameter, read as a decision about an unknown status rather than the type
   * workaround it was. A crash is the case where the status matters, and that is `onCrashed`, which takes it
   * as `number | null`.
   */
  onExit(terminalId: string): void
  /**
   * The shell ended badly and the terminal was **kept**, so the user can see what it said and start it
   * again where it was.
   *
   * A shell that exits 0 is a user closing their terminal, and closing it is what they asked for. A shell
   * that dies of a signal or a non-zero status is a crash, and taking the window away takes the error
   * message with it — which is the one thing the user needs.
   */
  onCrashed(terminalId: string, exitCode: number | null): void
}

/**
 * Where a terminal's recording is kept: what its shell printed, so the terminal can be reopened where it
 * left off and looked back through. Inside the app's own data directory, in a file only the user reads.
 */
export function recordingFor(id: string, userDataDir = resolveAppEnvironment().userDataDir): string {
  return path.join(userDataDir, 'apack', 'terminal-recordings', `${id}.recording`)
}

/**
 * A command line as the arguments it is: split at spaces, with quotes holding a part together and a
 * backslash taking the next character as it is. Enough for the command that reaches a target, which the
 * user writes as they would in a shell and which is run without one.
 */
export function commandArguments(line: string): string[] {
  const parts: string[] = []
  let part: string | undefined
  let quote: string | undefined
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]!
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else if (character === '\\' && quote === '"' && at + 1 < line.length) part = (part ?? '') + line[at += 1]
      else part = (part ?? '') + character
    } else if (character === '"' || character === "'") {
      quote = character
      part ??= ''
    } else if (character === '\\' && at + 1 < line.length) {
      part = (part ?? '') + line[at += 1]
    } else if (/\s/.test(character)) {
      if (part !== undefined) parts.push(part)
      part = undefined
    } else {
      part = (part ?? '') + character
    }
  }
  if (part !== undefined) parts.push(part)
  return parts
}

/** A recording opened to be looked back through, as the window that opened it is told of it */
export interface OpenedRewind {
  terminalId: string
  /** The session a view attaches to */
  session: string
  /** The moments it runs between, in milliseconds since the Unix epoch */
  first: number
  last: number
}

class TerminalService {
  private terminals: Map<string, Terminal> = new Map()
  /** Recordings being looked back through, by the session each is drawn from, with the window that opened it */
  private rewinds = new Map<string, { rewind: TerminalRewind; client: string | undefined }>()
  /** Hands out `Terminal.opening` tokens; monotonic per process, and only ever compared for equality */
  private openings = 0
  /** The restarts on their way, by terminal */
  private restarting = new Map<string, Promise<TerminalInfo | null>>()

  async create(options: TerminalCreate, handlers: TerminalHandlers): Promise<TerminalInfo> {
    // Check terminal limit (0 = no limit)
    const codeSettings = featureSettings.forFeature('code').get()
    const maxTerminals = codeSettings?.maxTerminals ?? 0
    if (maxTerminals > 0 && this.terminals.size >= maxTerminals) {
      throw new Error(`Maximum number of terminals (${maxTerminals}) reached`)
    }

    // The id is taken now and the row written once the terminal has started, with what it started with
    const id = newId(EARS.Entity.Terminal)
    // **Somewhere else, none of this machine's answers apply**: which shells exist, which directories do,
    // and where a shell's startup files could be written are all the far side's. A terminal on a target
    // starts that machine's own shell where that machine starts one.
    const target = this.targetNamed(options.target, codeSettings)
    const shell = target ? '' : this.shellFor(options.shell)
    const cwd = target ? '' : this.directoryFor(options.cwd)
    const cols = Math.max(1, Math.min(options.cols || 80, 500))
    const rows = Math.max(1, Math.min(options.rows || 24, 200))
    const title = this.sanitizeTitle(options.title || (target ? target.label : path.basename(cwd)) || 'root')

    // **Arranged before the shell starts, not typed into it after** (D3, F14). `undefined` means this
    // platform or shell has no arrangement yet, and the session is started exactly as the user would.
    // The handlers are bound to the id before the session exists, so no byte can arrive with nowhere to go
    const opening = ++this.openings
    const session = await this.open(id, { shell, cwd, cols, rows, target }, false, codeSettings, {
      onEvent: (event) => handlers.onEvent(id, event),
      onExit: (code) => this.exited(id, opening, code, handlers),
    })

    const terminal: Terminal = {
      info: { id, title, pid: session.pid, shell, cwd, generation: 1, cols, rows,
        submit: submitFor(shell), ...this.targetOf(target, session), ...(session.recorded && { recorded: true }) },
      state: { kind: 'live', session, opening },
      // **Nothing has been fitted yet, and a size is not a fit.** `CREATE_TERMINAL` carries no grid — the
      // frontend sends a title and a directory — so the 80x24 defaulted above is this service's number
      // rather than anything a window measured. Recording it as the creating window's fit would make a
      // grid nobody fitted the smallest one, and so the grid every other window is held to.
      fittedBy: new Map(),
      decided: { cols, rows },
      sizing: 0,
      ...(target && { resumes: session.id }),
    }
    this.terminals.set(id, terminal)
    repository.terminalCommands.create({ id, title, shell, cwd, cols, rows, session: session.id, ...(target && { target: target.id }) })

    return published(terminal)
  }


  /**
   * What a session ending means for the terminal above it.
   *
   * **A requested end is a close; otherwise the status decides.** `exit`, `logout` and Ctrl-D all end a
   * shell with 0 and all mean "close this"; a segfault, an OOM kill and a `set -e` script failing do not,
   * and the terminal is where the reason is written. So a clean end removes the terminal and anything else
   * keeps it, with its shell marked gone and its transcript intact.
   *
   * **`closing` is why the code alone is not enough.** `kill` ends the session through the broker, which
   * kills by signal, so the exit it produces is non-zero and would otherwise take the crash branch: the
   * terminal the user just closed would stay in the list marked `[shell exited]` and its row would never be
   * trashed. The intent is recorded where it is known rather than inferred from the exit.
   */
  private exited(id: string, opening: number, code: number | null, handlers: TerminalHandlers): void {
    // **Every exit reaches a terminal that exists.** The host hands a session's feed over only once its
    // holder is holding it (`heldFeed`, `apack-host/src/broker/client.ts`), so an exit from the same read as
    // the spawn — a bad `--init-file`, `cmd /K` on a missing script — arrives after the start path has
    // recorded the terminal and its row. Holding it here was this side's half of that, four times over.
    const terminal = this.terminals.get(id)
    // An exit from a shell this terminal has already replaced, or one whose death it has already recorded
    if (terminal && (terminal.state.kind === 'exited' || terminal.state.opening !== opening)) return
    this.ended(id, code, handlers)
  }

  private ended(id: string, code: number | null, handlers: TerminalHandlers): void {
    const terminal = this.terminals.get(id)
    const closing = terminal?.state.kind === 'closing'
    // Recorded on the terminal before either branch, so a caller still holding it — the open that was
    // handed this exit before it could return — describes a shell that is gone rather than one that is live
    if (terminal) terminal.state = { kind: 'exited', code }
    if (code === 0 || closing) {
      this.removed(id, handlers)
      return
    }
    if (!terminal) return
    handlers.onCrashed(id, code)
  }

  /**
   * **The one place a terminal stops existing**, because stopping is three things and not one: this process
   * forgets it, its row goes to the trash, and every window is told.
   *
   * A path that does two of the three leaves a terminal nobody can get rid of — forgotten here but still
   * drawn in every window, where the next write to it answers "not found"; or still listed here with its row
   * already trashed, so the next boot restores a terminal that was closed. Every close comes through here,
   * which is what makes *closed* mean one thing.
   */
  private removed(id: string, handlers: TerminalHandlers): void {
    this.terminals.delete(id)
    try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch (error) { logger.error(`Could not close ${id}`, { error }) }
    // What it printed goes with it: a recording of a terminal nobody can open again is only a record
    void Promise.resolve().then(() => services.filesystem.remove(recordingFor(id))).catch(() => {})
    handlers.onExit(id)
  }

  /**
   * Starts a new shell under a terminal that already exists, keeping everything about it that is not the
   * process: its id, its title, its place in whatever tab holds it, and the transcript of what came before.
   *
   * **This is what a restart has to be.** Closing a terminal and creating another produces a terminal with
   * a different id, so the window has no way to know it is the same one — the pin, the group and the
   * position go with the old id, and the output of the shell that just failed goes with it too, which is
   * usually the thing the user restarted it to read.
   */
  async restart(id: string, handlers: TerminalHandlers): Promise<TerminalInfo | null> {
    // **One restart of a terminal at a time.** Starting a shell is a round trip — seconds, on a target —
    // and a second ask that arrived inside it would start a second shell under the same terminal, the
    // first one's left running with nothing naming it. Whoever asks meanwhile is answered by the one
    // already on its way
    const underway = this.restarting.get(id)
    if (underway) return underway
    const restarting = this.restartOnce(id, handlers).finally(() => { this.restarting.delete(id) })
    this.restarting.set(id, restarting)
    return restarting
  }

  private async restartOnce(id: string, handlers: TerminalHandlers): Promise<TerminalInfo | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return null

    // **Ended first, and recorded as ended before anything can fail.** Two things follow from that order.
    // The old shell's own exit must not be read as this terminal dying, the session being replaced below —
    // and `exited` carries no open token, so that exit is ignored however late the broker gets to it. And a
    // reopen that throws then leaves a terminal whose state already says no shell is running, rather than
    // one claiming to be live over a session that has gone.
    const previous = terminal.state
    if (previous.kind !== 'exited') {
      terminal.state = { kind: 'exited', code: null }
      await previous.session.terminate().catch((error: unknown) => logger.warn(`Could not end ${id} before restarting it`, { error }))
    }

    const { shell = '', cwd, cols, rows } = terminal.info
    const opening = ++this.openings
    try {
      const settings = featureSettings.forFeature('code').get()
      // On the target it was on. One whose target has left the settings has nowhere to start again
      const target = terminal.info.target ? this.targetNamed(terminal.info.target.id, settings) : undefined
      const listeners = {
        onEvent: (event: TerminalEvent) => handlers.onEvent(id, event),
        onExit: (code: number | null) => this.exited(id, opening, code, handlers),
      }
      // The shell it had on the target, where the target still has it (`Terminal.resumes`). Refused is the
      // ordinary answer for one that ended, and a target that cannot be reached fails the open below too,
      // which is what says why
      const resumed = target && terminal.resumes !== undefined
        ? await services.terminal.at({ command: target.command }).adopt(terminal.resumes, listeners).catch(() => undefined)
        : undefined
      // Otherwise a new shell, started under what the last one printed: usually what it was restarted to read
      const session = resumed ?? await this.open(id, { shell, cwd, cols, rows, target }, true, settings, listeners)
      // **Closed while its shell was being started**: the terminal is gone, and the shell that was for it
      // is ended rather than left under nothing
      if (this.terminals.get(id) !== terminal) {
        await session.terminate().catch(() => {})
        return null
      }
      // **Live before anything else is awaited**, in the same turn the session was handed over: its exit
      // is delivered a turn after that, and one that found the terminal still marked as having no shell
      // would be dropped as a shell already replaced — leaving a terminal shown live over nothing
      terminal.state = { kind: 'live', session, opening }
      if (target) terminal.resumes = session.id
      const { recorded: _was, ...described } = terminal.info
      terminal.info = {
        ...described, pid: session.pid, generation: terminal.info.generation + 1, ...this.targetOf(target, session),
        ...(resumed === undefined && session.recorded && { recorded: true }),
      }
      if (resumed) {
        // What the target says of the shell taken up again: whether it was asked to go on running
        const listed = await services.terminal.at({ command: target!.command }).sessions().catch((): readonly TerminalSessionSummary[] => [])
        if (listed.find(one => one.id === session.id)?.kept) terminal.info = { ...terminal.info, kept: true }
      } else if (terminal.info.kept) {
        // **Kept is the terminal's, so the shell under it is kept too.** A terminal shown as going on
        // running whose new shell ends with the app is the one thing the mark must not mean
        await session.keep(true).catch((error: unknown) => logger.warn(`Could not keep ${id}'s new shell running`, { error }))
      }
      // The row must name the session that is running now. A stored id pointing at the shell this just
      // replaced is the one case offering it cannot survive: the broker would answer for it, and a restart
      // of this process would take up a session no terminal is showing
      repository.terminalCommands.recordSession(id as EARS.EntityId, session.id)
      return published(terminal)
    } catch (error) {
      // The state is already right — this terminal has no shell — but a rejection alone tells no window.
      // The feature replies `terminal.ERROR` to whoever asked and broadcasts nothing, so every other window
      // would go on drawing a live terminal over a shell that is gone, and this one could never be closed.
      handlers.onCrashed(id, null)
      throw error
    }
  }

  /**
   * What a session a window draws is opened with beyond its shell: that its programs may send images, and
   * — where terminals are restored at all — the file it is recorded in, and whether to begin with what
   * that file already holds.
   *
   * **Recorded exactly where restoring is on.** A recording is what lets a restored terminal come back
   * with its screen rather than empty, and it holds everything the shell printed; a user who turned
   * restoring off has said they want neither.
   */
  private drawn(id: string, settings = featureSettings.forFeature('code').get(), restore: boolean) {
    if (!this.records(settings)) return { images: true }
    return { images: true, record: recordingFor(id), restore }
  }

  /** Whether a terminal started on this machine under `settings` is recorded */
  private records(settings = featureSettings.forFeature('code').get()): boolean {
    return settings?.restoreTerminals !== false
  }

  /**
   * The target a terminal was asked to run on, from the settings, or `undefined` for this machine.
   *
   * **A target that is asked for and not there is refused**, rather than quietly becoming a shell on this
   * machine: a command typed into the wrong machine's shell is the mistake a named target exists to prevent.
   */
  private targetNamed(id: string | undefined, settings = featureSettings.forFeature('code').get()) {
    if (id === undefined) return undefined
    const found = settings?.terminalTargets?.find(target => target.id === id)
    if (!found) throw new Error(`No terminal target ${JSON.stringify(id)} in the code settings`)
    const command = commandArguments(found.command)
    if (command.length === 0) throw new Error(`The terminal target ${found.label} has no command to reach it with`)
    return { id: found.id, label: found.label, command }
  }

  /** What a terminal's descriptor says of where it runs, for one that is not on this machine */
  private targetOf(target: { id: string; label: string } | undefined, session: TerminalSession) {
    return target && session.target !== null ? { target: { id: target.id, label: target.label, key: session.target } } : {}
  }

  /**
   * Starts a terminal's shell: on this machine with its startup hook and its recording, or on a target
   * with neither — the hook is a file and the recording a path, and both would be this machine's.
   */
  private async open(
    id: string,
    where: { shell: string; cwd: string; cols: number; rows: number; target?: { command: string[] } },
    restore: boolean,
    settings: ReturnType<ReturnType<typeof featureSettings.forFeature<'code'>>['get']>,
    listeners: { onEvent(event: TerminalEvent): void; onExit(code: number | null): void },
  ): Promise<TerminalSession> {
    const { shell, cwd, cols, rows, target } = where
    if (target) {
      return services.terminal.at({ command: target.command }).open({ cols, rows, colors: TERMINAL_COLORS, images: true }, listeners)
    }
    // **Arranged before the shell starts, not typed into it after** (D3, F14). `undefined` means this
    // platform or shell has no arrangement yet, and the session is started exactly as the user would.
    const integration = await this.arrangeIntegration(shell, settings)
    return services.terminal.open({
      cols, rows, shell, cwd, args: integration?.args, env: integration?.env, colors: TERMINAL_COLORS,
      ...this.drawn(id, settings, restore),
    }, listeners)
  }

  /**
   * Says whether a terminal's shell goes on running when the app is not. Kept, it is not ended when the
   * app quits, and the next start takes it up again as it was — a build still running, a server still up.
   */
  async keep(id: string, kept: boolean): Promise<TerminalInfo | null> {
    const terminal = this.terminals.get(id)
    if (!terminal || terminal.state.kind === 'exited') return null
    // A shell left running is found again by the terminal that is restored over it. With restoring off
    // nothing would ever show it, and it would run where nobody could reach it
    if (kept && !this.records()) {
      throw new Error('A terminal can keep running only while terminals are restored at startup (the code settings)')
    }
    await terminal.state.session.keep(kept)
    terminal.info = { ...terminal.info, kept }
    return published(terminal)
  }

  /**
   * Opens a terminal's recording to be looked back through, or answers `null` for a terminal with none.
   *
   * **A session of its own, with no process.** The window draws it like any other and what is typed at
   * it goes nowhere; the terminal it is a recording of runs on beside it, untouched.
   */
  async rewind(id: string, size: { cols: number; rows: number }, client: string | undefined): Promise<OpenedRewind | null> {
    const terminal = this.terminals.get(id)
    // Nothing to look back through for one that is not recorded (`TerminalInfo.recorded`)
    if (!terminal?.info.recorded) return null
    // One recording open in a window at a time: the one it had open is the one it has stopped looking at
    for (const [session, opened] of this.rewinds) {
      if (client !== undefined && opened.client === client) await this.closeRewind(session).catch(() => {})
    }
    const rewind = await services.terminal.rewind(recordingFor(id), {
      cols: Math.max(1, Math.min(size.cols || terminal.info.cols, 500)),
      rows: Math.max(1, Math.min(size.rows || terminal.info.rows, 200)),
    })
    // Again, for one this window opened while this was on its way
    for (const [session, opened] of this.rewinds) {
      if (client !== undefined && opened.client === client) await this.closeRewind(session).catch(() => {})
    }
    this.rewinds.set(rewind.id, { rewind, client })
    return { terminalId: id, session: rewind.id, first: rewind.first, last: rewind.last }
  }

  /** Shows a recording as it was at `at`, answering the moment shown, or `null` for one that is not open */
  async seekRewind(session: string, at: number): Promise<number | null> {
    const opened = this.rewinds.get(session)
    return opened ? opened.rewind.seek(at) : null
  }

  /** Draws a recording at the grid the window looking at it fitted. Nothing for one that is not open */
  async resizeRewind(session: string, cols: number, rows: number): Promise<void> {
    await this.rewinds.get(session)?.rewind.resize(Math.max(1, Math.min(cols, 500)), Math.max(1, Math.min(rows, 200)))
  }

  async closeRewind(session: string): Promise<void> {
    const opened = this.rewinds.get(session)
    this.rewinds.delete(session)
    await opened?.rewind.close()
  }

  get(id: string): Terminal | undefined {
    return this.terminals.get(id)
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map(published)
  }

  /**
   * The session to act on, or `undefined` when this terminal has no shell running.
   *
   * A terminal whose shell has gone is kept so the user can read what it said, which means every operation
   * that reaches the broker has to ask first. A write that answered success against a dead session told the
   * asker its keystrokes had landed somewhere.
   */
  private running(id: string): TerminalSession | undefined {
    const state = this.terminals.get(id)?.state
    return state === undefined || state.kind === 'exited' ? undefined : state.session
  }

  /**
   * Where the shell says it is, shaped for this platform — **asked of the broker, not parsed again here.**
   *
   * The broker reads the markers where the bytes arrive and is the authority on them, including a sequence
   * split across two reads, which nothing watching chunks can see. What it answers is decoded but not
   * shaped: an OSC 7 URL gives `/C:/Users/...` on Windows, which is X5, so the one platform reader still
   * runs — over the authority's value instead of a second capture of the same bytes.
   */
  async reportedCwd(id: string): Promise<string | undefined> {
    return (await this.reportedFacts(id))?.cwd
  }

  /**
   * What the shell says of itself, asked of the broker the same way: where it is, and `finished`, which moves
   * each time a command it started has ended — so a command that ended before this was asked is still seen
   * to have run. Undefined once the shell has exited.
   */
  async reportedFacts(id: string): Promise<{ cwd: string | undefined; finished: number } | undefined> {
    const session = this.running(id)
    if (!session) return undefined
    const { cwd, finished } = await session.facts()
    return { cwd: cwd === null ? undefined : cwdAsReported(cwd), finished }
  }

  async write(id: string, data: string): Promise<boolean> {
    const session = this.running(id)
    if (!session) return false

    await session.write(data)
    return true
  }

  /**
   * The grid the pty should be running at: the smallest any window showing it has fitted.
   *
   * **No entries means no window has said anything, so the terminal keeps what it has.** That is a restored
   * or adopted terminal before a window attaches, one created by an action or a flow rather than a window,
   * and one whose last fitting window has gone — three paths to the same question, and "resize to nothing"
   * is never the answer to it.
   */
  private gridInForce(terminal: Terminal): Grid {
    let grid: Grid | undefined
    for (const fit of terminal.fittedBy.values()) {
      // A cell is the same size in every window drawing with one font, so whichever fit measured one says it
      grid = grid === undefined
        ? fit
        : { cols: Math.min(grid.cols, fit.cols), rows: Math.min(grid.rows, fit.rows), cell: grid.cell ?? fit.cell }
    }
    return grid ?? { cols: terminal.info.cols, rows: terminal.info.rows }
  }

  /**
   * Brings a terminal to the grid in force, answering it and whether this moved the pty.
   *
   * **The write-back is guarded rather than awaited in order.** `session.resize` is a round trip, so the
   * token is taken before it and checked after: a decision made while this one was in flight has already
   * written the grid it decided, and overwriting it with this one's would leave `info` describing a grid the
   * pty is not running at.
   */
  private async settleGrid(terminal: Terminal): Promise<AcceptedGrid> {
    const { cols, rows, cell } = this.gridInForce(terminal)
    // Against what was decided, never against what windows were told: mid-flight those differ, and `info`
    // is the one that is behind
    if (terminal.decided.cols === cols && terminal.decided.rows === rows) {
      // **A cell that changed size is told to the session and is nobody's news.** A program asking for the
      // terminal's size in pixels should hear the new one, but the grid has not moved, so no window redraws
      if (cell && !sameCell(terminal.decided.cell, cell) && terminal.state.kind !== 'exited') {
        terminal.decided = { cols, rows, cell }
        await terminal.state.session.resize(cols, rows, cell)
      }
      return { cols: terminal.info.cols, rows: terminal.info.rows, changed: false }
    }
    terminal.decided = { cols, rows, cell }
    const sizing = (terminal.sizing += 1)
    // A terminal whose shell has gone has no pty to resize, so the grid it is drawn at is all there is to
    // move. Its kept dead screen reflows with it, which is why this is still recorded and still answered
    if (terminal.state.kind === 'exited') {
      terminal.info.cols = cols
      terminal.info.rows = rows
      return { cols, rows, changed: true }
    }
    await terminal.state.session.resize(cols, rows, cell)
    // Superseded while this was open. The decision that superseded it answered with its own grid, so this
    // answers what is in force rather than the size it asked about
    if (terminal.sizing !== sizing) {
      return { cols: terminal.info.cols, rows: terminal.info.rows, changed: false }
    }
    terminal.info.cols = cols
    terminal.info.rows = rows
    // **No row is written.** The pty's size is not application state: it is whatever the windows showing it
    // last fitted, and a restored terminal is re-fitted the moment a host attaches. What the row keeps is
    // the size it was created at, which is a starting point and not a record of the live size. The live one
    // is answered here and broadcast from the feature, so a window need not read the row for it.
    return { cols, rows, changed: true }
  }

  /**
   * Records what a window fitted and answers **the grid that is in force**, which is the smallest fit.
   *
   * **Every window's fit counts, and none is refused.** A pty has one grid, so a window drawing at a bigger
   * one would draw columns the program cannot write to; the smallest fit is the one every window can show
   * whole. What a window asked for is still not always what it gets, which is why `changed` is here: a grid
   * that moved is every window's business and is broadcast, where a fit that was not honoured is the
   * asker's alone and is replied.
   *
   * `asked` is the connection it was fitted on — the API stamps it and nobody can forge it. Without one
   * there is no window to attribute it to, so nothing is recorded and this answers what is in force: a
   * terminal fitted by an action is not a window showing it.
   */
  async resize(
    id: string, cols: number, rows: number, asked?: string, cell?: TerminalCellSize,
  ): Promise<AcceptedGrid | undefined> {
    const terminal = this.terminals.get(id)
    if (!terminal) return undefined
    if (asked !== undefined) terminal.fittedBy.set(asked, { cols, rows, cell })
    return this.settleGrid(terminal)
  }

  /**
   * A window has stopped showing this terminal, so its fit no longer holds the grid down.
   *
   * **Detaching is not disconnecting**, and leaving this out is how a fix becomes a trade: a popped-out
   * window that fitted a terminal to 60 columns and then switched to another one would pin every other
   * window to 60 for as long as its connection lived — the same symptom as the freeze this replaced,
   * reached a different way. A window says so where it releases its attachment.
   */
  async stoppedFitting(id: string, client: string): Promise<AcceptedGrid | undefined> {
    const terminal = this.terminals.get(id)
    if (!terminal?.fittedBy.delete(client)) return undefined
    return this.settleGrid(terminal)
  }

  /**
   * A connection ended, so every terminal it was fitting loses that fit. Answers the grids that moved.
   *
   * **A connection's end is the only thing that can remove a fit a window left behind.** The id is minted
   * per socket, so a window that reloads, sleeps or drops its connection comes back as a different one and
   * can never clear what the old one recorded. Nothing else knows the window has gone.
   *
   * It answers rather than broadcasts: the service owns the grid, the feature owns the wire.
   */
  async forgetClient(client: string): Promise<Array<{ terminalId: string; grid: AcceptedGrid }>> {
    // A recording a window was looking back through has nobody looking at it
    for (const [session, opened] of this.rewinds) {
      if (opened.client === client) void this.closeRewind(session).catch(() => {})
    }
    const moved: Array<{ terminalId: string; grid: AcceptedGrid }> = []
    for (const [terminalId, terminal] of this.terminals) {
      if (!terminal.fittedBy.delete(client)) continue
      const grid = await this.settleGrid(terminal)
      if (grid.changed) moved.push({ terminalId, grid })
    }
    return moved
  }

  rename(id: string, customTitle: string): boolean {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    const sanitizedTitle = this.sanitizeTitle(customTitle)
    terminal.info.customTitle = sanitizedTitle

    // Update in EARS storage
    repository.terminalCommands.rename(id as EARS.EntityId, sanitizedTitle)

    return true
  }

  updateCwd(id: string, newCwd: string): { cwd: string; title?: string } | null {
    const terminal = this.terminals.get(id)
    if (!terminal) return null
    // **The shell reports its directory before every prompt, and it is the same directory nearly every
    // time.** What arrives is a report, not a change: the hooks emit OSC 7 from the prompt, so a command
    // that runs and finishes in one place reports it twice. Writing anyway cost a row upsert and a commit,
    // plus a broadcast every window answers by re-mapping its terminals and redrawing the tab strip — once
    // per command run, where the directory moves once per `cd`. `null` is what the caller already reads as
    // nothing to announce.
    if (newCwd === terminal.info.cwd) return null

    terminal.info.cwd = newCwd

    // Auto-update title only if no customTitle is set
    let newTitle: string | undefined
    if (!terminal.info.customTitle) {
      newTitle = path.basename(newCwd) || 'root'
      terminal.info.title = this.sanitizeTitle(newTitle)
    }

    // Update in EARS storage
    repository.terminalCommands.updateCwd(id as EARS.EntityId, newCwd, newTitle)

    return { cwd: newCwd, title: newTitle }
  }

  /**
   * Ends a terminal. **Nothing here kills a process**: `terminate` ends the session, the broker kills the
   * tree it owns, and the exit comes back as the session's `onExit` — one exit, one cleanup, whichever way
   * the shell died. What this replaced reached for a pid and a process group, which is F7, and could not do
   * it at all on Windows, which is X1.
   */
  async kill(id: string, handlers: TerminalHandlers): Promise<TerminalClose> {
    const terminal = this.terminals.get(id)
    if (!terminal) return 'unknown'

    // **A shell that has already gone leaves no exit to wait for**, so this is where its terminal closes.
    // The broker forgets a session when it exits and the client drops its listener with it, so asking the
    // broker to kill one is asking about something neither end still holds: nothing answers, and a close
    // that waits for that answer never completes. The terminal was kept for its last words — this is the
    // user finally dismissing it.
    if (terminal.state.kind === 'exited') {
      // **A terminal on a target this run never reached may still have its shell there**, kept running
      // by the target's broker and named by nothing once this row is closed. The person asked for it to
      // end, so the target is reached to end it: best effort, since a target that cannot be reached
      // cannot be told, and that is said in the log rather than refused to the person closing a tab
      if (terminal.state.unreached && terminal.resumes !== undefined && terminal.info.target) {
        const session = terminal.resumes
        try {
          const target = this.targetNamed(terminal.info.target.id)
          const there = await services.terminal.at({ command: target!.command }).adopt(session, { onEvent() {}, onExit() {} })
          await there.terminate()
        } catch (error) {
          logger.warn(`Could not end session ${session} on ${terminal.info.target.label}; it may still be running there`, { error })
        }
      }
      this.removed(id, handlers)
      return 'closed'
    }

    // Before the ask, because the exit can arrive inside `terminate()` and has to find the intent already set
    const { session, opening } = terminal.state
    terminal.state = { kind: 'closing', session, opening }
    try {
      await session.terminate()
      return 'ending'
    } catch (error) {
      logger.error('Error killing terminal', { error })
      // The session is gone whatever the broker answered; a row left active would outlive it (L2), and a
      // window that was never told would go on drawing a terminal this process has forgotten. The broker
      // answered nothing, so there is no status to carry.
      this.removed(id, handlers)
      return 'refused'
    }
  }

  /**
   * The shell to start, and a line in the log when it is not the one asked for.
   *
   * `known-shells.ts` has why the answer is derived rather than listed (F13) and why a shell arriving as
   * data has to be checked at all (S3). What is here is the reporting: a refusal is worth a line, because
   * the user asked for one shell and got another.
   */
  private shellFor(shell: string | undefined): string {
    const chosen = shellToStart(shell)
    if (chosen.refused !== undefined) {
      logger.warn(`This machine does not start ${chosen.refused}; using ${chosen.shell}. `
        + 'A shell has to be the login shell or listed in /etc/shells.')
    }
    return chosen.shell
  }

  private directoryFor(cwd: string | undefined): string {
    const chosen = directoryToStart(cwd)
    if (chosen.refused !== undefined) {
      logger.warn(`${chosen.refused} is not a directory to start in; using ${chosen.cwd}`)
    }
    return chosen.cwd
  }

  private sanitizeTitle(title: string): string {
    // Remove any control characters and limit length
    // Stripping control characters is the purpose: a pty title can carry anything.
    // eslint-disable-next-line no-control-regex
    return title.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 100)
  }

  /**
   * Writes what a shell needs to report itself, and answers how to start it — or `undefined` when there is
   * nothing arranged for this shell or this platform, or when the user has turned integration off.
   *
   * The files are rewritten on every session rather than once: they are small, they are ours, and the
   * alternative is a stale copy surviving an app upgrade with nobody able to say which version wrote it.
   */
  private async arrangeIntegration(shell: string, settings = featureSettings.forFeature('code').get()) {
    // **Read by default, passed where the caller already has it.** `.get()` is not a field read: it queries
    // the row, clones it, validates the whole settings document across every feature, then merges — so
    // `create` was paying for it twice and `restoreAll` once per restored row, for an answer that cannot
    // differ between rows of one run.
    if (settings?.enableShellIntegration === false) return undefined

    const directory = integrationDirectory()
    const arrangement = integrationFor(shell, directory)
    if (!arrangement) return undefined

    try {
      for (const file of arrangement.files) {
        await services.filesystem.writeFile(path.join(directory, file.at), file.contents)
      }
    } catch (error) {
      // A shell that starts without its hook is a terminal that does not follow `cd`; one that does not
      // start at all is a terminal. So this reports and carries on
      logger.warn('Could not write shell integration; the terminal will not report its directory', { error })
      return undefined
    }
    return arrangement
  }

  /**
   * Takes up the session a row names, if the broker still has it, and says whether it did.
   *
   * A refusal is the ordinary case rather than a failure: a full app restart ends every session, so every id
   * a row carries is then stale, and the caller starts a shell instead. That is why this offers the id
   * rather than checking first — there is nothing to check it against that the broker would not answer
   * better.
   */
  private async adopt(
    row: TerminalEntity, session: string, handlers: TerminalHandlers, listed: TerminalSessionSummary | undefined,
  ): Promise<boolean> {
    const shell = this.shellFor(row.shell)
    const opening = ++this.openings
    try {
      const taken = await services.terminal.adopt(session, {
        onEvent: (event) => handlers.onEvent(row.id, event),
        onExit: (code) => this.exited(row.id, opening, code, handlers),
      })
      const info: Terminal['info'] = {
        id: row.id,
        title: row.title,
        customTitle: row.customTitle,
        // The broker answers a pid for a spawn and not for this, and absent is the honest answer: the shell
        // is the one any window watching was already watching, so there is no boundary for a pid to mark
        pid: taken.pid,
        shell,
        // The row records no count, so this starts at one whether the session survived or not. Nothing reads
        // it as a boundary — the pid does that, and an adopted session has none to read
        generation: 1,
        cwd: this.directoryFor(row.cwd),
        cols: row.cols,
        rows: row.rows,
        submit: submitFor(shell),
        ...(listed?.kept && { kept: true }),
        ...(listed?.recorded && { recorded: true }),
      }
      this.terminals.set(row.id, { info, state: { kind: 'live', session: taken, opening }, fittedBy: new Map(), decided: { cols: info.cols, rows: info.rows }, sizing: 0 })
      logger.info(`Took up session ${session} again for terminal ${row.title} (${row.id}); its shell and its output survived`)
      return true
    } catch (error) {
      logger.info(`Session ${session} for terminal ${row.id} is gone; starting a shell instead`, { error })
      return false
    }
  }

  /**
   * Brings back every terminal the last run left: the session itself where it is still running, and
   * otherwise a fresh shell in the directory it was in.
   *
   * **Two different things are called restoring, and only one of them loses anything.** Electron main holds
   * the broker's sessions for the life of the app, so a restart of *this* process — a dev reload, a
   * crash-restart — leaves every shell running with its output intact, and those are taken up again. A
   * restart of the *app* ends them with the hold, and what comes back there is the record: a new shell in
   * the old one's directory, the previous process and its output gone.
   *
   * Either way nothing here reaches for a pid. A row carrying one was checked for liveness and SIGKILLed
   * with its group, which is **F7** — and which could name a process the OS had since given to something
   * else. The broker owns the processes a run leaves behind.
   */
  async restoreAll(handlers: TerminalHandlers): Promise<void> {
    const persisted = repository.terminalQueries.all()
    // One read for the restore: every row asks the same question of the same document
    const codeSettings = featureSettings.forFeature('code').get()
    // What the broker says of the sessions still running — which were asked to be, which are recorded —
    // which is what a terminal taken up again is shown as. Asked once, and not at all when no row names one
    let running: Promise<Map<string, TerminalSessionSummary>> | undefined
    const listed = (): Promise<Map<string, TerminalSessionSummary>> => running ??= this.runningSessions()

    for (const row of persisted) {
      if (this.terminals.has(row.id)) continue
      const opening = ++this.openings
      try {
        // On the target it was on. One whose target has left the settings has nowhere to come back to,
        // and is closed rather than started on this machine in its place
        const target = this.targetNamed(row.target, codeSettings)
        // **A terminal on a target comes back without its target being run.** Reaching one is a command
        // from the settings, and a row and a setting are both data (S3) — a backup import writes them —
        // so starting the app must not be what runs it. And a target that cannot be reached just now is
        // not a terminal that has ended: it is listed as not connected, and starting it again takes up
        // the shell it had there or starts one
        if (target) {
          this.terminals.set(row.id, {
            info: {
              id: row.id, title: row.title, customTitle: row.customTitle, pid: null, shell: '', generation: 1, cwd: '',
              cols: row.cols, rows: row.rows, submit: submitFor(''),
              target: { id: target.id, label: target.label },
            },
            state: { kind: 'exited', code: null, unreached: true },
            fittedBy: new Map(), decided: { cols: row.cols, rows: row.rows }, sizing: 0,
            ...(row.session !== undefined && { resumes: row.session }),
          })
          continue
        }
        // Asked rather than assumed: a stored id is a name, and offering a stale one costs one refused request
        if (row.session !== undefined
          && await this.adopt(row, row.session, handlers, (await listed()).get(row.session))) continue
        // **A row is data** (S3): the database console writes one, `apack db exec` writes one, and a backup
        // import replaces the whole store without looking at a row. So a stored shell and a stored directory
        // go through the same check a created one does, rather than straight to a spawn.
        const shell = this.shellFor(row.shell)
        const cwd = this.directoryFor(row.cwd)
        // **The same decision as every other session's**, rather than a second copy of it: a restored
        // terminal whose shell dies keeps its screen and reports the crash, where this used to delete the
        // terminal and report a clean exit 0 — losing the error, and only for terminals that came from a row.
        // Started under the screen the last run left, where it recorded one
        const session = await this.open(row.id, { shell, cwd, cols: row.cols, rows: row.rows }, true, codeSettings, {
          onEvent: (event) => handlers.onEvent(row.id, event),
          onExit: (code) => this.exited(row.id, opening, code, handlers),
        })

        const info: Terminal['info'] = {
          id: row.id,
          title: row.title,
          customTitle: row.customTitle,
          pid: session.pid,
          shell,
          // A restored terminal is a new shell in the old one's directory, so it is a first generation: the
          // process the previous run had is gone
          generation: 1,
          cwd,
          cols: row.cols,
          rows: row.rows,
          submit: submitFor(shell),
          ...(session.recorded && { recorded: true }),
        }
        this.terminals.set(row.id, { info, state: { kind: 'live', session, opening }, fittedBy: new Map(), decided: { cols: info.cols, rows: info.rows }, sizing: 0 })
        // **The row names the session that is running now, as every other start records it.** Left naming
        // the one this replaced, the next restart of this process offers a stale id, is refused, and starts
        // a second shell beside one the app's hold is still keeping alive — the accumulation taking a
        // session up again exists to prevent, once per API restart for the life of the app.
        repository.terminalCommands.recordSession(row.id, session.id)

        logger.info(`Restored terminal ${row.title} (${row.id}) as a new shell (pid ${session.pid}); the previous process is gone`)
      } catch (error) {
        logger.error(`Failed to restore terminal ${row.id}`, { error })
        repository.terminalCommands.markClosed(row.id)
      }
    }
  }

  /** The sessions this machine's broker has, by id, as it describes each */
  private async runningSessions(): Promise<Map<string, TerminalSessionSummary>> {
    const sessions = await services.terminal.sessions().catch((): readonly TerminalSessionSummary[] => [])
    return new Map(sessions.map(session => [session.id, session]))
  }

  /**
   * Ends every shell that was left running on this machine and that no terminal has taken up.
   *
   * **A kept shell with no terminal over it runs where nothing can reach it**, for as long as the machine
   * is up: its row was closed, the data was replaced, or restoring was turned off since it was kept. The
   * broker is this data directory's own, so a session on it that this app shows nowhere is nobody's.
   * Called once the terminals a start brings back are back.
   */
  async endUnclaimedKept(): Promise<void> {
    const claimed = new Set<string>()
    for (const terminal of this.terminals.values()) {
      if (terminal.state.kind !== 'exited') claimed.add(terminal.state.session.id)
    }
    for (const [session, { kept }] of await this.runningSessions()) {
      if (!kept || claimed.has(session)) continue
      try {
        const unclaimed = await services.terminal.adopt(session, { onEvent() {}, onExit() {} })
        await unclaimed.terminate()
        logger.info(`Ended session ${session}, which was left running and belongs to no terminal`)
      } catch (error) {
        logger.warn(`Could not end session ${session}, which belongs to no terminal`, { error })
      }
    }
  }
}

export const terminalService = new TerminalService()

