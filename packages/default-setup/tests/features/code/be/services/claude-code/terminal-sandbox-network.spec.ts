import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalSandboxNetworkRuntime } from '#features/code/be/services/claude-code/terminal-sandbox-network-runtime.ts'
function fixture() {
 const sessionId=randomUUID(),item={id:randomUUID(),kind:'sandbox_network_access',payload:{host:'review.example',port:443}},open=[item]
 const VCo=()=>{},Ske=()=>{}
 const hashes=new Map([['573ab81627b252950400c030451d1608cd68367c498beaca288b27c3da8d20c5',createHash('sha256').update(VCo.toString()).digest('hex')],['5ef697d36d06b882f5a1363a26b6b7c9a5f26dec6e375f494ee564ef93048aa0',createHash('sha256').update(Ske.toString()).digest('hex')]])
 const control={options:[{value:'yes',label:'Yes'},{value:'yes-dont-ask-again',label:'Remember original rule'},{value:'no',label:'No'}],isDisabled:false,onChange:vi.fn(()=>{open.splice(0)}),onCancel:vi.fn(()=>{open.splice(0)})}
 const row=Array(44).fill(undefined);row[29]='Host: review.example';row[30]='Allow this connection?';row[39]={props:{children:[row[30],{props:{children:{props:control}}}]}};row[43]={props:{title:'Network request outside of sandbox'}}
 const child={type:Ske,memoizedProps:{hostPattern:{host:item.payload.host,port:item.payload.port}},updateQueue:{memoCache:{data:[row]}}},root={type:VCo,memoizedProps:{payload:item.payload,wouldTakeAnswer:()=>true},child}
 const binding={surface:'terminal',toolContext:()=>({dialogStore:{getState:()=>({open})}})},n={themeRoots:{ai:()=>new Map([[undefined,{container:{current:root}}]])},questionOptions:{q:()=>sessionId}}
 let format=async(_n:unknown,value:string)=>value
 const runtime=vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalSandboxNetworkRuntime)+';({read:nativeSandboxNetwork,project:projectNativeSandboxNetwork,answer:answerNativeSandboxNetwork})',{originalContext:binding,AbortController,process:{stdout:undefined},composerFunctionHashes:new WeakMap(),createHash,nativeFunctionName:(s:string)=>s,nativeFunctionHash:(s:string)=>hashes.get(s),configUrl:'private',readFileSync:()=>JSON.stringify({sessionId}),randomUUID,dialogRevisions:new Map(),nativeGenericPermissionText:(...args:Parameters<typeof format>)=>format(...args)})
 const request=(decision='sandbox_allow')=>({id:item.id,revision:runtime.read(n).revision,session_id:sessionId,decision})
 return {runtime,n,item,open,control,root,child,row,request,setFormat:(f:typeof format)=>{format=f}}
}
it.each([['sandbox_allow','yes'],['sandbox_remember','yes-dont-ask-again'],['sandbox_deny','no']])('delegates %s to the exact original option without supplying rules',async(decision,value)=>{
 const f=fixture(),shown=await f.runtime.project(f.n,f.runtime.read(f.n));expect(shown.title).toBe('Network request outside of sandbox');expect(shown.paragraphs).toEqual(['Host: review.example','Allow this connection?'])
 const request=f.request(decision);f.runtime.answer(f.n,request);expect(f.control.onChange).toHaveBeenCalledExactlyOnceWith(value);expect(()=>f.runtime.answer(f.n,request)).toThrow('expired')
})
it('uses original Escape cancellation rather than fabricating a result',()=>{const f=fixture();f.runtime.answer(f.n,f.request('sandbox_cancel'));expect(f.control.onCancel).toHaveBeenCalledOnce();expect(f.control.onChange).not.toHaveBeenCalled()})
it('does not expose or apply remembered permission when original policy omits it',()=>{const f=fixture();f.control.options.splice(1,1);expect(()=>f.runtime.answer(f.n,f.request('sandbox_remember'))).toThrow('unavailable');expect(f.control.onChange).not.toHaveBeenCalled()})
it('preserves original disabled and current-answer admission',()=>{const f=fixture();f.control.isDisabled=true;expect(f.runtime.read(f.n).item).toBeUndefined();f.control.isDisabled=false;f.root.memoizedProps.wouldTakeAnswer=()=>false;expect(f.runtime.read(f.n).item).toBeUndefined()})
it('rejects foreign, replaced and expired host consent',()=>{const f=fixture(),request=f.request();expect(()=>f.runtime.answer(f.n,{...request,session_id:randomUUID()})).toThrow('expired');f.item.payload.host='other.example';f.child.memoizedProps.hostPattern.host='other.example';expect(()=>f.runtime.answer(f.n,request)).toThrow('expired');expect(f.control.onChange).not.toHaveBeenCalled()})
it('rechecks the original request after asynchronous text rendering',async()=>{const f=fixture(),d=f.runtime.read(f.n);f.setFormat(async(_n,s)=>{if(s==='Remember original rule')f.open.splice(0);return s});await expect(f.runtime.project(f.n,d)).rejects.toThrow('changed while formatting')})
it('does not acknowledge a callback refused by the native input guard',()=>{const f=fixture();f.control.onChange=vi.fn();expect(()=>f.runtime.answer(f.n,f.request())).toThrow('did not accept');expect(f.control.onChange).toHaveBeenCalledOnce()})
