import { createApp, h, reactive, nextTick, type App } from 'vue'
import NativeMcpUrl from '#features/threads/fe/chat/NativeMcpUrl.vue'
import type { ClaudeNativeMcpUrl, ClaudeNativeMcpUrlOperation } from '#features/code/common/native-mcp-url.ts'
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })
function fixture() {
  const url: ClaudeNativeMcpUrl = { id: 'url', revision: 'revision', sessionId: 'session', token: 'a'.repeat(64), ready: true, kind: 'mcp_elicitation', serverName: 'research', message: 'Review the release.', url: 'https://example.invalid/review', title: 'MCP server requests input', phase: 'prompt', userConfirmsCompletion: false, choices: [{ operation: 'accept', label: 'Accept', selected: true }, { operation: 'decline', label: 'Decline', selected: false }], warnings: [] }
  const state = reactive<{ url: ClaudeNativeMcpUrl; operation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string } }>({ url })
  const operate = vi.fn<(action: ClaudeNativeMcpUrlOperation) => void>(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeMcpUrl, { url: state.url, operation: state.operation, onOperate: operate }) }); app.mount(root)
  const button = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!
  return { state, operate, root, button }
}
it('shows only original choices and keeps the URL inert until the original action is requested', async () => {
  const f = fixture(); expect(f.root.querySelector('a')).toBeNull(); expect(f.root.textContent).toContain('https://example.invalid/review'); expect(f.button('Open in browser')).toBeUndefined()
  f.button('Accept').click(); f.button('Accept').click(); await nextTick(); expect(f.operate).toHaveBeenCalledExactlyOnceWith({ operation: 'accept' }); expect(f.button('Cancel').disabled).toBe(true)
  f.state.url.token = 'b'.repeat(64); await nextTick(); expect(f.button('Accept').disabled).toBe(true)
  f.state.operation = { sequence: 1, status: 'done' }; f.state.url.phase = 'waiting'; f.state.url.choices = [{ operation: 'open', label: 'Reopen URL', selected: true }, { operation: 'continue', label: 'Skip confirmation', selected: false }]; await nextTick()
  expect(f.button('Accept')).toBeUndefined(); expect(f.root.querySelector('[role=status]')?.textContent).toContain('Waiting'); f.button('Skip confirmation').click(); expect(f.operate).toHaveBeenLastCalledWith({ operation: 'continue' })
})
it('retains native refusal/error and allows a fresh original cancellation after acknowledgement', async () => {
  const f = fixture(); f.state.url.ready = false; await nextTick(); f.button('Cancel').click(); expect(f.operate).not.toHaveBeenCalled()
  f.state.url.ready = true; await nextTick(); f.button('Decline').click(); f.state.operation = { sequence: 1, status: 'error', problem: 'Original request changed' }; await nextTick(); expect(f.root.querySelector('[role=alert]')?.textContent).toBe('Original request changed'); f.button('Cancel').click(); expect(f.operate).toHaveBeenLastCalledWith({ operation: 'cancel' })
})
