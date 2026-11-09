import type { ClaudeHookRegistrar } from '#features/code/be/services/claude-code/native-plugin/claude-plugin-api.ts'
import { createApackNativePlugin } from '#features/code/be/services/claude-code/native-plugin/program.ts'
// Each fixture holds the clock still, so the backoff below is a fact about elapsed time and not about speed
afterEach(()=>{vi.restoreAllMocks()})
const CONFIG = { socketPath: '/owned.sock', token: 'private-token', background: { parentSessionId: '11111111-1111-4111-8111-111111111111', socketPath: '/child.sock', token: 'child-token' } }
function fixture(){
 const child='05ff1d31-597d-4537-8737-4407191add6e',hooks=new Map<string,(...args:any[])=>Promise<any>>()
 const requests:{path:string;body:any}[]=[],cancel=vi.fn();let tick!:()=>void,lost=false,refused=false,now=Date.now()
 const api={session:{id:async()=>child,cwd:async()=>'/owned',model:async()=>'sonnet',turns:async()=>2,usage:async()=>({startedAt:1,cost:{usd:0.001}})},agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async():Promise<string|undefined>=>undefined},clock:{every:vi.fn((_ms:number,callback:()=>void)=>{tick=callback;return{cancel}})},process:{run:vi.fn(async()=>({exitCode:0,stdout:'119',stderr:''}))},http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push({path,body:JSON.parse(init.body)});if(lost)throw Error('Owned socket disappeared');return{ok:!['/transcript','/ui-ready'].includes(path)&&!(refused&&path==='/background-register'),text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:'child-lease'}:{})}})}}
 vi.spyOn(Date,'now').mockImplementation(()=>now)
 const register=((event:string,...args:any[])=>hooks.set(event,args.at(-1))) as unknown as ClaudeHookRegistrar
 createApackNativePlugin(CONFIG).register(register)
 const next=async(value:any)=>value
 return{api,hooks,requests,cancel,lose:()=>{lost=true},restore:()=>{lost=false},advance:(ms:number)=>{now+=ms},refuse:()=>{refused=true},tick:()=>tick(),async start(){await hooks.get('classic.*')!(api,{session_id:child,transcript_path:'/owned/'+child+'.jsonl'},next);await hooks.get('session.start')!(api,{},next)},render:()=>hooks.get('ui.render')!(api,{},next)}
}
it('reconnects a child after broker loss while fencing queued ticks during backoff',async()=>{
 const f=fixture();await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.map(x=>x.path)).toContain('/background-register'));await new Promise(resolve=>setTimeout(resolve,0))
 f.lose();f.tick();await vi.waitFor(()=>expect(f.requests.map(x=>x.path)).toContain('/background-status'));await new Promise(resolve=>setTimeout(resolve,0))
 const requests=f.requests.length;f.tick();await f.render();await new Promise(resolve=>setTimeout(resolve,0));expect(f.requests).toHaveLength(requests);expect(f.api.clock.every).toHaveBeenCalledOnce();expect(f.cancel).not.toHaveBeenCalled()
 f.restore();f.advance(1000);f.tick();await vi.waitFor(()=>expect(f.requests.filter(row=>row.path==='/background-register')).toHaveLength(2));expect(f.api.process.run).toHaveBeenCalledOnce()
})

it('retires a refused original helper registration without retrying it',async()=>{
 const f=fixture();f.refuse();await f.start();f.tick();await vi.waitFor(()=>expect(f.cancel).toHaveBeenCalledOnce())
 const requests=f.requests.length;f.tick();await f.render();await new Promise(resolve=>setTimeout(resolve,0));expect(f.requests).toHaveLength(requests);expect(f.api.process.run).toHaveBeenCalledOnce()
})

it('registers a reloaded child directly with its own channel after the parent socket has disappeared',async()=>{
 const f=fixture();f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{
  const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)})
  if(init.socketPath==='/owned.sock')throw Error('Parent stopped')
  expect(init.socketPath).toBe('/child.sock');expect(init.headers['x-apack-native-token']).toBe('child-token')
  return{ok:true,text:JSON.stringify(path==='/background-register'?{token:'fresh-child-lease'}:{})}
 })
 await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-register')).toBe(true));await new Promise(resolve=>setTimeout(resolve,0))
 f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-status')).toBe(true))
 expect(f.api.process.run).toHaveBeenCalledOnce();expect(f.cancel).not.toHaveBeenCalled()
})
it('keeps a reloaded parent on its original channel after native session reset without requiring a process helper',async()=>{
 const f=fixture();f.api.session.id=async()=> '33333333-3333-4333-8333-333333333333'
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)});expect(init.socketPath).toBe('/owned.sock');return{ok:true,text:JSON.stringify({background:false})}})
 await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/poll')).toBe(true))
 expect(f.api.process.run).not.toHaveBeenCalled();expect(f.cancel).not.toHaveBeenCalled()
})

