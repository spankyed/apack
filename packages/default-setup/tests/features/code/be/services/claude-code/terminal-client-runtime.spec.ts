import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalClientRuntime } from '#features/code/be/services/claude-code/terminal-client-runtime.ts'

it('releases native Client input when the original command result expires', () => {
  const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
  let valid = true
  const release = vi.fn(), key = vi.fn(), invalidate = vi.fn(), stop = vi.fn()
  const instance = { release, key, subscribe: () => stop, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Text', children: ['result'] } }), acceptsPointer: () => false, acceptsKeys: () => true }
  const host = create(() => ({ acquire: () => instance, dispose() {} }), invalidate, () => 'callback', { current: () => valid })
  const tree = host.render('view', 'CommandOutput', 'original-result', { type: 'Client', props: { key: 'result', module: './result.ts' }, client: { plugin: 'fixture' } })
  expect(host.event('view', tree.props.id, 1, { kind: 'key', key: 'x' })).toEqual({ handled: true })
  expect(key).toHaveBeenCalledTimes(1)
  valid = false
  expect(host.event('view', tree.props.id, 2, { kind: 'key', key: 'x' })).toEqual({ handled: false })
  expect(host.count()).toBe(0); expect(stop).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
  expect(key).toHaveBeenCalledTimes(1)
})

it('stops owned timers and old input on scoped release while another Client keeps ticking', async () => {
  vi.useFakeTimers()
  try {
    const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
    const ticks = new Map<string, number>(), releases = new Map<string, number>(), clocks = new Map<string, { every(ms: number, fn: () => void): () => void }>()
    const host = create(() => ({ acquire: (options: any) => { clocks.set(options.requestId, options.clock); options.clock.every(100, () => ticks.set(options.requestId, (ticks.get(options.requestId) ?? 0) + 1)); return { release: () => releases.set(options.requestId, (releases.get(options.requestId) ?? 0) + 1), subscribe: () => () => {}, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Text', children: ['client'] } }), acceptsPointer: () => false, acceptsKeys: () => true, key() {} } }, dispose() {} }), () => {}, () => 'callback')
    const tree = { type: 'Client', props: { key: 'client', module: './client.ts' }, client: { plugin: 'fixture' } }
    const result = host.render('view', 'ToolResult', 'result', tree, 1)
    host.render('view', 'AbovePrompt', 'above', tree)
    await vi.advanceTimersByTimeAsync(200); expect(ticks.get('result')).toBe(2)
    host.release('view', 'ToolResult', 'result'); host.release('view', 'ToolResult', 'result')
    clocks.get('result')!.every(100, () => ticks.set('late', 1))
    await vi.advanceTimersByTimeAsync(300)
    expect(ticks.get('result')).toBe(2); expect(ticks.get('late')).toBeUndefined(); expect(ticks.get('above')).toBe(5)
    expect(releases.get('result')).toBe(1); expect(host.count()).toBe(1)
    expect(host.event('view', result.props.id, 1, { kind: 'key', key: 'x' })).toEqual({ handled: false })
    host.detach(); await vi.runOnlyPendingTimersAsync(); expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('does not run a sandbox callback if its instance closes during the original asynchronous hook', async () => {
  const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
  let finish!: (value: unknown) => void
  const run = vi.fn(), dispatch = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const host = create(() => ({ acquire: () => ({ release() {}, subscribe: () => () => {}, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Button', props: { key: 'run' }, press: { plugin: 'fixture', handle: 1 } } }), acceptsPointer: () => false, acceptsKeys: () => false }), dispose() {} }), () => {}, () => 'callback', { dispatch, run })
  host.render('view', 'ToolResult', 'result', { type: 'Client', props: { key: 'client', module: './client.ts' }, client: { plugin: 'fixture' } }, 1)
  const ordinary = { subtype: 'ui_press', plugin: 'fixture', handle: 1, key: 'inspect-result', component: 'ToolResult', instance_id: 'result', instance_revision: 1 }
  expect(await host.dispatchAction('view', ordinary)).toBeUndefined()
  expect(host.action('view', ordinary)).toBeUndefined()
  const pending = host.dispatchAction('view', { subtype: 'ui_press', plugin: 'fixture', handle: 1, key: 'run', component: 'ToolResult', instance_id: 'result', instance_revision: 1 })
  host.release('view', 'ToolResult', 'result'); finish({ reached: { element: 'run' } })
  expect(await pending).toEqual({ handled: false }); expect(run).not.toHaveBeenCalled()
})
