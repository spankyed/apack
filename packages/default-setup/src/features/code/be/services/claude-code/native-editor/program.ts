import {request} from 'node:http'
import {openClaudeNativeEditorFile} from '../native-editor-file.ts'
import type {ClaudeNativeEditorDecision} from '../native-editor-lease.ts'

export interface ClaudeNativeEditorChildConfig {
  socketPath: string
  token: string
  sessionId: string
  directory: string
  maxBytes: number
}

/** Runs outside Bun: the original CLI waits synchronously until this owned child exits. */
export async function runClaudeNativeEditorChild(config: ClaudeNativeEditorChildConfig, path: string, signal: AbortSignal): Promise<void> {
  if (!config.socketPath.startsWith('/') || !/^[a-f0-9]{64}$/.test(config.token) || !/^[a-f0-9-]{36}$/i.test(config.sessionId) || !Number.isSafeInteger(config.maxBytes) || config.maxBytes < 1 || config.maxBytes > Math.floor((2 ** 31 - 65_536) / 6)) throw new Error('Invalid native editor handoff configuration')
  signal.throwIfAborted()
  const file = openClaudeNativeEditorFile(path, config)
  try {
    const body = JSON.stringify({sessionId: config.sessionId, pid: process.pid, parentPid: process.ppid, fileIdentity: file.fileIdentity, content: file.content})
    const decision = await new Promise<ClaudeNativeEditorDecision>((resolve, reject) => {
      const exchange = request({socketPath: config.socketPath, path: '/native-editor', method: 'POST', signal,
        headers: {'content-type': 'application/json', 'x-apack-native-token': config.token}}, response => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 6 * config.maxBytes + 65_536) response.destroy(new Error('Native editor reply exceeds its admitted limit'))
          else chunks.push(chunk)
        })
        response.once('error', reject)
        response.once('end', () => {
          try {
            if (response.statusCode !== 200) throw new Error('Native editor offer was refused')
            const answer: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('Invalid native editor decision')
            const value = answer as Record<string, unknown>
            if (value.kind === 'cancel' && Object.keys(value).length === 1) resolve({kind: 'cancel'})
            else if (value.kind === 'save' && typeof value.content === 'string' && Object.keys(value).length === 2) resolve({kind: 'save', content: value.content})
            else throw new Error('Invalid native editor decision')
          } catch (error) { reject(error) }
        })
      })
      // A deliberate editor wait has no inactivity deadline; abort, owner disposal or socket failure retires it.
      exchange.once('error', reject)
      exchange.end(body)
    })
    signal.throwIfAborted()
    file.finish(decision)
  } finally { file.close() }
}
