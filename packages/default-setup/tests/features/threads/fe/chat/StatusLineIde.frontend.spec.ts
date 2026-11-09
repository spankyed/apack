import {createApp,nextTick,reactive} from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type {ClaudeUiMountState} from '#features/code/be/services/claude-code/ui-presentation.ts'
it('shows the native context label and keeps detached dismissal controls bound to their original revision',async()=>{
  const state=reactive<ClaudeUiMountState>({status:'live',tree:{kind:'box',children:[]},ide:{text:'[⧉ 1 line selected] ',revision:'a'.repeat(64),actionId:'11111111-1111-4111-8111-111111111111'}})
  const press=vi.fn(),root=document.createElement('div');document.body.append(root)
  const app=createApp(StatusLine,{nativeUi:state,statusLine:'/project',onPress:press});app.mount(root)
  try {
    await nextTick();expect(root.querySelector('[aria-label="Claude IDE context"]')?.textContent).toContain('[⧉ 1 line selected]')
    const old=root.querySelector<HTMLButtonElement>('[aria-label="Dismiss IDE context"]')!
    state.ide={text:'[⧉ 2 lines selected] ',revision:'b'.repeat(64),actionId:'22222222-2222-4222-8222-222222222222'};await nextTick()
    old.click();expect(press).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111')
    root.querySelector<HTMLButtonElement>('[aria-label="Dismiss IDE context"]')!.click()
    expect(press).toHaveBeenLastCalledWith('22222222-2222-4222-8222-222222222222')
    state.ide=undefined;await nextTick();expect(root.querySelector('[aria-label="Claude IDE context"]')).toBeNull()
  } finally {app.unmount();root.remove()}
})
