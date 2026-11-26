import {createClaudeNativeEditorBridge} from './native-editor-bridge.ts'
import {CLAUDE_NATIVE_EDITOR_MESSAGE_MAX_BYTES, CLAUDE_NATIVE_EDITOR_MAX_BYTES} from '../../../common/native-editor.ts'
import type { createClaudeBackgroundStatusAuthority } from './background-status-authority.ts'
import { ClaudeBackgroundControlSchema } from './background-controls.ts'
import { z } from 'zod'
import { CLAUDE_UI_TEXT_LIMIT_MESSAGE, CLAUDE_UI_TEXT_MAX_LENGTH, CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES } from './ui-text-limits.ts'
import { createClaudeTerminalPlugin } from './terminal-plugin.ts'
import { NATIVE_NOTIFICATION_ROUTES, type NativeNotificationRoute } from './native-plugin/program.ts'
import { createClaudeBackgroundStatusObserver, type ClaudeBackgroundStatusObserver } from './background-status-observer.ts'
import { createClaudeBillingState } from '../../../common/native-billing.ts'
import { readClaudeUiActionKeys } from './ui-controls.ts'
import { ClaudeQuestionCountdownEventSchema } from '../../../common/native-question.ts'
import { readClaudePromptPalette } from '../../../common/native-prompt-theme.ts'
import { createClaudeTerminalUiTransport } from './terminal-ui.ts'
import { claudeTerminalUiRuntime } from './terminal-ui-runtime.ts'
import { CLAUDE_BUSY_DRAFT_MESSAGE, type ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'
import { basename, isAbsolute } from 'node:path'
import type { ClaudeNativeTranscript } from './terminal-journal.ts'
import { createClaudeTerminalSession, parseClaudeTerminalMetadata, type ClaudeNativeSubmissionReceipt, type ClaudeNativeImage } from './terminal-session.ts'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeTerminalStatus } from './terminal-status.ts'
import { claudeTerminalStatusRuntime } from './terminal-status-runtime.ts'
import type { ClaudeSettings } from './host-controls.ts'
import { PermissionModeSchema } from './types.ts'

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const command = (value: unknown): string | undefined => { const entry = object(value); return entry?.type === 'command' && typeof entry.command === 'string' && entry.command ? entry.command : undefined }

