import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalThemePanelRuntime } from '#features/code/be/services/claude-code/terminal-theme-panel-runtime.ts'

function setup(custom = true) {
  function Root() {} function Picker() {} function Editor() {}
  const onDone = vi.fn(), select = vi.fn(), preview = vi.fn(), edit = vi.fn(), cancel = vi.fn(), toggle = vi.fn()
  const options = [{ value: 'dark', label: 'Dark mode' }, { value: 'custom:team', label: 'Team Review', origin: 'from team' }]
  const props = { onThemeSelect: select, onCancel: cancel, ...(custom ? { onCustomTheme: edit } : {}), helpText: custom ? '' : 'Custom themes are disabled in safe mode' }
  const cache: any[] = Array(109); Object.assign(cache, { 0: null, 11: toggle, 14: cancel, 15: cancel, 30: options, 41: edit, 54: 'dark', 57: preview, 61: select, 63: select, 65: 'dark' })
  const rootCache: any[] = Array(50); rootCache[14] = [{ slug: 'team', name: 'Team Review', source: { plugin: 'team' } }]
  const picker: any = { type: Picker, memoizedProps: props, updateQueue: { memoCache: { data: [cache] } } }
  const owner: any = { type: Root, memoizedProps: { onDone }, child: picker, updateQueue: { memoCache: { data: [rootCache] } } }
  const entry: any = { commandName: 'theme', originalType: Root, originalProps: { onDone }, current: vi.fn(), closed: false }
  const hashes = { root: '661b2d361cc5c8225f327b4aa6f302f7b2695af564c0205efe51eb7e284539ba', editor: 'f9135fea064bf5bd257a0413951940263c2393909867f58a00439ac0cda548ca', picker: '0333a3f408c68ec72bd8c5d0777f46e5e145c460013adb5a0ff665bbf7162ae7' }
  const walk = (root: any): any[] => root ? [root, ...walk(root.child), ...walk(root.sibling)] : []
  const api = vm.runInNewContext(claudeTerminalThemePanelRuntime + ';({readNativeThemePanel,nativeThemePanel})', {
    createHash, randomUUID, process: { stdout: undefined }, setTimeout,
    nativeModelFunctionHash: (fn: any) => fn === Root ? hashes.root : fn === Picker ? hashes.picker : fn === Editor ? hashes.editor : undefined,
    nativeModelFibers: walk, sameNativeSettingsFiber: (a: any, b: any) => a === b,
    currentNativeSettingsFiber: (root: any, target: any) => { if (!walk(root).includes(target)) throw Error('retired'); return target },
    nativeGenericPermissionText: (_n: any, value: any) => value,
    awaitNativeSettingsReading: async (value: any) => value,
  })
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: owner } }]]) } }
  const abort = new AbortController()
  async function act(command: any, revision?: string) {
    const before = await api.readNativeThemePanel(n, entry, abort.signal)
    return api.nativeThemePanel(n, entry, { operation: 'editor', revision: revision ?? before.snapshot.revision, editor_revision: before.snapshot.editor.revision, command }, abort)
  }
  return { api, n, entry, abort, act, owner, Editor, select, preview, edit, cancel, toggle, cache, picker, props }
}

it('projects only original theme options and preserves native safe-mode editing admission', async () => {
  const s = setup(false), view = await s.api.readNativeThemePanel(s.n, s.entry, s.abort.signal)
  expect(view.snapshot.editor.description).toContain('safe mode')
  expect(view.snapshot.editor.options.every((option: any) => !option.canEdit)).toBe(true)
  await expect(s.act({ action: 'themeEdit', value: 'custom:team' })).rejects.toThrow('unavailable')
  expect(s.edit).not.toHaveBeenCalled()
})

it('uses original focused-theme preview and edit wrappers and the original selection index', async () => {
  const s = setup()
  s.preview.mockImplementation((index: number) => { s.cache[54] = s.cache[30][index].value })
  s.edit.mockImplementation(() => { s.entry.closed = true })
  await s.act({ action: 'themeEdit', value: 'custom:team' })
  expect(s.preview).toHaveBeenCalledExactlyOnceWith(1)
  expect(s.edit).toHaveBeenCalledExactlyOnceWith()
  const fresh = setup(); fresh.select.mockImplementation(() => { fresh.entry.closed = true })
  await fresh.act({ action: 'select', value: 'dark' }); expect(fresh.select).toHaveBeenCalledWith(0)
})

