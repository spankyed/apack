import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalEffortNudgeRuntime } from '#features/code/be/services/claude-code/terminal-effort-nudge-runtime.ts'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'
function fixture(cancelFirst=false,reader=false){
 const sessionId=randomUUID(),payload={model:'claude-opus-5-5',copy:{body:'Original model effort explanation',fromLevel:'high',toLevel:'medium'}},item={id:randomUUID(),kind:'effort_medium_nudge',payload},open=[item]
 function WCo(){}
 function KSe(){}
 function lr(){}
 const hashes=new Map([['31de5abb44ffd78579919bfd0574f3f08c124efcc60007f3344c240ca2b2faa6',createHash('sha256').update(WCo.toString()).digest('hex')],['2443a2be7a2af0dae5d76bfca389432c87abd845f0ff59ba3958aaf9790ab720',createHash('sha256').update(KSe.toString()).digest('hex')],['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70',createHash('sha256').update(lr.toString()).digest('hex')]])
 const answer=vi.fn((_result:{choice:string;optionOrder:string})=>open.splice(0)),optionOrder=reader?'screen_reader':cancelFirst?'cancel_first':'confirm_first',control={confirmLabel:'Use medium by default',cancelLabel:'Keep high',cancelFirst,focus:cancelFirst?'cancel':'confirm',refuseInput:vi.fn(()=>false),onConfirm:vi.fn(()=>answer({choice:'accept',optionOrder})),onCancel:vi.fn(()=>answer({choice:'decline',optionOrder}))}
 const row=Array(75).fill(undefined);row[47]=payload.copy.body;row[49]='Original model-specific warning';row[62]={props:control};row[74]={props:{title:'Original effort title'}}
 const selector={type:lr,memoizedProps:control},renderer={type:KSe,memoizedProps:{model:payload.model,copy:payload.copy},child:selector,updateQueue:{memoCache:{data:[row]}}},wrapper={type:WCo,memoizedProps:{payload,answer,wouldTakeAnswer:()=>true},child:renderer}
 const notifications={current:undefined as {key:string;kind:string;text:string;jsx?:unknown}|undefined,queue:[] as unknown[]},view={kind:'main'}
 const binding={surface:'terminal',toolContext:()=>({dialogStore:{getState:()=>({open})},getAppState:()=>({notifications})})}
 const n={themeRoots:{ai:()=>new Map([[undefined,{container:{current:wrapper}}]])},questionOptions:{q:()=>sessionId}}
 let format=async(_n:unknown,value:string)=>value
 const runtime=vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalEffortNudgeRuntime)+';({read:nativeEffortNudge,project:projectNativeEffortNudge,answer:answerNativeEffortNudge,result:nativeEffortPreferenceResult})',{originalContext:binding,AbortController,process:{stdout:undefined},composerFunctionHashes:new WeakMap(),createHash,nativeFunctionName:(s:string)=>s,nativeFunctionHash:(s:string)=>hashes.get(s),configUrl:'private',readFileSync:()=>JSON.stringify({sessionId}),randomUUID,dialogRevisions:new Map(),nativeViewFacts:()=>({view}),nativeGenericPermissionText:(...args:Parameters<typeof format>)=>format(...args)})
 const request=(decision='effort_accept')=>({id:item.id,revision:runtime.read(n).revision,session_id:sessionId,decision})
 return{runtime,n,payload,item,open,row,wrapper,renderer,selector,control,answer,request,notifications,view,setFormat:(f:typeof format)=>{format=f}}
}
it.each([{cancelFirst:false,reader:false},{cancelFirst:true,reader:false},{cancelFirst:false,reader:true}])('retains native labels/warning/order and delegates exact original results for %j',async({cancelFirst,reader})=>{
 const f=fixture(cancelFirst,reader),notice=ClaudeNativeNoticeSchema.parse(await f.runtime.project(f.n,f.runtime.read(f.n)));expect(notice).toMatchObject({title:'Original effort title',paragraphs:['Original model effort explanation'],warning:'Original model-specific warning',preferredChoice:cancelFirst?'effort_decline':'effort_accept'});expect(notice.kind==='effort_medium_nudge'&&notice.choices.map(choice=>choice.value)).toEqual(cancelFirst?['effort_decline','effort_accept']:['effort_accept','effort_decline']);expect(f.control.refuseInput).not.toHaveBeenCalled()
 const request=f.request();f.runtime.answer(f.n,request);expect(f.control.onConfirm).toHaveBeenCalledOnce();expect(f.answer).toHaveBeenCalledExactlyOnceWith({choice:'accept',optionOrder:reader?'screen_reader':cancelFirst?'cancel_first':'confirm_first'});expect(()=>f.runtime.answer(f.n,request)).toThrow('expired')
})
it('delegates decline and suppresses a native-withdrawn warning',async()=>{const f=fixture();f.row[49]=false;const notice=ClaudeNativeNoticeSchema.parse(await f.runtime.project(f.n,f.runtime.read(f.n)));expect('warning'in notice&&notice.warning).toBeFalsy();f.runtime.answer(f.n,f.request('effort_decline'));expect(f.control.onCancel).toHaveBeenCalledOnce();expect(f.answer).toHaveBeenCalledExactlyOnceWith({choice:'decline',optionOrder:'confirm_first'})})
it('preserves native input grace and unaccepted decisions',()=>{const f=fixture(),request=f.request();f.control.refuseInput.mockReturnValue(true);expect(()=>f.runtime.answer(f.n,request)).toThrow('not ready');expect(f.control.onConfirm).not.toHaveBeenCalled();f.control.refuseInput.mockReturnValue(false);f.control.onConfirm=vi.fn();expect(()=>f.runtime.answer(f.n,f.request())).toThrow('has not accepted');expect(f.open).toHaveLength(1)})
it('fences session, mutable copy and replaced native controls',()=>{const f=fixture(),request=f.request();expect(()=>f.runtime.answer(f.n,{...request,session_id:randomUUID()})).toThrow('expired');f.payload.copy.body='Changed original copy';expect(()=>f.runtime.answer(f.n,request)).toThrow('expired');const current=f.request();const next={...f.control,onConfirm:vi.fn()};f.row[62]={props:next};f.selector.memoizedProps=next;expect(()=>f.runtime.answer(f.n,current)).toThrow('expired');expect(f.answer).not.toHaveBeenCalled()})
it('cannot attach to a previous item that reused the model and copy',()=>{const f=fixture();f.wrapper.memoizedProps.payload={...f.payload};expect(f.runtime.read(f.n).item).toBeUndefined()})
it('rechecks lifetime after asynchronous native formatting',async()=>{const f=fixture(),d=f.runtime.read(f.n);f.setFormat(async(_n,text)=>{f.open.splice(0);return text});await expect(f.runtime.project(f.n,d)).rejects.toThrow('changed while formatting')})

