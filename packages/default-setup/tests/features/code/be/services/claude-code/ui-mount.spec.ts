import type { ClaudePromptHost } from '#features/code/be/services/claude-code/ui-prompt-host.ts'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'
import { mountClaudeUi } from '#features/code/be/services/claude-code/ui-mount.ts'
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const rendered = (handle = 1) => ({ tree: { type: 'Button', props: { label: 'Run', key: 'run' }, press: { plugin: 'fixture', handle } }, props: {}, rewritten: true, hooked: true })
function fixture() {
  const done = deferred<void>()
  const states: ClaudeUiMountState[] = []
  const focusRequests: string[] = []
  const listeners = new Set<(event: StreamLine) => void>()
  const ui = { toolGroups:vi.fn(async()=>[]), releaseInstance: vi.fn(async () => ({ released: true })), prepareParentCommand: vi.fn<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiControls['prepareParentCommand']>(async () => ({ kind: 'not_command' })), startParentCommand: vi.fn(async () => ({ kind: 'running' as const, id: '12345678-1234-1234-1234-123456789abc' })), readParentCommand: vi.fn<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiControls['readParentCommand']>(async () => ({ kind: 'finished', id: '12345678-1234-1234-1234-123456789abc', result: { kind: 'command_complete', commandName: 'clear', messageId: '12345678-1234-1234-1234-123456789abc' } })), agentPanel: vi.fn(async (_options: unknown) => ({ open: false })), answerAgentCommand: vi.fn(async (_options: unknown) => ({ answered: true as const })), submitAgent: vi.fn<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiControls['submitAgent']>(async () => ({ kind: 'input' as const, messageId: '12345678-1234-1234-1234-123456789abc', previousStatus: 'running' })), clientEvent: vi.fn(async () => ({handled:true})), scroll: vi.fn(async () => ({ moved: true, offset: 0 })), panes: vi.fn(async () => ({ panes: [], shown_id: null, focused_id: null, focus_requested_id: null })), showPane: vi.fn(async () => ({ shown_id: null })), focusPane: vi.fn(async () => ({ focused_id: null })), closePane: vi.fn(async () => ({ closed: true })), servePrompt: vi.fn(() => () => {}), focus: vi.fn(async (_options: unknown) => ({ moved: true, element: null as { plugin: string; key: string } | null })), promptAutocomplete: vi.fn(async () => ({ suggestions: [{ text: 'native', label: 'Native row' }], start: 0 })), promptEdit: vi.fn(async () => ({ text: 'native draft', cursor: 12 })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })), attach: vi.fn(async (_options:{client_id:string}) => ({ surfaces: ['desktop' as const] })),
    detach: vi.fn(async () => ({ detached: true, surfaces: [] })),
    render: vi.fn<() => Promise<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiRenderResult>>(async () => rendered()), press: vi.fn(async () => ({ handled: true })) }
  let current = true
  const owner = { handle: { ui }, done: done.promise, subscribe(listener: (event: StreamLine) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const mount = (promptHost?: ClaudePromptHost) => mountClaudeUi({ owner, promptHost, isCurrent: () => current, publish: state => { states.push(state) }, requestFocus: id => { focusRequests.push(id) } })
  const invalidate = (local=false) => { for (const listener of listeners) listener({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render',...(local?{client_snapshot:true,client_id:ui.attach.mock.calls.at(-1)?.[0]?.client_id}:{}) } as StreamLine) }
  const action = () => { const last = states.at(-1); if (last?.status !== 'live' || last.tree.kind !== 'button' || !last.tree.actionId) throw new Error('expected live button'); return last.tree.actionId }
  return { mount, owner, ui, states, focusRequests, done, listeners, invalidate, action, replace: () => { current = false } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('native UI mounted lifecycle', () => {
  it('coalesces invalidations, retires old actions and uses one attachment without a conversation input', async () => {
    const f = fixture(); const view = f.mount()
    await view.ready; await vi.advanceTimersByTimeAsync(50)
    const old = f.action()
    const updates = f.states.length
    for (let i = 0; i < 100; i++) f.invalidate()
    expect(f.states.length - updates).toBe(1)
    await expect(view.press(old)).resolves.toEqual({ handled: false })
    expect(f.ui.press).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(f.ui.render).toHaveBeenCalledTimes(2)
    expect(f.ui.attach).toHaveBeenCalledTimes(1)
    expect(f.action()).not.toBe(old)
    await view.dispose()
    expect(f.ui.detach).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
    expect(f.states.at(-1)).toEqual({ status: 'disconnected' })
  })

  it('discards an invalidated in-flight render and never overlaps render requests', async () => {
    const f = fixture(); const pending = deferred<ReturnType<typeof rendered>>()
    f.ui.render.mockImplementationOnce(() => pending.promise)
    const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
    f.invalidate(); await vi.advanceTimersByTimeAsync(500)
    expect(f.ui.render).toHaveBeenCalledTimes(1)
    pending.resolve(rendered(7)); await Promise.resolve(); await vi.advanceTimersByTimeAsync(50)
    expect(f.ui.render).toHaveBeenCalledTimes(2)
    expect(f.states.filter(state => state.status === 'live')).toHaveLength(1)
    await view.dispose()
  })

  it('allows concurrent views only their own callbacks and independent detach', async () => {
    const f = fixture(); const first = f.mount(); const second = f.mount()
    await Promise.all([first.ready, second.ready]); await vi.advanceTimersByTimeAsync(50)
    const live = f.states.filter(state => state.status === 'live')
    const node = live[0]!.tree
    if (node.kind !== 'button') throw new Error('expected button')
    await expect(second.press(node.actionId!)).resolves.toEqual({ handled: false })
    await first.dispose()
    expect(f.listeners.size).toBe(1)
    expect(f.ui.attach.mock.calls[0]).not.toEqual(f.ui.attach.mock.calls[1])
    await second.dispose()
  })

  it('retires a press before awaiting its reply and preserves a successful invalidating native press', async () => {
    const f = fixture(); const pending = deferred<{ handled: boolean }>()
    f.ui.press.mockImplementationOnce(() => pending.promise)
    const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
    const id = f.action(); const press = view.press(id)
    await expect(view.press(id)).resolves.toEqual({ handled: false })
    f.invalidate(); pending.resolve({ handled: true })
    await expect(press).resolves.toEqual({ handled: true })
    expect(f.ui.press).toHaveBeenCalledTimes(1)
    await view.dispose()
  })

  it('never retries a lost press reply and preserves handled:false', async () => {
    const f = fixture(); const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
    f.ui.press.mockRejectedValueOnce(new Error('lost reply'))
    await expect(view.press(f.action())).rejects.toThrow('lost reply')
    expect(f.ui.press).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    f.ui.press.mockResolvedValueOnce({ handled: false })
    await expect(view.press(f.action())).resolves.toEqual({ handled: false })
    expect(f.ui.press).toHaveBeenCalledTimes(2)
    await view.dispose()
  })

  it('detaches after an attachment completes even if unmounted while attaching', async () => {
    const f = fixture(); const attached = deferred<{ surfaces: ['desktop'] }>()
    f.ui.attach.mockImplementationOnce(() => attached.promise)
    const view = f.mount(); const disposal = view.dispose()
    attached.resolve({ surfaces: ['desktop'] }); await disposal
    await vi.advanceTimersByTimeAsync(100)
    expect(f.ui.detach).toHaveBeenCalledTimes(1)
    expect(f.ui.render).not.toHaveBeenCalled()
    await view.dispose(); expect(f.ui.detach).toHaveBeenCalledTimes(1)
  })

  it.each(['exit', 'replacement'] as const)('disconnects on process %s and rejects old actions', async cause => {
    const f = fixture(); const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
    const id = f.action()
    if (cause === 'exit') { f.done.resolve(); await Promise.resolve() } else f.replace()
    await expect(view.press(id)).resolves.toEqual({ handled: false })
    await view.dispose()
    expect(f.ui.press).not.toHaveBeenCalled()
    expect(f.ui.detach).toHaveBeenCalledTimes(1)
  })

  it('cleans up an attachment whose reply was lost without retrying it', async () => {
    const f = fixture(); f.ui.attach.mockRejectedValueOnce(new Error('lost attachment reply'))
    const view = f.mount(); await view.ready
    expect(f.states.at(-1)).toMatchObject({ status: 'error', message: 'lost attachment reply' })
    await expect(view.editPrompt({ revision: 1, by: 'app', text: 'draft', cursor: 5 })).resolves.toEqual({ revision: 1, status: 'error', message: 'lost attachment reply' })
    await view.dispose()
    expect(f.ui.attach).toHaveBeenCalledTimes(1)
    expect(f.ui.detach).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
  })

  it('discards a render reply after unmount and contains malformed native output', async () => {
    const f = fixture(); const pending = deferred<ReturnType<typeof rendered>>()
    f.ui.render.mockImplementationOnce(() => pending.promise)
    const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
    await view.dispose(); pending.resolve(rendered()); await Promise.resolve()
    expect(f.states.at(-1)).toEqual({ status: 'disconnected' })
    expect(f.states.some(state => state.status === 'live')).toBe(false)
    const other = f.mount(); f.ui.render.mockResolvedValueOnce({ ...rendered(), tree: { type: 'Button' } })
    await other.ready; await vi.advanceTimersByTimeAsync(50)
    expect(f.states.at(-1)).toMatchObject({ status: 'error' })
    await other.dispose()
  })
})


it('routes keyed field edits through invalidation and rejects foreign or removed field authority', async () => {
  const f = fixture()
  const field = { type: 'Input', props: { key: 'draft', value: '', rows: 2 }, press: { plugin: 'fixture', handle: 7 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: field })
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const live = f.states.at(-1)!
  if (live.status !== 'live' || live.tree.kind !== 'input') throw new Error('expected input')
  const actionId = live.tree.actionId
  f.invalidate()
  await expect(view.field({ revision: 1, actionId, kind: 'change', value: 'typed' })).resolves.toEqual({ handled: true })
  expect(f.ui.input).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'fixture', handle: 7, key: 'draft', component: 'AbovePrompt', kind: 'change', value: 'typed' }))
  await expect(view.field({ revision: 1, actionId: 'foreign', kind: 'submit', value: 'bad' })).resolves.toEqual({ handled: false })
  f.ui.render.mockResolvedValue(rendered()); await vi.advanceTimersByTimeAsync(50)
  await expect(view.field({ revision: 1, actionId, kind: 'submit', value: 'bad' })).resolves.toEqual({ handled: false })
  await view.dispose()
})

it('checks select membership before native dispatch and retires it on disposal', async () => {
  const f = fixture()
  const field = { type: 'Select', props: { key: 'pick', options: [{ value: 'a' }, { value: 'b' }] }, press: { plugin: 'fixture', handle: 8 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: field })
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const live = f.states.at(-1)!
  if (live.status !== 'live' || live.tree.kind !== 'select') throw new Error('expected select')
  const actionId = live.tree.actionId
  await expect(view.field({ revision: 1, actionId, kind: 'select', value: 'foreign' })).resolves.toEqual({ handled: false })
  expect(f.ui.select).not.toHaveBeenCalled()
  await expect(view.field({ revision: 1, actionId, kind: 'select', value: 'b' })).resolves.toEqual({ handled: true })
  expect(f.ui.select).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'fixture', handle: 8, key: 'pick', value: 'b' }))
  await view.dispose()
  await expect(view.field({ revision: 1, actionId, kind: 'select', value: 'a' })).resolves.toEqual({ handled: false })
  expect(f.ui.select).toHaveBeenCalledTimes(1)
})


