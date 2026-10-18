import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalClientRuntime } from '#features/code/be/services/claude-code/terminal-client-runtime.ts'

it('releases native Client input when the original command result expires', () => {
  const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, setInterval, clearInterval })
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
