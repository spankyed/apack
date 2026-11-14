import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClaudeTerminalUiTransport } from '#features/code/be/services/claude-code/terminal-ui.ts'

async function fixture(answer: (body: Record<string, unknown>, response: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'cc-ui-test-')), socketPath = join(directory, 'ui.sock')
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

it('serves validated native read/fill/suggest requests and refuses replayed fills', async () => {
  const f = await fixture(() => {})
  let draft = 'App draft'
  const fill = vi.fn(async (input: { text: string }) => { draft = input.text; return true }), suggest = vi.fn(async () => true)
  try {
    f.transport.promptHosts.register('app', { read: async () => ({ text: draft, cursor: draft.length }), fill, suggest })
    const body = (sequence: number, request: Record<string, unknown>) => ({ pid: f.owner.pid, sessionId: f.owner.sessionId, request_id: randomUUID(), sequence, request: { surface: 'desktop', client_id: 'app', ...request } })
    const read = vi.fn(); expect(f.receiveHost(body(1, { subtype: 'ui_prompt_read' }), read)).toBe(true)
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith({ text: 'App draft', cursor: 9 }, true))
    const request = body(2, { subtype: 'ui_prompt_fill', text: 'Native replacement', mode: 'replace' }), filled = vi.fn()
    expect(f.receiveHost(request, filled)).toBe(true)
    await vi.waitFor(() => expect(filled).toHaveBeenCalledWith({ filled: true }, true))
    expect(f.receiveHost(request, vi.fn())).toBe(false); expect(fill).toHaveBeenCalledOnce()
    const shown = vi.fn(); f.receiveHost(body(3, { subtype: 'ui_prompt_suggest', text: 'A proposed next step' }), shown)
    await vi.waitFor(() => expect(shown).toHaveBeenCalledWith({ shown: true }, true))
    expect(f.receiveHost({ ...body(4, { subtype: 'ui_prompt_read' }), pid: 99 }, vi.fn())).toBe(false)
  } finally { await f.close() }
})
it('cancels reverse work when its mounted composer unregisters and ignores the late result', async () => {
  const f = await fixture(() => {}), complete = vi.fn()
  let signal: AbortSignal | undefined, resolve!: (value: { text: string; cursor: number }) => void
  try {
    const unregister = f.transport.promptHosts.register('app', { read: async abort => { signal = abort; return new Promise(done => { resolve = done }) }, fill: async () => false })
    f.receiveHost({ pid: f.owner.pid, sessionId: f.owner.sessionId, request_id: randomUUID(), sequence: 1, request: { subtype: 'ui_prompt_read', surface: 'desktop', client_id: 'app' } }, complete)
    await vi.waitFor(() => expect(signal).toBeDefined()); unregister()
    expect(signal!.aborted).toBe(true); expect(complete).toHaveBeenCalledExactlyOnceWith(undefined, false)
    resolve({ text: 'Late old draft', cursor: 0 }); await Promise.resolve(); await Promise.resolve()
    expect(complete).toHaveBeenCalledOnce()
  } finally { await f.close() }
})
it('keeps serving a long-running composer beyond the former per-manager request budget', async () => {
  const f = await fixture(() => {})
  try {
    f.transport.promptHosts.register('app', { read: async () => ({ text: 'Still available', cursor: 0 }), fill: async () => false })
    for (let sequence = 1; sequence <= 5000; sequence++) {
      await new Promise<void>(resolve => {
        expect(f.receiveHost({ pid: f.owner.pid, sessionId: f.owner.sessionId, request_id: randomUUID(), sequence, request: { subtype: 'ui_prompt_read', surface: 'desktop', client_id: 'app' } }, (result, current) => {
          expect(current).toBe(true); expect(result).toEqual({ text: 'Still available', cursor: 0 }); resolve()
        })).toBe(true)
      })
    }
  } finally { await f.close() }
})
