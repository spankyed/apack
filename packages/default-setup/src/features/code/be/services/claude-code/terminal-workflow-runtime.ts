/** Borrow the original mounted workflow choices; validation, withholding and grants remain native. */
export const claudeTerminalWorkflowRuntime = String.raw`function nativeWorkflowControl(n,d){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native workflow traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='Gt'&&fiber.memoizedProps?.payload===d.payload){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='6823a3f796c86b23af27d79c7298106e83e975be017609701b37268da846db9b')throw Error('Native workflow renderer changed');
   const cache=fiber.updateQueue?.memoCache?.data?.[0];
   if(!cache||cache[26]!==d.payload||typeof cache[27]!=='string'||typeof cache[30]!=='function'||!Array.isArray(cache[63])||typeof fiber.memoizedProps.wouldTakeAnswer!=='function')continue;
   matches.push({fiber,handler:cache[30],script:cache[27],withheld:cache[28]===true,args:cache[19],grant:cache[24]?.applies,options:cache[63],ready:fiber.memoizedProps.wouldTakeAnswer()===true});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;return matches[0];
}
async function nativeWorkflowPresentation(n,d){
 const source=nativeWorkflowControl(n,d),choices=[];
 if(source)for(const option of source.options){if(!['yes','yes-always','no'].includes(option.value))continue;let label=option.label;
  if(typeof label!=='string'){const theme=nativeThemeProvider(n);label=await n.staticRender.$bn(n.jsx.e(theme.type,{value:theme.value,children:label}),{columns:100});}
  if(typeof label!=='string'||label.length>4000)throw Error('Invalid native workflow label');
  choices.push({value:option.value,label:label.trim(),decision:option.value==='no'?'deny':'allow',feedback:!!option.feedbackConfig});
 }
 const current=nativeWorkflowControl(n,d);if(current?.handler!==source?.handler)throw Error('Native workflow choices changed while formatting');
 const ready=current?.ready===true,withheld=!current||current.withheld,script=withheld?undefined:current.script,args=current?.args;
 if(script!==undefined&&script.length>200000)throw Error('Native workflow preview exceeds bound');
 const argsText=args?.kind==='full'?args.text:args?.marker;
 const presentation={ready,withheld,...(script!==undefined?{script}:{}),...(typeof argsText==='string'?{args:argsText}:{}),choices};
 const token=createHash('sha256').update(JSON.stringify([d.revision,presentation,current?.grant])).digest('hex');return {source:current,presentation:{...presentation,token}};
}
async function answerNativeWorkflow(n,d,request){
 const {source,presentation}=await nativeWorkflowPresentation(n,d);
 if(!presentation.ready||request.choiceToken!==presentation.token)throw Error('Native workflow choices changed or expired');
 const value=request.choice??(request.decision==='allow'?'yes':'no'),choice=presentation.choices.find(row=>row.value===value);
 if(!choice||choice.decision!==request.decision||request.feedback&&!choice.feedback)throw Error('Invalid native workflow choice');
 const current=nativeDialog(n,'permission_workflow');if(current.revision!==d.revision||nativeWorkflowControl(n,current)?.handler!==source.handler)throw Error('Native workflow approval expired');
 if(await source.handler(value,request.feedback)===false)throw Error('Native workflow choice refused');
 const deadline=Date.now()+1000;while(Date.now()<deadline){if(!d.store.getState().open.some(item=>item===d.item))return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Native workflow approval did not settle');
}`
