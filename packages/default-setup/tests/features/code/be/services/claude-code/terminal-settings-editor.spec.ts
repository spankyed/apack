import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsEditorRuntime } from '#features/code/be/services/claude-code/terminal-settings-editor-runtime.ts'

function fixture(){
  const qh={Field:()=>{},Button:()=>{},Link:()=>{}},Config=()=>{},onClose=()=>{},open=vi.fn()
  const field={type:qh.Field,key:'model',props:{label:'Model',children:{type:qh.Button,props:{onPress:open}}}}
  const config:any={type:Config,memoizedProps:{onClose,setTabsHidden:()=>{},children:[field]}}
  const owner={child:config},frame={owner,panel:{selectedTab:'Config',hidden:false}},entry={originalProps:{onClose},closed:false,answered:false,current:vi.fn()}
  const functionHashes=new Map<string,string>(),formatText=vi.fn(async(_n:unknown,value:unknown)=>String(value)),palette=vi.fn(()=>({text:'#eeeeee',inverseText:'#111111'}))
  let hash='f9c1d43d75a5b3536ba40462166d47979c88ee4e471ccbe19e493a83984d0707'
  const run=vm.runInNewContext(claudeTerminalSettingsEditorRuntime.replaceAll("await import('/$bunfs/root/chunk-07y7va8x.js')",'originalControls')+';({nativeSettingsEditorOpeners,activateNativeSettingsEditor,readNativeSettingsEditor,actNativeSettingsEditor,saveNativeSettingsEditor,waitForNativeSettingsConfig})',{originalControls:{qh},nativeSettingsFrame:()=>frame,awaitNativeSettingsReading:async(value:unknown)=>value,nativeGenericPermissionText:formatText,nativeThemePalette:palette,nativeGenericPermissionDetail:async()=>({value:'Original code preview',ansi:'\u001b[32mOriginal code preview\u001b[0m'}),setTimeout,createHash:()=>({update:(value:string)=>({digest:()=>functionHashes.get(value)??(value.startsWith('{')?createHash('sha256').update(value).digest('hex'):hash)})})})
  return {palette,wait:(signal?:AbortSignal)=>run.waitForNativeSettingsConfig({},entry,signal),formatText,setFunctionHash:(fn:Function,value:string)=>functionHashes.set(fn.toString(),value),editor:()=>run.readNativeSettingsEditor({},entry),act:(request:unknown)=>run.actNativeSettingsEditor({},entry,request),save:(revision:string,values:Record<string,string>)=>run.saveNativeSettingsEditor({},entry,revision,values),qh,config,field,frame,entry,open,setHash:(value:string)=>{hash=value},read:()=>run.nativeSettingsEditorOpeners({},entry),activate:(keys=new Set(['model']),signal?:AbortSignal)=>run.activateNativeSettingsEditor({},entry,'model',keys,signal)}
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

it('projects native Language drafts and submits through original trim/default and Cancel callbacks',async()=>{
 const f=fixture(),Language=function OriginalLanguage(){},onComplete=vi.fn(),onCancel=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Language,'4251c8f399ee8c6b3dfe922dfa46ef8adfa3e34dc8de1d52aec1b1aaa617b3e9')
 const cache:any[]=Array(13).fill(null)
 const mount=(value:string)=>{
  const onSubmit=()=>onComplete(value.trim()||undefined)
  const input={value,onChange:vi.fn((next:string)=>mount(next)),onSubmit}
  cache[2]=onComplete;cache[3]=onSubmit;cache[7]=onSubmit;cache[8]=value
  cache[4]={props:{children:'Enter your preferred response and voice language:'}}
  cache[9]={props:{children:[null,{props:input}]}};cache[10]={props:{children:'Leave empty for default (English)'}}
 }
 mount('French')
 f.config.child={type:Language,memoizedProps:{initialLanguage:'French',onComplete,onCancel},updateQueue:{memoCache:{data:[cache]}}}
 let editor=await f.editor()
 expect(editor.snapshot).toMatchObject({kind:'form',title:'Language',description:'Leave empty for default (English)',fields:[{key:'language',label:'Enter your preferred response and voice language:',value:'French'}]})
 await f.act({action:'cancel',revision:editor.revision});expect(onCancel).toHaveBeenCalledOnce();expect(onComplete).not.toHaveBeenCalled()
 await f.save(editor.revision,{language:'  日本語  '});expect(onComplete).toHaveBeenLastCalledWith('日本語')
 editor=await f.editor();await f.save(editor.revision,{language:'   '});expect(onComplete).toHaveBeenLastCalledWith(undefined)
 cache[2]=()=>{};await expect(f.editor()).rejects.toThrow('input callbacks changed')
})
it('refuses Language input replacement during projection even if original modal props remain',async()=>{
 const f=fixture(),Language=function OriginalLanguage(){},onComplete=vi.fn(),onCancel=vi.fn(),onSubmit=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Language,'080eee2fde8fe097c91811244a1dc193b139c7df65f12765827c4117230eace6')
 const cache:any[]=Array(13).fill(null),input={value:'French',onChange:vi.fn(),onSubmit}
 cache[2]=onComplete;cache[3]=onSubmit;cache[7]=onSubmit;cache[8]='French';cache[4]={props:{children:'Language'}};cache[9]={props:{children:[null,{props:input}]}}
 f.config.child={type:Language,memoizedProps:{onComplete,onCancel},updateQueue:{memoCache:{data:[cache]}}}
 f.formatText.mockImplementationOnce(async()=>{cache[9]={props:{children:[null,{props:{...input}}]}};return 'Language'})
 await expect(f.editor()).rejects.toThrow('changed while reading');expect(onSubmit).not.toHaveBeenCalled()
})