it('installs a child formatter with its existing prefix and restores only its own override on broker loss',async()=>{
 const f=fixture();let prefix:string|undefined='user -flag'
 const set=vi.fn(async(_name:string,value:string|undefined)=>{prefix=value;return{}})
 f.api.env.get=async()=>prefix;Object.assign(f.api.env,{set})
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)});return{ok:true,text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:'child-lease'}:path==='/background-status'?{shellPrefix:'owned -encoded',originalPrefix:'user -flag'}:{})}})
 await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-register')).toBe(true));await new Promise(resolve=>setTimeout(resolve,0))
 f.tick();await vi.waitFor(()=>expect(set).toHaveBeenCalledWith('CLAUDE_CODE_SHELL_PREFIX','owned -encoded'))
 expect(f.requests.find(row=>row.path==='/background-status')!.body.formatter.shellPrefix).toBe('user -flag')
 f.api.http.fetch.mockRejectedValue(Error('child broker lost'))
 for(let i=0;i<4;i++){f.tick();await new Promise(resolve=>setTimeout(resolve,0))}
 await vi.waitFor(()=>expect(set).toHaveBeenLastCalledWith('CLAUDE_CODE_SHELL_PREFIX','user -flag'));expect(f.cancel).not.toHaveBeenCalled()
})

it.each(['session.start','turn.start','turn.complete'])('rebinds child polling from %s without accepting late old formatter output',async(event)=>{
 const f=fixture();let release!:(value:any)=>void
 const oldSession=await f.api.session.id(),freshSession='77777777-7777-4777-8777-777777777777'
 const set=vi.fn(async()=>({}));Object.assign(f.api.env,{set})
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{
  const path=new URL(url).pathname,body=JSON.parse(init.body);f.requests.push({path,body})
  if(path==='/background-status'&&body.sessionId===oldSession)return new Promise(resolve=>{release=resolve})
  return{ok:true,text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:body.sessionId===freshSession?'fresh-lease':'old-lease'}:{})}
 })
 await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-register')).toBe(true));await new Promise(resolve=>setTimeout(resolve,0))
 const oldTick=f.api.clock.every.mock.calls[0]![1]
 f.tick();await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const freshApi={...f.api,session:{...f.api.session,id:async()=>freshSession}},next=async(value:any)=>value
 await f.hooks.get(event)!(freshApi,{},next)
 expect(f.cancel).toHaveBeenCalledOnce();expect(f.api.clock.every).toHaveBeenCalledTimes(2)
 f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-register'&&row.body.sessionId===freshSession)).toBe(true));await new Promise(resolve=>setTimeout(resolve,0))
 release({ok:true,text:JSON.stringify({shellPrefix:'stale-prefix',originalPrefix:'stale-user'})});await new Promise(resolve=>setTimeout(resolve,0));expect(set).not.toHaveBeenCalled()
 const count=f.requests.length;oldTick();await new Promise(resolve=>setTimeout(resolve,0));expect(f.requests).toHaveLength(count)
 f.tick();await vi.waitFor(()=>expect(f.requests.some(row=>row.path==='/background-status'&&row.body.sessionId===freshSession)).toBe(true))
 const status=f.requests.find(row=>row.path==='/background-status'&&row.body.sessionId===freshSession)!
 expect(status.body.token).toBe('fresh-lease');expect(status.body.sequence).toBe(1)
 await f.hooks.get('ui.render')!(freshApi,{},next);expect(f.api.clock.every).toHaveBeenCalledTimes(2);expect(f.api.process.run).toHaveBeenCalledOnce()
})

function held<T>() {
 let resolve!: (value:T)=>void
 const promise=new Promise<T>(done=>{resolve=done})
 return {promise,resolve}
}
const flushPlugin=()=>new Promise(resolve=>setImmediate(resolve))
function mainSessionFixture(){
 let sessionId=CONFIG.background.parentSessionId,turns=1
 const hooks=new Map<string,(...args:any[])=>Promise<any>>(),requests:{path:string;body:any}[]=[],ticks:(()=>void)[]=[]
 const api={session:{id:async()=>sessionId,cwd:async()=>'/'+sessionId,model:async()=>sessionId,turns:async()=>turns,usage:async()=>({startedAt:1})},agent:{list:async()=>[]},settings:{read:vi.fn(async()=>({}))},env:{get:vi.fn(async():Promise<string|undefined>=>undefined)},prompt:{read:vi.fn(async()=>({text:''})),fill:vi.fn(async()=>({isFilled:true}))},clock:{every:vi.fn((_ms:number,tick:()=>void)=>{ticks.push(tick);return{cancel:vi.fn()}})},http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push({path,body:JSON.parse(init.body)});return{ok:true,text:'{}'}})}}
 createApackNativePlugin(CONFIG).register(((event:string,...args:any[])=>hooks.set(event,args.at(-1))) as unknown as ClaudeHookRegistrar)
 const fire=(event:string,next=async()=>({}))=>hooks.get(event)!(api,{},next)
 return{api,requests,fire,tick:()=>ticks.at(-1)!(),setTurns:(value:number)=>{turns=value},async start(id=sessionId){sessionId=id;await fire('session.start')}}
}

