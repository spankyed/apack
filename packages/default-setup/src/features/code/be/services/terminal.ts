import { featureSettings } from '#generated/settings.ts';

import { newId } from '#generated/ears.ts';
import * as path from 'path'
import type { TerminalInfo, TerminalCreate } from '../types.ts'
import { EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { services } from '#generated/services.ts'
import type { TerminalSession } from '@apackdev/sdk/services'
import { directoryToStart, shellToStart, submitFor } from './known-shells.ts'
import { integrationDirectory, integrationFor } from './shell-integration.ts'

const logger = createLogger('terminal');

interface Terminal {
  info: TerminalInfo
  /** The host's session. The process is the broker's, so this holds no pty and no handle to one */
  session: TerminalSession
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
  /**
   * Set when something asked for this terminal to end, so the exit that follows is a close.
   *
   * **The exit code cannot carry the intent.** The broker's kill is a signal — `portable-pty` sends SIGHUP
   * and reports a signal death as a non-zero code, and Windows is `TerminateProcess(…, 127)` — so a
   * terminal the user closed arrives here looking exactly like a shell that died on its own. Asking the
   * code was reading the consequence; this is the request.
   */
  closing?: true
  /**
   * Which open this terminal's exits must come from.
   *
   * **A terminal outlives its shells, so an exit has to say which one it was.** Every session's `onExit` is
   * a closure over the terminal's id, so a restart leaves two of them pointing at one terminal; the first
   * one's exit, arriving after the replacement, would describe a generation the window has already been
   * told started — marking a fresh terminal crashed, or trashing the row the restart just rebuilt. A
   * restart claims the terminal with a new token before it ends the old shell, so the old closure is
   * already stale when its exit lands.
   */
  opening: number
}

/**
 * Where a terminal's output and exit go, **given before the session exists**.
 *
 * That ordering is the whole of F8's fix: the listeners used to be registered after `create` returned, so
 * whatever the shell wrote first — its prompt, and anything a command printed before the handler landed —
 * was dropped. `services.terminal.open` takes them, so there is no window in which output has nowhere to go.
 */
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

    const info: TerminalInfo = { id, title, pid: session.pid, shell, cwd, active: true, generation: 1, cols, rows, submit: submitFor(shell) }
    this.terminals.set(id, { info, session, sizedBy, opening })
    repository.terminalCommands.create({ id, title, shell, cwd, cols, rows })

    return info
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
    // A shell this terminal has already replaced. Absent entirely is a different case — a shell that died
    // inside its own `open()`, before the terminal was recorded — which `ended` answers.
    if (terminal && terminal.opening !== opening) return
    this.ended(id, code, handlers)
  }

  private ended(id: string, code: number | null, handlers: TerminalHandlers): void {
    const terminal = this.terminals.get(id)
    if (code === 0 || terminal?.closing) {
      this.terminals.delete(id)
      try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch (error) { logger.error(`Could not close ${id}`, { error }) }
      handlers.onExit(id, code ?? 0)
      return
    }
    if (!terminal) return
    terminal.info.active = false
    terminal.info.exited = { code }
    handlers.onCrashed(id, code)
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

    // Whatever is there is ended first, and its own exit must not be read as the terminal closing: the
    // session is replaced below, so the handler would be reporting the death of a shell nobody has yet
    // been told started
    // Claimed before the old shell is ended, so its exit — which arrives whenever the broker gets to it,
    // possibly inside the `await`s below — is already somebody else's and is ignored
    const opening = ++this.openings
    terminal.opening = opening
    if (terminal.info.active) {
      terminal.info.active = false
      await terminal.session.terminate().catch((error: unknown) => logger.warn(`Could not end ${id} before restarting it`, { error }))
    }

    const { shell, cwd, cols, rows } = terminal.info
    const integration = await this.arrangeIntegration(this.shellFor(shell))
    const session = await services.terminal.open({
      cols, rows, shell, cwd, args: integration?.args, env: integration?.env,
    }, {
      onOutput: (data) => handlers.onData(id, data),
      onExit: (code) => this.exited(id, opening, code, handlers),
    })

    terminal.session = session
    terminal.info = {
      ...terminal.info,
      pid: session.pid,
      active: true,
      generation: terminal.info.generation + 1,
      exited: undefined,
    }
    return terminal.info
  }

  get(id: string): Terminal | undefined {
    return this.terminals.get(id)
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map(t => t.info)
  }

  async write(id: string, data: string): Promise<boolean> {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    await terminal.session.write(data)
    return true
  }

  /**
   * Sizes a terminal, if `asked` is the connection allowed to.
   *
   * **A second window observes; it does not resize** (M2). It still fits its own host and still sends what
   * it fitted — a view cannot know it is the second one — so the refusal is here, where the session is, and
   * it is silent: nothing failed, and telling the user their other window is wider is not a diagnostic they
   * can act on. A session with no owner takes the first fit it is given and answers to that connection from
   * then on, which is how a restored terminal acquires one.
   */
  async resize(id: string, cols: number, rows: number, asked?: string): Promise<boolean> {
    const terminal = this.terminals.get(id)
    if (!terminal) return false
    if (terminal.sizedBy === undefined) terminal.sizedBy = asked
    else if (asked !== undefined && asked !== terminal.sizedBy) return true

    await terminal.session.resize(cols, rows)
    terminal.info.cols = cols
    terminal.info.rows = rows
    // **No row is written.** A drag produces one resize per observed frame — 24 per action, measured, each
    // one an EARS write with no coalescing (F5). The pty's size is not application state: it is whatever the
    // window last fitted, and a restored terminal is re-fitted the moment its host attaches. What the row
    // keeps is the size it was created at, which is a starting point and not a record of the live size.
    return true
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
  async kill(id: string): Promise<boolean> {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    // Before the ask, because the exit can arrive inside `terminate()` and has to find the intent already set
    terminal.closing = true
    try {
      await terminal.session.terminate()
      return true
    } catch (error) {
      logger.error('Error killing terminal', { error })
      // The session is gone whatever the broker answered; a row left active would outlive it (L2)
      this.terminals.delete(id)
      try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch { /* already logged */ }
      return false
    }
  }

  /**
   * Ends every terminal, and **marks every row closed**, which it did not: a run that quit left its rows
   * active, so the next boot restored terminals that had never been open (L2).
   */

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
   * Opens a fresh shell for every row the last run left active, in the directory it was in.
   *
   * **"Restore" is the record, not the session**, and that was true before this change too: the previous
   * process and its output are gone. What changed is that it no longer reaches for the pid the row stored —
   * it used to check whether that process was alive and SIGKILL it and its group, which is **F7**, and which
   * could kill a pid the OS had since given to something else. The broker owns the processes a run leaves
   * behind, so there is nothing here to clean up.
   */
  async restoreAll(handlers: TerminalHandlers): Promise<void> {
    const persisted = repository.terminalQueries.all()

    for (const row of persisted) {
      if (this.terminals.has(row.id)) continue
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

        const info: TerminalInfo = {
          id: row.id,
          title: row.title,
          customTitle: row.customTitle,
          pid: session.pid,
          shell,
          // A restored terminal is a new shell in the old one's directory, so it is a first generation: the
          // process the previous run had is gone and nothing of its transcript survived the app closing
          generation: 1,
          cwd,
          active: true,
          cols: row.cols,
          rows: row.rows,
          submit: submitFor(shell),
        }
        // Restored by nobody, so the first window to fit it takes the size (M2)
        this.terminals.set(row.id, { info, session, sizedBy: undefined, opening })

        logger.info(`Restored terminal ${row.title} (${row.id}) as a new shell (pid ${session.pid}); the previous process and its output are gone`)
      } catch (error) {
        logger.error(`Failed to restore terminal ${row.id}`, { error })
        repository.terminalCommands.markClosed(row.id)
      }
    }
  }
}

export const terminalService = new TerminalService()

