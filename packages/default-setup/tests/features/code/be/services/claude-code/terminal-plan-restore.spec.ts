import vm from 'node:vm'
import {claudeTerminalUiRuntime} from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
import {createClaudeTerminalSession} from '#features/code/be/services/claude-code/terminal-session.ts'
function fixture(mode='plan',prePlanMode?:string){
 let state={mode,prePlanMode}
 const context={getAppState:()=>({toolPermissionContext:state}),setToolPermissionContext:(update:(prior:typeof state)=>typeof state)=>{state=update(state)}}
 const apply=vi.fn((target:string,_before:unknown,update:typeof context.setToolPermissionContext)=>{update(prior=>({mode:target,prePlanMode:target==='plan'?prior.mode:undefined}));return {ok:true,mode:target}})
 const start=claudeTerminalUiRuntime.indexOf('let planContextRestored=false;'),end=claudeTerminalUiRuntime.indexOf('async function control(request,abort)',start)
 const run=vm.runInNewContext(`(config,n,context)=>{${claudeTerminalUiRuntime.slice(start,end)};return session=>restoreNativePlanContext(n,context,session)}`) as (config:unknown,native:unknown,context:unknown)=>(session:string)=>void
 return {apply,state:()=>state,restore:run({restorePlan:{sessionId:'saved',mode:'acceptEdits'}},{permissions:{bC:apply}},context)}
}
it('restores original pre-Plan context through both native transitions once for the saved session only',()=>{
 const f=fixture();f.restore('foreign');expect(f.apply).not.toHaveBeenCalled()
 f.restore('saved');expect(f.apply.mock.calls.map(call=>call[0])).toEqual(['acceptEdits','plan']);expect(f.state()).toEqual({mode:'plan',prePlanMode:'acceptEdits'})
 f.restore('saved');expect(f.apply).toHaveBeenCalledTimes(2)
})
it('keeps an already-restored context and never forces Plan after a policy-adjusted startup',()=>{
 for(const [mode,prior] of [['plan','acceptEdits'],['default',undefined]]){const f=fixture(mode,prior);f.restore('saved');expect(f.apply).not.toHaveBeenCalled();expect(f.state()).toEqual({mode,prePlanMode:prior})}
})
it('returns the original restoration gate refusal without constructing permission state',()=>{
 const f=fixture();f.apply.mockImplementation(()=>({ok:false,mode:'plan',error:'Original bypass restriction'}))
 expect(()=>f.restore('saved')).toThrow('Original bypass restriction');expect(f.state()).toEqual({mode:'plan',prePlanMode:undefined});expect(f.apply).toHaveBeenCalledTimes(1)
})
it('retains native pre-Plan metadata while Plan is live and drops it on exit or session replacement',()=>{
 const session=createClaudeTerminalSession('saved'),base={cwd:'/fixture',model:'fixture',turns:1,startedAt:1}
 session.update({...base,permissionMode:'plan',prePlanMode:'acceptEdits'});expect(session.metadata?.prePlanMode).toBe('acceptEdits')
 session.update(base);expect(session.metadata?.prePlanMode).toBe('acceptEdits')
 session.update({...base,permissionMode:'default'});expect(session.metadata?.prePlanMode).toBeUndefined()
 session.update({...base,permissionMode:'plan',prePlanMode:'bypassPermissions'});session.reset('replacement');expect(session.metadata).toBeUndefined()
})
