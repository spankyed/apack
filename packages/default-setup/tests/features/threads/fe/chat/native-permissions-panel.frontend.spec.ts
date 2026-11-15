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
      ...(form ? { form: { value: '', placeholder: 'Enter permission rule', multiline: false, submitLabel: 'Continue' } } : { search: '' }) },
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
  expect(f.operate).toHaveBeenCalledExactlyOnceWith({ kind: 'permissions', revision: 'a'.repeat(64), command: { action: 'search', value: 'unmatched' } })
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
