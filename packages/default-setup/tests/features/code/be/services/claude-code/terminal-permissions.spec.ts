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
  const queryChange = Object.assign(vi.fn((value: string) => { list.searchQuery = value; redraw() }), { hash: '5fe3df31f754a92dcf6b401e5a84c7847a17025d80993378dac3c7156c9fca6a' })
  const root: any = { type: originalType, memoizedProps: originalProps, updateQueue: { memoCache: { data: [Array.from({ length: 226 }, (_, index) => index === 39 ? cancel : index === 24 ? queryChange : undefined)] } } }
  const fiber = (props: object) => ({ type: function NativeControl() {}, memoizedProps: props })
  function redraw() { list = { ...list }; const first: any = fiber(tab); first.sibling = fiber(list); root.child = first }
  redraw()
  const walk = claudeTerminalIdeRuntime.slice(claudeTerminalIdeRuntime.indexOf('function nativeIdeWalk('), claudeTerminalIdeRuntime.indexOf('function nativeIdeFrame('))
  const textType = function Text() {}
  const managedPermissionRulesOnly = vi.fn(() => false)
  const n = { managedPermissionRulesOnly, terminalComponents: {n:textType}, themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  // The authored runtime uses process.stdout only as the original root-map key.
  const globalProcess = { stdout: undefined }
  const context = vm.createContext({ createHash, randomUUID, setTimeout, process: globalProcess, nativeModelFunctionHash: (fn: any) => fn.hash })
  const runtime = vm.runInContext(walk + claudeTerminalPermissionsRuntime + ';({frame:nativePermissionsFrame,act:nativePermissionsPanel,close:closeNativePermissionsPanel})', context)
  const read = () => runtime.frame(n, entry)
  const act = (revision: string, command: object) => runtime.act(n, entry, { operation: 'permissions', revision, command }, new AbortController())
  return { entry, root, textType, originalType, cancel, getter, select, queryChange, tab, managedPermissionRulesOnly, redraw, read, act, close: () => runtime.close(n, entry) }
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
    expect(frame.snapshot.permissions.paragraphs).toEqual([{runs:[{text:'Managed rule: contact your administrator.',style:{}}]}])
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
    expect(frame.title).toBe('Rule details'); expect(frame.paragraphs).toEqual([{runs:[{text:'Original delete warning',style:{}}]}])
    expect(frame.choices[1].description).toBe('Keep the original rule'); expect(frame.defaultFocusValue).toBe('cancel')
  })

  it('withdraws a held private-rule confirmation on policy change and keeps native Cancel', async () => {
    const f = fixture()
    const onChange = vi.fn(() => f.redraw())
    const choices = { options: [{ value: 'confirm', label: 'Yes' }, { value: 'cancel', label: 'No' }], onChange }
    const picker = function Choices() {}
    f.root.child = {
      type: Object.assign(function RuleDetails() {}, { hash: '19402997c9ec0c7bb57ebb4fe65ffd9e9fbdef857b9088fa1ed1eac99f9fe18d' }),
      memoizedProps: { title: 'Rule details', onCancel: f.cancel, rule: { source: 'userSettings' }, children: [{ type: picker, props: choices }] },
      child: { type: picker, memoizedProps: choices },
    }
    const prior = f.read().snapshot
    expect(prior.permissions.choices[0].disabled).toBe(false)
    f.managedPermissionRulesOnly.mockReturnValue(true)
    const current = f.read().snapshot
    expect(current.revision).not.toBe(prior.revision)
    expect(current.permissions.choices.map((choice: { disabled: boolean }) => choice.disabled)).toEqual([true, false])
    await expect(f.act(prior.revision, { action: 'select', value: 'confirm' })).rejects.toThrow(/changed/)
    await expect(f.act(current.revision, { action: 'select', value: 'confirm' })).rejects.toThrow(/unavailable/)
    expect(onChange).not.toHaveBeenCalled()
    await f.act(current.revision, { action: 'select', value: 'cancel' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cancel')
  })

  it('withdraws private save destinations while original managed-only policy is active', async () => {
    const f = fixture()
    const onChange = vi.fn()
    const options = ['localSettings', 'projectSettings', 'userSettings'].map(value => ({ value, label: value }))
    const choices = { options, onChange }
    const picker = function Choices() {}
    f.root.child = {
      type: Object.assign(function RuleDestination() {}, { hash: 'd65b66125390a55515f7f62765bae04e5c8cf0ddd21d9d8e3c8d6256deaec0cd' }),
      memoizedProps: { title: 'Add ask permission rule', onCancel: f.cancel, children: [{ type: picker, props: choices }] },
      child: { type: picker, memoizedProps: choices },
    }
    const prior = f.read().snapshot
    expect(prior.permissions.choices.every((choice: { disabled: boolean }) => !choice.disabled)).toBe(true)
    f.managedPermissionRulesOnly.mockReturnValue(true)
    const current = f.read().snapshot
    expect(current.permissions.choices.every((choice: { disabled: boolean }) => choice.disabled)).toBe(true)
    await expect(f.act(current.revision, { action: 'select', value: 'userSettings' })).rejects.toThrow(/unavailable/)
    expect(onChange).not.toHaveBeenCalled()
    await f.act(current.revision, { action: 'cancel' })
    expect(f.cancel).toHaveBeenCalledOnce()
  })

  it('uses native dismissal so original summary/retry semantics are preserved', async () => {
    const f = fixture(); await f.close(); expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.read).toThrow(/expired/)
  })
})

