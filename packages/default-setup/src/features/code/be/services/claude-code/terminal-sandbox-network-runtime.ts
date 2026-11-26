/** Sandbox consent delegates original host display, rule choices and effects to mounted native controls. */
export const claudeTerminalSandboxNetworkRuntime = String.raw`
function nativeSandboxNetwork(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native sandbox request is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native sandbox request session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,kind='sandbox_network_access',items=store.getState().open.filter(item=>item.kind===kind);
 if(items.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=items[0],payload=item.payload;
 if(typeof payload?.host!=='string'||payload.host.length>16000)throw Error('Native sandbox host payload changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native sandbox producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native sandbox traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('VCo')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'573ab81627b252950400c030451d1608cd68367c498beaca288b27c3da8d20c5');
   if(typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native sandbox controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('Ske')&&child.memoizedProps?.hostPattern?.host===payload.host&&child.memoizedProps.hostPattern.port===payload.port){
     checked(child.type,'5ef697d36d06b882f5a1363a26b6b7c9a5f26dec6e375f494ee564ef93048aa0');
     const rows=child.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===44&&row[39]?.props?.children?.[1]?.props?.children?.props);
     if(rows?.length!==1)throw Error('Native sandbox presentation changed');
     const row=rows[0],control=row[39].props.children[1].props.children.props;
     if(typeof control.onChange!=='function'||typeof control.onCancel!=='function'||!Array.isArray(control.options)||control.options.length<2||control.options.length>3||!control.options.some(option=>option.value==='yes')||!control.options.some(option=>option.value==='no')||control.options.some(option=>!['yes','yes-dont-ask-again','no'].includes(option.value))||new Set(control.options.map(option=>option.value)).size!==control.options.length)throw Error('Native sandbox choices changed');
     if(control.isDisabled===false)matches.push({row,control});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return {store,sessionId};
 const source=matches[0],fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control)revision={item,payload,fingerprint,sessionId,control:source.control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source};
}
async function projectNativeSandboxNetwork(n,d){
 const title=await nativeGenericPermissionText(n,d.source.row[43].props.title),paragraphs=[];
 for(const node of [d.source.row[29],d.source.row[30]]){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}
 const choices=[];for(const option of d.source.control.options)choices.push({value:({'yes':'sandbox_allow','yes-dont-ask-again':'sandbox_remember','no':'sandbox_deny'})[option.value],label:await nativeGenericPermissionText(n,option.label)});
 const current=nativeSandboxNetwork(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native sandbox request changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'sandbox_network_access',title,paragraphs,choices};
}
function answerNativeSandboxNetwork(n,request){
 const d=nativeSandboxNetwork(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native sandbox request changed or expired');
 if(request.decision==='sandbox_cancel')d.source.control.onCancel();
 else{
  const value=({'sandbox_allow':'yes','sandbox_remember':'yes-dont-ask-again','sandbox_deny':'no'})[request.decision];
  if(!value||!d.source.control.options.some(option=>option.value===value))throw Error('Native sandbox choice is unavailable');
  d.source.control.onChange(value);
 }
 if(d.store.getState().open.includes(d.item))throw Error('Native sandbox request did not accept the decision');
 dialogRevisions.delete('sandbox_network_access');
}
`