it('accepts only the latest native draft reply and retires edits with the native owner', async () => {
  const f = fixture(), first = deferred<{ text: string; cursor: number }>(), second = deferred<{ text: string; cursor: number }>()
  f.ui.promptEdit.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const view = f.mount(); await view.ready
  const old = view.editPrompt({ revision: 1, by: 'person', text: 'old', cursor: 3 }); await Promise.resolve()
  const latest = view.editPrompt({ revision: 2, by: 'person', text: 'new', cursor: 3 }); await Promise.resolve()
  second.resolve({ text: 'NEW', cursor: 3 })
  await expect(latest).resolves.toEqual({ revision: 2, status: 'applied', frame: { text: 'NEW', cursor: 3 } })
  first.resolve({ text: 'OLD', cursor: 3 }); await expect(old).resolves.toBeUndefined()
  await expect(view.editPrompt({ revision: 1, by: 'app', text: '', cursor: 0 })).resolves.toBeUndefined()
  expect(f.ui.promptEdit).toHaveBeenCalledTimes(2)
  const pending = deferred<{ text: string; cursor: number }>()
  f.ui.promptEdit.mockImplementationOnce(() => pending.promise)
  const retiring = view.editPrompt({ revision: 3, by: 'app', text: 'history', cursor: 7 }); await Promise.resolve()
  f.replace(); pending.resolve({ text: 'history', cursor: 7 }); await expect(retiring).resolves.toBeUndefined()
  await view.dispose()
})