function providedDirectoryFixture() {
  const f = fixture()
  f.entry.commandName = 'add-dir'
  f.entry.originalProps.directoryPath = '/owned/reference-notes'
  f.originalType.hash = '82ec5e10ac78d83816820ac86a78e829cb590af5e337988668816b8650c15473'
  const onChange = vi.fn(() => { f.entry.closed = true })
  const onCancel = vi.fn(() => { f.entry.closed = true })
  const options = [
    { value: 'yes-session', label: 'Yes, for this session' },
    { value: 'yes-remember', label: 'Yes, and remember this directory' },
    { value: 'no', label: 'No' },
  ]
  f.root.child = { type: function Picker() {}, memoizedProps: { options, onChange, onCancel } }
  return { ...f, onChange, onCancel, options }
}

it('uses the preselected directory choices and original default, with one callback per decision', async () => {
  const f = providedDirectoryFixture()
  const snapshot = f.read().snapshot
  expect(snapshot.permissions.choices.map((choice: {value: string}) => choice.value)).toEqual(['yes-session', 'yes-remember', 'no'])
  expect(snapshot.permissions.defaultFocusValue).toBe('yes-session')
  await expect(f.act(snapshot.revision, { action: 'select', value: 'another-root' })).rejects.toThrow(/unavailable/)
  await f.act(snapshot.revision, { action: 'select', value: 'yes-remember' })
  await expect(f.act(snapshot.revision, { action: 'select', value: 'yes-session' })).rejects.toThrow(/expired/)
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('yes-remember')
  expect(f.onCancel).not.toHaveBeenCalled()
})

it('cancels a preselected directory via its original picker and refuses changed or absent choices', async () => {
  const f = providedDirectoryFixture()
  f.options[0].value = 'forged'
  expect(f.read).toThrow(/decisions changed/)
  f.options[0].value = 'yes-session'
  const path = f.entry.originalProps.directoryPath
  delete f.entry.originalProps.directoryPath
  expect(f.read).toThrow(/directory input is unavailable/)
  f.entry.originalProps.directoryPath = path
  const revision = f.read().snapshot.revision
  f.root.child.memoizedProps = { ...f.root.child.memoizedProps, onCancel: vi.fn() }
  expect(f.read().snapshot.revision).toBe(revision)
  await f.act(revision, { action: 'cancel' })
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('no')
  expect(f.onCancel).not.toHaveBeenCalled()
})