it('mirrors exact native success/failure text without fabricating preference success or replaying expired/queued results',()=>{
 const f=fixture();f.open.splice(0);f.notifications.current={key:'effort-medium-nudge-result',kind:'warning',text:'Effort setting unavailable right now · nothing changed'}
 const first=ClaudeNativeNoticeSchema.parse(f.runtime.result(f.n));expect(first).toMatchObject({kind:'effort_preference_result',severity:'warning',paragraphs:[f.notifications.current.text]});expect(f.runtime.result(f.n).revision).toBe(first.revision)
 f.notifications.current.text='Original settings write failed';expect(f.runtime.result(f.n).revision).not.toBe(first.revision)
 f.notifications.queue=[f.notifications.current];f.notifications.current=undefined;expect(f.runtime.result(f.n)).toBeUndefined()
 f.notifications.current={key:'effort-medium-nudge-result',kind:'feedback',text:'Effort set to medium and saved as your default'};expect(f.runtime.result(f.n).paragraphs).toEqual([f.notifications.current.text])
 f.view.kind='agent';expect(f.runtime.result(f.n)).toBeUndefined();f.view.kind='main';f.notifications.current.jsx={};expect(f.runtime.result(f.n)).toBeUndefined();delete f.notifications.current.jsx;f.open.push(f.item);expect(f.runtime.result(f.n)).toBeUndefined()
})

it('keeps a reviewed choice valid across original layout-only control reconstruction',()=>{
 const f=fixture(),request=f.request(),next={...f.control,confirmLabel:'Use medium\nby default',cancelLabel:'Keep\nhigh'}
 f.row[62]={props:next};f.selector.memoizedProps=next
 expect(f.runtime.read(f.n).revision).toBe(request.revision)
 f.runtime.answer(f.n,request);expect(f.control.onConfirm).toHaveBeenCalledOnce()
})
it('fences renewed answer ownership and original input lifetime',()=>{
 for(const field of ['answer','openedAt','refuseInput','focus','cancelFirst']){
  const f=fixture(),request=f.request()
  if(field==='answer')f.wrapper.memoizedProps.answer=vi.fn()
  else Object.assign(f.control,{[field]:field==='openedAt'?123:field==='refuseInput'?()=>false:field==='focus'?'cancel':true})
  expect(()=>f.runtime.answer(f.n,request)).toThrow('expired');expect(f.answer).not.toHaveBeenCalled()
 }
})
