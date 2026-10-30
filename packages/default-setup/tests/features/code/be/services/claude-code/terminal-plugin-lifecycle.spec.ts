import { createClaudeTerminalPlugin } from '#features/code/be/services/claude-code/terminal-plugin.ts'
function fixture(){
 const child='05ff1d31-597d-4537-8737-4407191add6e',hooks=new Map<string,(...args:any[])=>Promise<any>>()
 const requests:{path:string;body:any}[]=[],cancel=vi.fn();let tick!:()=>void,lost=false,refused=false
 const api={session:{id:async()=>child,cwd:async()=>'/owned',model:async()=>'sonnet',turns:async()=>2,usage:async()=>({startedAt:1,cost:{usd:0.001}})},agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async()=>undefined},clock:{every:vi.fn((_ms:number,callback:()=>void)=>{tick=callback;return{cancel}})},process:{run:vi.fn(async()=>({exitCode:0,stdout:'119',stderr:''}))},http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push({path,body:JSON.parse(init.body)});if(lost)throw Error('Owned socket disappeared');return{ok:!['/transcript','/ui-ready'].includes(path)&&!(refused&&path==='/background-register'),text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:'child-lease'}:{})}})}}
 const register=new Function(createClaudeTerminalPlugin('/owned.sock','private-token',{parentSessionId:'11111111-1111-4111-8111-111111111111',socketPath:'/child.sock',token:'child-token'}).replace('export function register','function register')+';return register')()
 register((event:string,...args:any[])=>hooks.set(event,args.at(-1)))
 const next=async(value:any)=>value
 return{api,hooks,requests,cancel,lose:()=>{lost=true},refuse:()=>{refused=true},tick:()=>tick(),async start(){await hooks.get('classic.*')!(api,{session_id:child,transcript_path:'/owned/'+child+'.jsonl'},next);await hooks.get('session.start')!(api,{},next)},render:()=>hooks.get('ui.render')!(api,{},next)}
}
it('cancels child polling after broker loss and refuses already-queued ticks or render restarts',async()=>{
 const f=fixture();await f.start();f.tick();await vi.waitFor(()=>expect(f.requests.map(x=>x.path)).toContain('/background-register'));await new Promise(resolve=>setTimeout(resolve,0))
 f.lose();f.tick();await vi.waitFor(()=>expect(f.cancel).toHaveBeenCalledOnce())
 const requests=f.requests.length;f.tick();await f.render();await new Promise(resolve=>setTimeout(resolve,0));expect(f.requests).toHaveLength(requests);expect(f.api.clock.every).toHaveBeenCalledOnce();expect(f.api.process.run).toHaveBeenCalledOnce()
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
