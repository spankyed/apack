import { spawn } from 'node:child_process'
import http from 'node:http'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClaudeTerminalBridge } from '#features/code/be/services/claude-code/terminal-bridge.ts'
const session = '11111111-1111-1111-1111-111111111111'
let bridge: Awaited<ReturnType<typeof createClaudeTerminalBridge>> | undefined
async function config() { return JSON.parse(await readFile(bridge!.directory + '/observer.json', 'utf8')) }
async function request(path: string, body: unknown, token?: string) {
  const value = await config()
  return new Promise<{ status: number; value: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ socketPath: value.socketPath, path, method: 'POST', headers: { 'content-type': 'application/json', 'x-apack-native-token': token ?? value.token } }, response => {
      let bytes = ''; response.on('data', chunk => { bytes += chunk }); response.on('end', () => resolve({ status: response.statusCode!, value: JSON.parse(bytes) }))
    }); req.on('error', reject); req.end(JSON.stringify(body))
  })
}
async function observed(command = 'main') {
  return { sessionId: session, parentPid: process.pid, childPid: process.pid + 1, kind: 'main', command, generation: (await config()).generations.main, startedAt: '100', stdout: 'native output', code: 0, signal: null, truncated: false }
}
async function create(enter = () => {}, pasteImage?: (path: string) => void) {
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: 'main' }, subagentStatusLine: { type: 'command', command: 'sub' } }, sources: [] }, ownsProcess: async pid => pid === process.pid, changed() {}, enter, pasteImage })
  await request('/observer-ready', { sessionId: session, pid: process.pid })
  await request('/poll', { sessionId: session, agents: [], statusCommand: 'main', subagentCommand: 'sub', shellPrefix: null })
}
afterEach(async () => { await bridge?.close(); bridge = undefined })
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

it('refuses foreign native owners, children and sessions before accepting status', async () => {
  await create()
  expect((await request('/observer-ready', { sessionId: session, pid: process.pid + 1 })).status).toBe(409)
  const event = await observed()
  expect((await request('/native-status', { ...event, parentPid: process.pid + 1 })).status).toBe(409)
  expect((await request('/native-status', { ...event, childPid: 0 })).status).toBe(409)
  expect((await request('/native-status', { ...event, sessionId: '22222222-2222-2222-2222-222222222222' })).status).toBe(409)
  expect((await request('/native-status', event)).status).toBe(200)
  expect(bridge!.projection.mainStatus).toBe('native output')
})
it('accepts a native result preceding its metadata, then fences obsolete commands and generations', async () => {
  await create()
  const event = await observed('new main')
  expect((await request('/native-status', event)).status).toBe(202)
  expect(bridge!.projection.mainStatus).toBeUndefined()
  await request('/poll', { sessionId: session, agents: [], statusCommand: 'new main' })
  expect(bridge!.projection.mainStatus).toBe('native output')
  expect((await request('/native-status', { ...event, startedAt: '200' })).status).toBe(409)
  expect((await request('/poll', { sessionId: session, agents: 'invalid', statusCommand: null })).status).toBe(400)
  expect(bridge!.projection.mainStatus).toBe('native output')
  await request('/poll', { sessionId: session, agents: [], statusCommand: null })
  expect(bridge!.projection.mainStatus).toBeUndefined()
})
it('keeps subagent identity native-owned across live command changes and ignores foreign rows', async () => {
  await create()
  await request('/poll', { sessionId: session, agents: [{ id: 'task', type: 'worker', status: 'running' }] })
  const event = { ...await observed('sub'), kind: 'subagent', generation: (await config()).generations.subagent, tasks: [{ id: 'task', status: 'running' }], stdout: '{"id":"task","content":"running decoration"}\n{"id":"foreign","content":"forged"}\n' }
  expect((await request('/native-status', event)).status).toBe(200)
  expect(bridge!.projection.tasks).toEqual([{ id: 'task', name: 'worker', status: 'running', statusText: 'running decoration' }])
  await request('/poll', { sessionId: session, agents: [{ id: 'task', type: 'worker', status: 'running' }], subagentCommand: 'new sub' })
  expect(bridge!.projection.tasks[0]?.statusText).toBeUndefined()
  expect((await request('/native-status', event)).status).toBe(409)
})
it.each([0, 7])('preserves real child streams, Unicode, exit code and the original preload environment: %s', async code => {
  let nativePid: number | undefined
  const helper = "const data=[];process.stdin.on('data',x=>data.push(x));process.stdin.on('end',()=>{const p=JSON.parse(Buffer.concat(data));const b=Buffer.from('中文🙂 '+p.session_id);process.stdout.write(b.subarray(0,2));setImmediate(()=>{process.stdout.write(b.subarray(2));process.exitCode=" + code + "})});"
  bridge = await createClaudeTerminalBridge({ sessionId: session, settings: { effective: { statusLine: { type: 'command', command: helper } }, sources: [] }, bunOptions: '--preload=/private/user-preload.mjs', ownsProcess: async pid => pid === nativePid, changed() {}, enter() {} })
  const launcher = join(bridge.directory, 'fixture.mjs')
  await writeFile(launcher, `await import('./status.mjs');const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(helper)}]);const chunks=[];child.stdout.on('data',x=>chunks.push(x));child.stdin.end(JSON.stringify({session_id:${JSON.stringify(session)},version:'2.1.302',cost:{},context_window:{}}));child.once('close',code=>console.log(JSON.stringify({code,text:Buffer.concat(chunks).toString(),bunOptions:process.env.BUN_OPTIONS})));`)
  const child = spawn(process.execPath, [launcher], { env: { ...process.env, BUN_OPTIONS: bridge.bunOptions }, stdio: ['ignore', 'pipe', 'pipe'] }); nativePid = child.pid
  let output = '', error = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { error += chunk })
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', exit => exit === 0 ? resolve() : reject(new Error(error))) })
  expect(JSON.parse(output)).toEqual({ code, text: '中文🙂 ' + session, bunOptions: '--preload=/private/user-preload.mjs' })
  expect(bridge.projection.mainStatus).toBe(code === 0 ? '中文🙂 ' + session : undefined)
})

