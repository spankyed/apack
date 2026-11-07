import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalColdQuotaRuntime } from '#features/code/be/services/claude-code/terminal-cold-quota-runtime.ts'
function fixture() {
 const sessionId=randomUUID(),item={id:randomUUID(),kind:'cold_resume_quota',payload:{inactiveSince:1000,contextTokens:120000,percentOfFiveHourLimit:8,trigger:'idle',focusedAction:'new_conversation'}},open=[item]
 const HCo=()=>{},BZe=()=>{},Xe=()=>{}
 const hashes=new Map([
 ['7065ff3b6377c8b988df5624a99ffe187a0cf77fe842bbb48fbc50058656ba52',createHash('sha256').update(HCo.toString()).digest('hex')],
 ['7cb36eaa72b80f0c728ce4ff4ba940c1aa1b4f604f0add07a7c2a723bb709346',createHash('sha256').update(BZe.toString()).digest('hex')],
 ['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5',createHash('sha256').update(Xe.toString()).digest('hex')],
 ])
 const answer=vi.fn((_choice:string)=>{open.splice(0)})
 const control={defaultFocusValue:'new_conversation',options:[{value:'resume',label:'Resume'},{value:'new_conversation',label:'Start a new conversation',description:'Claude can look this one up if you refer to it later'}],onChange:vi.fn((choice:string):void|false=>answer(choice)),onFocus:vi.fn()}
 const panel={title:'Resume this conversation?',children:['Original quota disclosure',{props:control}],onCancel:()=>answer('dismiss')}
 const view={type:BZe,memoizedProps:{...item.payload,ask:item.payload,onDone:answer},child:{memoizedProps:panel,child:{type:Xe,memoizedProps:control}}}
 const root={type:HCo,memoizedProps:{payload:item.payload,answer},child:view}
 const binding={surface:'terminal',toolContext:()=>({dialogStore:{getState:()=>({open})}})}
 const n={themeRoots:{ai:()=>new Map([[undefined,{container:{current:root}}]])},questionOptions:{q:()=>sessionId}}
 let format=async(_n:unknown,text:string)=>text
 const runtime=vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalColdQuotaRuntime)+';({read:nativeColdQuota,project:projectNativeColdQuota,answer:answerNativeColdQuota})',{originalContext:binding,AbortController,process:{stdout:undefined},composerFunctionHashes:new WeakMap(),createHash,nativeFunctionName:(name:string)=>name,nativeFunctionHash:(hash:string)=>hashes.get(hash),configUrl:'private',readFileSync:()=>JSON.stringify({sessionId}),randomUUID,dialogRevisions:new Map(),nativeGenericPermissionText:(...args:Parameters<typeof format>)=>format(...args)})
 const request=()=>({id:item.id,revision:runtime.read(n).revision,session_id:sessionId,decision:'quota_new_conversation'})
 return{runtime,n,item,open,view,panel,control,answer,request,setFormat:(next:typeof format)=>{format=next}}
}
it.each([['quota_resume','resume'],['quota_new_conversation','new_conversation'],['quota_dismiss','dismiss']])('delegates %s exactly once to native quota ownership',async(decision,original)=>{
 const f=fixture(),shown=await f.runtime.project(f.n,f.runtime.read(f.n));expect(shown.title).toBe(f.panel.title);expect(shown.paragraphs).toEqual(['Original quota disclosure']);expect(shown.trigger).toBe('idle');expect(shown.preferredChoice).toBe('quota_new_conversation');expect(shown.choices[1].description).toBe(f.control.options[1]!.description)
 const request={...f.request(),decision};f.runtime.answer(f.n,request);expect(f.answer).toHaveBeenCalledExactlyOnceWith(original)
 expect(()=>f.runtime.answer(f.n,request)).toThrow('expired')
})
it('preserves native destructive-action grace without automatic retry or local effects',()=>{
 const f=fixture(),request=f.request();f.control.onChange.mockReturnValue(false)
 expect(()=>f.runtime.answer(f.n,request)).toThrow('temporarily refused');expect(f.open).toContain(f.item);expect(f.answer).not.toHaveBeenCalled();expect(f.control.onChange).toHaveBeenCalledOnce()
 f.control.onChange.mockImplementation(choice=>f.answer(choice));f.runtime.answer(f.n,request);expect(f.answer).toHaveBeenCalledExactlyOnceWith('new_conversation')
})
it('rejects foreign sessions and invalid decisions before touching native focus or choices',()=>{
 const f=fixture(),request=f.request();expect(()=>f.runtime.answer(f.n,{...request,session_id:randomUUID()})).toThrow('expired');expect(()=>f.runtime.answer(f.n,{...request,decision:'resume_compact'})).toThrow('Invalid');expect(f.control.onFocus).not.toHaveBeenCalled();expect(f.answer).not.toHaveBeenCalled()
})
it('refuses replaced or unmounted native controls',()=>{
 const f=fixture(),request=f.request();Reflect.deleteProperty(f.view,'child');expect(f.runtime.read(f.n).item).toBeUndefined();expect(()=>f.runtime.answer(f.n,request)).toThrow('expired');expect(f.answer).not.toHaveBeenCalled()
})
it('rechecks native ownership after deliberate choice focus',()=>{
 const f=fixture(),request=f.request();f.control.onFocus.mockImplementation(()=>f.open.splice(0));expect(()=>f.runtime.answer(f.n,request)).toThrow('changed while choosing');expect(f.control.onChange).not.toHaveBeenCalled()
})
it('rechecks replacement after formatting the original disclosure',async()=>{
 const f=fixture(),d=f.runtime.read(f.n);f.setFormat(async(_n,text)=>{f.open.splice(0);return text});await expect(f.runtime.project(f.n,d)).rejects.toThrow('changed while formatting')
})
it('does not invent a preferred choice for the native none-focus mode',async()=>{
 const f=fixture();f.item.payload.focusedAction='none';f.view.memoizedProps.focusedAction='none';expect((await f.runtime.project(f.n,f.runtime.read(f.n))).preferredChoice).toBeUndefined()
})
