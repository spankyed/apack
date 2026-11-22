/** Project the original PowerShell confirmation when its mounted controls fit the desktop card. */
export const claudeTerminalPowerShellRuntime = String.raw`
const powerShellAnswers=new WeakSet();
function nativePowerShellControl(n,d){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native PowerShell permission traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='jat'&&fiber.memoizedProps?.payload===d.payload){
   let hash=composerFunctionHashes.get(fiber.type);
   if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='571833a5f9e749508b905ce6bf344ebd4101f40de73b03e68c1be7ead36819c3')throw Error('Native PowerShell permission renderer changed');
   const wrapper=fiber.child?.memoizedProps,panel=wrapper?.children?.props,children=panel?.children;
   const command=children?.[1]?.props?.commandDisplay,body=children?.[2]?.props?.children;
   const selector=body?.[4],control=selector?.props;
   if(Array.isArray(children)&&children.length===4&&typeof panel.title==='string'&&panel.title.length>0&&panel.title.length<=4000&&
      command?.kind==='full'&&typeof command.text==='string'&&command.text.length<=200000&&
      Array.isArray(body)&&body.length===5&&!body[0]&&!body[2]&&selector?.type?.name==='Xe'&&
      typeof control?.onChange==='function'&&typeof control.onCancel==='function'&&
      Array.isArray(control.options)&&supportedPowerShellChoices(control.options)){
    const memo=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===35&&
     row[34]?.handleInputModeToggle===control.onInputModeToggle&&typeof row[34]?.setAcceptFeedback==='function'&&
     typeof row[34]?.setRejectFeedback==='function'&&typeof row[34]?.acceptFeedback==='string'&&typeof row[34]?.rejectFeedback==='string');
    const feedback=memo?.length===1?memo[0][34]:undefined;
    matches.push({fiber,wrapper,panel,command,body,control,feedback});
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?matches[0]:undefined;
}
function supportedPowerShellChoices(options){
 const ordered=options.length===2?['yes','no']:options.length===3?['yes','yes-apply-suggestions','no']:[];
 return ordered.length>0&&options.every((option,index)=>option.value===ordered[index]&&option.type===undefined&&option.disabled!==true&&
  (option.value==='yes-apply-suggestions'?option.label!==undefined:typeof option.label==='string'&&option.label.length>0&&option.label.length<=4000));
}
async function nativePowerShellPresentation(n,d){
 const source=nativePowerShellControl(n,d);if(!source)return;
 const {fiber,wrapper,panel,command,body,control}=source;
 const standingHeld=wrapper.fitted?.body?.isStandingHeld===true,choices=[];
 for(const option of control.options){
  if(option.value==='yes-apply-suggestions'&&standingHeld)continue;
  const label=await nativeGenericPermissionText(n,option.label);if(!label||label.length>4000)return;
  choices.push({value:option.value,label,decision:option.value==='no'?'deny':'allow',feedback:source.feedback!==undefined&&(option.value==='yes'||option.value==='no')});
 }
 const details=[];
 if(typeof wrapper.fitted?.description==='string'&&wrapper.fitted.description)details.push({label:'Description',value:wrapper.fitted.description});
 details.push({label:'Command',value:command.text});
 const reason=await nativeGenericPermissionText(n,body[1]);
 const current=nativePowerShellControl(n,d);
 if(current?.control!==control||current?.fiber!==fiber||current?.panel!==panel)throw Error('Native PowerShell permission changed while formatting');
 const ready=typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()===true;
 const title=panel.title;
 const token=createHash('sha256').update(JSON.stringify([d.revision,title,details,reason,choices,ready])).digest('hex');
 return {source:current,reason,presentation:{ready,choices,choiceDescriptions:{},defaultFocusValue:choices[0].value,canCancel:true,token,title,details}};
}
function currentPowerShellAnswer(n,d){
 const current=nativeDialog(n,'permission_powershell');
 if(current.item!==d.item||current.payload!==d.payload||current.revision!==d.revision||current.sessionId!==d.sessionId)throw Error('Native PowerShell permission expired');
 const source=nativePowerShellControl(n,current);
 if(!source||source.fiber.memoizedProps.wouldTakeAnswer()!==true)throw Error('Native PowerShell permission controls changed');
 return source;
}
async function answerNativePowerShellPermission(n,d,request,signal){
 if(powerShellAnswers.has(d.item))throw Error('Native PowerShell decision is already pending');
 powerShellAnswers.add(d.item);
 let rollback;
 try{
  signal.throwIfAborted();
  const shown=await nativePowerShellPresentation(n,d);
  if(!shown?.presentation.ready||request.choiceToken!==shown.presentation.token||request.toolName!=='PowerShell')throw Error('Native PowerShell choices changed or are unavailable');
  const cancelling=request.decision==='cancel'&&request.choice==='';
  const choice=shown.presentation.choices.find(choice=>request.choice===choice.value&&request.decision===choice.decision);
  if(!cancelling&&!choice)throw Error('Invalid native PowerShell choice');
  if(request.feedback!==undefined&&(!choice?.feedback||typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Unsupported PowerShell feedback');
  let source=currentPowerShellAnswer(n,d);
  if(source.control!==shown.source.control)throw Error('Native PowerShell permission controls changed');
  if(request.choice==='yes-apply-suggestions'&&source.wrapper.fitted?.body?.isStandingHeld===true)throw Error('Native PowerShell standing choice is currently held');
  signal.throwIfAborted();
  if(request.feedback!==undefined){
   if(!source.feedback)throw Error('Native PowerShell feedback is unavailable');
   const allow=choice.value==='yes',field=allow?'acceptFeedback':'rejectFeedback',setter=allow?'setAcceptFeedback':'setRejectFeedback';
   const previous=source.feedback[field],text=request.feedback;
   if(previous!==text){
    const set=source.feedback[setter],previousAnswer=source.control.onChange;
    rollback=()=>{
     const current=nativeDialog(n,'permission_powershell');
     if(current.item!==d.item||current.revision!==d.revision||current.sessionId!==d.sessionId)return;
     const feedback=nativePowerShellControl(n,current)?.feedback;
     if(feedback?.[setter]===set&&(feedback[field]===text||feedback[field]===previous))set(previous);
    };
    set(text);
    const deadline=Date.now()+1000;
    do{
     await new Promise(resolve=>setTimeout(resolve,10));
     signal.throwIfAborted();
     source=currentPowerShellAnswer(n,d);
     if(source.feedback?.[setter]===set&&source.feedback[field]===text&&source.control.onChange!==previousAnswer)break;
    }while(Date.now()<deadline);
    if(source.feedback?.[setter]!==set||source.feedback[field]!==text||source.control.onChange===previousAnswer)throw Error('Native PowerShell feedback was not acknowledged');
   }
  }
  signal.throwIfAborted();
  const accepted=cancelling?await source.control.onCancel():await source.control.onChange(request.choice);
  if(accepted===false)throw Error('Original native PowerShell permission refused the answer');
  rollback=undefined;
  const deadline=Date.now()+1000;
  while(Date.now()<deadline){if(!d.store.getState().open.includes(d.item))return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw Error('Native PowerShell permission did not settle');
 }finally{
  try{rollback?.();}finally{powerShellAnswers.delete(d.item);}
 }
}
`
