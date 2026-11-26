import {afterEach, expect, it, vi} from 'vitest'
import {createApp, h, nextTick, reactive} from 'vue'
import NativePermissionsPanel from '#features/threads/fe/chat/NativePermissionsPanel.vue'
import type {ClaudeSettingsRequest, ClaudeSettingsView} from '#features/code/common/native-settings.ts'
const cleanup: (() => void)[] = []
afterEach(() => {for (const close of cleanup.splice(0)) close()})
function fixture(value = 'Original environment\n') {
  const root = document.createElement('div'); document.body.append(root)
  const state = reactive<{value: ClaudeSettingsView}>({value: {requestId: 'opened', status: 'ready', snapshot: {revision: 'a'.repeat(64), rows: [], permissions: {title: 'Auto mode environment', tabs: [], choices: [], paragraphs: [], readOnly: false, editor: {id: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64), value, closing: false}}}}})
  const operate = vi.fn<(request: ClaudeSettingsRequest) => void>()
  const app = createApp({render: () => h(NativePermissionsPanel, {state: state.value, onOperate: operate})}); app.mount(root)
  cleanup.push(() => {app.unmount(); root.remove()})
  const textarea = () => root.querySelector('textarea')!
  const type = async (value: string) => {textarea().value = value; textarea().dispatchEvent(new Event('input', {bubbles: true})); await nextTick()}
  const button = (label: string) => [...root.querySelectorAll('button')].find(b => b.textContent === label)!
  return {root, state, operate, textarea, type, button}
}
it('edits a real document above the ordinary form limit and saves the exact text once', async () => {
  const original = 'Original line\n'.repeat(2000), f = fixture(original); await nextTick()
  expect(f.textarea().value).toBe(original); expect(f.operate).not.toHaveBeenCalled()
  const changed = original + '\n新しい環境\n'; await f.type(changed)
  f.button('Save environment').click(); f.button('Save environment').click(); await nextTick()
  expect(f.operate).toHaveBeenCalledOnce()
  expect(f.operate.mock.calls[0]![0].action).toEqual({kind: 'permissions', revision: 'a'.repeat(64), command: {action: 'externalSave', id: '11111111-1111-4111-8111-111111111111', value: changed}})
  expect(f.button('Save environment').disabled).toBe(true)
})
it('preserves local edits on unchanged background snapshots and cancels without sending the draft', async () => {
  const f = fixture(); await f.type('Unsaved draft')
  f.state.value = JSON.parse(JSON.stringify(f.state.value)); await nextTick(); expect(f.textarea().value).toBe('Unsaved draft')
  f.button('Cancel').click()
  expect(f.operate.mock.calls[0]![0].action).toEqual({kind: 'permissions', revision: 'a'.repeat(64), command: {action: 'externalCancel', id: '11111111-1111-4111-8111-111111111111'}})
})
it('keeps ordinary newlines and IME Escape inside the document; Ctrl+Enter saves after composition', async () => {
  const f = fixture(); await nextTick()
  f.textarea().dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}))
  f.textarea().dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, isComposing: true}))
  f.textarea().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true, isComposing: true}))
  expect(f.operate).not.toHaveBeenCalled()
  f.textarea().dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}))
  f.textarea().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); expect(f.operate).not.toHaveBeenCalled()
  f.textarea().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true})); expect(f.operate).toHaveBeenCalledOnce()
})
it('refuses events from a replaced editor document', async () => {
  const f = fixture(); await nextTick(); const retired = f.textarea()
  f.state.value.snapshot!.permissions!.editor = {id: '22222222-2222-4222-8222-222222222222', revision: 'b'.repeat(64), value: 'Fresh document', closing: false}
  await nextTick(); retired.value = 'Stale'; retired.dispatchEvent(new Event('input', {bubbles: true})); retired.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true})); await nextTick()
  expect(f.operate).not.toHaveBeenCalled(); expect(f.textarea().value).toBe('Fresh document')
})
