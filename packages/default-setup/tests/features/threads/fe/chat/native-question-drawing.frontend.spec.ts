import {createApp,h,reactive,nextTick} from 'vue'
import NativeQuestionDrawing from '#features/threads/fe/chat/NativeQuestionDrawing.vue'
import type {ClaudeUiQuestionFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
it('blocks decisions while its native frame is pending and exposes retry errors without caller duplication',async()=>{
 const frame=reactive<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'drawing',pending:true,shownInput:{questions:[{question:'Who should the release address?',header:'Audience',options:[{label:'Developers',description:'People integrating the change'},{label:'Operators',description:'People deploying it'}],multiSelect:false}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}})
 const root=document.createElement('div');document.body.append(root);const reject=vi.fn(),app=createApp({render:()=>h(NativeQuestionDrawing,{frame,disabled:false,canReject:true,onReject:reject})});app.mount(root)
 try{
  const button=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Reject question')!
  expect(button().disabled).toBe(true);button().click();expect(reject).not.toHaveBeenCalled()
  frame.pending=false;frame.problem='Original rejection was not acknowledged';await nextTick()
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(frame.problem);expect(button().disabled).toBe(false)
  button().click();expect(reject).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'drawing'})
 }finally{app.unmount();root.remove()}
})
