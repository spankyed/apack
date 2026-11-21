import { createApp, h, reactive, nextTick, ref } from 'vue'
import NativePanePanel from '#features/threads/fe/chat/NativePanePanel.vue'
import type { ClaudeUiPanePresentation } from '#features/code/be/services/claude-code/ui-presentation.ts'

it('keeps native titles literal, exposes tabs/close, and preserves denied-close presentation', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const state = reactive<ClaudeUiPanePresentation>({ roster: { panes: [{ id: 'a', title: '<script>Review</script>', plugin: 'fixture', close_on_escape: true }, { id: 'b', title: 'Second', plugin: 'fixture' }], shown_id: 'a', focused_id: null, focus_requested_id: null }, body: { status: 'live', tree: { kind: 'text', text: 'Native pane body' } } })
  const operate = vi.fn(), returned = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(NativePanePanel, { panes: state, onOperate: operate, onReturnFocus: returned }) }); app.mount(root)
  try {
    expect(root.querySelector('script')).toBeNull()
    const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true'); tabs[1].click()
    expect(operate).toHaveBeenLastCalledWith({ kind: 'show', id: 'b' })
    root.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')!.click()
    expect(operate).toHaveBeenLastCalledWith({ kind: 'close', id: 'a' })
    expect(root.textContent).toContain('Native pane body')
    root.querySelector('[role="tabpanel"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(operate).toHaveBeenLastCalledWith({ kind: 'close', id: 'a' }); expect(returned).not.toHaveBeenCalled()
    state.roster.shown_id = 'b'; await nextTick()
    root.querySelector('[role="tabpanel"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(operate).toHaveBeenLastCalledWith({ kind: 'focus', id: null }); expect(returned).toHaveBeenCalledOnce()
  } finally { app.unmount(); root.remove(); vi.unstubAllGlobals() }
})

it('resizes with keyboard bounds, keeps the user size across requests and reopen, and can restore the native request', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const state = reactive<ClaudeUiPanePresentation>({ roster: { panes: [{ id: 'a', title: 'Review', plugin: 'fixture', rows: 6 }], shown_id: 'a', focused_id: null, focus_requested_id: null }, body: { status: 'live', tree: { kind: 'text', text: 'Native pane body' } } })
  const preferred = ref<number>(), visible = ref(true), root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => visible.value ? h(NativePanePanel, { panes: state, preferredRows: preferred.value, onResize: (rows: number | undefined) => { preferred.value = rows } }) : null }); app.mount(root)
  const separator = () => root.querySelector<HTMLElement>('[role="separator"]')!
  const key = async (value: string) => { separator().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); await nextTick() }
  try {
    await nextTick(); expect(separator().getAttribute('aria-valuenow')).toBe('6')
    await key('ArrowDown'); expect(preferred.value).toBe(7); expect(separator().getAttribute('aria-valuenow')).toBe('7')
    state.roster.panes[0].rows = 3; await nextTick(); expect(separator().getAttribute('aria-valuenow')).toBe('7')
    visible.value = false; await nextTick(); visible.value = true; await nextTick()
    expect(separator().getAttribute('aria-valuenow')).toBe('7')
    await key('End'); expect(preferred.value).toBe(Number(separator().getAttribute('aria-valuemax')))
    await key('Home'); expect(preferred.value).toBe(2)
    await key('ArrowUp'); expect(preferred.value).toBe(2)
    root.querySelector<HTMLButtonElement>('button[aria-label="Use requested pane height"]')!.click(); await nextTick()
    expect(preferred.value).toBeUndefined(); expect(separator().getAttribute('aria-valuenow')).toBe('3')
    expect(root.querySelector<HTMLElement>('[role="tabpanel"]')!.style.height).toBe('60px')
  } finally { app.unmount(); root.remove(); vi.unstubAllGlobals() }
})
