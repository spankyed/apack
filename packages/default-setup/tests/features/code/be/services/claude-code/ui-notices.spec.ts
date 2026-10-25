import { createClaudeUiNotices } from '#features/code/be/services/claude-code/ui-notices.ts'

function fixture() {
  let current = true, sessionId: string | undefined = 'native-session'
  const publish = vi.fn(), host = createClaudeUiNotices({ current: () => current, sessionId: () => sessionId, publish })
  const event = (subtype: string, uuid: string, text: string | null, extra = {}) => ({ type: 'system', subtype, uuid, text, plugin: 'fixture', session_id: sessionId, ...extra })
  return { host, publish, event, replace: () => { current = false }, session: (id: string) => { sessionId = id } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers() })
it('replaces and clears pinned plugin lines, rejects foreign/malformed notices and suppresses replay', () => {
  const f = fixture(); f.host.receive(f.event('ui_status', 'a', '<b>literal</b>'))
  expect(f.host.state?.statuses).toEqual([{ plugin: 'fixture', text: '<b>literal</b>' }])
  f.host.receive(f.event('ui_status', 'b', 'Updated')); f.host.receive(f.event('ui_status', 'b', 'Wrong replay'))
  f.host.receive(f.event('ui_status', 'c', 'Foreign', { session_id: 'foreign' })); f.host.receive(f.event('ui_toast', 'd', 'Malformed', { timeout_ms: NaN }))
  expect(f.host.state?.statuses).toEqual([{ plugin: 'fixture', text: 'Updated' }]); expect(f.host.state?.toasts).toEqual([])
  f.host.receive(f.event('ui_status', 'other', 'Other', { plugin: 'other' })); f.host.receive(f.event('ui_status', 'updated', 'Latest'))
  expect(f.host.state?.statuses.map(row => row.plugin)).toEqual(['other', 'fixture'])
  f.host.receive(f.event('ui_status', 'e', null)); f.host.receive(f.event('ui_status', 'other-clear', null, { plugin: 'other' })); expect(f.host.state).toBeUndefined(); f.host.dispose()
})
it('pauses current and queued toast lifetimes while the shown pane holds toasts', async () => {
  const f = fixture(); f.host.receive(f.event('ui_toast', 'a', 'First', { timeout_ms: 1000 }))
  await vi.advanceTimersByTimeAsync(400); f.host.setHeld(true)
  f.host.receive(f.event('ui_toast', 'b', 'Queued', { timeout_ms: 800 }))
  f.host.receive(f.event('ui_status', 'c', 'Pinned'))
  await vi.advanceTimersByTimeAsync(5000); expect(f.host.state?.toasts).toEqual([]); expect(f.host.state?.statuses).toHaveLength(1)
  f.host.setHeld(false); expect(f.host.state?.toasts.map(row => row.text)).toEqual(['First', 'Queued'])
  await vi.advanceTimersByTimeAsync(601); expect(f.host.state?.toasts.map(row => row.text)).toEqual(['Queued'])
  await vi.advanceTimersByTimeAsync(200); expect(f.host.state?.toasts).toEqual([]); f.host.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('bounds the toast stack fairly between plugins and discards notices on reset/disposal', () => {
  const f = fixture(); f.host.setHeld(true)
  f.host.receive(f.event('ui_toast', 'other', 'Keep other plugin', { plugin: 'other', timeout_ms: 1000 }))
  for (let index = 0; index < 60; index++) f.host.receive(f.event('ui_toast', `row-${index}`, String(index), { timeout_ms: 1000 }))
  f.host.setHeld(false); expect(f.host.state?.toasts).toHaveLength(50); expect(f.host.state?.toasts.some(row => row.plugin === 'other')).toBe(true)
  f.host.receive({ type: 'conversation_reset' }); expect(f.host.state).toBeUndefined(); expect(vi.getTimerCount()).toBe(0)
  f.host.receive(f.event('ui_toast', 'last', 'Current', { timeout_ms: 1000 })); f.host.dispose(); expect(f.host.state).toBeUndefined(); expect(vi.getTimerCount()).toBe(0)
  f.host.receive(f.event('ui_status', 'late', 'Late')); expect(f.host.state).toBeUndefined()
})
it('retires notice state on native session replacement and refuses a replaced owner', () => {
  const f = fixture(); f.host.receive(f.event('ui_status', 'a', 'Old'))
  f.session('replacement'); f.host.receive({ type: 'system', subtype: 'init', session_id: 'replacement' }); expect(f.host.state).toBeUndefined()
  f.host.receive(f.event('ui_status', 'b', 'New')); expect(f.host.state?.statuses[0].text).toBe('New')
  f.replace(); f.host.receive(f.event('ui_status', 'c', 'Late')); expect(f.host.state?.statuses[0].text).toBe('New'); f.host.dispose()
})

it('holds reading lifetimes for hover/focus, composes pane pauses and caps a continuous hold at thirty seconds', async () => {
  const f = fixture(); f.host.receive(f.event('ui_toast', 'a', 'Read me', { timeout_ms: 1000 }))
  await vi.advanceTimersByTimeAsync(400); f.host.operate({ kind: 'hold', id: 'a', isHeld: true })
  await vi.advanceTimersByTimeAsync(5000); f.host.setHeld(true); await vi.advanceTimersByTimeAsync(10000); f.host.setHeld(false)
  f.host.operate({ kind: 'hold', id: 'a', isHeld: false }); await vi.advanceTimersByTimeAsync(599)
  expect(f.host.state?.toasts).toHaveLength(1); await vi.advanceTimersByTimeAsync(2); expect(f.host.state).toBeUndefined()
  f.host.receive(f.event('ui_toast', 'b', 'Capped', { timeout_ms: 1000 })); f.host.operate({ kind: 'hold', id: 'b', isHeld: true })
  await vi.advanceTimersByTimeAsync(30000); expect(f.host.state?.toasts).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1001); expect(f.host.state).toBeUndefined()
  f.host.receive(f.event('ui_toast', 'c', 'Dismiss', { timeout_ms: 1000 })); f.host.operate({ kind: 'dismiss', id: 'foreign' }); expect(f.host.state?.toasts).toHaveLength(1)
  f.host.operate({ kind: 'dismiss', id: 'c' }); expect(f.host.state).toBeUndefined(); expect(vi.getTimerCount()).toBe(0); f.host.dispose()
})

it('keeps native notification titles and long bodies without accepting refused channels', () => {
  const f=fixture(),text='Release detail '.repeat(1000)
  f.host.receive(f.event('ui_notification','accepted',text,{title:'Release review',channel:'terminal_bell',timeout_ms:5000}))
  expect(f.host.state?.toasts).toEqual([{id:'accepted',plugin:'fixture',title:'Release review',text}])
  f.host.receive(f.event('ui_notification','disabled','Refused',{title:'Title',channel:'disabled',timeout_ms:5000}))
  f.host.receive(f.event('ui_toast','oversized',text,{timeout_ms:5000}))
  expect(f.host.state?.toasts).toHaveLength(1);f.host.dispose()
})
