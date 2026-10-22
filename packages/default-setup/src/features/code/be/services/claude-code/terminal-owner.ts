import { ClaudeNativeToolPermissionDialogsSchema, type ClaudeNativeToolPermissionDialog, type ClaudeNativeToolPermissionDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeNoticeSchema, type ClaudeNativeNotice, type ClaudeNativeNoticeResponse } from '../../../common/native-notice.ts'
import { ClaudeNativeWorkflowDialogsSchema, type ClaudeNativeWorkflowDialog, type ClaudeNativeWorkflowDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeTaskResultSchema } from './terminal-tasks.ts'
import { ClaudeNativePlanDialogsSchema, type ClaudeNativePlanDialog, type ClaudeNativePlanDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeBashDialogsSchema, type ClaudeNativeBashDialog, type ClaudeNativeBashDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeQuestionRenderSchema, type ClaudeNativeQuestionRender, type ClaudeNativeQuestionRenderRequest, type ClaudeNativeQuestionHoldRequest, ClaudeNativeQuestionDialogsSchema, type ClaudeNativeQuestionDialog, type ClaudeNativeQuestionDialogResponse, ClaudeNativeFileDialogsSchema, type ClaudeNativeFileDialog, type ClaudeNativeFileDialogResponse } from './terminal-dialogs.ts'
import { isClaudeNativeDescendant } from './native-process-ownership.ts'
import { PermissionModeSchema } from './types.ts'
import { createClaudeNativeJournalReader, type ClaudeNativeJournalBatch } from './terminal-journal.ts'
import type { ClaudeNativeTerminalRecord, ClaudeNativeSubmissionReceipt, ClaudeNativeImage } from './terminal-session.ts'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import * as pty from 'node-pty'
import { createClaudeTerminalGraphicsQueryResponder } from './terminal-graphics-query.ts'
import { randomUUID } from 'node:crypto'
import { resolveForService } from '../../utils/resolve-cli.ts'
import { buildChildEnv } from './runner.ts'
import { createClaudeTerminalBridge } from './terminal-bridge.ts'
import type { PermissionMode } from './types.ts'
import { ClaudeMcpStatusSchema, type ClaudeMcpStatus, ClaudeModelCatalogSchema, type ClaudeModelCatalog, type ClaudeSettings } from './host-controls.ts'
import type { ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'

export interface ClaudeNativeTerminalOwner {
  /** Reviewed native UI operations; reverse hosts and the full UI owner are integrated separately. */
  readonly uiTransport: import('./terminal-ui.ts').ClaudeTerminalUiTransport
  readonly state: ClaudeNativeTerminalState
  readonly busy: boolean
  readonly modelSelection?: string
  readonly done: Promise<void>
  /** Register persistence work before the process exits; done waits for these callbacks. */
  beforeRelease(listener: () => Promise<void>): void
  /** Raw native terminal bytes, sequenced independently of presentation metadata. */
  readonly output: readonly { sequence: number; text: string }[]
  refreshNotice(): Promise<void>
  answerNotice(response: ClaudeNativeNoticeResponse): Promise<void>
  readJournal(): Promise<ClaudeNativeJournalBatch>
  readonly records: readonly { sequence: number; record: ClaudeNativeTerminalRecord }[]
  subscribe(listener: () => void): () => void
  input(ownerId: string, text: string): boolean
  resize(ownerId: string, columns: number, rows: number): boolean
  holdQuestionDialog(request: ClaudeNativeQuestionHoldRequest): Promise<void>
  renderQuestionDialog(request: ClaudeNativeQuestionRenderRequest): Promise<ClaudeNativeQuestionRender>
  getQuestionDialogs(): Promise<ClaudeNativeQuestionDialog[]>
  answerQuestionDialog(response: ClaudeNativeQuestionDialogResponse): Promise<void>
  getBashDialogs(): Promise<ClaudeNativeBashDialog[]>
  answerBashDialog(response: ClaudeNativeBashDialogResponse): Promise<void>
  getPlanDialogs(): Promise<ClaudeNativePlanDialog[]>
  answerPlanDialog(response: ClaudeNativePlanDialogResponse): Promise<void>
  getWorkflowDialogs(): Promise<ClaudeNativeWorkflowDialog[]>
  answerWorkflowDialog(response: ClaudeNativeWorkflowDialogResponse): Promise<void>
  getToolPermissionDialogs(): Promise<ClaudeNativeToolPermissionDialog[]>
  answerToolPermissionDialog(response: ClaudeNativeToolPermissionDialogResponse): Promise<void>
  getFileDialogs(): Promise<ClaudeNativeFileDialog[]>
  answerFileDialog(response: ClaudeNativeFileDialogResponse): Promise<void>
  operateTask(taskId: string, operation: 'inspect' | 'stop' | 'send' | 'input' | 'foreground' | 'background' | 'skip_worker' | 'retry_worker' | 'pause_workflow' | 'resume_workflow', text?: string, worker?: import('../../../common/native-terminal.ts').ClaudeNativeWorkflowWorkerTarget): Promise<{ paused?: boolean; resume?: { taskId: string; runId: string; requested: true }; worker?: import('../../../common/native-terminal.ts').ClaudeNativeWorkflowWorkerReceipt; view?: { taskId: string | null }; sent?: boolean; input?: import('../../../common/native-terminal.ts').ClaudeNativeTaskInputReceipt; stopped?: boolean; details?: import('../../../common/native-terminal.ts').ClaudeNativeTaskDetails }>
  getMcpStatus(): Promise<ClaudeMcpStatus>
  controlMcpServer(serverName: string, operation: 'reconnect' | 'enable' | 'disable'): Promise<ClaudeMcpStatus>
  getModels(options?: { includeUnsupportedModels?: boolean }): Promise<ClaudeModelCatalog>
  renameSession(title: string): Promise<{ title: string; message: string }>
  setModel(model: string): Promise<string>
  setPermissionMode(mode: PermissionMode): Promise<PermissionMode>
  submit(text: string, images?: readonly ClaudeNativeImage[], phase?: 'Plan' | 'Edit'): Promise<ClaudeNativeSubmissionReceipt>
  close(): Promise<void>
  kill(): void
}
export interface ClaudePreparedNativeTerminal { start(): Promise<ClaudeNativeTerminalOwner>; dispose(): Promise<void> }
export interface ClaudeNativeTerminalOptions {
  sessionId: string
  cwd: string
  settings: ClaudeSettings
  permissionMode: PermissionMode
  prePlanMode?: PermissionMode
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
  // Advertise app rendering capabilities only when the caller has not chosen an override.
  if (!terminalEnv.NO_COLOR) terminalEnv.FORCE_COLOR ??= '3'
  terminalEnv.FORCE_HYPERLINK ??= '1'
  // Native automatic detection only admits kitty/ghostty. Our Unicode-placeholder
  // consumer uses Claude's explicit custom-terminal opt-in; never spoof that identity.
  terminalEnv.CLAUDE_CODE_FORCE_TERMINAL_IMAGES ??= '1'
  const readJournal = createClaudeNativeJournalReader()
  const ownerId = randomUUID(), listeners = new Set<() => void>()
  const output: { sequence: number; text: string }[] = []
  let sequence = 0, outputSize = 0, terminal: pty.IPty | undefined, closed = false
  let status: ClaudeNativeTerminalState['status'] = 'starting'
  let exitCode: number | undefined, stopping = false, changingModel = false, changingPermission = false
  let modelSelection = options.model
  const exitObservers: (() => Promise<void>)[] = []
  let releasing = false
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })
  const changed = () => { for (const listener of listeners) { try { listener() } catch { /* isolate views */ } } }
  const bridge = await createClaudeTerminalBridge({ sessionId: options.sessionId, ...(options.permissionMode === 'plan' && options.prePlanMode ? {restorePlan: {sessionId: options.sessionId, mode: options.prePlanMode}} : {}), settings: options.settings, bunOptions: env.BUN_OPTIONS, ownsProcess: pid => isClaudeNativeDescendant(pid, terminal?.pid), changed,
    pasteImage(path) { if (closed || !terminal) throw new Error('Native terminal closed'); terminal.write('\x1b[200~' + path + '\x1b[201~') },
    enter() { if (closed || !terminal) throw new Error('Native terminal closed'); terminal.write('\r') } })
  let hardStop: ReturnType<typeof setTimeout> | undefined
  async function finish(code: number, signal?: number) {
    if (closed) return
    closed = true; clearTimeout(hardStop); status = stopping || code === 0 && !signal ? 'exited' : 'error'; exitCode = code
    try { await bridge.close() } finally {
      releasing = true
      try { for (const observer of exitObservers) await observer() } finally { changed(); resolveDone() }
    }
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
      terminalEnv.BUN_OPTIONS = bridge.bunOptions
      for (const directory of options.pluginDir ?? []) args.push('--plugin-dir', directory)
      if (options.model) args.push('--model', options.model)
      if (options.allowedTools?.length) args.push('--allowed-tools', ...options.allowedTools)
      if (options.disallowedTools?.length) args.push('--disallowed-tools', ...options.disallowedTools)
      if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)
      for (const directory of options.addDir ?? []) args.push('--add-dir', directory)
      if (options.signal?.aborted) throw new Error('Native terminal startup was cancelled')
      terminal = pty.spawn(executable, args, { cwd: options.cwd, env: terminalEnv, name: 'xterm-256color', cols: options.columns ?? 100, rows: options.rows ?? 30 })
      const graphicsQuery = createClaudeTerminalGraphicsQueryResponder(text => { if (!closed) terminal?.write(text) })
      terminal.onData(text => {
        if (closed) return
        graphicsQuery(text)
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
      terminal.onExit(({ exitCode, signal }) => { options.signal?.removeEventListener('abort', kill); void finish(exitCode, signal).catch(() => {}) })
      options.signal?.addEventListener('abort', kill, { once: true })
      if (options.signal?.aborted) kill()
      status = 'starting'
    } catch (error) { await bridge.close(); closed = true; resolveDone(); throw error }
    let notice: ClaudeNativeNotice | undefined
    let changingView = false, preparingParent = false, planRestorationChecked = false
    return {
      get state() { return { notice: closed ? undefined : notice, preview: closed ? undefined : bridge.preview, view: bridge.view, ownerId, sessionId: bridge.projection.sessionId, cwd: options.cwd, status: status === 'starting' && bridge.ready ? 'live' : status, pid: terminal?.pid, nativePid: bridge.nativePid, exitCode, busy: bridge.busy || changingModel || changingPermission || changingView || preparingParent, activity: bridge.activity, focus: bridge.focus, lastTurn: bridge.lastTurn, session: bridge.session.metadata, mainStatus: bridge.projection.mainStatus, problem: bridge.problem, tasks: bridge.projection.tasks } },
      get modelSelection() { return bridge.session.metadata?.modelSelection ?? modelSelection },
      get busy() { return !closed && (changingModel || changingPermission || preparingParent || bridge.busy || bridge.projection.tasks.some(task => !['completed', 'failed', 'killed'].includes(task.status))) },
      get output() { return output },
      get records() { return bridge.session.records },
      uiTransport: bridge.uiTransport,
      async refreshNotice() {
        if (closed || !bridge.ready) return
        const sessionId = bridge.projection.sessionId
        const result = await bridge.uiTransport.request({ subtype: 'apack_billing_notice' }) as { notice?: unknown }
        if (closed || sessionId !== bridge.projection.sessionId) return
        const next = result.notice == null ? undefined : ClaudeNativeNoticeSchema.parse(result.notice)
        if (next && next.sessionId !== sessionId) throw new Error('Native notice session changed')
        if (JSON.stringify(next) !== JSON.stringify(notice)) { notice = next; changed() }
      },
      async answerNotice(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native notice session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_billing_notice', id: response.id, revision: response.revision, session_id: response.sessionId, decision: response.decision }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native notice was not acknowledged')
        if (notice?.id === response.id && notice.revision === response.revision) { notice = undefined; changed() }
      },
      async readJournal() {
        const batch = await readJournal(bridge.transcripts, { final: closed })
        for (const entry of batch.entries) {
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
        return batch
      }, done,
      beforeRelease(listener) {
        if (releasing) throw new Error('Native terminal has already started releasing its owner')
        exitObservers.push(listener)
      },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      input(id, text) { if (closed || (changingView || preparingParent) && text !== '\x03' || id !== ownerId || typeof text !== 'string' || text.length > 32768) return false; terminal!.write(text); return true },
      resize(id, columns, rows) {
        if (closed || id !== ownerId || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || columns > 500 || rows < 2 || rows > 200) return false
        terminal!.resize(columns, rows); return true
      },
      async holdQuestionDialog(request) {
        if (closed || request.sessionId !== bridge.projection.sessionId) throw new Error('Native question session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_hold_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, render_token: request.renderToken }) as { held?: unknown }
        if (result.held !== true) throw new Error('Native question draft was not acknowledged')
      },
      async renderQuestionDialog(request) {
        if (closed || request.sessionId !== bridge.projection.sessionId) throw new Error('Native question session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_render_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, viewport: request.viewport })
        if (closed || request.sessionId !== bridge.projection.sessionId) throw new Error('Native question session changed while rendering')
        return ClaudeNativeQuestionRenderSchema.parse(result)
      },
      async getQuestionDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_question_dialogs' }) as { dialogs?: unknown }
        if (closed) return []
        return ClaudeNativeQuestionDialogsSchema.parse(result.dialogs)
      },
      async answerQuestionDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native question session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_question_dialog', id: response.id, revision: response.revision, session_id: response.sessionId, answer: response.answer, render_token: response.renderToken, draft_started: response.draftStarted }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native question was not acknowledged')
      },
      async getPlanDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_plan_dialogs' }) as { dialogs?: unknown }
        if (closed) return []
        return ClaudeNativePlanDialogsSchema.parse(result.dialogs)
      },
      async answerPlanDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native plan session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_plan_dialog', id: response.id, revision: response.revision, session_id: response.sessionId, choice: response.choice, feedback: response.feedback, plan: response.plan }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native plan decision was not acknowledged')
      },
      async getBashDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_bash_dialogs' }) as { dialogs?: unknown }
        if (closed) return []
        return ClaudeNativeBashDialogsSchema.parse(result.dialogs)
      },
      async answerBashDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native Bash approval session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_bash_dialog', id: response.id, revision: response.revision, session_id: response.sessionId, decision: response.decision, feedback: response.feedback, choice: response.choice, choiceToken: response.choiceToken, prefix: response.prefix }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native Bash approval was not acknowledged')
      },
      async getWorkflowDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_workflow_dialogs' }) as { dialogs?: unknown }
        return closed ? [] : ClaudeNativeWorkflowDialogsSchema.parse(result.dialogs)
      },
      async answerWorkflowDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native workflow session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_workflow_dialog', id: response.id, revision: response.revision, session_id: response.sessionId, decision: response.decision, choice: response.choice, choiceToken: response.choiceToken, feedback: response.feedback }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native workflow approval was not acknowledged')
      },
      async getToolPermissionDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_tool_permission_dialogs' }) as { dialogs?: unknown }
        return closed ? [] : ClaudeNativeToolPermissionDialogsSchema.parse(result.dialogs)
      },
      async answerToolPermissionDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native tool permission session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_tool_permission_dialog', decision: response.decision, id: response.id, revision: response.revision, session_id: response.sessionId, toolName: response.toolName, choice: response.choice, choiceToken: response.choiceToken, feedback: response.feedback }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native tool permission was not acknowledged')
      },
      async getFileDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_file_dialogs' }) as { dialogs?: unknown }
        if (closed) return []
        return ClaudeNativeFileDialogsSchema.parse(result.dialogs)
      },
      async answerFileDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native approval session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_file_dialog', id: response.id, revision: response.revision, session_id: response.sessionId, decision: response.decision, feedback: response.feedback, choice: response.choice, choiceToken: response.choiceToken }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native approval was not acknowledged')
      },
      async operateTask(taskId, operation, text, worker) {
        if (closed || operation !== 'background' && !bridge.projection.tasks.some(task => task.id === taskId)) throw new Error('Native task owner expired')
        const sessionId = bridge.projection.sessionId
        const viewChange = operation === 'foreground' || operation === 'background'
        if (viewChange && (changingView || preparingParent)) throw new Error('Native view or parent input is changing')
        if (viewChange) { changingView = true; changed() }
        try {
          const result = await bridge.uiTransport.request({ subtype: 'apack_task_control', session_id: sessionId, task_id: taskId, operation, ...(worker ? { worker } : {}), ...((operation === 'send' || operation === 'input') ? { text } : {}) })
          if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native task session changed')
          return ClaudeNativeTaskResultSchema.parse(result)
        } finally { if (viewChange) { changingView = false; changed() } }
      },
      async controlMcpServer(serverName, operation) {
        if (closed) throw new Error('Native terminal closed')
        const sessionId = bridge.projection.sessionId
        const result = await bridge.uiTransport.request({ subtype: 'apack_mcp_control', session_id: sessionId, server_name: serverName, operation })
        if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native MCP session changed during control')
        return ClaudeMcpStatusSchema.parse(result)
      },
      async getMcpStatus() {
        if (closed) throw new Error('Native terminal closed')
        const sessionId = bridge.projection.sessionId
        const result = await bridge.uiTransport.request({ subtype: 'apack_mcp_status', session_id: sessionId })
        if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native MCP session changed while reading status')
        return ClaudeMcpStatusSchema.parse(result)
      },
      async getModels(options) {
        if (closed) throw new Error('Native terminal closed')
        return ClaudeModelCatalogSchema.parse(await bridge.uiTransport.request({ subtype: 'apack_list_models', include_unsupported_models: options?.includeUnsupportedModels === true }))
      },
      async renameSession(title) {
        if (closed) throw new Error('Native terminal closed')
        const sessionId = bridge.projection.sessionId
        const result = await bridge.uiTransport.request({ subtype: 'apack_rename_session', title, session_id: sessionId }) as { title?: unknown; message?: unknown }
        if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native session changed while renaming')
        if (typeof result.title !== 'string' || !result.title || typeof result.message !== 'string') throw new Error('Native rename was not acknowledged')
        return { title: result.title, message: result.message }
      },
      async setModel(model) {
        if (closed || changingModel || changingPermission || preparingParent || bridge.busy || bridge.projection.tasks.some(task => !['completed', 'failed', 'killed'].includes(task.status))) throw new Error('Wait for the native conversation to become idle before changing model')
        changingModel = true; changed()
        const sessionId = bridge.projection.sessionId
        try {
          const result = await bridge.uiTransport.request({ subtype: 'apack_set_model', model }) as { selection?: unknown }
          if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native session changed while changing model')
          if (typeof result?.selection !== 'string' || !result.selection) throw new Error('Native model selection was not acknowledged')
          modelSelection = result.selection
          // Carry the acknowledged original selection until the next authoritative native snapshot.
          if (bridge.session.metadata) bridge.session.update({ ...bridge.session.metadata, modelSelection })
          return modelSelection
        } finally { changingModel = false; changed() }
      },
      async setPermissionMode(mode) {
        if (closed) throw new Error('Native terminal closed')
        if (changingPermission || preparingParent) throw new Error('Native permission mode or parent input is changing')
        const sessionId = bridge.projection.sessionId
        changingPermission = true; changed()
        try {
          const result = await bridge.uiTransport.request({ subtype: 'apack_set_permission_mode', mode })
          if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native session changed while changing permission mode')
          const accepted = PermissionModeSchema.parse((result as { mode?: unknown })?.mode)
          const metadata = bridge.session.metadata
          if (metadata) bridge.session.update({ ...metadata, permissionMode: accepted, prePlanMode: PermissionModeSchema.optional().parse((result as { prePlanMode?: unknown })?.prePlanMode) })
          return accepted
        } finally { changingPermission = false; changed() }
      },
      async submit(text, images, phase) {
        if (changingModel || changingPermission || changingView || preparingParent) throw new Error('Native input is changing; your draft was retained')
        const sessionId = bridge.projection.sessionId; preparingParent = true; changed()
        try {
          if (!planRestorationChecked && options.permissionMode === 'plan' && options.prePlanMode) {
            const snapshot = await bridge.uiTransport.request({ subtype: 'apack_owner_snapshot', policy_only: true }) as { sessionId?: unknown }
            if (closed || sessionId !== bridge.projection.sessionId || snapshot?.sessionId !== sessionId) throw new Error('Native input session changed during Plan restoration')
            planRestorationChecked = true
          }
          const state = await bridge.uiTransport.request({ subtype: 'apack_parent_prompt_state' })
          if (closed || sessionId !== bridge.projection.sessionId) throw new Error('Native input session changed')
          if (!state || typeof state !== 'object' || !('main' in state) || state.main !== true) throw new Error('Return to the native main view before submitting a parent prompt')
          if (phase !== undefined) {
            const result = await bridge.uiTransport.request({ subtype: 'apack_set_composer_phase', phase })
            if (closed || sessionId !== bridge.projection.sessionId) throw new Error('Native input session changed while applying phase')
            const accepted = PermissionModeSchema.parse((result as { mode?: unknown })?.mode)
            if ((phase === 'Plan') !== (accepted === 'plan')) throw new Error('Native composer phase was not acknowledged')
            const metadata = bridge.session.metadata
            if (metadata) bridge.session.update({ ...metadata, permissionMode: accepted, prePlanMode: PermissionModeSchema.optional().parse((result as { prePlanMode?: unknown })?.prePlanMode) })
          }
          return await bridge.submit(text, images)
        } finally { preparingParent = false; changed() }
      },
      kill,
      async close() { if (!closed) kill(); await done },
    }
  }
  return { start, async dispose() { if (started && terminal) { kill(); await done } else if (!closed) { closed = true; await bridge.close(); resolveDone() } } }
}
