import { createClaudePaneHost } from '#features/code/be/services/claude-code/ui-pane-host.ts'
import type { ClaudeUiPaneRoster } from '#features/code/be/services/claude-code/ui-controls.ts'

function fixture() {
  let roster: ClaudeUiPaneRoster = { panes: [{ id: 'a', title: 'A', plugin: 'fixture' }, { id: 'b', title: 'B', plugin: 'fixture' }], shown_id: 'a', focused_id: null, focus_requested_id: null }
  let current = true, handle = 0
  const ui = {
    scroll: vi.fn(async () => ({ moved: true, offset: 0 })),
    panes: vi.fn(async () => roster),
    showPane: vi.fn(async ({ id }: { id: string }) => { roster = { ...roster, shown_id: id }; return { shown_id: id } }),
    focusPane: vi.fn(async ({ id }: { id: string | null }) => { roster = { ...roster, focused_id: id }; return { focused_id: id } }),
    closePane: vi.fn(async () => ({ closed: false })),
    render: vi.fn(async () => ({ tree: { type: 'Box', children: [
      { type: 'Button', props: { key: 'run', label: 'Run' }, press: { plugin: 'fixture', handle: ++handle } },
      { type: 'Input', props: { key: 'draft', value: '', label: 'Draft' }, press: { plugin: 'fixture', handle: ++handle } },
    ] }, props: {}, hooked: true, rewritten: true })),
    press: vi.fn(async () => ({ handled: true })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })),
    focus: vi.fn(async () => ({ moved: true, element: null as { plugin: string; key: string } | null })),
  }
  const publish = vi.fn(), requestFocus = vi.fn(), actionKeys = vi.fn()
  const host = createClaudePaneHost({ ui, client: { client_id: 'view', surface: 'desktop' }, current: () => current, publish, requestFocus, actionKeys })
  const nodes = () => { const body = host.state?.body; if (body?.status !== 'live' || body.tree.kind !== 'box') throw Error('expected pane body'); return body.tree.children }
  return { host, ui, publish, requestFocus, actionKeys, nodes, replace: () => { current = false }, roster: (next: ClaudeUiPaneRoster) => { roster = next } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('reads the roster on mount, draws the shown native site and forwards measured dimensions', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.panes).toHaveBeenCalledWith('view')
  await f.host.operate({ kind: 'layout', id: 'a', columns: 54, rows: 7, offset: 2 }); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'Pane', instance_id: 'a', props: expect.objectContaining({ bodyColumns: 54, scroll: { offset: 2, bodyRows: 7 } }) }))
  f.host.dispose()
})
it('keeps a denied-close pane and retires its old action without retrying it', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  await f.host.operate({ kind: 'close', id: 'a' })
  expect(f.host.state?.roster.shown_id).toBe('a')
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state?.body.status).toBe('live'); expect(f.ui.closePane).toHaveBeenCalledTimes(1)
  f.host.dispose()
})
it('routes pane fields by site and keeps them mounted while their acknowledgement redraws', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const input = f.nodes()[1]; if (input.kind !== 'input') throw Error('input')
  await f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'new text' })
  expect(f.ui.input).toHaveBeenCalledWith(expect.objectContaining({ component: 'Pane', instance_id: 'a', value: 'new text' }))
  expect(f.host.state?.body.status).toBe('live')
  await vi.advanceTimersByTimeAsync(50)
  expect(f.nodes()[1]).toMatchObject({ actionId: input.actionId, revision: 1 })
  await expect(f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'duplicate' })).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('refuses foreign pane controls, hidden-site fields and callbacks from the previous tab', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('nodes')
  await f.host.operate({ kind: 'close', id: 'foreign' }); expect(f.ui.closePane).not.toHaveBeenCalled()
  await f.host.operate({ kind: 'show', id: 'b' }); await vi.advanceTimersByTimeAsync(50)
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.field({ actionId: input.actionId, revision: 2, kind: 'change', value: 'foreign' })).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('never publishes or applies actions after replacement/disposal', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  const count = f.publish.mock.calls.length; f.replace()
  f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' }); await vi.advanceTimersByTimeAsync(100)
  expect(f.publish).toHaveBeenCalledTimes(count)
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  f.host.dispose(); expect(f.host.state).toBeUndefined()
})
it('holds and reports focus against the exact Pane site and ignores a foreign focus id', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  await expect(f.host.focus({ paneId: 'b', revision: 1, isHeld: true, by: 'person' })).resolves.toBeUndefined()
  await expect(f.host.focus({ paneId: 'a', focusId: 'foreign', revision: 1, isHeld: true, by: 'person' })).resolves.toBeUndefined()
  expect(f.ui.focus).not.toHaveBeenCalled()
  await expect(f.host.focus({ paneId: 'a', focusId: null, revision: 1, isHeld: true, by: 'person' })).resolves.toMatchObject({ paneId: 'a', revision: 1, focusId: null })
  expect(f.ui.focus).toHaveBeenCalledWith(expect.objectContaining({ component: 'Pane', instance_id: 'a' }))
  f.host.dispose()
})


it('keeps pane controls live while a native tool group changes',async()=>{
 const f=fixture();await f.host.start();await vi.advanceTimersByTimeAsync(50)
 const before=f.ui.render.mock.calls.length,button=f.nodes()[0];if(button.kind!=='button')throw Error('button')
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]})
 await vi.advanceTimersByTimeAsync(100)
 expect(f.ui.render).toHaveBeenCalledTimes(before)
 await expect(f.host.press(button.actionId!)).resolves.toEqual({handled:true})
 f.host.dispose()
})

it('publishes the returned pane shortcut revision before its replacement body becomes live', async () => {
  const f = fixture()
  const keys = { revision: 'a'.repeat(64), bindings: [], continuations: [], pending: null }
  f.ui.render.mockImplementation(async () => ({ tree: { type: 'Box', children: [] }, props: {}, hooked: true, rewritten: true, _apack_action_keys: keys }))
  await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.actionKeys).toHaveBeenLastCalledWith(keys)
  f.ui.closePane.mockImplementation(async () => {
    f.roster({ panes: [{ id: 'b', title: 'B', plugin: 'fixture' }], shown_id: 'b', focused_id: null, focus_requested_id: null })
    return { closed: true }
  })
  keys.revision = 'b'.repeat(64)
  await f.host.operate({ kind: 'close', id: 'a' }); await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state?.roster.shown_id).toBe('b')
  expect(f.host.state?.body.status).toBe('live')
  expect(f.actionKeys).toHaveBeenLastCalledWith(keys)
  expect(f.actionKeys.mock.invocationCallOrder.at(-1)).toBeLessThan(f.publish.mock.invocationCallOrder.at(-1)!)
  f.host.dispose()
})

it('publishes the final-close shortcut snapshot before removing the last pane', async () => {
  const f = fixture(); await f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const keys = { revision: 'c'.repeat(64), bindings: [], continuations: [], pending: null }
  f.ui.closePane.mockImplementation(async () => {
    f.roster({ panes: [], shown_id: null, focused_id: null, focus_requested_id: null, _apack_action_keys: keys })
    return { closed: true }
  })
  await f.host.operate({ kind: 'close', id: 'a' })
  expect(f.host.state).toBeUndefined()
  expect(f.actionKeys).toHaveBeenLastCalledWith(keys)
  expect(f.actionKeys.mock.invocationCallOrder.at(-1)).toBeLessThan(f.publish.mock.invocationCallOrder.at(-1)!)
  f.host.dispose()
})
