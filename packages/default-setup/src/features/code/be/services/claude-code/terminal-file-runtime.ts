/** Original mounted file choices and feedback; permission updates remain native-owned. */
export const claudeTerminalFileRuntime = String.raw`function nativeNotebookReview(p){
 const content=p.content,withheld=p.contentWithheld===true||content?.kind==='no-changes',input=p.input;
 const notebook={editMode:input.edit_mode??'replace',...(typeof input.cell_id==='string'?{cellId:input.cell_id}:{}),...(typeof input.cell_type==='string'?{cellType:input.cell_type}:{})};
 const notice=typeof content?.message==='string'?content.message:typeof content?.notice==='string'?content.notice:undefined;
 return {withheld,notebook,...(notice?{notice}:{}),...(!withheld?{...(typeof content.oldCellSource==='string'?{before:content.oldCellSource}:{}),...(notebook.editMode!=='delete'?{after:content.newSource}:{})}:{})};
}
function nativeFileControl(n,d){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native file traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='Sat'&&fiber.memoizedProps?.payload===d.payload){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='4d3297fd160d4c1497f0a21f0f98372ea53943f0e951256c3fbd8ac13dd5b406')throw Error('Native file renderer changed');
   const ready=typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()===true,children=[fiber.child],visited=new Set();
   while(children.length){const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native file controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name==='Xe'&&Array.isArray(child.memoizedProps?.options)&&typeof child.memoizedProps.onChange==='function')matches.push({fiber,control:child.memoizedProps,ready});
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const result=matches[0];if(result.control.options.length>16)throw Error('Native file choice limit');return result;
}
function nativeFileFeedbackValue(fiber,setter){
 let hook=fiber.memoizedState,count=0;
 while(hook){if(++count>512)throw Error('Native file feedback hook limit');if(hook.queue?.dispatch===setter)return hook.memoizedState;hook=hook.next;}
}
async function nativeFileChoices(n,d){
 const source=nativeFileControl(n,d),choices=[],updates=[];
 if(source)for(const option of source.control.options){
  const type=option.option?.type,decision=['reject','block-outside-reads'].includes(type)?'deny':['accept-once','accept-session','allow-outside-read-once'].includes(type)?'allow':undefined;
  if(option.disabled===true||!decision||typeof option.value!=='string'||option.value.length>128)continue;
  // The original permission row contains the scope; terminal-only shortcut chrome is separate.
  let label=type==='accept-session'&&option.option.row?.node!==undefined?option.option.row.node:option.label;
  if(typeof label!=='string'){
   const theme=nativeThemeProvider(n);
   label=await n.staticRender.$bn(n.jsx.e(theme.type,{value:theme.value,children:label}),{columns:100});
  }
  if(typeof label!=='string'||label.length>4000)throw Error('Native file label is invalid');
  choices.push({value:option.value,label:label.trim(),decision,feedback:['accept-once','reject','allow-outside-read-once'].includes(type)&&typeof source.control.onInputModeToggle==='function'});
  updates.push(option.option?.row?.applies??null);
 }
 if(new Set(choices.map(choice=>choice.value)).size!==choices.length)throw Error('Native file choices are ambiguous');
 const current=nativeFileControl(n,d);
 if(current?.control!==source?.control)throw Error('Native file controls changed while formatting');
 const ready=current?.ready===true,token=createHash('sha256').update(JSON.stringify([d.revision,ready,choices,updates])).digest('hex');
 return {source:current,ready,choices,token};
}
async function answerNativeFileChoice(n,d,request){
 let presented=await nativeFileChoices(n,d);
 if(!presented.ready)throw Error('Native file approval is not ready');
 if(request.choiceToken!==undefined&&request.choiceToken!==presented.token)throw Error('Native file choices changed or expired');
 const value=request.choice??(request.decision==='allow'?'yes':'no'),choice=presented.choices.find(choice=>choice.value===value);
 if(!choice||choice.decision!==request.decision)throw Error('Invalid native file approval choice');
 if(request.feedback!==undefined&&request.feedback!==''){
  if(!choice.feedback)throw Error('This native choice does not accept feedback');
  let source=presented.source,option=source.control.options.find(option=>option.value===value);
  if(option.type!=='input')source.control.onInputModeToggle(value);
  const deadline=Date.now()+1000;
  while(Date.now()<deadline){
   const current=nativeDialog(n,'permission_file');if(current.revision!==d.revision)throw Error('Native file approval expired during feedback');
   source=nativeFileControl(n,current);option=source?.control.options.find(option=>option.value===value);
   if(source?.ready&&option?.type==='input'&&typeof option.onChange==='function')break;
   option=undefined;await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(!option)throw Error('Native file feedback mode was not acknowledged');
  const setter=option.onChange;setter(request.feedback);
  let acknowledged=false;
  while(Date.now()<deadline){
   const current=nativeDialog(n,'permission_file');if(current.revision!==d.revision)throw Error('Native file approval expired during feedback');
   source=nativeFileControl(n,current);
   if(source?.ready&&nativeFileFeedbackValue(source.fiber,setter)===request.feedback){acknowledged=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(!acknowledged)throw Error('Native file feedback was not acknowledged');
  presented=await nativeFileChoices(n,d);
  if(presented.token!==request.choiceToken&&request.choiceToken!==undefined)throw Error('Native file choices changed during feedback');
  if(nativeFileFeedbackValue(presented.source.fiber,setter)!==request.feedback)throw Error('Native file feedback changed before submission');
 }
 const current=nativeDialog(n,'permission_file');if(current.revision!==d.revision)throw Error('Native file approval expired before submission');
 if(!presented.ready||await presented.source.control.onChange(value)===false)throw Error('Native file choice is held or refused');
 const deadline=Date.now()+1000;
 while(Date.now()<deadline){if(!d.store.getState().open.some(item=>item===d.item))return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw Error('Native file approval did not settle');
}`
