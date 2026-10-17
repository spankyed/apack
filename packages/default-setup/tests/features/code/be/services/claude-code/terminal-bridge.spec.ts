import { execFile } from 'node:child_process'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { createClaudeTerminalBridge } from '#features/code/be/services/claude-code/terminal-bridge.ts'
const exec = promisify(execFile), session = '11111111-1111-1111-1111-111111111111'
let bridge: Awaited<ReturnType<typeof createClaudeTerminalBridge>> | undefined
async function request(path: string, body: unknown, token?: string) {
  const config = JSON.parse(await readFile(bridge!.directory + '/main.json', 'utf8'))
  return new Promise<{ status: number; value: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ socketPath: config.socketPath, path, method: 'POST', headers: { 'content-type': 'application/json', 'x-apack-native-token': token ?? config.token } }, response => {
      let bytes = ''; response.on('data', chunk => { bytes += chunk }); response.on('end', () => resolve({ status: response.statusCode!, value: JSON.parse(bytes) }))
    }); req.on('error', reject); req.end(JSON.stringify(body))
  })
}
afterEach(async () => { await bridge?.close(); bridge = undefined })
it('runs the same original helper in distinct native roles without overriding the configured prefix', async () => {
  const original = '/usr/bin/printf "Native line\\nSecond line\\n"'
  const settings = { effective: { env: { CLAUDE_CODE_SHELL_PREFIX: '/private/user-prefix' }, statusLine: { type: 'command', command: original, padding: 3, refreshInterval: 2 }, subagentStatusLine: { type: 'command', command: original } }, sources: [] }
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings, changed() {}, enter() {} })
  expect(bridge.settings.env).toBeUndefined()
  expect(bridge.settings.statusLine).toMatchObject({ padding: 3, refreshInterval: 2 })
  expect(settings.effective.statusLine.command).toBe(original)
  const config = bridge.settings.statusLine as { command: string }
  const command = 'printf \'%s\' \'{"session_id":"' + session + '","version":"2.1.302","cost":{},"context_window":{}}\' | ' + config.command
  const native = await exec('/bin/sh', ['-c', command])
  expect(native.stdout).toBe('Native line\nSecond line\n')
  expect(bridge.projection.mainStatus).toBe('Native line\nSecond line')
})
it('fences prompt requests by session and nonce and never enters a rejected or repeated request', async () => {
  const enter = vi.fn()
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: '/usr/bin/printf fixture' } }, sources: [] }, changed() {}, enter })
  expect((await request('/poll', { sessionId: session, agents: [] }, 'foreign')).status).toBe(403)
  await request('/poll', { sessionId: session, agents: [] })
  const first = bridge.submit('Draft'), rejected = expect(first).rejects.toThrow('rejected')
  const poll = await request('/poll', { sessionId: session, agents: [] })
  expect((await request('/result', { sessionId: '22222222-2222-2222-2222-222222222222', id: poll.value.id, filled: true })).status).toBe(409)
  await request('/result', { sessionId: session, id: poll.value.id, filled: false }); await rejected
  expect(enter).not.toHaveBeenCalled()
  const second = bridge.submit('Next')
  const next = await request('/poll', { sessionId: session, agents: [] })
  let resolved = false; void second.then(() => { resolved = true })
  await request('/result', { sessionId: session, id: next.value.id, filled: true })
  expect(resolved).toBe(false)
  expect((await request('/result', { sessionId: session, id: next.value.id, filled: true })).status).toBe(409)
  const uuid = '33333333-3333-3333-3333-333333333333'
  await request('/append', { sessionId: session, submissionId: next.value.id, uuid, door: 'prompt', origin: { kind: 'composer' }, message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'Native rewritten next' }] } })
  await request('/submission', { sessionId: session, id: next.value.id, accepted: true })
  await expect(second).resolves.toEqual({ sessionId: session, uuid, text: 'Native rewritten next' })
  expect(enter).toHaveBeenCalledOnce()
  expect((await request('/result', { sessionId: session, id: next.value.id, filled: true })).status).toBe(409)
  const dropped = bridge.submit('Blocked'), refusal = expect(dropped).rejects.toThrow('Native prompt refused: fixture refusal')
  const dropRequest = await request('/poll', { sessionId: session, agents: [] })
  await request('/result', { sessionId: session, id: dropRequest.value.id, filled: true })
  await request('/submission', { sessionId: session, id: dropRequest.value.id, drop: 'fixture refusal' }); await refusal
  await request('/turn', { sessionId: session, running: false, turnId: 'native-turn', reason: 'error' })
  expect(bridge.lastTurn).toEqual({ id: 'native-turn', reason: 'error' })
  await request('/turn', { sessionId: session, running: true })
  expect(bridge.lastTurn).toBeUndefined()
  await request('/turn', { sessionId: session, running: false, turnId: 'next-native-turn', reason: 'answer' })
  const pending = bridge.submit('Closing'), closed = expect(pending).rejects.toThrow('closed')
  await bridge.close(); await closed
})
it('does not replace a native managed helper in flag settings', async () => {
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: 'managed-helper' } }, sources: [{ source: 'policySettings', settings: { statusLine: { type: 'command', command: 'managed-helper' } } }] }, changed() {}, enter() {} })
  expect(bridge.settings).toEqual({})
})
