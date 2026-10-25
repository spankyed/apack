import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsEditorRuntime } from '#features/code/be/services/claude-code/terminal-settings-editor-runtime.ts'

function fixture(){
  const qh={Field:()=>{},Button:()=>{},Link:()=>{}},Config=()=>{},onClose=()=>{},open=vi.fn()
  const field={type:qh.Field,key:'model',props:{label:'Model',children:{type:qh.Button,props:{onPress:open}}}}
  const config:any={type:Config,memoizedProps:{onClose,setTabsHidden:()=>{},children:[field]}}
  const owner={child:config},frame={owner,panel:{selectedTab:'Config',hidden:false}},entry={originalProps:{onClose},closed:false,answered:false,current:vi.fn()}
  const functionHashes=new Map<string,string>(),formatText=vi.fn(async(_n:unknown,value:unknown)=>String(value))
  let hash='f9c1d43d75a5b3536ba40462166d47979c88ee4e471ccbe19e493a83984d0707'
  const run=vm.runInNewContext(claudeTerminalSettingsEditorRuntime.replace("await import('/$bunfs/root/chunk-07y7va8x.js')",'originalControls')+';({nativeSettingsEditorOpeners,activateNativeSettingsEditor,readNativeSettingsEditor,actNativeSettingsEditor,saveNativeSettingsEditor,waitForNativeSettingsConfig})',{originalControls:{qh},nativeSettingsFrame:()=>frame,awaitNativeSettingsReading:async(value:unknown)=>value,nativeGenericPermissionText:formatText,setTimeout,createHash:()=>({update:(value:string)=>({digest:()=>functionHashes.get(value)??(value.startsWith('{')?createHash('sha256').update(value).digest('hex'):hash)})})})
  return {wait:(signal?:AbortSignal)=>run.waitForNativeSettingsConfig({},entry,signal),formatText,setFunctionHash:(fn:Function,value:string)=>functionHashes.set(fn.toString(),value),editor:()=>run.readNativeSettingsEditor({},entry),act:(request:unknown)=>run.actNativeSettingsEditor({},entry,request),save:(revision:string,values:Record<string,string>)=>run.saveNativeSettingsEditor({},entry,revision,values),qh,config,field,frame,entry,open,setHash:(value:string)=>{hash=value},read:()=>run.nativeSettingsEditorOpeners({},entry),activate:(keys=new Set(['model']),signal?:AbortSignal)=>run.activateNativeSettingsEditor({},entry,'model',keys,signal)}
}
it('finds original editor callbacks in owned element props before the field mounts',async()=>{
  const f=fixture(),result=await f.read()
  expect(result.openers.get('model').label).toBe('Model');expect(result.openers.get('model').callback).toBe(f.open)
  expect(f.open).not.toHaveBeenCalled()
  f.field.props.children.props={onPress:f.open,disabled:true} as any
  expect((await f.read()).openers.size).toBe(0)
})
it('refuses changed Config producers and duplicate original editor keys',async()=>{
  const f=fixture();f.setHash('changed');await expect(f.read()).rejects.toThrow('producer changed')
  const g=fixture();g.config.memoizedProps.children.push({...g.field,props:{...g.field.props,children:{type:g.qh.Button,props:{onPress:()=>{}}}}})
  await expect(g.read()).rejects.toThrow('ambiguous')
})
it('rejects a retired owner after discovery and does not search its siblings',async()=>{
  const f=fixture();(f.frame.owner as any).sibling={...f.config}
  expect((await f.read()).openers.size).toBe(1)
  f.entry.current.mockImplementation(()=>{f.entry.closed=true})
  await expect(f.read()).rejects.toThrow('owner changed');expect(f.open).not.toHaveBeenCalled()
})