it('keeps a native edit failure separate from mounted controls and delivers superseded acknowledgments to settle the composer', async () => {
  const f = fixture(), view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  f.ui.promptEdit.mockRejectedValueOnce(new Error('native edit failed'))
  await expect(view.editPrompt({ revision: 1, by: 'person', text: 'draft', cursor: 5 })).resolves.toEqual({ revision: 1, status: 'error', message: 'native edit failed' })
  expect(f.states.at(-1)?.status).toBe('live')
  f.ui.promptEdit.mockResolvedValueOnce({ text: 'draft', cursor: 5, superseded: true } as { text: string; cursor: number })
  await expect(view.editPrompt({ revision: 2, by: 'person', text: 'draft', cursor: 5 })).resolves.toMatchObject({ revision: 2, status: 'applied', frame: { superseded: true } })
  await view.dispose()
})


it('forwards only authorized Markdown URLs to the native callback and retires them after a click', async () => {
  const f = fixture()
  const doc = { type: 'Markdown', props: { key: 'doc', text: '[Open](https://example.com/)', pressableLinks: ['https://example.com/'] }, press: { plugin: 'fixture', handle: 9 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: doc })
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const live = f.states.at(-1)!
  if (live.status !== 'live' || live.tree.kind !== 'markdown' || !live.tree.actionId) throw new Error('expected Markdown')
  const id = live.tree.actionId
  await expect(view.press(id, 'javascript:bad()')).resolves.toEqual({ handled: false })
  await expect(view.press(id, 'https://foreign.example/')).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  await expect(view.press(id, 'https://example.com/')).resolves.toEqual({ handled: true })
  expect(f.ui.press).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'fixture', handle: 9, key: 'doc', href: 'https://example.com/' }))
  await expect(view.press(id, 'https://example.com/')).resolves.toEqual({ handled: false })
  await view.dispose()
})


