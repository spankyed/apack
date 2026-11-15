import {describe, expect, it, vi} from 'vitest'
import vm from 'node:vm'
import {dirname} from 'node:path'
import {claudeTerminalPermissionsRuntime} from '#features/code/be/services/claude-code/terminal-permissions-runtime.ts'
const source = claudeTerminalPermissionsRuntime.slice(claudeTerminalPermissionsRuntime.indexOf('async function nativePermissionEditorAction('), claudeTerminalPermissionsRuntime.indexOf('async function nativePermissionsPanel('))
function fixture() {
  const previous = {editor: 'user-editor --wait', otherCapability: true}; let capabilities: unknown = previous
  const get = Object.assign(() => capabilities, {hash: '755ff28597ef753308ce7c5638c7d137b281c32142c3bf96cda73c929f8609ed'})
  const set = Object.assign(vi.fn((value: unknown) => {capabilities = value}), {hash: 'ab76cee4f7db1822ee6020683639a9412b38512ce798500110df5a1d743833b1'})
  const path = Object.assign(vi.fn(() => '/native/session/auto-mode-env-edit-0000000000000000.md'), {hash: 'bc940c622b9e6d02ed188b36512d52ce43bb6e947ce1df71b81462bcf65f4b67'})
  const before = {snapshot: {permissions: {title: 'Replace the built-in environment?', readOnly: false}}}, frame = vi.fn(() => before), current = vi.fn(), post = vi.fn(async () => ({command: '/private/editor/open'}))
  const act = vm.runInNewContext(source + ';nativePermissionEditorAction', {process: {pid: 41}, nativeModelFunctionHash: (fn: {hash: string}) => fn.hash, nativeEditorDirname: dirname, nativePermissionsFrame: frame, ownerPost: post})
  return {get, set, previous, path, before, frame, current, post, run: (invoke: () => unknown, value = 'confirm') => act({questionOptions: {Bc: get, dzo: set}, runtime: {hgs: path}}, {current}, {client_id: 'window', panel_id: 'panel', command: {action: 'select', value}}, before, invoke)}
}
describe('scoped original editor capability', () => {
  it('restores the exact previous record before awaiting the original callback result', async () => {
    const f = fixture(); let resolve!: (value: unknown) => void
    const original = new Promise(yes => {resolve = yes}), invoked = vi.fn(() => {expect(f.get()).toEqual({editor: '/private/editor/open', otherCapability: true}); return original})
    const result = f.run(invoked); await vi.waitFor(() => expect(invoked).toHaveBeenCalledOnce())
    expect(f.get()).toBe(f.previous); resolve({native: true}); await expect(result).resolves.toEqual({native: true})
    expect(f.post).toHaveBeenCalledWith('/native-editor-prepare', {pid: 41, clientId: 'window', panelId: 'panel', directory: '/native/session'})
  })
  it('restores preferences if the original callback throws', async () => {
    const f = fixture(); await expect(f.run(() => {throw new Error('Original failure')})).rejects.toThrow('Original failure'); expect(f.get()).toBe(f.previous)
  })
  it('does not prepare an editor for unrelated permission choices', async () => {
    const f = fixture(), invoke = vi.fn(() => 'unchanged'); await expect(f.run(invoke, 'ordinary-rule')).resolves.toBe('unchanged'); expect(f.post).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled()
  })
  it('refuses a changed native frame after asynchronous preparation', async () => {
    const f = fixture(), invoke = vi.fn(); f.frame.mockReturnValue({} as typeof f.before)
    await expect(f.run(invoke)).rejects.toThrow(/changed during/); expect(invoke).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled()
  })
})