it('opens only visible, active original Config editors and preserves their callback result',async()=>{
 const f=fixture();f.open.mockResolvedValue('original open result')
 expect(await f.activate()).toBe('original open result');expect(f.open).toHaveBeenCalledExactlyOnceWith()
 await expect(f.activate(new Set())).rejects.toThrow('no longer visible')
 f.frame.panel.hidden=true;await expect(f.activate()).rejects.toThrow('unavailable')
 f.frame.panel.hidden=false;f.frame.panel.selectedTab='Stats';await expect(f.activate()).rejects.toThrow('unavailable')
 expect(f.open).toHaveBeenCalledOnce()
})
it('refuses cancellation and callback replacement immediately before original activation',async()=>{
 const f=fixture(),cancelled=new AbortController();cancelled.abort()
 await expect(f.activate(undefined,cancelled.signal)).rejects.toThrow();expect(f.open).not.toHaveBeenCalled()
 const g=fixture(),replacement=vi.fn();let checks=0
 g.entry.current.mockImplementation(()=>{if(++checks===1)g.field.props.children.props.onPress=replacement})
 await expect(g.activate()).rejects.toThrow('changed before opening');expect(g.open).not.toHaveBeenCalled();expect(replacement).not.toHaveBeenCalled()
})

it('projects original choice labels, current selection and disabled options without invoking callbacks',async()=>{
 const f=fixture(),Choice=function OriginalChoice(){},onChange=vi.fn(),onCancel=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Choice,'0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3')
 f.config.child={type:Choice,memoizedProps:{options:[{value:'a',label:'Original A'},{value:'b',label:'Original B',disabled:true}],selectedValue:'a',onChange,onCancel}}
 expect((await f.editor()).snapshot).toEqual({kind:'choice',value:'a',disabled:false,options:[{value:'a',label:'Original A',disabled:false},{value:'b',label:'Original B',disabled:true}]})
 expect(onChange).not.toHaveBeenCalled();expect(onCancel).not.toHaveBeenCalled()
 f.config.child.memoizedProps.options.push({value:'a',label:'Duplicate'})
 await expect(f.editor()).rejects.toThrow('option changed')
})
it('projects original form values and refuses unsupported fields and retired props',async()=>{
 const f=fixture(),Form=function OriginalForm(){},onChange=vi.fn(),onCancel=vi.fn(),onSubmit=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Form,'e2474315a210faf7b3cbaab9c4b40793486c2f19ed4b0a997e16fede82b933b4')
 f.config.child={type:Form,memoizedProps:{title:'Original title',fields:[{type:'text',key:'value',label:'Original label'}],values:{value:'Original value'},onChange,onCancel,onSubmit}}
 expect((await f.editor()).snapshot).toEqual({kind:'form',title:'Original title',submitLabel:'Save',fields:[{key:'value',label:'Original label',value:'Original value'}]})
 expect(onSubmit).not.toHaveBeenCalled()
 f.config.child.memoizedProps.fields[0].type='unknown';await expect(f.editor()).rejects.toThrow('unsupported')
 f.config.child.memoizedProps.fields[0].type='text';f.formatText.mockImplementationOnce(async()=>{f.config.child.memoizedProps={...f.config.child.memoizedProps};return 'retired title'})
 await expect(f.editor()).rejects.toThrow('changed while reading')
})

it('keeps selection inside original enabled choices and uses original cancellation',async()=>{
 const f=fixture(),Choice=function OriginalChoice(){},onChange=vi.fn(),onCancel=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Choice,'0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3')
 f.config.child={type:Choice,memoizedProps:{options:[{value:'a',label:'A'},{value:'b',label:'B',disabled:true}],onChange,onCancel}}
 const {revision}=await f.editor()
 await expect(f.act({action:'select',revision,value:'b'})).rejects.toThrow('unavailable')
 await expect(f.act({action:'select',revision:'retired',value:'a'})).rejects.toThrow('refresh')
 await f.act({action:'select',revision,value:'a'});expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
 await f.act({action:'cancel',revision});expect(onCancel).toHaveBeenCalledExactlyOnceWith()
})
it('uses original form validation before submission and original field-change callbacks',async()=>{
 const f=fixture(),Form=function OriginalForm(){},onChange=vi.fn(),onCancel=vi.fn(),onSubmit=vi.fn(),validate=vi.fn(()=> 'Original validation refusal' as string|null)
 f.frame.panel.hidden=true;f.setFunctionHash(Form,'e2474315a210faf7b3cbaab9c4b40793486c2f19ed4b0a997e16fede82b933b4')
 f.config.child={type:Form,memoizedProps:{title:'Original title',fields:[{type:'text',key:'value',label:'Value',validate}],values:{value:'bad'},onChange,onCancel,onSubmit}}
 const {revision}=await f.editor()
 expect(await f.act({action:'submit',revision})).toEqual({problem:'Original validation refusal'});expect(onSubmit).not.toHaveBeenCalled();expect(validate).toHaveBeenCalledWith('bad')
 await f.act({action:'change',revision,key:'value',value:'new draft'});expect(onChange).toHaveBeenCalledExactlyOnceWith('value','new draft')
 validate.mockReturnValue(null);await f.act({action:'submit',revision});expect(onSubmit).toHaveBeenCalledExactlyOnceWith()
})

