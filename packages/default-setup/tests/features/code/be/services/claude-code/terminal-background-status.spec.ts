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
 const processIdentity={jh:vi.fn(async ():Promise<boolean|undefined>=>true)}
 const api=new Function('config','importClaudeNativeModule',source+';return identifyNativeBackground')({sessionId:parent},async(name:string)=>name==='chunk-0xj14bee.js'?processIdentity:jobs)
 const request={parent_session_id:parent,child_session_id:child,pid:119,cwd:'/owned'}
 await expect(api(request)).resolves.toEqual(identity);expect(jobs.iZt).toHaveBeenCalledWith(119,'worker-start');expect(jobs.iZt).toHaveBeenCalledWith(100,'host-start')
 expect(processIdentity.jh.mock.calls).toEqual([[119,'worker-start'],[100,'host-start']])
 for(const fresh of [false,undefined]){
  processIdentity.jh.mockResolvedValueOnce(fresh);await expect(api(request)).rejects.toThrow('retired')
 }
 processIdentity.jh.mockResolvedValueOnce(true).mockResolvedValueOnce(false);await expect(api(request)).rejects.toThrow('retired')
 worker.replProcStart='';await expect(api(request)).rejects.toThrow('retired')
})

it('renews the producer lease on same-worker reload and immediately accepts its reset counter',async()=>{
 const f=fixture();const old=(await f.store.register(child,119)).token
 await f.store.accept({...f.message,token:old,sequence:100});const prior=f.store.value
 const next=(await f.store.register(child,119)).token;expect(next).not.toBe(old);expect(f.store.value).toEqual(prior)
 await expect(f.store.accept({...f.message,token:old,sequence:101})).rejects.toThrow('expired')
 await f.store.accept({...f.message,token:next,sequence:1,metadata:{model:'sonnet',turns:3}})
 expect(f.store.value?.turns).toBe(3)
})

it('refuses an old pending publication after a same-worker producer reload',async()=>{
 const f=fixture();f.message.token=(await f.store.register(child,119)).token
 let finish!:(value:typeof identity)=>void;f.identify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const pending=f.store.accept(f.message);await vi.waitFor(()=>expect(f.identify).toHaveBeenCalledTimes(2))
 const next=(await f.store.register(child,119)).token;finish(identity);await expect(pending).rejects.toThrow('replaced')
 await f.store.accept({...f.message,token:next});expect(f.store.value?.model).toBe('sonnet')
})

it('publishes silence expiry so mounted app views do not wait for another heartbeat',async()=>{
 vi.useFakeTimers();const f=fixture()
 try{
  f.message.token=(await f.store.register(child,119)).token;await f.store.accept(f.message);f.changed.mockClear()
  f.advance(5001);await vi.advanceTimersByTimeAsync(5000)
  expect(f.store.value).toBeUndefined();expect(f.changed).toHaveBeenCalledOnce()
  f.store.close();f.changed.mockClear();await vi.advanceTimersByTimeAsync(10000);expect(f.changed).not.toHaveBeenCalled()
 }finally{f.store.close();vi.useRealTimers()}
})

it.each(['older-first','newer-first'])('keeps the newest valid registration when identity lookups finish %s',async order=>{
 const f=fixture();let finishOld!:(value:typeof identity)=>void,finishNew!:(value:typeof identity)=>void
 f.identify.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve})).mockImplementationOnce(()=>new Promise(resolve=>{finishNew=resolve}))
 const old=f.store.register(child,119),fresh=f.store.register(child,119)
 let token:string
 if(order==='older-first'){
  finishOld(identity);const former=await old;finishNew(identity);token=(await fresh).token
  expect(token).not.toBe(former.token);await expect(f.store.accept({...f.message,token:former.token})).rejects.toThrow('expired')
 }else{
  finishNew(identity);token=(await fresh).token;finishOld(identity);await expect(old).rejects.toThrow('expired')
 }
 await f.store.accept({...f.message,token});expect(f.store.value?.sessionId).toBe(child);f.store.close()
})
it('does not let a failed later identity lookup poison a valid pending registration',async()=>{
 const f=fixture();let finish!:(value:typeof identity)=>void
 f.identify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockRejectedValueOnce(Error('Original identity refused'))
 const valid=f.store.register(child,119);await expect(f.store.register(child,119)).rejects.toThrow('Original identity refused')
 finish(identity);const lease=await valid;await f.store.accept({...f.message,token:lease.token});expect(f.store.value?.pid).toBe(119);f.store.close()
})
