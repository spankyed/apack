import {createHash as hash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {claudeTerminalSettingsRuntime} from '#features/code/be/services/claude-code/terminal-settings-runtime.ts'
import {claudeSettingsSnapshot} from '#features/code/common/native-settings.ts'

// Authored component doubles; recovered vendor functions are never executed in these unit tests.
const hashes={"purchase":"0906db370d45290c9b4083fbd3e873f174a74a9e9e1bc6fbad7bdc8359b292fa","admin":"cab1f72231e70b850f08407699d300878d571c548e6b6029dc57e44323a032ab","purchaseState":"fbac9686170ff3ab8b9f9b8f20d83b38fbed7f8bfbeeace2e4efd7df731cb13d","error":"f3ff348f7d1a370b4536dc5ab296a22bdfd019bcc24667219dec9cb1fbf00a3a","bundles":"8a8a1d5a2ab3ff3bac0c0dc289085c45fe6f27719f3ace279d2f8eccb627c598","quote":"21606cc022bcb4b9922ddaf35717cc1fb5a6fbf72239548682238917e99a7352","custom":"006fc145844b84a7a194debf37f4b45cc2de16bf2a40f30f59ad51e73426d7c4","polling":"f59e60934afe94e192a16ea80e8c82af56ba0e4173c4ca6bb9a8af3e27e75063","success":"fcaf327cac916530a62ada2644520018e693463ed395d6a5a5904bb3ac710199","charge":"b996fe2d447d523db0d24dee7cf857be60744b76f5374313c29bf430a363170a","amount":"926846743b72ce0b0abee6a10cdd9267d02eb633952b2b97912a9b4b05ac5a04","selectState":"c56325760953719a87f1c8604b3c1e09832b32b94154c60d4fb82c7d2827be7f","plainSelect":"e53297200fcc89a19d65b4d7f50123c6aed6f916c7cc94acf242348de025b8f9"}
function fixture(kind:'amount'|'charge'|'admin'|'admin-pending'|'bundles'|'quote'|'processing',accessible=false){
 function root(){} function credits(){} function purchaseState(){} function amount(){} function charge(){} function admin(){} function bundles(){} function quote(){} function selectState(){} function plainSelect(){} function selector(){} function input(){} function modal(){}
 const functions={purchaseState,amount,charge,admin,bundles,quote,selectState,plainSelect},known=new Map<string,string>([[String(root),'405f67fa75ab4e41349e4bafd0eca3af174269e4da6cbf7d885bcf7f9204e5a8'],[String(credits),'504f383e60d828a4e21a6d606ae63de22de7bee656f5ce384a7ba423d91f83cf'],[String(selector),'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5']])
 for(const [name,fn]of Object.entries(functions))known.set(String(fn),hashes[name as keyof typeof hashes])
 let active=true,closed=false,value='75',refused=false,afterChange:(()=>void)|undefined,beforeText:(()=>void)|undefined
 const confirm=vi.fn(()=>{closed=true}),cancel=vi.fn(()=>{closed=true}),change=vi.fn((next:string)=>{queueMicrotask(()=>{value=next;renderInput();afterChange?.()})}),submit=vi.fn((_next:string)=>{if(value==='confirm'){closed=true;confirm()}}),select=vi.fn((_next:string)=>{closed=true})
 const onDone=vi.fn(),id='11111111-1111-4111-8111-111111111111',entry={kind:'panel',commandName:'model',clientId:'owned',nodeId:'node',dialogId:'dialog',originalType:root,originalProps:{onDone},get closed(){return closed},answered:false,current:()=>{if(!active)throw Error('Native view changed')},store:{getState:()=>({open:closed?[]:[{id:'dialog',kind:'local_jsx',payload:{nodeId:'node'}}]})}}
 const props={onCancel:cancel,onBack:cancel},control:any={type:kind==='charge'?charge:amount,memoizedProps:props},cache:any[]=Array(kind==='charge'?30:51)
 control.updateQueue={memoCache:{data:[cache]}}
 function renderInput(){
  const feedback={props:{color:'success',children:'Original preview: '+value}},nativeInput={type:input,props:{value,onChange:change,onSubmit:submit,onExit:cancel}},body={props:{children:[{props:{children:'Original amount and consent disclosure'}},nativeInput,feedback]}}
  cache[kind==='charge'?11:38]=feedback
  const view={type:modal,props:{title:kind==='charge'?'Confirm amount':'Buy usage credits',onCancel:cancel,children:body}}
  cache[kind==='charge'?19:28]=nativeInput;cache[kind==='charge'?29:50]=view;cache[kind==='charge'?13:14]=submit
  control.child={type:modal,memoizedProps:view.props,child:{type:input,memoizedProps:nativeInput.props}}
 }
 renderInput()
 const state={s:kind.startsWith('admin')?'confirm-admin-request':'buy'},credit:any={type:credits,memoizedProps:{},memoizedState:{memoizedState:state,next:null}}
 const purchase:any={type:purchaseState,memoizedProps:{initialStep:'buy_select',entryReason:'fable',step:{s:kind==='amount'?'buy_custom':kind==='processing'?'buy_purchasing':kind==='bundles'?'buy_select':'buy_confirm'}},child:control}
 const options=[{value:'p0',label:'Native bundle',description:'Save 10%',disabled:false},{value:'cancel',label:'Cancel',disabled:false}],selection={focusedValue:'cancel'},pickerProps={options,onChange:select,onCancel:cancel},selectorFiber:any={type:selector,memoizedProps:pickerProps},binding={options,state:selection},selectCache:any[]=Array(84);selectCache[15]={options};selectCache[36]=binding
 const plainCache:any[]=Array(73);plainCache[47]=options;plainCache[44]=null
 selectorFiber.child={type:accessible?plainSelect:selectState,memoizedProps:pickerProps,updateQueue:{memoCache:{data:[accessible?plainCache:selectCache]}}}
 const modalProps={title:'Buy usage credits',onCancel:cancel,children:{props:{children:[{props:{children:'Original purchase disclosure'}},{type:selector,props:pickerProps}]}}}
 if(kind==='bundles'){purchase.child={type:bundles,memoizedProps:props,child:{type:modal,memoizedProps:modalProps,child:selectorFiber}}}
 if(kind==='quote'){
  options.splice(0,options.length,{value:'yes',label:'Pay (calculating…)',description:'',disabled:true},{value:'no',label:'Go back',description:'',disabled:false});selection.focusedValue='no'
  const costs={props:{children:[{props:{label:'Subtotal',value:'$75'}},{props:{label:'Tax',value:'…'}},{props:{label:'Total due',value:'…'}}]}},body=[costs,{props:{children:'Payment: original card'}},null,{type:selector,props:pickerProps},{props:{children:'Original charge agreement'}}],view={type:modal,props:{title:'Buy usage credits',onCancel:cancel,children:{props:{children:body}}}},quoteCache:any[]=Array(82)
  quoteCache[13]=options;quoteCache[70]=body[3];quoteCache[81]=view;purchase.child={type:quote,memoizedProps:props,updateQueue:{memoCache:{data:[quoteCache]}},child:{type:modal,memoizedProps:view.props,child:selectorFiber}}
 }
 if(kind==='charge')purchase.child={type:quote,memoizedProps:props,child:control}
 if(kind==='processing')purchase.child={type:'progress',memoizedProps:{message:'Processing payment…'}}
 if(kind.startsWith('admin')){
  const decision={confirmLabel:'Send request',cancelLabel:'Cancel',focus:'cancel',onConfirm:confirm,onCancel:cancel,refuseInput:()=>refused},view={type:modal,props:{title:'Request usage credits',onCancel:cancel,children:{props:{children:[{props:{children:'Your admins receive this request.'}},{props:{children:'Original notification warning. https://support.example.test/usage-credits'}},{type:'decision',props:decision}]}}}},adminCache:any[]=Array(50)
  adminCache[41]={props:decision};adminCache[49]=view
  credit.child={type:admin,memoizedProps:{wouldTakeAnswer:()=>true},updateQueue:{memoCache:{data:[adminCache]}},child:kind==='admin-pending'?{type:'progress',memoizedProps:{message:'Sending request to your admin…'}}:{type:modal,memoizedProps:view.props}}
 }else credit.child=purchase
 const owner:any={type:root,memoizedProps:entry.originalProps,child:credit},render=(node:any):string=>node==null?'':Array.isArray(node)?node.map(render).join('\n'):typeof node==='object'?render(node.props?.children):String(node)
 const api=runInNewContext(claudeTerminalSettingsRuntime+';({nativeSettings})',{
  process:{stdout:{}},setTimeout,clearTimeout,AbortController,URL,agentCommandDialogs:new Map([[id,entry]]),stripVTControlCharacters:(value:string)=>value,
  createHash:()=>({value:'',update(value:string){this.value=value;return this},digest(){return known.get(this.value)??hash('sha256').update(this.value).digest('hex')}}),
  nativeGenericPermissionText:async(_n:unknown,node:unknown)=>{beforeText?.();return render(node)},
 }) as {nativeSettings(n:unknown,request:unknown,abort:AbortController):Promise<{snapshot:any}>}
 const n={gate:{_Jo:vi.fn(async()=>{})},themeRoots:{ai:()=>({get:()=>({container:{current:owner}})})}},read=()=>api.nativeSettings(n,{client_id:'owned',panel_id:id,operation:'read'},new AbortController()),act=(snapshot:any,command:unknown)=>api.nativeSettings(n,{client_id:'owned',panel_id:id,operation:'editor',revision:snapshot.revision,editor_revision:snapshot.editor.revision,command},new AbortController())
 return {read,act,confirm,cancel,change,submit,select,options,state,cache,control,rotateCredit:(replacement=state)=>{const previous=owner.child,current={...previous,memoizedState:{memoizedState:replacement,next:null},alternate:previous};previous.alternate=current;previous.memoizedState=null;owner.child=current},setRefused:(next:boolean)=>{refused=next},retire:()=>{active=false},afterChange:(fn:()=>void)=>{afterChange=fn},beforeText:(fn:()=>void)=>{beforeText=fn}}
}

it('acknowledges the original amount draft before native validation and never substitutes a charge callback',async()=>{
 const f=fixture('amount'),{snapshot}=await f.read();expect(claudeSettingsSnapshot.parse(snapshot).editor).toMatchObject({kind:'form',fields:[{key:'answer',value:'75'}]})
 const after=await f.act(snapshot,{action:'save',values:{answer:'not a valid amount'}})
 expect(f.change).toHaveBeenCalledExactlyOnceWith('not a valid amount');expect(f.submit).toHaveBeenCalledExactlyOnceWith('not a valid amount');expect(f.confirm).not.toHaveBeenCalled();expect(after.snapshot.editor.fields[0].value).toBe('not a valid amount')
})
it('uses the original final typed confirmation and retires its action after completion',async()=>{
 const f=fixture('charge'),{snapshot}=await f.read();expect(snapshot.editor.title).toBe('Confirm amount')
 await f.act(snapshot,{action:'save',values:{answer:'confirm'}});expect(f.submit).toHaveBeenCalledExactlyOnceWith('confirm');expect(f.confirm).toHaveBeenCalledOnce()
 await expect(f.act(snapshot,{action:'save',values:{answer:'confirm'}})).rejects.toThrow('expired');expect(f.confirm).toHaveBeenCalledOnce()
})
it('refuses submission after native ownership retires during draft acknowledgement',async()=>{
 const f=fixture('amount'),{snapshot}=await f.read();f.afterChange(f.retire)
 await expect(f.act(snapshot,{action:'save',values:{answer:'100'}})).rejects.toThrow('Native view changed');expect(f.submit).not.toHaveBeenCalled()
})
it('preserves cancel-first admin disclosure and original refusal for both actions',async()=>{
 const f=fixture('admin'),{snapshot}=await f.read();expect(claudeSettingsSnapshot.parse(snapshot).editor).toMatchObject({kind:'choice',consent:{defaultFocusValue:'cancel',description:expect.stringContaining('Your admins'),links:['https://support.example.test/usage-credits']}})
 f.setRefused(true);await expect(f.act(snapshot,{action:'select',value:'confirm'})).rejects.toThrow('not accepting');await expect(f.act(snapshot,{action:'cancel'})).rejects.toThrow('not accepting');expect(f.confirm).not.toHaveBeenCalled();expect(f.cancel).not.toHaveBeenCalled()
 f.setRefused(false);await f.act(snapshot,{action:'select',value:'confirm'});expect(f.confirm).toHaveBeenCalledOnce()
})
it('does not resurrect a cached admin confirmation while the original request is sending',async()=>{
 const f=fixture('admin-pending'),{snapshot}=await f.read();expect(claudeSettingsSnapshot.parse(snapshot)).toMatchObject({dismissible:false,refreshPending:true,editor:{kind:'information',description:'Sending request to your admin…'}})
 await expect(f.act(snapshot,{action:'cancel'})).rejects.toThrow('unavailable');expect(f.cancel).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled()
})
it('retains source bundle focus and refuses stale disabled choices',async()=>{
 const f=fixture('bundles'),{snapshot}=await f.read();expect(snapshot.editor.consent.defaultFocusValue).toBe('cancel');expect(snapshot.editor.options[0].description).toBe('Save 10%')
 f.options[0].disabled=true;await expect(f.act(snapshot,{action:'select',value:'p0'})).rejects.toThrow('changed');expect(f.select).not.toHaveBeenCalled()
})
it('preserves the native tax gate and semantic quote rows without exposing a premature Pay action',async()=>{
 const f=fixture('quote'),{snapshot}=await f.read();expect(claudeSettingsSnapshot.parse(snapshot)).toMatchObject({refreshPending:true,editor:{consent:{defaultFocusValue:'no',description:expect.stringContaining('Total due: …')},options:[{value:'yes',disabled:true},{value:'no',disabled:false}]}})
 await expect(f.act(snapshot,{action:'select',value:'yes'})).rejects.toThrow('unavailable');expect(f.select).not.toHaveBeenCalled()
})
it('does not add a cancellation callback while the original payment is processing',async()=>{
 const f=fixture('processing'),{snapshot}=await f.read();expect(snapshot).toMatchObject({dismissible:false,refreshPending:true,editor:{description:'Processing payment…'}})
 await expect(f.act(snapshot,{action:'cancel'})).rejects.toThrow('unavailable');expect(f.cancel).not.toHaveBeenCalled()
})
it('rejects a credit branch replaced while rendering its disclosure',async()=>{
 const f=fixture('admin');f.beforeText(()=>{f.state.s='loading'});await expect(f.read()).rejects.toThrow('state changed while reading');expect(f.confirm).not.toHaveBeenCalled()
})

it('preserves no focused option in the original accessible selector while retaining explicit choice admission',async()=>{
 const f=fixture('bundles',true),{snapshot}=await f.read();expect(claudeSettingsSnapshot.parse(snapshot).editor).toMatchObject({kind:'choice'});expect(snapshot.editor.consent.defaultFocusValue).toBeUndefined()
 await f.act(snapshot,{action:'select',value:'p0'});expect(f.select).toHaveBeenCalledExactlyOnceWith('p0')
})

it('updates original live amount feedback without submitting or charging',async()=>{
 const f=fixture('amount'),{snapshot}=await f.read(),id=snapshot.editor.live.id
 const after=await f.act(snapshot,{action:'change',formId:id,key:'answer',value:'100'})
 expect(claudeSettingsSnapshot.parse(after.snapshot).editor).toMatchObject({kind:'form',live:{id,feedback:{text:'Original preview: 100',tone:'success'}},fields:[{key:'answer',value:'100'}]})
 expect(f.change).toHaveBeenCalledExactlyOnceWith('100');expect(f.submit).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled()
})
it('never treats a valid typed charge draft as confirmation',async()=>{
 const f=fixture('charge'),{snapshot}=await f.read();await f.act(snapshot,{action:'change',formId:snapshot.editor.live.id,key:'answer',value:'confirm'})
 expect(f.submit).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled()
})
it('rejects a foreign live form identity before invoking any native field callback',async()=>{
 const f=fixture('amount'),{snapshot}=await f.read();await expect(f.act(snapshot,{action:'change',formId:'foreign',key:'answer',value:'100'})).rejects.toThrow('invalid')
 expect(f.change).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled()
})

it('follows the mounted credit parent after React commits its alternate during disclosure reads',async()=>{
 const f=fixture('amount');let rotated=false
 f.beforeText(()=>{if(!rotated){rotated=true;f.rotateCredit()}})
 const {snapshot}=await f.read();expect(snapshot.editor.fields[0].value).toBe('75')
 const after=await f.act(snapshot,{action:'change',formId:snapshot.editor.live.id,key:'answer',value:'100'})
 expect(after.snapshot.editor.fields[0].value).toBe('100');expect(f.submit).not.toHaveBeenCalled()
})
it('rejects an alternate credit parent whose native state actually changed',async()=>{
 const f=fixture('amount');let rotated=false
 f.beforeText(()=>{if(!rotated){rotated=true;f.rotateCredit({s:'loading'})}})
 await expect(f.read()).rejects.toThrow('state changed while reading');expect(f.change).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled()
})
