import { createApp, h, reactive, nextTick } from 'vue'
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