it('stamps rendered field replacements only after native callbacks finish and refuses replayed edits', async () => {
  const f = fixture(), pending = deferred<{ handled: boolean }>()
  const field = { type: 'Input', props: { key: 'draft', value: '', submitLabel: 'send' }, press: { plugin: 'fixture', handle: 7 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: field })
  f.ui.input.mockImplementationOnce(() => pending.promise)
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const latest = () => { const live = f.states.at(-1)!; if (live.status !== 'live' || live.tree.kind !== 'input') throw new Error('expected input'); return live.tree }
  const actionId = latest().actionId
  const edit = view.field({ actionId, revision: 1, kind: 'change', value: 'typed' }); await Promise.resolve()
  f.invalidate(); await vi.advanceTimersByTimeAsync(50)
  expect(latest().revision).toBe(0)
  expect(latest().submitLabel).toBe('send')
  pending.resolve({ handled: true }); await edit; await vi.advanceTimersByTimeAsync(50)
  expect(latest().revision).toBe(1)
  await expect(view.field({ actionId, revision: 1, kind: 'change', value: 'replay' })).resolves.toEqual({ handled: false })
  expect(f.ui.input).toHaveBeenCalledOnce()
  await view.dispose()
})


it('scopes autocomplete to the current owner and ignores rows overtaken by edits or newer asks', async () => {
  const f = fixture(), view = f.mount(); await view.ready
  const first = deferred<{ suggestions: { text: string; label: string }[]; start: number }>()
  f.ui.promptAutocomplete.mockImplementationOnce(() => first.promise)
  const old = view.autocompletePrompt({ revision: 1, text: 'tok', cursor: 3 }); await Promise.resolve()
  const current = await view.autocompletePrompt({ revision: 2, text: 'toke', cursor: 4 })
  expect(current).toMatchObject({ revision: 2, status: 'ready', result: { suggestions: [{ text: 'native' }] } })
  first.resolve({ suggestions: [{ text: 'old', label: 'Old' }], start: 0 }); await expect(old).resolves.toBeUndefined()
  const delayed = deferred<{ suggestions: { text: string; label: string }[]; start: number }>()
  f.ui.promptAutocomplete.mockImplementationOnce(() => delayed.promise)
  const editing = view.autocompletePrompt({ revision: 3, text: 'toke', cursor: 4 }); await Promise.resolve()
  await view.editPrompt({ revision: 1, text: 'new draft', cursor: 9, by: 'person' })
  delayed.resolve({ suggestions: [{ text: 'stale', label: 'Stale' }], start: 0 }); await expect(editing).resolves.toBeUndefined()
  await view.dispose()
  await expect(view.autocompletePrompt({ revision: 4, text: 'tok', cursor: 3 })).resolves.toBeUndefined()
})


