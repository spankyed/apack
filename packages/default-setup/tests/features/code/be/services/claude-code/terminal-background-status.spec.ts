import { createClaudeBackgroundStatus } from '#features/code/be/services/claude-code/terminal-background-status.ts'
import { claudeTerminalBackgroundStatusRuntime } from '#features/code/be/services/claude-code/terminal-background-status-runtime.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
const parent='24be904a-3c35-4981-9793-cbe7a6c19d46',child='05ff1d31-597d-4537-8737-4407191add6e'
const identity={jobId:'05ff1d31',sessionId:child,pid:119,start:'worker-start',hostPid:100,hostStart:'host-start',cwd:'/owned'}
function fixture(){
 let clock=10000
 const identify=vi.fn(async()=>({...identity})),changed=vi.fn()
 const store=createClaudeBackgroundStatus({identify,changed,now:()=>clock})
 const message={sessionId:child,pid:119,token:'',sequence:1,metadata:{model:'sonnet',turns:2},usage:{startedAt:1,context:{tokens:40,window:200000,percent:0},cost:{usd:0.001}}}
 return{store,identify,changed,message,advance:(ms:number)=>{clock+=ms}}
}
it('keeps original child totals in a separately leased snapshot and expires silent producers',async()=>{
 const f=fixture();f.message.token=(await f.store.register(child,119)).token;await f.store.accept(f.message)
 expect(f.store.value).toMatchObject({sessionId:child,pid:119,model:'sonnet',turns:2,totalCostUsd:0.001,observedAt:10000})
 await expect(f.store.accept(f.message)).rejects.toThrow('expired')
 f.advance(5001);expect(f.store.value).toBeUndefined()
 await f.store.accept({...f.message,sequence:2});expect(f.store.value?.observedAt).toBe(15001)
})
it('rejects a replaced worker even when its numeric PID is reused',async()=>{
 const f=fixture();f.message.token=(await f.store.register(child,119)).token;f.identify.mockResolvedValue({...identity,start:'replacement'})
 await expect(f.store.accept(f.message)).rejects.toThrow('replaced');expect(f.store.value).toBeUndefined()
})
it('retires pending publication when a new lease replaces its process',async()=>{
 const f=fixture();f.message.token=(await f.store.register(child,119)).token
 let finish!:(value:typeof identity)=>void;f.identify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const pending=f.store.accept(f.message);await vi.waitFor(()=>expect(f.identify).toHaveBeenCalledTimes(2))
 f.identify.mockResolvedValue({...identity,start:'replacement'});const next=await f.store.register(child,119);expect(next.token).not.toBe(f.message.token)
 finish(identity);await expect(pending).rejects.toThrow('replaced');expect(f.store.value).toBeUndefined()
})
it('refuses foreign sessions, lease tokens and malformed original usage',async()=>{
 const f=fixture();f.message.token=(await f.store.register(child,119)).token
 for(const bad of [{...f.message,sessionId:parent},{...f.message,pid:120},{...f.message,token:'stale'},{...f.message,usage:{context:'invalid',startedAt:1}},{...f.message,usage:{startedAt:1,cost:{usd:-1}}}])await expect(f.store.accept(bad)).rejects.toThrow()
 expect(f.store.value).toBeUndefined();f.store.close();await expect(f.store.accept(f.message)).rejects.toThrow();await expect(f.store.register(child,119)).rejects.toThrow()
})
it('binds the public helper PID to the original roster, dispatch, durable job and both process starts',async()=>{
 const worker={pid:100,procStart:'host-start',replPid:119,replProcStart:'worker-start',dispatch:{sessionId:child,cwd:'/owned'}}
 const jobs={uL:vi.fn(async()=>({workers:{'05ff1d31':worker}})),io:vi.fn(()=>'/job'),Kp:vi.fn(),Zr:vi.fn(async()=>({sessionId:child,cwd:'/owned',daemonShort:'05ff1d31'})),iZt:vi.fn(async()=>true)}
 const source=rewriteClaudeNativePlatformSelectors(claudeTerminalBackgroundStatusRuntime)
 const api=new Function('config','importClaudeNativeModule',source+';return identifyNativeBackground')({sessionId:parent},async()=>jobs)
 const request={parent_session_id:parent,child_session_id:child,pid:119,cwd:'/owned'}
 await expect(api(request)).resolves.toEqual(identity);expect(jobs.iZt).toHaveBeenCalledWith(119,'worker-start');expect(jobs.iZt).toHaveBeenCalledWith(100,'host-start')
 worker.replProcStart='';await expect(api(request)).rejects.toThrow('retired')
})
