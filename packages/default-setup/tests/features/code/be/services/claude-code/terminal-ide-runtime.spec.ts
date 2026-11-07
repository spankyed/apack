import vm from 'node:vm'
import {createHash, randomUUID} from 'node:crypto'
import {claudeTerminalIdeRuntime} from '#features/code/be/services/claude-code/terminal-ide-runtime.ts'

// Handwritten fibers: recovered Claude code is not executed on the host.
function setup(stage: 'selection' | 'enable' | 'disable' = 'selection') {
  function Root() {} function Selection() {} function Enable() {} function Disable() {}
  const hashes = new Map<Function,string>([
    [Root,'20cb9825565dde5e85ba7802108b241b58ca2e8c38c7d51ddbbfff04de3e02cf'],
    [Selection,'ca8753bdcfe036129fea578fb07787a09acf9099b7c4891c848ff337e0c40b2f'],
    [Enable,'d5e83fa9b83ff1e82135fc882f0c9c8f28acff933c6491c60100f394b9d6d218'],
    [Disable,'b7a8f585e422cf738455c2cc9412803b1bbdd358f1c74816a72b98260a64fb1a'],
  ])
  const select=vi.fn(),change=vi.fn(),cancel=vi.fn()
  const control:any={memoizedProps:stage==='selection'?{onSelect:select,defaultFocusIndex:0,children:[{key:'private-port',props:{label:'Original IDE'}},{key:'none',props:{label:'None'}}]}:{onChange:change,defaultFocusValue:'no',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]}}
  const bodyProps={},bodyType='ink-box'
  const body:any={type:bodyType,memoizedProps:bodyProps,child:{type:'ink-text',child:{tag:6,memoizedProps:'Original explanation'},sibling:control}}
  const wrapper:any={memoizedProps:{title:'Connect IDE',onCancel:cancel,children:{type:bodyType,props:bodyProps}},child:body}
  const screen:any={type:{selection:Selection,enable:Enable,disable:Disable}[stage],memoizedProps:{},child:wrapper}
  const originalProps={authToken:'must-not-be-projected'}
  const owner:any={type:Root,memoizedProps:originalProps,child:screen}
  const entry:any={commandName:'ide',originalType:Root,originalProps,current:vi.fn(),closed:false,cancel:vi.fn()}
  const n={themeRoots:{ai:()=>new Map([[undefined,{container:{current:owner}}]])}}
  const api=vm.runInNewContext(claudeTerminalIdeRuntime+';({nativeIdeFrame,nativeIdePanel,closeNativeIdePanel})',{createHash,randomUUID,process:{stdout:undefined},setTimeout,nativeModelFunctionHash:(fn:Function)=>hashes.get(fn)})
  const abort=new AbortController(),read=()=>api.nativeIdeFrame(n,entry).snapshot
  const act=(value:string,revision=read().revision)=>api.nativeIdePanel(n,entry,{operation:'ideSelect',value,revision},abort)
  return {api,n,entry,abort,read,act,select,change,cancel,control,owner,hashes}
}
it('reads native labels without callbacks or private connection data',()=>{
  const s=setup(),snapshot=s.read()
  expect(snapshot.ide.options).toEqual([{value:'0',label:'Original IDE'},{value:'1',label:'None'}])
  expect(snapshot.ide.paragraphs).toEqual(['Original explanation'])
  expect(JSON.stringify(snapshot)).not.toMatch(/must-not-be-projected|private-port/)
  expect(s.select).not.toHaveBeenCalled();expect(s.cancel).not.toHaveBeenCalled()
})
it('uses the mounted index wrapper once and observes native completion',async()=>{
  const s=setup();s.select.mockImplementation(()=>{s.entry.closed=true})
  expect((await s.act('1')).snapshot.ide.stage).toBe('finished')
  expect(s.select).toHaveBeenCalledExactlyOnceWith(1)
})
it.each(['enable','disable'] as const)('preserves native %s confirmation values',async(stage)=>{
  const s=setup(stage);s.change.mockImplementation(()=>{s.entry.closed=true})
  await s.act('no');expect(s.change).toHaveBeenCalledExactlyOnceWith('no');expect(s.select).not.toHaveBeenCalled()
})
it('refuses stale callback identity even when labels match',async()=>{
  const s=setup(),revision=s.read().revision
  s.control.memoizedProps={...s.control.memoizedProps,onSelect:vi.fn()}
  await expect(s.act('0',revision)).rejects.toThrow('changed')
  expect(s.select).not.toHaveBeenCalled();expect(s.control.memoizedProps.onSelect).not.toHaveBeenCalled()
})
it('refuses disabled, unknown and retired selections',async()=>{
  const s=setup();s.control.memoizedProps.isDisabled=true
  await expect(s.act('0')).rejects.toThrow('unavailable')
  s.control.memoizedProps.isDisabled=false
  await expect(s.act('99')).rejects.toThrow('unavailable')
  s.entry.closed=true;expect(()=>s.read()).toThrow('expired');expect(s.select).not.toHaveBeenCalled()
})
it('refuses changed source and ambiguous owners',()=>{
  const s=setup();s.hashes.clear();expect(()=>s.read()).toThrow('changed')
  const other=setup();other.owner.sibling={...other.owner};expect(()=>other.read()).toThrow('uniquely mounted')
})
it('lets cancellation transition without falsely closing the dialog',async()=>{
  const s=setup('enable');s.cancel.mockImplementation(()=>{s.entry.transitioned=true})
  expect(await s.api.closeNativeIdePanel(s.n,s.entry)).toEqual({open:true})
  expect(s.cancel).toHaveBeenCalledOnce();expect(s.entry.answered).toBeUndefined()
})
it('checks owner admission and abort before selecting',async()=>{
  const s=setup(),revision=s.read().revision;s.abort.abort()
  await expect(s.act('0',revision)).rejects.toThrow();expect(s.select).not.toHaveBeenCalled()
  const denied=setup();denied.entry.current.mockImplementation(()=>{throw Error('foreign owner')})
  expect(()=>denied.read()).toThrow('foreign owner')
})

