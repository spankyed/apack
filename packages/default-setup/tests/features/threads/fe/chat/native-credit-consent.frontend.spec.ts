import {createApp,h,nextTick,reactive} from 'vue'
import NativeCreditConsent from '#features/threads/fe/chat/NativeCreditConsent.vue'
import type {ClaudeNativeNotice,ClaudeNativeNoticeResponse} from '#features/code/common/native-notice.ts'

async function fixture(form=false){
 const previous=document.createElement('input');document.body.append(previous);previous.focus()
 const notice:Extract<ClaudeNativeNotice,{kind:'fable_overage_consent_prompt'}>={id:'credit',revision:crypto.randomUUID(),sessionId:crypto.randomUUID(),kind:'fable_overage_consent_prompt',title:'Usage credits',paragraphs:[],snapshot:{revision:'a'.repeat(64),rows:[],editor:form?{kind:'form',revision:'a'.repeat(64),title:'Confirm amount',submitLabel:'Pay',live:{id:'native-charge'},consent:{cancelLabel:'Go back',focusField:'answer'},description:'Original card and total',fields:[{key:'answer',label:'Type confirm to pay',value:''}]}:{kind:'choice',revision:'a'.repeat(64),title:'Request usage credits',disabled:false,consent:{description:'Original admin disclosure',cancelLabel:'Cancel',defaultFocusValue:'cancel'},options:[{value:'cancel',label:'Cancel',disabled:false},{value:'confirm',label:'Send request',disabled:false}]}}}
 const state=reactive({notice,answer:undefined as {id:string;revision:string;requestId?:string;status:'pending'|'done'|'error';problem?:string}|undefined}),answers:ClaudeNativeNoticeResponse[]=[]
 const root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeCreditConsent,{notice:state.notice,answer:state.answer,onAnswer:response=>answers.push(response)})});app.mount(root);await nextTick()
 function ack(status:'pending'|'done'|'error',problem?:string){const response=answers.at(-1)!;if(response.decision!=='credit')throw Error('wrong route');state.answer={id:response.id,revision:response.revision,requestId:response.credit.requestId,status,problem}}
 const flush=async()=>{await nextTick();await Promise.resolve();await nextTick()}
 return {root,state,answers,ack,flush,previous,dispose:()=>{app.unmount();root.remove();previous.remove()}}
}
it('shows original consent and cancel-first focus without settings/model chrome',async()=>{
 const f=await fixture()
 try{
  expect(f.root.textContent).toContain('Original admin disclosure');expect(f.root.textContent).not.toContain('0 settings');expect(f.root.textContent).not.toContain('Choose a model')
  expect(document.activeElement?.textContent).toBe('Cancel')
  expect(f.answers[0]).toMatchObject({decision:'credit',credit:{operation:{kind:'read'}}})
  const send=[...f.root.querySelectorAll('button')].find(button=>button.textContent==='Send request')!;send.click();await f.flush()
  expect(f.answers.at(-1)).toMatchObject({decision:'credit',credit:{operation:{kind:'editor',revision:'a'.repeat(64),editorRevision:'a'.repeat(64),command:{action:'select',value:'confirm'}}}})
  f.ack('pending');await f.flush();expect(f.root.textContent).toContain('Waiting for Claude Code')
  f.ack('error','Native credit response timed out');await f.flush();expect(f.root.querySelector('[role=alert]')).not.toBeNull();expect(f.root.textContent).toContain('Original admin disclosure')
 }finally{f.dispose()}
})
it('keeps live input and IME distinct from an explicit native payment submission',async()=>{
 const f=await fixture(true)
 try{
  f.ack('done');await f.flush();f.answers.length=0
  const input=f.root.querySelector<HTMLInputElement>('[data-native-setting-field=answer]')!
  input.value='con';input.dispatchEvent(new CompositionEvent('compositionstart'));input.dispatchEvent(new Event('input',{bubbles:true}));await f.flush();expect(f.answers).toHaveLength(0)
  input.value='confirm';input.dispatchEvent(new CompositionEvent('compositionend'));await f.flush()
  expect(f.answers).toHaveLength(1);expect(f.answers[0]).toMatchObject({credit:{operation:{command:{action:'change',formId:'native-charge',key:'answer',value:'confirm'}}}})
  f.ack('pending');await f.flush();expect(input.disabled).toBe(false)
  const editor=f.state.notice.snapshot.editor;if(editor?.kind!=='form')throw Error('wrong editor');editor.fields[0]!.value='confirm';editor.revision='b'.repeat(64);f.state.notice.snapshot.revision='b'.repeat(64)
  f.ack('done');await f.flush()
  expect(f.answers).toHaveLength(1)
  f.root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await f.flush()
  expect(f.answers.at(-1)).toMatchObject({credit:{operation:{revision:'b'.repeat(64),command:{action:'save',values:{answer:'confirm'}}}}})
 }finally{f.dispose()}
})
it('does not invent cancellation during native purchase processing',async()=>{
 const f=await fixture()
 try{
  f.state.notice.snapshot={revision:'c'.repeat(64),rows:[],dismissible:false,refreshPending:true,editor:{kind:'information',revision:'c'.repeat(64),title:'Usage credits',description:'Processing payment…'}};await f.flush();f.answers.length=0
  const close=[...f.root.querySelectorAll('button')].find(button=>button.textContent==='Close')!
  expect(close.disabled).toBe(true);f.root.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await f.flush();expect(f.answers).toHaveLength(0)
 }finally{f.dispose()}
})
