import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

it('coalesces queued reports while preserving all scroll movement', async () => {
  const start = claudeTerminalUiRuntime.indexOf('function siteTurn(')
  const end = claudeTerminalUiRuntime.indexOf('async function remoteFocus(')
  const turn = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};siteTurn`, { Promise }) as (
    site: object, kind: string, report: number, merge: (before: number, after: number) => number, run: (value: number) => Promise<number>
  ) => Promise<number>
  const site = {}, calls: { value: number; resolve(value: number): void }[] = []
  const run = (value: number) => new Promise<number>(resolve => calls.push({ value, resolve }))
  const first = turn(site, 'scroll', 1, (a, b) => a + b, run); await Promise.resolve()
  const second = turn(site, 'scroll', 2, (a, b) => a + b, run)
  const third = turn(site, 'scroll', 3, (a, b) => a + b, run)
  expect(calls).toHaveLength(1); expect(second).toBe(third)
  calls[0]!.resolve(1); expect(await first).toBe(1); await Promise.resolve()
  expect(calls[1]!.value).toBe(5)
  calls[1]!.resolve(5); expect(await second).toBe(5)
})

it('restores the native terminal registrations when a remote drawing retires', () => {
  const start = claudeTerminalUiRuntime.indexOf('const sites=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('function paneRoster(')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({recordDrawing,dropSite})`, {
    Map, Set, AbortController, Promise, clients: new Set(['app']), clientViewCurrent: (_native: unknown, id: string) => id === 'app', publish() {},
  }) as { recordDrawing(native: unknown, request: unknown, tree: unknown): void; dropSite(native: unknown, key: string): void }
  const previousScroll = {}, previousFocus = {}, scrolls = new Map<string, unknown>([['AbovePrompt:above-prompt', previousScroll]]), focuses = new Map<string, unknown>([['AbovePrompt:above-prompt', previousFocus]])
  const native = { runtime: { f4: 'above-prompt', kV: (component: string, id: string) => `${component}:${id}`, xbe: () => scrolls, Eat: () => focuses, k7t: () => ({ emit() {} }) }, session: { Ket: () => [] } }
  api.recordDrawing(native, { client_id: 'app', component: 'AbovePrompt', instance_id: 'above-prompt', props: {} }, {})
  expect(scrolls.get('AbovePrompt:above-prompt')).not.toBe(previousScroll)
  expect(focuses.get('AbovePrompt:above-prompt')).not.toBe(previousFocus)
  api.dropSite(native, 'AbovePrompt:above-prompt')
  expect(scrolls.get('AbovePrompt:above-prompt')).toBe(previousScroll)
  expect(focuses.get('AbovePrompt:above-prompt')).toBe(previousFocus)
})

