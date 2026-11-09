import { featureSettings } from '#generated/settings.ts';

import { newId } from '#generated/ears.ts';
import * as path from 'path'
import type { TerminalInfo, TerminalCreate } from '../types.ts'
import type { TerminalEntity } from '../repository/index.ts'
import { EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { services } from '#generated/services.ts'
import type { TerminalSession } from '@apackdev/sdk/services'
import { directoryToStart, shellToStart, submitFor } from './known-shells.ts'
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
  /** The shell has gone and the terminal was kept, holding what it ended with. There is no session */
  | { kind: 'exited'; code: number | null }

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
   * The connection that opened it, which is the one allowed to size it (**M2**).
   *
   * A pty has one `(cols, rows)`, so two windows fitting the same session to their own widths is not a race
   * to resolve but a contradiction — last writer wins, and the other window's screen is wrong until
   * something makes it fit again. One window owns the size; the rest draw at it. Absent when the terminal
   * was restored or opened by something that is not a window, in which case the first window to fit it
   * takes the size and every later one is told no.
   */
  sizedBy: string | undefined
}

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
  ...(terminal.state.kind === 'exited' && { exited: { code: terminal.state.code } }),
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
  onData(terminalId: string, data: string): void
  /** The shell ended and the terminal is gone with it */
  onExit(terminalId: string, exitCode: number): void
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

class TerminalService {
  private terminals: Map<string, Terminal> = new Map()
  /** Hands out `Terminal.opening` tokens; monotonic per process, and only ever compared for equality */
  private openings = 0

  async create(options: TerminalCreate, handlers: TerminalHandlers, sizedBy?: string): Promise<TerminalInfo> {
    // Check terminal limit (0 = no limit)
    const codeSettings = featureSettings.forFeature('code').get()
    const maxTerminals = codeSettings?.maxTerminals ?? 0
    if (maxTerminals > 0 && this.terminals.size >= maxTerminals) {
      throw new Error(`Maximum number of terminals (${maxTerminals}) reached`)
    }

    // The id is taken now and the row written once the terminal has started, with what it started with
    const id = newId(EARS.Entity.Terminal)
    const shell = this.shellFor(options.shell)
    const cwd = this.directoryFor(options.cwd)
    const cols = Math.max(1, Math.min(options.cols || 80, 500))
    const rows = Math.max(1, Math.min(options.rows || 24, 200))
    const title = this.sanitizeTitle(options.title || path.basename(cwd) || 'root')

    // **Arranged before the shell starts, not typed into it after** (D3, F14). `undefined` means this
    // platform or shell has no arrangement yet, and the session is started exactly as the user would.
    const integration = await this.arrangeIntegration(shell)

    // The handlers are bound to the id before the session exists, so no byte can arrive with nowhere to go
    const opening = ++this.openings
    const session = await services.terminal.open({
      cols, rows, shell, cwd, args: integration?.args, env: integration?.env,
    }, {
      onOutput: (data) => handlers.onData(id, data),
      onExit: (code) => this.exited(id, opening, code, handlers),
    })

    const terminal: Terminal = {
      info: { id, title, pid: session.pid, shell, cwd, generation: 1, cols, rows,
        scrollback: session.scrollback, submit: submitFor(shell) },
      state: { kind: 'live', session, opening },
      sizedBy,
    }
    this.terminals.set(id, terminal)
    repository.terminalCommands.create({ id, title, shell, cwd, cols, rows, session: session.id })

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
    const terminal = this.terminals.get(id)
    // An exit from a shell this terminal has already replaced, or one whose death it has already recorded.
    // Absent entirely is a different case — a shell that died inside its own `open()`, before the terminal
    // was recorded — which `ended` answers.
    if (terminal && (terminal.state.kind === 'exited' || terminal.state.opening !== opening)) return
    this.ended(id, code, handlers)
  }

