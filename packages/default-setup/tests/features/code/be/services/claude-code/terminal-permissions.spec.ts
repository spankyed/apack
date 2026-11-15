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
    const filtered = await f.act(first.snapshot.revision, { action: 'search', scope: first.snapshot.permissions.searchScope, value: 'does not match' })
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

it('filters the current original list after render revision churn, without relaxing choice revisions', async () => {
  const f = fixture(), before = f.read(); f.redraw(); const refreshed = f.read()
  expect(refreshed.snapshot.revision).not.toBe(before.snapshot.revision)
  expect(refreshed.snapshot.permissions.searchScope).toBe(before.snapshot.permissions.searchScope)
  const result = await f.act(before.snapshot.revision, { action: 'search', scope: before.snapshot.permissions.searchScope, value: 'release-notes' })
  expect(result.snapshot.permissions.search).toBe('release-notes')
  await expect(f.act(before.snapshot.revision, { action: 'select', value: 'original-source-key' })).rejects.toThrow(/changed/)
  expect(f.select).not.toHaveBeenCalled()
})

it('retires a search lease on another native action and rejects fabricated scopes', async () => {
  const f = fixture(), before = f.read(), scope = before.snapshot.permissions.searchScope
  await expect(f.act(before.snapshot.revision, { action: 'search', scope: 'f'.repeat(64), value: 'wrong' })).rejects.toThrow(/unavailable/)
  expect(f.read().snapshot.permissions.search).toBe('')
  await f.act(before.snapshot.revision, { action: 'tab', value: 'Ask' })
  await expect(f.act(before.snapshot.revision, { action: 'search', scope, value: 'retired' })).rejects.toThrow(/unavailable/)
})

function directoryFixture() {
  const f = fixture(), ownerProps = { onAddDirectory: vi.fn(), onCancel: f.cancel, permissionContext: {} }
  let value = '', problem: string | null = null, suggestions = [{ id: '/native/reference', displayText: 'reference/', description: 'directory' }]
  const onChange = vi.fn((next: string) => { value = next; redraw() })
  const onSubmit = vi.fn(async (_next: string) => { problem = 'Original directory validation failed'; redraw() })
  const complete = vi.fn((_item: object) => { value = 'original-completed-value/'; problem = null; redraw() })
  const ownerType = Object.assign(function Directory() {}, { hash: '82ec5e10ac78d83816820ac86a78e829cb590af5e337988668816b8650c15473' })
  const fieldType = Object.assign(function DirectoryField() {}, { hash: 'c6cd02efcbe63ca1098635b105cf87343f6514880c19f38944088c26ce479eb6' })
  const filter = (text: string) => text.replace(/[\r\n]/g, '')
  function redraw() {
    const inputProps = { value, onChange, onSubmit, placeholder: 'Directory path…', inputFilter: filter }
    const fieldProps = { value, onChange, onSubmit, suggestions, selectedSuggestion: 0, error: problem }
    const frameProps = { title: 'Add directory to workspace', onCancel: f.cancel, children: [{ type: fieldType, props: fieldProps }] }
    const field: any = { type: fieldType, memoizedProps: fieldProps, child: { type: function Input() {}, memoizedProps: inputProps } }
    f.root.child = { type: ownerType, memoizedProps: ownerProps, updateQueue: { memoCache: { data: [Array.from({ length: 38 }, (_, i) => i === 7 ? complete : undefined)] } }, child: { type: function Frame() {}, memoizedProps: frameProps, child: field } }
  }
  redraw(); return { ...f, onChange, onSubmit, complete, ownerType, fieldType, redraw, replaceSuggestions: (next: typeof suggestions) => { suggestions = next; redraw() }, nativeItems: () => suggestions }
}

it('projects original directory suggestions and invokes their original completion without adding access', async () => {
  const f = directoryFixture(), first = f.read(), live = first.snapshot.permissions.form.live
  expect(live.suggestions[0]).toMatchObject({ value: '/native/reference', label: 'reference/', description: 'directory' })
  const result = await f.act(first.snapshot.revision, { action: 'complete', scope: live.id, value: live.suggestions[0].value, token: live.suggestions[0].token })
  expect(f.complete).toHaveBeenCalledExactlyOnceWith(f.nativeItems()[0]); expect(f.onSubmit).not.toHaveBeenCalled()
  expect(result.snapshot.permissions.form.value).toBe('original-completed-value/')
  await expect(f.act(first.snapshot.revision, { action: 'complete', scope: live.id, value: live.suggestions[0].value, token: live.suggestions[0].token })).rejects.toThrow(/suggestion changed/)
  expect(f.complete).toHaveBeenCalledOnce()
})

it('updates only the original live draft across render churn and preserves the original input filter', async () => {
  const f = directoryFixture(), first = f.read(); f.redraw()
  const result = await f.act(first.snapshot.revision, { action: 'change', scope: first.snapshot.permissions.form.live.id, value: 'reference\n' })
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('reference'); expect(f.onSubmit).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled()
  expect(result.snapshot.permissions.form.value).toBe('reference')
})