it('routes only current mount focus identities and drops late replies after redraw or newer focus', async () => {
  const f = fixture(), view = f.mount()
  await view.ready; await vi.advanceTimersByTimeAsync(50)
  const latest = () => { const state = f.states.at(-1); if (state?.status !== 'live' || state.tree.kind !== 'button' || !state.tree.focusId) throw Error('missing focus identity'); return state.tree.focusId }
  const focusId = latest(), event = { revision: 1, isHeld: true, by: 'person' as const, focusId }
  f.ui.focus.mockResolvedValueOnce({ moved: true, element: { plugin: 'fixture', key: 'run' } })
  await expect(view.focus(event)).resolves.toEqual({ revision: 1, moved: true, focusId })
  expect(f.ui.focus).toHaveBeenCalledWith(expect.objectContaining({ component: 'AbovePrompt', instance_id: 'above-prompt', element: { plugin: 'fixture', key: 'run' } }))
  await expect(view.focus({ ...event, revision: 2, focusId: 'foreign' })).resolves.toBeUndefined()
  expect(f.ui.focus).toHaveBeenCalledTimes(1)
  const pending = deferred<{ moved: boolean; element: { plugin: string; key: string } | null }>()
  f.ui.focus.mockImplementationOnce(() => pending.promise)
  const old = view.focus({ ...event, revision: 3 }); await Promise.resolve()
  await expect(view.focus({ ...event, revision: 4, focusId: null, isHeld: false })).resolves.toEqual({ revision: 4, moved: true, focusId: null })
  pending.resolve({ moved: true, element: { plugin: 'fixture', key: 'run' } }); await expect(old).resolves.toBeUndefined()
  const redraw = deferred<{ moved: boolean; element: { plugin: string; key: string } | null }>()
  f.ui.focus.mockImplementationOnce(() => redraw.promise)
  const obsolete = view.focus({ ...event, revision: 5 }); await Promise.resolve()
  f.invalidate(); await vi.advanceTimersByTimeAsync(50)
  redraw.resolve({ moved: true, element: { plugin: 'fixture', key: 'run' } }); await expect(obsolete).resolves.toBeUndefined()
  expect(latest()).not.toBe(focusId)
  await expect(view.focus({ ...event, revision: 6 })).resolves.toBeUndefined()
  await view.dispose()
})

it('scopes plugin focus pushes to the attached client, canonical site and live drawing', async () => {
  const f = fixture(), view = f.mount()
  await view.ready; await vi.advanceTimersByTimeAsync(50)
  const clientId = (f.ui.attach.mock.calls[0] as unknown as [{ client_id: string }])[0].client_id
  const push = { type: 'system', subtype: 'ui_focus', client_id: clientId, component: 'AbovePrompt', instance_id: 'above-prompt', plugin: 'fixture', key: 'run' }
  const deliver = (value: object) => { for (const listener of f.listeners) listener(value as StreamLine) }
  for (const change of [{ client_id: 'foreign' }, { component: 'Pane' }, { instance_id: 'foreign' }, { plugin: 'foreign' }, { key: 'unknown' }]) deliver({ ...push, ...change })
  expect(f.focusRequests).toEqual([])
  deliver(push); expect(f.focusRequests).toHaveLength(1)
  f.invalidate(); deliver(push); expect(f.focusRequests).toHaveLength(1)
  await view.dispose(); deliver(push); expect(f.focusRequests).toHaveLength(1)
})


it('keeps fields mounted but retires visible button authority until fresh redraw actions arrive', async () => {
  const f = fixture()
  f.ui.render.mockResolvedValue({ ...rendered(), tree: { type: 'Box', children: [rendered().tree,
    { type: 'Input', props: { key: 'draft', value: '' }, press: { plugin: 'fixture', handle: 7 } },
  ] } })
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const tree = () => { const state = f.states.at(-1); if (state?.status !== 'live' || state.tree.kind !== 'box') throw Error('expected retained tree'); return state.tree }
  const oldButton = tree().children[0], field = tree().children[1]
  if (oldButton?.kind !== 'button' || field?.kind !== 'input') throw Error('expected controls')
  expect(oldButton.actionId).toBeTruthy()
  f.invalidate()
  expect(tree().children[0]).not.toHaveProperty('actionId'); expect(tree().children[1]).toEqual(field)
  await expect(view.press(oldButton.actionId!)).resolves.toEqual({ handled: false })
  await vi.advanceTimersByTimeAsync(50)
  const fresh = tree().children[0]
  if (fresh?.kind !== 'button') throw Error('expected button')
  expect(fresh.actionId).toBeTruthy(); expect(fresh.actionId).not.toBe(oldButton.actionId)
  await view.dispose()
})


it('unregisters a composer host when native attachment fails and does not reuse its registration', async () => {
  const f = fixture(), stop = vi.fn()
  f.ui.servePrompt.mockReturnValueOnce(stop)
  f.ui.attach.mockRejectedValueOnce(Error('no surface'))
  const view = f.mount({ read: async () => undefined, fill: async () => false })
  await view.ready
  expect(stop).toHaveBeenCalledOnce()
  expect(f.states.at(-1)).toEqual({ status: 'error', message: 'no surface' })
  await view.dispose(); expect(stop).toHaveBeenCalledOnce()
})

