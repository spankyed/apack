import vm from 'node:vm'
import { claudeTerminalToolUseRuntime } from '#features/code/be/services/claude-code/terminal-tool-use-runtime.ts'
function fixture() {
 const call={type:'tool_use',id:'tool',name:'Write',input:{file_path:'original.txt',content:'original'}}
 const assistant={type:'assistant',uuid:'assistant',message:{content:[call]}}
 const messages: any[]=[assistant]
 const state: {viewingAgentTaskId?:string;transcripts:Record<string,{inProgressToolUseIDs:Set<string>}>}={transcripts:{main:{inProgressToolUseIDs:new Set()}}}
 const result = () => messages.find(message=>message.type==='user')
 const n={runtime:{ey:()=>binding,sQt:()=>({lookups:{toolResultByToolUseID:new Map(result()?[['tool',result()]]:[]),erroredToolUseIDs:new Set(result()?.error?['tool']:[])},inProgressToolUseIDs:new Set(['tool'])})},transcriptState:{vws:()=> 'main',wOt:{inProgressToolUseIDs:new Set()}},engine:{aK:{isInterruptedCall:vi.fn((row:any)=>row?.interrupted===true)}}}
 const binding={messages:()=>messages,toolContext:()=>({getAppState:()=>state})}
 const methods=vm.runInNewContext(`${claudeTerminalToolUseRuntime};({facts:toolUseFacts,check:currentToolUseAction,frames:toolUseFrames})`,{originalContext:binding,AbortController})
 return{n,messages,state,call,methods,facts:()=>methods.facts(n,'tool','assistant',new AbortController())}
}
it('uses the original live running set rather than inferring running from unresolved calls',()=>{
 const f=fixture();expect(f.facts().props).toMatchObject({tool:'Write',input:f.call.input,isRunning:false,isErrored:false,isInterrupted:false})
 f.state.transcripts.main!.inProgressToolUseIDs.add('tool');expect(f.facts().props.isRunning).toBe(true)
 delete f.state.transcripts.main;expect(f.facts().props.isRunning).toBe(false)
})
it('preserves canonical output/error/interruption and retires actions after original producer state changes',()=>{
 const f=fixture(),first=f.facts()
 f.methods.frames.set(JSON.stringify(['view','tool']),{assistantUuid:'assistant',fingerprint:first.fingerprint})
 expect(()=>f.methods.check(f.n,{component:'ToolUse',client_id:'view',instance_id:'tool'})).not.toThrow()
 const output={content:'original result'}
 f.messages.push({type:'user',uuid:'result',toolUseResult:output,error:true,interrupted:true})
 expect(f.facts().props).toMatchObject({output,isErrored:true,isInterrupted:true})
 expect(()=>f.methods.check(f.n,{component:'ToolUse',client_id:'view',instance_id:'tool'})).toThrow('changed or expired')
})
it('refuses foreign assistant rows, ambiguous calls and parent lookups from a selected Agent view',()=>{
 const f=fixture()
 expect(f.methods.facts(f.n,'tool','foreign',new AbortController())).toBeUndefined()
 f.messages.push(f.messages[0]);expect(f.facts()).toBeUndefined();f.messages.pop()
 f.state.viewingAgentTaskId='agent';expect(f.facts()).toBeUndefined()
})
