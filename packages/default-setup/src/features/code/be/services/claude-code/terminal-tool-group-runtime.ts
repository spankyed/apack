/** Canonical ToolGroup producers come from the original mounted transcript, never app grouping. */
export const claudeTerminalToolGroupRuntime = String.raw`const toolGroupFrames=new Map();let toolGroupSnapshot,toolGroupPlugin,toolGroupHandle=0;const toolGroupRevisions=new Map();
function nativeToolGroups(n){
 const binding=originalContext??n.runtime.ey();if(!binding||binding.toolContext(new AbortController()).getAppState().viewingAgentTaskId!==undefined)return new Map();
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current,pending=root?[root]:[],seen=new Set(),groups=new Map(),ambiguous=new Set();
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native tool group traversal exceeded bound');seen.add(fiber);
  const props=fiber.memoizedProps,message=props?.message;
  if((fiber.type===n.toolRendering.h3||fiber.elementType===n.toolRendering.h3||n.toolRendering.h3.type&&fiber.type===n.toolRendering.h3.type)&&message?.type==='collapsed_read_search'&&typeof message.uuid==='string'&&message.uuid.length<=256&&Array.isArray(message.messages)){
   const blocks=message.messages.flatMap(row=>row.type==='assistant'?[row]:row.type==='grouped_tool_use'?row.messages:[]).map(row=>row.message.content[0]).filter(block=>block?.type==='tool_use');
   if(blocks.length&&blocks.length<=256&&new Set(blocks.map(block=>block.id)).size===blocks.length&&blocks.every(block=>typeof block.id==='string'&&block.id&&block.id.length<=256)){
    const calls=blocks.map(block=>{const result=props.lookups.toolResultByToolUseID.get(block.id);return {tool_use_id:block.id,tool:block.name,input:block.input,isRunning:props.inProgressToolUseIDs.has(block.id),isErrored:props.lookups.erroredToolUseIDs.has(block.id),isInterrupted:n.engine.aK.isInterruptedCall(result),output:result?.type==='user'?result.toolUseResult:undefined};});
    const memberRevisions=calls.map(call=>createHash('sha256').update(JSON.stringify([call,props.lookups.toolResultByToolUseID.get(call.tool_use_id)?.uuid])).digest('hex')),isActive=props.isActiveCollapsedGroup===true,revision=createHash('sha256').update(JSON.stringify([message.uuid,memberRevisions,isActive])).digest('hex');
    if(groups.has(message.uuid)&&groups.get(message.uuid).revision!==revision)ambiguous.add(message.uuid);
    groups.set(message.uuid,{id:message.uuid,calls,memberRevisions,isActive,revision});
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 for(const id of ambiguous)groups.delete(id);if(groups.size>256)throw Error('Native tool group count exceeded bound');return groups;
}
function nativeToolGroupList(n,client){return [...nativeToolGroups(n).values()].map(group=>{const frame=toolGroupFrames.get(JSON.stringify([client,group.id]));return {id:group.id,members:group.calls.map((call,index)=>({toolUseId:call.tool_use_id,revision:group.memberRevisions[index]})),usesEngine:frame?.usesEngine??true,isActive:group.isActive,revision:group.revision,initialized:!!frame,isExpanded:frame?(frame.needsRender?frame.expanded:frame.shownExpanded):false};});}
function currentToolGroupAction(n,request){
 if(request.component!=='ToolGroup')return;
 const frame=toolGroupFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 if(!frame||nativeToolGroups(n).get(request.instance_id)?.revision!==frame.revision)throw Error('Native tool group changed or expired');
}
function refreshNativeToolGroups(n){
 if(!clients.size)return;let groups;
 try{groups=nativeToolGroups(n);}catch{
  for(const frame of toolGroupFrames.values())n.nativeClients.release(frame.clientId,'ToolGroup',frame.id);
  if(toolGroupSnapshot!=='unavailable'){toolGroupSnapshot='unavailable';publish({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[...toolGroupRevisions.keys()].map(id=>({surface:'desktop',component:'ToolGroup',instance_id:id}))});toolGroupRevisions.clear();}return;
 }
 const changed=[...new Set([...toolGroupRevisions.keys(),...groups.keys()])].filter(id=>toolGroupRevisions.get(id)!==groups.get(id)?.revision);
 if(!changed.length&&toolGroupSnapshot!=='unavailable')return;toolGroupSnapshot='ready';toolGroupRevisions.clear();for(const group of groups.values())toolGroupRevisions.set(group.id,group.revision);
 for(const frame of toolGroupFrames.values()){
  if(!groups.has(frame.id))n.nativeClients.release(frame.clientId,'ToolGroup',frame.id);
  else if(groups.get(frame.id).revision!==frame.revision)n.nativeClients.suspend([{surface:'desktop',component:'ToolGroup',requestId:frame.id}]);
 }
 publish({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:changed.map(id=>({surface:'desktop',component:'ToolGroup',instance_id:id}))});
}
function toolGroupDrawing(value,tree,instanceRevision){
 const frame=toolGroupFrames.get(JSON.stringify([value.client_id,value.instance_id]));
 if(!frame||instanceRevision===undefined||!nativeDrawingUsesEngine(tree))return tree;
 if(toolGroupHandle>=Number.MAX_SAFE_INTEGER)throw Error('Native group action identity exhausted');toolGroupPlugin??='apack-tool-group:'+randomUUID();frame.toggleHandle=++toolGroupHandle;frame.instanceRevision=instanceRevision;
 return {type:'Box',props:{flexDirection:'column',gap:0},children:[{type:'Button',props:{key:'expand-group',_apackExpanded:frame.shownExpanded,label:frame.shownExpanded?'Collapse tool activity':'Expand tool activity',variant:'secondary'},press:{plugin:toolGroupPlugin,handle:frame.toggleHandle}},tree]};
}
function runToolGroupAction(n,request,abort){
 if(request.subtype!=='ui_press'||toolGroupPlugin===undefined||request.plugin!==toolGroupPlugin)return;
 const frame=toolGroupFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 if(request.component!=='ToolGroup'||request.key!=='expand-group'||!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id)||!frame||frame.toggleHandle!==request.handle||frame.instanceRevision!==request.instance_revision||!instanceLifetimes.active(request,request.instance_revision)||nativeToolGroups(n).get(request.instance_id)?.revision!==frame.revision)return {handled:false};
 abort.signal.throwIfAborted();delete frame.toggleHandle;frame.expanded=!frame.shownExpanded;frame.needsRender=true;
 publish({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,client_id:request.client_id,instances:[{surface:'desktop',component:'ToolGroup',instance_id:request.instance_id}]});return {handled:true};
}`
