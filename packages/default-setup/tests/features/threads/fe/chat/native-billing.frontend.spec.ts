import { createApp, h, nextTick, reactive } from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'

it('renders billing without helper output and clears it when its owner disappears', async () => {
 const state = reactive<{nativeUi?:ClaudeUiMountState}>({nativeUi:{status:'connecting',billing:{sessionId:'a',observedAt:1,info:{status:'allowed_warning',isUsingOverage:true}}}})
 const root=document.createElement('div'); document.body.append(root)
 const app=createApp({render:()=>h(StatusLine,state)}); app.mount(root)
 try {
  await nextTick(); expect(root.textContent).toContain('Usage credits charged')
  state.nativeUi={status:'connecting'}; await nextTick()
  expect(root.textContent).toContain('Billing status unknown')
  state.nativeUi=undefined; await nextTick()
  expect(root.querySelector('[data-testid="claude-billing-status"]')).toBeNull()
 } finally {app.unmount();root.remove()}
})
