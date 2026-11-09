import { resolveAppEnvironment } from '@apackdev/sdk/env'
import type { TerminalSession } from '@apackdev/sdk/services'
import { services } from '#generated/services.ts'
import { createClaudeBackgroundStatusAuthority } from './background-status-authority.ts'
import type { ClaudeBackgroundSession } from '../../../common/native-background.ts'
import { backgroundSession } from './background-sessions.ts'
import { ClaudeNativeMessageRetirementsSchema, type ClaudeNativeMessageRetirements } from '../../../common/native-notice.ts'
import { copyClaudeChannelSelection } from '../../../common/native-channels.ts'
import { ClaudeNativeMcpUrlSchema, ClaudeNativeMcpUrlOperationSchema, type ClaudeNativeMcpUrl, type ClaudeNativeMcpUrlRequest } from '../../../common/native-mcp-url.ts'
import { ClaudeNativeMcpFormSchema, ClaudeNativeMcpFormOperationSchema, type ClaudeNativeMcpFormRequest } from '../../../common/native-mcp-form.ts'
import { ClaudeNativeGenericToolPermissionDialogsSchema, type ClaudeNativeGenericToolPermissionDialog, type ClaudeNativeGenericToolPermissionDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeToolPermissionDialogsSchema, type ClaudeNativeToolPermissionDialog, type ClaudeNativeToolPermissionDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeNoticeSchema, type ClaudeNativeNotice, type ClaudeNativeNoticeResponse } from '../../../common/native-notice.ts'
import { ClaudeNativeWorkflowDialogsSchema, type ClaudeNativeWorkflowDialog, type ClaudeNativeWorkflowDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeTaskResultSchema } from './terminal-tasks.ts'
import { ClaudeNativePlanDialogsSchema, type ClaudeNativePlanDialog, type ClaudeNativePlanDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeBashDialogsSchema, type ClaudeNativeBashDialog, type ClaudeNativeBashDialogResponse } from './terminal-dialogs.ts'
import { ClaudeNativeQuestionRenderSchema, type ClaudeNativeQuestionRender, type ClaudeNativeQuestionRenderRequest, type ClaudeNativeQuestionHoldRequest, ClaudeNativeQuestionDialogsSchema, type ClaudeNativeQuestionDialog, type ClaudeNativeQuestionDialogResponse, ClaudeNativeFileDialogsSchema, type ClaudeNativeFileDialog, type ClaudeNativeFileDialogResponse } from './terminal-dialogs.ts'
import { PermissionModeSchema } from './types.ts'
import { createClaudeNativeJournalReader, type ClaudeNativeJournalBatch } from './terminal-journal.ts'
import { parseClaudeNativeContinuation, type ClaudeNativeContinuation } from './terminal-session.ts'
import type { ClaudeNativeTerminalRecord, ClaudeNativeSubmissionReceipt, ClaudeNativeImage } from './terminal-session.ts'
import { stat } from 'node:fs/promises'
import { resolveClaudeExecutable } from './native-executable.ts'
import { createClaudeTerminalImageFileTransport } from './terminal-image-file-transport.ts'
import { createClaudeTerminalImageCache } from './terminal-image-cache.ts'
import { createClaudeTerminalGraphicsQueryResponder } from './terminal-graphics-query.ts'
import { createClaudeLifecycleTrace } from './lifecycle-trace.ts'
import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { resolveForService } from '../../utils/resolve-cli.ts'
import { buildChildEnv, DENIED_TO_A_CHILD } from './runner.ts'
import { createClaudeTerminalBridge } from './terminal-bridge.ts'
import type { PermissionMode } from './types.ts'
import { ClaudeMcpStatusSchema, type ClaudeMcpStatus, ClaudeModelCatalogSchema, type ClaudeModelCatalog, type ClaudeSettings } from './host-controls.ts'
import type { ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'

export interface ClaudeNativeTerminalOwner {
  readonly backgroundObserver?: import('./background-status-observer.ts').ClaudeBackgroundStatusObserver
  readonly backgroundInfo?: import('../../../common/native-background.ts').ClaudeBackgroundStatus
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
  readonly canReplyBackground: boolean
  replyBackground(jobId: string, pid: number, text: string): Promise<ClaudeBackgroundSession>
  refreshMcpInput(): Promise<void>
  operateMcpForm(request: ClaudeNativeMcpFormRequest): Promise<void>
  operateMcpUrl(request: ClaudeNativeMcpUrlRequest): Promise<void>
  cancelMcpInput(expected: Pick<import('../../../common/native-mcp-form.ts').ClaudeNativeMcpForm, 'id' | 'revision' | 'sessionId'>): Promise<void>
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
  getGenericToolPermissionDialogs(): Promise<ClaudeNativeGenericToolPermissionDialog[]>
  answerGenericToolPermissionDialog(response: ClaudeNativeGenericToolPermissionDialogResponse): Promise<void>
  getToolPermissionDialogs(): Promise<ClaudeNativeToolPermissionDialog[]>
  answerToolPermissionDialog(response: ClaudeNativeToolPermissionDialogResponse): Promise<void>
  getFileDialogs(): Promise<ClaudeNativeFileDialog[]>
  answerFileDialog(response: ClaudeNativeFileDialogResponse): Promise<void>
  operateTask(taskId: string, operation: 'inspect' | 'stop' | 'send' | 'input' | 'foreground' | 'background' | 'skip_worker' | 'retry_worker' | 'pause_workflow' | 'resume_workflow', text?: string, worker?: import('../../../common/native-terminal.ts').ClaudeNativeWorkflowWorkerTarget): Promise<{ paused?: boolean; resume?: { taskId: string; runId: string; requested: true }; worker?: import('../../../common/native-terminal.ts').ClaudeNativeWorkflowWorkerReceipt; view?: { taskId: string | null }; sent?: boolean; input?: import('../../../common/native-terminal.ts').ClaudeNativeTaskInputReceipt; stopped?: boolean; details?: import('../../../common/native-terminal.ts').ClaudeNativeTaskDetails }>
  getMcpStatus(): Promise<ClaudeMcpStatus>
  controlMcpServer(serverName: string, operation: 'reconnect' | 'enable' | 'disable'): Promise<ClaudeMcpStatus>
  getModels(options?: { includeUnsupportedModels?: boolean }): Promise<ClaudeModelCatalog>
  renameSession(title: string): Promise<{ title: string; message: string }>
  setModel(model: string): Promise<{ selection: string; notice: string }>
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
  channels?: string[]
  signal?: AbortSignal
}

/** One native terminal process; no print sidecar and no independent status-command scheduler. */
export async function prepareClaudeNativeTerminal(options: ClaudeNativeTerminalOptions, backgroundObserver?: import('./background-status-observer.ts').ClaudeBackgroundStatusObserver): Promise<ClaudePreparedNativeTerminal> {
  // **Three POSIX dependencies, named so the next reader knows what Windows needs rather than that it is
  // unsupported.** The pty is the broker's and portable; these are not: `session.signal` below, which the
  // terminal service refuses off POSIX because Windows has no signals; the bridge's unix sockets, which
  // need a named-pipe form on both ends, this app's server and the CLI's `$.http.fetch`; and the plugin's
  // one `$PPID` call, which stands in for an accessor the CLI does not offer (`native-plugin/program.ts`).
  if (process.platform === 'win32') throw new Error('Native terminal needs POSIX signals, unix sockets and a pid helper that Windows has no form of')
  if (!/^[a-f0-9-]{36}$/i.test(options.sessionId)) throw new Error('Native terminal needs an existing session identity')
  const env = buildChildEnv(options.env)
  const executable = await resolveClaudeExecutable(options.cliPath ?? await resolveForService('claude-code'), options.cwd, env.PATH)
  if (options.signal?.aborted) throw new Error('Native terminal startup was cancelled')
  if (!(await stat(options.cwd)).isDirectory()) throw new Error('Native terminal working directory is unavailable')
  const terminalEnv: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') terminalEnv[name] = value
  // Advertise app rendering capabilities only when the caller has not chosen an override.
  if (!terminalEnv.NO_COLOR) terminalEnv.FORCE_COLOR ??= '3'
  terminalEnv.FORCE_HYPERLINK ??= '1'
  // Native automatic detection only admits kitty/ghostty. Our Unicode-placeholder
  // consumer uses Claude's explicit custom-terminal opt-in; never spoof that identity.
  terminalEnv.CLAUDE_CODE_FORCE_TERMINAL_IMAGES ??= '1'
  const readJournal = createClaudeNativeJournalReader()
  const trace = createClaudeLifecycleTrace('terminal')
  const ownerId = randomUUID(), listeners = new Set<() => void>()
  const output: { sequence: number; text: string }[] = []
  let sequence = 0, outputSize = 0, terminal: TerminalSession | undefined, closed = false
  let status: ClaudeNativeTerminalState['status'] = 'starting'
  let handoffPending = false
  let continuation: ClaudeNativeContinuation | undefined
  let exitCode: number | undefined, stopping = false, changingModel = false, changingPermission = false
  let modelSelection = options.model
  const exitObservers: (() => Promise<void>)[] = []
  let releasing = false
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })
  const changed = () => { for (const listener of listeners) { try { listener() } catch { /* isolate views */ } } }
  const bridge = await createClaudeTerminalBridge({ sessionId: options.sessionId, backgroundProfile:resolveAppEnvironment().userDataDir, backgroundChildUiLaunch:{configDir:env.CLAUDE_CONFIG_DIR,secureStorageConfigDir:env.CLAUDE_SECURESTORAGE_CONFIG_DIR,executable,cwd:options.cwd,searchPath:env.PATH}, backgroundObserver, backgroundAuthority: parentSessionId => createClaudeBackgroundStatusAuthority(parentSessionId, {cwd: options.cwd, cliPath: executable, env}), backgroundTarget: () => continuation ? {parentSessionId: continuation.sessionId, sessionId: continuation.continuedInSessionId, cwd: options.cwd} : undefined, ...(options.permissionMode === 'plan' && options.prePlanMode ? {restorePlan: {sessionId: options.sessionId, mode: options.prePlanMode}} : {}), settings: options.settings, bunOptions: env.BUN_OPTIONS, ownsProcess: async pid => (terminal ? terminal.owns(pid).catch(() => false) : false),
    // The plugin's undelivered notifications land in this session's trace, which is what reads them
    notificationsDropped: (route, count) => trace('notifications_dropped', {route, count}), changed,
    pasteImage(path) { if (closed || !terminal) throw new Error('Native terminal closed'); bestEffort(terminal.write('\x1b[200~' + path + '\x1b[201~')) },
    enter() { if (closed || !terminal) throw new Error('Native terminal closed'); bestEffort(terminal.write('\r')) } })
  const imageCache = createClaudeTerminalImageCache()
  const imageListeners = new Set<(event: Record<string, unknown>) => void>()
  const graphicsQuery = createClaudeTerminalGraphicsQueryResponder(text => { if (!closed && terminal) bestEffort(terminal.write(text)) })
  const imageTransport = createClaudeTerminalImageFileTransport({
    reply(text) { if (!closed && terminal) bestEffort(terminal.write(text)) },
    image(value) {
      imageCache.put(value)
      for (const listener of imageListeners) { try { listener({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render', client_snapshot: true }) } catch { /* isolate mounted views */ } }
    },
    remove(id) { imageCache.remove(id) },
    emit(text) {
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
    },
  })
  const uiTransport: ClaudeNativeTerminalOwner['uiTransport'] = {
    get promptHosts() { return bridge.uiTransport.promptHosts },
    async request(value) {
      const result = await bridge.uiTransport.request(value)
      if (value.subtype !== 'ui_render' && value.subtype !== 'apack_render_question_dialog') return result
      await imageTransport.drain()
      if (closed) throw new Error('Native image owner closed before rendering')
      return imageCache.project(result)
    },
    subscribe(listener) {
      imageListeners.add(listener)
      const detach = bridge.uiTransport.subscribe(listener)
      return () => { imageListeners.delete(listener); detach() }
    },
  }
  /**
   * A write, resize or pause that cannot be delivered is not this call's to report.
   *
   * **Every one of these is a promise, and an unhandled rejection ends the process** — Node's default since
   * 15. They were synchronous while the pty was this process's, so a failure reached whoever typed; the
   * session is a socket away, and the honest report of one nobody can reach is its own exit, which arrives
   * on `onExit` and closes this owner. So they are best effort by construction rather than by neglect.
   */
  const bestEffort = (sent: Promise<unknown>): void => { void sent.catch(() => {}) }
  let outputFailed = false, pendingOutput = 0
  let hardStop: ReturnType<typeof setTimeout> | undefined
  async function finish(code: number | null, signal?: string) {
    if (closed) return
    imageTransport.close(); imageCache.close(); imageListeners.clear()
    // `code` is absent when a signal ended it, which this trace takes only integers for; `outcome` is what
    // carries that case, and the signal itself reaches the window on the session's own exit
    trace('exit', {outcome:outputFailed ? 'error' : stopping ? 'cancelled' : code === 0 ? 'ok' : 'error',code: code ?? undefined});
    closed = true; clearTimeout(hardStop); status = outputFailed ? 'error' : stopping || code === 0 && !signal ? 'exited' : 'error'; exitCode = code ?? undefined
    try { await bridge.close() } finally {
      releasing = true
      try { for (const observer of exitObservers) await observer() } finally { changed(); resolveDone() }
    }
  }
  function kill() {
    if (closed || stopping || !terminal) return
    trace('cancel_requested')
    stopping = true
    imageTransport.close()
    // **The session is what the guards compare, not its pid.** A replaced session is a different handle, and
    // the broker answers no pid for one it took up again rather than started
    const session = terminal, nativePid = bridge.nativePid
    const stopGroup = () => {
      if (closed || terminal !== session) return
      // The group and then the process the broker started: neither pid is this process's to find, and the
      // broker refuses anything outside the session's own tree
      bestEffort(session.signal('SIGTERM', { kind: 'group' }))
      bestEffort(session.signal('SIGTERM', { kind: 'leader' }))
    }
    // **The CLI alone first, so the servers it owns outlive its own shutdown handlers**, where the group
    // would take them with it. The pid is the bridge's claim about which process the CLI is, and the broker
    // is what checks it belongs to this session — a pid outside the tree is refused there rather than
    // walked for here.
    //
    // **A refusal cannot steer this, and that is why there is no branch on one.** A signal is carried out or
    // refused like a write, with no answer on success, so the app does not learn that a pid was rejected.
    // What covers it is the escalation below, which was always the backstop for a CLI that does not go:
    // the cost of the bridge naming a pid the broker does not own is that the group waits for it.
    if (nativePid && nativePid !== process.pid) {
      bestEffort(session.signal('SIGTERM', { kind: 'pid', pid: nativePid }))
    } else stopGroup()
    if (!hardStop && !closed) {
      hardStop = setTimeout(() => {
        if (closed || terminal !== session) return
        bestEffort(session.signal('SIGKILL', { kind: 'group' }))
        bestEffort(session.signal('SIGKILL', { kind: 'leader' }))
      }, 2000)
      hardStop.unref()
    }
  }

  let started = false
  async function start(): Promise<ClaudeNativeTerminalOwner> {
    trace('launch')
    if (started || closed) throw new Error('Native terminal startup is no longer available')
    started = true
    const launchedAt = Date.now()
    try {
      const args = ['--resume', options.sessionId, '--permission-mode', options.permissionMode, '--plugin-dir', bridge.pluginRoot]
      terminalEnv.BUN_OPTIONS = bridge.bunOptions
      for (const directory of options.pluginDir ?? []) args.push('--plugin-dir', directory)
      if (options.channels?.length) args.push('--channels', ...copyClaudeChannelSelection(options.channels))
      if (options.model) args.push('--model', options.model)
      if (options.allowedTools?.length) args.push('--allowed-tools', ...options.allowedTools)
      if (options.disallowedTools?.length) args.push('--disallowed-tools', ...options.disallowedTools)
      if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)
      for (const directory of options.addDir ?? []) args.push('--add-dir', directory)
      if (options.signal?.aborted) throw new Error('Native terminal startup was cancelled')
      // **The listeners arrive with the open**, which the contract requires: there is no window in which
      // output has nowhere to go. `TERM` is the broker's to set, so it is not named here
      terminal = await services.terminal.open(
        {
          cols: options.columns ?? 100,
          rows: options.rows ?? 30,
          shell: executable,
          args,
          env: terminalEnv,
          // **A session inherits the host's environment, so `env` cannot say what must be absent.** The CLI
          // authenticates as whoever the user signed in as, and a key the app happens to carry — the API
          // auto-loads `packages/api/.env` — would make it authenticate as the app instead
          unset: DENIED_TO_A_CHILD,
          cwd: options.cwd,
        },
        {
          onOutput: text => {
            if (closed || stopping) return
            // **The session stops being read while the transport drains**, which is what a pause is for: the
            // bytes wait in the pty's buffer and the CLI blocks on its own write, rather than piling up here
            pendingOutput++; if (terminal) bestEffort(terminal.pause())
            void imageTransport.write(text).catch(() => { outputFailed = true; kill() }).finally(() => {
              pendingOutput--
              if (!closed && !stopping && pendingOutput === 0 && terminal) bestEffort(terminal.resume())
            })
          },
          onExit: (code, signal) => {
            options.signal?.removeEventListener('abort', kill)
            void finish(code, signal ?? undefined).catch(() => {})
          },
        },
      )
      trace('ready', {pid:terminal.pid ?? undefined})
      options.signal?.addEventListener('abort', kill, { once: true })
      if (options.signal?.aborted) kill()
      status = 'starting'
    } catch (error) { await bridge.close(); closed = true; resolveDone(); throw error }
    let mcpForm: import('../../../common/native-mcp-form.ts').ClaudeNativeMcpForm | undefined
    let mcpUrl: ClaudeNativeMcpUrl | undefined
    let operatingMcpForm = false, mcpFormEpoch = 0, cancellingMcpForm = false
    let mcpFormIdle = Promise.resolve()
    let notice: ClaudeNativeNotice | undefined
    let messageRetirements: ClaudeNativeMessageRetirements | undefined
    let changingView = false, preparingParent = false, planRestorationChecked = false
    async function applyMcpInput(request: ClaudeNativeMcpFormRequest | ClaudeNativeMcpUrlRequest, kind: 'form' | 'url', retiring = false) {
      const shown = kind === 'form' ? mcpForm : mcpUrl
      if (closed || operatingMcpForm || (cancellingMcpForm && !retiring) || !shown || request.sessionId !== bridge.projection.sessionId || request.id !== shown.id || request.revision !== shown.revision || request.token !== shown.token) throw new Error('Native MCP input changed or is busy')
      const action = (kind === 'form' ? ClaudeNativeMcpFormOperationSchema : ClaudeNativeMcpUrlOperationSchema).parse(request.action)
      operatingMcpForm = true; mcpFormEpoch++
      let finish!: () => void
      mcpFormIdle = new Promise<void>(resolve => { finish = resolve })
      try {
        const result = await bridge.uiTransport.request({ subtype: kind === 'form' ? 'apack_operate_mcp_form' : 'apack_operate_mcp_url', id: request.id, revision: request.revision, session_id: request.sessionId, token: request.token, action }) as { form?: unknown; url?: unknown; settled?: unknown }
        if (closed) throw new Error('Native MCP input owner exited')
        if (typeof result.settled !== 'boolean') throw new Error('Native MCP input action was not acknowledged')
        const raw = kind === 'form' ? result.form : result.url
        const next = raw == null ? undefined : kind === 'form' ? ClaudeNativeMcpFormSchema.parse(raw) : ClaudeNativeMcpUrlSchema.parse(raw)
        if (result.settled ? next !== undefined : !next || next.id !== request.id || next.revision !== request.revision || next.sessionId !== request.sessionId) throw new Error('Native MCP input action returned a different request')
        if (next && next.sessionId !== bridge.projection.sessionId) throw new Error('Native MCP input session changed')
        if (kind === 'form') mcpForm = next as typeof mcpForm
        else mcpUrl = next as typeof mcpUrl
        changed()
      } finally { operatingMcpForm = false; finish() }
    }
    let backgroundState: ClaudeNativeTerminalState | undefined
    const currentState = (): ClaudeNativeTerminalState => ({ handoffPending: !closed && handoffPending, messageRetirements, mcpForm: closed ? undefined : mcpForm, mcpUrl: closed ? undefined : mcpUrl, notice: closed ? undefined : notice, preview: closed ? undefined : bridge.preview, view: bridge.view, ownerId, sessionId: bridge.projection.sessionId, continuation: continuation?.sessionId === bridge.projection.sessionId ? continuation : undefined, cwd: options.cwd, status: status === 'starting' && bridge.ready ? 'live' : status, pid: terminal?.pid ?? undefined, nativePid: bridge.nativePid, exitCode, busy: bridge.busy || changingModel || changingPermission || changingView || preparingParent, activity: bridge.activity, focus: bridge.focus, lastTurn: bridge.lastTurn, session: bridge.session.metadata, mainStatus: bridge.projection.mainStatus, billing: closed ? undefined : bridge.billing, problem: bridge.problem, tasks: bridge.projection.tasks })
    const readState = (): ClaudeNativeTerminalState => backgroundState
      ? { ...backgroundState, status: closed ? status : backgroundState.status, exitCode }
      : currentState()
    return {
      get state() { return readState() },
      get backgroundObserver() { return bridge.backgroundObserver },
      get backgroundInfo() { return closed ? undefined : bridge.backgroundInfo },
      get canReplyBackground() { return !closed && !!backgroundState?.continuation },
      async replyBackground(jobId, pid, text) {
        const continuation = backgroundState?.continuation
        if (closed || !continuation || typeof text !== 'string' || !text.trim() || text.length > 32768) throw new Error('Background reply owner is unavailable')
        const current = await backgroundSession(continuation, {operation:'refresh'}, {cwd:options.cwd,env:options.env,cliPath:options.cliPath,timeoutMs:10000})
        if (closed || backgroundState?.continuation !== continuation || !current || current.id !== jobId || current.pid !== pid || !['working','blocked'].includes(current.state)) throw new Error('Background session changed; refresh before sending')
        const result = await bridge.uiTransport.request({subtype:'apack_background_reply',parent_session_id:continuation.sessionId,child_session_id:continuation.continuedInSessionId,job_id:jobId,pid,cwd:current.cwd,text}) as {queued?:unknown}
        if (result.queued !== true) throw new Error('Native background reply was not acknowledged')
        return current
      },
      get modelSelection() { return backgroundState ? backgroundState.session?.modelSelection ?? modelSelection : bridge.session.metadata?.modelSelection ?? modelSelection },
      get busy() { return !closed && !backgroundState && (changingModel || changingPermission || preparingParent || bridge.busy || bridge.projection.tasks.some(task => !['completed', 'failed', 'killed'].includes(task.status))) },
      get output() { return output },
      get records() { return bridge.session.records },
      uiTransport,
      async refreshMcpInput() {
        if (closed || continuation || !bridge.ready || operatingMcpForm) return
        const epoch = mcpFormEpoch
        try {
          const result = await bridge.uiTransport.request({ subtype: 'apack_mcp_input' }) as { form?: unknown; url?: unknown }
          if (closed || operatingMcpForm || epoch !== mcpFormEpoch) return
          const next = result.form == null ? undefined : ClaudeNativeMcpFormSchema.parse(result.form)
          if (next && next.sessionId !== bridge.projection.sessionId) throw new Error('Native MCP input session changed')
          const url = result.url == null ? undefined : ClaudeNativeMcpUrlSchema.parse(result.url)
          if (url && (url.sessionId !== bridge.projection.sessionId || next)) throw new Error('Native MCP URL session changed or input is ambiguous')
          if (JSON.stringify([next, url]) !== JSON.stringify([mcpForm, mcpUrl])) { mcpForm = next; mcpUrl = url; changed() }
        } catch (error) {
          if (!closed && epoch === mcpFormEpoch && !operatingMcpForm && (mcpForm || mcpUrl)) { mcpForm = undefined; mcpUrl = undefined; changed() }
          throw error
        }
      },
      operateMcpForm(request) { return applyMcpInput(request, 'form') },
      operateMcpUrl(request) { return applyMcpInput(request, 'url') },
      async cancelMcpInput(expected) {
        if (cancellingMcpForm) throw new Error('Native MCP input retirement is already pending')
        cancellingMcpForm = true; mcpFormEpoch++
        try {
          await mcpFormIdle
          if (closed) return
          await this.refreshMcpInput()
          const form = mcpForm ?? mcpUrl
          if (!form || form.id !== expected.id || form.revision !== expected.revision || form.sessionId !== expected.sessionId) return
          await applyMcpInput({ id: form.id, revision: form.revision, sessionId: form.sessionId, token: form.token, action: { operation: 'cancel' } }, mcpForm ? 'form' : 'url', true)
        } finally { cancellingMcpForm = false }
      },
      async refreshNotice() {
        if (closed || continuation || !bridge.ready && !bridge.nativePid) return
        const sessionId = bridge.projection.sessionId
        const result = await bridge.uiTransport.request({ subtype: 'apack_native_notice' }) as { notice?: unknown; retirements?: unknown; handoffPending?: unknown }
        if (closed || sessionId !== bridge.projection.sessionId) return
        if (typeof result.handoffPending !== 'boolean') throw new Error('Native agents progress was not observed')
        if (handoffPending !== result.handoffPending) { handoffPending = result.handoffPending; changed() }
        const retired = ClaudeNativeMessageRetirementsSchema.parse(result.retirements)
        if (retired.some(item => item.sessionId !== sessionId && !bridge.transcripts.some(transcript => transcript.sessionId === item.sessionId))) throw new Error('Native retirement session is not owned')
        if (JSON.stringify(retired) !== JSON.stringify(messageRetirements)) { messageRetirements = retired; changed() }
        const next = result.notice == null ? undefined : ClaudeNativeNoticeSchema.parse(result.notice)
        if (next && next.sessionId !== sessionId) throw new Error('Native notice session changed')
        if (JSON.stringify(next) !== JSON.stringify(notice)) { notice = next; changed() }
      },
      async answerNotice(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native notice session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_native_notice', id: response.id, revision: response.revision, session_id: response.sessionId, decision: response.decision }) as { answered?: unknown; handoffPending?: unknown }
        if (result.answered !== true) throw new Error('Native notice was not acknowledged')
        if (response.decision === 'background_confirm' || response.decision === 'background_stay') {
          if (typeof result.handoffPending !== 'boolean') throw new Error('Native agents progress was not acknowledged')
          handoffPending = result.handoffPending; changed()
        }
        if (response.decision === 'compact_previous' || response.decision === 'compact_next') { await this.refreshNotice(); return }
        if (notice?.id === response.id && notice.revision === response.revision) { notice = undefined; changed() }
      },
      async readJournal() {
        const batch = await readJournal(bridge.transcripts, { final: closed })
        for (const entry of batch.entries) {
          const nextContinuation = parseClaudeNativeContinuation(entry.row, bridge.projection.sessionId)
          // Replayed history describes an earlier owner; only a handoff from this launch retires this one.
          if (nextContinuation && !continuation && Date.parse(nextContinuation.timestamp) >= launchedAt) {
            continuation = nextContinuation
            // The native agents screen owns later runtime state; this owner retains the
            // completed parent's identity and history until a separate attachment is chosen.
            backgroundState = { ...currentState(), sessionId: continuation.sessionId, continuation,
              handoffPending: false, busy: false, activity: undefined, tasks: [], view: undefined,
              mcpForm: undefined, mcpUrl: undefined, notice: undefined, preview: undefined, billing: undefined, mainStatus: undefined }
            mcpForm = undefined; mcpUrl = undefined; notice = undefined; mcpFormEpoch++
            changed()
          }
          if (backgroundState && entry.sessionId === backgroundState.sessionId && backgroundState.session
            && entry.row.type === 'cost-state' && typeof entry.row.totalCostUSD === 'number' && Number.isFinite(entry.row.totalCostUSD) && entry.row.totalCostUSD >= 0) {
            backgroundState = { ...backgroundState, session: { ...backgroundState.session, totalCostUsd: Math.max(backgroundState.session.totalCostUsd ?? 0, entry.row.totalCostUSD) } }
          }
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
        const parentSessionId = backgroundState?.sessionId
        return parentSessionId ? { ...batch, entries: batch.entries.filter(entry => entry.sessionId === parentSessionId) } : batch
      }, done,
      beforeRelease(listener) {
        if (releasing) throw new Error('Native terminal has already started releasing its owner')
        exitObservers.push(listener)
      },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      input(id, text) { if (closed || (changingView || preparingParent) && text !== '\x03' || id !== ownerId || typeof text !== 'string' || text.length > 32768) return false; bestEffort(terminal!.write(text)); return true },
      resize(id, columns, rows) {
        if (closed || id !== ownerId || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || columns > 500 || rows < 2 || rows > 200) return false
        bestEffort(terminal!.resize(columns, rows)); return true
      },
      async holdQuestionDialog(request) {
        if (closed || request.sessionId !== bridge.projection.sessionId) throw new Error('Native question session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_hold_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, render_token: request.renderToken }) as { held?: unknown }
        if (result.held !== true) throw new Error('Native question draft was not acknowledged')
      },
      async renderQuestionDialog(request) {
        if (closed || request.sessionId !== bridge.projection.sessionId) throw new Error('Native question session expired')
        const result = await uiTransport.request({ subtype: 'apack_render_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, viewport: request.viewport })
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
      async getGenericToolPermissionDialogs() {
        if (closed || !bridge.ready) return []
        const result = await bridge.uiTransport.request({ subtype: 'apack_generic_tool_permission_dialogs' }) as { dialogs?: unknown }
        return closed ? [] : ClaudeNativeGenericToolPermissionDialogsSchema.parse(result.dialogs)
      },
      async answerGenericToolPermissionDialog(response) {
        if (closed || response.sessionId !== bridge.projection.sessionId) throw new Error('Native generic permission session expired')
        const result = await bridge.uiTransport.request({ subtype: 'apack_answer_generic_tool_permission_dialog', decision: response.decision, id: response.id, revision: response.revision, session_id: response.sessionId, toolName: response.toolName, choice: response.choice, choiceToken: response.choiceToken, feedback: response.feedback }) as { answered?: unknown }
        if (result.answered !== true) throw new Error('Native generic permission was not acknowledged')
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
          const result = await bridge.uiTransport.request({ subtype: 'apack_set_model', model }) as { selection?: unknown; notice?: unknown }
          if (closed || bridge.projection.sessionId !== sessionId) throw new Error('Native session changed while changing model')
          if (typeof result?.selection !== 'string' || !result.selection) throw new Error('Native model selection was not acknowledged')
          if (typeof result.notice !== 'string') throw new Error('Native model notice was not acknowledged')
          modelSelection = result.selection
          // Carry the acknowledged original selection until the next authoritative native snapshot.
          if (bridge.session.metadata) bridge.session.update({ ...bridge.session.metadata, modelSelection })
          // Native notices explain session-only changes, fast mode and defaults applied on restart.
          return { selection: modelSelection, notice: stripVTControlCharacters(result.notice) }
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
        if (handoffPending || continuation?.sessionId === bridge.projection.sessionId) throw new Error('This conversation is moving to the background; your draft was retained')
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
