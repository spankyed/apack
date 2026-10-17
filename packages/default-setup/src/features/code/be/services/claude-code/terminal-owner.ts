import { PermissionModeSchema } from './types.ts'
import { createClaudeNativeJournalReader, type ClaudeNativeJournalEntry } from './terminal-journal.ts'
import type { ClaudeNativeTerminalRecord, ClaudeNativeSubmissionReceipt } from './terminal-session.ts'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { resolveForService } from '../../utils/resolve-cli.ts'
import { buildChildEnv } from './runner.ts'
import { createClaudeTerminalBridge } from './terminal-bridge.ts'
import type { PermissionMode } from './types.ts'
import type { ClaudeSettings } from './host-controls.ts'
import type { ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'

export interface ClaudeNativeTerminalOwner {
  readonly state: ClaudeNativeTerminalState
  readonly busy: boolean
  readonly done: Promise<void>
  /** Raw native terminal bytes, sequenced independently of presentation metadata. */
  readonly output: readonly { sequence: number; text: string }[]
  readJournal(): Promise<ClaudeNativeJournalEntry[]>
  readonly records: readonly { sequence: number; record: ClaudeNativeTerminalRecord }[]
  subscribe(listener: () => void): () => void
  input(ownerId: string, text: string): boolean
  resize(ownerId: string, columns: number, rows: number): boolean
  submit(text: string): Promise<ClaudeNativeSubmissionReceipt>
  close(): Promise<void>
  kill(): void
}
export interface ClaudePreparedNativeTerminal { start(): Promise<ClaudeNativeTerminalOwner>; dispose(): Promise<void> }
export interface ClaudeNativeTerminalOptions {
  sessionId: string
  cwd: string
  settings: ClaudeSettings
  permissionMode: PermissionMode
  cliPath?: string
  env?: NodeJS.ProcessEnv
  columns?: number
  rows?: number
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
  addDir?: string[]
  pluginDir?: string[]
  signal?: AbortSignal
}

/** One native terminal process; no print sidecar and no independent status-command scheduler. */
export async function prepareClaudeNativeTerminal(options: ClaudeNativeTerminalOptions): Promise<ClaudePreparedNativeTerminal> {
  if (process.platform === 'win32') throw new Error('Native terminal status handoff currently requires a POSIX host')
  if (!/^[a-f0-9-]{36}$/i.test(options.sessionId)) throw new Error('Native terminal needs an existing session identity')
  const executable = options.cliPath ?? await resolveForService('claude-code')
  if (options.signal?.aborted) throw new Error('Native terminal startup was cancelled')
  await access(executable, constants.X_OK)
  if (!(await stat(options.cwd)).isDirectory()) throw new Error('Native terminal working directory is unavailable')
  const env = buildChildEnv(options.env)
  const terminalEnv: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') terminalEnv[name] = value
  const readJournal = createClaudeNativeJournalReader()
  const ownerId = randomUUID(), listeners = new Set<() => void>()
  const output: { sequence: number; text: string }[] = []
  let sequence = 0, outputSize = 0, terminal: pty.IPty | undefined, closed = false
  let status: ClaudeNativeTerminalState['status'] = 'starting'
  let exitCode: number | undefined, stopping = false
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })
  const changed = () => { for (const listener of listeners) { try { listener() } catch { /* isolate views */ } } }
  const bridge = await createClaudeTerminalBridge({ sessionId: options.sessionId, settings: options.settings, electronEnv: env.ELECTRON_RUN_AS_NODE, changed,
    enter() { if (closed || !terminal) throw new Error('Native terminal closed'); terminal.write('\r') } })
  let hardStop: ReturnType<typeof setTimeout> | undefined
  async function finish(code: number) {
    if (closed) return
    closed = true; clearTimeout(hardStop); status = stopping || code === 0 ? 'exited' : 'error'; exitCode = code
    try { await bridge.close() } finally { changed(); resolveDone() }
  }
  function kill() {
    if (closed || !terminal) return
    stopping = true
    try { if (terminal.pid > 1 && terminal.pid !== process.pid) process.kill(-terminal.pid, 'SIGTERM') } catch { /* already gone */ }
    try { terminal.kill('SIGTERM') } catch { /* already gone */ }
    if (!hardStop) {
      const pid = terminal.pid
      hardStop = setTimeout(() => { if (!closed) { try { process.kill(-pid, 'SIGKILL') } catch { /* gone */ } } }, 2000)
      hardStop.unref()
    }
  }
  let started = false
  async function start(): Promise<ClaudeNativeTerminalOwner> {
    if (started || closed) throw new Error('Native terminal startup is no longer available')
    started = true
    try {
      const args = ['--resume', options.sessionId, '--permission-mode', options.permissionMode, '--plugin-dir', bridge.pluginRoot]
      if (Object.keys(bridge.settings).length) args.push('--settings', JSON.stringify(bridge.settings))
      for (const directory of options.pluginDir ?? []) args.push('--plugin-dir', directory)
      if (options.model) args.push('--model', options.model)
      if (options.allowedTools?.length) args.push('--allowed-tools', ...options.allowedTools)
      if (options.disallowedTools?.length) args.push('--disallowed-tools', ...options.disallowedTools)
      if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)
      for (const directory of options.addDir ?? []) args.push('--add-dir', directory)
      if (options.signal?.aborted) throw new Error('Native terminal startup was cancelled')
      terminal = pty.spawn(executable, args, { cwd: options.cwd, env: terminalEnv, name: 'xterm-256color', cols: options.columns ?? 100, rows: options.rows ?? 30 })
      terminal.onData(text => {
        if (closed) return
        const bytes = Buffer.from(text)
        if (bytes.length > 262144) {
          let from = bytes.length - 262144
          while (from < bytes.length && (bytes[from]! & 0xc0) === 0x80) from++
          text = bytes.subarray(from).toString()
        }
        output.push({ sequence: ++sequence, text }); outputSize += Buffer.byteLength(text)
        while (output.length > 1 && outputSize > 262144) outputSize -= Buffer.byteLength(output.shift()!.text)
        changed()
      })
      terminal.onExit(({ exitCode }) => { options.signal?.removeEventListener('abort', kill); void finish(exitCode).catch(() => {}) })
      options.signal?.addEventListener('abort', kill, { once: true })
      if (options.signal?.aborted) kill()
      status = 'starting'
    } catch (error) { await bridge.close(); closed = true; resolveDone(); throw error }
    return {
      get state() { return { ownerId, sessionId: bridge.projection.sessionId, cwd: options.cwd, status: status === 'starting' && bridge.ready ? 'live' : status, pid: terminal?.pid, exitCode, busy: bridge.busy, lastTurn: bridge.lastTurn, session: bridge.session.metadata, mainStatus: bridge.projection.mainStatus, tasks: bridge.projection.tasks } },
      get busy() { return !closed && (bridge.busy || bridge.projection.tasks.some(task => !['completed', 'failed', 'stopped'].includes(task.status))) },
      get output() { return output },
      get records() { return bridge.session.records },
      async readJournal() {
        const entries = await readJournal(bridge.transcripts)
        for (const entry of entries) {
          const metadata = bridge.session.metadata
          if (entry.sessionId !== bridge.projection.sessionId || !metadata) continue
          if (entry.row.type === 'cost-state' && typeof entry.row.totalCostUSD === 'number' && Number.isFinite(entry.row.totalCostUSD) && entry.row.totalCostUSD >= 0) {
            bridge.session.update({ ...metadata, totalCostUsd: Math.max(metadata.totalCostUsd ?? 0, entry.row.totalCostUSD) })
          }
          if (entry.row.type === 'permission-mode') {
            const mode = PermissionModeSchema.safeParse(entry.row.permissionMode)
            if (mode.success) bridge.session.update({ ...metadata, permissionMode: mode.data })
          }
        }
        return entries
      }, done,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      input(id, text) { if (closed || id !== ownerId || typeof text !== 'string' || text.length > 32768) return false; terminal!.write(text); return true },
      resize(id, columns, rows) {
        if (closed || id !== ownerId || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || columns > 500 || rows < 2 || rows > 200) return false
        terminal!.resize(columns, rows); return true
      },
      submit(text) { return bridge.submit(text) },
      kill,
      async close() { if (!closed) kill(); await done },
    }
  }
  return { start, async dispose() { if (started && terminal) { kill(); await done } else if (!closed) { closed = true; await bridge.close(); resolveDone() } } }
}
