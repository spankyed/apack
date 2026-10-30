import { createClaudeTerminalPlugin } from '#features/code/be/services/claude-code/terminal-plugin.ts'
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
 const register=new Function(createClaudeTerminalPlugin('/owned.sock','private-token').replace('export function register','function register')+';return register')()
 register((event:string,...args:any[])=>hooks.set(event,args.at(-1)))
 const next=async(value:any)=>value
 await hooks.get('classic.*')!(api,{session_id:child,transcript_path:'/owned/'+child+'.jsonl'},next)
 await hooks.get('session.start')!(api,{},next)
 tick();await vi.waitFor(()=>expect(requests.map(x=>x.path)).toContain('/background-register'))
 await new Promise(resolve=>setTimeout(resolve,0))
 tick();await vi.waitFor(()=>expect(requests.some(x=>x.path==='/background-status')).toBe(true))
 expect(api.process.run).toHaveBeenCalledOnce()
 expect(requests.filter(x=>x.path==='/transcript')).toHaveLength(1)
 expect(requests.find(x=>x.path==='/background-status')?.body).toMatchObject({sessionId:child,pid:119,token:'child-lease',sequence:1,metadata:{model:'sonnet',turns:2}})
 await hooks.get('ui.render')!(api,{},next);expect(api.clock.every).toHaveBeenCalledOnce()
})
