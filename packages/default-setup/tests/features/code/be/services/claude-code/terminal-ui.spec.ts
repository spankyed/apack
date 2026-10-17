import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createClaudeTerminalUiTransport } from '#features/code/be/services/claude-code/terminal-ui.ts'

async function fixture(answer: (body: Record<string, unknown>, response: ServerResponse) => void) {
  const directory = await mkdtemp('/private/tmp/cc-ui-test-'), socketPath = join(directory, 'ui.sock')
  const owner = { pid: 17, sessionId: 'native-session' }
  let current: typeof owner | undefined = owner
  const server = createServer(async (request, response) => {
    expect(request.headers['x-apack-native-token']).toBe('private-token')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    answer(JSON.parse(Buffer.concat(chunks).toString()), response)
  })
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  const ui = createClaudeTerminalUiTransport({ socketPath, token: 'private-token', current: () => current })
  return { ...ui, owner, disposeTransport: ui.close, replace() { current = { pid: 18, sessionId: 'replacement' } },
    async close() { ui.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }) } }
}
it('authenticates native UI requests and accepts only the corresponding native reply', async () => {
  const f = await fixture((body, response) => response.end(JSON.stringify({ id: body.id, pid: body.ownerPid, sessionId: body.sessionId, result: { handled: true } })))
  try { expect(await f.transport.request({ subtype: 'ui_press', plugin: 'fixture', handle: 1 })).toEqual({ handled: true }) }
  finally { await f.close() }
})
it('rejects a forged owner identity even when the request id matches', async () => {
  const f = await fixture((body, response) => response.end(JSON.stringify({ id: body.id, pid: 99, sessionId: body.sessionId, result: {} })))
  try { await expect(f.transport.request({ subtype: 'ui_render' })).rejects.toThrow('identity') }
  finally { await f.close() }
})
it('rejects an in-flight response after owner replacement', async () => {
  let answer: (() => void) | undefined
  const f = await fixture((body, response) => { answer = () => response.end(JSON.stringify({ id: body.id, pid: body.ownerPid, sessionId: body.sessionId, result: {} })) })
  try {
    const result = expect(f.transport.request({ subtype: 'ui_render' })).rejects.toThrow('owner changed')
    await vi.waitFor(() => expect(answer).toBeDefined())
    f.replace(); answer!(); await result
  } finally { await f.close() }
})
it('retires pending requests and subscriptions when its native owner closes', async () => {
  const received = vi.fn()
  const f = await fixture(() => { received() })
  try {
    const listener = vi.fn(); f.transport.subscribe(listener)
    const result = expect(f.transport.request({ subtype: 'ui_render' })).rejects.toThrow('closed')
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    f.disposeTransport(); await result
    f.receive({ type: 'system', subtype: 'ui_invalidate' }); expect(listener).not.toHaveBeenCalled()
  } finally { await f.close() }
})
