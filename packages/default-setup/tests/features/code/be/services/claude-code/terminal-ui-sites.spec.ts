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

it('fences native desktop clients by the selected native registry view and session', () => {
  const start = claudeTerminalUiRuntime.indexOf('const clientViews=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('async function askHost(', start)
  const state: { viewingAgentTaskId?: string } = {}; let session = 'session-one'
  const binding = { surface: 'terminal', toolContext: () => ({ getAppState: () => state }) }
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({clientViews,clientViewCurrent})`, { originalContext: binding, Map, AbortController }) as { clientViews: Map<string, string>; clientViewCurrent(native: unknown, id: string): boolean }
  const native = { questionOptions: { q: () => session } }
  api.clientViews.set('parent', JSON.stringify([session, null]))
  expect(api.clientViewCurrent(native, 'parent')).toBe(true)
  state.viewingAgentTaskId = 'registry-agent'
  expect(api.clientViewCurrent(native, 'parent')).toBe(false)
  api.clientViews.set('agent', JSON.stringify([session, 'registry-agent']))
  expect(api.clientViewCurrent(native, 'agent')).toBe(true)
  session = 'session-two'; expect(api.clientViewCurrent(native, 'agent')).toBe(false)
})
