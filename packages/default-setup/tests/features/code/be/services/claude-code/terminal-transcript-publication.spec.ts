import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

it('publishes the original journal without classic hooks and deduplicates only successful registration',async()=>{
 const gate={sessionId:'native-session',transcriptPath:'/private/native-session.jsonl',view:{kind:'main'},sequence:1,policy:{allowManagedHooksOnly:false,disableAllHooks:false},hooksDisabled:false,activity:{pendingAgents:0,pendingWorkflows:0}}
 const ownerPost=vi.fn(async(_path:string,_body:unknown)=>({})),control=vi.fn(async()=>gate)
 let tick!:()=>Promise<void>
 vm.runInNewContext(claudeTerminalUiRuntime.slice(claudeTerminalUiRuntime.indexOf('let ownerReading=')),{control,ownerPost,native:undefined,AbortController,process:{pid:42},setInterval:(fn:typeof tick)=>{tick=fn;return{unref(){}}}})
 await tick();expect(ownerPost).toHaveBeenCalledWith('/transcript',{sessionId:'native-session',path:'/private/native-session.jsonl'})
 expect(ownerPost).not.toHaveBeenCalledWith('/poll',expect.anything())
 await tick();expect(ownerPost.mock.calls.filter(([path])=>path==='/transcript')).toHaveLength(1)
 gate.transcriptPath='/private/other/native-session.jsonl'
 await tick()
 expect(ownerPost.mock.calls.filter(([path])=>path==='/transcript')).toHaveLength(2)
 gate.transcriptPath='/private/retry/native-session.jsonl';ownerPost.mockRejectedValueOnce(new Error('Temporary broker refusal'))
 await tick();await tick();await tick()
 expect(ownerPost.mock.calls.filter(([path])=>path==='/transcript')).toHaveLength(4)
})
