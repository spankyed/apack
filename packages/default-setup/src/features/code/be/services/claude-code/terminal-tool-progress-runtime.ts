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
let toolBackgroundPlugin,toolBackgroundHandle=0;
function toolBackgroundDrawing(value,tree,instanceRevision){
 const frame=toolProgressFrames.get(JSON.stringify([value.client_id,value.instance_id]));
 if(!frame||instanceRevision===undefined||!nativeDrawingUsesEngine(tree))return tree;
 if(toolBackgroundHandle>=Number.MAX_SAFE_INTEGER)throw Error('Native tool action identity exhausted');
 toolBackgroundPlugin??='apack-tool-background:'+randomUUID();
 frame.backgroundHandle=++toolBackgroundHandle;frame.instanceRevision=instanceRevision;
 return {type:'Box',props:{flexDirection:'column',gap:0},children:[tree,{type:'Button',props:{key:'background-tool',label:'Run in background',variant:'secondary'},press:{plugin:toolBackgroundPlugin,handle:frame.backgroundHandle}}]};
}
function runToolBackgroundAction(n,request,abort){
 if(request.subtype!=='ui_press'||toolBackgroundPlugin===undefined||request.plugin!==toolBackgroundPlugin)return;
 if(request.component!=='ToolProgress'||request.key!=='background-tool'||!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))return {handled:false};
 const frame=toolProgressFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 if(!frame||frame.backgroundHandle!==request.handle||frame.instanceRevision!==request.instance_revision||!instanceLifetimes.active(request,request.instance_revision))return {handled:false};
 const facts=toolProgressFacts(n,request.instance_id,frame.assistantUuid,abort);
 if(!facts?.props||facts.fingerprint!==frame.fingerprint)return {handled:false};
 abort.signal.throwIfAborted();
 // Consume before entering the original targeted task operation; never retry a possible side effect.
 delete frame.backgroundHandle;
 const binding=originalContext??n.runtime.ey(),registry=binding.toolContext(abort).taskRegistry;
 return {handled:n.runtime.mdt(request.instance_id,registry)===true};
}
async function formatNativeToolProgress(n,hint,options){
 if(typeof hint!=='string'||hint.length>65536)throw Error('Native tool progress rewrite is invalid');options.signal?.throwIfAborted();
 if(!hint)return '';
 const theme=nativeThemeProvider(n),tree=n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.terminalComponents.s,{paddingLeft:5,children:n.jsx.e(n.terminalComponents.n,{dimColor:true,children:hint})})});
 const text=await n.staticRender.v6e(tree,{columns:Math.max(20,Math.min(240,options.columns??process.stdout.columns??80))});
 options.signal?.throwIfAborted();if(typeof text!=='string'||text.length>65536)throw Error('Native tool progress drawing exceeds limit');return text;
}`