it('holds native toast lifetime with the shown pane and releases it after its native roster closes', async () => {
  const f = fixture()
  f.ui.panes.mockResolvedValueOnce({ panes: [{ id: 'hold', title: 'Hold', plugin: 'fixture', hold_toasts: true }], shown_id: 'hold', focused_id: null, focus_requested_id: null } as unknown as Awaited<ReturnType<typeof f.ui.panes>>)
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const toast = { type: 'system', subtype: 'ui_toast', uuid: 'toast', session_id: 'native-session', plugin: 'fixture', text: 'After pane', timeout_ms: 1000 } as StreamLine
  for (const listener of f.listeners) listener(toast)
  await vi.advanceTimersByTimeAsync(1500); expect(f.states.at(-1)?.notices).toBeUndefined()
  for (const listener of f.listeners) listener({ type: 'system', subtype: 'ui_panes' } as StreamLine)
  await vi.advanceTimersByTimeAsync(0); expect(f.states.at(-1)?.notices?.toasts).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1001); expect(f.states.at(-1)?.notices).toBeUndefined()
  await view.dispose()
})

it('keeps a Client container mounted during native redraws and routes its scoped input',async()=>{
 const f=fixture(),id='9b08a63e-78f6-46c5-9134-c6c64de30937'
 f.ui.render.mockResolvedValue({tree:{type:'NativeClient',props:{id,pointer:true,keys:true,width:30,height:3},children:[{type:'Button',props:{label:'Run',key:'run'},press:{plugin:'fixture',handle:1}}]},props:{},rewritten:true,hooked:true})
 const mount=f.mount();await mount.ready
 await vi.waitFor(()=>expect(f.states.at(-1)).toMatchObject({status:'live',tree:{kind:'client',id}}))
 expect(await mount.focus({revision:1,isHeld:true,by:'person'})).toBeUndefined()
 expect(f.ui.focus).toHaveBeenCalledWith(expect.objectContaining({is_held:true}))
 expect(f.ui.focus.mock.calls.at(-1)?.[0]).not.toHaveProperty('element')
 f.invalidate()
 expect(f.states.at(-1)).toMatchObject({status:'live',tree:{kind:'client',id,children:[{kind:'button'}]}})
 const state=f.states.at(-1);if(state?.status==='live'&&state.tree.kind==='client')expect('actionId' in state.tree.children[0]!).toBe(false)
 await mount.clientEvent({id,sequence:1,event:{kind:'key',key:'x'}})
 expect(f.ui.clientEvent).toHaveBeenCalledWith(expect.objectContaining({id,sequence:1,event:{kind:'key',key:'x'}}))
 await mount.dispose();expect(await mount.clientEvent({id,sequence:2,event:{kind:'key',key:'y'}})).toEqual({handled:false})
})

it('admits one displayed keyed Client action through a local snapshot redraw and keeps its identity',async()=>{
 const f=fixture(),id='9b08a63e-78f6-46c5-9134-c6c64de30937'
 const frame=(handle:number)=>({tree:{type:'NativeClient',props:{id,pointer:true,keys:true},children:[{type:'Button',props:{key:'increment',label:'Increment'},press:{plugin:'fixture',handle}}]},props:{},rewritten:true,hooked:true})
 f.ui.render.mockResolvedValue(frame(1));const view=f.mount();await view.ready
 await vi.waitFor(()=>expect(f.states.at(-1)).toMatchObject({status:'live',tree:{kind:'client'}}))
 const action=()=>{const state=f.states.at(-1);if(state?.status!=='live'||state.tree.kind!=='client'||state.tree.children[0]?.kind!=='button')throw Error('Expected Client button');return state.tree.children[0].actionId!}
 const original=action();f.invalidate(true);expect(action()).toBe(original)
 f.ui.render.mockResolvedValue(frame(2))
 await vi.waitFor(()=>expect(f.ui.render).toHaveBeenCalledTimes(2))
 expect(action()).toBe(original)
 expect(await view.press(original)).toEqual({handled:true});expect(f.ui.press).toHaveBeenCalledTimes(1)
 f.invalidate();expect(await view.press(original)).toEqual({handled:false})
 await view.dispose()
})

