import { createApp, nextTick, reactive } from 'vue'
import NativeBackgroundSession from '#features/threads/fe/chat/NativeBackgroundSession.vue'
import type { ClaudeBackgroundSessionState } from '#features/threads/be/claude-terminal-views.ts'
const link = { sessionId: '24be904a-3c35-4981-9793-cbe7a6c19d46', continuedInSessionId: '05ff1d31-597d-4537-8737-4407191add6e', timestamp: '2026-10-29T12:13:13.909Z' }
it('renders observed child state and captures the worker target; retires Stop only on native acknowledgement', async () => {
  const state = reactive<ClaudeBackgroundSessionState>({ ...link, operation: 'refresh', status: 'done', revision: 1,
    session: { id: '05ff1d31', sessionId: link.continuedInSessionId, cwd: '/owned', pid: 119, state: 'working', status: 'busy' } })
  const operate = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeBackgroundSession, { continuation: link, state, onOperate: operate }); app.mount(root)
  try {
    expect(root.textContent).toContain('working in background')
    const stop = [...root.querySelectorAll('button')].find(button => button.textContent === 'Stop background session')!
    stop.click(); expect(operate).toHaveBeenCalledWith(link, { operation: 'stop', id: '05ff1d31', pid: 119 })
    state.operation = 'stop'; state.status = 'pending'; await nextTick()
    expect(root.textContent).not.toContain('Background session stopped')
    expect([...root.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    state.status = 'done'; state.session = { ...state.session!, state: 'stopped', pid: undefined }; await nextTick()
    expect(root.textContent).toContain('Background session stopped')
    expect(root.textContent).not.toContain('Stop background session')
    stop.click(); expect(operate).toHaveBeenCalledTimes(1)
  } finally { app.unmount(); root.remove() }
})
it('does not display another child state as the current session', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeBackgroundSession, { continuation: link, state: { ...link, continuedInSessionId: link.sessionId, operation: 'refresh', status: 'done', revision: 1,
    session: { id: '12345678', sessionId: link.sessionId, cwd: '/foreign', pid: 999, state: 'working' } } }); app.mount(root)
  try { expect(root.textContent).toContain('Checking background session'); expect(root.textContent).not.toContain('Stop background session') }
  finally { app.unmount(); root.remove() }
})
