import { createHash, randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { claudeTerminalPermissionsRuntime } from '#features/code/be/services/claude-code/terminal-permissions-runtime.ts'
import { claudeTerminalIdeRuntime } from '#features/code/be/services/claude-code/terminal-ide-runtime.ts'

function fixture() {
  const originalType = Object.assign(function Permissions() {}, { hash: '8e4ca278c03aa64a7d666f3951ff4a1e343a5269a5acf07a03e21d7489ad37ff' })
  const originalProps = { onExit: vi.fn() }
  const entry: any = { originalType, originalProps, commandName: 'permissions', current: vi.fn() }
  const cancel = vi.fn(() => { entry.closed = true })
  const getter = vi.fn((_tab: string, query: string) => ({ options: [{ value: 'original-source-key', label: 'Read(release-notes.md)' }].filter(row => row.label.includes(query)) }))
  const select = vi.fn(() => redraw())
  const tab = { title: 'Ask', isCurrent: true, onClick: vi.fn(() => redraw()) }
  let list = { tab: 'ask', searchQuery: '', getRulesOptions: getter, handleToolSelect: select }
  const root: any = { type: originalType, memoizedProps: originalProps, updateQueue: { memoCache: { data: [Array.from({ length: 226 }, (_, index) => index === 39 ? cancel : undefined)] } } }
  const fiber = (props: object) => ({ type: function NativeControl() {}, memoizedProps: props })
  function redraw() { list = { ...list }; const first: any = fiber(tab); first.sibling = fiber(list); root.child = first }
  redraw()
  const walk = claudeTerminalIdeRuntime.slice(claudeTerminalIdeRuntime.indexOf('function nativeIdeWalk('), claudeTerminalIdeRuntime.indexOf('function nativeIdeFrame('))
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  // The authored runtime uses process.stdout only as the original root-map key.
  const globalProcess = { stdout: undefined }
  const context = vm.createContext({ createHash, randomUUID, setTimeout, process: globalProcess, nativeModelFunctionHash: (fn: any) => fn.hash })
  const runtime = vm.runInContext(walk + claudeTerminalPermissionsRuntime + ';({frame:nativePermissionsFrame,act:nativePermissionsPanel,close:closeNativePermissionsPanel})', context)
  const read = () => runtime.frame(n, entry)
  const act = (revision: string, command: object) => runtime.act(n, entry, { operation: 'permissions', revision, command }, new AbortController())
  return { entry, root, originalType, cancel, getter, select, tab, redraw, read, act, close: () => runtime.close(n, entry) }
}

describe('original mounted Permissions authority', () => {
  it('uses original filtering and source keys rather than rebuilding permission rules', async () => {
    const f = fixture(), first = f.read()
    expect(first.snapshot.permissions.choices).toEqual([{ value: 'original-source-key', label: 'Read(release-notes.md)', disabled: false }])
    const filtered = await f.act(first.snapshot.revision, { action: 'search', value: 'does not match' })
    expect(f.getter).toHaveBeenLastCalledWith('ask', 'does not match')
    expect(filtered.snapshot.permissions.choices).toEqual([])
    expect(f.select).not.toHaveBeenCalled()
  })

  it('dispatches the original mounted selection with its original tab exactly once', async () => {
    const f = fixture(), revision = f.read().snapshot.revision
    await f.act(revision, { action: 'select', value: 'original-source-key' })
    expect(f.select).toHaveBeenCalledExactlyOnceWith('original-source-key', 'ask')
    await expect(f.act(revision, { action: 'select', value: 'original-source-key' })).rejects.toThrow(/changed/)
    expect(f.select).toHaveBeenCalledOnce()
  })

  it('refuses fabricated choice keys and unknown tabs without invoking native callbacks', async () => {
    const f = fixture(), revision = f.read().snapshot.revision
    await expect(f.act(revision, { action: 'select', value: 'invented-rule' })).rejects.toThrow(/unavailable/)
    await expect(f.act(revision, { action: 'tab', value: 'Auto mode' })).rejects.toThrow(/unavailable/)
    expect(f.select).not.toHaveBeenCalled(); expect(f.tab.onClick).not.toHaveBeenCalled()
  })

  it('invokes only a currently advertised tab callback', async () => {
    const f = fixture()
    await f.act(f.read().snapshot.revision, { action: 'tab', value: 'Ask' })
    expect(f.tab.onClick).toHaveBeenCalledOnce()
  })

  it('refuses changed producers, detached owners and ambiguous control trees', () => {
    const f = fixture(); f.originalType.hash = 'different-native-source'
    expect(f.read).toThrow(/producer changed/)
    f.originalType.hash = '8e4ca278c03aa64a7d666f3951ff4a1e343a5269a5acf07a03e21d7489ad37ff'
    f.root.memoizedProps = {}; expect(f.read).toThrow(/uniquely mounted/)
  })

  it('never borrows a rule callback from an inactive mounted tab', () => {
    const f = fixture(), active = f.root.child.sibling
    const inactiveGetter = vi.fn(() => ({ options: [{ value: 'foreign-tab-key', label: 'Deny(Bash)' }] }))
    const hidden = { type: function InactiveRules() {}, memoizedProps: { tab: 'deny', getRulesOptions: inactiveGetter, handleToolSelect: vi.fn() } }
    const first: any = { type: function TabHeader() {}, memoizedProps: f.tab }
    const body: any = { type: function TabBody() {}, memoizedProps: { id: 'ask', title: 'Ask', children: {} }, child: active }
    const inactive: any = { type: function TabBody() {}, memoizedProps: { id: 'deny', title: 'Deny', children: {} }, child: hidden }
    first.sibling = body; body.sibling = inactive
    f.root.child = { type: Object.assign(function Tabs() {}, { hash: 'a2ed848a66ba4a3055694ea64f27b7f1b126f093b0b13c9c56f98c72d41a242c' }), memoizedProps: { title: 'Permissions', children: [] }, child: { type: {}, memoizedProps: { value: { selectedTab: 'ask', headerFocused: false, focusHeader() {}, blurHeader() {}, registerOptIn() {}, registerNavigationOwner() {} } }, child: first } }
    expect(f.read().snapshot.permissions.choices[0].value).toBe('original-source-key')
    expect(inactiveGetter).not.toHaveBeenCalled()
  })

  it('does not invent deletion for a native read-only details screen', () => {
    const f = fixture()
    f.root.child = { type: function Details() {}, memoizedProps: { onCancel: f.cancel }, child: { type: 'ink-text', child: { tag: 6, memoizedProps: 'Managed rule: contact your administrator.' } } }
    const frame = f.read()
    expect(frame.snapshot.permissions.choices).toEqual([])
    expect(frame.snapshot.permissions.paragraphs).toEqual(['Managed rule: contact your administrator.'])
  })

  it('projects only original body context, source descriptions and the native cancel default', () => {
    const f = fixture(), choiceProps = { options: [{ value: 'confirm', label: 'Yes' }, { value: 'cancel', label: 'No', description: 'Keep the original rule' }], onChange: vi.fn(), defaultFocusValue: 'cancel' }
    const textProps = {}, textElement = { type: 'ink-text', props: textProps }
    const choiceType = function Choices() {}, choiceElement = { type: choiceType, props: choiceProps }
    const body: any = { type: 'ink-text', memoizedProps: textProps, child: { tag: 6, memoizedProps: 'Original delete warning' } }
    const choices: any = { type: choiceType, memoizedProps: choiceProps }
    const chrome: any = { type: 'ink-text', memoizedProps: {}, child: { tag: 6, memoizedProps: 'Terminal border and key hints' } }
    chrome.sibling = body; body.sibling = choices
    f.root.child = { type: function Frame() {}, memoizedProps: { title: 'Rule details', onCancel: f.cancel, children: [textElement, choiceElement] }, child: chrome }
    const frame = f.read().snapshot.permissions
    expect(frame.title).toBe('Rule details'); expect(frame.paragraphs).toEqual(['Original delete warning'])
    expect(frame.choices[1].description).toBe('Keep the original rule'); expect(frame.defaultFocusValue).toBe('cancel')
  })

  it('uses native dismissal so original summary/retry semantics are preserved', async () => {
    const f = fixture(); await f.close(); expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.read).toThrow(/expired/)
  })
})