it('uses Agent snapshots and publishes exact native input receipts only on the selected mount', async () => {
  const f = fixture()
  Object.assign(f.owner, { sessionId: 'session', nativeView: { session_id: 'session', revision: 2, agent_id: 'agent' }, readAgent: vi.fn(async () => ({ taskId: 'agent', name: 'Worker', status: 'running', canMessage: true, canInput: true, messages: [{ uuid: 'native-user', role: 'user', text: 'Instruction', renderText: 'Instruction', origin: { kind: 'composer' } }], truncated: false })) })
  const mount = f.mount(); await mount.ready; await vi.advanceTimersByTimeAsync(100)
  expect(f.ui.attach).toHaveBeenCalledWith(expect.objectContaining({ native_view: { session_id: 'session', revision: 2, agent_id: 'agent' } }))
  expect(f.states.at(-1)?.agent?.messages[0]?.uuid).toBe('native-user')
  await mount.submitAgent(1, 'User reply')
  expect(f.ui.submitAgent).toHaveBeenCalledOnce()
  expect(f.states.at(-1)?.agentInput).toMatchObject({ revision: 1, status: 'done', receipt: { messageId: '12345678-1234-1234-1234-123456789abc' } })
  await mount.submitAgent(1, 'Duplicate reply'); expect(f.ui.submitAgent).toHaveBeenCalledOnce()
  f.ui.submitAgent.mockResolvedValueOnce({ kind: 'review', text: 'Clean reply', removed: 1 })
  await mount.submitAgent(2, 'Invisible reply')
  expect(f.states.at(-1)?.agentInput).toEqual({ revision: 2, status: 'review', review: { text: 'Clean reply', removed: 1 } })
  expect(f.states.at(-1)?.agentInput?.receipt).toBeUndefined()
  f.replace(); await mount.submitAgent(3, 'Stale reply'); expect(f.ui.submitAgent).toHaveBeenCalledTimes(2)
  await mount.dispose()
})

it('keeps confirmation separate from worker receipts and admits only its matching decision', async () => {
  const f = fixture(), commandId = '12345678-1234-1234-1234-123456789abc'
  Object.assign(f.owner, { nativeView: { session_id: 'session', revision: 2, agent_id: 'agent' } })
  f.ui.submitAgent.mockResolvedValueOnce({ kind: 'confirmation', id: commandId, title: 'Original native confirmation', confirmLabel: 'Run original command' })
  const mount = f.mount(); await mount.ready; await mount.submitAgent(1, '/compact')
  expect(f.states.at(-1)?.agentInput).toMatchObject({ revision: 1, status: 'confirmation', command: { id: commandId } })
  expect(f.states.at(-1)?.agentInput?.receipt).toBeUndefined()
  await mount.submitAgent(2, 'Do not submit behind the modal'); expect(f.ui.submitAgent).toHaveBeenCalledOnce()
  await mount.answerAgentCommand(1, 'foreign-command', 'confirm'); expect(f.ui.answerAgentCommand).not.toHaveBeenCalled()
  const answer = deferred<{ answered: true }>(); f.ui.answerAgentCommand.mockReturnValueOnce(answer.promise)
  const deciding = mount.answerAgentCommand(1, commandId, 'cancel')
  expect(f.states.at(-1)?.agentInput?.status).toBe('deciding')
  await mount.answerAgentCommand(1, commandId, 'confirm'); expect(f.ui.answerAgentCommand).toHaveBeenCalledOnce()
  answer.resolve({ answered: true }); await deciding
  expect(f.states.at(-1)?.agentInput).toMatchObject({ status: 'command_done', decision: 'cancel' })
  expect(f.states.at(-1)?.agentInput?.receipt).toBeUndefined()
  await mount.dispose()
})

it('publishes original parent command output without a worker delivery receipt', async () => {
  const f = fixture()
  Object.assign(f.owner, { nativeView: { session_id: 'session', revision: 2, agent_id: 'agent' } })
  f.ui.submitAgent.mockResolvedValueOnce({ kind: 'command_output', messageId: '12345678-1234-1234-1234-123456789abc', commandName: 'reload-skills', text: 'Original native output', isErrored: false, outcome: 'failed' })
  const mount = f.mount(); await mount.ready; await mount.submitAgent(1, '/reload-skills')
  expect(f.states.at(-1)?.agentInput).toEqual({ revision: 1, status: 'command_output', output: { messageId: '12345678-1234-1234-1234-123456789abc', commandName: 'reload-skills', text: 'Original native output', isErrored: false, outcome: 'failed' } })
  expect(f.states.at(-1)?.agentInput?.receipt).toBeUndefined()
  await mount.dispose()
})

it('keeps native panel input scoped and blocks worker submission until original closure', async () => {
  const f = fixture(), panelId = '12345678-1234-1234-1234-123456789abc'
  Object.assign(f.owner, { nativeView: { session_id: 'session', revision: 2, agent_id: 'agent' } })
  f.ui.submitAgent.mockResolvedValueOnce({ kind: 'panel', id: panelId, commandName: 'usage' })
  const mount = f.mount(); await mount.ready; await mount.submitAgent(1, '/cost')
  expect(f.states.at(-1)?.agentInput).toMatchObject({ status: 'panel', panel: { id: panelId } })
  await mount.submitAgent(2, 'Must not reach worker'); expect(f.ui.submitAgent).toHaveBeenCalledOnce()
  await mount.agentPanel(1, 'foreign'); expect(f.ui.agentPanel).not.toHaveBeenCalled()
  await mount.agentPanel(1, panelId)
  expect(f.ui.agentPanel).toHaveBeenCalledWith(expect.objectContaining({ panel_id: panelId, operation: 'close' }))
  expect(f.states.at(-1)?.agentInput).toEqual({ revision: 1, status: 'panel_done' })
  await mount.dispose()
})


