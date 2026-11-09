/** Borrow quota choices from the original view; native grace, clear and pointer effects remain native. */
export const claudeTerminalColdQuotaRuntime = String.raw`
function nativeColdQuota(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native quota offer is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native quota offer session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,kind='cold_resume_quota';
 if(open.length!==1||open[0].kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=open[0],payload=item.payload;
 if(!['inactiveSince','contextTokens','percentOfFiveHourLimit'].every(key=>Number.isFinite(payload?.[key])&&payload[key]>=0)||!['resume','idle'].includes(payload.trigger)||!['resume','new_conversation','none'].includes(payload.focusedAction))throw Error('Native quota offer payload changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native quota offer producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native quota offer traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('HCo')&&fiber.memoizedProps?.payload===payload&&typeof fiber.memoizedProps.answer==='function'){
   checked(fiber.type,'7065ff3b6377c8b988df5624a99ffe187a0cf77fe842bbb48fbc50058656ba52');
   const children=[fiber.child],visited=new Set();
   while(children.length){const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native quota view traversal exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('BZe')&&child.memoizedProps?.ask===payload&&child.memoizedProps?.onDone===fiber.memoizedProps.answer){
     checked(child.type,'7cb36eaa72b80f0c728ce4ff4ba940c1aa1b4f604f0add07a7c2a723bb709346');
     if(!['inactiveSince','contextTokens','percentOfFiveHourLimit','trigger','focusedAction'].every(key=>child.memoizedProps[key]===payload[key]))throw Error('Native quota offer facts changed');
     const descendants=[child.child],nodes=new Set(),controls=[],panels=[];
     while(descendants.length){const node=descendants.pop();if(!node||nodes.has(node))continue;if(nodes.size>=2048)throw Error('Native quota controls exceeded bound');nodes.add(node);const props=node.memoizedProps;
      if(typeof node.type==='function'&&node.type.name===nativeFunctionName('Xe')&&Array.isArray(props?.options)&&JSON.stringify(props.options.map(option=>option.value))===JSON.stringify(['resume','new_conversation'])&&typeof props.onChange==='function'){
       checked(node.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');controls.push(props);
      }
      if(props?.title==='Resume this conversation?'&&typeof props.onCancel==='function'&&Array.isArray(props.children)&&props.children.length===2)panels.push(props);
      if(node.sibling)descendants.push(node.sibling);if(node.child)descendants.push(node.child);
     }
     if(controls.length===1){const control=controls[0],owned=panels.filter(panel=>panel.children[1]?.props===control);if(owned.length===1)matches.push({control,panel:owned[0]});}
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0];if(source.control.onFocus!==undefined&&typeof source.control.onFocus!=='function')throw Error('Native quota focus callback changed');
 const preferred=payload.focusedAction==='none'?undefined:source.control.defaultFocusValue??'resume';
 if(preferred!==undefined&&!['resume','new_conversation'].includes(preferred))throw Error('Native quota focus changed');
 const fingerprint=JSON.stringify([payload,preferred]);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control||revision?.panel!==source.panel)revision={item,payload,fingerprint,sessionId,control:source.control,panel:source.panel,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source,preferred};
}
async function projectNativeColdQuota(n,d){
 const title=await nativeGenericPermissionText(n,d.source.panel.title),paragraph=await nativeGenericPermissionText(n,d.source.panel.children[0]),choices=[];
 for(const option of d.source.control.options){const label=await nativeGenericPermissionText(n,option.label),description=option.description===undefined?undefined:await nativeGenericPermissionText(n,option.description);choices.push({value:option.value==='resume'?'quota_resume':'quota_new_conversation',label,...(description?{description}:{})});}
 const current=nativeColdQuota(n);if(current.item!==d.item||current.revision!==d.revision)throw Error('Native quota offer changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'cold_resume_quota',title,paragraphs:paragraph?[paragraph]:[],choices,trigger:d.payload.trigger,...(d.preferred===undefined?{}:{preferredChoice:d.preferred==='resume'?'quota_resume':'quota_new_conversation'})};
}
function answerNativeColdQuota(n,request){
 const d=nativeColdQuota(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native quota offer changed or expired');
 if(!['quota_resume','quota_new_conversation','quota_dismiss'].includes(request.decision))throw Error('Invalid native quota choice');
 if(request.decision==='quota_dismiss')d.source.panel.onCancel();
 else{
  const value=request.decision==='quota_resume'?'resume':'new_conversation';
  d.source.control.onFocus?.(value);
  const current=nativeColdQuota(n);if(current.item!==d.item||current.revision!==d.revision)throw Error('Native quota offer changed while choosing');
  if(d.source.control.onChange(value)===false)throw Error('Native quota choice is temporarily refused');
 }
 if(d.store.getState().open.includes(d.item))throw Error('Native quota offer did not accept the decision');
 dialogRevisions.delete('cold_resume_quota');
}
`
