import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const selection = z.object({ text: z.string().max(1000000).optional(), instance_id: z.string().min(1).max(256).optional() }).strict()
export type ClaudeUiSelection = z.infer<typeof selection>

/** Selection text bypasses the logged event bus. A mounted view receives only this one-use address. */
export async function createClaudeSelectionReply(signal: AbortSignal, expiresAt: number, current: () => boolean): Promise<{
  url: string
  result: Promise<ClaudeUiSelection | undefined>
  close(): void
}> {
  const path = '/' + randomBytes(32).toString('hex')
  let settled = false, claimed = false
  let resolve!: (value: ClaudeUiSelection | undefined) => void
  const result = new Promise<ClaudeUiSelection | undefined>(done => { resolve = done })
  const live = () => !settled && !signal.aborted && Date.now() < expiresAt && current()
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Cache-Control', 'no-store')
    if (request.url !== path || !live() || claimed) { response.writeHead(404); response.end(); return }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Access-Control-Allow-Private-Network', 'true')
      response.writeHead(204); response.end(); return
    }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    claimed = true
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 4 * 1048576) { response.writeHead(413); response.end(); finish(); return }
        chunks.push(Buffer.from(chunk))
      }
      const parsed = selection.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!live()) { response.writeHead(410); response.end(); finish(); return }
      if (!parsed.success) { response.writeHead(400); response.end(); finish(); return }
      response.writeHead(204); response.end(); finish(parsed.data.text ? parsed.data : {})
    } catch { response.writeHead(400); response.end(); finish() }
  })
  const aborted = () => finish()
  const timer = setTimeout(() => finish(), Math.max(0, Math.min(4000, expiresAt - Date.now())))
  timer.unref()
  function finish(value?: ClaudeUiSelection) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', aborted)
    resolve(value)
    server.close()
    if (value === undefined) server.closeAllConnections()
  }
  signal.addEventListener('abort', aborted, { once: true })
  if (signal.aborted || Date.now() >= expiresAt || !current()) { finish(); return { url: '', result, close: finish } }
  try {
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
    server.unref()
    if (!live()) { server.close(); return { url: '', result, close: finish } }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Native selection reply is unavailable')
    return { url: `http://127.0.0.1:${address.port}${path}`, result, close: finish }
  } catch { finish(); return { url: '', result, close: finish } }
}
