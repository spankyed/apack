import {createClaudeApprovalHost} from '#features/code/be/services/claude-code/ui-approval-host.ts'
import type {ClaudeBackgroundApproval} from '#features/code/be/services/claude-code/background-controls.ts'
function fixture(){
 let control:ClaudeBackgroundApproval|undefined={kind:'bash',dialog:{id:'dialog',revision:'first',sessionId:'child',requestId:'tool',toolName:'Bash',command:'printf original',cwd:'/owned',input:{}}}
 const answer=vi.fn(async(_control:ClaudeBackgroundApproval,_response:unknown)=>{}),publish=vi.fn()
 const host=createClaudeApprovalHost({source:{read:()=>control,subscribe:()=>()=>{},answer},current:()=>true,publish})
 return{host,answer,replace(){if(control?.kind!=='bash')throw Error('Expected Bash fixture');control={kind:'bash',dialog:{...control.dialog,revision:'replacement'}}},close(){control=undefined}}
}
it('refuses a stale view frame and retains original refusal without clearing the current form',async()=>{
 const f=fixture();f.host.refresh();const first=f.host.state!.id
 f.replace();f.host.refresh();const second=f.host.state!.id
 expect(second).not.toBe(first)
 await f.host.answer(first,{approved:false});expect(f.answer).not.toHaveBeenCalled()
 f.answer.mockRejectedValueOnce(Error('Original admission refused'))
 await f.host.answer(second,{approved:false})
 expect(f.host.state?.problem).toBe('Original admission refused');expect(f.host.state?.pending).toBe(false)
 f.host.dispose();expect(f.host.state).toBeUndefined()
})
it('does not publish late acknowledgement into a replacement form or submit concurrent answers',async()=>{
 const f=fixture();f.host.refresh();const id=f.host.state!.id;let finish!:()=>void
 f.answer.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 const first=f.host.answer(id,{approved:false});await f.host.answer(id,{approved:true})
 expect(f.answer).toHaveBeenCalledOnce()
 f.replace();f.host.refresh();const next=f.host.state!.id
 finish();await first;expect(f.host.state?.id).toBe(next)
 f.close();f.host.refresh();expect(f.host.state).toBeUndefined();f.host.dispose()
})
