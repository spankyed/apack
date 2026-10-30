import { createClaudeBackgroundStatus, type ClaudeBackgroundStatusIdentity } from './terminal-background-status.ts'
import { createClaudeBillingState } from '../../../common/native-billing.ts'
import { readClaudeUiActionKeys } from './ui-controls.ts'
import { readClaudePromptPalette } from '../../../common/native-prompt-theme.ts'
import { createClaudeTerminalUiTransport } from './terminal-ui.ts'
import { claudeTerminalUiRuntime } from './terminal-ui-runtime.ts'
import type { ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'
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
  backgroundTarget?(): { sessionId: string; cwd: string } | undefined
  restorePlan?: { sessionId: string; mode: import('./types.ts').PermissionMode }
  settings: ClaudeSettings
  bunOptions?: string
  ownsProcess?(pid: number): Promise<boolean>
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
  let nativeView: import('../../../common/native-terminal.ts').ClaudeNativeTerminalView | undefined
  let observerPid: number | undefined, observerProblem: string | undefined
  let mainCommand = command(options.settings.effective.statusLine) ?? null
  let subagentCommand = command(options.settings.effective.subagentStatusLine) ?? null
  let shellPrefix: string | null = null
  const initialPolicy = options.settings.sources.find(source => source.source === 'policySettings' || source.source === 'policy')?.settings ?? {}
  let helperPolicyKey = JSON.stringify([initialPolicy.allowManagedHooksOnly === true, initialPolicy.disableAllHooks === true, options.settings.effective.disableAllHooks === true])
  let policyGeneration = randomUUID()
  const generations = { main: randomUUID(), subagent: randomUUID() }
  const waiting: Record<string, unknown>[] = []
  let saveObserver: (() => Promise<void>) | undefined
  const nativeQuote = (value: string) => /^[A-Za-z0-9_./:=@+,-]+$/.test(value) ? value : quote(value)
  const prefixCommand = (value: string) => {
    if (!shellPrefix) return value
    const split = shellPrefix.lastIndexOf(' -')
    return split > 0 ? nativeQuote(shellPrefix.slice(0, split)) + ' ' + shellPrefix.slice(split + 1) + ' ' + nativeQuote(value) : nativeQuote(shellPrefix) + ' ' + nativeQuote(value)
  }
  const matches = (value: Record<string, unknown>) => value.kind === 'subagent' ? !!subagentCommand && value.command === subagentCommand : value.kind === 'main' && !!mainCommand && (value.command === mainCommand || value.command === prefixCommand(mainCommand))
  let lastTurn: ClaudeNativeTerminalState['lastTurn']
  let focus: ClaudeNativeTerminalState['focus'], focusSequence = 0, focusRecord: string | undefined
  let activity: ClaudeNativeTerminalState['activity'], activitySequence = 0, activityRecord: string | undefined
  let preview: ClaudeNativeTerminalState['preview'], previewSequence = 0, previewRecord: string | undefined
  let nativePolling = false
  let closed = false, busy = false, ready = false
  const ui = createClaudeTerminalUiTransport({ socketPath: uiSocketPath, token, current: () => !closed && observerPid ? { pid: observerPid, sessionId: projection.sessionId } : undefined })
  const background = createClaudeBackgroundStatus({
    async identify(sessionId, pid) {
      const target = options.backgroundTarget?.()
      if (closed || !target || target.sessionId !== sessionId || sessionId === projection.sessionId) throw new Error('Background session is not linked to this parent')
      const result = object(await ui.transport.request({ subtype: 'apack_background_identity', parent_session_id: projection.sessionId, child_session_id: sessionId, pid, cwd: target.cwd }))
      if (closed || options.backgroundTarget?.()?.sessionId !== sessionId || !result || result.sessionId !== sessionId || result.pid !== pid || typeof result.jobId !== 'string' || typeof result.start !== 'string' || !result.start || typeof result.hostStart !== 'string' || !result.hostStart || !Number.isSafeInteger(result.hostPid) || result.cwd !== target.cwd) throw new Error('Background status identity changed')
      return result as unknown as ClaudeBackgroundStatusIdentity
    },
    changed: options.changed,
  })
  let pending: { id: string; sessionId: string; text: string; images: readonly ClaudeNativeImage[]; sent: boolean; prepared?: boolean; entered?: boolean; accepted?: ClaudeNativeSubmissionReceipt; timer: ReturnType<typeof setTimeout>; resolve(receipt: ClaudeNativeSubmissionReceipt): void; reject(error: Error): void } | undefined
  const settle = (error?: Error, receipt?: ClaudeNativeSubmissionReceipt) => {
    const current = pending
    if (!current) return
    pending = undefined; clearTimeout(current.timer)
    if (error) current.reject(error); else if (receipt) current.resolve(receipt); else current.reject(new Error('Native submission had no stored prompt receipt'))
  }
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => { if (response.destroyed || response.writableEnded) return; response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
    try {
      if (closed || request.method !== 'POST' || request.headers['x-apack-native-token'] !== token) return reply(403, {})
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) { bytes += chunk.length; if (bytes > (request.url === '/append' ? 8 * 1024 * 1024 + 65536 : request.url === '/native-status' || request.url === '/ui-host' || request.url === '/native-focus' || request.url === '/native-preview' || request.url === '/native-activity' ? 1048576 + 65536 : 65536)) return reply(413, {}); chunks.push(chunk) }
      const value = object(JSON.parse(Buffer.concat(chunks).toString()))
      if (!value || typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.sessionId)) return reply(400, {})
      if (request.url === '/background-register') return reply(200, await background.register(value.sessionId, Number(value.pid)))
      if (request.url === '/background-status') { await background.accept(value); return reply(200, {}) }
      if (request.url === '/observer-ready') {
        if (value.sessionId !== options.sessionId || !Number.isSafeInteger(value.pid) || (value.pid as number) < 2 || (observerPid !== undefined && observerPid !== value.pid) || !await options.ownsProcess?.(value.pid as number)) return reply(409, {})
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
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid) return reply(409, {})
        const counts = object(value.activity)
        if (!counts || !['pendingAgents', 'pendingWorkflows'].every(key => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return reply(400, {})
        const next = { pendingAgents: counts.pendingAgents as number, pendingWorkflows: counts.pendingWorkflows as number }
        const encoded = JSON.stringify([next, value.workflows ?? [], value.shells ?? []])
        if ((value.sequence as number) < activitySequence || value.sequence === activitySequence && activityRecord !== encoded) return reply(409, {})
        if (!projection.updateActivityTasks(value.sessionId, value.workflows, value.shells)) return reply(400, {})
        const changed = activityRecord !== encoded
        activitySequence = value.sequence as number; activityRecord = encoded; activity = next
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
        if (value.directOwner !== true && value.sessionId !== projection.sessionId) return reply(200, { background: options.backgroundTarget?.()?.sessionId === value.sessionId })
        // Once the native owner takes over, a late plugin poll cannot restore older policy metadata.
        if (nativePolling && value.directOwner !== true) return reply(200, {})
        if (value.directOwner === true && (typeof value.busy !== 'boolean' || value.turn !== null && (!object(value.turn) || typeof object(value.turn)?.id !== 'string' || typeof object(value.turn)?.cancelled !== 'boolean'))) return reply(400, {})
        if (value.metadata !== undefined && !parseClaudeTerminalMetadata(value.metadata)) return reply(400, {})
        for (const key of ['statusCommand', 'subagentCommand', 'shellPrefix']) if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || (value[key] as string).length > 32768)) return reply(400, {})
        const policy = value.policy === undefined ? undefined : object(value.policy)
        if (value.policy !== undefined && (!policy || typeof policy.allowManagedHooksOnly !== 'boolean' || typeof policy.disableAllHooks !== 'boolean') || value.hooksDisabled !== undefined && typeof value.hooksDisabled !== 'boolean') return reply(400, {})
        const nextPolicyKey = policy ? JSON.stringify([policy.allowManagedHooksOnly, policy.disableAllHooks, value.hooksDisabled === true]) : helperPolicyKey
        const policyChanged = nextPolicyKey !== helperPolicyKey
        const changedSession = projection.sessionId !== value.sessionId
        if (!projection.updateSession(value.sessionId, value.agents)) return reply(400, {})
        if (policyChanged) policyGeneration = randomUUID()
        helperPolicyKey = nextPolicyKey
        if (value.directOwner === true) { nativePolling = true; busy = value.busy as boolean }
        const previous = { ...generations }
        const mainChanged = policyChanged || changedSession || value.statusCommand !== undefined && mainCommand !== value.statusCommand || value.shellPrefix !== undefined && shellPrefix !== value.shellPrefix
        const subChanged = policyChanged || changedSession || value.subagentCommand !== undefined && subagentCommand !== value.subagentCommand || value.shellPrefix !== undefined && shellPrefix !== value.shellPrefix
        if (value.statusCommand !== undefined) mainCommand = value.statusCommand as string | null
        if (value.subagentCommand !== undefined) subagentCommand = value.subagentCommand as string | null
        if (value.shellPrefix !== undefined) shellPrefix = value.shellPrefix as string | null
        if (mainChanged) { generations.main = randomUUID(); projection.clearMain() }
        if (subChanged) { generations.subagent = randomUUID(); projection.clearDecorations() }
        if (mainChanged || subChanged) await saveObserver?.()
        // A helper may finish before this poll; only its native launch policy can cross the handoff.
        for (const event of waiting.splice(0)) {
          const kind = event.kind as 'main' | 'subagent'
          if ((event.policyKey === helperPolicyKey || !policyChanged && event.policyKey === undefined) && event.sessionId === projection.sessionId && event.parentPid === observerPid && event.generation === previous[kind] && matches(event)) projection.accept(event)
        }
        if (changedSession) { billing.reset(value.sessionId, billing.value?.observedAt ?? -1); preview = undefined; focus = undefined; activity = undefined; nativeView = undefined; session.reset(value.sessionId); lastTurn = undefined; busy = false; settle(new Error('Native session changed before submission completed')) }
        if (value.metadata !== undefined) {
          const metadata = parseClaudeTerminalMetadata(value.metadata)!
          if (metadata.totalCostUsd !== undefined) {
            const checkpoint = object(await ui.transport.request({ subtype: 'apack_checkpoint_cost', session_id: projection.sessionId }))
            if (closed || value.sessionId !== projection.sessionId || checkpoint?.sessionId !== projection.sessionId || typeof checkpoint.totalCostUsd !== 'number' || !Number.isFinite(checkpoint.totalCostUsd) || checkpoint.totalCostUsd < 0) return reply(409, {})
            metadata.totalCostUsd = checkpoint.totalCostUsd
          }
          // Plugin session.model reports the resolved model; Config's original selection is separate.
          if (metadata.modelSelection === undefined) {
            const sessionId = projection.sessionId
            try {
              const result = object(await ui.transport.request({ subtype: 'apack_get_model_selection', session_id: sessionId }))
              if (closed || projection.sessionId !== sessionId || result?.sessionId !== sessionId) return reply(409, {})
              if (typeof result.selection === 'string' && result.selection && result.selection.length <= 256) metadata.modelSelection = result.selection
            } catch { /* Native binding may not be ready during startup; the next poll retries. */ }
          }
          session.update(metadata)
          // Native dialogs and terminal shortcuts can change mode without a host command.
          if (object(value.metadata)?.permissionMode === undefined) {
            const sessionId = projection.sessionId
            try {
              const result = object(await ui.transport.request({ subtype: 'apack_get_permission_mode' }))
              const mode = PermissionModeSchema.safeParse(result?.mode)
              if (mode.success && session.metadata && projection.sessionId === sessionId) session.update({ ...session.metadata, permissionMode: mode.data, prePlanMode: result?.prePlanMode })
            } catch { /* Native terminal host may not be bound yet; the next poll retries. */ }
          }
        }
        if (!observerPid && (mainCommand || subagentCommand) && !observerProblem) observerProblem = 'Native helper output could not be observed in this terminal'
        if (pending?.entered && pending.prepared) {
          const submission = pending
          const outcome = object(await ui.transport.request({ subtype: 'apack_prompt_outcome', submission_id: submission.id }))
          if (pending === submission && submission.sessionId === projection.sessionId && typeof outcome?.drop === 'string') settle(new Error('Native prompt refused: ' + outcome.drop))
        }
        ready = true; options.changed()
        if (pending && !pending.sent && pending.sessionId === projection.sessionId) {
          const submission = pending; submission.sent = true
          if (value.directOwner === true || ui.hasPromptHosts || submission.images.length) {
            try {
              const result = object(await ui.transport.request({ subtype: 'apack_prepare_prompt', text: submission.text, submission_id: submission.id, allow_empty: submission.images.length > 0 }))
              if (pending !== submission || submission.sessionId !== projection.sessionId) return reply(200, {})
              if (result?.filled !== true) { settle(new Error('Native terminal draft could not be prepared; the app draft was retained')); return reply(200, {}) }
              for (const [index, image] of submission.images.entries()) {
                if (!options.pasteImage) throw new Error('Native image input is unavailable')
                if (pending !== submission) throw new Error('Native image submission was retired')
                const extension = image.mediaType.slice('image/'.length)
                const path = join(directory, submission.id + '-' + index + '.' + extension)
                try {
                  await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600, flag: 'wx' })
                  const before = object(await ui.transport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id }))
                  if (pending !== submission) throw new Error('Native image submission was retired')
                  options.pasteImage(path)
                  const deadline = Date.now() + 5000
                  let attached = false
                  while (pending === submission && Date.now() < deadline) {
                    const draft = object(await ui.transport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id }))
                    if (typeof draft?.images === 'number' && typeof before?.images === 'number' && draft.images > before.images) { attached = true; break }
                    await new Promise(resolve => setTimeout(resolve, 25))
                  }
                  if (!attached) throw new Error('Native image could not be attached; the app draft was retained')
                  await ui.transport.request({ subtype: 'apack_terminal_draft', submission_id: submission.id, remember: true })
                } finally { await rm(path, { force: true }) }
              }
              if (pending !== submission || submission.sessionId !== projection.sessionId) return reply(200, {})
              submission.prepared = true
              return reply(200, { id: submission.id, text: submission.text, prepared: true })
            } catch (error) { if (pending === submission) settle(error instanceof Error ? error : new Error('Native terminal draft could not be prepared')); return reply(200, {}) }
          }
          return reply(200, { id: submission.id, text: submission.text })
        }
        return reply(200, {})
      }
      if (value.sessionId !== projection.sessionId) return reply(409, {})
      if (request.url === '/native-view') {
        const view = object(value.view)
        if (value.pid !== observerPid || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || (value.sequence as number) < nativeViewSequence || !view || !['main', 'agent'].includes(String(view.kind)) || view.kind === 'agent' && (typeof view.registryId !== 'string' || !view.registryId || view.registryId.length > 256 || view.taskId !== undefined && (typeof view.taskId !== 'string' || !view.taskId || view.taskId.length > 256))) return reply(409, {})
        const next: import('../../../common/native-terminal.ts').ClaudeNativeTerminalView = view.kind === 'main' ? { kind: 'main', revision: value.sequence as number } : { kind: 'agent', revision: value.sequence as number, registryId: view.registryId as string, ...(typeof view.taskId === 'string' ? { taskId: view.taskId } : {}) }
        if (value.sequence === nativeViewSequence && JSON.stringify(next) !== JSON.stringify(nativeView)) return reply(409, {})
        nativeViewSequence = value.sequence as number
        if (JSON.stringify(next) !== JSON.stringify(nativeView)) { preview = undefined; focus = undefined; nativeView = next; options.changed() }
        return reply(200, {})
      }
      if (request.url === '/ui-ready') {
        await ui.transport.request({ subtype: 'apack_observe_notices' }); return reply(200, {})
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
        if (!invalidation && !promptTheme && !panes && !scroll && !focus && !notice && !actionKeys) return reply(409, {})
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
        else if (value.accepted === true && pending.accepted) settle(undefined, pending.accepted)
        else settle(new Error('Native prompt did not produce a stored user message'))
        return reply(200, {})
      }
      if (request.url === '/native-status') {
        if (!observerPid || value.parentPid !== observerPid || !Number.isSafeInteger(value.childPid) || (value.childPid as number) < 2 || (value.kind !== 'main' && value.kind !== 'subagent') || value.generation !== generations[value.kind]) return reply(409, {})
        if (value.policyKey !== undefined && (typeof value.policyKey !== 'string' || !/^\[(true|false),(true|false),(true|false)\]$/.test(value.policyKey))) return reply(400, {})
        if (!matches(value) || value.policyKey !== undefined && value.policyKey !== helperPolicyKey) { waiting.push(value); if (waiting.length > 16) waiting.shift(); return reply(202, {}) }
        if (!projection.accept(value)) return reply(409, {})
        options.changed(); return reply(200, {})
      }
      if (request.url === '/turn') {
        if (typeof value.running !== 'boolean') return reply(400, {})
        if (!value.running && (typeof value.turnId !== 'string' || !['answer','aborted','refusal','error'].includes(String(value.reason)))) return reply(400, {})
        lastTurn = value.running ? undefined : { id: value.turnId as string, reason: value.reason as NonNullable<ClaudeNativeTerminalState['lastTurn']>['reason'] }
        busy = value.running; options.changed(); return reply(200, {})
      }
      if (request.url !== '/result' || !pending || pending.entered || !pending.sent || value.id !== pending.id || pending.sessionId !== projection.sessionId) return reply(409, {})
      if (value.filled !== true) settle(new Error('Native prompt rejected the draft; existing terminal input was preserved'))
      else {
        try { pending.entered = true; options.enter() } catch { settle(new Error('Native terminal closed before submission')) }
      }
      reply(200, {})
    } catch { if (!response.headersSent) reply(400, {}); else response.destroy() }
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
    const runtime = join(directory, 'status.mjs'), observerConfig = join(directory, 'observer.json')
    await writeFile(runtime, claudeTerminalStatusRuntime, { mode: 0o600 })
    await writeFile(join(directory, 'ui.mjs'), claudeTerminalUiRuntime, { mode: 0o600 })
    let observerWrite = Promise.resolve()
    saveObserver = () => {
      const snapshot = JSON.stringify({ socketPath, uiSocketPath, token, sessionId: projection.sessionId, restorePlan: options.restorePlan, originalBunOptions: options.bunOptions, generations, policyGeneration })
      observerWrite = observerWrite.catch(() => {}).then(async () => {
        const temporary = observerConfig + '.' + randomUUID() + '.tmp'
        await writeFile(temporary, snapshot, { mode: 0o600 })
        await rename(temporary, observerConfig)
      })
      return observerWrite
    }
    await saveObserver()
    const bunOptions = (options.bunOptions ? options.bunOptions + ' ' : '') + '--preload=' + nativeQuote(runtime)
    const pluginRoot = join(directory, 'plugin')
    await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true }); await mkdir(join(pluginRoot, 'hooks'))
    await writeFile(join(pluginRoot, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'apack-native-terminal', version: '0.0.1' }), { mode: 0o600 })
    await writeFile(join(pluginRoot, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.ts'] }), { mode: 0o600 })
    const plugin = `async function send($,path,body){const response=await $.http.fetch('http://apack'+path,{method:'POST',socketPath:${JSON.stringify(socketPath)},headers:{'x-apack-native-token':${JSON.stringify(token)},'content-type':'application/json'},body:JSON.stringify({sessionId:await $.session.id(),...body})});if(!response.ok)throw Error('Owned terminal broker refused');return JSON.parse(response.text);}
    export function register(on) {
      let started=false,inFlight=false,submission,backgroundLease,backgroundPid,backgroundSequence=0,backgroundTick=0,backgroundAttempted=false;const paths={};
      on('classic.*',async($,e,next)=>{const result=await next(e);if(e.transcript_path&&e.session_id&&e.transcript_path.endsWith('/'+e.session_id+'.jsonl')){paths[e.session_id]=e.transcript_path;await send($,'/transcript',{sessionId:e.session_id,path:e.transcript_path}).catch(()=>{});}return result;});
      on('session.append',async($,e,next)=>{const sessionId=await $.session.id();const result=await next(e);if(!e.agentId&&result.message&&result.uuid)await send($,'/append',{sessionId,uuid:result.uuid,message:result.message,door:e.door,origin:e.origin,...(submission&&e.door==='prompt'?{submissionId:submission.id}:{})}).catch(()=>{});return result;});
      on('prompt.submit',async($,e,next)=>{const own=submission;try{const result=await next(e);if(own)await send($,'/submission',{id:own.id,...(typeof result.drop==='string'?{drop:result.drop}:{accepted:true})}).catch(()=>{});return result;}finally{if(submission===own)submission=undefined;}});
      on('session.start',async($,e,next)=>{try{await send($,'/ui-ready',{});}catch{}if(!started){started=true;$.clock.every(250,()=>{if(inFlight)return;inFlight=true;(async()=>{const agents=(await $.agent.list()).map(agent=>({id:agent.id,type:agent.type,status:agent.status}));const usage=await $.session.usage();const metadata={cwd:await $.session.cwd(),model:await $.session.model(),turns:await $.session.turns(),startedAt:usage.startedAt,...(usage.cost?{totalCostUsd:usage.cost.usd}:{})};if(backgroundLease){if(backgroundTick++%4!==0)return;await send($,'/background-status',{pid:backgroundPid,token:backgroundLease,sequence:++backgroundSequence,metadata,usage});return;}const settings=await $.settings.read();const policy=await $.settings.read({source:'policy'});const helpers=(policy.allowManagedHooksOnly||settings.disableAllHooks&&!policy.disableAllHooks)?policy:settings;const main=policy.disableAllHooks?null:helpers.statusLine;const sub=policy.disableAllHooks?null:helpers.subagentStatusLine;const statusCommand=main?.type==='command'&&typeof main.command==='string'?main.command:null;const subagentCommand=sub?.type==='command'&&typeof sub.command==='string'?sub.command:null;const shellPrefix=await $.env.get('CLAUDE_CODE_SHELL_PREFIX')??null;const command=await send($,'/poll',{agents,metadata,statusCommand,subagentCommand,shellPrefix,policy:{allowManagedHooksOnly:policy.allowManagedHooksOnly===true,disableAllHooks:policy.disableAllHooks===true},hooksDisabled:settings.disableAllHooks===true});const sessionId=await $.session.id();if(paths[sessionId])await send($,'/transcript',{sessionId,path:paths[sessionId]});if(command.background===true){if(backgroundAttempted)return;backgroundAttempted=true;const host=await $.process.run(['/bin/sh','-c','printf "%s" "$PPID"'],{timeoutMs:3000});if(host.exitCode!==0)throw Error('Original background identity helper refused');const pid=Number(host.stdout.trim());const registered=await send($,'/background-register',{pid});backgroundPid=pid;backgroundLease=registered.token;return;}if(!command.id)return;submission={id:command.id};let filled=command.prepared===true;try{if(!filled){const before=await $.prompt.read();if(!before.text){const result=await $.prompt.fill({text:command.text,mode:'replace'});filled=result.isFilled===true&&(await $.prompt.read()).text===command.text;}}}catch{}if(!filled)submission=undefined;await send($,'/result',{id:command.id,filled});})().catch(()=>{}).finally(()=>{inFlight=false;});});}return next(e);});
      on('turn.start',async($,e,next)=>{if(!e.agentId)await send($,'/turn',{running:true}).catch(()=>{});return next(e);});
      on('turn.complete',async($,e,next)=>{const result=await next(e);if(!e.agentId)await send($,'/turn',{running:false,turnId:e.turnId,reason:e.reason}).catch(()=>{});return result;});
    }`
    await writeFile(join(pluginRoot, 'hooks/register.ts'), plugin, { mode: 0o600 })
    return {
      directory, pluginRoot, bunOptions, projection, session, transcripts, uiTransport: ui.transport,
      get backgroundInfo() { return background.value },
      get problem() { return observerProblem },
      get nativePid() { return observerPid },
      get view() { return nativeView },
      get lastTurn() { return lastTurn },
      get ready() { return ready && !closed },
      get focus() { return focus },
      get billing() { return closed ? undefined : billing.value },
      get preview() { return closed ? undefined : preview },
      get activity() { return activity },
      get busy() { return busy || !!pending },
      submit(text: string, images: readonly ClaudeNativeImage[] = []): Promise<ClaudeNativeSubmissionReceipt> {
        if (closed || !ready || pending || busy || !text.trim() && !images.length || text.length > 32768) return Promise.reject(new Error('Native terminal cannot accept this draft now'))
        if (images.some(image => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mediaType) || !image.data || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))) return Promise.reject(new Error('Native image content is invalid'))
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => settle(new Error('Native prompt bridge timed out')), images.length ? 30000 : 5000); timer.unref()
          pending = { id: randomUUID(), sessionId: projection.sessionId, text, images: images.map(image => ({ ...image })), sent: false, timer, resolve, reject }
        })
      },
      async close() {
        if (closed) return
        closed = true; background.close(); busy = false; focus = undefined; activity = undefined; nativeView = undefined; ui.close(); settle(new Error('Native terminal closed')); projection.clear()
        waiting.length = 0; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    ui.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true }); throw error
  }
}