it.each(['settings','environment'] as const)('does not send old metadata under a fresh session after a held %s read',async boundary=>{
 const f=mainSessionFixture(),pending=held<any>(),fresh='77777777-7777-4777-8777-777777777777'
 const read=boundary==='settings'?f.api.settings.read:f.api.env.get
 read.mockImplementationOnce(()=>pending.promise)
 await f.start();f.tick();await vi.waitFor(()=>expect(read).toHaveBeenCalled())
 await f.start(fresh);pending.resolve(boundary==='settings'?{}:undefined);await flushPlugin()
 expect(f.requests.filter(r=>r.path==='/poll')).toHaveLength(0)
 f.tick();await flushPlugin()
 expect(f.requests.filter(r=>r.path==='/poll').map(r=>r.body)).toEqual([expect.objectContaining({sessionId:fresh,metadata:expect.objectContaining({cwd:'/'+fresh,model:fresh})})])
})

it.each(['before-fill','fill','after-fill'] as const)('retires an old prompt command held at %s without clearing the fresh submission',async boundary=>{
 const f=mainSessionFixture(),pending=held<any>(),fresh='77777777-7777-4777-8777-777777777777'
 let polls=0
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)});return{ok:true,text:JSON.stringify(path==='/poll'?{id:++polls===1?'old-command':'fresh-command',text:'draft',...(polls===2?{prepared:true}:{})}:{})}})
 if(boundary==='before-fill')f.api.prompt.read.mockImplementationOnce(()=>pending.promise)
 else if(boundary==='fill')f.api.prompt.fill.mockImplementationOnce(()=>pending.promise)
 else f.api.prompt.read.mockResolvedValueOnce({text:''}).mockImplementationOnce(()=>pending.promise)
 await f.start();f.tick()
 await vi.waitFor(()=>expect(boundary==='fill'?f.api.prompt.fill:f.api.prompt.read).toHaveBeenCalledTimes(boundary==='after-fill'?2:1))
 await f.start(fresh);f.tick();await flushPlugin()
 pending.resolve(boundary==='fill'?{isFilled:true}:{text:''});await flushPlugin()
 expect(f.api.prompt.fill).toHaveBeenCalledTimes(boundary==='before-fill'?0:1)
 expect(f.requests.filter(r=>r.path==='/result').map(r=>r.body.id)).toEqual(['fresh-command'])
 await f.fire('prompt.submit')
 expect(f.requests.filter(r=>r.path==='/submission').map(r=>r.body.id)).toEqual(['fresh-command'])
})

it('keeps a hook wake arriving during a poll whose answer disables periodic reporting',async()=>{
 const f=mainSessionFixture(),pending=held<{ok:boolean;text:string}>();let polls=0
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)});if(path==='/poll'&&++polls===1)return pending.promise;return{ok:true,text:JSON.stringify(path==='/poll'?{reportEveryMs:0}:{})}})
 await f.start();f.tick();await vi.waitFor(()=>expect(polls).toBe(1))
 f.setTurns(2);await f.fire('turn.complete');pending.resolve({ok:true,text:JSON.stringify({reportEveryMs:0})});await flushPlugin()
 f.tick();await flushPlugin()
 expect(f.requests.filter(r=>r.path==='/poll').map(r=>r.body.metadata.turns)).toEqual([1,2])
 f.tick();await flushPlugin();expect(polls).toBe(2)
})

it('does not publish a held old submission as belonging to the fresh session',async()=>{
 const f=mainSessionFixture(),pending=held<any>();let polls=0
 f.api.http.fetch.mockImplementation(async(url:string,init:any)=>{const path=new URL(url).pathname;f.requests.push({path,body:JSON.parse(init.body)});return{ok:true,text:JSON.stringify(path==='/poll'?{id:++polls===1?'old-command':'fresh-command',text:'draft',prepared:true}:{})}})
 await f.start();f.tick();await flushPlugin()
 const submitting=f.fire('prompt.submit',()=>pending.promise)
 await f.start('77777777-7777-4777-8777-777777777777');f.tick();await flushPlugin()
 pending.resolve({});await submitting
 expect(f.requests.filter(r=>r.path==='/submission')).toHaveLength(0)
 await f.fire('prompt.submit')
 expect(f.requests.filter(r=>r.path==='/submission').map(r=>r.body.id)).toEqual(['fresh-command'])
})
