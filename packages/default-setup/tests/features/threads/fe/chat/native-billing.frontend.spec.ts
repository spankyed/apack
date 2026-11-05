import { createApp, h, nextTick, reactive } from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'

it('renders billing without helper output and clears it when its owner disappears', async () => {
 const state = reactive<{nativeUi?:ClaudeUiMountState; nativeStatus?:string}>({nativeUi:{status:'connecting',billing:{sessionId:'a',observedAt:1,info:{status:'allowed_warning',isUsingOverage:true}}}})
 const root=document.createElement('div'); document.body.append(root)
 const app=createApp({render:()=>h(StatusLine,state)}); app.mount(root)
 try {
  await nextTick(); expect(root.textContent).toContain('Usage credits charged')
  state.nativeUi={status:'live',tree:{kind:'box',children:[]},billing:state.nativeUi!.billing}; await nextTick()
  expect(root.textContent).toContain('Usage credits charged')
  state.nativeUi={status:'connecting'}; await nextTick()
  expect(root.querySelector('[data-testid="claude-billing-status"]')).toBeNull()
  state.nativeStatus='Reviewing release notes'; await nextTick()
  expect(root.textContent).toContain('Reviewing release notes')
  expect(root.textContent).not.toContain('Billing status unknown')
  state.nativeUi={status:'live',tree:{kind:'box',children:[]},billing:{sessionId:'b',observedAt:2,info:{status:'unrecognized'}}}; await nextTick()
  expect(root.textContent).toContain('Usage status unknown')
  state.nativeUi=undefined; await nextTick()
  expect(root.querySelector('[data-testid="claude-billing-status"]')).toBeNull()
 } finally {app.unmount();root.remove()}
})
