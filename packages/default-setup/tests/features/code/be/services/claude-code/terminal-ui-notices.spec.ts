import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture() {
  let sessionId = 'first', clock = 1000, sequence = 0
  const events: Record<string, unknown>[] = [], clients = new Set<string>()
  const start = claudeTerminalUiRuntime.indexOf('const noticeStatuses=')
  const end = claudeTerminalUiRuntime.indexOf('// Native hook dispatch')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({recordNotice,replayNotices,installNotices})`, {
    config: { sessionId }, configUrl: 'private-config', readFileSync: () => JSON.stringify({ sessionId }),
    randomUUID: () => `notice-${++sequence}`, clients, publish: (event: Record<string, unknown>) => events.push(event), Date: { now: () => clock },
  }) as {
    recordNotice(kind: string, plugin: string, text: string | undefined, timeout?: number): void
    replayNotices(): void
    installNotices(native: unknown, context: unknown): void
  }
  return { api, clients, events, advance(ms: number) { clock += ms }, replace() { sessionId = 'second' } }
}

it('replays latest statuses and bounded recent first-attachment transients with stable identities', () => {
  const f = fixture()
  f.api.recordNotice('ui_status', 'fixture', 'old')
  f.api.recordNotice('ui_status', 'fixture', 'latest')
  for (let n = 0; n < 25; n++) f.api.recordNotice('ui_toast', 'fixture', `toast-${n}`, 1000)
  f.api.replayNotices()
  expect(f.events).toHaveLength(21)
  expect(f.events.filter(event => event.subtype === 'ui_status').map(event => event.text)).toEqual(['latest'])
  expect(f.events[1]!.text).toBe('toast-5')
  const identity = f.events[0]!.uuid
  f.events.length = 0; f.api.replayNotices()
  expect(f.events).toHaveLength(1); expect(f.events[0]!.uuid).toBe(identity)
  f.api.recordNotice('ui_status', 'fixture', undefined)
  f.events.length = 0; f.api.replayNotices(); expect(f.events[0]!.text).toBeNull()
  f.replace(); f.events.length = 0; f.api.replayNotices(); expect(f.events).toEqual([])
})

it('expires old buffered toasts and wraps inherited native methods only once', () => {
  const f = fixture(), toast = vi.fn(), status = vi.fn()
  f.api.recordNotice('ui_toast', 'fixture', 'expired', 1000)
  f.advance(60001); f.api.replayNotices(); expect(f.events).toEqual([])
  const context = { surface: 'terminal', toast, status }
  f.api.installNotices({ runtime: { o7t: 5000 } }, context)
  const inherited = { ...context }
  f.api.installNotices({ runtime: { o7t: 5000 } }, inherited)
  f.clients.add('app'); inherited.toast('fixture', 'live')
  expect(toast).toHaveBeenCalledExactlyOnceWith('fixture', 'live')
  expect(f.events).toHaveLength(1)
  expect(f.events[0]).toMatchObject({ text: 'live', timeout_ms: 5000, session_id: 'first' })
})
