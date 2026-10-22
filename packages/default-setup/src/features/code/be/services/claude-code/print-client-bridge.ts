import { pathToFileURL } from 'node:url'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { request as httpRequest, type ClientRequest } from 'node:http'
import { isClaudeNativeDescendant } from './native-process-ownership.ts'
import { createClaudePrintClientRuntime } from './print-client-runtime.ts'
import type { ClaudePromptHostFill } from './ui-prompt-host.ts'
import type { ClaudeUiRender, ClaudeUiRenderResult, ClaudeUiPress, ClaudeUiInput, ClaudeUiSelect, ClaudeUiClientInput } from './ui-controls.ts'

export interface ClaudePrintClientProjection {
  prepareRender?(request: ClaudeUiRender): Promise<void>
  project(request: ClaudeUiRender, frame: ClaudeUiRenderResult): Promise<ClaudeUiRenderResult>
  action(request: (ClaudeUiPress | ClaudeUiInput | ClaudeUiSelect) & { subtype: string }): Promise<unknown | undefined>
  event(request: { client_id: string; id: string; sequence: number; event: ClaudeUiClientInput }): Promise<unknown>
  release(request: { client_id: string; component: string; instance_id: string; instance_revision: number }): Promise<{ released: boolean }>
  detach(clientId: string): Promise<void>
  prompt?(clientId: string, decorations: NonNullable<ClaudePromptHostFill['decorations']>): Promise<NonNullable<ClaudePromptHostFill['decorations']>>
}
const hasClient = (tree: unknown): boolean => {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false
  const node = tree as { type?: unknown; children?: unknown[] }
  return node.type === 'Client' || Array.isArray(node.children) && node.children.some(hasClient)
}

/** Per-print-process Client channel. Public render admission completes before any projection. */
export async function prepareClaudePrintClients(options: { bunOptions?: string; currentPid(): number | undefined }) {
  const directory = await mkdtemp(join(tmpdir(), 'cc-print-clients-'))
  const config = { socketPath: join(directory, 'clients.sock'), token: randomBytes(32).toString('hex'), epoch: randomUUID(), originalBunOptions: options.bunOptions }
  const preload = join(directory, 'clients.mjs')
  await writeFile(preload, createClaudePrintClientRuntime(config), { mode: 0o600 })
  let closed = false, sequence = 0, nativePid: number | undefined, handshake: Promise<void> | undefined
  const pending = new Set<ClientRequest>(), scopes = new Map<string, { clientId: string; clients: boolean }>()
  const keyOf = (request: { client_id: string; component: string; instance_id: string }) => JSON.stringify([request.client_id, request.component, request.instance_id])
  async function send(operation: string, value: unknown, frame?: ClaudeUiRenderResult): Promise<unknown> {
    const launcherPid = options.currentPid(), ownerPid = nativePid ?? launcherPid
    if (closed || !ownerPid) throw Error('Print Client owner is unavailable')
    if (pending.size >= 64) throw Error('Print Client request limit reached')
    const id = randomUUID(), body = JSON.stringify({ id, ownerPid, epoch: config.epoch, sequence: ++sequence, operation, value, ...(frame ? { frame } : {}) })
    if (Buffer.byteLength(body) > 2 * 1048576) throw Error('Print Client request exceeds limit')
    return new Promise((resolve, reject) => {
      const call = httpRequest({ socketPath: config.socketPath, path: '/clients', method: 'POST', headers: { 'content-type': 'application/json', 'x-apack-native-token': config.token } }, response => {
        const chunks: Buffer[] = []; let bytes = 0
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1048576) response.destroy(Error('Print Client response exceeds limit')); else chunks.push(chunk) })
        response.on('error', reject)
        response.on('end', async () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString()) as { id?: unknown; pid?: unknown; epoch?: unknown; result?: unknown; error?: unknown }
            if (closed || options.currentPid() !== launcherPid || result.id !== id || result.epoch !== config.epoch) throw Error('Print Client reply outlived its owner')
            if (operation === 'hello') {
              if (typeof result.pid !== 'number' || !await isClaudeNativeDescendant(result.pid, launcherPid) || closed || options.currentPid() !== launcherPid) throw Error('Print Client process is outside the owned launcher')
              nativePid = result.pid
            } else if (result.pid !== nativePid) throw Error('Print Client reply came from another process')
            if (response.statusCode !== 200) throw Error(typeof result.error === 'string' ? result.error : 'Print Client request failed')
            resolve(result.result)
          } catch (error) { reject(error) }
        })
      })
      pending.add(call); call.once('close', () => pending.delete(call)); call.on('error', reject)
      call.setTimeout(5000, () => call.destroy(Error('Print Client request timed out')))
      call.end(body)
    })
  }
  async function request(operation: string, value: unknown, frame?: ClaudeUiRenderResult) {
    await (handshake ??= send('hello', {}).then(() => {}).catch(error => { handshake = undefined; nativePid = undefined; throw error }))
    return send(operation, value, frame)
  }
  const projection: ClaudePrintClientProjection = {
    async prepareRender(value) { await request('prepare-render', value) },
    async project(value, frame) {
      const key = keyOf(value), clients = hasClient(frame.tree)
      scopes.set(key, { clientId: value.client_id, clients })
      const projected = await request('project', value, frame) as ClaudeUiRenderResult
      return projected
    },
    action(value) { return [...scopes.values()].some(scope => scope.clientId === value.client_id && scope.clients) ? request('action', value) : Promise.resolve(undefined) },
    event(value) { return [...scopes.values()].some(scope => scope.clientId === value.client_id && scope.clients) ? request('event', value) : Promise.resolve({ handled: false }) },
    async release(value) { const key = keyOf(value); if (!scopes.has(key)) return { released: false }; const result = await request('release', value) as { released: boolean }; if (result.released) scopes.delete(key); return result },
    async prompt(clientId, decorations) { return await request('decorations', { client_id: clientId, decorations }) as NonNullable<ClaudePromptHostFill['decorations']> },
    async detach(clientId) { const keys = [...scopes].filter(([, scope]) => scope.clientId === clientId).map(([key]) => key); if (!keys.length) return; for (const key of keys) scopes.delete(key); await request('detach', { client_id: clientId }) },
  }
  return {
    projection,
    bunOptions: [options.bunOptions, '--preload=' + pathToFileURL(preload).href].filter(Boolean).join(' '),
    async close() { if (closed) return; closed = true; scopes.clear(); for (const call of pending) call.destroy(Error('Print Client owner closed')); await rm(directory, { recursive: true, force: true }) },
  }
}
