/** Native background hints exist only while the original gated producer is mounted. */
export const claudeTerminalToolProgressRuntime = String.raw`const toolProgressFrames=new Map();
function nativeToolProgressHints(n){
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current,pending=root?[root]:[],seen=new Set(),hints=new Map(),ambiguous=new Set();
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native tool hint traversal exceeded bound');seen.add(fiber);
  if(fiber.type===n.toolBackground.ntr){
   const props=fiber.memoizedProps,child=fiber.child?.memoizedProps;
   if(props?.keyOnly!==true&&typeof props?.toolUseId==='string'&&child?.toolUseId===props.toolUseId&&typeof child.hint==='string'&&child.hint.length<=65536){
    const id=props.toolUseId;if(hints.has(id)&&hints.get(id)!==child.hint)ambiguous.add(id);hints.set(id,child.hint);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 for(const id of ambiguous)hints.delete(id);return hints;
}
function toolProgressFacts(n,id,assistantUuid,abort,hints=nativeToolProgressHints(n)){
 const call=toolUseFacts(n,id,assistantUuid,abort);if(!call)return;
 const hint=call.props.isRunning?hints.get(id):undefined;
 return {props:hint===undefined?undefined:{tool_use_id:id,kind:'background_hint',hint},fingerprint:JSON.stringify([call.fingerprint,hint])};
}
function currentToolProgressAction(n,request){
 if(request.component!=='ToolProgress')return;
 const frame=toolProgressFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 const facts=frame&&toolProgressFacts(n,request.instance_id,frame.assistantUuid,new AbortController());
 if(!facts?.props||facts.fingerprint!==frame.fingerprint)throw Error('Native tool progress changed or expired');
}
function refreshNativeToolProgress(n){
 if(!toolProgressFrames.size)return;const hints=nativeToolProgressHints(n),changed=[];
 for(const frame of toolProgressFrames.values()){
  const facts=toolProgressFacts(n,frame.id,frame.assistantUuid,new AbortController(),hints),fingerprint=facts?.fingerprint;
  if(fingerprint===frame.observed)continue;frame.observed=fingerprint;
  if(!facts?.props)n.nativeClients.release(frame.clientId,'ToolProgress',frame.id);
  changed.push({surface:'desktop',component:'ToolProgress',instance_id:frame.id});
 }
 if(changed.length)publish({type:'system',subtype:'ui_invalidate',event:'ui.render',instances:changed});
}
async function formatNativeToolProgress(n,hint,options){
 if(typeof hint!=='string'||hint.length>65536)throw Error('Native tool progress rewrite is invalid');options.signal?.throwIfAborted();
 if(!hint)return '';
 const theme=nativeThemeProvider(n),tree=n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.terminalComponents.s,{paddingLeft:5,children:n.jsx.e(n.terminalComponents.n,{dimColor:true,children:hint})})});
 const text=await n.staticRender.v6e(tree,{columns:Math.max(20,Math.min(240,options.columns??process.stdout.columns??80))});
 options.signal?.throwIfAborted();if(typeof text!=='string'||text.length>65536)throw Error('Native tool progress drawing exceeds limit');return text;
}`