it('saves exact drafts through native changes, awaits acknowledged form values and validates before native submit',async()=>{
 const f=fixture(),Form=function OriginalForm(){},validate=vi.fn(()=>null),onSubmit=vi.fn(),onCancel=vi.fn()
 const onChange=vi.fn((key:string,value:string)=>{
  const previous=f.frame.owner.child as any,oldForm=previous.child,nextForm={...oldForm,memoizedProps:{...oldForm.memoizedProps,values:{[key]:value}},alternate:oldForm};oldForm.alternate=nextForm
  const next={...previous,child:nextForm,alternate:previous};previous.alternate=next;nextForm.return=next;f.frame.owner.child=next
 })
 f.frame.panel.hidden=true;f.setFunctionHash(Form,'e2474315a210faf7b3cbaab9c4b40793486c2f19ed4b0a997e16fede82b933b4')
 f.config.child={type:Form,memoizedProps:{title:'Original form',fields:[{type:'text',key:'value',label:'Value',validate}],values:{value:'old'},onChange,onCancel,onSubmit}}
 const {revision}=await f.editor()
 await expect(f.save(revision,{foreign:'bad'})).rejects.toThrow('values changed');expect(onChange).not.toHaveBeenCalled()
 await f.save(revision,{value:'日本語 exact draft'})
 expect(onChange).toHaveBeenCalledExactlyOnceWith('value','日本語 exact draft');expect(validate).toHaveBeenCalledExactlyOnceWith('日本語 exact draft');expect(onSubmit).toHaveBeenCalledExactlyOnceWith()
})

it('reads original Output Style options before the suspended item picker mounts and retains modal Cancel',async()=>{
 const f=fixture(),Modal=function OriginalStyleModal(){},onComplete=vi.fn(),onCancel=vi.fn(),promise=Promise.resolve([{value:'default',label:'Default'},{value:'explanatory',label:'Explanatory',description:'Original explanatory description'}])
 f.frame.panel.hidden=true;f.setFunctionHash(Modal,'5086145442ea1552b1fcb76267a376e9e083bf0056bf30262bba2eda09408bcf')
 const cache=Array(15).fill(null);cache[7]=promise;cache[9]={props:{children:[null,{props:{children:{props:{styleOptionsPromise:promise,initialStyle:'default',onComplete}}}}]}}
 const modal:any={type:Modal,memoizedProps:{onCancel,onComplete,initialStyle:'default'},updateQueue:{memoCache:{data:[cache]}},return:f.config};f.config.child=modal
 const result=await f.editor();expect(result.snapshot.value).toBe('default');expect(result.snapshot.options[1]).toMatchObject({label:'Explanatory',description:'Original explanatory description'})
 await f.act({action:'select',revision:result.revision,value:'explanatory'});expect(onComplete).toHaveBeenCalledExactlyOnceWith('explanatory')
 await f.act({action:'cancel',revision:result.revision});expect(onCancel).toHaveBeenCalledExactlyOnceWith()
 f.formatText.mockImplementationOnce(async()=>{modal.memoizedProps={...modal.memoizedProps,onCancel:()=>{}};return 'retired label'})
 await expect(f.editor()).rejects.toThrow('changed while reading')
})

it('waits for an unmounted original Config root but refuses duplicate owners and cancellation',async()=>{
 vi.useFakeTimers()
 try{
  const f=fixture();(f.frame.owner as any).child=null;const mounted=f.wait();f.frame.owner.child=f.config;await vi.advanceTimersByTimeAsync(40);await mounted
  const g=fixture();g.config.sibling={...g.config};await expect(g.wait()).rejects.toThrow('not uniquely mounted')
  const cancelled=new AbortController();cancelled.abort();await expect(f.wait(cancelled.signal)).rejects.toThrow()
 }finally{vi.useRealTimers()}
})
