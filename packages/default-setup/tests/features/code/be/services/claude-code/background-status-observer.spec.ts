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
