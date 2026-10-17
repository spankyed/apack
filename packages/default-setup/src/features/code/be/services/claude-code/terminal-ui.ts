import { request as httpRequest, type ClientRequest } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface ClaudeTerminalUiTransport {
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
  const transport: ClaudeTerminalUiTransport = {
    request(value) {
      const owner = options.current()
      if (closed || !owner) return Promise.reject(new Error('Native UI owner is unavailable'))
      if (pending.size >= 64) return Promise.reject(new Error('Native UI request limit reached'))
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
    receive(event: Record<string, unknown>) { if (!closed) for (const listener of listeners) { try { listener(event) } catch { /* isolate mounted views */ } } },
    close() { closed = true; listeners.clear(); for (const request of pending) request.destroy(new Error('Native UI owner closed')); pending.clear() },
  }
}
