import { createApp, h, reactive, nextTick } from 'vue'
import NativeManagedSettingsNotice from '#features/threads/fe/chat/NativeManagedSettingsNotice.vue'
import NativeUiNotices from '#features/threads/fe/chat/NativeUiNotices.vue'
import type { ClaudeUiNotices } from '#features/code/be/services/claude-code/ui-presentation.ts'

it('renders native notices literally, keeps the latest three toasts and dismisses only the selected one', async () => {
  const notices = reactive<ClaudeUiNotices>({ statuses: [{ plugin: 'fixture', text: '<b>Pinned</b>\nSecond line' }], toasts: Array.from({ length: 4 }, (_, id) => ({ id: String(id), plugin: 'fixture', text: `<img src="${id}" onerror="bad()">` })) })
  const root = document.createElement('div'); document.body.append(root)
  const operate = vi.fn((event: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiNoticeEvent) => { if (event.kind === 'dismiss') notices.toasts = notices.toasts.filter(toast => toast.id !== event.id) })
  const app = createApp({ render: () => h('form', { onSubmit: (event: Event) => event.preventDefault() }, h(NativeUiNotices, { notices, onOperate: operate })) }); app.mount(root)
  try {
    expect(root.querySelector('b, img, script')).toBeNull(); expect(root.textContent).toContain('<b>Pinned</b>\nSecond line')
    expect(root.querySelectorAll('[data-native-toast]')).toHaveLength(3)
    const toast = root.querySelector<HTMLElement>('[data-native-toast]')!, button = toast.querySelector<HTMLButtonElement>('button')!
    toast.dispatchEvent(new MouseEvent('pointerenter')); button.focus()
    toast.dispatchEvent(new MouseEvent('pointerleave')); expect(operate.mock.calls.filter(([event]) => event.kind === 'hold')).toHaveLength(1)
    button.blur(); expect(operate.mock.calls.filter(([event]) => event.kind === 'hold').map(([event]) => event.kind === 'hold' && event.isHeld)).toEqual([true, false])
    button.click(); await nextTick()
    expect(root.querySelectorAll('[data-native-toast]')).toHaveLength(3); expect(root.textContent).not.toContain('src="1"')
    notices.statuses = []; notices.toasts = []; await nextTick(); expect(root.querySelector('section')).toBeNull()
  } finally { app.unmount(); root.remove() }
})


it('keeps keyboard ownership through a pending managed settings recheck and returns it when the warning clears', async () => {
  const state = reactive<{ show: boolean; eligible: boolean; operation?: 'pending' | 'error' }>({ show: true, eligible: true })
  const diagnostics = [{ file: 'managed-settings.json', path: '', message: 'Access refused', errno: 'EACCES' }]
  const root = document.createElement('div')
  document.body.append(root)
  const recheck = vi.fn(() => { state.operation = 'pending' })
  const returnFocus = vi.fn()
  const app = createApp({ render: () => state.show ? h(NativeManagedSettingsNotice, {
    diagnostics, canRecheck: state.eligible,
    recheck: state.operation && { status: state.operation, sessionId: 'same-session', viewRevision: 1 },
    onRecheck: recheck, onReturnFocus: returnFocus,
  }) : null })
  app.mount(root)
  try {
    root.querySelector('details')!.open = true
    const button = root.querySelector('button')!
    button.focus()
    button.click()
    await nextTick()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    button.click()
    expect(recheck).toHaveBeenCalledOnce()
    state.operation = 'error'
    state.eligible = false
    await nextTick()
    expect(document.activeElement).toBe(root.querySelector('summary'))
    state.show = false
    await nextTick()
    expect(returnFocus).toHaveBeenCalledOnce()
  } finally { app.unmount(); root.remove() }
})
