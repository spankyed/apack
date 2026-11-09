import vm from 'node:vm'
import { claudeTerminalInstanceRuntime } from '#features/code/be/services/claude-code/terminal-instance-runtime.ts'
const factory = () => vm.runInNewContext(`${claudeTerminalInstanceRuntime};createNativeInstanceLifetimes`)
it('rejects rendering after a close that arrived before initialization, and protects a reopened instance from late closes', () => {
  const release = vi.fn(), scopes = factory()(release)
  const result = { client_id: 'view', component: 'ToolResult', instance_id: 'result' }
  scopes.retire(result, 1)
  expect(() => scopes.begin(result, 1)).toThrow('expired')
  scopes.begin(result, 2); expect(scopes.active(result, 2)).toBe(true)
  expect(scopes.retire(result, 1)).toBe(false); expect(scopes.active(result, 2)).toBe(true)
  expect(() => scopes.begin(result, 1)).toThrow('expired')
  scopes.retire(result, 2); const calls = release.mock.calls.length
  scopes.retire(result, 2); expect(release).toHaveBeenCalledTimes(calls)
  expect(scopes.active(result, 2)).toBe(false)
})
it('keeps independent components and clients alive and releases only one client on detach', () => {
  const release = vi.fn(), scopes = factory()(release)
  const result = { client_id: 'view', component: 'ToolResult', instance_id: 'same' }, other = { ...result, component: 'AssistantMessage' }, foreign = { ...result, client_id: 'foreign' }
  scopes.begin(result, 1); scopes.begin(other, 1); scopes.begin(foreign, 1)
  scopes.retire(result, 1)
  expect(scopes.active(other, 1)).toBe(true); expect(scopes.active(foreign, 1)).toBe(true)
  scopes.detach('view'); expect(scopes.active(other, 1)).toBe(false); expect(scopes.active(foreign, 1)).toBe(true)
  scopes.clear(); expect(scopes.active(foreign, 1)).toBe(false)
})
