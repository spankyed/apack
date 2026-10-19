import vm from 'node:vm'
import { claudeTerminalToolProgressRuntime } from '#features/code/be/services/claude-code/terminal-tool-progress-runtime.ts'
function fixture() {
 const producer=()=>{},output={},id='tool',props={toolUseId:id},child={memoizedProps:{toolUseId:id,hint:'(ctrl+b to run in background)'}}
 const fiber: any={type:producer,memoizedProps:props,child},state={running:true,fingerprint:'running'}
 const publish=vi.fn(),n={nativeClients:{release:vi.fn()},themeRoots:{ai:()=>new Map([[output,{container:{current:fiber}}]])},toolBackground:{ntr:producer}}
 const f=vm.runInNewContext(`${claudeTerminalToolProgressRuntime};({hints:nativeToolProgressHints,facts:toolProgressFacts,check:currentToolProgressAction,refresh:refreshNativeToolProgress,frames:toolProgressFrames})`,{process:{stdout:output},AbortController,publish,toolUseFacts:()=>({props:{isRunning:state.running},fingerprint:state.fingerprint})})
 return{n,f,fiber,child,state,publish,facts:()=>f.facts(n,id,'assistant',new AbortController())}
}
it('uses only the mounted original producer and suppresses key-only, missing and conflicting hints',()=>{
 const x=fixture();expect(x.facts().props).toEqual({tool_use_id:'tool',kind:'background_hint',hint:'(ctrl+b to run in background)'})
 x.fiber.memoizedProps.keyOnly=true;expect(x.facts().props).toBeUndefined();delete x.fiber.memoizedProps.keyOnly
 x.fiber.sibling={...x.fiber,child:{memoizedProps:{toolUseId:'tool',hint:'different'}}};expect(x.facts().props).toBeUndefined()
 delete x.fiber.sibling;x.state.running=false;expect(x.facts().props).toBeUndefined()
})
it('invalidates only changing mounted tool sites and immediately refuses actions after hint withdrawal',()=>{
 const x=fixture(),first=x.facts();x.f.frames.set('frame',{clientId:'view',id:'tool',assistantUuid:'assistant',fingerprint:first.fingerprint,observed:first.fingerprint})
 x.f.frames.set(JSON.stringify(['view','tool']),x.f.frames.get('frame'));x.f.frames.delete('frame')
 expect(()=>x.f.check(x.n,{component:'ToolProgress',client_id:'view',instance_id:'tool'})).not.toThrow()
 x.f.refresh(x.n);expect(x.publish).not.toHaveBeenCalled()
 x.child.memoizedProps.hint='';x.f.refresh(x.n);expect(x.publish).toHaveBeenCalledOnce()
 x.state.running=false;expect(()=>x.f.check(x.n,{component:'ToolProgress',client_id:'view',instance_id:'tool'})).toThrow('changed or expired')
 x.f.refresh(x.n);expect(x.n.nativeClients.release).toHaveBeenCalledWith('view','ToolProgress','tool');expect(x.publish).toHaveBeenCalledTimes(2);x.f.refresh(x.n);expect(x.publish).toHaveBeenCalledTimes(2)
})
it('bounds traversal and tolerates a cyclic native tree without exposing unrecognized producers',()=>{
 const x=fixture();x.fiber.sibling=x.fiber;expect(x.f.hints(x.n).size).toBe(1)
 x.fiber.type=()=>{};expect(x.f.hints(x.n).size).toBe(0)
 let node=x.fiber;for(let i=0;i<4096;i++){node.child={};node=node.child}expect(()=>x.f.hints(x.n)).toThrow('exceeded bound')
})
