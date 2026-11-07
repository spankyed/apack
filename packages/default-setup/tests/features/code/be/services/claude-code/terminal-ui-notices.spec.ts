import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture() {
  let sessionId = 'first', clock = 1000, sequence = 0, policyGeneration = 0
  const events: Record<string, unknown>[] = [], clients = new Set<string>()
  const start = claudeTerminalUiRuntime.indexOf('const noticeStatuses=')
  const end = claudeTerminalUiRuntime.indexOf('// Native hook dispatch')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({recordNotice,replayNotices,installNotices})`, {
    config: { sessionId }, configUrl: 'private-config', readFileSync: () => JSON.stringify({ sessionId, policyGeneration: String(policyGeneration) }), helperPolicyReader: () => 'allowed',
    randomUUID: () => `notice-${++sequence}`, clients, publish: (event: Record<string, unknown>) => events.push(event), Date: { now: () => clock },
  }) as {
    recordNotice(kind: string, plugin: string, text: string | undefined, timeout?: number): void
    replayNotices(): void
    installNotices(native: unknown, context: unknown): void
  }
  return { api, clients, events, advance(ms: number) { clock += ms }, replace() { sessionId = 'second' }, rotatePolicy() { policyGeneration++ } }
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

it('presents only admitted native notifications with their actual title and originating plugin', async () => {
  const f=fixture();f.clients.add('app')
  const notify=vi.fn(async(_data:unknown,_origin:unknown)=>'terminal_bell')
  const context={surface:'terminal',toast:vi.fn(),status:vi.fn(),notify}
  f.api.installNotices({runtime:{o7t:5000,ey:()=>context}},context)
  const data={notificationType:'plugin_notification',title:'Release review',message:'Needs attention'}
  const origin=[{plugin:'fixture',registration:1}]
  expect(await context.notify(data,origin)).toBe('terminal_bell')
  expect(notify).toHaveBeenCalledExactlyOnceWith(data,origin)
  expect(f.events).toHaveLength(1)
  expect(f.events[0]).toMatchObject({subtype:'ui_notification',plugin:'fixture',title:'Release review',text:'Needs attention',channel:'terminal_bell',session_id:'first'})
})
it.each(['disabled','none','no_method_available','no_surface'])('does not invent app delivery for native %s', async result => {
  const f=fixture();f.clients.add('app')
  const context={surface:'terminal',toast:vi.fn(),status:vi.fn(),notify:async(_data:unknown,_origin:unknown)=>result}
  f.api.installNotices({runtime:{o7t:5000,ey:()=>context}},context)
  expect(await context.notify({notificationType:'plugin_notification',title:'Title',message:'Body'},['fixture'])).toBe(result)
  expect(f.events).toEqual([])
})
it.each(['session','policy','context'] as const)('refuses late app notification after %s ownership changes', async change => {
  const f=fixture();f.clients.add('app');let finish!:(value:string)=>void
  const context={surface:'terminal',toast:vi.fn(),status:vi.fn(),notify:(_data:unknown,_origin:unknown)=>new Promise<string>(resolve=>{finish=resolve})}
  let current:unknown=context
  f.api.installNotices({runtime:{o7t:5000,ey:()=>current}},context)
  const pending=context.notify({notificationType:'plugin_notification',title:'Title',message:'Body'},['fixture'])
  if(change==='session')f.replace()
  else if(change==='policy'){f.rotatePolicy();f.rotatePolicy()}
  else current={}
  finish('terminal_bell');expect(await pending).toBe('terminal_bell');expect(f.events).toEqual([])
})
it('preserves original native notification hook errors without presenting success', async () => {
  const f=fixture();f.clients.add('app');const refusal=new Error('Original hook refused')
  const context={surface:'terminal',toast:vi.fn(),status:vi.fn(),notify:async(_data:unknown,_origin:unknown)=>{throw refusal}}
  f.api.installNotices({runtime:{o7t:5000,ey:()=>context}},context)
  await expect(context.notify({notificationType:'plugin_notification',title:'Title',message:'Body'},['fixture'])).rejects.toBe(refusal)
  expect(f.events).toEqual([])
})
