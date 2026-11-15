import { createApp, h, reactive, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { ClaudeSettingsView } from '#features/code/common/native-settings.ts'
import NativePermissionsPanel from '#features/threads/fe/chat/NativePermissionsPanel.vue'

const mounted: (() => void)[] = []
afterEach(() => { for (const close of mounted.splice(0)) close(); vi.useRealTimers() })
function fixture(form = false) {
  const root = document.createElement('div'); document.body.append(root)
  const state = reactive<{ value: ClaudeSettingsView }>({ value: { requestId: 'read', status: 'ready', snapshot: {
    revision: 'a'.repeat(64), rows: [], permissions: { title: 'Permissions', tabs: [{ value: 'Allow', label: 'Allow', selected: true }, { value: 'Ask', label: 'Ask', selected: false }], paragraphs: ['Rules are validated and saved by Claude Code.'], choices: form ? [] : [{ value: 'native-source-key', label: 'Read(release-notes.md)', disabled: false }], readOnly: false,
      ...(form ? { form: { value: '', placeholder: 'Enter permission rule', multiline: false, submitLabel: 'Continue' } } : { search: '', searchScope: 'c'.repeat(64) }) },
  } } })
  const operate = vi.fn(), terminal = vi.fn()
  const app = createApp({ render: () => h(NativePermissionsPanel, { state: state.value, onOperate: operate, onTerminal: terminal }) })
  app.mount(root); const close = () => { app.unmount(); root.remove() }; mounted.push(close)
  return { root, state, operate, terminal, close, buttons: () => [...root.querySelectorAll('button')] }
}

it('sends the advertised original tab and rule keys with the current revision', async () => {
  const f = fixture(); await nextTick(); f.operate.mockClear()
  f.buttons().find(b => b.textContent === 'Ask')!.click()
  f.buttons().find(b => b.textContent?.includes('Read(release-notes.md)'))!.click()
  expect(f.operate.mock.calls.map(([v]) => v)).toEqual([
    { kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'tab', value: 'Ask' } },
    { kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'select', value: 'native-source-key' } },
  ])
})

it('retains a typed form draft when background snapshots contain unchanged native defaults', async () => {
  const f = fixture(true); await nextTick()
  const input = f.root.querySelector('input')!; input.value = 'Read(release-notes.md)'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  f.state.value = JSON.parse(JSON.stringify(f.state.value)); await nextTick()
  expect(f.root.querySelector('input')!.value).toBe('Read(release-notes.md)')
  f.buttons().find(b => b.textContent === 'Continue')!.click()
  expect(f.operate).toHaveBeenLastCalledWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'submit', value: 'Read(release-notes.md)' } })
})

it('filters through the native operation rather than filtering displayed choices locally', async () => {
  vi.useFakeTimers(); const f = fixture(); await nextTick(); f.operate.mockClear()
  const input = f.root.querySelector('input')!; input.focus(); input.value = 'unmatched'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); await vi.advanceTimersByTimeAsync(200)
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'search', scope: 'c'.repeat(64), value: 'unmatched' } })
  expect(f.root.textContent).toContain('Read(release-notes.md)')
})

it('withholds advertised mutations while an original action is pending', async () => {
  const f = fixture(); await nextTick(); f.operate.mockClear(); f.state.value.status = 'pending'; await nextTick()
  f.buttons().find(b => b.textContent === 'Ask')!.click()
  expect(f.operate).not.toHaveBeenCalled()
  expect(f.root.querySelector('[role="status"]')?.textContent).toContain('Waiting for Claude Code')
})

it('retains an explicit terminal route while remaining native branches are being adapted', async () => {
  const f = fixture(); await nextTick(); f.buttons().find(b => b.textContent === 'Use terminal controls')!.click(); expect(f.terminal).toHaveBeenCalledOnce()
})

