import {createApp,h,reactive,ref,nextTick} from 'vue'
import NativeQuestionDrawing from '#features/threads/fe/chat/NativeQuestionDrawing.vue'
import type {ClaudeUiQuestionFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
it('blocks decisions while its native frame is pending and exposes retry errors without caller duplication',async()=>{
 const frame=reactive<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'drawing',shownInput:{questions:[{question:'Who should the release address?',header:'Audience',options:[{label:'Developers',description:'People integrating the change'},{label:'Operators',description:'People deploying it'}],multiSelect:false}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}})
 const root=document.createElement('div');document.body.append(root);const reject=vi.fn(),pause=vi.fn(),pending=ref(true),app=createApp({render:()=>h(NativeQuestionDrawing,{frame,pending:pending.value,canReject:true,onReject:reject,onPause:pause})});app.mount(root)
 try{
  const button=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Reject question')!
  expect(button().disabled).toBe(true);button().click();expect(reject).not.toHaveBeenCalled()
  expect(root.querySelector('[role="status"]')?.textContent).toBe('Waiting for Claude…');expect(root.querySelector('[aria-label="Question details"]')?.getAttribute('aria-busy')).toBe('true')
  const cancel=[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!
  expect(cancel.disabled).toBe(false);cancel.click()
  expect(pause).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'drawing'})
  frame.pending=true;await nextTick();expect(cancel.disabled).toBe(true)
  pending.value=false;frame.pending=false;frame.problem='Original rejection was not acknowledged';await nextTick()
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(frame.problem);expect(button().disabled).toBe(false)
  expect(root.querySelector('[role="status"]')).toBeNull();expect(root.querySelector('[aria-label="Question details"]')?.hasAttribute('aria-busy')).toBe(false)
  frame.problem='Native UI request timed out';await nextTick();expect(root.querySelector('[role="alert"]')?.textContent).toBe('Claude has not confirmed your decision. Try again when it responds.')
  button().click();expect(reject).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'drawing'})
 }finally{app.unmount();root.remove()}
})


it.each(['id','revision','draftActionId'] as const)('retires the old draft/card when native question %s changes on the same message',async key=>{
 const frame=ref<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'old-token',shownInput:{questions:[{question:'Who should the release address?',header:'Audience',kind:'text'}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}});
 const root=document.createElement('div');document.body.append(root);const pause=vi.fn(),app=createApp({render:()=>h(NativeQuestionDrawing,{frame:frame.value,disabled:false,onPause:pause})});app.mount(root);
 try{
  const textarea=root.querySelector('textarea')!;textarea.value='Old question draft';textarea.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
  const cancel=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!;
  cancel().click();expect(pause).toHaveBeenLastCalledWith({messageId:'question',token:'old-token'});
  frame.value={...frame.value,[key]:'replacement',token:'new-token'};await nextTick();
  expect(root.querySelector('textarea')?.value).toBe('');cancel().click();
  expect(pause).toHaveBeenLastCalledWith({messageId:'question',token:'new-token'});
 }finally{app.unmount();root.remove()}
});


it('keeps the originally held draft token and text through an ordinary same-question redraw',async()=>{
 const frame=ref<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'held-token',shownInput:{questions:[{question:'Who?',header:'Audience',kind:'text'}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}});
 const root=document.createElement('div');document.body.append(root);const pause=vi.fn(),app=createApp({render:()=>h(NativeQuestionDrawing,{frame:frame.value,disabled:false,onPause:pause})});app.mount(root);
 try{
  const textarea=root.querySelector('textarea')!;textarea.value='Keep this draft';textarea.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
  frame.value={...frame.value,token:'later-drawing-token'};await nextTick();
  expect(root.querySelector('textarea')).toBe(textarea);expect(textarea.value).toBe('Keep this draft');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!.click();
  expect(pause).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'held-token'});
 }finally{app.unmount();root.remove()}
});