it('requires a fresh revision when the original directory decision changes', async () => {
  const f = providedDirectoryFixture(), before = f.read()
  const replacement = vi.fn()
  f.root.child.memoizedProps = { ...f.root.child.memoizedProps, onChange: replacement }
  expect(f.read().snapshot.revision).not.toBe(before.snapshot.revision)
  await expect(f.act(before.snapshot.revision, { action: 'select', value: 'yes-remember' })).rejects.toThrow(/changed/)
  expect(replacement).not.toHaveBeenCalled()
  expect(f.onChange).not.toHaveBeenCalled()
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

function directoryFixture(standalone = false) {
  const f = fixture(), ownerProps = { onAddDirectory: vi.fn(), onCancel: f.cancel, permissionContext: {} }
  let value = '', problem: string | null = null, suggestions = [{ id: '/native/reference', displayText: 'reference/', description: 'directory' }]
  const onChange = vi.fn((next: string) => { value = next; redraw() })
  const onSubmit = vi.fn(async (_next: string) => {
    if (standalone) f.entry.closed = true
    else { problem = 'Original directory validation failed'; redraw() }
  })
  const complete = vi.fn((_item: object) => { value = 'original-completed-value/'; problem = null; redraw() })
  const ownerType = Object.assign(function Directory() {}, { hash: '82ec5e10ac78d83816820ac86a78e829cb590af5e337988668816b8650c15473' })
  const fieldType = Object.assign(function DirectoryField() {}, { hash: 'c6cd02efcbe63ca1098635b105cf87343f6514880c19f38944088c26ce479eb6' })
  const filter = (text: string) => text.replace(/[\r\n]/g, '')
  function redraw() {
    const inputProps = { value, onChange, onSubmit, placeholder: 'Directory path…', inputFilter: filter }
    const fieldProps = { value, onChange, onSubmit, suggestions, selectedSuggestion: 0, error: problem }
    const frameProps = { title: 'Add directory to workspace', onCancel: f.cancel, children: [{ type: fieldType, props: fieldProps }] }
    const field: any = { type: fieldType, memoizedProps: fieldProps, child: { type: function Input() {}, memoizedProps: inputProps } }
    const mounted = { type: ownerType, memoizedProps: ownerProps, updateQueue: { memoCache: { data: [Array.from({ length: 38 }, (_, i) => i === 7 ? complete : undefined)] } }, child: { type: function Frame() {}, memoizedProps: frameProps, child: field } }
    if (standalone) Object.assign(f.root, mounted)
    else f.root.child = mounted
  }
  if (standalone) Object.assign(f.entry, { commandName: 'add-dir', originalType: ownerType, originalProps: ownerProps })
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

it('borrows the standalone directory form and acknowledges its original closing submit', async () => {
  const f = directoryFixture(true), first = f.read()
  expect(first.snapshot.permissions.title).toBe('Add directory to workspace')
  expect(first.snapshot.permissions.choices).toEqual([])
  const scope = first.snapshot.permissions.form.live.id
  const { snapshot } = await f.act(first.snapshot.revision, { action: 'change', scope, value: 'reference' })
  const form = snapshot.permissions.form
  await f.act(snapshot.revision, { action: 'submit', scope, formRevision: form.live.revision, value: form.value })
  expect(f.onSubmit).toHaveBeenCalledExactlyOnceWith('reference')
  expect(f.read).toThrow(/expired/)
})

it('acknowledges a standalone directory form closing through original Cancel', async () => {
  const f = directoryFixture(true), first = f.read()
  await f.act(first.snapshot.revision, { action: 'cancel', scope: first.snapshot.permissions.form.live.id })
  expect(f.cancel).toHaveBeenCalledOnce()
  expect(f.read).toThrow(/expired/)
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
  expect(result.snapshot.permissions.paragraphs.map((p: {runs: {text: string}[]}) => p.runs.map(r => r.text).join(''))).not.toContain('Original reserved-rule error')
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

it('projects native rich picker labels instead of silently dropping Auto mode options', async () => {
  const f = fixture(), props = { options: [{ value: 'builtins:soft_deny', label: { props: { children: [{ props: { children: 'Soft deny' } }, ' Built-in rules', { props: { children: ' · in effect' } }] } }, description: 'Original source description' }], onChange: f.select }
  f.root.child = { type: function NativePicker() {}, memoizedProps: props }
  const frame = f.read(); expect(frame.snapshot.permissions.choices).toEqual([{ value: 'builtins:soft_deny', label: 'Soft deny Built-in rules · in effect', description: 'Original source description', disabled: false }])
  await f.act(frame.snapshot.revision, { action: 'select', value: 'builtins:soft_deny' }); expect(f.select).toHaveBeenCalledExactlyOnceWith('builtins:soft_deny')
})

it('refuses opaque native picker atoms rather than hiding their choices', () => {
  const f = fixture(); f.root.child = { type: function NativePicker() {}, memoizedProps: { options: [{ value: 'opaque', label: { props: { status: 'success' } } }], onChange: f.select } }
  expect(f.read).toThrow(/not supported/); expect(f.select).not.toHaveBeenCalled()
})

function autoSearchFixture() {
  const f = fixture(); let query = ''
  const select = vi.fn(() => mount())
  const type = Object.assign(function AutoMode() {}, { hash: '5492680dc6847a0efcf3b94da97323f463cad841677e5a44509103001e4c5665' })
  const displayType = Object.assign(function SearchDisplay() {}, { hash: 'f5c5ed1101f7b42dfb0dc71cca252bc576d03e9f93d00e32640a10ad50b63dc2' })
  const change = Object.assign(vi.fn((value: string) => { query = value; mount() }), { hash: '5fe3df31f754a92dcf6b401e5a84c7847a17025d80993378dac3c7156c9fca6a' })
  f.root.updateQueue.memoCache.data[0][24] = change
  let displayProps: object
  function mount() {
    const props = { entries: [], builtinsState: {}, onSelectBuiltins: select, onSelectEntry: select, onAddNew: select, searchQuery: query }
    displayProps = { query, cursorOffset: query.length, isFocused: false, isTerminalFocused: true }
    const display: any = { type: displayType, memoizedProps: displayProps, child: { type: 'ink-text', memoizedProps: {}, child: { tag: 6, memoizedProps: 'Unadapted native search hint' } } }
    display.sibling = { type: function NativePicker() {}, memoizedProps: { options: [{ value: 'native-database-rule', label: { props: { children: 'Database rule' } } }, { value: 'native-git-rule', label: 'Git rule' }].filter(o => (typeof o.label === 'string' ? o.label : o.label.props.children).toLowerCase().includes(query.toLowerCase())), onChange: select } }
    f.root.child = { type, memoizedProps: props, child: display }
  }
  mount(); return { ...f, change, select, type, displayType, mount, display: () => displayProps }
}

it('edits the original Auto mode query/cursor and reads its filtered native options', async () => {
  const f = autoSearchFixture(), before = f.read(), scope = before.snapshot.permissions.searchScope
  const result = await f.act(before.snapshot.revision, { action: 'search', scope, value: 'Database' })
  expect(f.change).toHaveBeenCalledExactlyOnceWith('Database'); expect(f.select).not.toHaveBeenCalled(); expect(f.getter).not.toHaveBeenCalled()
  expect(result.snapshot.permissions.search).toBe('Database'); expect(result.snapshot.permissions.searchScope).toBe(scope)
  expect(result.snapshot.permissions.choices.map((v: any) => v.value)).toEqual(['native-database-rule'])
  expect(f.display()).toMatchObject({ query: 'Database', cursorOffset: 8 })
  expect(result.snapshot.permissions.paragraphs.map((p: {runs: {text: string}[]}) => p.runs.map(r => r.text).join(''))).not.toContain('Unadapted native search hint')
  const none = await f.act(before.snapshot.revision, { action: 'search', scope, value: 'missing' }); expect(none.snapshot.permissions.choices).toEqual([])
  const cleared = await f.act(before.snapshot.revision, { action: 'search', scope, value: '' }); expect(cleared.snapshot.permissions.choices).toHaveLength(2)
})

it('keeps Auto mode search separate from strict mutation revisions and retires it after an action', async () => {
  const f = autoSearchFixture(), before = f.read(), scope = before.snapshot.permissions.searchScope
  const next = await f.act(before.snapshot.revision, { action: 'search', scope, value: 'Database' })
  await expect(f.act(before.snapshot.revision, { action: 'select', value: 'native-database-rule' })).rejects.toThrow(/changed/)
  await f.act(next.snapshot.revision, { action: 'select', value: 'native-database-rule' })
  await expect(f.act(next.snapshot.revision, { action: 'search', scope, value: 'retired' })).rejects.toThrow(/unavailable/)
  expect(f.select).toHaveBeenCalledExactlyOnceWith('native-database-rule')
})

it('refuses altered native search producers, query callbacks and display bindings', () => {
  const f = autoSearchFixture(); f.type.hash = 'foreign'; expect(f.read).toThrow(/search producer changed/)
  f.type.hash = '5492680dc6847a0efcf3b94da97323f463cad841677e5a44509103001e4c5665'; f.change.hash = 'foreign'; expect(f.read).toThrow(/query callback changed/)
  f.change.hash = '5fe3df31f754a92dcf6b401e5a84c7847a17025d80993378dac3c7156c9fca6a'; f.displayType.hash = 'foreign'; expect(f.read).toThrow(/query display changed/)
  expect(f.change).not.toHaveBeenCalled(); expect(f.select).not.toHaveBeenCalled()
})

it('does not report a dismissal as expired when the original panel settles during its wait', async () => {
  const f = fixture(); f.cancel.mockImplementation(() => { setTimeout(() => { f.entry.answered = true }, 5) })
  const result = await f.act(f.read().snapshot.revision, { action: 'cancel' })
  expect(f.cancel).toHaveBeenCalledOnce(); expect(result.snapshot.permissions).toMatchObject({ tabs: [], choices: [], readOnly: true })
})

function recentFixture() {
  const f = fixture(), approved = new Set<number>(), retry = new Set<number>(), blocked = new Set<number>()
  const denials = [{ command: 'git status' }, { command: 'git diff' }]
  const nativeProps = { denials, onStateChange: vi.fn(), onHeaderFocusChange: vi.fn() }
  const decisions = { approved, retry, denials }
  f.root.memoizedState = { memoizedState: { current: decisions } }
  f.tab.title = 'Recently denied'
  let focused = 0, detached = false
  const statusType = Object.assign(function NativeStatus() {}, { hash: 'b7097cfb75fda499f36e9f7d7385de9b7d46a6c526e45268b2eea4d0c06d4670' })
  const recentType = Object.assign(function RecentDenials() {}, { hash: '778577580f5ce69db75851a9cd5bca62db56721ba04ff74c8e1800fbe510cefa' })
  const select = vi.fn((value: string) => { const index = Number(value); if (!blocked.has(index)) { if (approved.has(index)) approved.delete(index); else approved.add(index) }; redraw() })
  const focus = vi.fn((value: string) => { focused = Number(value); redraw() })
  const keyDown = vi.fn((event: { key: string; preventDefault: () => void }) => { if (event.key !== 'r' || blocked.has(focused)) return; event.preventDefault(); if (retry.has(focused)) retry.delete(focused); else retry.add(focused); approved.add(focused); redraw() })
  function redraw() {
    const cache = Array(46); cache[13] = blocked; cache[15] = select; cache[16] = focus; cache[17] = focused; cache[18] = false; cache[20] = keyDown; cache[25] = approved; cache[29] = retry
    const picker = { options: denials.map((row, index) => ({ value: String(index), label: { props: { children: [{ type: statusType, props: { status: approved.has(index) ? 'success' : 'error', withSpace: true } }, row.command, { props: { children: retry.has(index) ? ' (retry)' : '' } }] } } })), onChange: select, onFocus: focus, isDisabled: false }
    const pickerFiber: any = { type: function Picker() {}, memoizedProps: picker }
    const container = { type: function NativeThemedBox() {}, props: { onKeyDown: keyDown } }
    cache[45] = container
    // The original themed Box forwards its handler to another Box/host. Only the cached element owns it.
    const host = { type: 'ink-box', memoizedProps: { onKeyDown: keyDown }, child: pickerFiber }
    const containerFiber = { type: container.type, memoizedProps: container.props, child: host }
    f.root.child = { type: function Tab() {}, memoizedProps: f.tab, sibling: { type: recentType, memoizedProps: detached ? { ...nativeProps } : nativeProps, updateQueue: { memoCache: { data: [cache] } }, child: containerFiber } }
  }
  redraw()
  return { ...f, approved, retry, blocked, focus, select, keyDown, recentType, statusType, redraw, detach: () => { detached = true; redraw() } }
}

describe('original Recently denied decisions', () => {
  it('projects original approval status and applies decisions only through original dismissal', async () => {
    const f = recentFixture(), before = f.read()
    expect(before.snapshot.permissions.choices[0]).toMatchObject({ value: '0', label: 'git status', approved: false, retryScheduled: false, retryAvailable: true })
    await f.act(before.snapshot.revision, { action: 'select', value: '0' })
    expect(f.focus).toHaveBeenCalledExactlyOnceWith('0')
    expect(f.select).toHaveBeenCalledExactlyOnceWith('0')
    expect(f.read().snapshot.permissions.decisions).toEqual({ approved: 1, retry: 0 })
    expect(f.cancel).not.toHaveBeenCalled()
    await f.close(); expect(f.cancel).toHaveBeenCalledOnce()
  })

  it('focuses the requested original row before invoking its original retry handler once', async () => {
    const f = recentFixture()
    const result = await f.act(f.read().snapshot.revision, { action: 'retry', value: '1' })
    expect(f.focus).toHaveBeenCalledExactlyOnceWith('1'); expect(f.keyDown).toHaveBeenCalledOnce()
    expect(f.select).not.toHaveBeenCalled(); expect([...f.retry]).toEqual([1]); expect([...f.approved]).toEqual([1])
    expect(result.snapshot.permissions.choices[1]).toMatchObject({ label: 'git diff', approved: true, retryScheduled: true })
    expect(result.snapshot.permissions.decisions).toEqual({ approved: 1, retry: 1 })
    await f.act(result.snapshot.revision, { action: 'retry', value: '1' })
    expect([...f.retry]).toEqual([]); expect([...f.approved]).toEqual([1])
  })

  it('preserves native retry state when approval is subsequently unticked', async () => {
    const f = recentFixture(); f.retry.add(0); f.redraw()
    expect(f.read().snapshot.permissions.decisions).toEqual({ approved: 0, retry: 1 })
  })

  it('refuses blocked, fabricated, stale and replacement retry requests', async () => {
    const f = recentFixture(); f.blocked.add(1); f.redraw()
    const revision = f.read().snapshot.revision
    await expect(f.act(revision, { action: 'retry', value: '1' })).rejects.toThrow(/unavailable/)
    await expect(f.act(revision, { action: 'retry', value: 'invented' })).rejects.toThrow(/unavailable/)
    f.detach(); await expect(f.act(revision, { action: 'retry', value: '0' })).rejects.toThrow(/changed/)
    expect(f.focus).not.toHaveBeenCalled(); expect(f.keyDown).not.toHaveBeenCalled()
  })

  it('refuses retry when the original row owner changes during focus acknowledgement', async () => {
    const f = recentFixture(); f.focus.mockImplementation(() => f.detach())
    await expect(f.act(f.read().snapshot.revision, { action: 'retry', value: '1' })).rejects.toThrow(/expired/)
    expect(f.keyDown).not.toHaveBeenCalled()
  })

  it('fails closed on an unrecognized native Recent producer or status atom', () => {
    const f = recentFixture(); f.recentType.hash = 'changed'; expect(f.read).toThrow(/producer changed/)
    const other = recentFixture(); other.statusType.hash = 'changed'; expect(other.read).toThrow(/label changed/)
  })

  it('does not toggle approval after its native owner is replaced during focus', async () => {
    const f = recentFixture(); f.focus.mockImplementation(() => f.detach())
    await expect(f.act(f.read().snapshot.revision, { action: 'select', value: '1' })).rejects.toThrow(/expired/)
    expect(f.select).not.toHaveBeenCalled(); expect([...f.approved]).toEqual([])
  })
})


it('preserves resolved native error text and nested paint without borrowing sibling styles', () => {
  const f = fixture()
  const plain = {tag:6,memoizedProps:' plus ordinary text'}
  const emphasized = {type:'ink-virtual-text',memoizedProps:{textStyles:{bold:true,color:'#abcdef'}},child:{tag:6,memoizedProps:'Important'},sibling:plain}
  f.root.child = {type:function Details(){},memoizedProps:{onCancel:f.cancel},child:{type:f.textType,memoizedProps:{color:'error'},child:{type:'ink-text',memoizedProps:{textStyles:{color:'#12ab34'}},child:emphasized}}}
  expect(f.read().snapshot.permissions.paragraphs).toEqual([{role:'alert',runs:[{text:'Important',style:{color:'#abcdef',bold:true}},{text:' plus ordinary text',style:{color:'#12ab34'}}]}])
})