it('projects original Theme choices, preview, syntax toggle, commit and preview-restoring Cancel',async()=>{
 const f=fixture(),Theme=function OriginalTheme(){},onThemeSelect=vi.fn(),onCancel=vi.fn(),preview=vi.fn(),select=vi.fn(),cancel=vi.fn(),toggle=vi.fn()
 f.frame.panel.hidden=true;f.setFunctionHash(Theme,'b9f5ab35590945b214b817f84d10a4cb1469872f52ab96cc93f8a47613b31987')
 const cache:any[]=Array(109).fill(null),options=[{value:'dark',label:'Dark mode'},{value:'light',label:'Light mode',origin:'Original origin'}]
 cache[0]=null;cache[11]=toggle;cache[14]=onCancel;cache[15]=cancel;cache[30]=options;cache[56]=options;cache[62]=options;cache[54]='light';cache[65]='dark';cache[57]=preview;cache[63]=select;cache[61]=onThemeSelect;cache[72]={props:{onFocus:preview,onSelect:select}};cache[84]={original:'sample'};cache[77]={lines:[' Original code preview']};cache[81]='Original syntax caption'
 f.config.child={type:Theme,memoizedProps:{onThemeSelect,onCancel,skipExitHandling:true},updateQueue:{memoCache:{data:[cache]}}}
 const result=await f.editor();expect(result.snapshot).toMatchObject({kind:'choice',value:'dark',previewValue:'light',canPreview:true,canToggleSyntax:true,preview:{text:'Original code preview',theme:{text:'#eeeeee',inverseText:'#111111'}},options:[{value:'dark',label:'Dark mode'},{value:'light',label:'Light mode',description:'Original origin'}]})
 await f.act({action:'preview',revision:result.revision,value:'light'});expect(preview).toHaveBeenCalledExactlyOnceWith(1);expect(select).not.toHaveBeenCalled()
 await f.act({action:'select',revision:result.revision,value:'dark'});expect(select).toHaveBeenCalledExactlyOnceWith(0)
 await f.act({action:'cancel',revision:result.revision});expect(cancel).toHaveBeenCalledOnce();expect(onCancel).not.toHaveBeenCalled()
 await f.act({action:'toggleSyntax',revision:result.revision});expect(toggle).toHaveBeenCalledOnce()
 cache[0]='env';const locked=await f.editor();expect(locked.snapshot.canToggleSyntax).toBe(false);await expect(f.act({action:'toggleSyntax',revision:locked.revision})).rejects.toThrow('unavailable')
 await expect(f.act({action:'preview',revision:locked.revision,value:'foreign'})).rejects.toThrow('unavailable')
 f.palette.mockReturnValueOnce({text:'#eeeeee',inverseText:'#111111'}).mockReturnValue({text:'#111111',inverseText:'#eeeeee'});await expect(f.editor()).rejects.toThrow('Theme changed while reading');f.palette.mockReturnValue({text:'#eeeeee',inverseText:'#111111'})
 f.formatText.mockImplementationOnce(async()=>{cache[72]={props:{onFocus:preview,onSelect:select}};return 'Dark mode'})
 await expect(f.editor()).rejects.toThrow('Theme changed while reading')
})

