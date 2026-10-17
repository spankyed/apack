import { execFile } from 'node:child_process'
import http from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
it('runs the same original helper in distinct native roles', async () => {
  const original = '/usr/bin/printf "Native line\\nSecond line\\n"'
  const settings = { effective: { statusLine: { type: 'command', command: original, padding: 3, refreshInterval: 2 }, subagentStatusLine: { type: 'command', command: original } }, sources: [] }
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings, changed() {}, enter() {} })
  expect(bridge.settings.env).toBeUndefined()
  expect(bridge.settings.statusLine).toBeUndefined()
  expect(settings.effective.statusLine.command).toBe(original)
  const prefix = bridge.prefixLauncher!
  const config = { command: prefix + " '" + original.replaceAll("'", "'\"'\"'") + "'" }
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

it.each(['', ' --fixture-prefix'])('preserves original prefix argv and environment for a path with spaces: %s', async flags => {
  const directory = await mkdtemp(join(tmpdir(), 'native-prefix-'))
  try {
    const prefixPath = join(directory, "user's prefix"), log = join(directory, 'calls.jsonl'), payload = join(directory, 'payload.json')
    const prefix = prefixPath + flags
    await writeFile(prefixPath, `#!/usr/bin/python3
import json,os,subprocess,sys
with open(${JSON.stringify(log)},'a') as f: f.write(json.dumps({'args':sys.argv[1:],'prefix':os.environ.get('CLAUDE_CODE_SHELL_PREFIX')})+'\\n')
sys.exit(subprocess.run(['/bin/sh','-c',sys.argv[-1]],stdin=sys.stdin,stdout=sys.stdout,stderr=sys.stderr).returncode)
`, { mode: 0o700 })
    const original = `/usr/bin/printf '%s\\n' "native's output"`
    bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { env: { CLAUDE_CODE_SHELL_PREFIX: prefix }, statusLine: { type: 'command', command: original }, subagentStatusLine: { type: 'command', command: '/usr/bin/printenv CLAUDE_CODE_SHELL_PREFIX' } }, sources: [] }, changed() {}, enter() {} })
    expect(bridge.settings.statusLine).toBeUndefined()
    const installed = bridge.prefixLauncher!
    const quote = (text: string) => "'" + text.replaceAll("'", "'\"'\"'") + "'"
    const env = { ...process.env, CLAUDE_CODE_SHELL_PREFIX: installed }
    await writeFile(payload, JSON.stringify({ session_id: session, version: '2.1.302', cost: {}, context_window: {} }))
    const result = await exec('/bin/sh', ['-c', quote(installed) + ' ' + quote(original) + ' < ' + quote(payload)], { env })
    expect(result.stdout).toBe("native's output\n")
    expect(bridge.projection.mainStatus).toBe("native's output")
    expect((await exec(installed, ['printf passthrough'], { env })).stdout).toBe('passthrough')
    const subagent = bridge.settings.subagentStatusLine as { command: string }
    expect((await exec('/bin/sh', ['-c', subagent.command + ' < ' + quote(payload)], { env })).stdout).toBe(prefix + '\n')
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(calls).toEqual([original, 'printf passthrough'].map(command => ({ args: flags ? ['--fixture-prefix', command] : [command], prefix })))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
it('observes native-selected command changes and rejects removed or obsolete main outputs', async () => {
  const oldCommand = '/usr/bin/printf old', nextCommand = '/usr/bin/printf new'
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: oldCommand } }, sources: [] }, changed() {}, enter() {} })
  const prefix = bridge.prefixLauncher!
  const payload = JSON.stringify({ session_id: session, version: '2.1.302', cost: {}, context_window: {} })
  const directory = await mkdtemp(join(tmpdir(), 'native-live-prefix-'))
  try {
    const path = join(directory, 'payload.json'); await writeFile(path, payload)
    const invoke = (command: string) => exec('/bin/sh', ['-c', `'${prefix}' '${command}' < '${path}'`])
    expect((await invoke(oldCommand)).stdout).toBe('old'); expect(bridge.projection.mainStatus).toBe('old')
    expect((await request('/poll', { sessionId: session, agents: 'invalid', statusCommand: null })).status).toBe(400)
    expect(bridge.projection.mainStatus).toBe('old')
    await request('/poll', { sessionId: session, agents: [], statusCommand: nextCommand })
    expect(bridge.projection.mainStatus).toBeUndefined()
    expect((await invoke(oldCommand)).stdout).toBe('old'); expect(bridge.projection.mainStatus).toBeUndefined()
    expect((await invoke(nextCommand)).stdout).toBe('new'); expect(bridge.projection.mainStatus).toBe('new')
    await request('/poll', { sessionId: session, agents: [], statusCommand: null })
    expect(bridge.projection.mainStatus).toBeUndefined()
    expect((await invoke(nextCommand)).stdout).toBe('new'); expect(bridge.projection.mainStatus).toBeUndefined()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
it('fences old prefix results, restores an unset prefix and exposes native refusal', async () => {
  const original = '/usr/bin/printf main'
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: original }, subagentStatusLine: { type: 'command', command: '/usr/bin/printf subagent' } }, sources: [] }, changed() {}, enter() {} })
  const initial = JSON.parse(await readFile(bridge.directory + '/main.json', 'utf8'))
  const event = { sessionId: session, kind: 'main', command: original, generation: initial.generation, startedAt: '100', stdout: 'old prefix result', code: 0, signal: null, truncated: false }
  expect((await request('/native-status', event)).status).toBe(200)
  expect(bridge.projection.mainStatus).toBe('old prefix result')
  expect((await request('/prefix', { sessionId: session, prefix: '/private/user prefix --flag' })).status).toBe(200)
  const changed = JSON.parse(await readFile(bridge.directory + '/main.json', 'utf8'))
  const subagent = JSON.parse(await readFile(bridge.directory + '/subagent.json', 'utf8'))
  expect(changed.generation).not.toBe(initial.generation)
  expect(changed.delegatePrefix).toBe('/private/user prefix --flag')
  expect(subagent.originalPrefix).toBe(changed.originalPrefix)
  expect(subagent.generation).toBe(changed.generation)
  expect(bridge.projection.mainStatus).toBeUndefined()
  expect((await request('/native-status', { ...event, startedAt: '200' })).status).toBe(409)
  expect((await request('/native-status', { ...event, generation: changed.generation, startedAt: '200', stdout: 'current prefix result' })).status).toBe(200)
  expect((await request('/prefix', { sessionId: session, prefix: null })).status).toBe(200)
  const unset = JSON.parse(await readFile(bridge.directory + '/main.json', 'utf8'))
  expect(unset.originalPrefix).toBeUndefined(); expect(unset.delegatePrefix).toBeUndefined()
  expect((await request('/native-status', { ...event, generation: changed.generation, startedAt: '300' })).status).toBe(409)
  expect((await request('/prefix-error', { sessionId: session, message: 'fixture native denial' })).status).toBe(200)
  expect(bridge.problem).toBe('Native status capture was refused: fixture native denial')
})
