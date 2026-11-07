import { featureSettings } from '#generated/settings.ts';

import { newId } from '#generated/ears.ts';
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import type { TerminalInfo, TerminalCreate } from '../types.ts'
import { EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { services } from '#generated/services.ts'
import type { TerminalSession } from '@apackdev/sdk/services'

const logger = createLogger('terminal');

interface Terminal {
  info: TerminalInfo
  /** The host's session. The process is the broker's, so this holds no pty and no handle to one */
  session: TerminalSession
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
  onExit(terminalId: string, exitCode: number): void
}

class TerminalService {
  private terminals: Map<string, Terminal> = new Map()
  private readonly ALLOWED_SHELLS = [
    '/bin/bash',
    '/bin/sh',
    '/bin/zsh',
    '/usr/bin/bash',
    '/usr/bin/sh',
    '/usr/bin/zsh',
    'bash',
    'sh',
    'zsh',
    'powershell.exe',
    'cmd.exe'
  ]

  private get defaultShell(): string {
    return process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
  }

  async create(options: TerminalCreate, handlers: TerminalHandlers): Promise<TerminalInfo> {
    // Check terminal limit (0 = no limit)
    const codeSettings = featureSettings.forFeature('code').get()
    const maxTerminals = codeSettings?.maxTerminals ?? 0
    if (maxTerminals > 0 && this.terminals.size >= maxTerminals) {
      throw new Error(`Maximum number of terminals (${maxTerminals}) reached`)
    }

    // The id is taken now and the row written once the terminal has started, with what it started with
    const id = newId(EARS.Entity.Terminal)
    const shell = this.validateShell(options.shell || this.defaultShell)
    const cwd = this.validateCwd(options.cwd)
    const cols = Math.max(1, Math.min(options.cols || 80, 500))
    const rows = Math.max(1, Math.min(options.rows || 24, 200))
    const title = this.sanitizeTitle(options.title || path.basename(cwd) || 'root')

    // The handlers are bound to the id before the session exists, so no byte can arrive with nowhere to go
    const session = await services.terminal.open({ cols, rows, shell, cwd }, {
      onOutput: (data) => handlers.onData(id, data),
      onExit: (code) => {
        this.terminals.delete(id)
        try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch (error) { logger.error(`Could not close ${id}`, { error }) }
        handlers.onExit(id, code ?? 0)
      },
    })

    const info: TerminalInfo = { id, title, pid: session.pid, shell, cwd, active: true, cols, rows }
    this.terminals.set(id, { info, session })
    repository.terminalCommands.create({ id, title, pid: session.pid, shell, cwd, cols, rows })

    const integration = featureSettings.forFeature('code').get()
    if (integration?.enableShellIntegration !== false) {
      await this.injectShellIntegration(session, shell)
    }

    return info
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

  async resize(id: string, cols: number, rows: number): Promise<boolean> {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    await terminal.session.resize(cols, rows)
    terminal.info.cols = cols
    terminal.info.rows = rows

    // Update in EARS storage
    repository.terminalCommands.resize(id as EARS.EntityId, cols, rows)

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
  async killAll(): Promise<void> {
    const open = [...this.terminals.entries()]
    this.terminals.clear()
    await Promise.all(open.map(async ([id, terminal]) => {
      try {
        await terminal.session.terminate()
      } catch (error) {
        logger.error(`Error killing terminal ${id}`, { error })
      }
      try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch (error) { logger.error(`Could not close ${id}`, { error }) }
    }))
  }

  private validateShell(shell: string): string {
    // Normalize shell path
    const normalizedShell = shell.toLowerCase().trim()
    
    // Check against allowed shells
    if (this.ALLOWED_SHELLS.some(allowed =>
      normalizedShell === allowed.toLowerCase() ||
      path.basename(normalizedShell) === allowed.toLowerCase()
    )) {
      return shell
    }
    
    logger.warn(`Invalid shell requested: ${shell}, defaulting to ${this.defaultShell}`)
    return this.defaultShell
  }

  private validateCwd(cwd?: string): string {
    if (!cwd) {
      // No directory provided, use home directory
      return os.homedir()
    }
    
    try {
      // Check if directory exists and is accessible
      const stats = fs.statSync(cwd)
      if (stats.isDirectory()) {
        return cwd
      }
    } catch (error) {
      logger.warn(`Invalid cwd: ${cwd}, defaulting to home directory`, { error })
    }
    // Fall back to home directory if provided path is invalid
    return os.homedir()
  }

  private sanitizeTitle(title: string): string {
    // Remove any control characters and limit length
    // Stripping control characters is the purpose: a pty title can carry anything.
    // eslint-disable-next-line no-control-regex
    return title.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 100)
  }

  /**
   * Types the OSC 7 hook into the user's shell, which is the mechanism D3 calls defective and keeps for now:
   * it echoes, races startup and has no branch for PowerShell or cmd (X4). Launch-time injection replaces it
   * in the phase that owns the markers; what changed here is only that it writes through the session.
   */
  private async injectShellIntegration(session: TerminalSession, shell: string): Promise<void> {
    const shellName = path.basename(shell).replace(/\.exe$/i, '').toLowerCase()
    const comment = '# apack listener'

    if (shellName.includes('bash')) {
      await session.write(`__ab_osc7(){ printf "\\033]7;file://%s%s\\007" "$(hostname)" "$PWD"; }; PROMPT_COMMAND="__ab_osc7\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ${comment}\n`)
    } else if (shellName.includes('zsh')) {
      await session.write(`__ab_osc7(){ printf "\\033]7;file://%s%s\\007" "$(hostname)" "$PWD"; }; precmd_functions+=(__ab_osc7) ${comment}\n`)
    } else if (shellName.includes('fish')) {
      await session.write(`function __ab_osc7 --on-event fish_prompt; printf "\\033]7;file://%s%s\\007" (hostname) $PWD; end ${comment}\n`)
    }
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
    const persisted = repository.terminalQueries.active()
    const codeSettings = featureSettings.forFeature('code').get()
    const shellIntegrationEnabled = codeSettings?.enableShellIntegration !== false

    for (const row of persisted) {
      if (this.terminals.has(row.id)) continue
      try {
        const session = await services.terminal.open(
          { cols: row.cols, rows: row.rows, shell: row.shell, cwd: row.cwd },
          {
            onOutput: (data) => handlers.onData(row.id, data),
            onExit: (code) => {
              this.terminals.delete(row.id)
              try { repository.terminalCommands.markClosed(row.id) } catch (error) { logger.error(`Could not close ${row.id}`, { error }) }
              handlers.onExit(row.id, code ?? 0)
            },
          },
        )

        const info: TerminalInfo = {
          id: row.id,
          title: row.title,
          customTitle: row.customTitle,
          pid: session.pid,
          shell: row.shell,
          cwd: row.cwd,
          active: row.active,
          cols: row.cols,
          rows: row.rows,
        }
        this.terminals.set(row.id, { info, session })
        repository.terminalCommands.updatePid(row.id, session.pid)
        if (shellIntegrationEnabled) await this.injectShellIntegration(session, row.shell)

        logger.info(`Restored terminal ${row.title} (${row.id}) as a new shell (pid ${session.pid}); the previous process and its output are gone`)
      } catch (error) {
        logger.error(`Failed to restore terminal ${row.id}`, { error })
        repository.terminalCommands.markClosed(row.id)
      }
    }
  }
}

export const terminalService = new TerminalService()