it('retains the app draft and never enters when native terminal preparation is unavailable', async () => {
  const enter = vi.fn(), fill = vi.fn(async () => true)
  await create(enter)
  const unregister = bridge!.uiTransport.promptHosts.register('app', { read: async () => ({ text: 'Keep app draft', cursor: 14 }), fill })
  try {
    const rejected = expect(bridge!.submit('Keep app draft')).rejects.toThrow()
    await request('/poll', { sessionId: session, agents: [], statusCommand: 'main', subagentCommand: 'sub', shellPrefix: null })
    await rejected
    expect(enter).not.toHaveBeenCalled(); expect(fill).not.toHaveBeenCalled()
  } finally { unregister() }
})

it('forwards native pane rosters only from the current owner and session', async () => {
  await create()
  const receive = vi.fn(), unsubscribe = bridge!.uiTransport.subscribe(receive)
  const event = { type: 'system', subtype: 'ui_panes', panes: [{ id: 'review', plugin: 'fixture', title: 'Review' }], shown_id: 'review', focused_id: null, focus_requested_id: null }
  try {
    expect((await request('/ui-event', { sessionId: session, pid: process.pid + 1, event })).status).toBe(409)
    expect((await request('/ui-event', { sessionId: '22222222-2222-2222-2222-222222222222', pid: process.pid, event })).status).toBe(409)
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event: { ...event, panes: ['invalid'] } })).status).toBe(409)
    expect(receive).not.toHaveBeenCalled()
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event })).status).toBe(200)
    expect(receive).toHaveBeenCalledExactlyOnceWith(event)
  } finally { unsubscribe() }
})

