/**
 * Codex App-Server client — manages a persistent `codex app-server` subprocess.
 *
 * Spawns `codex app-server --listen stdio://` and communicates via JSONL.
 * Handles three message types on the wire:
 * 1. Responses to our requests (request correlation via id)
 * 2. Server-initiated requests (approval flow — bidirectional)
 * 3. Notifications (streaming events — routed to per-thread consumers)
 */

import { spawn, type ChildProcess } from 'child_process'
import { createInterface, type Interface } from 'readline'
import { createLogger } from '@apackdev/sdk/logger'
import { answerWhileWorking, processWork } from '@apackdev/sdk/progress'
import { resolveForService } from '../../utils/resolve-cli.ts'
import type {
  ServerStatus,
  ApprovalDecision,
  ThreadStartParams,
  ThreadForkParams,
  ThreadReadParams,
  ThreadRollbackParams,
  ThreadListParams,
  ConfigReadParams,
  ConfigValueWriteParams,
  TurnStartParams,
  ConsumerHandlers,
  ListMcpServersParams,
} from './types.ts'

const logger = createLogger('codex-app-server')

// ─── Request correlation ────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (result: any) => void
  reject: (error: Error) => void
  /** A request's own deadline, which the handshake has none of: it is bounded by the server's progress */
  timeout?: ReturnType<typeof setTimeout>
}

// ─── App-Server Client ──────────────────────────────────────────────────────

export class CodexAppServer {
  private process: ChildProcess | null = null
  private readline: Interface | null = null
  private pending = new Map<number, PendingRequest>()
  private consumers = new Map<string, ConsumerHandlers>()
  private _status: ServerStatus = 'stopped'
  private _error: string | undefined
  private _counter = 0
  private _stopping = false
  private _initResolve: ((result: any) => void) | null = null
  private _initReject: ((err: Error) => void) | null = null

