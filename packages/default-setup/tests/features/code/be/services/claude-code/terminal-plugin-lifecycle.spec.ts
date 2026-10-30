import { createClaudeTerminalPlugin } from '#features/code/be/services/claude-code/terminal-plugin.ts'
function fixture(){
 const child='05ff1d31-597d-4537-8737-4407191add6e',hooks=new Map<string,(...args:any[])=>Promise<any>>()
 const requests:{path:string;body:any}[]=[],cancel=vi.fn();let tick!:()=>void,lost=false,refused=false
 const api={session:{id:async()=>child,cwd:async()=>'/owned',model:async()=>'sonnet',turns:async()=>2,usage:async()=>({startedAt:1,cost:{usd:0.001}})},agent:{list:async()=>[]},settings:{read:async()=>({})},env:{get:async()=>undefined},clock:{every:vi.fn((_ms:number,callback:()=>void)=>{tick=callback;return{cancel}})},process:{run:vi.fn(async()=>({exitCode:0,stdout:'119',stderr:''}))},http:{fetch:vi.fn(async(url:string,init:any)=>{const path=new URL(url).pathname;requests.push({path,body:JSON.parse(init.body)});if(lost)throw Error('Owned socket disappeared');return{ok:!['/transcript','/ui-ready'].includes(path)&&!(refused&&path==='/background-register'),text:JSON.stringify(path==='/poll'?{background:true}:path==='/background-register'?{token:'child-lease'}:{})}})}}
 const register=new Function(createClaudeTerminalPlugin('/owned.sock','private-token').replace('export function register','function register')+';return register')()
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
