/** Original mounted WebFetch/Skill choices; answer construction and permission updates stay native. */
export const claudeTerminalToolPermissionRuntime = String.raw`
function nativeToolPermissionControl(n,d){
 const skill=d.item.kind==='permission_skill',web=d.item.kind==='permission_webfetch';
 if(!skill&&!web)throw Error('Unsupported native tool permission');
 const name=nativeFunctionName(skill?'WCe':'VCe');
 const expected=nativeFunctionHash(skill?'955f9ffc1db84e02a59e63f805dacaee7f9a97ea83d16f35b83753ea5ea78ff8':'7b0b27d88eabc586448a295d6ebf3c730847b371f09c607b8b503e06e3fae519');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native tool permission traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===name&&fiber.memoizedProps?.payload===d.payload){
   let fingerprint=composerFunctionHashes.get(fiber.type);
   if(!fingerprint){fingerprint=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,fingerprint);}
   if(fingerprint!==expected)throw Error('Native tool permission renderer changed');
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native tool permission controls exceeded bound');visited.add(child);
    const control=child.memoizedProps;
    if(typeof child.type==='function'&&Array.isArray(control?.options)&&(skill?typeof control.onSelect==='function':child.type.name===nativeFunctionName('Xe')&&typeof control.onChange==='function'))
     matches.push({control,ready:typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()===true,skill});
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const source=matches[0];if(source.control.options.length>16)throw Error('Native tool permission choice limit');return source;
}
async function nativeToolPermissionChoices(n,d){
 const source=nativeToolPermissionControl(n,d),choices=[];
 if(source)for(const option of source.control.options){
  if(option.disabled===true)continue;
  const allowed=source.skill?['yes','yes-exact','yes-prefix','no']:['yes','yes-dont-ask-again-domain','no'];
  if(!allowed.includes(option.value))throw Error('Unknown original tool permission choice');
  let label=option.label;
  if(typeof label!=='string'){
   const theme=nativeThemeProvider(n);
   label=await n.staticRender.$bn(n.jsx.e(theme.type,{value:theme.value,children:label}),{columns:100});
  }
  if(typeof label!=='string'||!label.trim()||label.length>4000)throw Error('Invalid native tool permission label');
  choices.push({value:option.value,label:label.trim(),decision:option.value==='no'?'deny':'allow',feedback:source.skill&&['accept','reject'].includes(option.feedbackConfig?.type)});
 }
 if(new Set(choices.map(choice=>choice.value)).size!==choices.length)throw Error('Ambiguous native tool permission choices');
 const current=nativeToolPermissionControl(n,d);
 if(current?.control!==source?.control)throw Error('Native tool permission changed while formatting');
 const ready=current?.ready===true,token=createHash('sha256').update(JSON.stringify([d.revision,ready,choices])).digest('hex');
 return {source:current,ready,choices,token};
}
async function answerNativeToolPermissionChoice(n,d,request){
 let shown=await nativeToolPermissionChoices(n,d);
 if(!shown.ready||request.choiceToken!==shown.token)throw Error('Native tool permission choices changed or are not ready');
 const choice=shown.choices.find(value=>value.value===request.choice);
 if(!choice)throw Error('Unknown native tool permission choice');
 if(request.feedback!==undefined&&(!choice.feedback||typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Unsupported native tool permission feedback');
 const current=nativeDialog(n,d.item.kind);
 if(current.item!==d.item||current.payload!==d.payload||current.revision!==d.revision||current.sessionId!==d.sessionId)throw Error('Native tool permission expired');
 const source=nativeToolPermissionControl(n,current);
 if(!source?.ready||source.control!==shown.source.control)throw Error('Native tool permission controls changed');
 const accepted=await (source.skill?source.control.onSelect(choice.value,request.feedback):source.control.onChange(choice.value));
 if(accepted===false)throw Error('Original native tool permission refused the answer');
 const deadline=Date.now()+1000;
 while(Date.now()<deadline){if(!d.store.getState().open.some(item=>item.id===d.item.id))return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw Error('Native tool permission did not settle');
}
`