it('places confirmation context before decisions and preserves the native cancel focus', async () => {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const f = fixture(); await nextTick()
  const panel = f.state.value.snapshot!.permissions!
  panel.title = 'Delete rule'; panel.tabs = []; delete panel.search
  panel.paragraphs = ['This deletes the original rule.']
  panel.choices = [{ value: 'confirm', label: 'Yes', disabled: false }, { value: 'cancel', label: 'No', description: 'Keep the original rule', disabled: false }]
  panel.defaultFocusValue = 'cancel'; await nextTick(); await nextTick()
  const warning = [...f.root.querySelectorAll('p')].find(p => p.textContent === 'This deletes the original rule.')!
  const yes = f.buttons().find(b => b.textContent === 'Yes')!
  expect(warning.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.activeElement?.textContent).toContain('No'); expect(document.activeElement?.textContent).toContain('Keep the original rule')
  focus.mockRestore()
})

it('retains debounced search across an in-flight refresh and sends with its current revision', async () => {
  vi.useFakeTimers(); const f = fixture(); await nextTick(); f.operate.mockClear()
  const input = f.root.querySelector('input')!; input.value = 'release-notes'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  f.state.value.status = 'pending'; await nextTick(); await vi.advanceTimersByTimeAsync(200)
  expect(f.operate).not.toHaveBeenCalled()
  f.state.value = { ...f.state.value, status: 'ready', snapshot: { ...f.state.value.snapshot!, revision: 'b'.repeat(64), permissions: { ...f.state.value.snapshot!.permissions!, search: '' } } }; await nextTick()
  expect(input.value).toBe('release-notes')
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'b'.repeat(64), command: { action: 'search', scope: 'c'.repeat(64), value: 'release-notes' } })
})

it('discards a queued search when its original tab is replaced', async () => {
  vi.useFakeTimers(); const f = fixture(); await nextTick(); f.operate.mockClear()
  const input = f.root.querySelector('input')!; input.value = 'old-tab-query'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  const panel = f.state.value.snapshot!.permissions!; panel.tabs[0].selected = false; panel.tabs[1].selected = true; panel.searchScope = 'd'.repeat(64); await nextTick(); await vi.advanceTimersByTimeAsync(200)
  expect(f.operate).not.toHaveBeenCalled(); expect(input.value).toBe('')
})

async function directoryFixture() {
  const f = fixture(true), panel = f.state.value.snapshot!.permissions!
  panel.title = 'Add directory to workspace'; panel.form!.placeholder = 'Directory path…'; panel.form!.submitLabel = 'Add directory'; panel.form!.value = 'ref'
  panel.form!.live = { id: 'd'.repeat(64), revision: 'e'.repeat(64), selectedValue: '/native/reference', suggestions: [{ value: '/native/reference', label: 'reference/', description: 'directory', token: 'f'.repeat(64) }, { value: '/native/references', label: 'references/', token: '1'.repeat(64) }] }
  await nextTick(); f.operate.mockClear()
  return f
}
type DirectoryFixture = Awaited<ReturnType<typeof directoryFixture>>
async function directoryReply(f: DirectoryFixture, requestId: string, value: string, revision = '2'.repeat(64)) {
  const next: ClaudeSettingsView = JSON.parse(JSON.stringify(f.state.value)); next.requestId = requestId; next.status = 'ready'; next.snapshot!.revision = 'b'.repeat(64)
  next.snapshot!.permissions!.form!.value = value; next.snapshot!.permissions!.form!.live!.revision = revision
  f.state.value = next; await nextTick(); await nextTick()
}
function typeDirectory(f: DirectoryFixture, value: string) { const input = f.root.querySelector('input')!; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); return input }

it('completes an original directory suggestion without submitting access', async () => {
  const f = await directoryFixture()
  f.root.querySelector<HTMLButtonElement>('[role="option"]')!.click(); await nextTick()
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'complete', scope: 'd'.repeat(64), value: '/native/reference', token: 'f'.repeat(64) } })
  await directoryReply(f, 'completion', '/native/reference/')
  expect(f.root.querySelector('input')!.value).toBe('/native/reference/')
  expect(f.operate.mock.calls.some(([v]) => v.command?.action === 'submit')).toBe(false)
})

it('coalesces typing behind an original live edit without erasing a newer local draft', async () => {
  const f = await directoryFixture(); const input = typeDirectory(f, 'refa'); await nextTick()
  f.state.value.status = 'pending'; await nextTick(); expect(input.disabled).toBe(false)
  typeDirectory(f, 'refab'); typeDirectory(f, 'refabc'); await nextTick()
  expect(f.operate).toHaveBeenCalledTimes(1)
  await directoryReply(f, 'first-edit', 'refa')
  expect(input.value).toBe('refabc')
  expect(f.operate.mock.calls.map(([v]) => v.command?.value)).toEqual(['refa', 'refabc'])
  await directoryReply(f, 'latest-edit', 'refabc', '3'.repeat(64)); expect(input.value).toBe('refabc')
})

