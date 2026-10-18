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
  const transcripts: ClaudeNativeTranscript[] = []
  let nativeViewSequence = 0
  let nativeView: import('../../../common/native-terminal.ts').ClaudeNativeTerminalView | undefined
  let observerPid: number | undefined, observerProblem: string | undefined
  let mainCommand = command(options.settings.effective.statusLine) ?? null
  let subagentCommand = command(options.settings.effective.subagentStatusLine) ?? null
  let shellPrefix: string | null = null
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
  let closed = false, busy = false, ready = false
  const ui = createClaudeTerminalUiTransport({ socketPath: uiSocketPath, token, current: () => !closed && observerPid ? { pid: observerPid, sessionId: projection.sessionId } : undefined })
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
      for await (const chunk of request) { bytes += chunk.length; if (bytes > (request.url === '/append' ? 8 * 1024 * 1024 + 65536 : request.url === '/native-status' || request.url === '/ui-host' ? 1048576 + 65536 : 65536)) return reply(413, {}); chunks.push(chunk) }
      const value = object(JSON.parse(Buffer.concat(chunks).toString()))
      if (!value || typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.sessionId)) return reply(400, {})
      if (request.url === '/observer-ready') {
        if (value.sessionId !== options.sessionId || !Number.isSafeInteger(value.pid) || (value.pid as number) < 2 || (observerPid !== undefined && observerPid !== value.pid) || !await options.ownsProcess?.(value.pid as number)) return reply(409, {})
        observerPid = value.pid as number; observerProblem = undefined; options.changed(); return reply(200, {})
      }
      if (request.url === '/observer-error') {
        if (typeof value.message !== 'string') return reply(400, {})
        observerProblem = value.message.slice(0, 1000); projection.clearOutput(); options.changed(); return reply(200, {})
      }
      if (request.url === '/agent-enter') {
        if (value.sessionId !== projection.sessionId || value.pid !== observerPid || pending || nativeView?.kind !== 'agent' || nativeView.taskId !== value.taskId || nativeView.revision !== value.revision) return reply(409, {})
        options.enter(); return reply(200, { entered: true })
      }
      if (request.url === '/owner-pending') return value.sessionId === projection.sessionId ? reply(200, { pending: !!pending, ...(pending?.entered ? { id: pending.id } : {}) }) : reply(409, {})
      if (request.url === '/poll') {
        if (value.directOwner === true && (typeof value.busy !== 'boolean' || value.turn !== null && (!object(value.turn) || typeof object(value.turn)?.id !== 'string' || typeof object(value.turn)?.cancelled !== 'boolean'))) return reply(400, {})
        if (value.metadata !== undefined && !parseClaudeTerminalMetadata(value.metadata)) return reply(400, {})
        for (const key of ['statusCommand', 'subagentCommand', 'shellPrefix']) if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || (value[key] as string).length > 32768)) return reply(400, {})
        const changedSession = projection.sessionId !== value.sessionId
        if (!projection.updateSession(value.sessionId, value.agents)) return reply(400, {})
        if (value.directOwner === true) busy = value.busy as boolean
        const previous = { ...generations }
        const mainChanged = changedSession || value.statusCommand !== undefined && mainCommand !== value.statusCommand || value.shellPrefix !== undefined && shellPrefix !== value.shellPrefix
        const subChanged = changedSession || value.subagentCommand !== undefined && subagentCommand !== value.subagentCommand || value.shellPrefix !== undefined && shellPrefix !== value.shellPrefix
        if (value.statusCommand !== undefined) mainCommand = value.statusCommand as string | null
        if (value.subagentCommand !== undefined) subagentCommand = value.subagentCommand as string | null
        if (value.shellPrefix !== undefined) shellPrefix = value.shellPrefix as string | null
        if (mainChanged) { generations.main = randomUUID(); projection.clearMain() }
        if (subChanged) { generations.subagent = randomUUID(); projection.clearDecorations() }
        if (mainChanged || subChanged) await saveObserver?.()
        for (const event of waiting.splice(0)) {
          const kind = event.kind as 'main' | 'subagent'
          if (event.sessionId === projection.sessionId && event.parentPid === observerPid && event.generation === previous[kind] && matches(event)) projection.accept(event)
        }
        if (changedSession) { nativeView = undefined; session.reset(value.sessionId); lastTurn = undefined; busy = false; settle(new Error('Native session changed before submission completed')) }
        if (value.metadata !== undefined) {
          session.update(value.metadata)
          // Native dialogs and terminal shortcuts can change mode without a host command.
          if (object(value.metadata)?.permissionMode === undefined) {
            const sessionId = projection.sessionId
            try {
              const result = object(await ui.transport.request({ subtype: 'apack_get_permission_mode' }))
              const mode = PermissionModeSchema.safeParse(result?.mode)
              if (mode.success && session.metadata && projection.sessionId === sessionId) session.update({ ...session.metadata, permissionMode: mode.data })
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
        if (JSON.stringify(next) !== JSON.stringify(nativeView)) { nativeView = next; options.changed() }
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
        const panes = event.subtype === 'ui_panes' && Array.isArray(event.panes) && event.panes.length <= 256
          && event.panes.every(value => { const pane = object(value); return pane && typeof pane.id === 'string' && typeof pane.plugin === 'string' && typeof pane.title === 'string' })
          && [event.shown_id, event.focused_id, event.focus_requested_id].every(id => id === null || typeof id === 'string')
        const site = typeof event.client_id === 'string' && ['Pane', 'AbovePrompt'].includes(String(event.component)) && typeof event.instance_id === 'string'
        const scroll = site && event.subtype === 'ui_scroll' && Number.isSafeInteger(event.offset) && Number(event.offset) >= 0
        const focus = site && event.subtype === 'ui_focus' && typeof event.plugin === 'string' && typeof event.key === 'string'
        const notice = ['ui_status', 'ui_toast'].includes(String(event.subtype)) && event.session_id === projection.sessionId
          && typeof event.uuid === 'string' && event.uuid.length > 0 && event.uuid.length <= 128 && typeof event.plugin === 'string' && event.plugin.length > 0 && event.plugin.length <= 256
          && (typeof event.text === 'string' && event.text.length <= 10001 || event.subtype === 'ui_status' && event.text === null)
          && (event.subtype !== 'ui_toast' || Number.isSafeInteger(event.timeout_ms) && Number(event.timeout_ms) >= 0)
        if (!invalidation && !panes && !scroll && !focus && !notice) return reply(409, {})
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
        if (!matches(value)) { waiting.push(value); if (waiting.length > 16) waiting.shift(); return reply(202, {}) }
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
    saveObserver = async () => {
      const temporary = observerConfig + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, JSON.stringify({ socketPath, uiSocketPath, token, sessionId: projection.sessionId, originalBunOptions: options.bunOptions, generations }), { mode: 0o600 })
      await rename(temporary, observerConfig)
    }
    await saveObserver()
    const bunOptions = (options.bunOptions ? options.bunOptions + ' ' : '') + '--preload=' + nativeQuote(runtime)
    const pluginRoot = join(directory, 'plugin')
    await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true }); await mkdir(join(pluginRoot, 'hooks'))
    await writeFile(join(pluginRoot, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'apack-native-terminal', version: '0.0.1' }), { mode: 0o600 })
    await writeFile(join(pluginRoot, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.ts'] }), { mode: 0o600 })
    const plugin = `async function send($,path,body){const response=await $.http.fetch('http://apack'+path,{method:'POST',socketPath:${JSON.stringify(socketPath)},headers:{'x-apack-native-token':${JSON.stringify(token)},'content-type':'application/json'},body:JSON.stringify({sessionId:await $.session.id(),...body})});if(!response.ok)throw Error('Owned terminal broker refused');return JSON.parse(response.text);}
    export function register(on) {
      let started=false,inFlight=false,submission;const paths={};
      on('classic.*',async($,e,next)=>{const result=await next(e);if(e.transcript_path&&e.session_id&&e.transcript_path.endsWith('/'+e.session_id+'.jsonl')){paths[e.session_id]=e.transcript_path;await send($,'/transcript',{sessionId:e.session_id,path:e.transcript_path}).catch(()=>{});}return result;});
      on('session.append',async($,e,next)=>{const sessionId=await $.session.id();const result=await next(e);if(!e.agentId&&result.message&&result.uuid)await send($,'/append',{sessionId,uuid:result.uuid,message:result.message,door:e.door,origin:e.origin,...(submission&&e.door==='prompt'?{submissionId:submission.id}:{})}).catch(()=>{});return result;});
      on('prompt.submit',async($,e,next)=>{const own=submission;try{const result=await next(e);if(own)await send($,'/submission',{id:own.id,...(typeof result.drop==='string'?{drop:result.drop}:{accepted:true})}).catch(()=>{});return result;}finally{if(submission===own)submission=undefined;}});
      on('session.start',async($,e,next)=>{try{await send($,'/ui-ready',{});}catch{}if(!started){started=true;$.clock.every(250,()=>{if(inFlight)return;inFlight=true;(async()=>{const agents=(await $.agent.list()).map(agent=>({id:agent.id,type:agent.type,status:agent.status}));const usage=await $.session.usage();const metadata={cwd:await $.session.cwd(),model:await $.session.model(),turns:await $.session.turns(),startedAt:usage.startedAt,...(usage.cost?{totalCostUsd:usage.cost.usd}:{})};const settings=await $.settings.read();const policy=await $.settings.read({source:'policy'});const helpers=(policy.allowManagedHooksOnly||settings.disableAllHooks&&!policy.disableAllHooks)?policy:settings;const main=policy.disableAllHooks?null:helpers.statusLine;const sub=policy.disableAllHooks?null:helpers.subagentStatusLine;const statusCommand=main?.type==='command'&&typeof main.command==='string'?main.command:null;const subagentCommand=sub?.type==='command'&&typeof sub.command==='string'?sub.command:null;const shellPrefix=await $.env.get('CLAUDE_CODE_SHELL_PREFIX')??null;const command=await send($,'/poll',{agents,metadata,statusCommand,subagentCommand,shellPrefix});const sessionId=await $.session.id();if(paths[sessionId])await send($,'/transcript',{sessionId,path:paths[sessionId]});if(!command.id)return;submission={id:command.id};let filled=command.prepared===true;try{if(!filled){const before=await $.prompt.read();if(!before.text){const result=await $.prompt.fill({text:command.text,mode:'replace'});filled=result.isFilled===true&&(await $.prompt.read()).text===command.text;}}}catch{}if(!filled)submission=undefined;await send($,'/result',{id:command.id,filled});})().catch(()=>{}).finally(()=>{inFlight=false;});});}return next(e);});
      on('turn.start',async($,e,next)=>{if(!e.agentId)await send($,'/turn',{running:true}).catch(()=>{});return next(e);});
      on('turn.complete',async($,e,next)=>{const result=await next(e);if(!e.agentId)await send($,'/turn',{running:false,turnId:e.turnId,reason:e.reason}).catch(()=>{});return result;});
    }`
    await writeFile(join(pluginRoot, 'hooks/register.ts'), plugin, { mode: 0o600 })
    return {
      directory, pluginRoot, bunOptions, projection, session, transcripts, uiTransport: ui.transport,
      get problem() { return observerProblem },
      get nativePid() { return observerPid },
      get view() { return nativeView },
      get lastTurn() { return lastTurn },
      get ready() { return ready && !closed },
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
        closed = true; nativeView = undefined; ui.close(); settle(new Error('Native terminal closed')); projection.clear()
        waiting.length = 0; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    ui.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true }); throw error
  }
}