function tabFocusFixture(disabledChoice = false) {
  const f = fixture()
  const focus = { selectedTab: 'workspace', headerFocused: true, focusHeader: vi.fn(), blurHeader: vi.fn(() => { focus.headerFocused = false; mount() }), registerOptIn: vi.fn(), registerNavigationOwner: vi.fn() }
  const select = vi.fn(() => mount())
  const props = () => ({ options: [{ value: 'add-directory', label: 'Add directory…', disabled: disabledChoice }], isDisabled: focus.headerFocused, onChange: select })
  const tab = { title: 'Workspace', isCurrent: true, onClick: vi.fn(() => mount()) }
  const type = Object.assign(function Tabs() {}, { hash: 'a2ed848a66ba4a3055694ea64f27b7f1b126f093b0b13c9c56f98c72d41a242c' })
  function mount() {
    const body: any = { type: function TabBody() {}, memoizedProps: { id: 'workspace', title: 'Workspace', children: {} }, child: { type: function Picker() {}, memoizedProps: props() } }
    const header: any = { type: function Header() {}, memoizedProps: tab, sibling: body }
    f.root.child = { type, memoizedProps: { title: 'Permissions', children: [] }, child: { type: {}, memoizedProps: { value: focus }, child: header } }
  }
  mount(); return { ...f, focus, select, type, tab }
}

