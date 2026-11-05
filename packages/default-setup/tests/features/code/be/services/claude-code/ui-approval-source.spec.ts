import {createClaudeChildApprovalSource} from '#features/code/be/services/claude-code/ui-approval-source.ts'
import type {ClaudeBackgroundApproval} from '#features/code/be/services/claude-code/background-controls.ts'
import type {ClaudeBackgroundDesktopOwner} from '#features/code/be/services/claude-code/background-status-observer.ts'
const sessionId='11111111-1111-4111-8111-111111111111'
const token='a'.repeat(64)
function fixture() {
 let control:ClaudeBackgroundApproval|undefined={kind:'bash',dialog:{id:'dialog',revision:sessionId,sessionId,requestId:'tool',toolName:'Bash',command:'printf original',cwd:'/owned',input:{command:'printf original'},choiceToken:'b'.repeat(64),choices:[{value:'yes',token,label:'Yes'}]}}
 const request=vi.fn(async(_value:unknown)=>({answered:true})),settled=vi.fn()
 const owner={identity:{sessionId},controls:{get value(){return control},subscribe:()=>()=>{},settled},transport:{request}} as unknown as ClaudeBackgroundDesktopOwner
 return{source:createClaudeChildApprovalSource(owner),request,settled,get control(){return control!},replace(value?:ClaudeBackgroundApproval){control=value}}
}
it('uses the selected original consent token and never sends replacement input or permission updates',async()=>{
 const f=fixture()
 await f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})
 expect(f.request).toHaveBeenCalledExactlyOnceWith({subtype:'apack_answer_bash_dialog',id:'dialog',revision:sessionId,session_id:sessionId,decision:'allow',choice:'yes',choiceToken:token})
 expect(f.settled).toHaveBeenCalledExactlyOnceWith('dialog',sessionId)
})
it('refuses stale tokens, foreign owners and unoffered cancellation before calling native',async()=>{
 const f=fixture()
 await expect(f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:'c'.repeat(64)})).rejects.toThrow('choice changed')
 const foreign=structuredClone(f.control);foreign.dialog.sessionId='foreign'
 await expect(f.source.answer(foreign,{approved:false})).rejects.toThrow('changed')
 await expect(f.source.answer(f.control,{approved:false,cancelled:true})).rejects.toThrow('cancellation')
 expect(f.request).not.toHaveBeenCalled()
})
it('preserves original denial feedback and serializes concurrent window decisions',async()=>{
 const f=fixture();let finish!:(value:{answered:boolean})=>void
 f.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const first=f.source.answer(f.control,{approved:false,reason:'Keep the file unchanged.'})
 await expect(f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})).rejects.toThrow('already being answered')
 expect(f.request).toHaveBeenCalledTimes(1)
 finish({answered:true});await first
 expect(f.request).toHaveBeenCalledWith(expect.objectContaining({decision:'deny',feedback:'Keep the file unchanged.'}))
})
it('does not silently fall back to a raw allow when the native mounted choice is unavailable',async()=>{
 const f=fixture(),control=f.control
 if(control.kind!=='bash')throw Error('Expected Bash fixture')
 f.replace({...control,dialog:{...control.dialog,choices:undefined,choiceToken:undefined}})
 await expect(f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})).rejects.toThrow('unavailable')
 expect(f.request).not.toHaveBeenCalled()
})
it('keeps file, workflow, tool and generic decisions on their original contract and gates',async()=>{
 const f=fixture(),identity={id:'dialog',revision:sessionId,sessionId,requestId:'tool',input:{}}
 const presentation={token,ready:true,choices:[{value:'yes',label:'Allow',decision:'allow' as const,feedback:false},{value:'no',label:'Deny',decision:'deny' as const,feedback:true}]}
 f.replace({kind:'file',dialog:{...identity,toolName:'Write',title:'Write file',question:'Write?',approval:presentation}})
 await f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})
 expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({subtype:'apack_answer_file_dialog',choice:'yes',choiceToken:token}))
 expect(f.request.mock.calls.at(-1)![0]).not.toHaveProperty('input')
 f.replace({kind:'workflow',dialog:{...identity,toolName:'Workflow',presentation:{...presentation,withheld:true,choices:[{value:'no',label:'Deny',decision:'deny',feedback:true}]}}})
 await expect(f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})).rejects.toThrow('choice changed')
 await f.source.answer(f.control,{approved:false,choice:'no',choiceToken:token,reason:'Keep the plan.'})
 expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({subtype:'apack_answer_workflow_dialog',decision:'deny',feedback:'Keep the plan.'}))
 f.replace({kind:'tool',dialog:{...identity,toolName:'WebFetch',presentation:{...presentation,title:'Read site',details:[]}}})
 await f.source.answer(f.control,{approved:true,choice:'yes',choiceToken:token})
 expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({subtype:'apack_answer_tool_permission_dialog',toolName:'WebFetch'}))
 f.replace({kind:'generic',dialog:{...identity,toolName:'OriginalTool',presentation:{...presentation,title:'Original request',details:[],canCancel:true,choiceDescriptions:{}}}})
 await f.source.answer(f.control,{approved:false,cancelled:true,choiceToken:token})
 expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({subtype:'apack_answer_generic_tool_permission_dialog',toolName:'OriginalTool',decision:'cancel',choice:''}))
})
it('forwards only an offered native plan choice and reviewed plan text',async()=>{
 const f=fixture()
 f.replace({kind:'plan',dialog:{id:'dialog',revision:sessionId,sessionId,requestId:'plan',toolName:'ExitPlanMode',input:{},presentation:{plan:'# Original',initialChoice:'keep',empty:false,withheld:false,choices:[{value:'keep',label:'Keep context',mode:'default',clearContext:false}]}}})
 await expect(f.source.answer(f.control,{approved:true,choice:'invented'})).rejects.toThrow('choice changed')
 await f.source.answer(f.control,{approved:true,choice:'keep',plan:'# Revised',reason:'Retain tests.'})
 expect(f.request).toHaveBeenCalledExactlyOnceWith({subtype:'apack_answer_plan_dialog',id:'dialog',revision:sessionId,session_id:sessionId,decision:'allow',choice:'keep',plan:'# Revised',feedback:'Retain tests.'})
})