it.each([
  { type: 'system', subtype: 'ui_scroll', client_id: 'app', component: 'Pane', instance_id: 'review', offset: 20 },
  { type: 'system', subtype: 'ui_focus', client_id: 'app', component: 'AbovePrompt', instance_id: 'above-prompt', plugin: 'fixture', key: 'target' },
])('fences native $subtype site movement events', async event => {
  await create()
  const receive = vi.fn(), unsubscribe = bridge!.uiTransport.subscribe(receive)
  try {
    expect((await request('/ui-event', { sessionId: session, pid: process.pid + 1, event })).status).toBe(409)
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event: { ...event, component: 'foreign' } })).status).toBe(409)
    expect(receive).not.toHaveBeenCalled()
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event })).status).toBe(200)
    expect(receive).toHaveBeenCalledExactlyOnceWith(event)
  } finally { unsubscribe() }
})

it('accepts session-scoped native notices and refuses malformed or foreign updates', async () => {
  await create()
  const receive = vi.fn(), unsubscribe = bridge!.uiTransport.subscribe(receive)
  const event = { type: 'system', subtype: 'ui_toast', session_id: session, uuid: 'notice-1', plugin: 'fixture', text: 'Native notice', timeout_ms: 1500 }
  try {
    for (const invalid of [{ ...event, session_id: 'foreign' }, { ...event, timeout_ms: -1 }, { ...event, text: null }, { ...event, plugin: '' }]) {
      expect((await request('/ui-event', { sessionId: session, pid: process.pid, event: invalid })).status).toBe(409)
    }
    expect((await request('/ui-event', { sessionId: session, pid: process.pid + 1, event })).status).toBe(409)
    expect(receive).not.toHaveBeenCalled()
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event })).status).toBe(200)
    expect(receive).toHaveBeenCalledExactlyOnceWith(event)
    expect((await request('/ui-event', { sessionId: session, pid: process.pid, event: { ...event, subtype: 'ui_status', text: null } })).status).toBe(200)
  } finally { unsubscribe() }
})


it('rejects malformed image data before reserving or entering a native prompt', async () => {
  const enter = vi.fn(); await create(enter)
  await expect(bridge!.submit('', [{ mediaType: 'image/png', data: '!' }])).rejects.toThrow('invalid')
  expect(bridge!.busy).toBe(false); expect(enter).not.toHaveBeenCalled()
})

it('removes materialized images and retains the draft when native paste fails', async () => {
  const enter = vi.fn(), paste = vi.fn((path: string) => {
    expect(path.startsWith(bridge!.directory + '/')).toBe(true)
    expect(readFileSync(path)).toEqual(Buffer.from('a'))
    throw new Error('Fixture paste refused')
  })
  await create(enter, paste)
  const conf = await config()
  const native = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (body.request.subtype === 'apack_prepare_prompt') expect(body.request.allow_empty).toBe(true)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: body.id, pid: body.ownerPid, sessionId: body.sessionId, result: body.request.subtype === 'apack_prepare_prompt' ? { filled: true } : { text: '', cursor: 0, images: 0 } }))
  })
  await new Promise<void>(resolve => native.listen(conf.uiSocketPath, resolve))
  try {
    const result = expect(bridge!.submit('', [{ mediaType: 'image/png', data: 'YQ==' }])).rejects.toThrow('Fixture paste refused')
    await request('/poll', { sessionId: session, agents: [] }); await result
    expect(paste).toHaveBeenCalledOnce(); expect(enter).not.toHaveBeenCalled()
    expect((await readdir(bridge!.directory)).filter(name => name.endsWith('.png'))).toEqual([])
  } finally { native.closeAllConnections(); await new Promise<void>(resolve => native.close(() => resolve())) }
})

it('validates direct-owner turn facts before changing busy state and fences pending reads by session', async () => {
  await create()
  expect((await request('/poll', { sessionId: session, agents: [], directOwner: true, busy: true, turn: { id: 'native-turn', cancelled: false } })).status).toBe(200)
  expect(bridge!.busy).toBe(true)
  expect((await request('/poll', { sessionId: session, agents: [], directOwner: true, busy: false, turn: {} })).status).toBe(400)
  expect(bridge!.busy).toBe(true)
  expect((await request('/owner-pending', { sessionId: '22222222-2222-2222-2222-222222222222' })).status).toBe(409)
  expect((await request('/poll', { sessionId: session, agents: [], directOwner: true, busy: false, turn: null })).status).toBe(200)
  expect(bridge!.busy).toBe(false)
  expect((await request('/poll', { sessionId: session, agents: [], directOwner: true, busy: true, turn: null })).status).toBe(200)
  expect(bridge!.busy).toBe(true)
})

