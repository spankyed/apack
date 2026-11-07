import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalResumeReturnRuntime } from '#features/code/be/services/claude-code/terminal-resume-return-runtime.ts'

function fixture() {
 const sessionId=randomUUID(),item={id:randomUUID(),kind:'newer_model_offer',payload:{from:'current-model',to:'newer-model'}},open=[item]
 const UCo=()=>{},Rwe=()=>{},Xe=()=>{}
 const hashes=new Map([
  ['70f73db42808df84f5da7f6d87cbea367577dc5a6e23934701267cd18c288442',createHash('sha256').update(UCo.toString()).digest('hex')],
  ['c6a64e9c72bf8b4b22fdae5a3819700a899b9e04a63862f8020717293e25c772',createHash('sha256').update(Rwe.toString()).digest('hex')],
  ['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5',createHash('sha256').update(Xe.toString()).digest('hex')],
 ])
 const answer=vi.fn((_choice:string)=>{open.splice(0)})
 const control={options:[{value:'keep',label:'Keep the current model'},{value:'resume_on_newer_model',label:'Resume on the newer model'}],onChange:answer}
 const panel={title:'A newer model is available for this conversation',onCancel:()=>answer('dismiss')}
 const row=Array(20).fill(undefined);row[15]={props:control};row[19]={props:panel}
 const view={type:Rwe,memoizedProps:{offer:item.payload,onDone:answer},updateQueue:{memoCache:{data:[row]}},child:{memoizedProps:panel,child:{type:Xe,memoizedProps:control}}}
 const root={type:UCo,memoizedProps:{payload:item.payload,answer},child:view}
 const binding={surface:'terminal',toolContext:()=>({dialogStore:{getState:()=>({open})}})}
 const n={themeRoots:{ai:()=>new Map([[undefined,{container:{current:root}}]])},questionOptions:{q:()=>sessionId}}
 let format=async(_n:unknown,text:string)=>text
 const runtime=vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalResumeReturnRuntime)+';({read:nativeNewerModelOffer,project:projectNativeNewerModelOffer,answer:answerNativeNewerModelOffer})',{originalContext:binding,AbortController,process:{stdout:undefined},composerFunctionHashes:new WeakMap(),createHash,nativeFunctionName:(name:string)=>name,nativeFunctionHash:(hash:string)=>hashes.get(hash),configUrl:'private',readFileSync:()=>JSON.stringify({sessionId}),randomUUID,dialogRevisions:new Map(),nativeGenericPermissionText:(...args:Parameters<typeof format>)=>format(...args)})
 const request=()=>({id:item.id,revision:runtime.read(n).revision,session_id:sessionId,decision:'newer_accept'})
 return{runtime,n,item,open,row,view,panel,control,answer,request,setFormat:(next:typeof format)=>{format=next}}
}
it.each([['newer_keep','keep'],['newer_accept','resume_on_newer_model'],['newer_dismiss','dismiss']])('delegates %s to the original offer without switching models itself',async(decision,native)=>{
 const f=fixture(),shown=await f.runtime.project(f.n,f.runtime.read(f.n))
 expect(shown.title).toBe(f.panel.title);expect(shown.paragraphs).toEqual([])
 expect(shown.choices.map((choice:{value:string})=>choice.value)).toEqual(['newer_keep','newer_accept'])
 const request={...f.request(),decision};f.runtime.answer(f.n,request);expect(f.answer).toHaveBeenCalledExactlyOnceWith(native)
 expect(()=>f.runtime.answer(f.n,request)).toThrow('expired')
})
it('refuses stale model facts and another session before invoking policy-sensitive callbacks',()=>{
 const f=fixture(),request=f.request()
 expect(()=>f.runtime.answer(f.n,{...request,session_id:randomUUID()})).toThrow('expired')
 expect(()=>f.runtime.answer(f.n,{...request,decision:'resume_compact'})).toThrow('Invalid')
 f.item.payload.to='a different model';expect(()=>f.runtime.answer(f.n,request)).toThrow('expired');expect(f.answer).not.toHaveBeenCalled()
})
it('rejects cached presentation after the original native control unmounts',()=>{
 const f=fixture(),request=f.request();Reflect.deleteProperty(f.view,'child')
 expect(f.runtime.read(f.n).item).toBeUndefined();expect(()=>f.runtime.answer(f.n,request)).toThrow('expired')
})
it('rechecks replacement after formatting original model labels',async()=>{
 const f=fixture(),d=f.runtime.read(f.n);f.setFormat(async(_n,text)=>{f.open.splice(0);return text})
 await expect(f.runtime.project(f.n,d)).rejects.toThrow('changed while formatting')
})
it('does not report success when the original offer refuses settlement',()=>{
 const f=fixture();f.control.onChange=vi.fn()
 expect(()=>f.runtime.answer(f.n,f.request())).toThrow('did not accept');expect(f.control.onChange).toHaveBeenCalledExactlyOnceWith('resume_on_newer_model')
})
