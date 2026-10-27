import {claudeTerminalModelCreditRuntime} from './terminal-model-credit-runtime.ts'

/** Present the original /model picker, confirmations and pending controls in its owned dialog. */
export const claudeTerminalModelPanelRuntime = String.raw`
const nativeModelPanelHashes={
 root:['405f67fa75ab4e41349e4bafd0eca3af174269e4da6cbf7d885bcf7f9204e5a8','e9a70d794427a458bf683bc3c1c3178842ce05ad99cedb63cdb38efbd5288c90','d8afa7af196a50bd1800fbb9e233259b1fd00ea8b7669894e7ed387fa2e828f6','e59ca3065f14c5d3403916fbafb4f95722e8c415dcb366ec927a0a0bca676a48'],
 picker:['c0cf4bcdab4f51bf2da39b356899e179c0a8f40f309822461c09d46c4a0e7040','cc13401c36b04a99e33d816a7f89fa08eaad44657a2933747d41c1b839be8451'],
 confirm:['389f32eaccc6c469f0436869c3a7f3bfcffea57eb3b5d34078ee135f7714a6c0','14655f348975e2bb885ba0615778cff13526b89826d15e76cfad8f4ae4f3e288'],
 pending:['6910c14bfa13d96592e0ba08d1ab4b71dc00908e0478853182c606ff8443f786','a01dfaa7dbfa3ce9579b6c539c1c9561057f047a6d14941c3affae3ab1a00605'],
 credits:['504f383e60d828a4e21a6d606ae63de22de7bee656f5ce384a7ba423d91f83cf','385e89b554a9d862cc9899123dff7b2f50cbb75e2949cd1a0d1068428066d513'],
 choice:['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'],
};
const nativeModelPanelFunctionHashes=new WeakMap();
function nativeModelFunctionHash(fn){if(typeof fn!=='function')return;let hash=nativeModelPanelFunctionHashes.get(fn);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');nativeModelPanelFunctionHashes.set(fn,hash);}return hash;}
function nativeModelFibers(root){
 const pending=[root],seen=new Set(),result=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native model tree exceeded bound');seen.add(fiber);result.push(fiber);for(let child=fiber.child;child;child=child.sibling){if(pending.includes(child))throw Error('Native model tree contains a cycle');pending.push(child);}}
 return result;
}
function nativeModelPanelFrame(n,entry){
 entry.current();
 if(entry.closed||entry.answered||entry.commandName!=='model'||typeof entry.originalProps?.onDone!=='function'||!nativeModelPanelHashes.root.includes(nativeModelFunctionHash(entry.originalType)))throw Error('Native model panel expired or changed');
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const owners=nativeModelFibers(root).filter(fiber=>fiber.type===entry.originalType&&fiber.memoizedProps?.onDone===entry.originalProps.onDone);
 if(owners.length!==1)throw Error('Native model panel is not uniquely mounted');
 return owners[0];
}
${claudeTerminalModelCreditRuntime}
async function readNativeModelPanel(n,entry,signal){
 signal?.throwIfAborted();const owner=nativeModelPanelFrame(n,entry),fibers=nativeModelFibers(owner);
 const matches=[];
 for(const fiber of fibers){const hash=nativeModelFunctionHash(fiber.type),kind=['picker','confirm','pending','credits'].find(kind=>nativeModelPanelHashes[kind].includes(hash));if(kind)matches.push({kind,fiber,props:fiber.memoizedProps});}
 const active=matches.filter(match=>match.kind!=='credits'||!matches.some(other=>other.kind==='confirm'||other.kind==='pending'));
 if(active.length!==1)throw Error('Native model controls are not ready or supported');
 const match=active[0],p=match.props;
 const text=async value=>{const output=await awaitNativeSettingsReading(nativeGenericPermissionText(n,value),signal);if(typeof output!=='string'||output.length>65536)throw Error('Native model text exceeded bound');return stripVTControlCharacters(output);};
 let editor,controls,modelControl,cancel,confirm,credit,refreshPending=false;
 if(match.kind==='picker'){
  modelControl=nativeSettingsModelControl(match,true);controls=modelControl.controls;cancel=p.onCancel;
  const options=[],values=new Set();
  for(const option of controls.options){if(typeof option.value!=='string'||option.value.length>16384||values.has(option.value))throw Error('Native model option changed');values.add(option.value);options.push({value:option.value,label:await text(option.label),...option.description!=null?{description:await text(option.description),descriptionAnsi:await awaitNativeSettingsReading(nativeGenericPermissionText(n,option.description,true),signal)}:{},disabled:option.disabled===true});if(options.at(-1).descriptionAnsi?.length>65536)throw Error('Native model description exceeded bound');}
  editor={kind:'choice',title:'Select model',disabled:controls.isDisabled===true,options,...typeof controls.selectedValue==='string'?{value:controls.selectedValue}:{},model:{...modelControl.focusValue!==undefined?{focusValue:modelControl.focusValue}:{},...modelControl.draftEffort!==undefined?{draftEffort:modelControl.draftEffort}:{},description:await text(modelControl.description),effortText:await text(modelControl.detail),canAdjustEffort:modelControl.canAdjust,...modelControl.fastNotice?{fastModeNotice:await text(modelControl.fastNotice)}:{}}};
 }else if(match.kind==='pending'){
  if(typeof p.message!=='string'||typeof p.onCancel!=='function')throw Error('Native model pending control changed');
  cancel=p.onCancel;editor={kind:'information',title:'Model selection',description:await text(p.message)};refreshPending=true;
 }else if(match.kind==='credits'){
  credit=await readNativeModelCredits(n,entry,match,text,signal);({editor,controls,cancel,confirm,refreshPending}=credit);
 }else{
  let modal=match.fiber.child;
  for(let depth=0;modal&&depth<16&&!(typeof modal.memoizedProps?.title==='string'&&typeof modal.memoizedProps?.onCancel==='function');depth++)modal=modal.child;
  if(typeof modal?.memoizedProps?.title!=='string'||typeof modal.memoizedProps.onCancel!=='function')throw Error('Native model disclosure changed');
  const modalProps=modal.memoizedProps;cancel=modalProps.onCancel;
  if(match.kind==='confirm'){
   const confirmations=fibers.filter(fiber=>typeof fiber.memoizedProps?.confirmLabel==='string'&&typeof fiber.memoizedProps?.cancelLabel==='string'&&typeof fiber.memoizedProps?.onConfirm==='function'&&fiber.memoizedProps.onCancel===p.onCancel&&['confirm','cancel'].includes(fiber.memoizedProps.focus));
   if(confirmations.length!==1)throw Error('Native model confirmation is not uniquely mounted');
   const decision=confirmations[0].memoizedProps,body=modalProps.children?.props?.children;
   if(!Array.isArray(body)||body.length!==2)throw Error('Native model confirmation disclosure changed');
   confirm=decision.onConfirm;cancel=decision.onCancel;
   editor={kind:'choice',title:modalProps.title,disabled:false,options:[{value:'cancel',label:decision.cancelLabel,disabled:false},{value:'confirm',label:decision.confirmLabel,disabled:false}],consent:{description:[await text(modalProps.subtitle),await text(body[0])].filter(Boolean).join('\n'),cancelLabel:decision.cancelLabel,defaultFocusValue:decision.focus}};

  }
 }
 signal?.throwIfAborted();const current=nativeModelPanelFrame(n,entry),live=currentNativeSettingsFiber(current,match.fiber);
 if(!sameNativeSettingsFiber(current,owner)||live.memoizedProps!==p)throw Error('Native model changed while reading');
 credit?.current(current);
 const revision=createHash('sha256').update(JSON.stringify({editor,refreshPending,...credit?{dismissible:credit.dismissible}:{}})).digest('hex');
 return {snapshot:{revision,rows:[],editor:{...editor,revision},...refreshPending?{refreshPending:true}:{},...credit?{dismissible:credit.dismissible}:{}},owner,fiber:live,props:p,controls,modelControl,cancel,confirm,credit};
}
async function nativeModelPanel(n,entry,request,abort){
 if(request.operation==='read')return nativeModelPanelOperation(n,entry,request,abort);
 if(entry.modelOperation)throw Error('A native model action is pending');
 const operation={};entry.modelOperation=operation;
 try{return await nativeModelPanelOperation(n,entry,request,abort);}finally{if(entry.modelOperation===operation)delete entry.modelOperation;}
}
async function nativeModelPanelOperation(n,entry,request,abort){
 let before;const mountedUntil=Date.now()+1500;
 while(!before){try{before=await readNativeModelPanel(n,entry,abort.signal);}catch(error){abort.signal.throwIfAborted();entry.current();if(entry.closed||Date.now()>=mountedUntil||!String(error.message).includes('not uniquely mounted')&&!String(error.message).includes('not ready or supported'))throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
 if(request.operation==='read')return {snapshot:before.snapshot};
 if(request.operation!=='editor'||request.revision!==before.snapshot.revision||request.editor_revision!==before.snapshot.editor.revision)throw Error('Native model changed; refresh before editing');
 const command=request.command,editor=before.snapshot.editor;let callback,args=[];
 if(command?.action==='cancel'){if(before.credit?.refuseInput?.())throw Error('Claude Code is not accepting this model decision yet');callback=before.cancel;}
 else if(command?.action==='select'&&editor.kind==='choice'){
  const option=editor.options.find(option=>option.value===command.value);if(!option||option.disabled||editor.disabled)throw Error('Native model option is unavailable');
  const refuse=before.credit?.refuseInput??before.controls?.refuseInput;if(typeof refuse==='function'&&refuse())throw Error('Claude Code is not accepting this model decision yet');
  if(before.confirm)callback=command.value==='confirm'?before.confirm:before.cancel;
  else {callback=before.controls.onChange;args=[command.value];}
 }else if(command?.action==='focusModel'&&before.modelControl){if(!editor.options.some(option=>option.value===command.value&&!option.disabled))throw Error('Native model details are unavailable');callback=before.modelControl.controls.onFocus;args=[command.value];}
 else if(command?.action==='adjustEffort'&&before.modelControl?.canAdjust&&['left','right'].includes(command.direction)){callback=before.modelControl.adjust;args=[command.direction];}
 if(command?.action==='save'&&before.credit?.form)return saveNativeModelCreditForm(n,entry,before,command.values,abort.signal);
 if(typeof callback!=='function')throw Error('Native model action is unavailable');
 abort.signal.throwIfAborted();const owner=nativeModelPanelFrame(n,entry),live=currentNativeSettingsFiber(owner,before.fiber);
 if(!sameNativeSettingsFiber(owner,before.owner)||live.memoizedProps!==before.props)throw Error('Native model changed before the action');
 before.credit?.current(owner);
 await awaitNativeSettingsReading(callback(...args),abort.signal);
 return afterNativeModelAction(n,entry,before,abort.signal);
}
async function afterNativeModelAction(n,entry,before,signal){
 const deadline=Date.now()+500;
 while(!entry.closed){try{const after=await readNativeModelPanel(n,entry,signal);if(after.snapshot.revision!==before.snapshot.revision||Date.now()>=deadline)return {snapshot:after.snapshot};}catch(error){signal.throwIfAborted();if(Date.now()>=deadline)throw error;}await new Promise(resolve=>setTimeout(resolve,20));}
 return {snapshot:before.snapshot};
}
`