it('refreshes native UI mode changes after the initial poll and uses direct owner mode metadata', async () => {
  await create()
  const control = vi.spyOn(bridge!.uiTransport, 'request').mockResolvedValueOnce({ mode: 'plan' }).mockResolvedValueOnce({ mode: 'default' })
  const metadata = { cwd: '/workspace', model: 'fixture', turns: 1, startedAt: 100 }
  await request('/poll', { sessionId: session, agents: [], metadata })
  expect(bridge!.session.metadata?.permissionMode).toBe('plan')
  await request('/poll', { sessionId: session, agents: [], metadata })
  expect(bridge!.session.metadata?.permissionMode).toBe('default')
  await request('/poll', { sessionId: session, agents: [], metadata: { ...metadata, permissionMode: 'auto' }, directOwner: true, busy: false, turn: null })
  expect(bridge!.session.metadata?.permissionMode).toBe('auto')
  expect(control).toHaveBeenCalledTimes(2)
})

it('publishes native view revisions only from its current process/session and refuses stale observations', async () => {
  await create()
  const main = { sessionId: session, pid: process.pid, sequence: 1, view: { kind: 'main' } }
  expect((await request('/native-view', { ...main, pid: process.pid + 1 })).status).toBe(409)
  expect((await request('/native-view', main)).status).toBe(200)
  expect(bridge!.view).toEqual({ kind: 'main', revision: 1 })
  const agent = { ...main, sequence: 3, view: { kind: 'agent', registryId: 'registry-a', taskId: 'agent-a' } }
  expect((await request('/native-view', agent)).status).toBe(200)
  expect((await request('/native-view', main)).status).toBe(409)
  expect((await request('/native-view', { ...main, sequence: 3 })).status).toBe(409)
  expect((await request('/native-view', agent)).status).toBe(200)
  expect(bridge!.view).toEqual({ kind: 'agent', revision: 3, registryId: 'registry-a', taskId: 'agent-a' })
  const otherSession = '22222222-2222-2222-2222-222222222222'
  await request('/poll', { sessionId: otherSession, agents: [], statusCommand: 'main', subagentCommand: 'sub', shellPrefix: null })
  expect(bridge!.view).toBeUndefined()
  expect((await request('/native-view', agent)).status).toBe(409)
  expect((await request('/native-view', { ...main, sessionId: otherSession, sequence: 4 })).status).toBe(200)
  expect(bridge!.view).toEqual({ kind: 'main', revision: 4 })
})

it('fences shared PTY Enter by native main or Agent view and refuses pending parent input', async () => {
  const enter = vi.fn(); await create(enter)
  const main = { sessionId: session, pid: process.pid, kind: 'main', revision: 1 }
  expect((await request('/view-enter', main)).status).toBe(409)
  await request('/native-view', { sessionId: session, pid: process.pid, sequence: 1, view: { kind: 'main' } })
  expect((await request('/view-enter', { ...main, pid: process.pid + 1 })).status).toBe(409)
  expect((await request('/view-enter', { ...main, kind: 'agent', taskId: 'agent' })).status).toBe(409)
  expect((await request('/view-enter', main)).status).toBe(200)
  await request('/native-view', { sessionId: session, pid: process.pid, sequence: 2, view: { kind: 'agent', registryId: 'registry', taskId: 'agent' } })
  expect((await request('/view-enter', main)).status).toBe(409)
  expect((await request('/view-enter', { ...main, kind: 'agent', revision: 2, taskId: 'foreign' })).status).toBe(409)
  const agent = { ...main, kind: 'agent', revision: 2, taskId: 'agent' }
  expect((await request('/view-enter', agent)).status).toBe(200)
  const pending = bridge!.submit('Unrelated parent draft'), rejected = expect(pending).rejects.toThrow('closed')
  expect((await request('/view-enter', agent)).status).toBe(409)
  expect(enter).toHaveBeenCalledTimes(2)
  await bridge!.close(); await rejected
})
