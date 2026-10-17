import { createClaudePromptHosts, type ClaudePromptHost } from './ui-prompt-host.ts'
import { request as httpRequest, type ClientRequest } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface ClaudeTerminalUiTransport {
  readonly promptHosts: Pick<ReturnType<typeof createClaudePromptHosts>, 'register' | 'answers' | 'detach'>
  request(value: Record<string, unknown> & { subtype: string }): Promise<unknown>
  subscribe(listener: (event: Record<string, unknown>) => void): () => void
}

/** Private native-owner RPC; a response cannot outlive the process/session that issued it. */
export function createClaudeTerminalUiTransport(options: {
  socketPath: string
  token: string
  current(): { pid: number; sessionId: string } | undefined
}) {
  let closed = false, sequence = 0
  const pending = new Set<ClientRequest>(), listeners = new Set<(event: Record<string, unknown>) => void>()
  const hosts = new Map<string, ClaudePromptHost>(), hostRequests = new Map<string, { clientId: string; cancel(): void }>(), hostSequences = new Set<number>()
  let highestHostSequence = 0
  const promptHosts: ClaudeTerminalUiTransport['promptHosts'] = {
    register(id, host) {
      if (closed || !/^[A-Za-z0-9._-]{1,64}$/.test(id) || hosts.has(id)) throw new Error('Native composer host is unavailable or already registered')
      hosts.set(id, host)
      return () => { if (hosts.get(id) === host) promptHosts.detach(id) }
    },
    answers(id) { const host = hosts.get(id); return host ? ['ui_prompt_read', 'ui_prompt_fill', ...(host.suggest ? ['ui_prompt_suggest'] : [])] : [] },
    detach(id) { hosts.delete(id); for (const pending of [...hostRequests.values()]) if (pending.clientId === id) pending.cancel() },
  }
  const transport: ClaudeTerminalUiTransport = {
    promptHosts,
    request(value) {
      const owner = options.current()
      if (closed || !owner) return Promise.reject(new Error('Native UI owner is unavailable'))
      if (pending.size >= 64) return Promise.reject(new Error('Native UI request limit reached'))
      if (value.subtype === 'ui_detach' && typeof value.client_id === 'string') promptHosts.detach(value.client_id)
      if (value.subtype === 'ui_attach' && typeof value.client_id === 'string') value = { ...value, answers: promptHosts.answers(value.client_id) }
      const id = randomUUID(), body = JSON.stringify({ id, sequence: ++sequence, ownerPid: owner.pid, sessionId: owner.sessionId, request: value })
      if (Buffer.byteLength(body) > 1048576) return Promise.reject(new Error('Native UI request exceeds its size limit'))
      return new Promise((resolve, reject) => {
        const request = httpRequest({ socketPath: options.socketPath, path: '/control', method: 'POST',
          headers: { 'content-type': 'application/json', 'x-apack-native-token': options.token } }, response => {
          let bytes = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 2 * 1048576) response.destroy(new Error('Native UI response exceeds its size limit'))
            else chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            try {
              const current = options.current()
              if (closed || current?.pid !== owner.pid || current.sessionId !== owner.sessionId) throw new Error('Native UI owner changed before its reply')
              const result = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
              if (result.id !== id || result.pid !== owner.pid || result.sessionId !== owner.sessionId) throw new Error('Native UI reply identity does not match its owner')
              if (response.statusCode !== 200) throw new Error(typeof result.error === 'string' ? result.error : 'Native UI request was refused')
              resolve(result.result)
            } catch (error) { reject(error) }
          })
        })
        pending.add(request)
        request.setTimeout(5000, () => request.destroy(new Error('Native UI request timed out')))
        request.on('error', reject); request.once('close', () => pending.delete(request))
        request.end(body)
      })
    },
    subscribe(listener) { if (closed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    transport,
    get hasPromptHosts() { return hosts.size > 0 },
    /** Reuse prompt validation/deadlines per ask; the outer sequence window supplies replay protection. */
    receiveHost(value: Record<string, unknown>, complete: (result: unknown, current: boolean) => void): boolean {
      const owner = options.current(), request = value.request as Record<string, unknown> | undefined
      if (closed || !owner || value.pid !== owner.pid || value.sessionId !== owner.sessionId || typeof value.request_id !== 'string'
        || !/^[a-f0-9-]{36}$/i.test(value.request_id) || hostRequests.has(value.request_id) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
        || hostSequences.has(value.sequence as number) || (value.sequence as number) <= highestHostSequence - 4096
        || hostRequests.size >= 128 || !request || typeof request !== 'object' || Array.isArray(request)
        || !['ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'].includes(String(request.subtype)) || typeof request.client_id !== 'string') return false
      const id = value.request_id, sequence = value.sequence as number
      highestHostSequence = Math.max(highestHostSequence, sequence); hostSequences.add(sequence)
      for (const prior of hostSequences) if (prior <= highestHostSequence - 4096) hostSequences.delete(prior)
      const manager = createClaudePromptHosts(line => {
        const result = line as { response?: { request_id?: string; response?: unknown } }
        if (result.response?.request_id !== id || !hostRequests.delete(id)) return false
        manager.close()
        const current = options.current()
        complete(result.response.response, !closed && current?.pid === owner.pid && current.sessionId === owner.sessionId)
        return true
      })
      const host = hosts.get(request.client_id)
      if (host) manager.register(request.client_id, host)
      hostRequests.set(id, { clientId: request.client_id, cancel() { manager.close(); if (hostRequests.delete(id)) complete(undefined, false) } })
      manager.receive({ type: 'control_request', request_id: id, request: { ...request, subtype: String(request.subtype) } })
      return true
    },
    cancelHost(id: string) { hostRequests.get(id)?.cancel() },
    receive(event: Record<string, unknown>) { if (!closed) for (const listener of listeners) { try { listener(event) } catch { /* isolate mounted views */ } } },
    close() { closed = true; hosts.clear(); for (const pending of [...hostRequests.values()]) pending.cancel(); listeners.clear(); for (const request of pending) request.destroy(new Error('Native UI owner closed')); pending.clear() },
  }
}
