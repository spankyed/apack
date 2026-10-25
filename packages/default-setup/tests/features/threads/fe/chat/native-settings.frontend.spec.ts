import { createApp, nextTick, reactive } from 'vue'
import NativeSettingsPanel from '#features/threads/fe/chat/NativeSettingsPanel.vue'
import type { ClaudeSettingsView, ClaudeSettingsOperation } from '#features/code/common/native-settings.ts'

it('keeps native values authoritative, explains locks and allows Close while a save is held', async () => {
  const state = reactive<{ state: ClaudeSettingsView }>({ state: { requestId: 'read', status: 'ready', snapshot: { revision: 'a'.repeat(64), rows: [
    { key: 'tips', label: 'Show tips', kind: 'boolean', value: true, isLocked: false },
    { key: 'thinking', label: 'Thinking', kind: 'boolean', value: true, isLocked: true, lockReason: 'Set by original policy' },
  ] } } })
  const operations: ClaudeSettingsOperation[] = [], close = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeSettingsPanel, { ...state, onOperate: (event: ClaudeSettingsOperation) => operations.push(event), onClose: close }); app.mount(root)
  try {
    await nextTick(); expect(operations).toEqual([{ kind: 'read' }])
    const tips = root.querySelector<HTMLInputElement>('[data-native-setting="tips"] input')!, locked = root.querySelector<HTMLInputElement>('[data-native-setting="thinking"] input')!
    expect(locked.disabled).toBe(true); expect(root.textContent).toContain('Set by original policy')
    tips.click(); await nextTick()
    expect(operations.at(-1)).toEqual({kind:'write',revision:'a'.repeat(64),key:'tips',value:false})
    expect(tips.checked).toBe(true)
    state.state.status = 'pending'; await nextTick(); expect(tips.disabled).toBe(true)
    const closeButton = [...root.querySelectorAll('button')].find(button => button.textContent === 'Close settings')!
    closeButton.click(); expect(close).toHaveBeenCalledOnce()
    state.state.status = 'error'; state.state.problem = 'Native save refused'; await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Native save refused'); expect(tips.checked).toBe(true)
  } finally { app.unmount(); root.remove() }
})