it('refuses replaced native suggestions and fabricated or retired field scopes', async () => {
  const f = directoryFixture(), first = f.read(), live = first.snapshot.permissions.form.live
  f.replaceSuggestions([{ id: '/native/different', displayText: 'different/', description: 'directory' }])
  await expect(f.act(first.snapshot.revision, { action: 'complete', scope: live.id, ...live.suggestions[0] })).rejects.toThrow(/suggestion changed/)
  await expect(f.act(first.snapshot.revision, { action: 'change', scope: 'f'.repeat(64), value: 'foreign' })).rejects.toThrow(/expired/)
  f.root.child.memoizedProps = { ...f.root.child.memoizedProps }
  await expect(f.act(first.snapshot.revision, { action: 'change', scope: live.id, value: 'retired' })).rejects.toThrow(/expired/)
  expect(f.onChange).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled()
})

it('submits only the current native draft and form revision, and exposes original validation errors', async () => {
  const f = directoryFixture(), first = f.read(), scope = first.snapshot.permissions.form.live.id
  const edited = await f.act(first.snapshot.revision, { action: 'change', scope, value: 'bad-directory' }), form = edited.snapshot.permissions.form
  await expect(f.act(first.snapshot.revision, { action: 'submit', scope, formRevision: first.snapshot.permissions.form.live.revision, value: 'bad-directory' })).rejects.toThrow(/submission changed/)
  await expect(f.act(edited.snapshot.revision, { action: 'submit', scope, formRevision: form.live.revision, value: 'unseen-draft' })).rejects.toThrow(/submission changed/)
  const result = await f.act(edited.snapshot.revision, { action: 'submit', scope, formRevision: form.live.revision, value: form.value })
  expect(f.onSubmit).toHaveBeenCalledExactlyOnceWith('bad-directory')
  expect(result.snapshot.permissions.form.live.problem).toBe('Original directory validation failed')
  await expect(f.act(edited.snapshot.revision, { action: 'submit', scope, formRevision: form.live.revision, value: form.value })).rejects.toThrow(/submission changed/)
})

function autoRuleFixture() {
  const f = fixture(), ownerType = Object.assign(function AutoRule() {}, { hash: '015b00025c6788136ff0ca3ae813ac911cdce4a52d405ad01f7b87963622d501' })
  let value = '', problem: string | undefined
  const onChange = vi.fn((next: string) => { value = next; problem = undefined; redraw() })
  const onSubmit = vi.fn((_next: string) => { problem = 'Original reserved-rule error'; redraw() })
  const ownerProps = { section: 'soft_deny', onSubmit, onCancel: f.cancel }
  function redraw() {
    const inputProps = { value, multiline: true, onChange, onSubmit, inputFilter: (s: string) => s.replace(/\r\n?/g, '\n'), placeholder: 'Enter rule…' }
    const inputType = function NativeTextInput() {}, errorType = function NativeText() {}
    const errorProps = { color: 'error', children: problem }, input: any = { type: inputType, memoizedProps: inputProps }
    if (problem) input.sibling = { type: errorType, memoizedProps: errorProps, child: { type: 'ink-text', memoizedProps: {}, child: { tag: 6, memoizedProps: problem } } }
    const frameProps = { title: 'Add soft deny rule', children: [{ type: inputType, props: inputProps }, ...(problem ? [{ type: errorType, props: errorProps }] : [])] }
    f.root.child = { type: ownerType, memoizedProps: ownerProps, child: { type: function Frame() {}, memoizedProps: frameProps, child: input } }
  }
  redraw(); return { ...f, onChange, onSubmit, ownerType, redraw }
}

it('normalizes multiline text through the original Auto mode filter without submitting', async () => {
  const f = autoRuleFixture(), before = f.read(), scope = before.snapshot.permissions.form.live.id; f.redraw()
  const result = await f.act(before.snapshot.revision, { action: 'change', scope, value: 'Production writes:\r\nReject schema changes.' })
  expect(result.snapshot.permissions.form).toMatchObject({ multiline: true, submitLabel: 'Save rule', value: 'Production writes:\nReject schema changes.', live: { kind: 'autoRule', suggestions: [] } })
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('Production writes:\nReject schema changes.'); expect(f.onSubmit).not.toHaveBeenCalled()
})

it('preserves original Auto mode validation and clears it only through the original edit', async () => {
  const f = autoRuleFixture(), before = f.read(), scope = before.snapshot.permissions.form.live.id
  const result = await f.act(before.snapshot.revision, { action: 'submit', scope, formRevision: before.snapshot.permissions.form.live.revision, value: '' })
  expect(f.onSubmit).toHaveBeenCalledExactlyOnceWith(''); expect(result.snapshot.permissions.form.live.problem).toBe('Original reserved-rule error')
  expect(result.snapshot.permissions.paragraphs).not.toContain('Original reserved-rule error')
  await expect(f.act(before.snapshot.revision, { action: 'submit', scope, formRevision: before.snapshot.permissions.form.live.revision, value: '' })).rejects.toThrow(/submission changed/)
  const edited = await f.act(result.snapshot.revision, { action: 'change', scope, value: 'New rule' })
  expect(edited.snapshot.permissions.form.live.problem).toBeUndefined(); expect(f.onSubmit).toHaveBeenCalledOnce()
})

it('refuses changed Auto mode producers and retired form scopes without a callback', async () => {
  const f = autoRuleFixture(), before = f.read(); f.root.child.memoizedProps = { ...f.root.child.memoizedProps }
  await expect(f.act(before.snapshot.revision, { action: 'change', scope: before.snapshot.permissions.form.live.id, value: 'Retired' })).rejects.toThrow(/expired/)
  f.ownerType.hash = 'changed'; expect(f.read).toThrow(/producer changed/)
  expect(f.onChange).not.toHaveBeenCalled(); expect(f.onSubmit).not.toHaveBeenCalled()
})
