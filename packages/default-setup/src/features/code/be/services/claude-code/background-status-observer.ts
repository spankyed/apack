import { prepareClaudeOwnedChildUi } from './owned-profile.ts'
import { createClaudeTerminalUiTransport, type ClaudeTerminalUiTransport } from './terminal-ui.ts'
import { CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES } from './ui-text-limits.ts'
import {claimClaudeBackgroundCheckpoint, type ClaudeBackgroundCheckpoint} from './background-observer-checkpoint.ts'
import {createClaudeBackgroundFormatter, installClaudeBackgroundFormatterLauncher} from './background-formatter.ts'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, rm, lstat, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeBackgroundStatusIdentity } from './terminal-background-status.ts'
import { createClaudeBackgroundStatus } from './terminal-background-status.ts'
import type { createClaudeBackgroundStatusAuthority } from './background-status-authority.ts'

export interface ClaudeBackgroundDesktopOwner {
  readonly id: string
  readonly parentSessionId: string
  readonly identity: Readonly<ClaudeBackgroundStatusIdentity>
  readonly registration: number
  readonly transport: ClaudeTerminalUiTransport
  readonly done: Promise<void>
}

/** The linked child owns this transport and plugin directory after the parent writer exits. */
export async function createClaudeBackgroundStatusObserver(options: {
  parentSessionId: string
  profile?: string
  childUiLaunch?: {configDir?: string; secureStorageConfigDir?: string; executable: string; cwd: string; searchPath: string | undefined}
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
  let childUiPrepared = false
  try { childUiPrepared = !!(options.profile && options.childUiLaunch && await prepareClaudeOwnedChildUi({userDataDir: options.profile, ...options.childUiLaunch, directory, socketPath, token})) }
  catch (error) { if (!options.checkpoint) { await checkpoint?.retire(); await rm(directory, {recursive: true, force: true}) }; throw error }
  const listeners = new Set<() => void>()
  let target = options.target, parentChanged = options.changed
  let parentSessionId = options.parentSessionId
  let authority = options.authority(parentSessionId), closed = false, released = false, checking = false, releaseTimer: ReturnType<typeof setTimeout> | undefined
  let monitor: ReturnType<typeof setInterval> | undefined, closing: Promise<void> | undefined
  let statusUpdates = 0
  const changed = (force = false): void => {
    if (childUi && (childUi.registration !== status.registration || childUi.identity !== JSON.stringify(status.identity))) retireChildUi()
    if (!force && statusUpdates && status.value) return
    parentChanged()
    for (const listener of listeners) { try { listener() } catch { /* Isolate windows. */ } }
  }
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
  let childUi: {registration: number; identity: string; token: string; transport: ClaudeTerminalUiTransport; bridge: ReturnType<typeof createClaudeTerminalUiTransport>; owner: ClaudeBackgroundDesktopOwner; finish(): void} | undefined
  const retireChildUi = () => { const held = childUi; childUi = undefined; held?.bridge.close(); held?.finish() }
  async function childUiCurrent() {
    const held = childUi, identity = status.identity
    if (!held || !identity || closed || held.registration !== status.registration || held.identity !== JSON.stringify(identity)) return
    try {
      const fresh = await authority.identify(identity.sessionId, identity.pid, identity.cwd)
      if (childUi !== held) return
      if (held.registration !== status.registration || held.identity !== JSON.stringify(fresh)) {
        retireChildUi(); changed(true); return
      }
    } catch (error) {
      if (childUi === held) { retireChildUi(); changed(true) }
      throw error
    }
    return held
  }
  const server = createServer(async (request, response) => {
    const reply = (code: number, value: unknown) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) } }
    try {
      const uiRoute = request.url === '/ui-host' || request.url === '/ui-event'
      if (closed || request.method !== 'POST' || (uiRoute ? !childUi || request.headers['x-apack-native-token'] !== childUi.token : request.headers['x-apack-native-token'] !== token)) return reply(403, {})
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) { bytes += chunk.length; if (bytes > (request.url === '/ui-host' ? CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES : request.url === '/background-formatter' ? 262144 : 65536)) return reply(413, {}); chunks.push(Buffer.from(chunk)) }
      if (closed) return reply(409, {})
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, {})
      if (uiRoute) {
        const held = await childUiCurrent()
        if (!held || request.headers['x-apack-native-token'] !== held.token) return reply(409, {})
        if (request.url === '/ui-event') {
          const event = value.event
          if (value.pid !== status.identity?.pid || value.sessionId !== status.identity?.sessionId || !event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'system') return reply(409, {})
          held.bridge.receive(event); return reply(200, {})
        }
        if (!held.bridge.receiveHost(value, (result, current) => { void childUiCurrent().then(fresh => reply(current && fresh === held ? 200 : 409, {request_id: value.request_id, pid: value.pid, sessionId: value.sessionId, result})).catch(() => reply(409, {})) })) return reply(409, {})
        response.once('close', () => held.bridge.cancelHost(String(value.request_id)))
        return
      }
      if (request.url === '/background-register') {
        const lease = await status.register(value.sessionId, value.pid)
        retireChildUi(); formatter?.reset(); changed(true)
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
    retireChildUi(); status.close(); formatter?.reset(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
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
        retireChildUi(); status.reset(); formatter?.reset(); const retiring = current.close(); authority = options.authority(parentSessionId); await retiring
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
    get desktopOwner(): ClaudeBackgroundDesktopOwner | undefined {
      return childUi && !closed && childUi.registration === status.registration && childUi.identity === JSON.stringify(status.identity) ? childUi.owner : undefined
    },
    /** Original identity and a fresh per-worker socket/token scope every desktop attachment. */
    async desktopTransport() {
      const identity = status.identity, registration = status.registration
      if (!childUiPrepared || closed || !identity) return
      const fresh = await authority.identify(identity.sessionId, identity.pid, identity.cwd)
      if (closed || registration !== status.registration || JSON.stringify(fresh) !== JSON.stringify(identity)) throw new Error('Background UI owner changed')
      if (childUi?.registration === registration && childUi.identity === JSON.stringify(identity)) return childUi.transport
      const marker = join(directory, 'worker-' + identity.pid + '.json'), info = await lstat(marker)
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 65536) throw new Error('Unowned background UI startup marker')
      const proof = JSON.parse(await readFile(marker, 'utf8'))
      const workerName = typeof proof.configPath === 'string' ? proof.configPath.split('/').at(-2) : undefined
      if (proof.pid !== identity.pid || proof.start !== identity.start || proof.sessionId !== identity.sessionId || !workerName || !new RegExp('^w-' + identity.pid + '-[A-Za-z0-9]+$').test(workerName) || proof.configPath !== join(directory, 'workers', workerName, 'observer.json')) throw new Error('Background UI startup does not match its original owner')
      for (const path of [join(directory, 'workers'), join(directory, 'workers', workerName)]) {
        const info = await lstat(path)
        if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('Unowned background UI startup directory')
      }
      const configInfo = await lstat(proof.configPath)
      if (!configInfo.isFile() || configInfo.uid !== process.getuid?.() || (configInfo.mode & 0o077) !== 0 || configInfo.size > 65536) throw new Error('Unowned background UI startup config')
      const config = JSON.parse(await readFile(proof.configPath, 'utf8'))
      if (config.sessionId !== identity.sessionId || config.uiSocketPath !== join(proof.configPath.slice(0, -'/observer.json'.length), 'ui.sock') || typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Background UI scope is invalid')
      if (closed || registration !== status.registration || JSON.stringify(status.identity) !== JSON.stringify(identity)) throw new Error('Background UI owner changed')
      retireChildUi()
      const scope = JSON.stringify(identity)
      const bridge = createClaudeTerminalUiTransport({socketPath: config.uiSocketPath, token: config.token,
        current: () => !closed && registration === status.registration && JSON.stringify(status.identity) === scope ? {pid: identity.pid, sessionId: identity.sessionId} : undefined})
      const transport: ClaudeTerminalUiTransport = { ...bridge.transport, async request(value) {
        const held = await childUiCurrent()
        if (held?.bridge !== bridge) throw new Error('Background UI owner changed')
        const result = await bridge.transport.request(value)
        if (await childUiCurrent() !== held) throw new Error('Background UI owner changed before its reply')
        return result
      } }
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      const owner: ClaudeBackgroundDesktopOwner = {id: randomBytes(16).toString('hex'), parentSessionId, identity: Object.freeze({...identity}), registration, transport, done}
      childUi = {registration, identity: scope, token: config.token, bridge, transport, owner, finish}
      return transport
    },
    get parentSessionId() { return parentSessionId },
    get value() { const value = status.value; return value && formatterRegistration === status.registration && formatterSequence === status.sequence && formatter?.value !== undefined ? {...value, statusLine: formatter?.value} : value },
    get available() { return !closed },
    async resetParent(sessionId: string) {
      if (closed || sessionId === parentSessionId) return
      await checkpoint?.retire()
      checkpoint = options.profile ? await claimClaudeBackgroundCheckpoint({profile:options.profile,parentSessionId:sessionId,endpoint:{directory,token}}) : undefined
      retireChildUi(); parentSessionId = sessionId; status.reset(); formatter?.reset()
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
      // The final canonical continuation can arrive after the parent PTY exits.
      // Keep startup files through the existing registration grace; admission still
      // requires that continuation and the original worker identity.
      monitor = setInterval(() => { void checkReleasedChild() }, 5000); monitor.unref()
      if (!status.identity) { releaseTimer = setTimeout(() => { if (!status.identity) void close() }, 30000); releaseTimer.unref() }
    },
    close,
  }
}
export type ClaudeBackgroundStatusObserver = Awaited<ReturnType<typeof createClaudeBackgroundStatusObserver>>