  get status(): ServerStatus { return this._status }
  get error(): string | undefined { return this._error }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._status === 'ready') return
    if (this._status === 'starting') return

    this._status = 'starting'
    this._error = undefined

    const cliPath = await resolveForService('codex')

    logger.info('Starting codex app-server', { cliPath })

    this.process = spawn(cliPath, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Forward stderr to logger
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        logger.debug(`[app-server-stderr] ${line}`)
      }
    })

    // Set up readline BEFORE the init promise so we don't miss messages
    this.readline = createInterface({ input: this.process.stdout! })
    this.readline.on('line', (line: string) => this._handleLine(line))

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      logger.info('App-server process exited', { code, signal })
      const wasReady = this._status === 'ready'
      this._status = wasReady ? 'error' : 'stopped'
      if (wasReady) this._error = `Process exited unexpectedly (code=${code})`
      this.process = null
      this.readline = null

      // Reject all pending requests
      for (const [, p] of this.pending) {
        clearTimeout(p.timeout)
        p.reject(new Error(`App-server exited (code=${code})`))
      }
      this.pending.clear()

      // Notify consumers of unexpected crash (skip during graceful stop)
      if (wasReady && !this._stopping) {
        const errorMsg = `App-server exited unexpectedly (code=${code}, signal=${signal})`
        for (const [threadId, consumer] of this.consumers) {
          try {
            consumer.onCrash?.(errorMsg)
          } catch (err) {
            logger.warn('Consumer onCrash handler failed', { threadId, error: (err as Error).message })
          }
        }
      }
      this.consumers.clear()

      // Reject init if pending
      if (this._initReject) {
        this._initReject(new Error(`App-server exited during init (code=${code})`))
        this._initResolve = null
        this._initReject = null
      }
    })

    this.process.on('error', (err) => {
      logger.error('App-server process error', { error: err.message })
      this._status = 'error'
      this._error = err.message
      // Reject init if pending so start() doesn't hang on spawn failure
      if (this._initReject) {
        this._initReject(new Error(`App-server spawn failed: ${err.message}`))
        this._initResolve = null
        this._initReject = null
      }
    })

    // The handshake waits for as long as the server is working to answer it, and no longer than it goes without
    const pid = this.process.pid
    const handshake = this._initialize()
    try {
      await (pid === undefined ? handshake : answerWhileWorking(handshake, { work: processWork(pid), what: 'The codex app-server' }))
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return

    this._stopping = true
    logger.info('Stopping codex app-server', { pid: this.process.pid })

    // Close stdin to signal graceful shutdown
    this.process.stdin?.end()

    // Give it 3s to exit, then SIGKILL
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          logger.warn('App-server did not exit gracefully, sending SIGKILL')
          this.process.kill('SIGKILL')
        }
        resolve()
      }, 3_000)

      this.process!.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this._status = 'stopped'
    this._stopping = false
    this.process = null
    this.readline = null
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  // ── Thread management ─────────────────────────────────────────────────

  async startThread(params: ThreadStartParams): Promise<{ threadId: string; model: string; cwd: string }> {
    if (!params.cwd) {
      throw new Error('startThread requires a cwd — refusing to fall back to process.cwd()')
    }
    const result = await this._request('thread/start', {
      ...(params.cwd && { cwd: params.cwd }),
      ...(params.model && { model: params.model }),
      ...(params.sandbox && { sandbox: params.sandbox }),
      ...(params.approvalsReviewer && { approvalsReviewer: params.approvalsReviewer }),
    })
    return {
      threadId: result.thread?.id ?? result.thread?.sessionId ?? '',
      model: result.model ?? '',
      cwd: result.cwd ?? '',
    }
  }

  async resumeThread(threadId: string, params?: Partial<ThreadStartParams>): Promise<{ threadId: string }> {
    const result = await this._request('thread/resume', {
      threadId,
      ...(params?.model && { model: params.model }),
      ...(params?.sandbox && { sandbox: params.sandbox }),
      ...(params?.approvalsReviewer && { approvalsReviewer: params.approvalsReviewer }),
    })
    return { threadId: result.thread?.id ?? threadId }
  }

  async readThread(threadId: string, params: ThreadReadParams = {}): Promise<{ thread: any }> {
    const result = await this._request('thread/read', {
      threadId,
      includeTurns: params.includeTurns ?? true,
    })
    return { thread: result.thread }
  }

  async forkThread(params: ThreadForkParams): Promise<{ threadId: string; model: string; cwd: string; thread: any }> {
    const result = await this._request('thread/fork', {
      threadId: params.threadId,
      ...(params.cwd && { cwd: params.cwd }),
      ...(params.model && { model: params.model }),
      ...(params.sandbox && { sandbox: params.sandbox }),
      ...(params.approvalsReviewer && { approvalsReviewer: params.approvalsReviewer }),
    })
    return {
      threadId: result.thread?.id ?? '',
      model: result.model ?? '',
      cwd: result.cwd ?? result.thread?.cwd ?? '',
      thread: result.thread,
    }
  }

  async rollbackThread(params: ThreadRollbackParams): Promise<{ thread: any }> {
    const result = await this._request('thread/rollback', {
      threadId: params.threadId,
      numTurns: params.numTurns,
    }, 60_000)
    return { thread: result.thread }
  }

  async compactThread(threadId: string): Promise<void> {
    await this._request('thread/compact/start', { threadId })
  }

  async listThreads(params: ThreadListParams = {}): Promise<{ data: any[]; nextCursor: string | null; backwardsCursor: string | null }> {
    return await this._request('thread/list', params)
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this._request('thread/name/set', { threadId, name })
  }

  // ── Metadata/config helpers ───────────────────────────────────────────

  async readConfig(params: ConfigReadParams = { includeLayers: false }): Promise<any> {
    return await this._request('config/read', params)
  }

  async writeConfigValue(params: ConfigValueWriteParams): Promise<any> {
    return await this._request('config/value/write', {
      keyPath: params.keyPath,
      value: params.value,
      mergeStrategy: params.mergeStrategy ?? 'replace',
      ...(params.filePath !== undefined && { filePath: params.filePath }),
      ...(params.expectedVersion !== undefined && { expectedVersion: params.expectedVersion }),
    })
  }

  async listModels(params: { cursor?: string | null; limit?: number | null; includeHidden?: boolean } = {}): Promise<any> {
    return await this._request('model/list', params)
  }

  async readAccount(params: { refreshToken: boolean } = { refreshToken: false }): Promise<any> {
    return await this._request('account/read', params)
  }

  async listSkills(params: { cwds?: string[]; forceReload?: boolean } = {}): Promise<any> {
    return await this._request('skills/list', params)
  }

  async listMcpServers(params: ListMcpServersParams = {}): Promise<any> {
    return await this._request('mcpServerStatus/list', params)
  }

  // ── Turn management ───────────────────────────────────────────────────

  async startTurn(params: TurnStartParams): Promise<{ turnId: string }> {
    const result = await this._request('turn/start', {
      threadId: params.threadId,
      input: params.input,
      ...(params.cwd && { cwd: params.cwd }),
      ...(params.model && { model: params.model }),
      ...(params.collaborationMode && { collaborationMode: params.collaborationMode }),
      ...(params.approvalsReviewer && { approvalsReviewer: params.approvalsReviewer }),
    })
    return { turnId: result.turn?.id ?? '' }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this._request('turn/interrupt', { threadId, turnId })
  }

  // ── Approval response ─────────────────────────────────────────────────

  respondToApproval(requestId: number, decision: ApprovalDecision): void {
    this._write({ id: requestId, result: { decision } })
  }

  // ── Consumer registration ─────────────────────────────────────────────

  registerConsumer(codexThreadId: string, handlers: ConsumerHandlers): void {
    this.consumers.set(codexThreadId, handlers)
  }

  unregisterConsumer(codexThreadId: string): void {
    this.consumers.delete(codexThreadId)
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async _initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._initResolve = () => {
        this._initResolve = null
        this._initReject = null
        this._status = 'ready'
        logger.info('App-server ready')
        resolve()
      }
      this._initReject = (err) => {
        this._initResolve = null
        this._initReject = null
        reject(err)
      }

      // Send initialize request
      const id = this._nextId()
      this.pending.set(id, {
        resolve: (result: any) => {
          // Send initialized notification to complete handshake
          this._write({ method: 'initialized', params: {} })
          this._initResolve?.(result)
        },
        reject: (err: Error) => {
          this._initReject?.(err)
        },
      })

      this._write({
        method: 'initialize',
        id,
        params: {
          clientInfo: { name: 'apack', version: '0.3.0' },
          capabilities: { experimentalApi: true },
        },
      })
    })
  }

  private _nextId(): number {
    return ++this._counter
  }

  private _request(method: string, params: Record<string, any> = {}, timeoutMs = 30_000): Promise<any> {
    if (this._status !== 'ready') {
      return Promise.reject(new Error(`App-server not ready (status: ${this._status})`))
    }

    const id = this._nextId()

    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })
      this._write({ method, id, params })
    })
  }

  private _write(msg: Record<string, any>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('App-server stdin not writable')
    }
    const line = JSON.stringify(msg) + '\n'
    this.process.stdin.write(line)
  }

  private _handleLine(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      logger.warn('Invalid JSON from app-server', { line: line.slice(0, 200) })
      return
    }

    // Case 1: Response to our request (has id, no method)
    if (msg.id != null && !msg.method) {
      const pending = this.pending.get(msg.id)
      if (!pending) {
        logger.warn('No pending request for id', { id: msg.id })
        return
      }
      this.pending.delete(msg.id)
      clearTimeout(pending.timeout)
      if (msg.error) {
        pending.reject(new Error(msg.error?.message || msg.error?.data || 'App-server error'))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    // Case 2: Server-initiated request (has id AND method) — approvals
    if (msg.id != null && msg.method) {
      const threadId = msg.params?.threadId
      const consumer = threadId ? this.consumers.get(threadId) : undefined
      if (consumer) {
        consumer.onApproval(msg.method, msg.id, msg.params)
      } else {
        // No consumer registered — auto-decline to unblock the server
        logger.warn('No consumer for approval request, declining', { threadId, method: msg.method })
        this._write({ id: msg.id, result: { decision: 'decline' } })
      }
      return
    }

    // Case 3: Notification (has method, no id) — streaming events
    if (msg.method) {
      const threadId = msg.params?.threadId
      const consumer = threadId ? this.consumers.get(threadId) : undefined
      if (consumer) {
        consumer.onNotification(msg.method, msg.params)
      }
      // Silently drop notifications with no consumer (e.g. thread/closed after cleanup)
      return
    }

    logger.warn('Unrecognized message from app-server', { msg })
  }
}
