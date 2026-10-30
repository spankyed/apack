import { createClaudeBackgroundStatusAuthority } from '#features/code/be/services/claude-code/background-status-authority.ts'
import { spawnStream } from '#features/code/be/services/claude-code/runner.ts'
import type { DecodedLine } from '#features/code/be/services/claude-code/ndjson.ts'
vi.hoisted(()=>vi.resetModules())
vi.mock('#features/code/be/services/claude-code/runner.ts',()=>({spawnStream:vi.fn()}))
const parent='24be904a-3c35-4981-9793-cbe7a6c19d46',child='05ff1d31-597d-4537-8737-4407191add6e'
const identity={jobId:'05ff1d31',sessionId:child,pid:119,start:'worker-start',hostPid:100,hostStart:'host-start',cwd:'/owned'}
function fixture(){
 let waiting:(()=>void)|undefined,ended=false,finish!:(value:{exitCode:number;signal:null;stderr:string})=>void
 const queue:DecodedLine[]=[],done=new Promise<{exitCode:number;signal:null;stderr:string}>(resolve=>{finish=resolve})
 const push=(line:DecodedLine)=>{queue.push(line);waiting?.();waiting=undefined}
 const stop=()=>{ended=true;waiting?.();waiting=undefined;finish({exitCode:0,signal:null,stderr:''})}
 const write=vi.fn((request:any)=>{push({ok:true,value:{id:request.id,value:identity}});return true})
 const handle={child:{} as any,lines:(async function*(){while(!ended){if(queue.length)yield queue.shift()!;else await new Promise<void>(resolve=>{waiting=resolve})}})(),write,endInput:vi.fn(stop),done:()=>done,kill:vi.fn(stop)}
 vi.mocked(spawnStream).mockReset().mockImplementation(async(_args,options)=>{options?.signal?.addEventListener('abort',stop,{once:true});push({ok:true,value:{ready:true}});return handle})
 const authority=createClaudeBackgroundStatusAuthority(parent,{cwd:'/owned',cliPath:'/pinned-claude',env:{BUN_OPTIONS:'--preload=/original.mjs'}})
 return{authority,handle,write,push,stop}
}
it('opens one read-only original authority lazily and reuses it without a parent UI transport',async()=>{
 const f=fixture();expect(spawnStream).not.toHaveBeenCalled()
 try{
  await expect(f.authority.identify(child,119,'/owned')).resolves.toEqual(identity)
  await expect(f.authority.identify(child,119,'/owned')).resolves.toEqual(identity)
  expect(spawnStream).toHaveBeenCalledOnce()
  expect(vi.mocked(spawnStream).mock.calls[0]).toMatchObject([['--version'],{cwd:'/owned',cliPath:'/pinned-claude',env:{BUN_OPTIONS:expect.stringMatching(/^--preload=\/original.mjs --preload=.+\/authority.mjs$/)}}])
  expect(f.write.mock.calls[0][0]).toMatchObject({parent_session_id:parent,child_session_id:child,pid:119,cwd:'/owned'})
 }finally{await f.authority.close()}
 await expect(f.authority.identify(child,119,'/owned')).rejects.toThrow('unavailable')
})
it('preserves original refusal without retiring another fresh request',async()=>{
 const f=fixture();f.write.mockImplementationOnce(request=>{f.push({ok:true,value:{id:request.id,error:'native refusal'}});return true})
 try{
  await expect(f.authority.identify(child,119,'/owned')).rejects.toThrow('Original background identity refused')
  await expect(f.authority.identify(child,119,'/owned')).resolves.toEqual(identity)
 }finally{await f.authority.close()}
})
it('rejects pending identity work on transport loss and does not silently respawn',async()=>{
 const f=fixture();f.write.mockImplementationOnce(()=>true)
 const request=f.authority.identify(child,119,'/owned');const rejected=expect(request).rejects.toThrow('unavailable')
 await vi.waitFor(()=>expect(f.write).toHaveBeenCalledOnce());f.stop();await rejected
 await expect(f.authority.identify(child,119,'/owned')).rejects.toThrow('unavailable');expect(spawnStream).toHaveBeenCalledOnce();await f.authority.close()
})
it('retires a malformed authority response instead of treating it as a worker identity',async()=>{
 const f=fixture();f.write.mockImplementationOnce(()=>{f.push({ok:false,raw:'wrong stream',error:Error('not json')});return true})
 try{await expect(f.authority.identify(child,119,'/owned')).rejects.toThrow('unavailable')}finally{await f.authority.close()}
})
it('closes before startup without spawning a helper',async()=>{
 const f=fixture();await f.authority.close();expect(spawnStream).not.toHaveBeenCalled();await expect(f.authority.identify(child,119,'/owned')).rejects.toThrow('unavailable')
})
