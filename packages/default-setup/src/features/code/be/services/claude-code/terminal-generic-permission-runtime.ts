/** Original mounted permission_prompt contract; all decisions and policy effects stay native. */
export const claudeTerminalGenericPermissionRuntime = String.raw`
function nativeGenericPermissionControl(n,d){
 if(d.item?.kind!=='permission_prompt')throw Error('Unsupported generic permission kind');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native generic permission traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('ozr')&&fiber.memoizedProps?.payload===d.payload){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='063b997d50194fb47258b9acc04548bd0e708eab1fec57435264219335afdc73')throw Error('Native generic permission renderer changed');
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native generic permission controls exceeded bound');visited.add(child);
    const control=child.memoizedProps;
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('qJ')&&Array.isArray(control?.options)&&typeof control.onSelect==='function'){
     let controlHash=composerFunctionHashes.get(child.type);if(!controlHash){controlHash=createHash('sha256').update(Function.prototype.toString.call(child.type)).digest('hex');composerFunctionHashes.set(child.type,controlHash);}
     if(controlHash!=='5602da1d16eb7bb040b568afe7012d87d13436e6ffeef266609a9ae1d127b51b')throw Error('Native generic permission control changed');
     matches.push({fiber,control,ready:typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()===true});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 if(matches[0].control.options.length>16)throw Error('Native generic permission choice limit');return matches[0];
}
async function nativeGenericPermissionText(n,node,preserve=false){
 if(node===undefined||node===null||node===false)return '';
 let value=node;if(typeof value!=='string'){
  const theme=nativeThemeProvider(n);
  const tree=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,children:n.jsx.e(theme.type,{value:theme.value,children:node})});
  const themeKey=JSON.stringify(theme.value.resolvedTheme);
  value=await (preserve?n.staticRender.v6e:n.staticRender.$bn)(tree,{columns:100});
  if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==themeKey)throw Error('Native generic permission theme changed while formatting');
 }
 if(typeof value!=='string')throw Error('Invalid original generic permission preview');
 value=(preserve?value:stripVTControlCharacters(value)).trim();if(value.length>200000)throw Error('Native generic permission preview exceeded bound');return value;
}
async function nativeGenericPermissionDetail(n,label,node){
 if(typeof node==='string')return {label,value:await nativeGenericPermissionText(n,node)};
 const ansi=await nativeGenericPermissionText(n,node,true);
 return {label,value:stripVTControlCharacters(ansi).trim(),ansi};
}
async function nativeGenericPermissionPreview(n,d,source){
 if(!source)return;
 const caches=source.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===155);
 if(caches?.length!==1)return;
 const cache=caches[0],root=source.fiber.child;
 const mounted=element=>element&&root?.type===element.type&&root.memoizedProps===element.props;
 const details=[];let title;
 if(mounted(cache[107])){
  title=cache[107].props.title;const content=await nativeGenericPermissionDetail(n,'Request',cache[90]);if(content.value)details.push(content);
 }else if(mounted(cache[154])){
  title=cache[151]?.props?.title;
  if(d.payload.isMcp===true){const tool=await nativeGenericPermissionDetail(n,'Tool',cache[123]);if(tool.value)details.push(tool);}
  const input=await nativeGenericPermissionDetail(n,'Parameters',cache[129]);if(input.value)details.push(input);
  if(typeof cache[65]==='string'&&cache[65])details.push({label:'Description',value:await nativeGenericPermissionText(n,cache[65])});
 }else return;
 if(typeof title!=='string'||!title.length||title.length>4000)return;
 return {title,details};
}
async function nativeGenericPermissionChoices(n,d){
 const source=nativeGenericPermissionControl(n,d),choices=[],choiceDescriptions={};
 if(source)for(const option of source.control.options){
  if(option.disabled===true)continue;
  if(!['yes','yes-dont-ask-again','yes-enable-auto-mode','no'].includes(option.value))throw Error('Unknown original generic permission choice');
  const label=await nativeGenericPermissionText(n,option.label);if(!label||label.length>4000)throw Error('Invalid native generic permission label');
  if(option.description!==undefined){const description=await nativeGenericPermissionText(n,option.description);if(description.length>4000)throw Error('Native generic permission choice description exceeded bound');choiceDescriptions[option.value]=description;}
  choices.push({value:option.value,label,decision:option.value==='no'?'deny':'allow',feedback:['accept','reject'].includes(option.feedbackConfig?.type)});
 }
 if(new Set(choices.map(choice=>choice.value)).size!==choices.length)throw Error('Ambiguous native generic permission choices');
 const preview=await nativeGenericPermissionPreview(n,d,source),current=nativeGenericPermissionControl(n,d);
 if(current?.control!==source?.control||current?.fiber!==source?.fiber)throw Error('Native generic permission changed while formatting');
 const defaultFocusValue=choices.some(choice=>choice.value===current?.control.defaultFocusValue)?current.control.defaultFocusValue:choices[0]?.value;
 const canCancel=typeof current?.control.onCancel==='function';
 const ready=current?.ready===true&&preview!==undefined,token=createHash('sha256').update(JSON.stringify([d.revision,ready,choices,choiceDescriptions,preview,defaultFocusValue,canCancel])).digest('hex');
 return {source:current,ready,choices,choiceDescriptions,defaultFocusValue,canCancel,token,title:preview?.title??'Tool permission',details:preview?.details??[]};
}
async function answerNativeGenericPermissionChoice(n,d,request){
 const shown=await nativeGenericPermissionChoices(n,d);
 if(!shown.ready||request.choiceToken!==shown.token)throw Error('Native generic permission choices changed or are not ready');
 const choice=shown.choices.find(value=>value.value===request.choice);
 const cancelling=request.decision==='cancel';
 if(request.toolName!==d.payload.toolName||(cancelling?(!shown.canCancel||request.choice!==''||request.feedback!==undefined):(!choice||request.decision!==choice.decision)))throw Error('Invalid native generic permission choice');
 if(request.feedback!==undefined&&(!choice?.feedback||typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Unsupported native generic permission feedback');
 const current=nativeDialog(n,'permission_prompt');
 if(current.item!==d.item||current.payload!==d.payload||current.revision!==d.revision||current.sessionId!==d.sessionId)throw Error('Native generic permission expired');
 const source=nativeGenericPermissionControl(n,current);
 if(!source?.ready||source.control!==shown.source.control)throw Error('Native generic permission controls changed');
 const accepted=cancelling?await source.control.onCancel():await source.control.onSelect(choice.value,request.feedback);
 if(accepted===false)throw Error('Original native generic permission refused the answer');
 const deadline=Date.now()+1000;
 while(Date.now()<deadline){if(!d.store.getState().open.some(item=>item.id===d.item.id))return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw Error('Native generic permission did not settle');
}
`
