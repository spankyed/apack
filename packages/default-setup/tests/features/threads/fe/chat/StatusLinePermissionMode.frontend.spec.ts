import { createApp, h, nextTick, reactive } from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { PermissionMode } from '#features/code/be/services/claude-code/types.ts'

it('shows the observed permission mode independently of an app phase and removes a retired observation', async () => {
  const state = reactive<{ nativePermissionMode?: PermissionMode }>({})
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(StatusLine, state) }); app.mount(root)
  try {
    expect(root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
    state.nativePermissionMode = 'acceptEdits'; await nextTick()
    const status = () => root.querySelector('[aria-label="Claude permission mode"]')
    expect(status()?.textContent).toBe('Permissions: Accept edits')
    state.nativePermissionMode = 'auto'; await nextTick()
    expect(status()?.textContent).toBe('Permissions: Auto')
    expect(root.querySelector('button')).toBeNull()
    state.nativePermissionMode = undefined; await nextTick()
    expect(status()).toBeNull()
    expect(root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
  } finally { app.unmount(); root.remove() }
})
