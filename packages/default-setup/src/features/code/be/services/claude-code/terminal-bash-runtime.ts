/** Borrow original mounted Bash choices and callbacks; native owns admission and permission updates. */
export const claudeTerminalBashRuntime = String.raw`function nativeBashChoices(n,d){
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current,pending=root?[root]:[],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native Bash traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='Tst'&&fiber.memoizedProps?.payload===d.payload){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='a1c816cf807cd385354df0a915bea27b7ade8b971aca77ac266d0af49522686a')throw Error('Native Bash renderer changed');
   const fitted=fiber.updateQueue?.memoCache?.data?.map(cache=>cache?.[23]).filter(value=>value&&typeof value.noteFocus==='function'&&value.body&&typeof value.body.isStandingHeld==='boolean');
   const standingReady=typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()===true&&fitted?.length===1&&fitted[0].body.offersStanding===true&&fitted[0].body.isStandingHeld===false;
   const children=fiber.child?[fiber.child]:[],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native Bash controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name==='Xe'&&Array.isArray(child.memoizedProps?.options)&&typeof child.memoizedProps.onChange==='function')matches.push({...child.memoizedProps,standingReady});
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const control=matches[0],options=control.options;
 if(options.length>16)throw Error('Native Bash choice limit');
 const choices=options.map(option=>{
  // Preserve original displayed labels. Unsupported rich labels stay in the terminal.
  if(option.disabled===true||option.value!=='yes'&&option.value!=='no'&&!control.standingReady)return;
  if(typeof option.value!=='string'||option.value.length>128||typeof option.label!=='string'||option.label.length>4000)return;
  if(option.type==='input'&&option.value!=='yes-prefix-edited')return;
  if(option.type==='input'&&(typeof option.initialValue!=='string'||option.initialValue.length>4000||typeof option.onChange!=='function'))return;
  return {value:option.value,label:option.label,...(option.type==='input'?{prefix:option.initialValue}:{})};
 }).filter(Boolean);
 if(new Set(choices.map(choice=>choice.value)).size!==choices.length)throw Error('Native Bash choices are ambiguous');
 const token=createHash('sha256').update(JSON.stringify([d.revision,choices])).digest('hex');
 return {control,options,choices,token};
}
async function answerNativeBashChoice(n,d,request){
 let source=nativeBashChoices(n,d);
 if(!source||request.choiceToken!==source.token)throw Error('Native Bash choices changed or expired');
 const choice=source.choices.find(choice=>choice.value===request.choice);
 if(!choice||choice.value==='no')throw Error('Invalid native Bash approval choice');
 if(choice.prefix!==undefined){
  if(typeof request.prefix!=='string'||request.prefix.length>4000)throw Error('Invalid native Bash prefix');
  if(request.prefix!==choice.prefix){
  const original=source.options.find(option=>option.value===choice.value);
  original.onChange(request.prefix);
  // React owns prefix state and the callback closure. Never answer with the pre-edit closure.
  const deadline=Date.now()+1000;let updated;
  while(Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,10));
   const current=nativeDialog(n,'permission_bash');if(current.revision!==d.revision)throw Error('Native Bash approval expired during edit');
   updated=nativeBashChoices(n,current);
   if(updated?.control.onChange!==source.control.onChange&&updated?.choices.some(option=>option.value===choice.value&&option.prefix===request.prefix))break;
   updated=undefined;
  }
  if(!updated)throw Error('Native Bash prefix was not acknowledged');source=updated;
  }
 }else if(request.prefix!==undefined)throw Error('Unexpected native Bash prefix');
 if(await source.control.onChange(choice.value)===false)throw Error('Native Bash choice is currently held or refused');
 const deadline=Date.now()+1000;
 while(Date.now()<deadline){
  if(!d.store.getState().open.some(item=>item===d.item))return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('Native Bash choice was refused or did not settle');
}`
