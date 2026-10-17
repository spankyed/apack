import { createClaudeTerminalUiTransport } from './terminal-ui.ts'
import { claudeTerminalUiRuntime } from './terminal-ui-runtime.ts'
import type { ClaudeNativeTerminalState } from '../../../common/native-terminal.ts'
import { basename, isAbsolute } from 'node:path'
import type { ClaudeNativeTranscript } from './terminal-journal.ts'
import { createClaudeTerminalSession, parseClaudeTerminalMetadata, type ClaudeNativeSubmissionReceipt } from './terminal-session.ts'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeTerminalStatus } from './terminal-status.ts'
import { claudeTerminalStatusRuntime } from './terminal-status-runtime.ts'
import type { ClaudeSettings } from './host-controls.ts'

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
  enter(): void
}) {
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'cc-app-'))
  const uiSocketPath = join(directory, 'ui.sock')
  const socketPath = join(directory, 'bridge.sock'), token = randomBytes(32).toString('hex')
  const projection = createClaudeTerminalStatus(options.sessionId)
  const session = createClaudeTerminalSession(options.sessionId)
  const transcripts: ClaudeNativeTranscript[] = []
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
  let pending: { id: string; sessionId: string; text: string; sent: boolean; entered?: boolean; accepted?: ClaudeNativeSubmissionReceipt; timer: ReturnType<typeof setTimeout>; resolve(receipt: ClaudeNativeSubmissionReceipt): void; reject(error: Error): void } | undefined
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
      if (request.url === '/poll') {
        if (value.metadata !== undefined && !parseClaudeTerminalMetadata(value.metadata)) return reply(400, {})
        for (const key of ['statusCommand', 'subagentCommand', 'shellPrefix']) if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || (value[key] as string).length > 32768)) return reply(400, {})
        const changedSession = projection.sessionId !== value.sessionId
        if (!projection.updateSession(value.sessionId, value.agents)) return reply(400, {})
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
        if (changedSession) { session.reset(value.sessionId); lastTurn = undefined; busy = false; settle(new Error('Native session changed before submission completed')) }
        if (value.metadata !== undefined) session.update(value.metadata)
        if (!observerPid && (mainCommand || subagentCommand) && !observerProblem) observerProblem = 'Native helper output could not be observed in this terminal'
        ready = true; options.changed()
        if (pending && !pending.sent && pending.sessionId === projection.sessionId) {
          const submission = pending; submission.sent = true
          if (ui.hasPromptHosts) {
            try {
              const result = object(await ui.transport.request({ subtype: 'apack_prepare_prompt', text: submission.text }))
              if (pending !== submission || submission.sessionId !== projection.sessionId) return reply(200, {})
              if (result?.filled !== true) { settle(new Error('Native terminal draft could not be prepared; the app draft was retained')); return reply(200, {}) }
              return reply(200, { id: submission.id, text: submission.text, prepared: true })
            } catch (error) { if (pending === submission) settle(error instanceof Error ? error : new Error('Native terminal draft could not be prepared')); return reply(200, {}) }
          }
          return reply(200, { id: submission.id, text: submission.text })
        }
        return reply(200, {})
      }
      if (value.sessionId !== projection.sessionId) return reply(409, {})
      if (request.url === '/ui-host') {
        if (value.pid !== observerPid || !ui.receiveHost(value, (result, current) => reply(current ? 200 : 409, { request_id: value.request_id, pid: observerPid, sessionId: value.sessionId, result }))) return reply(409, {})
        response.once('close', () => ui.cancelHost(String(value.request_id)))
        return
      }
      if (request.url === '/ui-event') {
        const event = object(value.event)
        if (value.pid !== observerPid || !event || event.type !== 'system' || event.subtype !== 'ui_invalidate' || event.event !== 'ui.render') return reply(409, {})
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
      on('session.start',async($,e,next)=>{if(!started){started=true;$.clock.every(250,()=>{if(inFlight)return;inFlight=true;(async()=>{const agents=(await $.agent.list()).map(agent=>({id:agent.id,type:agent.type,status:agent.status}));const usage=await $.session.usage();const metadata={cwd:await $.session.cwd(),model:await $.session.model(),turns:await $.session.turns(),startedAt:usage.startedAt,...(usage.cost?{totalCostUsd:usage.cost.usd}:{})};const settings=await $.settings.read();const policy=await $.settings.read({source:'policy'});const helpers=(policy.allowManagedHooksOnly||settings.disableAllHooks&&!policy.disableAllHooks)?policy:settings;const main=policy.disableAllHooks?null:helpers.statusLine;const sub=policy.disableAllHooks?null:helpers.subagentStatusLine;const statusCommand=main?.type==='command'&&typeof main.command==='string'?main.command:null;const subagentCommand=sub?.type==='command'&&typeof sub.command==='string'?sub.command:null;const shellPrefix=await $.env.get('CLAUDE_CODE_SHELL_PREFIX')??null;const command=await send($,'/poll',{agents,metadata,statusCommand,subagentCommand,shellPrefix});const sessionId=await $.session.id();if(paths[sessionId])await send($,'/transcript',{sessionId,path:paths[sessionId]});if(!command.id)return;submission={id:command.id};let filled=command.prepared===true;try{if(!filled){const before=await $.prompt.read();if(!before.text){const result=await $.prompt.fill({text:command.text,mode:'replace'});filled=result.isFilled===true&&(await $.prompt.read()).text===command.text;}}}catch{}if(!filled)submission=undefined;await send($,'/result',{id:command.id,filled});})().catch(()=>{}).finally(()=>{inFlight=false;});});}return next(e);});
      on('turn.start',async($,e,next)=>{if(!e.agentId)await send($,'/turn',{running:true}).catch(()=>{});return next(e);});
      on('turn.complete',async($,e,next)=>{const result=await next(e);if(!e.agentId)await send($,'/turn',{running:false,turnId:e.turnId,reason:e.reason}).catch(()=>{});return result;});
    }`
    await writeFile(join(pluginRoot, 'hooks/register.ts'), plugin, { mode: 0o600 })
    return {
      directory, pluginRoot, bunOptions, projection, session, transcripts, uiTransport: ui.transport,
      get problem() { return observerProblem },
      get nativePid() { return observerPid },
      get lastTurn() { return lastTurn },
      get ready() { return ready && !closed },
      get busy() { return busy || !!pending },
      submit(text: string): Promise<ClaudeNativeSubmissionReceipt> {
        if (closed || !ready || pending || busy || !text.trim() || text.length > 32768) return Promise.reject(new Error('Native terminal cannot accept this draft now'))
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => settle(new Error('Native prompt bridge timed out')), 5000); timer.unref()
          pending = { id: randomUUID(), sessionId: projection.sessionId, text, sent: false, timer, resolve, reject }
        })
      },
      async close() {
        if (closed) return
        closed = true; ui.close(); settle(new Error('Native terminal closed')); projection.clear()
        waiting.length = 0; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    ui.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true }); throw error
  }
}
