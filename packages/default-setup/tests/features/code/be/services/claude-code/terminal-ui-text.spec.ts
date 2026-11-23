import vm from 'node:vm'
import {createServer,request as httpRequest} from 'node:http'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createClaudeTerminalUiTransport} from '#features/code/be/services/claude-code/terminal-ui.ts'
import {claudeTerminalUiRuntime} from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
import {CLAUDE_UI_PROMPT_RPC_SUBTYPES, CLAUDE_UI_TEXT_MAX_LENGTH, CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES} from '#features/code/be/services/claude-code/ui-text-limits.ts'

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'cc-forward-text-')),socketPath=join(directory,'ui.sock')
 const owner={pid:17,sessionId:'native-session'},token='private-token';let transportEpoch='a'.repeat(32)
 const control=vi.fn(async(value:Record<string,unknown>)=>value.subtype==='ui_prompt_autocomplete'?{suggestions:[{text:value.text}]}:{text:value.text,cursor:value.cursor})
 const start=claudeTerminalUiRuntime.indexOf('const server=http.createServer(')
 const end=claudeTerminalUiRuntime.indexOf('await new Promise((resolve,reject)=>{server.once',start)
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start)
 // Only the authored HTTP handler executes; original module imports/control implementations do not.
 const runtime={
  http:{createServer},AbortController,Buffer,process:{pid:owner.pid},config:{token},configUrl:'config',
  readFileSync:()=>JSON.stringify({sessionId:owner.sessionId,transportEpoch}),activeSession:owner.sessionId,
  seen:new Set(),highestSequence:0,sequenceSession:owner.sessionId,sequenceEpoch:transportEpoch,inFlight:0,control,
  nativeUiTextMessageMaxBytes:CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES,nativeUiPromptRpcSubtypes:new Set(CLAUDE_UI_PROMPT_RPC_SUBTYPES),
 };
 const server=vm.runInNewContext(claudeTerminalUiRuntime.slice(start,end)+';server',runtime) as ReturnType<typeof createServer>
 await new Promise<void>(resolve=>server.listen(socketPath,resolve))
 const ui=createClaudeTerminalUiTransport({socketPath,token,transportEpoch,current:()=>owner})
 const replacements:ReturnType<typeof createClaudeTerminalUiTransport>[]=[]
 return{...ui,control,replaceTransport(){transportEpoch='b'.repeat(32);const next=createClaudeTerminalUiTransport({socketPath,token,transportEpoch,current:()=>owner});replacements.push(next);return next.transport},rotateSession(sessionId:string){owner.sessionId=sessionId;runtime.activeSession=sessionId},async raw(value:Record<string,unknown>,sequence=100,epoch=transportEpoch){
  return new Promise<number>((resolve,reject)=>{
   const request=httpRequest({socketPath,path:'/control',method:'POST',headers:{'x-apack-native-token':token}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode!))})
   request.on('error',reject);request.end(JSON.stringify({id:randomUUID(),sequence,ownerPid:owner.pid,sessionId:owner.sessionId,transportEpoch:epoch,request:value}))
  })
 },async close(){ui.close();for(const other of replacements)other.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true})}}
}

