import {createHash as hash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {claudeTerminalSettingsRuntime} from '#features/code/be/services/claude-code/terminal-settings-runtime.ts'
import {claudeSettingsSnapshot} from '#features/code/common/native-settings.ts'

function fixture(kind: 'picker' | 'confirm' | 'pending' = 'picker') {
  function rootType() {}
  function pickerType() {}
  function choiceType() {}
  function confirmType() {}
  function pendingType() {}
  function keyDown() {}
  function focusGetter() { return 'sonnet' }
  function effortGetter() { return 'high' }
  function effortSetter() {}
  function adjust() {}
  const known = new Map([
    [String(rootType),'405f67fa75ab4e41349e4bafd0eca3af174269e4da6cbf7d885bcf7f9204e5a8'],
    [String(pickerType),'c0cf4bcdab4f51bf2da39b356899e179c0a8f40f309822461c09d46c4a0e7040'],
    [String(choiceType),'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'],
    [String(confirmType),'389f32eaccc6c469f0436869c3a7f3bfcffea57eb3b5d34078ee135f7714a6c0'],
    [String(pendingType),'6910c14bfa13d96592e0ba08d1ab4b71dc00908e0478853182c606ff8443f786'],
    [String(keyDown),'b615d1c7963a03e0010d1ae45108ff0bf87bffadb4a8ec8639b809754e687b49'],
    [String(focusGetter),'56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41'],
    [String(effortGetter),'56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41'],
    [String(effortSetter),'614e5f6e400f38931145513694025965d78b7003e49433d66ae369c535e3ee47'],
    [String(adjust),'4b7c3cb9a810ed389a53e1ec6b12034927df01c937b11d429b2bc7cec5aa7212'],
  ])
  let closed=false, active=true
  const onDone=vi.fn(), cancel=vi.fn(()=>{closed=true}), select=vi.fn((_value:string)=>{closed=true}), confirm=vi.fn(()=>{closed=true}), focus=vi.fn()
  const id='11111111-1111-4111-8111-111111111111'
  const entry={kind:'panel',id,commandName:'model',clientId:'owned',nodeId:'node',dialogId:'dialog',originalType:rootType,originalProps:{onDone},get closed(){return closed},answered:false,current:()=>{if(!active)throw Error('Native view changed')},store:{getState:()=>({open:closed?[]:[{id:'dialog',kind:'local_jsx',payload:{nodeId:'node'}}]})}}
  const options=[{value:'sonnet',label:'Sonnet',description:'Original model description',disabled:false},{value:'haiku',label:'Haiku',disabled:false}]
  const controls={options,isDisabled:false,selectedValue:'sonnet',defaultFocusValue:'sonnet',onChange:select,onCancel:cancel,onFocus:focus}
  const nativeChoice={type:choiceType,props:controls}
  const groups=['Original model disclosure',{props:{children:[null,{props:{children:[nativeChoice]}}]}},{props:{children:'Original effort details'}}]
  const stateRef={}
  const state=(value:unknown,next:unknown=null)=>({memoizedState:value,next})
  const hooks=state([adjust,[options,focusGetter,null,effortSetter]],state([effortSetter,[stateRef]],state([effortGetter,[stateRef]])))
  const model={type:pickerType,memoizedProps:{onSelect:select,onSetDefault:vi.fn(),onCancel:cancel,isStandaloneCommand:true},memoizedState:hooks,child:{type:'div',memoizedProps:{onKeyDown:keyDown,children:[{props:{children:groups}}]}}}
  const choice={type:choiceType,memoizedProps:{confirmLabel:'Yes, switch to Haiku',cancelLabel:'No, go back',focus:'confirm',onConfirm:confirm,onCancel:cancel}}
  const modal={type:'div',memoizedProps:{title:'Switch model?',subtitle:'A PreModelSwitch hook asked you to confirm',onCancel:cancel,children:{props:{children:['Original reason',{props:choice.memoizedProps}]}}},child:choice}
  const confirmation={type:confirmType,memoizedProps:{kind:'model',model:'haiku',hookReason:'Original reason',onConfirm:confirm,onCancel:cancel},child:modal}
  const pending={type:pendingType,memoizedProps:{message:'Running PreModelSwitch hooks…',onCancel:cancel}}
  const owner={type:rootType,memoizedProps:entry.originalProps,child:kind==='picker'?model:kind==='confirm'?confirmation:pending}
  const render=(value:any):string=>value==null?'':Array.isArray(value)?value.map(render).join(' '):typeof value==='object'?render(value.props?.children):String(value)
  let beforeText: (()=>Promise<void>) | undefined
  const api=runInNewContext(claudeTerminalSettingsRuntime+';({nativeSettings})',{
    process:{stdout:{}},setTimeout,clearTimeout,AbortController,
    agentCommandDialogs:new Map([[id,entry]]),
    createHash:()=>({value:'',update(value:string){this.value=value;return this},digest(){return known.get(this.value)??hash('sha256').update(this.value).digest('hex')}}),
    stripVTControlCharacters:(value:string)=>value,
    nativeGenericPermissionText:async(_native:unknown,value:unknown)=>{await beforeText?.();return render(value)},
  }) as {nativeSettings(n:unknown,request:unknown,abort:AbortController):Promise<{snapshot:any}>}
  const native={gate:{_Jo:vi.fn(async()=>{})},themeRoots:{ai:()=>({get:()=>({container:{current:owner}})})}}
  const read=(client='owned')=>api.nativeSettings(native,{client_id:client,panel_id:id,operation:'read'},new AbortController())
  const operate=(snapshot:any,command:unknown)=>api.nativeSettings(native,{client_id:'owned',panel_id:id,operation:'editor',revision:snapshot.revision,editor_revision:snapshot.editor.revision,command},new AbortController())
  return {entry,options,model,confirmation,pending,owner,select,confirm,cancel,focus,read,operate,setActive:(value:boolean)=>{active=value},setBeforeText:(callback:()=>Promise<void>)=>{beforeText=callback}}
}

it('projects standalone model descriptions and calls the original selection callback',async()=>{
  const f=fixture(),{snapshot}=await f.read()
  expect(claudeSettingsSnapshot.parse(snapshot).editor).toMatchObject({kind:'choice',model:{description:'Original model disclosure'}})
  await f.operate(snapshot,{action:'select',value:'haiku'})
  expect(f.select).toHaveBeenCalledExactlyOnceWith('haiku')
})
it('preserves the original confirmation focus and wrapped confirm callback',async()=>{
  const f=fixture('confirm'),{snapshot}=await f.read()
  expect(claudeSettingsSnapshot.parse(snapshot).editor).toMatchObject({kind:'choice',consent:{defaultFocusValue:'confirm',description:expect.stringContaining('Original reason')}})
  await f.operate(snapshot,{action:'select',value:'confirm'})
  expect(f.confirm).toHaveBeenCalledOnce();expect(f.cancel).not.toHaveBeenCalled()
})
it('keeps cancellation available while original hooks run',async()=>{
  const f=fixture('pending'),{snapshot}=await f.read()
  expect(claudeSettingsSnapshot.parse(snapshot)).toMatchObject({refreshPending:true,editor:{kind:'information',description:'Running PreModelSwitch hooks…'}})
  await f.operate(snapshot,{action:'cancel'});expect(f.cancel).toHaveBeenCalledOnce()
})
it('refuses foreign clients before reading or calling model controls',async()=>{
  const f=fixture();await expect(f.read('foreign')).rejects.toThrow('expired');expect(f.select).not.toHaveBeenCalled()
})
it('refuses a stale choice after native availability changes',async()=>{
  const f=fixture(),{snapshot}=await f.read();f.options[1]!.disabled=true
  await expect(f.operate(snapshot,{action:'select',value:'haiku'})).rejects.toThrow('changed');expect(f.select).not.toHaveBeenCalled()
})
it('refuses an owner retired during disclosure rendering',async()=>{
  const f=fixture();f.setBeforeText(async()=>{f.setActive(false)})
  await expect(f.read()).rejects.toThrow('view changed');expect(f.select).not.toHaveBeenCalled()
})
it('refuses duplicate decisions while a disclosure read is in flight',async()=>{
  const f=fixture(),{snapshot}=await f.read();let release!:()=>void
  const waiting=new Promise<void>(resolve=>{release=resolve});f.setBeforeText(()=>waiting)
  const first=f.operate(snapshot,{action:'select',value:'haiku'})
  await expect(f.operate(snapshot,{action:'select',value:'haiku'})).rejects.toThrow('pending')
  release();await first;expect(f.select).toHaveBeenCalledOnce()
})