/** Native plugin and native-invoked command helpers share one private, session-scoped broker. */
export async function createClaudeTerminalBridge(options: {
  sessionId: string
  backgroundTarget?(): { parentSessionId: string; sessionId: string; cwd: string } | undefined
  backgroundProfile?: string
  backgroundChildUiLaunch?: {configDir?: string; secureStorageConfigDir?: string; executable: string; cwd: string; searchPath: string | undefined}
  backgroundObserver?: ClaudeBackgroundStatusObserver
  backgroundAuthority(parentSessionId: string): ReturnType<typeof createClaudeBackgroundStatusAuthority>
  restorePlan?: { sessionId: string; mode: import('./types.ts').PermissionMode }
  settings: ClaudeSettings
  bunOptions?: string
  ownsProcess?(pid: number): Promise<boolean>
  /**
   * A notification the plugin could not deliver, by route and how many.
   *
   * The plugin counts them rather than swallowing them, and this is the end that reads the count — without
   * a reader it would be the error channel nobody looks at that this integration has already paid for.
   * Each route is healed by something the app does anyway (`NATIVE_NOTIFICATION_ROUTES` says which), so the
   * count is what the session's lifecycle records, not a failure it raises.
   */
  notificationsDropped?(route: NativeNotificationRoute, count: number): void
  changed(): void
  pasteImage?(path: string): void
  enter(): void
}) {
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'cc-app-'))
  const uiSocketPath = join(directory, 'ui.sock')
  const socketPath = join(directory, 'bridge.sock'), token = randomBytes(32).toString('hex')
  const projection = createClaudeTerminalStatus(options.sessionId)
  const session = createClaudeTerminalSession(options.sessionId)
  const billing = createClaudeBillingState(); billing.reset(options.sessionId)
  let billingSequence = 0
  const transcripts: ClaudeNativeTranscript[] = []
  let nativeViewSequence = 0
  let nativeViewRecord: string | undefined
  let nativeView: import('../../../common/native-terminal.ts').ClaudeNativeTerminalView | undefined
  let observerPid: number | undefined, observerProblem: string | undefined
  const helperCommands = {
    main: command(options.settings.effective.statusLine) ?? null,
    subagent: command(options.settings.effective.subagentStatusLine) ?? null,
  }
  let shellPrefix: string | null = null
  const initialPolicy = options.settings.sources.find(source => source.source === 'policySettings' || source.source === 'policy')?.settings ?? {}
  let helperPolicyKey = JSON.stringify([initialPolicy.allowManagedHooksOnly === true, initialPolicy.disableAllHooks === true, options.settings.effective.disableAllHooks === true])
  let policyGeneration = randomUUID()
  let transportEpoch = randomBytes(16).toString('hex'), relaunched = false, relaunching = false
  const generations = { main: randomUUID(), subagent: randomUUID() }
  const helperHandoffs: Partial<Record<keyof typeof generations, {generation: string; command: string | null; policyKey: string; shellPrefix: string | null}>> = {}
  const waiting: Record<string, unknown>[] = []
  let saveObserver: (() => Promise<void>) | undefined
  const nativeQuote = (value: string) => /^[A-Za-z0-9_./:=@+,-]+$/.test(value) ? value : quote(value)
  const prefixCommand = (value: string) => {
    if (!shellPrefix) return value
    const split = shellPrefix.lastIndexOf(' -')
    return split > 0 ? nativeQuote(shellPrefix.slice(0, split)) + ' ' + shellPrefix.slice(split + 1) + ' ' + nativeQuote(value) : nativeQuote(shellPrefix) + ' ' + nativeQuote(value)
  }
  const matchesHelperCommand = (kind: keyof typeof generations, observed: unknown, configured = helperCommands[kind]) =>
    !!configured && (observed === configured || kind === 'main' && observed === prefixCommand(configured))
  let lastTurn: ClaudeNativeTerminalState['lastTurn'], activeTurnId: string | undefined, endingTurnId: string | undefined
  let focus: ClaudeNativeTerminalState['focus'], focusSequence = 0, focusRecord: string | undefined
  let activity: ClaudeNativeTerminalState['activity'], activitySequence = 0, activityRecord: string | undefined
  let goalActive = false
  let preview: ClaudeNativeTerminalState['preview'], previewSequence = 0, previewRecord: string | undefined
  const promptQueueSchema = z.object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    count: z.number().int().positive(),
    items: z.array(z.object({id: z.string().uuid(), text: z.string().max(240), editable: z.boolean(), cancellable: z.boolean()})).min(1).max(12),
  }).nullable()
  let promptQueue: ClaudeNativeTerminalState['promptQueue']
  let nativePolling = false
  /**
   * How often the plugin should report this session's state, which is the app's answer and not the
   * plugin's timer.
   *
   * **State out and commands in are one request, and that is what bounds this.** The plugin's state is
   * read by this bridge only until the CLI's own UI mounts and reports its own (`nativePolling`), after
   * which the plugin's half was answered `{}` and its four requests a second continued for the rest of the
   * session. That half is now `0`: the reader says it is not reading, and the plugin reports only when a
   * hook — a session start, a render, either turn boundary — says there is news.
   *
   * **Why the other half stays at the fine cadence rather than idling slower.** The same request is how a
   * submission reaches the prompt: the app cannot push one, so a slower tick is latency the user feels
   * between pressing send and seeing their text. Slowing it needs the command half to stop riding on it —
   * one outstanding request this bridge completes when it has work — and that is a change to how a
   * submission is delivered, not to this cadence.
   */
  const pluginCadenceMs = () => nativePolling ? 0 : 250
  let closed = false, busy = false, ready = false
  const ui = createClaudeTerminalUiTransport({ socketPath: uiSocketPath, token, transportEpoch, current: () => !closed && observerPid ? { pid: observerPid, sessionId: projection.sessionId } : undefined })
  let nativeEditor: Awaited<ReturnType<typeof createClaudeNativeEditorBridge>> | undefined
  const uiTransport: typeof ui.transport = {...ui.transport, request: value => nativeEditor ? nativeEditor.request(value) : ui.transport.request(value)}
  let backgroundObserver: ClaudeBackgroundStatusObserver | undefined
  const linkedBackground = () => { const target = options.backgroundTarget?.(); return target?.parentSessionId === projection.sessionId ? target : undefined }
  type PendingSubmission = { id: string; sessionId: string; text: string; images: readonly ClaudeNativeImage[]; sent: boolean; queue: boolean; queueImageScope?: { turnId: string; viewRevision: number }; prepared?: boolean; entered?: boolean; waitingForInteraction?: boolean; accepted?: ClaudeNativeSubmissionReceipt; timer: ReturnType<typeof setTimeout>; resolve(receipt: ClaudeNativeSubmissionReceipt): void; reject(error: Error): void }
  let pending: PendingSubmission | undefined
  const settle = (error?: Error, receipt?: ClaudeNativeSubmissionReceipt) => {
    const current = pending
    if (!current) return
    pending = undefined; clearTimeout(current.timer)
    if (error) current.reject(error); else if (receipt) current.resolve(receipt); else current.reject(new Error('Native submission had no stored prompt receipt'))
  }
  function acceptQueuedSubmission(id: unknown, uuid: unknown) {
    const current = pending
    if (!current?.queue || !current.entered || current.sessionId !== projection.sessionId || current.id !== id
      || typeof uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(uuid)) return false
    settle(undefined, { sessionId: current.sessionId, uuid, text: current.text, queued: true })
    options.changed()
    return true
  }
  const pendingControlSchema = z.object({
    control: ClaudeBackgroundControlSchema.nullable(),
    turn: z.object({ id: z.string().min(1).max(256), cancelled: z.boolean() }).nullable(),
  })
  function submissionTimer(hasImages = !!pending?.images.length) {
    const timer = setTimeout(() => { void expireSubmission() }, hasImages ? 30000 : 5000)
    timer.unref()
    return timer
  }
  async function expireSubmission() {
    const current = pending
    if (!current) return
    if (current.entered) {
      try {
        let waitingForChromeSetup = false
        if (current.prepared) {
          const outcome = object(await uiTransport.request({ subtype: 'apack_prompt_outcome', submission_id: current.id }))
          if (closed || pending !== current || projection.sessionId !== current.sessionId) return
          if (typeof outcome?.drop === 'string') { settle(new Error('Native prompt refused: ' + outcome.drop)); return }
          if (acceptQueuedSubmission(current.id, outcome?.queued)) return
          waitingForChromeSetup = outcome?.waitingForChromeSetup === true
        }
        const state = pendingControlSchema.parse(await uiTransport.request({ subtype: 'apack_pending_control' }))
        if (closed || pending !== current || projection.sessionId !== current.sessionId) return
        if (state.turn?.cancelled || state.control && state.control.dialog.sessionId !== current.sessionId) throw new Error('Native interaction owner changed')
        // A native question, approval or Chrome setup can delay the stored prompt.
        if (state.control || waitingForChromeSetup) {
          current.waitingForInteraction = true
          current.timer = submissionTimer()
          return
        }
        if (current.waitingForInteraction) {
          current.waitingForInteraction = false
          current.timer = submissionTimer()
          return
        }
      } catch {
        // Failed or malformed reads cannot keep a stale submission alive.
      }
    }
    if (pending !== current) return
    settle(new Error('Native prompt bridge timed out'))
    if (current.queueImageScope && !current.entered) await abandonQueuedImages(current)
  }
  function queuedImageScopeCurrent(submission: PendingSubmission) {
    const scope = submission.queueImageScope
    return !scope || (busy && activeTurnId === scope.turnId && !endingTurnId
      && nativeView?.kind === 'main' && nativeView.revision === scope.viewRevision)
  }
  async function abandonQueuedImages(submission: PendingSubmission) {
    try {
      await uiTransport.request({ subtype: 'apack_release_queued_draft', submission_id: submission.id })
    } catch {
      // A closed terminal or a replacement session already retired the native draft.
    }
  }
  async function prepareSubmission(submission: PendingSubmission) {
    function checkCurrent() {
      if (closed || pending !== submission || submission.sessionId !== projection.sessionId) throw new Error('Native draft submission was retired')
      if (!queuedImageScopeCurrent(submission)) throw new Error(CLAUDE_BUSY_DRAFT_MESSAGE)
    }
    checkCurrent()
    const result = object(await uiTransport.request({ subtype: 'apack_prepare_prompt', text: submission.text, submission_id: submission.id,
      allow_empty: submission.images.length > 0,
      ...(submission.queueImageScope ? { queue: true, queue_turn_id: submission.queueImageScope.turnId } : {}) }))
    checkCurrent()
    if (result?.filled !== true) throw new Error('Native terminal draft could not be prepared; the app draft was retained')
    for (const [index, image] of submission.images.entries()) {
      if (!options.pasteImage) throw new Error('Native image input is unavailable')
      const extension = image.mediaType.slice('image/'.length)
      const path = join(directory, submission.id + '-' + index + '.' + extension)
      try {
        await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600, flag: 'wx' })
        const before = object(await uiTransport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id, ...(submission.queueImageScope ? {confirm: true} : {}) }))
        checkCurrent()
        options.pasteImage(path)
        const deadline = Date.now() + 5000
        let attached = false
        while (pending === submission && Date.now() < deadline) {
          const draft = object(await uiTransport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id }))
          if (typeof draft?.images === 'number' && typeof before?.images === 'number' && draft.images > before.images) { attached = true; break }
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        if (!attached) throw new Error('Native image could not be attached; the app draft was retained')
        await uiTransport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id, remember: true })
        checkCurrent()
      } finally { await rm(path, { force: true }) }
    }
    checkCurrent()
    submission.prepared = true
  }
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => { if (response.destroyed || response.writableEnded) return; response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
    try {
      if (closed || request.method !== 'POST' || request.headers['x-apack-native-token'] !== token) return reply(403, {})
      let bytes = 0
      const chunks: Buffer[] = []
      const limit = request.url === '/native-editor' ? CLAUDE_NATIVE_EDITOR_MESSAGE_MAX_BYTES : request.url === '/append' ? 8 * 1024 * 1024 + 65536 : request.url === '/ui-host' ? CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES : request.url === '/native-status' || request.url === '/native-focus' || request.url === '/native-preview' || request.url === '/native-activity' ? 1048576 + 65536 : 65536
      let oversized = false
      // Drain rejected bodies without retaining them so the client receives the complete refusal.
      for await (const chunk of request) {
        if (oversized) continue
        bytes += chunk.length
        if (bytes > limit) { oversized = true; chunks.length = 0; continue }
        chunks.push(chunk)
      }
      if (oversized) return reply(413, {})
      const value = object(JSON.parse(Buffer.concat(chunks).toString()))
      if (!value || typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.sessionId)) return reply(400, {})
      if (request.url === '/native-editor-prepare') {
        if (!nativeEditor || value.pid !== observerPid || value.sessionId !== projection.sessionId || typeof value.clientId !== 'string' || typeof value.panelId !== 'string' || typeof value.directory !== 'string') return reply(409, {})
        return reply(200, await nativeEditor.prepare({pid: value.pid as number, sessionId: value.sessionId, clientId: value.clientId, panelId: value.panelId, directory: value.directory}))
      }
      if (request.url === '/native-editor') {
        if (!nativeEditor || value.sessionId !== projection.sessionId || !Number.isSafeInteger(value.pid) || !Number.isSafeInteger(value.parentPid) || typeof value.fileIdentity !== 'string' || typeof value.content !== 'string' || Buffer.byteLength(value.content) > CLAUDE_NATIVE_EDITOR_MAX_BYTES) return reply(409, {})
        const accepted = await nativeEditor.offer({pid: value.pid as number, parentPid: value.parentPid as number, fileIdentity: value.fileIdentity, content: value.content}, decision => reply(200, decision))
        if (!accepted) return reply(409, {})
        const id = nativeEditor.active?.id
        response.once('close', () => {if (id && !response.writableEnded) nativeEditor?.disconnect(id)})
        return
      }
      if (request.url === '/observer-relaunch') {
        if (relaunching || value.sessionId !== projection.sessionId || value.pid !== observerPid || observerPid === undefined
          || value.previousEpoch !== transportEpoch || !saveObserver || !await options.ownsProcess?.(observerPid)) return reply(409, {})
        // Same PID is insufficient after exec: retire requests, helper samples and the old UI socket.
        if (closed || relaunching || value.previousEpoch !== transportEpoch || value.sessionId !== projection.sessionId) return reply(409, {})
        relaunching = true
        try {
          await rm(uiSocketPath, { force: true })
          if (closed || value.sessionId !== projection.sessionId) return reply(409, {})
          transportEpoch = randomBytes(16).toString('hex')
          relaunched = true
          ui.replaceEpoch(transportEpoch)
          billingSequence = 0
          nativeViewSequence = 0; nativeViewRecord = undefined; nativeView = undefined
          focusSequence = 0; focusRecord = undefined; focus = undefined
          previewSequence = 0; previewRecord = undefined; preview = undefined
          activitySequence = 0; activityRecord = undefined; activity = undefined; goalActive = false
          promptQueue = undefined; nativePolling = false
          generations.main = randomUUID(); generations.subagent = randomUUID()
          delete helperHandoffs.main; delete helperHandoffs.subagent
          waiting.length = 0
          projection.clearOutput()
          if (pending) settle(new Error('Claude restarted its terminal renderer; the draft was retained'))
          await saveObserver()
          options.changed()
          return reply(200, {})
        } finally { relaunching = false }
      }
      if ((relaunched || relaunching) && (request.url?.startsWith('/native-') && !request.url.startsWith('/native-editor')
        || request.url === '/ui-event' || request.url === '/ui-host' || request.url === '/view-enter'
        || request.url === '/poll' && value.directOwner === true || request.url === '/observer-ready')
        && (relaunching || value.ownerEpoch !== transportEpoch)) return reply(409, {})
      if (request.url === '/observer-ready') {
        if (value.sessionId !== (relaunched ? projection.sessionId : options.sessionId) || !Number.isSafeInteger(value.pid) || (value.pid as number) < 2 || (observerPid !== undefined && observerPid !== value.pid) || !await options.ownsProcess?.(value.pid as number)) return reply(409, {})
        observerPid = value.pid as number; observerProblem = undefined; options.changed(); return reply(200, {})
      }
      if (request.url === '/native-billing') {
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid || !Number.isSafeInteger(value.sequence) || Number(value.sequence) <= billingSequence) return reply(409, {})
        if (!billing.observe(value.sessionId, value.info, Number(value.observedAt))) return reply(400, {})
        billingSequence = Number(value.sequence)
        ui.receive({type: 'system', subtype: 'apack_billing_changed'})
        options.changed(); return reply(200, {})
      }
      if (request.url === '/native-preview') {
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid || !nativeView || value.viewRevision !== nativeView.revision) return reply(409, {})
        const next = value.preview === null ? undefined : object(value.preview)
        if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || value.preview !== null && (!next || typeof next.turnId !== 'string' || !next.turnId || next.turnId.length > 256 || typeof next.output !== 'string' || next.output.length > 65536 || nativeView.kind !== 'main')) return reply(400, {})
        const encoded = JSON.stringify([value.viewRevision, value.preview])
        if ((value.sequence as number) < previewSequence || value.sequence === previewSequence && encoded !== previewRecord) return reply(409, {})
        previewSequence = value.sequence as number; previewRecord = encoded
        const current = next ? { turnId: next.turnId as string, output: next.output as string } : undefined
        if (JSON.stringify(current) !== JSON.stringify(preview)) { preview = current; options.changed() }
        return reply(200, {})
      }
      if (request.url === '/native-focus') {
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid || !nativeView || value.viewRevision !== nativeView.revision) return reply(409, {})
        const next = value.focus === null ? undefined : object(value.focus)
        if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || value.focus !== null && (!next || typeof next.active !== 'boolean' || typeof next.producerId !== 'string' || !next.producerId || next.producerId.length > 256 || !Array.isArray(next.hidden) || next.hidden.length > 4096 || next.hidden.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(next.hidden).size !== next.hidden.length || next.active === false && next.hidden.length !== 0) || nativeView.kind !== 'main' && next) return reply(400, {})
        const encoded = JSON.stringify([value.viewRevision, value.focus])
        if ((value.sequence as number) < focusSequence || value.sequence === focusSequence && encoded !== focusRecord) return reply(409, {})
        focusSequence = value.sequence as number; focusRecord = encoded
        const current = next ? { sessionId: value.sessionId, viewRevision: value.viewRevision as number, producerId: next.producerId as string, active: next.active as boolean, hidden: next.hidden as string[] } : undefined
        if (JSON.stringify(current) !== JSON.stringify(focus)) { focus = current; options.changed() }
        return reply(200, {})
      }
      if (request.url === '/native-activity') {
        if (value.sessionId !== projection.sessionId || observerPid === undefined || value.pid !== observerPid) return reply(409, {})
        const counts = object(value.activity)
        if (!counts || !['pendingAgents', 'pendingWorkflows'].every(key => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return reply(400, {})
        const next = { pendingAgents: counts.pendingAgents as number, pendingWorkflows: counts.pendingWorkflows as number }
        const active = value.activeTurnId, ending = value.endingTurnId
        if ([active, ending].some(id => id !== undefined && id !== null && (typeof id !== 'string' || !id || id.length > 256))
          || (active && ending) || value.goalActive !== undefined && typeof value.goalActive !== 'boolean') return reply(400, {})
        const nextGoalActive = value.goalActive === true
        const encoded = JSON.stringify([next, value.workflows ?? [], value.shells ?? [], value.mcpTasks ?? [], value.managedTasks ?? [], value.teammates ?? [], active ?? null, ending ?? null, nextGoalActive])
        if ((value.sequence as number) < activitySequence || value.sequence === activitySequence && activityRecord !== encoded) return reply(409, {})
        if (!projection.updateActivityTasks(value.sessionId, value.workflows, value.shells, value.mcpTasks, value.managedTasks, value.teammates)) return reply(400, {})
        const changed = activityRecord !== encoded
        activitySequence = value.sequence as number; activityRecord = encoded; activity = next; goalActive = nextGoalActive
        activeTurnId = typeof active === 'string' && active !== lastTurn?.id ? active : undefined
        endingTurnId = typeof ending === 'string' && ending !== lastTurn?.id ? ending : undefined
        if (changed) options.changed()
        return reply(200, {})
      }
      if (request.url === '/observer-error') {
        if (typeof value.message !== 'string') return reply(400, {})
        observerProblem = value.message.slice(0, 1000); projection.clearOutput(); options.changed(); return reply(200, {})
      }
      if (request.url === '/view-enter') {
        const view = nativeView
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid || pending || !view || !['main', 'agent'].includes(String(value.kind)) || view.kind !== value.kind || view.kind === 'agent' && view.taskId !== value.taskId || view.revision !== value.revision) return reply(409, {})
        options.enter(); return reply(200, { entered: true })
      }
      if (request.url === '/owner-pending') return value.sessionId === projection.sessionId ? reply(200, { pending: !!pending, ...(pending?.entered ? { id: pending.id } : {}) }) : reply(409, {})
      if (request.url === '/poll') {
        // Every answer the plugin gets carries the cadence its next report is due at; the CLI's own UI
        // keeps its own timer, so a direct owner's answer says nothing about it.
        const answer = (body: Record<string, unknown> = {}) =>
          reply(200, value.directOwner === true ? body : { ...body, reportEveryMs: pluginCadenceMs() })
        if (value.directOwner !== true && value.sessionId !== projection.sessionId) return reply(200, { background: linkedBackground()?.sessionId === value.sessionId })
        const droppedReport = value.dropped === undefined ? undefined : object(value.dropped)
        // A closed set of routes and a plain count: the report is read into the lifecycle trace, so anything
        // else arriving here would be a payload, and the plugin that sends it is refused rather than logged.
        if (value.dropped !== undefined && (!droppedReport || Object.entries(droppedReport).some(([route, count]) =>
          !(NATIVE_NOTIFICATION_ROUTES as readonly string[]).includes(route) || !Number.isSafeInteger(count) || (count as number) < 1))) return reply(400, {})
        if (droppedReport) for (const [route, count] of Object.entries(droppedReport)) options.notificationsDropped?.(route as NativeNotificationRoute, count as number)
        // Once the native owner takes over, a late plugin poll cannot restore older policy metadata.
        if (nativePolling && value.directOwner !== true) return answer()
        if (value.directOwner === true && (typeof value.busy !== 'boolean' || value.turn !== null && (!object(value.turn) || typeof object(value.turn)?.id !== 'string' || typeof object(value.turn)?.cancelled !== 'boolean'))) return reply(400, {})
        // The native UI can initialize the owner if the plugin hasn't reported. If the
        // plugin won the race, leave its normal polling route in charge.
        if (value.bootstrapOwner === true) {
          if (value.directOwner !== true || observerPid === undefined || value.pid !== observerPid
            || value.sessionId !== projection.sessionId || nativeView?.kind !== 'main') return reply(409, {})
          if (ready && !nativePolling) return answer({keepPlugin: true})
        }
        if (value.metadata !== undefined && !parseClaudeTerminalMetadata(value.metadata)) return reply(400, {})
        for (const key of ['statusCommand', 'subagentCommand', 'shellPrefix']) if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || (value[key] as string).length > 32768)) return reply(400, {})
        const policy = value.policy === undefined ? undefined : object(value.policy)
        if (value.policy !== undefined && (!policy || typeof policy.allowManagedHooksOnly !== 'boolean' || typeof policy.disableAllHooks !== 'boolean') || value.hooksDisabled !== undefined && typeof value.hooksDisabled !== 'boolean') return reply(400, {})
        const nextPolicyKey = policy ? JSON.stringify([policy.allowManagedHooksOnly, policy.disableAllHooks, value.hooksDisabled === true]) : helperPolicyKey
        const policyChanged = nextPolicyKey !== helperPolicyKey
        const changedSession = projection.sessionId !== value.sessionId
        if (!projection.updateSession(value.sessionId, value.agents)) return reply(400, {})
        if (policyChanged) policyGeneration = randomUUID()
        if (value.directOwner === true) { nativePolling = true; busy = value.busy as boolean }
        const previous = { ...generations }
        const shellChanged = value.shellPrefix !== undefined && shellPrefix !== value.shellPrefix
        const nextCommands = {
          main: value.statusCommand === undefined ? helperCommands.main : value.statusCommand as string | null,
          subagent: value.subagentCommand === undefined ? helperCommands.subagent : value.subagentCommand as string | null,
        }
        let rotated = false
        for (const kind of ['main', 'subagent'] as const) {
          if (!policyChanged && !changedSession && !shellChanged && nextCommands[kind] === helperCommands[kind]) continue
          if (changedSession) delete helperHandoffs[kind]
          else helperHandoffs[kind] = { generation: generations[kind], command: helperCommands[kind], policyKey: helperPolicyKey, shellPrefix }
          generations[kind] = randomUUID()
          helperCommands[kind] = nextCommands[kind]
          if (kind === 'main') projection.clearMain()
          else projection.clearDecorations()
          rotated = true
        }
        helperPolicyKey = nextPolicyKey
        if (value.shellPrefix !== undefined) shellPrefix = value.shellPrefix as string | null
        // A helper may finish before this poll; only its native launch policy can cross the handoff.
        for (const event of waiting.splice(0)) {
          const kind = event.kind as 'main' | 'subagent'
          const policyMatches = event.policyKey === helperPolicyKey || (!policyChanged && event.policyKey === undefined)
          const shellMatches = event.shellPrefix === shellPrefix || (!shellChanged && event.shellPrefix === undefined)
          if (policyMatches && shellMatches && event.sessionId === projection.sessionId && event.parentPid === observerPid
            && event.generation === previous[kind] && matchesHelperCommand(kind, event.command)) projection.accept(event)
        }
        if (rotated) await saveObserver?.()
        if (changedSession) { billing.reset(value.sessionId, billing.value?.observedAt ?? -1); preview = undefined; focus = undefined; activity = undefined; goalActive = false; nativeView = undefined; promptQueue = undefined; session.reset(value.sessionId); lastTurn = undefined; activeTurnId = undefined; endingTurnId = undefined; busy = false; settle(new Error('Native session changed before submission completed')); await backgroundObserver?.resetParent(value.sessionId) }
        if (value.metadata !== undefined) {
          const metadata = parseClaudeTerminalMetadata(value.metadata)!
          if (metadata.totalCostUsd !== undefined) {
            const checkpoint = object(await uiTransport.request({ subtype: 'apack_checkpoint_cost', session_id: projection.sessionId }))
            if (closed || value.sessionId !== projection.sessionId || checkpoint?.sessionId !== projection.sessionId || typeof checkpoint.totalCostUsd !== 'number' || !Number.isFinite(checkpoint.totalCostUsd) || checkpoint.totalCostUsd < 0) return reply(409, {})
            metadata.totalCostUsd = checkpoint.totalCostUsd
          }
          // Plugin session.model reports the resolved model; Config's original selection is separate.
          if (metadata.modelSelection === undefined) {
            const sessionId = projection.sessionId
            try {
              const result = object(await uiTransport.request({ subtype: 'apack_get_model_selection', session_id: sessionId }))
              if (closed || projection.sessionId !== sessionId || result?.sessionId !== sessionId) return reply(409, {})
              if (typeof result.selection === 'string' && result.selection && result.selection.length <= 256) metadata.modelSelection = result.selection
            } catch { /* Native binding may not be ready during startup; the next poll retries. */ }
          }
          session.update(metadata)
          // Native dialogs and terminal shortcuts can change mode without a host command.
          if (object(value.metadata)?.permissionMode === undefined) {
            const sessionId = projection.sessionId
            try {
              const result = object(await uiTransport.request({ subtype: 'apack_get_permission_mode' }))
              const mode = PermissionModeSchema.safeParse(result?.mode)
              if (mode.success && session.metadata && projection.sessionId === sessionId) session.update({ ...session.metadata, permissionMode: mode.data, prePlanMode: result?.prePlanMode })
            } catch { /* Native terminal host may not be bound yet; the next poll retries. */ }
          }
        }
        if (!observerPid && (helperCommands.main || helperCommands.subagent) && !observerProblem) observerProblem = 'Native helper output could not be observed in this terminal'
        if (pending?.entered && pending.prepared && !pending.queue) {
          const submission = pending
          const outcome = object(await uiTransport.request({ subtype: 'apack_prompt_outcome', submission_id: submission.id }))
          if (pending === submission && submission.sessionId === projection.sessionId) {
            if (typeof outcome?.drop === 'string') settle(new Error('Native prompt refused: ' + outcome.drop))
          }
        }
        ready = true; options.changed()
        if (pending && !pending.queue && !pending.sent && pending.sessionId === projection.sessionId) {
          const submission = pending; submission.sent = true
          if (value.directOwner === true || ui.hasPromptHosts || submission.images.length) {
            try {
              await prepareSubmission(submission)
              if (pending !== submission || submission.sessionId !== projection.sessionId) return answer()
              return answer({ id: submission.id, text: submission.text, prepared: true })
            } catch (error) { if (pending === submission) settle(error instanceof Error ? error : new Error('Native terminal draft could not be prepared')); return answer() }
          }
          return answer({ id: submission.id, text: submission.text })
        }
        return answer()
      }
      if (value.sessionId !== projection.sessionId) return reply(409, {})
      if (request.url === '/prompt-suggestion-view') return reply(200, { desktopAgent: nativeView?.kind === 'agent' && ui.hasPromptHosts })
      if (request.url === '/native-view') {
        const view = object(value.view)
        if (value.pid !== observerPid || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || (value.sequence as number) < nativeViewSequence || !view || !['main', 'agent'].includes(String(view.kind)) || view.kind === 'agent' && (typeof view.registryId !== 'string' || !view.registryId || view.registryId.length > 256 || view.taskId !== undefined && (typeof view.taskId !== 'string' || !view.taskId || view.taskId.length > 256))) return reply(409, {})
        const next: import('../../../common/native-terminal.ts').ClaudeNativeTerminalView = view.kind === 'main' ? { kind: 'main', revision: value.sequence as number } : { kind: 'agent', revision: value.sequence as number, registryId: view.registryId as string, ...(typeof view.taskId === 'string' ? { taskId: view.taskId } : {}) }
        const record = JSON.stringify([value.sessionId, next])
        // A session handoff withdraws presentation, not the last admitted observation's identity.
        if (value.sequence === nativeViewSequence && record !== nativeViewRecord) return reply(409, {})
        const queue = value.promptQueue === undefined ? undefined : promptQueueSchema.safeParse(value.promptQueue)
        if (queue && (!queue.success || value.heartbeat !== true || next.kind !== 'main' && queue.data !== null)) return reply(409, {})
        nativeViewSequence = value.sequence as number
        nativeViewRecord = record
        const viewChanged = JSON.stringify(next) !== JSON.stringify(nativeView)
        if (viewChanged) { preview = undefined; focus = undefined; nativeView = next }
        const nextQueue = queue?.success ? queue.data ?? undefined : viewChanged ? undefined : promptQueue
        if (viewChanged || JSON.stringify(nextQueue) !== JSON.stringify(promptQueue)) {
          promptQueue = nextQueue
          options.changed()
        }
        const submission = pending
        if (next.kind !== 'main' || !submission || submission.sessionId !== value.sessionId) {
          // A confirmed native prompt view exists even if the private plugin didn't load.
          return reply(200, !ready && next.kind === 'main' && value.heartbeat === true ? {bootstrapOwner: true} : {})
        }
        // While a turn is running, the CLI can service its view heartbeat even when the hook does not poll.
        if (submission.queue && value.heartbeat === true) {
          if (!submission.sent) {
            submission.sent = true
            if (!submission.queueImageScope) return reply(200, { prepareQueuedPrompt: { id: submission.id, text: submission.text } })
            // Keep the heartbeat free to receive turn and view changes while the terminal pastes images.
            void prepareSubmission(submission).catch(async error => {
              await abandonQueuedImages(submission)
              if (pending === submission) settle(error instanceof Error ? error : new Error(CLAUDE_BUSY_DRAFT_MESSAGE))
            })
          }
          if (submission.queueImageScope && submission.prepared && !submission.entered)
            return reply(200, { prepareQueuedPrompt: { id: submission.id, prepared: true } })
        }
        return reply(200, submission.entered && submission.prepared ? {
          pendingSubmissionId: submission.id, ...(submission.queue ? { queue: true } : {}),
        } : {})
      }
      if (request.url === '/ui-ready') {
        await uiTransport.request({ subtype: 'apack_observe_notices' }); return reply(200, {})
      }
      if (request.url === '/ui-host') {
        if (value.pid !== observerPid || !ui.receiveHost(value, (result, current) => reply(current ? 200 : 409, { request_id: value.request_id, pid: observerPid, sessionId: value.sessionId, result }))) return reply(409, {})
        response.once('close', () => ui.cancelHost(String(value.request_id)))
        return
      }
      if (request.url === '/ui-event') {
        const event = object(value.event)
        if (value.pid !== observerPid || !event || event.type !== 'system') return reply(409, {})
        const invalidation = event.subtype === 'ui_invalidate' && event.event === 'ui.render'
        const promptTheme = event.subtype === 'ui_prompt_theme' && readClaudePromptPalette(event.palette) !== undefined
        const panes = event.subtype === 'ui_panes' && Array.isArray(event.panes) && event.panes.length <= 256
          && event.panes.every(value => { const pane = object(value); return pane && typeof pane.id === 'string' && typeof pane.plugin === 'string' && typeof pane.title === 'string' })
          && [event.shown_id, event.focused_id, event.focus_requested_id].every(id => id === null || typeof id === 'string')
        const site = typeof event.client_id === 'string' && ['Pane', 'AbovePrompt'].includes(String(event.component)) && typeof event.instance_id === 'string'
        const scroll = site && event.subtype === 'ui_scroll' && Number.isSafeInteger(event.offset) && Number(event.offset) >= 0
        const focus = site && event.subtype === 'ui_focus' && typeof event.plugin === 'string' && typeof event.key === 'string'
        const notification = event.subtype === 'ui_notification'
        const notice = ['ui_status', 'ui_toast', 'ui_notification'].includes(String(event.subtype)) && event.session_id === projection.sessionId
          && typeof event.uuid === 'string' && event.uuid.length > 0 && event.uuid.length <= 128 && typeof event.plugin === 'string' && event.plugin.length > 0 && event.plugin.length <= 256
          && (typeof event.text === 'string' && (notification || event.text.length <= 10001) || event.subtype === 'ui_status' && event.text === null)
          && (!['ui_toast', 'ui_notification'].includes(String(event.subtype)) || Number.isSafeInteger(event.timeout_ms) && Number(event.timeout_ms) >= 0)
          && (!notification || typeof event.title === 'string' && ['iterm2', 'iterm2_with_bell', 'kitty', 'ghostty', 'terminal_bell'].includes(String(event.channel)) && event.policy_generation === policyGeneration)
        const actionKeys = event.subtype === 'apack_ui_action_keys' && typeof event.client_id === 'string'
          && /^[A-Za-z0-9._-]{1,64}$/.test(event.client_id) && readClaudeUiActionKeys(event.action_keys) !== undefined
        const countdown = event.subtype === 'apack_question_countdown' && event.session_id === projection.sessionId && ClaudeQuestionCountdownEventSchema.safeParse(event).success
        if (!invalidation && !promptTheme && !panes && !scroll && !focus && !notice && !actionKeys && !countdown) return reply(409, {})
        ui.receive(event); return reply(200, {})
      }
      if (request.url === '/transcript') {
        if (typeof value.path !== 'string' || value.path.length > 16384 || !isAbsolute(value.path) || basename(value.path) !== value.sessionId + '.jsonl') return reply(400, {})
        if (!transcripts.some(entry => entry.path === value.path && entry.sessionId === value.sessionId)) transcripts.push({ sessionId: value.sessionId, path: value.path })
        options.changed(); return reply(200, {})
      }
      if (request.url === '/append') {
        const record = session.append(value)
        if (!record) return reply(400, {})
        if (pending?.entered && value.submissionId === pending.id && record.door === 'prompt' && record.message.type === 'user' && !record.message.isMeta) {
          pending.accepted = { sessionId: record.sessionId, uuid: record.uuid, text: record.message.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') }
        }
        options.changed(); return reply(200, {})
      }
      if (request.url === '/submission') {
        if (!pending?.entered || value.id !== pending.id) return reply(409, {})
        if (typeof value.drop === 'string') settle(new Error('Native prompt refused: ' + value.drop))
        else if (value.queued !== undefined) {
          if (observerPid === undefined || value.pid !== observerPid || !acceptQueuedSubmission(value.id, value.queued)) return reply(409, {})
        } else if (value.accepted === true && pending.accepted) settle(undefined, pending.accepted)
        // The hook can finish screening before a command stores its user row.
        // The prepared prompt's native observer can still confirm the same submission.
        else if (!pending.prepared || value.accepted !== true) settle(new Error('Native prompt did not produce a stored user message'))
        return reply(200, {})
      }
      if (request.url === '/native-status') {
        const kind = value.kind
        if (!observerPid || value.parentPid !== observerPid || !Number.isSafeInteger(value.childPid) || (value.childPid as number) < 2 || (kind !== 'main' && kind !== 'subagent')) return reply(409, {})
        if (value.policyKey !== undefined && (typeof value.policyKey !== 'string' || !/^\[(true|false),(true|false),(true|false)\]$/.test(value.policyKey))) return reply(400, {})
        if (value.shellPrefix !== undefined && value.shellPrefix !== null && (typeof value.shellPrefix !== 'string' || value.shellPrefix.length > 32768)) return reply(400, {})
        const currentCommand = matchesHelperCommand(kind, value.command)
        const currentShell = value.shellPrefix === shellPrefix
        const shellMatches = currentShell || value.shellPrefix === undefined
        if (value.generation !== generations[kind]) {
          const previous = helperHandoffs[kind]
          // The helper can start under the new native settings before the observer file receives its next
          // generation. A receipt that could belong to the superseded settings still has no authority.
          if (!previous || value.generation !== previous.generation || !currentCommand || !shellMatches || value.policyKey !== helperPolicyKey) return reply(409, {})
          const shellChanged = previous.shellPrefix !== shellPrefix
          if (shellChanged && !currentShell) return reply(409, {})
          if (!shellChanged && value.policyKey === previous.policyKey && matchesHelperCommand(kind, value.command, previous.command)) return reply(409, {})
        } else if (!currentCommand || !shellMatches || value.policyKey !== undefined && value.policyKey !== helperPolicyKey) {
          waiting.push(value); if (waiting.length > 16) waiting.shift()
          return reply(202, {})
        }
        if (!projection.accept(value)) return reply(409, {})
        options.changed(); return reply(200, {})
      }
      if (request.url === '/turn') {
        if (typeof value.running !== 'boolean') return reply(400, {})
        if (!value.running && (typeof value.turnId !== 'string' || !['answer','aborted','refusal','error'].includes(String(value.reason)))) return reply(400, {})
        lastTurn = value.running ? undefined : { id: value.turnId as string, reason: value.reason as NonNullable<ClaudeNativeTerminalState['lastTurn']>['reason'] }
        if (!value.running && activeTurnId === lastTurn?.id) activeTurnId = undefined
        if (value.running || endingTurnId === lastTurn?.id) endingTurnId = undefined
        busy = value.running; options.changed(); return reply(200, {})
      }
      if (request.url !== '/result' || !pending || pending.entered || !pending.sent || value.id !== pending.id || pending.sessionId !== projection.sessionId) return reply(409, {})
      if (pending.queue && (observerPid === undefined || value.pid !== observerPid || nativeView?.kind !== 'main')) return reply(409, {})
      const submission = pending
      if (submission.queueImageScope && (value.filled !== true || !submission.prepared || !queuedImageScopeCurrent(submission))) {
        await abandonQueuedImages(submission)
        if (pending === submission) settle(new Error(CLAUDE_BUSY_DRAFT_MESSAGE))
        return reply(200, {})
      }
      if (value.filled !== true) settle(new Error('Native prompt rejected the draft; existing terminal input was preserved'))
      else {
        try {
          if (pending.queue) pending.prepared = true
          pending.entered = true
          options.enter()
        } catch { settle(new Error('Native terminal closed before submission')) }
      }
      reply(200, {})
    } catch { if (!response.headersSent) reply(400, {}); else response.destroy() }
  })
  try {
    nativeEditor = await createClaudeNativeEditorBridge({directory, socketPath, token, transport: ui.transport, hold: ui.holdEditorRequest,
      current: () => !closed && observerPid ? {pid: observerPid, sessionId: projection.sessionId} : undefined,
      ownsChild: pid => options.ownsProcess?.(pid) ?? Promise.resolve(false),
      changed() {ui.receive({type: 'system', subtype: 'apack_native_editor_changed'}); options.changed()},
      failed(scope, error) {ui.receive({type: 'system', subtype: 'apack_native_editor_failed', client_id: scope.clientId, panel_id: scope.panelId, problem: error.message})},
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
    if (options.backgroundObserver?.available) {
      if (options.backgroundObserver.parentSessionId !== options.sessionId) throw new Error('Background observer belongs to another parent')
      backgroundObserver = options.backgroundObserver
      backgroundObserver.adoptParent(linkedBackground, options.changed)
    } else backgroundObserver = await createClaudeBackgroundStatusObserver({ parentSessionId: options.sessionId, profile: options.backgroundProfile, childUiLaunch: options.backgroundChildUiLaunch, target: linkedBackground, authority: options.backgroundAuthority, changed: options.changed })
    const runtime = join(directory, 'status.mjs'), observerConfig = join(directory, 'observer.json')
    await writeFile(runtime, claudeTerminalStatusRuntime, { mode: 0o600 })
    await writeFile(join(directory, 'ui.mjs'), claudeTerminalUiRuntime, { mode: 0o600 })
    let observerWrite = Promise.resolve()
    saveObserver = () => {
      const snapshot = JSON.stringify({ socketPath, uiSocketPath, token, transportEpoch, sessionId: projection.sessionId, restorePlan: options.restorePlan, originalBunOptions: options.bunOptions, generations, policyGeneration })
      observerWrite = observerWrite.catch(() => {}).then(async () => {
        const temporary = observerConfig + '.' + randomUUID() + '.tmp'
        await writeFile(temporary, snapshot, { mode: 0o600 })
        await rename(temporary, observerConfig)
      })
      return observerWrite
    }
    await saveObserver()
    const bunOptions = (options.bunOptions ? options.bunOptions + ' ' : '') + '--preload=' + nativeQuote(runtime)
    // A surviving native worker watches the plugin it inherited from its parent.
    // Give each parent immutable launch files. Their shared observer owns the
    // generations until its workers are retired, and removes them together.
    const pluginRoot = await mkdtemp(join(backgroundObserver.directory, 'plugin-'))
    try {
      await mkdir(join(pluginRoot, '.claude-plugin'))
      await mkdir(join(pluginRoot, 'hooks'))
      await writeFile(join(pluginRoot, '.claude-plugin/plugin.json'), JSON.stringify({name: 'apack-native-terminal', version: '0.0.1'}), {mode: 0o600})
      await writeFile(join(pluginRoot, 'hooks/hooks.json'), JSON.stringify({modules: ['./register.ts']}), {mode: 0o600})
      const plugin = createClaudeTerminalPlugin(socketPath, token, {parentSessionId: options.sessionId, socketPath: backgroundObserver.socketPath, token: backgroundObserver.token})
      await writeFile(join(pluginRoot, 'hooks/register.ts'), plugin, {mode: 0o600})
    } catch (error) {
      await rm(pluginRoot, {recursive: true, force: true})
      throw error
    }
    return {
      directory, pluginRoot, bunOptions, projection, session, transcripts, uiTransport,
      get backgroundInfo() { return backgroundObserver?.value },
      get backgroundObserver() { return backgroundObserver! },
      get problem() { return observerProblem },
      get nativePid() { return observerPid },
      get view() { return nativeView },
      get lastTurn() { return lastTurn },
      get activeTurnId() { return busy && !closed ? activeTurnId : undefined },
      get endingTurnId() { return busy ? endingTurnId : undefined },
      get ready() { return ready && !closed },
      get rendererEpoch() { return transportEpoch },
      async waitForRendererRestart(previousEpoch: string) {
        const deadline = Date.now() + 12000
        while (!closed && Date.now() < deadline) {
          if (transportEpoch !== previousEpoch && nativePolling && !relaunching) return
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error(closed ? 'Claude closed during its renderer restart' : transportEpoch === previousEpoch
          ? 'Claude stayed on the current renderer' : 'Claude restarted but its controls did not reconnect')
      },
      get focus() { return focus },
      get billing() { return closed ? undefined : billing.value },
      get preview() { return closed ? undefined : preview },
      get promptQueue() { return closed ? undefined : promptQueue },
      get activity() { return activity },
      get goalActive() { return !closed && goalActive },
      get busy() { return busy || !!pending || !!nativeEditor?.active },
      submit(text: string, images: readonly ClaudeNativeImage[] = []): Promise<ClaudeNativeSubmissionReceipt> {
        if (text.length > CLAUDE_UI_TEXT_MAX_LENGTH) return Promise.reject(new Error(CLAUDE_UI_TEXT_LIMIT_MESSAGE))
        if (closed || !ready || !text.trim() && !images.length) return Promise.reject(new Error('Native terminal cannot accept this draft now'))
        const queue = busy && !!activeTurnId && !endingTurnId && nativeView?.kind === 'main'
          && !/^[!/]/.test(text.trimStart())
        if (pending || busy && !queue || nativeEditor?.active) return Promise.reject(new Error(CLAUDE_BUSY_DRAFT_MESSAGE))
        if (images.some(image => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mediaType) || !image.data || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))) return Promise.reject(new Error('Native image content is invalid'))
        return new Promise((resolve, reject) => {
          const timer = submissionTimer(images.length > 0)
          const queueImageScope = queue && images.length && activeTurnId && nativeView
            ? { turnId: activeTurnId, viewRevision: nativeView.revision } : undefined
          pending = { id: randomUUID(), sessionId: projection.sessionId, text, images: images.map(image => ({ ...image })), sent: false, queue, queueImageScope, timer, resolve, reject }
        })
      },
      async close() {
        if (closed) return
        closed = true; await backgroundObserver?.releaseParent(); busy = false; endingTurnId = undefined; focus = undefined; activity = undefined; nativeView = undefined; nativeEditor?.close(); ui.close(); settle(new Error('Native terminal closed')); projection.clear()
        waiting.length = 0; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (backgroundObserver === options.backgroundObserver) await backgroundObserver?.releaseParent(); else await backgroundObserver?.close(); nativeEditor?.close(); ui.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true }); throw error
  }
}