it.each(['ui_prompt_edit','ui_prompt_autocomplete'])('round-trips native-limit Unicode and escaped text through both ends of %s',async subtype=>{
 const f=await fixture()
 try{
  for(const text of ['漢'.repeat(1_000_000),'👋'.repeat(500_000),'\u0000'.repeat(1_000_000)]){
   const value=await f.transport.request({subtype,client_id:'app',surface:'desktop',text,cursor:text.length,...(subtype==='ui_prompt_edit'?{by:'person'}:{})})
   expect(value).toEqual(subtype==='ui_prompt_edit'?{text,cursor:text.length}:{suggestions:[{text}]})
  }
 }finally{await f.close()}
})
it('round-trips bounded long drafts and native accepted text through the owned submission RPCs', async () => {
 const f = await fixture()
 const text = '漢'.repeat(CLAUDE_UI_TEXT_MAX_LENGTH)
 try {
  await expect(f.transport.request({subtype:'apack_prepare_prompt',text})).resolves.toEqual({text})
  const agentText = '\u0000'.repeat(CLAUDE_UI_TEXT_MAX_LENGTH)
  await expect(f.transport.request({subtype:'apack_ui_agent_dispatch',text:agentText})).resolves.toEqual({text:agentText})
  f.control.mockResolvedValueOnce({text,cursor:text.length})
  await expect(f.transport.request({subtype:'apack_prompt_outcome'})).resolves.toEqual({text,cursor:text.length})
 } finally { await f.close() }
})
it('keeps non-prompt requests and responses at their existing bounds',async()=>{
 const f=await fixture()
 try{
  await expect(f.transport.request({subtype:'ui_render',text:'a'.repeat(1_048_576)})).rejects.toThrow('request exceeds')
  expect(f.control).not.toHaveBeenCalled()
  expect(await f.raw({subtype:'ui_render',text:'a'.repeat(1_048_576)})).toBe(413)
  expect(f.control).not.toHaveBeenCalled()
  f.control.mockImplementation(async()=>({text:'a'.repeat(2_097_152),cursor:0}))
  await expect(f.transport.request({subtype:'ui_render'})).rejects.toThrow('response exceeds')
 }finally{await f.close()}
})
it('refuses prompt text envelopes beyond the bounded byte budget',async()=>{
 const f=await fixture()
 try{
  await expect(f.transport.request({subtype:'ui_prompt_edit',text:'a'.repeat(CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES)})).rejects.toThrow('request exceeds')
  expect(f.control).not.toHaveBeenCalled()
  f.control.mockImplementation(async()=>({text:'a'.repeat(CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES),cursor:0}))
  await expect(f.transport.request({subtype:'ui_prompt_edit',text:'small',cursor:0})).rejects.toThrow('response exceeds')
 }finally{await f.close()}
})

it('starts a fresh replay window only after the authenticated configured session changes',async()=>{
 const f=await fixture()
 try{
  expect(await f.raw({subtype:'ui_render'})).toBe(200)
  expect(await f.raw({subtype:'ui_render'})).toBe(409)
  f.rotateSession('next-native-session')
  expect(await f.raw({subtype:'ui_render'})).toBe(200)
  expect(await f.raw({subtype:'ui_render'})).toBe(409)
  expect(f.control).toHaveBeenCalledTimes(2)
 }finally{await f.close()}
})

it('starts a replacement API transport at sequence 1 while refusing retired and replayed frames',async()=>{
 const f=await fixture(),request={subtype:'ui_prompt_edit',text:'Original worker',cursor:15}
 try{
  expect(await f.raw(request,6000)).toBe(200)
  const replacement=f.replaceTransport()
  await expect(replacement.request(request)).resolves.toEqual({text:request.text,cursor:request.cursor})
  expect(await f.raw(request,1)).toBe(409)
  expect(await f.raw(request,6001,'a'.repeat(32))).toBe(409)
  await expect(f.transport.request(request)).rejects.toThrow()
  await expect(replacement.request(request)).resolves.toEqual({text:request.text,cursor:request.cursor})
 }finally{await f.close()}
})

it('refuses a reply whose transport was replaced while native control was pending',async()=>{
 const f=await fixture();let release!:(value:{text:string;cursor:number})=>void
 const held=new Promise<{text:string;cursor:number}>(resolve=>{release=resolve});f.control.mockImplementationOnce(async()=>held)
 try{
  const pending=f.transport.request({subtype:'ui_prompt_edit',text:'Old draft',cursor:9});const refused=expect(pending).rejects.toThrow('owner changed')
  await vi.waitFor(()=>expect(f.control).toHaveBeenCalledOnce())
  f.replaceTransport();release({text:'Old draft',cursor:9});await refused
 }finally{release?.({text:'',cursor:0});await f.close()}
})
