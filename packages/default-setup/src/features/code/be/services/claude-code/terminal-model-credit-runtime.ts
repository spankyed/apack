/** Project native credit purchase/admin controls without replacing validation or charge consent. */
export const claudeTerminalModelCreditRuntime = String.raw`
const nativeModelCreditHashes={"purchase":["0906db370d45290c9b4083fbd3e873f174a74a9e9e1bc6fbad7bdc8359b292fa","38872e5c268f687bc64c2da1f0e0f824f2fa436e647a73b8372a2309d3a15f71"],"purchaseState":["fbac9686170ff3ab8b9f9b8f20d83b38fbed7f8bfbeeace2e4efd7df731cb13d","b7f8398a93910afa8c1785144b2d38bd8d8ec79ecf74aa52a0f49fe56b59f4bc"],"admin":["cab1f72231e70b850f08407699d300878d571c548e6b6029dc57e44323a032ab","e3cb196ad0ace6a79116497cd6f49e99ea192d056357fe9ed4428730a674f522"],"bundles":["8a8a1d5a2ab3ff3bac0c0dc289085c45fe6f27719f3ace279d2f8eccb627c598","cf5f724fe224d0467bd7f426154ff251ceab533c54c7e407e30a71f6bb779bc1"],"quote":["21606cc022bcb4b9922ddaf35717cc1fb5a6fbf72239548682238917e99a7352","6d067be0d363639f0951fb41868089175456b34791a6c37282696d6a961e67c6"],"custom":["006fc145844b84a7a194debf37f4b45cc2de16bf2a40f30f59ad51e73426d7c4","2513ec1e892fe0fe54215aa60440bb5f86bd8c058295e30fb79b6dd2c29a8d4c"],"charge":["b996fe2d447d523db0d24dee7cf857be60744b76f5374313c29bf430a363170a","9e02bd33c159c47b59029b81984909a7d12c16e959afe1cb334670f0e2d5a626"],"amount":["926846743b72ce0b0abee6a10cdd9267d02eb633952b2b97912a9b4b05ac5a04","094e84321f129b5db1647eed1f5346b2c1492082d7bcbd58188af460852c215e"],"error":["f3ff348f7d1a370b4536dc5ab296a22bdfd019bcc24667219dec9cb1fbf00a3a","ae82fde308cd669761b5334ce702179763209494f873a017356efa2d5c21fc8a"],"success":["fcaf327cac916530a62ada2644520018e693463ed395d6a5a5904bb3ac710199","044bde4fe1cb962f118a69209e5a8fe6ac1fa72abb7ff88d4c3d2dcb438cb9ce"],"polling":["f59e60934afe94e192a16ea80e8c82af56ba0e4173c4ca6bb9a8af3e27e75063","62f5d3a1c09f76c4f713bcaba82f2ecc51a1a7ecc96fdac43ea0845cb18b0ec7"],"selectState":["c56325760953719a87f1c8604b3c1e09832b32b94154c60d4fb82c7d2827be7f","0e3a0b249f0ad8984c48e54f17a8e5837131405e6c6c2a383cfe5c2bf548b080"],"plainSelect":["e53297200fcc89a19d65b4d7f50123c6aed6f916c7cc94acf242348de025b8f9","0f809d03a106429dd4fb3012e1b70bab5306affb204fab886ead1b8cb8a1c03a"]};
function nativeModelCreditState(fiber){
 const seen=new Set(),states=[];let hook=fiber.memoizedState;
 while(hook){if(seen.has(hook)||seen.size>=512)throw Error('Native credit state exceeded bound');seen.add(hook);const state=hook.memoizedState;if(state&&typeof state==='object'&&typeof state.s==='string')states.push(state);hook=hook.next;}
 if(states.length!==1)throw Error('Native credit state changed (found '+states.length+' tagged states)');return states[0];
}
function nativeModelCreditCache(match,size){
 const caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===size);
 if(caches?.length!==1)throw Error('Native credit cache changed');return caches[0];
}
function nativeModelCreditPrune(value,omit){
 let count=0;function visit(node){if(++count>4096)throw Error('Native credit disclosure exceeded bound');if(Array.isArray(node))return node.map(visit);if(node&&typeof node==='object'&&node.props){if(omit(node))return null;if(Object.hasOwn(node.props,'children'))return {...node,props:{...node.props,children:visit(node.props.children)}};}return node;}return visit(value);
}
function nativeModelCreditLinks(value){
 const links=new Set();let count=0;
 function visit(node){
  if(++count>4096)throw Error('Native credit link disclosure exceeded bound');
  if(Array.isArray(node)){for(const child of node)visit(child);return;}
  if(typeof node==='string'){for(const match of stripVTControlCharacters(node).matchAll(/https?:\/\/[^\s<>"()]+/g))add(match[0]);return;}
  if(node&&typeof node==='object'&&node.props){add(node.props.url);add(node.props.href);if(Object.hasOwn(node.props,'children'))visit(node.props.children);}
 }
 function add(url){if(typeof url!=='string')return;if(url.length>4096)throw Error('Native credit link exceeded bound');const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('Native credit link protocol changed');links.add(url);if(links.size>16)throw Error('Native credit link count exceeded bound');}
 visit(value);return [...links];
}
function nativeModelCreditModal(fiber){
 let modal=fiber.child;
 for(let depth=0;modal&&depth<16;depth++,modal=modal.child)if(typeof modal.memoizedProps?.title==='string'&&typeof modal.memoizedProps.onCancel==='function')return modal;
 throw Error('Native credit modal changed');
}
async function readNativeModelCredits(n,entry,match,text,signal){
 const state=nativeModelCreditState(match.fiber),stateKind=state.s,nodes=nativeModelFibers(match.fiber),anchors=[],checks=[];
 const track=fiber=>{anchors.push({fiber,props:fiber.memoizedProps});return {fiber,props:fiber.memoizedProps};};
 const find=(role,required=true)=>{const found=nodes.filter(fiber=>nativeModelCreditHashes[role].includes(nativeModelFunctionHash(fiber.type)));if(found.length>1||required&&found.length!==1)throw Error('Native credit '+role+' control is not uniquely mounted');return found[0]?track(found[0]):undefined;};
 const message=async node=>{const lines=Array.isArray(node)?await Promise.all(node.map(text)):[await text(node)];return lines.filter(Boolean).join('\n');};
 let editor,controls,cancel,confirm,form,refuseInput,refreshPending=false;
 async function information(fiber,title){
  const child=nativeModelFibers(fiber).find(item=>item!==fiber&&typeof item.memoizedProps?.message==='string'),p=child?.memoizedProps;
  if(typeof p?.message!=='string')throw Error('Native credit progress changed');track(child);editor={kind:'information',title,description:await text(p.message)};refreshPending=true;
 }
 async function choice(fiber,modal,body,kind){
  const choices=nativeModelFibers(fiber).filter(item=>nativeModelPanelHashes.choice.includes(nativeModelFunctionHash(item.type))&&Array.isArray(item.memoizedProps?.options)&&typeof item.memoizedProps.onChange==='function'&&item.memoizedProps.onCancel===modal.onCancel);
  if(choices.length!==1)throw Error('Native credit choices are not uniquely mounted');const picker=track(choices[0]);controls=picker.props;cancel=modal.onCancel;refuseInput=controls.refuseInput;
  const values=new Set(),options=[];
  if(controls.options.length>256||controls.options.length===0)throw Error('Native credit option count changed');
  for(const option of controls.options){if(typeof option.value!=='string'||option.value.length>16384||values.has(option.value))throw Error('Native credit option changed');values.add(option.value);options.push({value:option.value,label:await text(option.label),...option.description!=null?{description:await text(option.description)}:{},disabled:option.disabled===true});}
  let focused;
  const standard=nativeModelFibers(picker.fiber).filter(item=>nativeModelCreditHashes.selectState.includes(nativeModelFunctionHash(item.type))),plain=nativeModelFibers(picker.fiber).filter(item=>nativeModelCreditHashes.plainSelect.includes(nativeModelFunctionHash(item.type)));
  if(standard.length+plain.length!==1)throw Error('Native credit focus state is not uniquely mounted');
  if(standard.length){
   const selection=track(standard[0]),cache=nativeModelCreditCache(selection,84),binding=cache[36];
   if(binding?.options!==controls.options||cache[15]?.options!==controls.options||!binding.state)throw Error('Native credit focus binding changed');
   focused=binding.state.focusedValue;checks.push(()=>{if(cache[36]!==binding||binding.state.focusedValue!==focused)throw Error('Native credit focus changed while reading');});
  }else{
   const selection=track(plain[0]),cache=nativeModelCreditCache(selection,73),position=cache[44];
   if(cache[47]!==controls.options||position!==null&&(!Number.isInteger(position)||position<0||position>=controls.options.length))throw Error('Native accessible credit focus changed');
   focused=position===null?undefined:controls.options[position].value;checks.push(()=>{if(cache[44]!==position||cache[47]!==controls.options)throw Error('Native accessible credit focus changed while reading');});
  }
  if(focused!==undefined&&!values.has(focused))throw Error('Native credit default focus changed');
  const disclosure=nativeModelCreditPrune(body,node=>node.type===picker.fiber.elementType&&node.props===controls||node.type===picker.fiber.type&&node.props===controls);
  editor={kind:'choice',title:modal.title,disabled:controls.isDisabled===true||controls.disableSelection===true,options,...typeof controls.selectedValue==='string'?{value:controls.selectedValue}:{},consent:{description:await message(disclosure),links:nativeModelCreditLinks(disclosure),cancelLabel:options.find(option=>['cancel','no','switch'].includes(option.value))?.label??'Cancel',...focused!==undefined?{defaultFocusValue:focused}:{}}};
  if(kind==='quote'&&options.some(option=>option.value==='yes'&&option.disabled))refreshPending=true;
 }
 async function typed(control,kind){
  const size=kind==='charge'?30:51,cache=nativeModelCreditCache(control,size),input=cache[kind==='charge'?19:28],modal=cache[kind==='charge'?29:50],p=input?.props;
  const expectedCancel=kind==='charge'?control.props.onBack:control.props.onCancel;
  if(!p||typeof p.value!=='string'||p.value.length>16384||typeof p.onChange!=='function'||typeof p.onSubmit!=='function'||p.onExit!==expectedCancel||typeof expectedCancel!=='function'||modal?.props?.onCancel!==expectedCancel||p.onSubmit!==cache[kind==='charge'?13:14])throw Error('Native credit form callbacks changed');
  const inputs=nativeModelFibers(control.fiber).filter(fiber=>(fiber.type===input.type||fiber.elementType===input.type)&&fiber.memoizedProps===p);
  if(inputs.length!==1)throw Error('Native credit input is not uniquely mounted');track(inputs[0]);cancel=expectedCancel;
  const feedbackNode=kind==='charge'?['error','success'].includes(cache[11]?.props?.color)?cache[11]:undefined:cache[40]||cache[38]||undefined;
  const feedback=feedbackNode?{text:await text(feedbackNode),tone:kind==='charge'?feedbackNode.props.color:cache[40]?'error':'success'}:undefined;
  const disclosure=nativeModelCreditPrune(modal.props.children,node=>node.type===input.type&&node.props===p||node===feedbackNode);
  entry.creditFormIds??=new WeakMap();let formId=entry.creditFormIds.get(control.fiber)??(control.fiber.alternate&&entry.creditFormIds.get(control.fiber.alternate));
  if(!formId){entry.creditFormSequence=(entry.creditFormSequence??0)+1;formId=String(entry.creditFormSequence);}entry.creditFormIds.set(control.fiber,formId);if(control.fiber.alternate)entry.creditFormIds.set(control.fiber.alternate,formId);
  editor={kind:'form',live:{id:formId,...feedback?{feedback}:{}},title:modal.props.title,description:await message(disclosure),submitLabel:kind==='charge'?'Confirm purchase':'Continue',fields:[{key:'answer',label:kind==='charge'?'Confirmation':'Amount',value:p.value}],consent:{cancelLabel:'Cancel',focusField:'answer',links:nativeModelCreditLinks(disclosure)}};
  form={id:formId,fiber:control.fiber,input:p,kind};checks.push(()=>{if(!control.fiber.updateQueue?.memoCache?.data?.includes(cache)||cache[kind==='charge'?19:28]!==input||cache[kind==='charge'?29:50]!==modal)throw Error('Native credit form changed while reading');});
 }
 if(state.s==='buy'){
  const purchase=find('purchaseState');if(purchase.props.initialStep!=='buy_select'||purchase.props.entryReason!=='fable')throw Error('Native model credit purchase entry changed');
  const step=purchase.props.step;if(!step||typeof step.s!=='string')throw Error('Native purchase step changed');
  if(step.s==='buy_custom')await typed(find('amount'),'amount');
  else if(step.s==='buy_confirm'){
   const quote=find('quote'),charge=find('charge',false);
   if(charge)await typed(charge,'charge');
   else{
    const cache=nativeModelCreditCache(quote,82),modal=cache[81],picker=cache[70],body=modal?.props?.children?.props?.children;
    if(modal?.props?.onCancel!==quote.props.onCancel||picker?.props?.onCancel!==quote.props.onCancel||picker?.props?.options!==cache[13]||!Array.isArray(body)||body.length!==5)throw Error('Native purchase quote changed');
    const lineItems=[];nativeModelCreditPrune(body[0],node=>{if(typeof node.props?.label==='string'&&Object.hasOwn(node.props,'value')){lineItems.push(node.props);return true;}return false;});
    if(lineItems.length<3||lineItems.length>8)throw Error('Native purchase quote line items changed');
    const lines=[];for(const item of lineItems)lines.push((await text(item.label))+': '+await text(item.value));
    const tail=body.slice(1);await choice(quote.fiber,modal.props,tail,'quote');editor.consent.description=lines.join('\n')+'\n'+editor.consent.description;
    checks.push(()=>{if(cache[81]!==modal||cache[70]!==picker)throw Error('Native purchase quote changed while reading');});
   }
  }else if(step.s==='buy_select'){
   const bundles=find('bundles'),modal=track(nativeModelCreditModal(bundles.fiber));await choice(bundles.fiber,modal.props,modal.props.children,'bundles');
  }else if(step.s==='error'){
   const error=find('error'),cache=nativeModelCreditCache(error,9),modal=cache[8],open=cache[1]?.['confirm:yes'],guide=cache[3]?.props?.children,openLabel=guide?.[0]?.props?.action;
   if(typeof error.props.onClose!=='function'||modal?.props.onCancel!==error.props.onClose||typeof open!=='function'||typeof openLabel!=='string')throw Error('Native purchase error changed');cancel=error.props.onClose;confirm=open;
   editor={kind:'choice',title:modal.props.title,disabled:false,options:[{value:'cancel',label:'Cancel',disabled:false},{value:'confirm',label:openLabel,disabled:false}],consent:{description:await text(modal.props.children),cancelLabel:'Cancel',defaultFocusValue:'cancel'}};
   checks.push(()=>{if(cache[8]!==modal||cache[1]?.['confirm:yes']!==open)throw Error('Native purchase error changed while reading');});
  }else if(step.s==='buy_success'){
   const success=find('success');editor={kind:'information',title:'Usage credits',description:await text(success.props.message)};refreshPending=true;
  }else if(['loading','buy_purchasing','buy_polling'].includes(step.s)){
   if(step.s==='buy_polling'){const polling=find('polling');await information(polling.fiber,'Usage credits');}
   else await information(purchase.fiber,'Usage credits');
  }else throw Error('Native model purchase step is unsupported');
 }else if(state.s==='confirm-admin-request'){
  const admin=find('admin'),cache=nativeModelCreditCache(admin,50),modal=cache[49];
  const mountedModal=modal&&nativeModelFibers(admin.fiber).find(fiber=>(fiber.type===modal.type||fiber.elementType===modal.type)&&fiber.memoizedProps===modal.props);
  if(!mountedModal){await information(admin.fiber,'Usage credits');}
  else{
   track(mountedModal);const decision=cache[41]?.props,body=modal.props.children?.props?.children;
   if(typeof decision?.onConfirm!=='function'||typeof decision.onCancel!=='function'||typeof decision.refuseInput!=='function'||decision.focus!=='cancel'||modal.props.onCancel!==decision.onCancel||!Array.isArray(body)||body.length!==3)throw Error('Native admin confirmation changed');
   cancel=decision.onCancel;confirm=decision.onConfirm;refuseInput=decision.refuseInput;
   editor={kind:'choice',title:modal.props.title,disabled:false,options:[{value:'cancel',label:decision.cancelLabel,disabled:false},{value:'confirm',label:decision.confirmLabel,disabled:false}],consent:{description:await message(body.slice(0,2)),links:nativeModelCreditLinks(body.slice(0,2)),cancelLabel:decision.cancelLabel,defaultFocusValue:decision.focus}};
   checks.push(()=>{if(cache[49]!==modal||cache[41]?.props!==decision)throw Error('Native admin confirmation changed while reading');});
  }
 }else if(['loading','choose','reenabling','buy-external'].includes(state.s)){
  const modal=track(nativeModelCreditModal(match.fiber));cancel=modal.props.onCancel;
  if(state.s==='choose')await choice(match.fiber,modal.props,modal.props.children,'choose');
  else{const messages=nativeModelFibers(modal.fiber).filter(fiber=>typeof fiber.memoizedProps?.message==='string');if(messages.length===0)throw Error('Native credit progress message changed');track(messages[0]);editor={kind:'information',title:modal.props.title,description:await text(messages[0].memoizedProps.message)};refreshPending=true;}
 }else throw Error('Native model credit state is unsupported');
 return {editor,controls,cancel,confirm,form,refuseInput,refreshPending,dismissible:typeof cancel==='function',current(owner){if(nativeModelCreditState(currentNativeSettingsFiber(owner,match.fiber))!==state||state.s!==stateKind)throw Error('Native credit state changed while reading');for(const anchor of anchors){const live=currentNativeSettingsFiber(owner,anchor.fiber);if(live.memoizedProps!==anchor.props)throw Error('Native credit control changed while reading');}for(const check of checks)check();}};
}
async function changeNativeModelCreditDraft(n,entry,before,formId,key,value,signal){
 if(key!=='answer'||typeof value!=='string'||value.length>16384||before.credit?.form?.id!==formId)throw Error('Native credit form value is invalid');
 signal.throwIfAborted();entry.current();const owner=nativeModelPanelFrame(n,entry);
 if(!sameNativeSettingsFiber(owner,before.owner))throw Error('Native credit form owner changed');before.credit.current(owner);
 const originalForm=before.credit.form;if(originalForm.input.value===value)return before;
 await awaitNativeSettingsReading(originalForm.input.onChange(value),signal);const until=Date.now()+1500;
 while(true){
  signal.throwIfAborted();entry.current();const current=await readNativeModelPanel(n,entry,signal);
  if(!sameNativeSettingsFiber(current.owner,before.owner)||current.credit?.form?.id!==formId||current.credit.form.kind!==originalForm.kind||!sameNativeSettingsFiber(current.credit.form.fiber,originalForm.fiber))throw Error('Native credit form replaced while editing');
  if(current.credit.form.input.value===value)return current;
  if(Date.now()>=until)throw Error('Native credit form did not acknowledge its draft');
  await new Promise(resolve=>setTimeout(resolve,20));
 }
}
async function saveNativeModelCreditForm(n,entry,before,values,signal){
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==1||!Object.hasOwn(values,'answer')||typeof values.answer!=='string'||values.answer.length>16384)throw Error('Native credit form value is invalid');
 const current=await changeNativeModelCreditDraft(n,entry,before,before.credit.form.id,'answer',values.answer,signal);
 signal.throwIfAborted();current.credit.current(nativeModelPanelFrame(n,entry));
 await awaitNativeSettingsReading(current.credit.form.input.onSubmit(values.answer),signal);
 return afterNativeModelAction(n,entry,current,signal);
}
`
