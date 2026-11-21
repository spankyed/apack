import {createApp,h,nextTick,reactive} from 'vue'
import NativeSettingsPanel from '#features/threads/fe/chat/NativeSettingsPanel.vue'
import type {ClaudeSettingsOperation,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
async function fixture(){
 const state=reactive<{view:ClaudeSettingsView}>({view:{requestId:'initial',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],dismissible:true,editor:{kind:'form',revision:'a'.repeat(64),title:'Buy usage credits',description:'Original charge disclosure',submitLabel:'Continue',fields:[{key:'answer',label:'Amount',value:'75'}],live:{id:'form-1',feedback:{text:'Native preview 75',tone:'success'}},consent:{cancelLabel:'Cancel',focusField:'answer'}}}}})
 const operations:ClaudeSettingsOperation[]=[],close=vi.fn(),root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{subject:'model',state:state.view,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action),onClose:close})});app.mount(root);await nextTick()
 const flush=async()=>{await nextTick();await Promise.resolve();await nextTick()},input=()=>root.querySelector<HTMLInputElement>('input')!,editors=()=>operations.filter((action):action is Extract<ClaudeSettingsOperation,{kind:'editor'}>=>action.kind==='editor')
 const type=async(value:string)=>{input().value=value;input().dispatchEvent(new Event('input',{bubbles:true}));await flush()}
 async function pending(id:string){state.view.requestId=id;state.view.status='pending';await flush()}
 async function ack(value:string,revision='b',tone:'success'|'error'='success'){
  const snapshot=state.view.snapshot!,editor=snapshot.editor!;if(editor.kind!=='form')throw Error('Form missing');editor.fields[0].value=value;editor.live!.feedback={text:'Native preview '+value,tone};editor.revision=revision.repeat(64);snapshot.revision=revision.repeat(64);state.view.status='ready';await flush()
 }
 return {state,operations,root,input,type,pending,ack,flush,editors,close,stop:()=>{app.unmount();root.remove()}}
}
it('coalesces rapid edits, retains local caret through older acknowledgement, and shows only current native feedback',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');expect(f.input().disabled).toBe(false)
  await f.type('10');await f.type('100');f.input().setSelectionRange(1,1);expect(f.editors()).toHaveLength(1)
  await f.ack('1');expect(f.input().value).toBe('100');expect(f.input().selectionStart).toBe(1);expect(f.root.textContent).toContain('Updating preview…');expect(f.root.textContent).not.toContain('Native preview 1')
  expect(f.editors().map(row=>row.command)).toEqual([{action:'change',formId:'form-1',key:'answer',value:'1'},{action:'change',formId:'form-1',key:'answer',value:'100'}])
  await f.pending('change-2');await f.ack('100','c');expect(f.input().selectionStart).toBe(1);expect(f.root.textContent).toContain('Native preview 100');expect(f.root.textContent).not.toContain('Updating preview…')
 }finally{f.stop()}
})
it('queues explicit submission behind preview and applies the original rejected-submit reset',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');await f.type('100');f.root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await f.flush();expect(f.input().disabled).toBe(true)
  await f.ack('1');expect(f.editors().map(row=>row.command)).toEqual([{action:'change',formId:'form-1',key:'answer',value:'1'},{action:'save',values:{answer:'100'}}])
  await f.pending('save-1');await f.ack('','c','error');expect(f.input().value).toBe('');expect(f.input().getAttribute('aria-invalid')).toBe('true');expect(f.root.querySelector('[role="alert"]')?.textContent).toBe('Native preview ')
 }finally{f.stop()}
})
it('discards queued edits and submission when Cancel is chosen during a held preview',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');await f.type('100');f.root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await f.flush();f.root.querySelector<HTMLButtonElement>('header button')!.click();await f.flush()
  await f.ack('1');expect(f.editors().map(row=>row.command.action)).toEqual(['change','cancel']);expect(f.close).not.toHaveBeenCalled()
  await f.pending('cancel-1');f.root.querySelector<HTMLButtonElement>('header button')!.click();await f.flush();await f.ack('1','c');f.root.querySelector<HTMLButtonElement>('header button')!.click();await f.flush();expect(f.editors().map(row=>row.command.action)).toEqual(['change','cancel']);expect(f.input().disabled).toBe(true)
 }finally{f.stop()}
})
it('holds IME composition through an older acknowledgement and sends only its final text',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');f.input().dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));f.input().value='日本';f.input().dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await f.flush()
  await f.ack('1');expect(f.input().value).toBe('日本');expect(f.editors()).toHaveLength(1)
  f.input().dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await f.flush();expect(f.editors().at(-1)?.command).toEqual({action:'change',formId:'form-1',key:'answer',value:'日本'})
 }finally{f.stop()}
})
it('refreshes once before a queued Cancel after a failed preview and does not retry a failed refresh',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');f.root.querySelector<HTMLButtonElement>('header button')!.click();await f.flush();f.state.view.status='error';f.state.view.problem='Original preview failed';await f.flush()
  expect(f.operations.filter(action=>action.kind==='read')).toHaveLength(2)
  await f.pending('recovery-read');f.state.view.status='error';await f.flush();expect(f.operations.filter(action=>action.kind==='read')).toHaveLength(2);expect(f.editors()).toHaveLength(1)
 }finally{f.stop()}
})
it('drops queued actions when the original native form is replaced or the panel unmounts',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');await f.type('100');f.root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await f.flush()
  const editor=f.state.view.snapshot!.editor!;if(editor.kind!=='form')throw Error('Form missing');editor.live!.id='replacement';await f.ack('250');expect(f.input().value).toBe('250');expect(f.editors()).toHaveLength(1)
  await f.type('300');await f.pending('replacement-change');await f.type('350');const count=f.operations.length;f.stop();await f.ack('300','c');expect(f.operations).toHaveLength(count)
 }finally{f.root.remove()}
})

it('settles a no-op draft locally without an unnecessary native call or pending preview',async()=>{
 const f=await fixture()
 try{await f.type('75');expect(f.editors()).toHaveLength(0);expect(f.root.textContent).toContain('Native preview 75');expect(f.root.textContent).not.toContain('Updating preview…')}finally{f.stop()}
})
it('retains a revert to the previous value while an older different draft is held',async()=>{
 const f=await fixture()
 try{
  await f.type('1');await f.pending('change-1');await f.type('75');await f.ack('1');expect(f.input().value).toBe('75');expect(f.editors().at(-1)?.command).toEqual({action:'change',formId:'form-1',key:'answer',value:'75'})
  await f.pending('change-2');await f.ack('75','c');expect(f.root.textContent).toContain('Native preview 75');expect(f.root.textContent).not.toContain('Updating preview…')
 }finally{f.stop()}
})
