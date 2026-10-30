import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {rm} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {claimClaudeBackgroundCheckpoint} from '#features/code/be/services/claude-code/background-observer-checkpoint.ts'
import { request } from 'node:http'
import { writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { createClaudeBackgroundStatusObserver } from '#features/code/be/services/claude-code/background-status-observer.ts'
const parent='24be904a-3c35-4981-9793-cbe7a6c19d46',child='05ff1d31-597d-4537-8737-4407191add6e'
const original={jobId:'05ff1d31',sessionId:child,pid:119,start:'worker-start',hostPid:100,hostStart:'host-start',cwd:'/owned'}
async function fixture(){
 let identity={...original}
 const authorities:{identify:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}[]=[],changed=vi.fn()
 const observer=await createClaudeBackgroundStatusObserver({parentSessionId:parent,target:()=>({sessionId:child,cwd:'/owned'}),changed,authority:()=>{const authority={identify:vi.fn(async()=>({...identity})),close:vi.fn(async()=>{})};authorities.push(authority);return authority}})
 const post=(path:string,value:unknown,token=observer.token)=>new Promise<{code:number;value:any}>((resolve,reject)=>{
  const req=request({socketPath:observer.socketPath,path,method:'POST',headers:{'x-apack-native-token':token,'content-type':'application/json'}},response=>{let text='';response.setEncoding('utf8');response.on('data',value=>text+=value);response.on('end',()=>resolve({code:response.statusCode!,value:JSON.parse(text)}))});req.on('error',reject);req.end(JSON.stringify(value))
 })
 const message=(token:string,sequence=1)=>({sessionId:child,pid:identity.pid,token,sequence,metadata:{model:'sonnet',turns:2},usage:{startedAt:1,cost:{usd:0.001}}})
 return{observer,authorities,changed,post,message,replace:()=>{identity={...identity,pid:120,start:'new-worker-start'}}}
}
it('keeps the independently addressed child listener and plugin files after parent release',async()=>{
 const f=await fixture();const plugin=join(f.observer.directory,'owned-plugin');await writeFile(plugin,'fixture')
 try{
  const registered=await f.post('/background-register',{sessionId:child,pid:119});expect(registered.code).toBe(200)
  expect((await f.post('/background-status',f.message(registered.value.token))).code).toBe(200)
  await f.observer.releaseParent();await access(plugin)
  expect((await f.post('/background-status',{...f.message(registered.value.token,2),metadata:{model:'sonnet',turns:3}})).code).toBe(200)
  expect(f.observer.value).toMatchObject({sessionId:child,pid:119,turns:3,totalCostUsd:0.001})
 }finally{await f.observer.close()}
 await expect(access(plugin)).rejects.toThrow();expect(f.authorities[0].close).toHaveBeenCalledOnce()
})
it('refuses foreign sessions, tokens and parent control routes on the child channel',async()=>{
 const f=await fixture()
 try{
  expect((await f.post('/background-register',{sessionId:parent,pid:119})).code).toBe(409)
  expect((await f.post('/background-register',{sessionId:child,pid:119},'wrong-token')).code).toBe(403)
  expect((await f.post('/poll',{sessionId:child})).code).toBe(404)
  expect(f.authorities[0].identify).not.toHaveBeenCalled();expect(f.observer.value).toBeUndefined()
 }finally{await f.observer.close()}
})
it('retires a replaced process lease after parent release and admits a fresh original registration',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});const f=await fixture()
 try{
  const old=(await f.post('/background-register',{sessionId:child,pid:119})).value.token
  await f.post('/background-status',f.message(old));await f.observer.releaseParent();f.replace()
  await vi.advanceTimersByTimeAsync(5000)
  expect(f.observer.value).toBeUndefined();expect(f.authorities[0].close).toHaveBeenCalledOnce();expect(f.authorities).toHaveLength(2)
  expect((await f.post('/background-status',f.message(old,2))).code).toBe(409)
  const fresh=await f.post('/background-register',{sessionId:child,pid:120});expect(fresh.code).toBe(200)
  expect((await f.post('/background-status',f.message(fresh.value.token))).code).toBe(200)
  expect(f.observer.value?.pid).toBe(120)
 }finally{await f.observer.close();vi.useRealTimers()}
})

it('keeps its channel and child lease through same-parent adoption before the new writer observes continuation',async()=>{
 const f=await fixture()
 try{
  const registered=await f.post('/background-register',{sessionId:child,pid:119});await f.post('/background-status',f.message(registered.value.token))
  await f.observer.releaseParent();const changed=vi.fn();f.observer.adoptParent(()=>undefined,changed)
  expect((await f.post('/background-status',f.message(registered.value.token,2))).code).toBe(200)
  expect(f.observer.value?.sessionId).toBe(child);expect(changed).toHaveBeenCalled();expect(f.authorities).toHaveLength(1)
 }finally{await f.observer.close()}
})

it('retires old child tokens and the original identity authority on an acknowledged parent-session reset',async()=>{
 const f=await fixture()
 try{
  const old=(await f.post('/background-register',{sessionId:child,pid:119})).value.token;await f.post('/background-status',f.message(old))
  const next='33333333-3333-4333-8333-333333333333';await f.observer.resetParent(next)
  expect(f.observer.parentSessionId).toBe(next);expect(f.observer.value).toBeUndefined();expect(f.authorities[0].close).toHaveBeenCalledOnce()
  expect((await f.post('/background-status',f.message(old,2))).code).toBe(409)
 }finally{await f.observer.close()}
})