function modelFixture(){
 const f=fixture(),Model=function OriginalModel(){},Choice=function OriginalModelChoices(){},key=function OriginalModelKey(){},onSelect=vi.fn(),onCancel=vi.fn(),onChange=vi.fn(),onFocus=vi.fn((value:string)=>{focused=value}),adjust=vi.fn(),getFocus=()=>focused
 let focused='alpha'
 const effortBox={value:'high'},setEffort=function OriginalEffortSetter(){},getEffort=()=>effortBox.value
 const options=[{value:'alpha',label:'Alpha',description:'Original price'},{value:'beta',label:'Beta'},{value:'locked',label:'Unavailable',description:'Original eligibility',disabled:true}]
 f.setFunctionHash(Model,'c0cf4bcdab4f51bf2da39b356899e179c0a8f40f309822461c09d46c4a0e7040');f.setFunctionHash(Choice,'0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3');f.setFunctionHash(key,'09e2e0734b5e0da805593b8a45464256b7760e84204a62141ca8ca70f62cb566');f.setFunctionHash(adjust,'2bae149d18b9a99477ae1c8cb7fd72b19cbcc28c9f8258104aae644e911261cb');f.setFunctionHash(getFocus,'56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41')
 f.setFunctionHash(setEffort,'614e5f6e400f38931145513694025965d78b7003e49433d66ae369c535e3ee47');f.setFunctionHash(getEffort,'56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41')
 const controls={options,selectedValue:'alpha',defaultFocusValue:'alpha',onChange,onFocus,onCancel:vi.fn(),isDisabled:false}
 const detail:any={props:{children:{type:Symbol.for('react.fragment'),props:{children:'Native medium effort'}}}}
 const groups=[{props:{children:'Native model instructions'}},{props:{children:[false,{props:{children:[{type:Choice,props:controls}]} }]}},{props:{children:detail}},'Native fast-mode notice']
 const root={onKeyDown:key,children:[{props:{children:groups}}]},hook:any={memoizedState:[adjust,[options,getFocus,()=>{},setEffort]],next:{memoizedState:[setEffort,[effortBox]],next:{memoizedState:[getEffort,[effortBox]],next:null}}}
 const model:any={type:Model,memoizedProps:{onSelect,onCancel},child:{memoizedProps:root},memoizedState:hook};f.config.child=model;f.frame.panel.hidden=true
 f.formatText.mockImplementation(async(_n:unknown,value:unknown)=>typeof value==='string'?value:'Native effort details')
 return {f,model,root,controls,hook,detail,onSelect,onCancel,onChange,onFocus,adjust}
}
it('projects admitted native Model choices, focus/effort and notices without enabling search',async()=>{
 const {f,controls,detail,onFocus,onChange,onCancel,adjust}=modelFixture(),result=await f.editor()
 expect(result.snapshot).toMatchObject({kind:'choice',value:'alpha',disabled:false,model:{focusValue:'alpha',canAdjustEffort:true,draftEffort:'high',description:'Native effort details',fastModeNotice:'Native fast-mode notice'}})
 await f.act({action:'focusModel',revision:result.revision,value:'beta'});expect(onFocus).toHaveBeenCalledExactlyOnceWith('beta');expect(onChange).not.toHaveBeenCalled()
 let current=await f.editor();expect(current.snapshot.model.focusValue).toBe('beta')
 await f.act({action:'adjustEffort',revision:current.revision,direction:'left'});expect(adjust).toHaveBeenCalledExactlyOnceWith('left')
 await f.act({action:'select',revision:current.revision,value:'beta'});expect(onChange).toHaveBeenCalledExactlyOnceWith('beta')
 await f.act({action:'cancel',revision:current.revision});expect(onCancel).toHaveBeenCalledOnce();expect(controls.onCancel).not.toHaveBeenCalled()
 await expect(f.act({action:'focusModel',revision:current.revision,value:'locked'})).rejects.toThrow('unavailable')
 detail.props.children.type='unsupported';current=await f.editor();expect(current.snapshot.model.canAdjustEffort).toBe(false);await expect(f.act({action:'adjustEffort',revision:current.revision,direction:'right'})).rejects.toThrow('unavailable')
 controls.isDisabled=true;await expect(f.editor()).rejects.toThrow('search or controls changed')
})
it('refuses changed Model roots, ambiguous effort callbacks and replaced root props during reading',async()=>{
 const {f,model,hook}=modelFixture();model.memoizedProps.onSetDefault=()=>{};await expect(f.editor()).rejects.toThrow('root changed');delete model.memoizedProps.onSetDefault
 const rest=hook.next;hook.next={memoizedState:hook.memoizedState,next:rest};await expect(f.editor()).rejects.toThrow('not uniquely supported');hook.next=rest
 f.formatText.mockImplementationOnce(async()=>{model.child.memoizedProps={...model.child.memoizedProps};return 'retired label'})
 await expect(f.editor()).rejects.toThrow('changed while reading')
})