function nativeViews() {
  const start = claudeTerminalUiRuntime.indexOf('const clientViews=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('async function askHost(', start)
  const factsStart = claudeTerminalUiRuntime.indexOf('let nativeViewSequence=0,nativeViewKey;')
  const factsEnd = claudeTerminalUiRuntime.indexOf('async function control(', factsStart)
  const state: { viewingAgentTaskId?: string } = {}; let session = 'session-one'
  const tasks = new Map([['registry-agent', { id: 'registry-agent', agentId: 'agent-one' }], ['registry-other', { id: 'registry-other', agentId: 'agent-two' }]])
  const binding = { surface: 'terminal', toolContext: () => ({ getAppState: () => state, taskRegistry: { get: (id: string) => tasks.get(id) } }) }
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};${claudeTerminalUiRuntime.slice(factsStart, factsEnd)};({clientViews,clientViewCurrent,clientAttachmentViewKey})`, { originalContext: binding, Map, AbortController }) as {
    clientViews: Map<string, string>; clientViewCurrent(native: unknown, id: string): boolean
    clientAttachmentViewKey(native: unknown, expected?: unknown): string
  }
  const native = { questionOptions: { q: () => session }, runtime: { flt: (task: { agentId: string }) => ({ id: task.agentId }) } }
  return { api, native, state, tasks, session(value: string) { session = value } }
}

it('retires clients across selection round trips instead of reviving old parent or Agent callbacks', () => {
  const { api, native, state, session } = nativeViews()
  api.clientViews.set('parent', api.clientAttachmentViewKey(native))
  expect(api.clientViewCurrent(native, 'parent')).toBe(true)
  state.viewingAgentTaskId = 'registry-agent'
  expect(api.clientViewCurrent(native, 'parent')).toBe(false)
  api.clientViews.set('agent', api.clientAttachmentViewKey(native, { session_id: 'session-one', revision: 2, agent_id: 'agent-one' }))
  expect(api.clientViewCurrent(native, 'agent')).toBe(true)
  delete state.viewingAgentTaskId
  expect(api.clientViewCurrent(native, 'agent')).toBe(false)
  expect(api.clientViewCurrent(native, 'parent')).toBe(false)
  state.viewingAgentTaskId = 'registry-agent'
  expect(api.clientViewCurrent(native, 'agent')).toBe(false)
  session('session-two'); expect(api.clientViewCurrent(native, 'agent')).toBe(false)
})

it('requires the exact observed Agent attachment and refuses stale, foreign, retired or implicit parent targets', () => {
  const { api, native, state, tasks } = nativeViews()
  api.clientAttachmentViewKey(native)
  state.viewingAgentTaskId = 'registry-agent'
  expect(() => api.clientAttachmentViewKey(native)).toThrow('Desktop parent UI')
  const target = { session_id: 'session-one', revision: 2, agent_id: 'agent-one' }
  expect(api.clientAttachmentViewKey(native, target)).toBeTruthy()
  for (const invalid of [{ ...target, revision: 1 }, { ...target, session_id: 'foreign' }, { ...target, agent_id: 'registry-agent' }, { ...target, agent_id: 'agent-two' }]) {
    expect(() => api.clientAttachmentViewKey(native, invalid)).toThrow('selection changed')
  }
  expect(() => api.clientAttachmentViewKey(native, { ...target, unexpected: true })).toThrow('Invalid native Agent')
  tasks.delete('registry-agent')
  expect(() => api.clientAttachmentViewKey(native, target)).toThrow('selection changed')
})

it('binds command callbacks to canonical live native command facts rather than journal header guesses', () => {
  const start = claudeTerminalUiRuntime.indexOf('const commandOutputFrames=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('function siteExists(', start)
  const row = { uuid: 'result', type: 'system', subtype: 'local_command', content: 'original output', commandRun: { command: 'canonical-command', args: 'redacted-args' } }
  let messages = [row]
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({commandOutputFrames,commandOutputFacts,currentCommandOutputAction})`, { Map, originalContext: { messages: () => messages } })
  const native = { commandTags: { Ms: (_content: string, tag: string) => tag === 'local-command-stdout' ? 'Native output' : null }, commandEntities: { km: (text: string) => text }, questionOptions: { gu: 'empty' }, commandOutput: { s4t: () => ({ message: { content: 'Native output' } }) } }
  const facts = api.commandOutputFacts(native, 'result')
  expect(facts.props).toEqual({ command: 'canonical-command', args: 'redacted-args', text: 'Native output', isErrored: false })
  const request = { component: 'CommandOutput', client_id: 'view', instance_id: 'result' }
  expect(() => api.currentCommandOutputAction(native, request)).toThrow('expired')
  api.commandOutputFrames.set(JSON.stringify(['view', 'result']), { fingerprint: facts.fingerprint })
  expect(() => api.currentCommandOutputAction(native, request)).not.toThrow()
  row.commandRun.args = 'changed'
  expect(() => api.currentCommandOutputAction(native, request)).toThrow('expired')
  messages = []
  expect(api.commandOutputFacts(native, 'result')).toBeUndefined()
  expect(() => api.currentCommandOutputAction(native, request)).toThrow('expired')
})