it('hands a desktop-selected category to the original native body focus callback', async () => {
  const f = tabFocusFixture(); expect(f.read().snapshot.permissions.choices[0].disabled).toBe(true)
  const result = await f.act(f.read().snapshot.revision, { action: 'tab', value: 'Workspace' })
  expect(f.focus.blurHeader).toHaveBeenCalledOnce(); expect(f.select).not.toHaveBeenCalled()
  expect(result.snapshot.permissions.choices[0].disabled).toBe(false)
})

it('refuses a foreign tab focus provider or changed original tab producer', () => {
  const f = tabFocusFixture(); f.focus.selectedTab = 'foreign'
  expect(f.read).toThrow(/focus owner changed/); expect(f.focus.blurHeader).not.toHaveBeenCalled()
  f.focus.selectedTab = 'workspace'; f.type.hash = 'unknown'
  expect(f.read).toThrow(/tab producer changed/); expect(f.focus.blurHeader).not.toHaveBeenCalled()
})

it('retains native choice restrictions after the original header releases focus', async () => {
  const f = tabFocusFixture(true)
  const result = await f.act(f.read().snapshot.revision, { action: 'tab', value: 'Workspace' })
  expect(f.focus.blurHeader).toHaveBeenCalledOnce(); expect(result.snapshot.permissions.choices[0].disabled).toBe(true)
  await expect(f.act(result.snapshot.revision, { action: 'select', value: 'add-directory' })).rejects.toThrow(/unavailable/)
  expect(f.select).not.toHaveBeenCalled()
})

it('does not transfer focus to a provider replaced while native tab selection settles', async () => {
  const f = tabFocusFixture(); f.tab.onClick.mockImplementation(() => { f.focus.selectedTab = 'foreign' })
  await expect(f.act(f.read().snapshot.revision, { action: 'tab', value: 'Workspace' })).rejects.toThrow(/focus owner changed/)
  expect(f.focus.blurHeader).not.toHaveBeenCalled()
})
