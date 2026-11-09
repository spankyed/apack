import { runInNewContext } from 'node:vm'
import type { ClaudeHookRegistrar } from '#features/code/be/services/claude-code/native-plugin/claude-plugin-api.ts'
import { createApackNativePlugin } from '#features/code/be/services/claude-code/native-plugin/program.ts'
import { createClaudeTerminalPlugin } from '#features/code/be/services/claude-code/terminal-plugin.ts'

const CONFIG = { socketPath: '/owned.sock', token: 'private-token', background: { parentSessionId: '11111111-1111-4111-8111-111111111111', socketPath: '/child.sock', token: 'child-token' } }
/** The CLI's registrar, as a test holds it: every hook by name, the handler last. */
const collector = (hooks: Map<string, (...args: any[])=>Promise<any>>) => ((event: string, ...args: any[]) => hooks.set(event, args.at(-1))) as unknown as ClaudeHookRegistrar

it('registers and publishes child status before parent-only transcript reporting can refuse it',async()=>{
 const child='05ff1d31-597d-4537-8737-4407191add6e'
 const hooks=new Map<string,(...args:any[])=>Promise<any>>(),requests:{path:string;body:any}[]=[]
 let tick!:()=>void
 const api={
  session:{id:async()=>child,cwd:async()=>'/owned',model:async()=> 'sonnet',turns:async()=>2,usage:async()=>({startedAt:1,cost:{usd:0.001}})},
  agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async()=>undefined},clock:{every:vi.fn((_ms:number,callback:()=>void)=>{tick=callback})},
  process:{run:vi.fn(async()=>({exitCode:0,stdout:'119',stderr:''}))},
  http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push({path,body:JSON.parse(init.body)});return{ok:!['/transcript','/ui-ready'].includes(path),text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:'child-lease'}:{})}})},
 }
 createApackNativePlugin(CONFIG).register(collector(hooks))
 const next=async(value:any)=>value
 await hooks.get('classic.*')!(api,{session_id:child,transcript_path:'/owned/'+child+'.jsonl'},next)
 await hooks.get('session.start')!(api,{},next)
 tick();await vi.waitFor(()=>expect(requests.map(x=>x.path)).toContain('/background-register'))
 await new Promise(resolve=>setTimeout(resolve,0))
 tick();await vi.waitFor(()=>expect(requests.some(x=>x.path==='/background-status')).toBe(true))
 expect(api.process.run).toHaveBeenCalledOnce()
 expect(requests.filter(x=>x.path==='/transcript')).toHaveLength(1)
 expect(api.http.fetch.mock.calls.filter(([url])=>String(url).includes('/background-')).every(([,init])=>init.socketPath==='/child.sock'&&init.headers['x-apack-native-token']==='child-token')).toBe(true)
 expect(requests.find(x=>x.path==='/background-status')?.body).toMatchObject({sessionId:child,pid:119,token:'child-lease',sequence:1,metadata:{model:'sonnet',turns:2}})
 await hooks.get('ui.render')!(api,{},next);expect(api.clock.every).toHaveBeenCalledOnce()
})

