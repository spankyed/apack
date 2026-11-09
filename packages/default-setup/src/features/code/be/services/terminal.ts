import { featureSettings } from '#generated/settings.ts';

import { newId } from '#generated/ears.ts';
import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import type { TerminalInfo, TerminalCreate } from '../types.ts'
import { EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { agentChildEnvironment } from './shell-environment.ts';

const logger = createLogger('terminal');

interface Terminal {
  info: TerminalInfo
  pty: pty.IPty
  dataDisposable?: pty.IDisposable
  exitDisposable?: pty.IDisposable
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
  /**
   * Dynamic-loader variables, which a shell this app starts must not inherit: they make every program run
   * from that shell load code chosen by whoever set them.
   *
   * What the app set on its own process is stripped separately and is **not** listed here — it is derived
   * from the declaration that names it (`agentChildEnvironment`), because a hand-written list is the shape
   * that rots: this one named two of those ten, and a user's shell was inheriting the app's data directory,
   * its shipped-packs directory, its port and its API token, where any command they type can read them out.
   */
  private readonly BLOCKED_LOADER_VARS = [
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
  ]

  private get defaultShell(): string {
    return process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
  }

  private killProcessGroup(pid: number): void {
    if (process.platform !== 'win32') {
      try { process.kill(-pid, 'SIGHUP') } catch {}
    }
  }

  create(options: TerminalCreate): TerminalInfo {
    // Check terminal limit (0 = no limit)
    const codeSettings = featureSettings.forFeature('code').get()
    const maxTerminals = codeSettings?.maxTerminals ?? 0
    if (maxTerminals > 0 && this.terminals.size >= maxTerminals) {
      throw new Error(`Maximum number of terminals (${maxTerminals}) reached`)
    }

    // Generate a proper terminal ID using EARS entity creation
    // The id is taken now and the row written once the terminal has started, with what it started with
    const id = newId(EARS.Entity.Terminal)
    
    // Validate and sanitize shell
    const requestedShell = options.shell || this.defaultShell
    const shell = this.validateShell(requestedShell)
    
    // Validate cwd exists and is accessible
    const cwd = this.validateCwd(options.cwd)

    // Validate terminal dimensions
    const cols = Math.max(1, Math.min(options.cols || 80, 500))
    const rows = Math.max(1, Math.min(options.rows || 24, 200))

    // Generate default title from cwd (use directory name)
    const defaultTitle = path.basename(cwd) || 'root'
    const title = this.sanitizeTitle(options.title || defaultTitle)

    try {
      // Sanitize environment variables
      const sanitizedEnv = this.sanitizeEnvironment(process.env as { [key: string]: string })

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: sanitizedEnv
      })

      // Send shell integration setup commands based on shell type (if enabled)
      const codeSettings = featureSettings.forFeature('code').get()
      if (codeSettings?.enableShellIntegration !== false) {
        this.injectShellIntegration(ptyProcess, shell)
      }

      const info: TerminalInfo = {
        id,
        title,
        pid: ptyProcess.pid,
        shell,
        cwd,
        active: true,
        cols,
        rows
      }

      const terminal: Terminal = {
        info,
        pty: ptyProcess
      }
      
      this.terminals.set(id, terminal)
      
      // Save terminal metadata to EARS
      repository.terminalCommands.create({
        id,
        title,
        pid: ptyProcess.pid,
        shell,
        cwd,
        cols,
        rows
      })
      
      return info
    } catch (error) {
      throw new Error(`Failed to create terminal: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  get(id: string): Terminal | undefined {
    return this.terminals.get(id)
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map(t => t.info)
  }

  write(id: string, data: string): boolean {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    terminal.pty.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    terminal.pty.resize(cols, rows)
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

  kill(id: string): boolean {
    const terminal = this.terminals.get(id)
    if (!terminal) return false

    try {
      // Dispose data listener but keep exit handler alive so it can fire terminal.CLOSED
      terminal.dataDisposable?.dispose()
      terminal.dataDisposable = undefined

      // Kill the entire process group (shell + children) before killing the pty
      this.killProcessGroup(terminal.pty.pid)
      terminal.pty.kill()

      // If onExit already fired synchronously during pty.kill(), terminal is cleaned up
      if (!this.terminals.has(id)) return true

      // If no exit handler is registered (shouldn't happen), clean up immediately
      if (!terminal.exitDisposable) {
        this.terminals.delete(id)
        repository.terminalCommands.markClosed(id as EARS.EntityId)
      }
      // Otherwise, the onExit callback handles cleanup and emitting terminal.CLOSED

      return true
    } catch (error) {
      logger.error('Error killing terminal', { error })
      // Ensure cleanup even on error so terminals don't leak
      this.terminals.delete(id)
      try { repository.terminalCommands.markClosed(id as EARS.EntityId) } catch { /* already logged */ }
      return false
    }
  }

  killAll(): void {
    for (const [id, terminal] of this.terminals) {
      try {
        terminal.dataDisposable?.dispose()
        terminal.exitDisposable?.dispose()
        // Kill the entire process group (shell + children) before killing the pty
        this.killProcessGroup(terminal.pty.pid)
        terminal.pty.kill()
      } catch (error) {
        logger.error(`Error killing terminal ${id}`, { error })
      }
    }
    this.terminals.clear()
  }

  onData(id: string, callback: (data: string) => void): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return

    terminal.dataDisposable?.dispose()
    terminal.dataDisposable = terminal.pty.onData(callback)
  }

  onExit(id: string, callback: (exitCode: number, signal?: number) => void): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return

    terminal.exitDisposable?.dispose()
    terminal.exitDisposable = terminal.pty.onExit(({ exitCode, signal }) => {
      try {
        // Dispose listeners before removing terminal
        terminal.dataDisposable?.dispose()
        terminal.dataDisposable = undefined
        terminal.exitDisposable?.dispose()
        terminal.exitDisposable = undefined
        this.terminals.delete(id)
        repository.terminalCommands.markClosed(id as EARS.EntityId)
        callback(exitCode, signal)
      } catch (error) {
        logger.error(`Error in exit handler for ${id}`, { error })
      }
    })
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

  private sanitizeEnvironment(env: { [key: string]: string }): { [key: string]: string } {
    const sanitized = agentChildEnvironment(env) as { [key: string]: string }

    // Remove dangerous environment variables
    for (const blocked of this.BLOCKED_LOADER_VARS) {
      delete sanitized[blocked]
    }

    // Set terminal identification so shells know they're in a capable terminal
    sanitized.TERM_PROGRAM = 'apack'
    sanitized.COLORTERM = 'truecolor'

    return sanitized
  }

  private injectShellIntegration(ptyProcess: pty.IPty, shell: string): void {
    const shellName = path.basename(shell).replace(/\.exe$/i, '').toLowerCase()

    const comment = '# apack listener'

    if (shellName.includes('bash')) {
      ptyProcess.write(`__ab_osc7(){ printf "\\033]7;file://%s%s\\007" "$(hostname)" "$PWD"; }; PROMPT_COMMAND="__ab_osc7\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ${comment}\n`)
    } else if (shellName.includes('zsh')) {
      ptyProcess.write(`__ab_osc7(){ printf "\\033]7;file://%s%s\\007" "$(hostname)" "$PWD"; }; precmd_functions+=(__ab_osc7) ${comment}\n`)
    } else if (shellName.includes('fish')) {
      ptyProcess.write(`function __ab_osc7 --on-event fish_prompt; printf "\\033]7;file://%s%s\\007" (hostname) $PWD; end ${comment}\n`)
    }
  }

  async restoreAll(setupHandlers: (terminalInfo: TerminalInfo) => void): Promise<void> {
    // Get all active terminals from EARS
    const persistedTerminals = repository.terminalQueries.active()

    // Check if shell integration is enabled
    const codeSettings = featureSettings.forFeature('code').get()
    const shellIntegrationEnabled = codeSettings?.enableShellIntegration !== false

    for (const persistedTerminal of persistedTerminals) {
      try {
        // Skip if already in memory
        if (this.terminals.has(persistedTerminal.id)) {
          continue
        }

        // Kill orphaned process from previous session (e.g. after a crash)
        const oldPid = persistedTerminal.pid
        if (oldPid) {
          try {
            process.kill(oldPid, 0) // Check if still alive
            this.killProcessGroup(oldPid)
            try { process.kill(oldPid, 'SIGKILL') } catch {}
            logger.info(`Killed orphaned process ${oldPid} for terminal ${persistedTerminal.id}`)
          } catch {
            // Process doesn't exist — expected after clean shutdown
          }
        }

        // Sanitize environment variables
        const sanitizedEnv = this.sanitizeEnvironment(process.env as { [key: string]: string })

        // Spawn new pty process for the terminal
        const ptyProcess = pty.spawn(persistedTerminal.shell, [], {
          name: 'xterm-256color',
          cols: persistedTerminal.cols,
          rows: persistedTerminal.rows,
          cwd: persistedTerminal.cwd,
          env: sanitizedEnv
        })

        // Inject shell integration (if enabled)
        if (shellIntegrationEnabled) {
          this.injectShellIntegration(ptyProcess, persistedTerminal.shell)
        }
        
        const terminalInfo: TerminalInfo = {
          id: persistedTerminal.id,
          title: persistedTerminal.title,
          customTitle: persistedTerminal.customTitle,
          pid: ptyProcess.pid,
          shell: persistedTerminal.shell,
          cwd: persistedTerminal.cwd,
          active: persistedTerminal.active,
          cols: persistedTerminal.cols,
          rows: persistedTerminal.rows
        }
        
        const terminal: Terminal = {
          info: terminalInfo,
          pty: ptyProcess
        }
        
        this.terminals.set(persistedTerminal.id, terminal)
        
        // Update PID in EARS since we have a new process
        repository.terminalCommands.updatePid(persistedTerminal.id, ptyProcess.pid)
        
        // Set up handlers for this terminal
        setupHandlers(terminalInfo)
        
        // "Restored" is the record, not the session: a new shell in the old one's cwd. Said plainly here
        // because the log was read as evidence the terminals had survived a crash, and they had not.
        logger.info(`Restored terminal ${persistedTerminal.title} (${persistedTerminal.id}) as a new shell (pid ${ptyProcess.pid}); the previous process and its output are gone`)
      } catch (error) {
        logger.error(`Failed to restore terminal ${persistedTerminal.id}`, { error })
        // Mark as closed if restoration fails
        repository.terminalCommands.markClosed(persistedTerminal.id)
      }
    }
  }
}

export const terminalService = new TerminalService()

