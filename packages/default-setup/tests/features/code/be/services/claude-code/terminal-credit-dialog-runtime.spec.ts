import {createHash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {claudeTerminalModelPanelRuntime} from '#features/code/be/services/claude-code/terminal-model-panel-runtime.ts'

function fixture(){
 function wrapper(){}
 function credit(){}
 const hashes=new Map([[String(wrapper),'78992b85babbb53889dc3395168432c43d1f0d96d895324d1691d195539b0dea'],[String(credit),'385e89b554a9d862cc9899123dff7b2f50cbb75e2949cd1a0d1068428066d513']])
 const payload={overagesEnabled:false,model:'fable',modelName:'Fable'},item={id:'dialog',kind:'fable_overage_consent_prompt',payload}
 let open=[item],session='owned',store={getState:()=>({open})}
 const answer=vi.fn(),renderer={type:credit,memoizedProps:{variant:'mid-session',model:'fable',modelName:'Fable'}}
 const owner={type:wrapper,memoizedProps:{payload,answer},child:renderer}
 const binding={surface:'terminal',toolContext:()=>({dialogStore:store})}
 const n={runtime:{ey:()=>binding},questionOptions:{q:()=>session},themeRoots:{ai:()=>({get:()=>({container:{current:owner}})})}}
 const api=runInNewContext(claudeTerminalModelPanelRuntime+';({nativeCreditDialog,nativeModelPanelFrame,afterNativeModelAction})',{
  originalContext:undefined,process:{stdout:{}},AbortController,configUrl:'config',readFileSync:()=>JSON.stringify({sessionId:'owned'}),
  createHash:()=>({value:'',update(value:string){this.value=value;return this},digest(){return hashes.get(this.value)??createHash('sha256').update(this.value).digest('hex')}}),
 }) as {nativeCreditDialog(n:unknown):any;nativeModelPanelFrame(n:unknown,entry:unknown):unknown;afterNativeModelAction(n:unknown,entry:unknown,before:unknown,signal:AbortSignal):Promise<unknown>}
 return {api,n,item,owner,renderer,answer,read:()=>api.nativeCreditDialog(n),setOpen:(value:typeof open)=>{open=value},replaceStore:()=>{store={getState:()=>({open})}},changeSession:()=>{session='foreign'}}
}
it('admits the original mid-session root without a model command and reuses its entry',()=>{
 const f=fixture(),entry=f.read()
 expect(entry.kind).toBe('credit-dialog');expect(entry.commandName).toBeUndefined()
 expect(f.read()).toBe(entry);expect(f.api.nativeModelPanelFrame(f.n,entry)).toBe(f.owner)
 expect(f.answer).not.toHaveBeenCalled()
})
it('marks original settlement closed so native action polling can finish',()=>{
 const f=fixture(),entry=f.read();f.setOpen([]);entry.current()
 expect(entry.closed).toBe(true);expect(f.read()).toBeUndefined()
 expect(()=>f.api.nativeModelPanelFrame(f.n,entry)).toThrow('expired')
})
it.each(['session','store','replacement','answer'] as const)('rejects %s ownership changes before reusing a credit action',kind=>{
 const f=fixture(),entry=f.read()
 if(kind==='session')f.changeSession()
 if(kind==='store')f.replaceStore()
 if(kind==='replacement')f.setOpen([{...f.item}])
 if(kind==='answer')f.owner.memoizedProps.answer=vi.fn()
 expect(()=>f.api.nativeModelPanelFrame(f.n,entry)).toThrow()
 expect(f.answer).not.toHaveBeenCalled()
})
it('refuses a second dialog and foreign model renderer',()=>{
 const f=fixture(),entry=f.read();f.setOpen([f.item,{...f.item,id:'other'}])
 expect(()=>f.api.nativeModelPanelFrame(f.n,entry)).toThrow('replaced')
 f.setOpen([f.item]);f.renderer.memoizedProps.model='foreign'
 expect(()=>f.read()).toThrow('renderer changed')
})
it('does not admit an unknown wrapper or non-mid-session renderer',()=>{
 const f=fixture();f.owner.type=function unknown(){}
 expect(()=>f.read()).toThrow('not uniquely mounted')
 const g=fixture();g.renderer.memoizedProps.variant='model'
 expect(()=>g.read()).toThrow('renderer changed')
})

it('accepts original settlement discovered during the post-action read',async()=>{
 const f=fixture(),entry=f.read(),snapshot={revision:'last-native-frame'}
 f.setOpen([])
 await expect(f.api.afterNativeModelAction(f.n,entry,{snapshot},new AbortController().signal)).resolves.toEqual({snapshot})
 expect(entry.closed).toBe(true)
})
it('revalidates mid-session renderer ownership on every action frame',()=>{
 const f=fixture(),entry=f.read();f.renderer.memoizedProps.variant='model'
 expect(()=>f.api.nativeModelPanelFrame(f.n,entry)).toThrow('renderer changed')
})
