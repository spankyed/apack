import vm from 'node:vm'
import {createServer,request as httpRequest} from 'node:http'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createClaudeTerminalUiTransport} from '#features/code/be/services/claude-code/terminal-ui.ts'
import {claudeTerminalUiRuntime} from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
import {CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES} from '#features/code/be/services/claude-code/ui-text-limits.ts'

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'cc-forward-text-')),socketPath=join(directory,'ui.sock')
 const owner={pid:17,sessionId:'native-session'},token='private-token'
 const control=vi.fn(async(value:Record<string,unknown>)=>value.subtype==='ui_prompt_autocomplete'?{suggestions:[{text:value.text}]}:{text:value.text,cursor:value.cursor})
 const start=claudeTerminalUiRuntime.indexOf('const server=http.createServer(')
 const end=claudeTerminalUiRuntime.indexOf('await new Promise((resolve,reject)=>{server.once',start)
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start)
 // Only the authored HTTP handler executes; original module imports/control implementations do not.
 const server=vm.runInNewContext(claudeTerminalUiRuntime.slice(start,end)+';server',{
  http:{createServer},AbortController,Buffer,process:{pid:owner.pid},config:{token},configUrl:'config',
  readFileSync:()=>JSON.stringify({sessionId:owner.sessionId}),activeSession:owner.sessionId,
  seen:new Set(),highestSequence:0,inFlight:0,control,
  nativeUiTextMessageMaxBytes:CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES,nativeUiPromptRpcSubtypes:new Set(['ui_prompt_edit','ui_prompt_autocomplete']),
 }) as ReturnType<typeof createServer>
 await new Promise<void>(resolve=>server.listen(socketPath,resolve))
 const ui=createClaudeTerminalUiTransport({socketPath,token,current:()=>owner})
 return{...ui,control,async raw(value:Record<string,unknown>){
  return new Promise<number>((resolve,reject)=>{
   const request=httpRequest({socketPath,path:'/control',method:'POST',headers:{'x-apack-native-token':token}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode!))})
   request.on('error',reject);request.end(JSON.stringify({id:randomUUID(),sequence:100,ownerPid:owner.pid,sessionId:owner.sessionId,request:value}))
  })
 },async close(){ui.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true})}}
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