it('refuses stale snapshots and unavailable options before invoking original callbacks', async () => {
  const s = setup()
  await expect(s.act({ action: 'select', value: 'dark' }, '0'.repeat(64))).rejects.toThrow('changed')
  await expect(s.act({ action: 'select', value: 'missing' })).rejects.toThrow('unavailable')
  expect(s.select).not.toHaveBeenCalled()
})

it('does not toggle syntax when the original environment disables that callback', async () => {
  const s = setup(); s.cache[0] = 'env'
  await expect(s.act({ action: 'toggleSyntax' })).rejects.toThrow('unavailable')
  expect(s.toggle).not.toHaveBeenCalled()
})

it('rejects expired owners even if a former theme snapshot remains available', async () => {
  const s = setup(); s.entry.closed = true
  await expect(s.api.readNativeThemePanel(s.n, s.entry, s.abort.signal)).rejects.toThrow('expired')
  expect(s.edit).not.toHaveBeenCalled(); expect(s.select).not.toHaveBeenCalled()
})

function fieldEditor(s: ReturnType<typeof setup>, field: 'name' | 'color', valid = true) {
  const cache: any[] = Array(152); cache[56] = 'My theme'; cache[91] = valid; cache[98] = { props: { children: 'success' } }
  const input = { value: field === 'name' ? 'My theme' : '#55aa66', placeholder: field === 'name' ? 'my-theme' : 'rgb(r,g,b)', focus: true, onChange: vi.fn(), onSubmit: vi.fn(), onExit: vi.fn() }
  cache[field === 'name' ? 73 : 113] = { props: { children: [null, { props: input }] } }
  s.owner.child = { type: s.Editor, memoizedProps: {}, updateQueue: { memoCache: { data: [cache] } }, child: { memoizedProps: input } }
  return input
}

it('submits only an acknowledged name through the original form callback', async () => {
  const s = setup(), input = fieldEditor(s, 'name')
  await expect(s.act({ action: 'save', values: { name: 'Newer unsynchronized draft' } })).rejects.toThrow('acknowledgement')
  expect(input.onSubmit).not.toHaveBeenCalled()
  input.onSubmit.mockImplementation(() => { s.entry.closed = true })
  await s.act({ action: 'save', values: { name: 'My theme' } }); expect(input.onSubmit).toHaveBeenCalledOnce()
})

it('retains the original color-validation refusal and does not write from the app', async () => {
  const s = setup(), input = fieldEditor(s, 'color', false)
  await expect(s.act({ action: 'save', values: { color: '#55aa66' } })).rejects.toThrow('not accepted')
  expect(input.onSubmit).not.toHaveBeenCalled()
})

it('rejects edits from a previous native form identity', async () => {
  const s = setup(), input = fieldEditor(s, 'color')
  await expect(s.act({ action: 'change', formId: 'old-form', key: 'color', value: '#abcdef' })).rejects.toThrow('unavailable')
  expect(input.onChange).not.toHaveBeenCalled()
})

it('resets only an offered native token with the original reset callback', async () => {
  const s = setup(), reset = vi.fn(() => { s.entry.closed = true }), cache: any[] = Array(152)
  const list = { placeholder: 'Filter color tokens…', title: 'My theme', items: ['success'], onSelect: vi.fn(), onCancel: vi.fn(), onTab: { handler: reset }, renderPreview: () => 'current: #55aa66; preset: #ffffff' }
  cache[151] = { props: list }
  s.owner.child = { type: s.Editor, memoizedProps: {}, updateQueue: { memoCache: { data: [cache] } }, child: { memoizedProps: list } }
  await expect(s.act({ action: 'themeReset', value: 'missing' })).rejects.toThrow('unavailable')
  await s.act({ action: 'themeReset', value: 'success' }); expect(reset).toHaveBeenCalledExactlyOnceWith('success')
})

it('uses the original theme input when TextInput forwards the same callbacks to its rendering child', async () => {
  const s = setup(), input = fieldEditor(s, 'name')
  s.owner.child.child.child = { memoizedProps: { ...input, inputState: {} } }
  const view = await s.api.readNativeThemePanel(s.n, s.entry, s.abort.signal)
  expect(view.snapshot.editor.kind).toBe('form')
  expect(view.snapshot.editor.fields).toEqual([{key:'name',label:'Theme name',value:'My theme'}])
})