it('classifies ordinary main input without execution and refuses to discard command references', async () => {
  const f = fixture(), view = f.mount(); await view.ready
  expect(await view.submitParentCommand(1, 'Ordinary prompt', true)).toEqual({ kind: 'not_command' })
  expect(f.ui.startParentCommand).not.toHaveBeenCalled()
  f.ui.prepareParentCommand.mockResolvedValueOnce({ kind: 'prepared', id: '12345678-1234-1234-1234-123456789abc' })
  await expect(view.submitParentCommand(2, '/clear', true)).rejects.toThrow('attachments or references')
  expect(f.ui.startParentCommand).not.toHaveBeenCalled()
  await view.dispose()
})
it('reads a held main command ticket after a lost start reply and retires its old drawing without replaying execution', async () => {
  const f = fixture(), view = f.mount(); await view.ready
  const id = '12345678-1234-1234-1234-123456789abc'
  f.ui.prepareParentCommand.mockResolvedValueOnce({ kind: 'prepared', id })
  f.ui.startParentCommand.mockRejectedValueOnce(new Error('Native UI owner changed before its reply'))
  f.ui.readParentCommand.mockImplementationOnce(async () => { f.replace(); return { kind: 'finished', id, result: { kind: 'command_complete', commandName: 'clear', messageId: id, sessionId: id } } })
  expect(await view.submitParentCommand(1, '/clear', false)).toMatchObject({ kind: 'command_complete', sessionId: id })
  expect(f.ui.startParentCommand).toHaveBeenCalledOnce(); expect(f.ui.readParentCommand).toHaveBeenCalledWith({ client_id: f.ui.attach.mock.calls[0]![0].client_id, command_id: id })
  expect(f.states.at(-1)?.status).toBe('disconnected')
  await view.dispose()
})
it('polls and closes original command panels in a main mount without an Agent transcript', async () => {
  const f = fixture(), view = f.mount(); await view.ready
  const id = '12345678-1234-1234-1234-123456789abc'
  f.ui.prepareParentCommand.mockResolvedValueOnce({ kind: 'prepared', id })
  f.ui.readParentCommand.mockResolvedValueOnce({ kind: 'finished', id, result: { kind: 'panel', id, commandName: 'help' } })
  await view.submitParentCommand(1, '/help', false)
  expect(f.states.at(-1)?.agentInput?.status).toBe('panel')
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.ui.agentPanel).toHaveBeenCalledWith(expect.objectContaining({ panel_id: id, operation: 'read' }))
  expect(f.states.at(-1)?.agentInput?.status).toBe('panel_done')
  await view.dispose()
})

it('mounts transient main command results by native UUID without requiring persisted history', async () => {
  const f = fixture(), id = '12345678-1234-1234-1234-123456789abc'
  Object.assign(f.owner, { sessionId: 'session' })
  const view = f.mount(); await view.ready
  f.ui.prepareParentCommand.mockResolvedValueOnce({ kind: 'prepared', id })
  f.ui.readParentCommand.mockResolvedValueOnce({ kind: 'finished', id, result: { kind: 'command_output', messageId: id, commandName: 'context', text: 'Native result', isErrored: false } })
  await view.submitParentCommand(1, '/context', false); await vi.advanceTimersByTimeAsync(100)
  const frame = f.states.at(-1)?.transcriptMessages?.find(row => row.uuid === id)
  expect(frame).toMatchObject({ component: 'CommandOutput', uuid: id, messageId: id, text: 'Native result', body: { status: 'live' } })
  if (frame?.body.status !== 'live' || frame.body.tree.kind !== 'button') throw Error('expected result button')
  const old = frame.body.tree.actionId!
  f.ui.prepareParentCommand.mockResolvedValueOnce({ kind: 'not_command' })
  await view.submitParentCommand(2, 'Ordinary next draft', false)
  expect(f.states.at(-1)?.transcriptMessages).toBeUndefined()
  await expect(view.press(old)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  await view.dispose()
})


it('leaves the composer drawing and its actions live during group-only updates',async()=>{
 const f=fixture(),view=f.mount();await view.ready;await vi.advanceTimersByTimeAsync(50)
 const before=f.ui.render.mock.calls.length,action=f.action()
 for(const listener of f.listeners)listener({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]} as StreamLine)
 await vi.advanceTimersByTimeAsync(100)
 expect(f.ui.render).toHaveBeenCalledTimes(before)
 await expect(view.press(action)).resolves.toEqual({handled:true})
 await view.dispose()
})