it('waits for the real native draft before submitting a queued Enter exactly once', async () => {
  const f = await directoryFixture(), input = typeDirectory(f, 'reference'); await nextTick(); await Promise.resolve()
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'change', scope: 'd'.repeat(64), value: 'reference' } })
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await nextTick()
  expect(f.operate.mock.calls.some(([v]) => v.command?.action === 'submit'), JSON.stringify(f.operate.mock.calls)).toBe(false)
  await directoryReply(f, 'edit-ack', '/native/reference', '9'.repeat(64))
  expect(f.operate).toHaveBeenLastCalledWith({ kind: 'permissions', revision: 'b'.repeat(64), command: { action: 'submit', scope: 'd'.repeat(64), formRevision: '9'.repeat(64), value: '/native/reference' } })
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await nextTick()
  expect(f.operate.mock.calls.filter(([v]) => v.command?.action === 'submit')).toHaveLength(1)
})

it('retires buffered edits when the original directory form is replaced', async () => {
  const f = await directoryFixture(); const retiredInput = typeDirectory(f, 'refa'); await nextTick(); typeDirectory(f, 'refab'); await nextTick()
  f.state.value.snapshot!.permissions!.form!.live!.id = '4'.repeat(64); f.state.value.snapshot!.permissions!.form!.value = 'new-owner'; f.state.value.requestId = 'replacement'; await nextTick(); await nextTick()
  expect(f.root.querySelector('input')!.value).toBe('new-owner'); expect(f.operate).toHaveBeenCalledTimes(1)
  retiredInput.value = 'retired-composition'; retiredInput.dispatchEvent(new Event('input', { bubbles: true })); retiredInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await nextTick()
  expect(f.root.querySelector('input')!.value).toBe('new-owner'); expect(f.operate).toHaveBeenCalledTimes(1)
})

it('keeps composing text local until composition finishes', async () => {
  const f = await directoryFixture(), input = f.root.querySelector('input')!
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); input.value = '資料'
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '資料', isComposing: true })); await nextTick()
  expect(f.operate).not.toHaveBeenCalled()
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await nextTick(); await nextTick()
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'change', scope: 'd'.repeat(64), value: '資料' } })
})

it('retains an arrow-selected completion through a background read and completes it with Tab', async () => {
  const f = await directoryFixture(), input = f.root.querySelector('input')!
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await nextTick()
  f.state.value.status = 'pending'; await nextTick(); await directoryReply(f, 'background-read', 'ref')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await nextTick()
  expect(f.operate).toHaveBeenLastCalledWith({ kind: 'permissions', revision: 'b'.repeat(64), command: { action: 'complete', scope: 'd'.repeat(64), value: '/native/references', token: '1'.repeat(64) } })
})

it('shows the original directory validation error and clears it only with native state', async () => {
  const f = await directoryFixture(); f.state.value.snapshot!.permissions!.form!.live!.problem = 'Original path is not accessible'; await nextTick()
  expect(f.root.querySelector('[role="alert"]')?.textContent).toBe('Original path is not accessible')
  delete f.state.value.snapshot!.permissions!.form!.live!.problem; await nextTick(); expect(f.root.querySelector('[role="alert"]')).toBeNull()
})

it('does not replay a queued add after a background read fails', async () => {
  const f = await directoryFixture(), input = f.root.querySelector('input')!
  f.state.value.status = 'pending'; await nextTick()
  typeDirectory(f, 'unsent-reference'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await nextTick()
  expect(f.operate).not.toHaveBeenCalled()
  f.state.value.status = 'error'; f.state.value.problem = 'Original read failed'; await nextTick()
  await directoryReply(f, 'refreshed', 'ref'); delete f.state.value.problem; await nextTick(); await nextTick()
  expect(input.value).toBe('unsent-reference'); expect(f.operate).not.toHaveBeenCalled()
})