it('renews the original child lease after broker replacement, restores the user prefix and never reuses the old token',async()=>{
 const child='05ff1d31-597d-4537-8737-4407191add6e',hooks=new Map<string,(...args:any[])=>Promise<any>>()
 let tick!:()=>void,online=true,lease=0,prefix='user-prefix',now=1000
 const cancel=vi.fn(),requests:{path:string;body:any}[]=[]
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>now)
 const api={session:{id:async()=>child,cwd:async()=>'/owned',model:async()=> 'sonnet',turns:async()=>2,usage:async()=>({startedAt:1})},agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async()=>prefix,set:vi.fn(async(_name:string,value:string)=>{prefix=value;return {}})},clock:{every:vi.fn((_ms:number,callback:()=>void)=>{tick=callback;return{cancel}})},process:{run:vi.fn(async()=>({exitCode:0,stdout:'119'}))},http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname,body=JSON.parse(init.body);requests.push({path,body});if(!online&&path.startsWith('/background-'))throw Error('connection lost');if(path==='/background-register')return{ok:true,text:JSON.stringify({token:'lease-'+(++lease)})};return{ok:true,text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-status'?{originalPrefix:'user-prefix',shellPrefix:'owned-'+lease}:{})}})}}
 const flush=()=>new Promise(resolve=>setImmediate(resolve))
 try{
  createApackNativePlugin(CONFIG).register(collector(hooks));await hooks.get('session.start')!(api,{},async()=>({}))
  tick();await flush();tick();await flush();expect(prefix).toBe('owned-1')
  online=false;for(let n=0;n<4;n++){tick();await flush()}
  expect(prefix).toBe('user-prefix');expect(cancel).not.toHaveBeenCalled()
  const count=requests.length;tick();await flush();expect(requests).toHaveLength(count)
  now+=1000;tick();await flush();expect(cancel).not.toHaveBeenCalled()
  now+=2000;tick();await flush();expect(cancel).not.toHaveBeenCalled()
  const offlineCount=requests.length;tick();await flush();expect(requests).toHaveLength(offlineCount)
  online=true;now+=4000;tick();await flush();tick();await flush()
  expect(lease).toBe(2);expect(prefix).toBe('owned-2');expect(api.process.run).toHaveBeenCalledOnce()
  expect(requests.filter(row=>row.path==='/background-status').at(-1)?.body).toMatchObject({pid:119,token:'lease-2',sequence:1});expect(cancel).not.toHaveBeenCalled()
 }finally{clock.mockRestore()}
})

/**
 * The one case whose subject is the artifact rather than the program: what the app writes is loadable, its
 * config arrives as data, and the error names the lease recovery routes on survive a hardened runtime.
 *
 * **`Error.prototype` is frozen in that realm**, which is what fails if `namedError` ever becomes
 * `error.name = …`: the assignment is silently dropped, every failure arrives nameless, and a detached
 * child never registers. The module above cannot show this — it runs in this realm, and freezing
 * `Error.prototype` here would outlive the test.
 */
it('writes a program that loads with its config, registers hooks and keeps its error names in a hardened realm',async()=>{
 const child='05ff1d31-597d-4537-8737-4407191add6e',hooks=new Map<string,(...args:any[])=>Promise<any>>()
 const written=createClaudeTerminalPlugin(CONFIG.socketPath,CONFIG.token,CONFIG.background)
 expect(written).toContain('const APACK_NATIVE_CONFIG = {"socketPath":"/owned.sock"')
 // The artifact is an ES module; a realm that evaluates a script hands its export back by name instead.
 const register=runInNewContext('Object.freeze(Error.prototype);'+written.replace(/^export\s*\{[^}]*\};?$/m,'')+';register',{URL,JSON,Object,Number,Date})
 register((event:string,...args:any[])=>hooks.set(event,args.at(-1)))
 expect([...hooks.keys()]).toEqual(['classic.*','session.append','prompt.submit','session.start','ui.render','turn.start','turn.complete'])
 const requests:string[]=[];let tick!:()=>void
 const api={session:{id:async()=>child,cwd:async()=>'/owned',model:async()=>'sonnet',turns:async()=>2,usage:async()=>({startedAt:1})},agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async()=>undefined},clock:{every:(_ms:number,callback:()=>void)=>{tick=callback;return{cancel(){}}}},process:{run:async()=>({exitCode:0,stdout:'119',stderr:''})},
  // The owning app is gone: only a named ApackBrokerUnavailable sends a non-parent session to the observer
  http:{fetch:async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push(path);if(init.socketPath==='/owned.sock')throw Error('parent gone');return{ok:true,status:200,text:JSON.stringify(path==='/background-register'?{token:'hardened-lease'}:{})}}}}
 await hooks.get('session.start')!(api,{},async(value:any)=>value)
 tick();await vi.waitFor(()=>expect(requests).toContain('/background-register'))
})
