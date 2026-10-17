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
  const listeners = new Set<(event: StreamLine) => void>()
  const ui = { input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })), attach: vi.fn(async () => ({ surfaces: ['desktop' as const] })),
    detach: vi.fn(async () => ({ detached: true, surfaces: [] })),
    render: vi.fn(async () => rendered()), press: vi.fn(async () => ({ handled: true })) }
  let current = true
  const owner = { handle: { ui }, done: done.promise, subscribe(listener: (event: StreamLine) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const mount = () => mountClaudeUi({ owner, isCurrent: () => current, publish: state => { states.push(state) } })
  const invalidate = () => { for (const listener of listeners) listener({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' } as StreamLine) }
  const action = () => { const last = states.at(-1); if (last?.status !== 'live' || last.tree.kind !== 'button' || !last.tree.actionId) throw new Error('expected live button'); return last.tree.actionId }
  return { mount, ui, states, done, listeners, invalidate, action, replace: () => { current = false } }
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
    const other = f.mount(); f.ui.render.mockResolvedValueOnce({ ...rendered(), tree: { type: 'Button' } } as ReturnType<typeof rendered>)
    await other.ready; await vi.advanceTimersByTimeAsync(50)
    expect(f.states.at(-1)).toMatchObject({ status: 'error' })
    await other.dispose()
  })
})


it('routes keyed field edits through invalidation and rejects foreign or removed field authority', async () => {
  const f = fixture()
  const field = { type: 'Input', props: { key: 'draft', value: '', rows: 2 }, press: { plugin: 'fixture', handle: 7 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: field } as unknown as ReturnType<typeof rendered>)
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const live = f.states.at(-1)!
  if (live.status !== 'live' || live.tree.kind !== 'input') throw new Error('expected input')
  const actionId = live.tree.actionId
  f.invalidate()
  await expect(view.field({ actionId, kind: 'change', value: 'typed' })).resolves.toEqual({ handled: true })
  expect(f.ui.input).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'fixture', handle: 7, key: 'draft', component: 'AbovePrompt', kind: 'change', value: 'typed' }))
  await expect(view.field({ actionId: 'foreign', kind: 'submit', value: 'bad' })).resolves.toEqual({ handled: false })
  f.ui.render.mockResolvedValue(rendered()); await vi.advanceTimersByTimeAsync(50)
  await expect(view.field({ actionId, kind: 'submit', value: 'bad' })).resolves.toEqual({ handled: false })
  await view.dispose()
})

it('checks select membership before native dispatch and retires it on disposal', async () => {
  const f = fixture()
  const field = { type: 'Select', props: { key: 'pick', options: [{ value: 'a' }, { value: 'b' }] }, press: { plugin: 'fixture', handle: 8 } }
  f.ui.render.mockResolvedValue({ ...rendered(), tree: field } as unknown as ReturnType<typeof rendered>)
  const view = f.mount(); await view.ready; await vi.advanceTimersByTimeAsync(50)
  const live = f.states.at(-1)!
  if (live.status !== 'live' || live.tree.kind !== 'select') throw new Error('expected select')
  const actionId = live.tree.actionId
  await expect(view.field({ actionId, kind: 'select', value: 'foreign' })).resolves.toEqual({ handled: false })
  expect(f.ui.select).not.toHaveBeenCalled()
  await expect(view.field({ actionId, kind: 'select', value: 'b' })).resolves.toEqual({ handled: true })
  expect(f.ui.select).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'fixture', handle: 8, key: 'pick', value: 'b' }))
  await view.dispose()
  await expect(view.field({ actionId, kind: 'select', value: 'a' })).resolves.toEqual({ handled: false })
  expect(f.ui.select).toHaveBeenCalledTimes(1)
})