function consentFixture(){
 const f=fixture(),Consent=function OriginalExternalConsent(){},Modal=function OriginalDecisionModal(){},Choice=function OriginalConsentChoice(){},onDone=vi.fn(),write=vi.fn(),refuse=vi.fn(()=>false)
 ;(f.entry as any).settingsEditorKey='showExternalIncludesDialog';f.frame.panel.hidden=true
 f.setFunctionHash(Consent,'e0661d2d24d7b61a4282eb159eea4b35521c1631d1b6c7a4314348ba21da070c');f.setFunctionHash(Modal,'c7f64fe8a40a3b2d4a2c77c1de6de59efb101099f96aa474307a5802b93dd777');f.setFunctionHash(Choice,'0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3')
 let decided=false
 const decide=(value:boolean)=>{if(refuse()||decided)return;decided=true;write(value);onDone()},confirm=()=>decide(true),cancel=()=>decide(false),options=[{value:'cancel',label:'No, disable external imports'},{value:'confirm',label:'Yes, allow external imports'}]
 const modalProps={cancelFirst:true,focus:'cancel',refuseInput:refuse,openedAt:123,onConfirm:confirm,onCancel:cancel,cancelLabel:'No, disable external imports'},change=(value:string)=>value==='confirm'?confirm():cancel()
 const picker={type:Choice,props:{options,defaultFocusValue:'cancel',isDisabled:false,onChange:change,onCancel:cancel}},pc=Array(32)
 pc[21]=options;pc[22]=cancel;pc[23]=confirm;pc[24]=change;pc[31]=picker
 const modal={type:Modal,props:modalProps},view={props:{title:'Allow external CLAUDE.md file imports?',onCancel:cancel,children:['Original external import warning','Original external path disclosure','Original security note',modal]}},cache=Array(37),externalIncludes=[{path:'/outside/instructions.md',parent:'/project/CLAUDE.md'}]
 cache[4]=refuse;cache[5]=externalIncludes;cache[11]=onDone;cache[16]=cancel;cache[20]=confirm;cache[21]=cancel;cache[24]=123;cache[27]=modal;cache[36]=view
 const root:any={type:Consent,memoizedProps:{onDone,externalIncludes},updateQueue:{memoCache:{data:[cache]}},child:{type:Modal,memoizedProps:modalProps,updateQueue:{memoCache:{data:[pc]}},child:{type:Choice,memoizedProps:picker.props}}}
 f.config.child=root;return {...f,root,cache,pc,write,refuse,onDone}
}
it('preserves original external import disclosure, cancel-first choices and guarded decisions',async()=>{
 const f=consentFixture(),before=await f.editor()
 expect(before.snapshot.title).toBe('Allow external CLAUDE.md file imports?');expect(before.snapshot.consent.description).toContain('Original external path disclosure');expect(before.snapshot.consent.defaultFocusValue).toBe('cancel');expect(before.snapshot.options.map((option:any)=>option.value)).toEqual(['cancel','confirm'])
 expect(f.write).not.toHaveBeenCalled();expect(f.refuse).not.toHaveBeenCalled()
 f.refuse.mockReturnValue(true);await f.act({action:'select',revision:before.revision,value:'confirm'});expect(f.write).not.toHaveBeenCalled()
 f.refuse.mockReturnValue(false);await f.act({action:'select',revision:before.revision,value:'confirm'});expect(f.write).toHaveBeenCalledExactlyOnceWith(true);expect(f.onDone).toHaveBeenCalledOnce()
 await f.act({action:'select',revision:before.revision,value:'confirm'});expect(f.write).toHaveBeenCalledOnce()
 const g=consentFixture();await g.act({action:'cancel',revision:(await g.editor()).revision});expect(g.write).toHaveBeenCalledExactlyOnceWith(false)
})
it('rejects standalone consent, changed refusal guards, picker replacement and expired consent owners',async()=>{
 const f=consentFixture();f.root.memoizedProps.isStandaloneDialog=true;await expect(f.editor()).rejects.toThrow('consent changed')
 const g=consentFixture();g.cache[27].props.refuseInput=()=>false;await expect(g.editor()).rejects.toThrow('consent changed')
 const h=consentFixture();h.formatText.mockImplementationOnce(async()=>{h.pc[31]={...h.pc[31]};return 'retired'});await expect(h.editor()).rejects.toThrow('changed while reading')
 const i=consentFixture();const before=await i.editor();i.entry.closed=true;await expect(i.act({action:'select',revision:before.revision,value:'confirm'})).rejects.toThrow();expect(i.write).not.toHaveBeenCalled()
})