it('keeps formatter output independent of the parent and refuses retired policy/worker results',async()=>{
 const f=await fixture()
 try{
  const token=(await f.post('/background-register',{sessionId:child,pid:119})).value.token
  const config={command:'cat',shellPrefix:null,policy:'personal'}
  const first=await f.post('/background-status',{...f.message(token),formatter:config});expect(first.code).toBe(200)
  const prefix=first.value.shellPrefix,producer=JSON.parse(Buffer.from(prefix.slice(prefix.lastIndexOf(' -')+2),'base64url').toString())
  const output={...producer,startedAt:'10',stdout:'original child status'}
  expect((await f.post('/background-formatter',output)).code).toBe(200);expect(f.observer.value?.statusLine).toBe('original child status')
  await f.observer.releaseParent();expect((await f.post('/background-status',{...f.message(token,2),formatter:config})).code).toBe(200)
  expect(f.observer.value?.statusLine).toBe('original child status')
  await f.post('/background-status',{...f.message(token,3),formatter:{...config,command:null,policy:'disabled'}})
  expect(f.observer.value?.statusLine).toBeUndefined();expect((await f.post('/background-formatter',{...output,startedAt:'20'})).code).toBe(409)
  const fresh=await f.post('/background-status',{...f.message(token,4),formatter:config})
  const next=fresh.value.shellPrefix,current=JSON.parse(Buffer.from(next.slice(next.lastIndexOf(' -')+2),'base64url').toString())
  f.replace();expect((await f.post('/background-formatter',{...current,startedAt:'30',stdout:'wrong worker'})).code).toBe(409)
 }finally{await f.observer.close()}
})

it.skipIf(process.platform==='win32')('recovers the same private endpoint after its actual API owner dies without admitting cached status or old formatter output',async()=>{
 const profile='/owned-recovery-test/'+randomUUID(),module=new URL('../../../../../../src/features/code/be/services/claude-code/background-status-observer.ts',import.meta.url).href
 const script='const {createClaudeBackgroundStatusObserver}=await import('+JSON.stringify(module)+');const observer=await createClaudeBackgroundStatusObserver({parentSessionId:'+JSON.stringify(parent)+',profile:'+JSON.stringify(profile)+',target:()=>('+JSON.stringify({sessionId:child,cwd:'/owned'})+'),changed(){},authority:()=>({identify:async()=>('+JSON.stringify(original)+'),close:async()=>{}})});console.log(JSON.stringify({directory:observer.directory,socketPath:observer.socketPath,token:observer.token}));'
 const processOwner=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']})
 let recovered:Awaited<ReturnType<typeof createClaudeBackgroundStatusObserver>>|undefined,endpoint:any
 const index=join(process.platform==='darwin'?'/private/tmp':tmpdir(),'apack-claude-background-'+process.getuid?.(),createHash('sha256').update(JSON.stringify([profile,parent])).digest('hex'))
 try{
  endpoint=await new Promise((resolve,reject)=>{let text='';processOwner.stdout.setEncoding('utf8');processOwner.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(JSON.parse(text.split('\n')[0]))});processOwner.once('error',reject);processOwner.once('exit',()=>reject(Error('Fixture API exited before readiness')))})
  const post=(path:string,value:unknown)=>new Promise<{code:number;value:any}>((resolve,reject)=>{const req=request({socketPath:endpoint.socketPath,path,method:'POST',headers:{'x-apack-native-token':endpoint.token,'content-type':'application/json'}},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({code:response.statusCode!,value:JSON.parse(text)}))});req.on('error',reject);req.end(JSON.stringify(value))})
  const registered=(await post('/background-register',{sessionId:child,pid:119})).value
  const message=(token:string)=>({sessionId:child,pid:119,token,sequence:1,metadata:{model:'sonnet',turns:2},usage:{startedAt:1},formatter:{command:'printf native',shellPrefix:null,policy:'{}'}})
  const first=await post('/background-status',message(registered.token));expect(first.code).toBe(200)
  const oldConfig=JSON.parse(Buffer.from(first.value.shellPrefix.split(' -').at(-1),'base64url').toString())
  const captured={...oldConfig,stdout:'old native output',startedAt:'1'}
  expect((await post('/background-formatter',captured)).code).toBe(200)
  const plugin=join(endpoint.directory,'original-module');await writeFile(plugin,'retained original plugin')
  const exited=once(processOwner,'exit');processOwner.kill('SIGKILL');await exited
  const checkpoint=await claimClaudeBackgroundCheckpoint({profile,parentSessionId:parent});expect(checkpoint).toBeDefined()
  recovered=await createClaudeBackgroundStatusObserver({parentSessionId:parent,profile,checkpoint,target:()=>({sessionId:child,cwd:'/owned'}),changed(){},authority:()=>({identify:async()=>({...original}),close:async()=>{}})})
  expect(recovered.socketPath).toBe(endpoint.socketPath);expect(recovered.value).toBeUndefined();await access(plugin)
  expect((await post('/background-status',message(registered.token))).code).toBe(409)
  expect((await post('/background-formatter',{...captured,startedAt:'2'})).code).toBe(409)
  const fresh=(await post('/background-register',{sessionId:child,pid:119})).value;expect(fresh.token).not.toBe(registered.token)
  expect((await post('/background-status',message(fresh.token))).code).toBe(200)
  expect((await post('/background-formatter',{...captured,startedAt:'3'})).code).toBe(409)
  expect(recovered.value).toMatchObject({sessionId:child,pid:119,model:'sonnet'});expect(recovered.value?.statusLine).toBeUndefined()
 }finally{
  if(processOwner.exitCode===null&&processOwner.signalCode===null){const exited=once(processOwner,'exit');processOwner.kill('SIGKILL');await exited}
  await recovered?.close();if(endpoint)await rm(endpoint.directory,{recursive:true,force:true});await rm(index,{recursive:true,force:true})
 }
})