it('does not replay an unacknowledged selection while the original callback is pending',async()=>{
  const s=setup(),revision=s.read().revision
  let release!:()=>void
  s.select.mockImplementation(()=>new Promise<void>(resolve=>{release=()=>{s.entry.closed=true;resolve()}}))
  const first=s.act('0',revision)
  await expect(s.act('0',revision)).rejects.toThrow('unavailable')
  release();await first;expect(s.select).toHaveBeenCalledOnce()
})

function contextSetup() {
  function Composer() {}
  const dismiss=vi.fn(),clients=new Map([['owner',{}]])
  const pill={text:'[⧉ 1 line selected] ',onDelete:dismiss}
  const root:any={type:Composer,memoizedProps:{chrome:{dismissIdeSelection:dismiss},ideSelection:{source:'editor',text:'private selection must not cross this UI contract'}},child:{memoizedProps:{leadingPill:pill}}}
  const gate=vi.fn(),publish=vi.fn(),view={kind:'main'}
  const n={gate:{_Jo:gate},themeRoots:{ai:()=>new Map([[undefined,{container:{current:root}}]])}}
  const api=vm.runInNewContext(claudeTerminalIdeRuntime+';({read:nativeIdeContext,dismiss:dismissNativeIdeContext,refresh:refreshNativeIdeContext})',{
    createHash,randomUUID,process:{stdout:undefined},AbortController,clients,clientViewCurrent:()=>true,originalContext:{},nativeViewFacts:()=>({view}),publish,
    nativeModelFunctionHash:(fn:Function)=>fn===Composer?'27d5a95406b3213bae0037343d4ac93c17db5140c9466cf138beacd105723b25':undefined,
  })
  return {api,n,root,pill,dismiss,gate,publish,clients,view}
}
it('projects only the source-admitted label and dismisses through its native callback once',async()=>{
  const s=contextSetup(),frame=s.api.read(s.n,'owner')
  expect(frame.text).toBe(s.pill.text);expect(JSON.stringify(frame)).not.toContain('private selection')
  expect(s.dismiss).not.toHaveBeenCalled()
  expect(await s.api.dismiss(s.n,{client_id:'owner',revision:frame.revision})).toEqual({handled:true})
  expect(await s.api.dismiss(s.n,{client_id:'owner',revision:frame.revision})).toEqual({handled:false})
  expect(s.dismiss).toHaveBeenCalledOnce();expect(s.gate).toHaveBeenCalledWith('desktop')
})
it('refuses stale native labels and detached or Agent view owners',async()=>{
  const s=contextSetup(),frame=s.api.read(s.n,'owner')
  s.root.child.memoizedProps.leadingPill={...s.pill,text:'[⧉ 2 lines selected] '}
  expect(await s.api.dismiss(s.n,{client_id:'owner',revision:frame.revision})).toEqual({handled:false})
  s.view.kind='agent';expect(s.api.read(s.n,'owner')).toBeUndefined()
  s.view.kind='main';s.clients.clear();expect(s.api.read(s.n,'owner')).toBeUndefined()
  expect(s.dismiss).not.toHaveBeenCalled()
})
it('does not resurrect hidden context or reinterpret native diff selection as IDE context',()=>{
  const s=contextSetup();s.root.memoizedProps.ideSelection.source='diff';expect(s.api.read(s.n,'owner')).toBeUndefined()
  s.root.memoizedProps.ideSelection.source='editor';delete s.root.child.memoizedProps.leadingPill
  expect(s.api.read(s.n,'owner')).toBeUndefined()
})
it('honors policy refusal before invoking the native context dismissal',async()=>{
  const s=contextSetup(),frame=s.api.read(s.n,'owner');s.gate.mockRejectedValue(Error('managed refusal'))
  await expect(s.api.dismiss(s.n,{client_id:'owner',revision:frame.revision})).rejects.toThrow('managed refusal')
  expect(s.dismiss).not.toHaveBeenCalled()
})