  private ended(id: string, code: number | null, handlers: TerminalHandlers): void {
    const terminal = this.terminals.get(id)
    if (code === 0 || terminal?.state.kind === 'closing') {
      this.removed(id, code, handlers)
      return
    }
    if (!terminal) return
    terminal.state = { kind: 'exited', code }
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
  private removed(id: string, code: number | null, handlers: TerminalHandlers): void {
    this.terminals.delete(id)
    try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch (error) { logger.error(`Could not close ${id}`, { error }) }
    handlers.onExit(id, code ?? 0)
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

    const { shell, cwd, cols, rows } = terminal.info
    try {
      const integration = await this.arrangeIntegration(this.shellFor(shell))
      const opening = ++this.openings
      const session = await services.terminal.open({
        cols, rows, shell, cwd, args: integration?.args, env: integration?.env,
      }, {
        onOutput: (data) => handlers.onData(id, data),
        onExit: (code) => this.exited(id, opening, code, handlers),
      })

      terminal.state = { kind: 'live', session, opening }
      terminal.info = { ...terminal.info, pid: session.pid, generation: terminal.info.generation + 1 }
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

  async write(id: string, data: string): Promise<boolean> {
    const session = this.running(id)
    if (!session) return false

    await session.write(data)
    return true
  }

  /**
   * Sizes a terminal, if `asked` is the connection allowed to, answering **the grid that is in force**.
   *
   * **A second window observes; it does not resize** (M2). It still fits its own host and still sends what
   * it fitted — a view cannot know it is the second one — so the refusal is here, where the session is. A
   * session with no owner takes the first fit it is given and answers to that connection from then on,
   * which is how a restored terminal acquires one.
   *
   * **What the refusal is not any more is silent.** A boolean could not say the thing a caller needs: a
   * refused resize answered `true`, so the asker could not tell *done* from *ignored* and went on rendering
   * at a grid nothing had agreed to. The accepted grid answers both cases, and `changed` separates news
   * from a refusal — a grid that moved is every window's business, a refusal is the asker's alone.
   */
  async resize(id: string, cols: number, rows: number, asked?: string): Promise<AcceptedGrid | undefined> {
    const terminal = this.terminals.get(id)
    if (!terminal) return undefined
    // A terminal whose shell has gone keeps the grid it last had. There is no pty to resize, so a window
    // fitting its dead screen is asking about a size nothing can change — a refusal, not a failure
    if (terminal.state.kind === 'exited') {
      return { cols: terminal.info.cols, rows: terminal.info.rows, changed: false }
    }
    if (terminal.sizedBy === undefined) terminal.sizedBy = asked
    else if (asked !== undefined && asked !== terminal.sizedBy) {
      return { cols: terminal.info.cols, rows: terminal.info.rows, changed: false }
    }
    if (terminal.info.cols === cols && terminal.info.rows === rows) {
      return { cols, rows, changed: false }
    }

    await terminal.state.session.resize(cols, rows)
    terminal.info.cols = cols
    terminal.info.rows = rows
    // **No row is written.** The pty's size is not application state: it is whatever the owning window last
    // fitted, and a restored terminal is re-fitted the moment its host attaches. What the row keeps is the
    // size it was created at, which is a starting point and not a record of the live size. The live one is
    // answered here and broadcast from the feature, so a window need not read the row for it.
    return { cols, rows, changed: true }
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
      this.removed(id, terminal.state.code, handlers)
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
      this.removed(id, null, handlers)
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
  private async arrangeIntegration(shell: string) {
    const settings = featureSettings.forFeature('code').get()
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
  private async adopt(row: TerminalEntity, session: string, handlers: TerminalHandlers): Promise<boolean> {
    const shell = this.shellFor(row.shell)
    const opening = ++this.openings
    try {
      const taken = await services.terminal.adopt(session, {
        onOutput: (data) => handlers.onData(row.id, data),
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
        scrollback: taken.scrollback,
        submit: submitFor(shell),
      }
      // Sized by nobody, as any restore is: the first window to fit it takes the size (M2)
      this.terminals.set(row.id, { info, state: { kind: 'live', session: taken, opening }, sizedBy: undefined })
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

    for (const row of persisted) {
      if (this.terminals.has(row.id)) continue
      // Asked rather than assumed: a stored id is a name, and offering a stale one costs one refused request
      // **A row is data** (S3): the database console writes one, `apack db exec` writes one, and a backup
      // import replaces the whole store without looking at a row. So a stored shell and a stored directory
      // go through the same check a created one does, rather than straight to a spawn.
      const shell = this.shellFor(row.shell)
      const cwd = this.directoryFor(row.cwd)
      try {
        const integration = await this.arrangeIntegration(shell)
        // **The same decision as every other session's**, rather than a second copy of it: a restored
        // terminal whose shell dies keeps its screen and reports the crash, where this used to delete the
        // terminal and report a clean exit 0 — losing the error, and only for terminals that came from a row
        const opening = ++this.openings
        const session = await services.terminal.open(
          { cols: row.cols, rows: row.rows, shell, cwd, args: integration?.args, env: integration?.env },
          {
            onOutput: (data) => handlers.onData(row.id, data),
            onExit: (code) => this.exited(row.id, opening, code, handlers),
          },
        )

        const info: Terminal['info'] = {
          id: row.id,
          title: row.title,
          customTitle: row.customTitle,
          pid: session.pid,
          shell,
          // A restored terminal is a new shell in the old one's directory, so it is a first generation: the
          // process the previous run had is gone and nothing of its transcript survived the app closing
          generation: 1,
          cwd,
          cols: row.cols,
          rows: row.rows,
          // The session's own, not the row's: a row records where a terminal started, and the scrollback is
          // the host's answer for the session running now
          scrollback: session.scrollback,
          submit: submitFor(shell),
        }
        // Restored by nobody, so the first window to fit it takes the size (M2)
        this.terminals.set(row.id, { info, state: { kind: 'live', session, opening }, sizedBy: undefined })

        logger.info(`Restored terminal ${row.title} (${row.id}) as a new shell (pid ${session.pid}); the previous process and its output are gone`)
      } catch (error) {
        logger.error(`Failed to restore terminal ${row.id}`, { error })
        repository.terminalCommands.markClosed(row.id)
      }
    }
  }
}

export const terminalService = new TerminalService()

