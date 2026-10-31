import {claimClaudeBackgroundCheckpoint, type ClaudeBackgroundCheckpoint} from './background-observer-checkpoint.ts'
import {createClaudeBackgroundFormatter, installClaudeBackgroundFormatterLauncher} from './background-formatter.ts'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, rm, lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClaudeBackgroundStatus } from './terminal-background-status.ts'
import type { createClaudeBackgroundStatusAuthority } from './background-status-authority.ts'

/** The linked child owns this transport and plugin directory after the parent writer exits. */
export async function createClaudeBackgroundStatusObserver(options: {
  parentSessionId: string
  profile?: string
  checkpoint?: ClaudeBackgroundCheckpoint
  target(): { sessionId: string; cwd: string } | undefined
  authority(parentSessionId: string): ReturnType<typeof createClaudeBackgroundStatusAuthority>
  changed(): void
}) {
  const directory = options.checkpoint?.directory ?? await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'cc-child-'))
  const socketPath = join(directory, 'status.sock'), token = options.checkpoint?.token ?? randomBytes(32).toString('hex')
  let checkpoint = options.checkpoint
  try { if (!checkpoint && options.profile) checkpoint = await claimClaudeBackgroundCheckpoint({profile:options.profile,parentSessionId:options.parentSessionId,endpoint:{directory,token}}) }
  catch (error) { await rm(directory,{recursive:true,force:true});throw error }
  const listeners = new Set<() => void>()
  let target = options.target, parentChanged = options.changed
  let parentSessionId = options.parentSessionId
  let authority = options.authority(parentSessionId), closed = false, released = false, checking = false, releaseTimer: ReturnType<typeof setTimeout> | undefined
  let monitor: ReturnType<typeof setInterval> | undefined, closing: Promise<void> | undefined
  let statusUpdates = 0
  const changed = (force = false): void => { if (!force && statusUpdates && status.value) return; parentChanged(); for (const listener of listeners) { try { listener() } catch { /* Isolate windows. */ } } }
  const status = createClaudeBackgroundStatus({
    async identify(sessionId, pid) {
      const currentTarget = target()
      if (closed || !currentTarget || currentTarget.sessionId !== sessionId || sessionId === parentSessionId) throw new Error('Background session is not linked to this parent')
      const value = await authority.identify(sessionId, pid, currentTarget.cwd)
      if (closed || target()?.sessionId !== sessionId || value.sessionId !== sessionId || value.pid !== pid || value.cwd !== currentTarget.cwd
        || target()?.cwd !== currentTarget.cwd || !/^[a-f0-9]{8}$/.test(value.jobId) || typeof value.start !== 'string' || !value.start || typeof value.hostStart !== 'string' || !value.hostStart || !Number.isSafeInteger(value.hostPid) || value.hostPid <= 1) throw new Error('Background status identity changed')
      return value
    },
    changed,
  })
  let formatter: ReturnType<typeof createClaudeBackgroundFormatter> | undefined
  let launcher: Promise<string> | undefined
  let formatterRegistration = -1, formatterSequence = -1
  const server = createServer(async (request, response) => {
    const reply = (code: number, value: unknown) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) } }
    try {
      if (closed || request.method !== 'POST' || request.headers['x-apack-native-token'] !== token) return reply(403, {})
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) { bytes += chunk.length; if (bytes > (request.url === '/background-formatter' ? 262144 : 65536)) return reply(413, {}); chunks.push(Buffer.from(chunk)) }
      if (closed) return reply(409, {})
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, {})
      if (request.url === '/background-register') {
        const lease = await status.register(value.sessionId, value.pid)
        formatter?.reset(); changed(true)
        if (releaseTimer) clearTimeout(releaseTimer); releaseTimer = undefined
        reply(200, lease); return
      }
      if (request.url === '/background-status') {
        statusUpdates++
        try {
          await status.accept(value)
          const registration = status.registration, sequence = status.sequence
          if (value.formatter && !formatter) {
            launcher ??= installClaudeBackgroundFormatterLauncher()
            const path = await launcher
            if (closed || registration !== status.registration || sequence !== status.sequence) return reply(409, {})
            formatter ??= createClaudeBackgroundFormatter({launcher: path, socketPath, brokerToken: token, changed})
          }
          const result = formatter?.configure(value)
          formatterRegistration = status.registration; formatterSequence = status.sequence
          changed(); reply(200, result ?? {}); return
        } finally { statusUpdates--; changed() }
      }
      if (request.url === '/background-formatter') {
        const identity = status.identity, registration = status.registration
        if (!identity || !status.value || !formatter?.matches(value)) return reply(409, {})
        const fresh = await authority.identify(identity.sessionId, identity.pid, identity.cwd)
        if (closed || registration !== status.registration || JSON.stringify(fresh) !== JSON.stringify(identity) || !status.value || !formatter?.matches(value)) return reply(409, {})
        formatter!.accept(value); reply(200, {}); return
      }
      reply(404, {})
    } catch { reply(409, {}) }
  })
  const close = () => closing ??= (async () => {
    closed = true; if (releaseTimer) clearTimeout(releaseTimer); if (monitor) clearInterval(monitor)
    status.close(); formatter?.reset(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await authority.close(); await checkpoint?.retire(); await rm(directory, { recursive: true, force: true }); changed(); listeners.clear()
  })()
  async function checkReleasedChild() {
    const identity = status.identity, registration = status.registration
    if (closed || checking || !identity) return
    checking = true
    const current = authority
    try {
      const fresh = await current.identify(identity.sessionId, identity.pid, identity.cwd)
      if (JSON.stringify(fresh) !== JSON.stringify(identity)) throw new Error('Background status worker replaced')
    } catch {
      if (!closed && status.registration === registration && authority === current) {
        // Retire the process lease, retaining the small listener/plugin for a later original restart.
        status.reset(); formatter?.reset(); const retiring = current.close(); authority = options.authority(parentSessionId); await retiring
      }
    } finally { checking = false }
  }
  try {
    if (options.checkpoint) {
      const prior = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (prior) { if (!prior.isSocket() || prior.uid !== process.getuid?.()) throw Error('Background checkpoint socket is not owned'); await unlink(socketPath) }
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  }
  catch (error) { await close(); throw error }
  return {
    directory, socketPath, token,
    get parentSessionId() { return parentSessionId },
    get value() { const value = status.value; return value && formatterRegistration === status.registration && formatterSequence === status.sequence && formatter?.value !== undefined ? {...value, statusLine: formatter?.value} : value },
    get available() { return !closed },
    async resetParent(sessionId: string) {
      if (closed || sessionId === parentSessionId) return
      await checkpoint?.retire()
      checkpoint = options.profile ? await claimClaudeBackgroundCheckpoint({profile:options.profile,parentSessionId:sessionId,endpoint:{directory,token}}) : undefined
      parentSessionId = sessionId; status.reset(); formatter?.reset()
      const retiring = authority.close(); authority = options.authority(parentSessionId); await retiring
    },
    adoptParent(nextTarget: typeof options.target, changed: () => void) {
      if (closed) throw new Error('Background status observer closed')
      const retained = target()
      target = () => nextTarget() ?? retained
      parentChanged = changed; released = false
      if (releaseTimer) clearTimeout(releaseTimer); releaseTimer = undefined
      if (monitor) clearInterval(monitor); monitor = undefined
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async releaseParent() {
      if (released || closed) return
      released = true
      if (!target()) { await close(); return }
      monitor = setInterval(() => { void checkReleasedChild() }, 5000); monitor.unref()
      if (!status.identity) { releaseTimer = setTimeout(() => { if (!status.identity) void close() }, 30000); releaseTimer.unref() }
    },
    close,
  }
}
export type ClaudeBackgroundStatusObserver = Awaited<ReturnType<typeof createClaudeBackgroundStatusObserver>>
