/** Project the original PowerShell confirmation when its mounted controls fit the desktop card. */
export const claudeTerminalPowerShellRuntime = String.raw`
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
      Array.isArray(control.options)&&control.options.length===2&&
      control.options.every((option,index)=>option.value===(index===0?'yes':'no')&&option.type===undefined&&option.disabled!==true&&typeof option.label==='string'&&option.label.length>0&&option.label.length<=4000)){
    matches.push({fiber,wrapper,panel,command,body,control});
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?matches[0]:undefined;
}
async function nativePowerShellPresentation(n,d){
 const source=nativePowerShellControl(n,d);if(!source)return;
 const {fiber,wrapper,panel,command,body,control}=source;
 const choices=control.options.map(option=>({value:option.value,label:option.label,decision:option.value==='yes'?'allow':'deny',feedback:false}));
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
async function answerNativePowerShellPermission(n,d,request){
 const shown=await nativePowerShellPresentation(n,d);
 if(!shown?.presentation.ready||request.choiceToken!==shown.presentation.token||request.feedback!==undefined||request.toolName!=='PowerShell')throw Error('Native PowerShell choices changed or are unavailable');
 const current=nativeDialog(n,'permission_powershell');
 if(current.item!==d.item||current.payload!==d.payload||current.revision!==d.revision||current.sessionId!==d.sessionId)throw Error('Native PowerShell permission expired');
 const {control,fiber}=nativePowerShellControl(n,current)??{};
 if(!control||control!==shown.source.control||fiber.memoizedProps.wouldTakeAnswer()!==true)throw Error('Native PowerShell permission controls changed');
 const cancelling=request.decision==='cancel'&&request.choice==='';
 if(!cancelling&&!shown.presentation.choices.some(choice=>request.choice===choice.value&&request.decision===choice.decision))throw Error('Invalid native PowerShell choice');
 const accepted=cancelling?await control.onCancel():await control.onChange(request.choice);
 if(accepted===false)throw Error('Original native PowerShell permission refused the answer');
 const deadline=Date.now()+1000;
 while(Date.now()<deadline){if(!d.store.getState().open.includes(d.item))return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw Error('Native PowerShell permission did not settle');
}
`
