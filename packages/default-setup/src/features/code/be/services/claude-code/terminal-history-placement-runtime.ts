/** Mirror committed terminal-only placements without redispatching their native hooks. */
export const claudeTerminalHistoryPlacementRuntime = String.raw`const terminalPlacementFrames=new Map(),terminalPlacementSeen=new Map();
const terminalPlacementSignatures={
 Pg:{component:'TurnDuration',hash:'53b5427fec9b423983b721ed3152f419c62aab735d8d0fc50a797d92c80c40a8',slot:9},
 Uo:{component:'InfoNotice',hash:'32790fda3445a2da7f59d62c7e62ea9ecdb8602f82e5ab51b0497e192d687ef1',slot:8}
};
const terminalDefaultSignatures={
 TurnDuration:{name:'Eg',hash:'bae302522b9c14ab6c8c71b843f47f1c52e70b334e7a32d51b1f9e8c4132e451',slot:33},
 InfoNotice:{name:'yd',hash:'b9e8fced6d2763d7e2373765523e8c6219f677ea5cdd8473f5c292ed9639787f',slot:2}
};
function isTerminalPlacement(component){return component==='TurnDuration'||component==='InfoNotice';}
function terminalDefaultDrawing(source,props){
 const spec=terminalDefaultSignatures[source.component],pending=source.fiber.child?[source.fiber.child]:[],seen=new Set();
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native default drawing traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===spec.name){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash===spec.hash){
    const current=fiber.memoizedProps;
    if(source.component==='TurnDuration'&&(current?.verb!==props.word||current?.message?.durationMs!==props.durationMs))continue;
    if(source.component==='InfoNotice'&&(current?.command!==(props.command??undefined)||current?.children!==(props.text===source.props.text?source.fiber.memoizedProps?.children:props.text)))continue;
    const cache=fiber.updateQueue?.memoCache?.data?.[0];if(!cache||!(spec.slot in cache))throw Error('Original terminal drawing cache changed');return cache[spec.slot];}
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
}
function terminalAnchorIds(n,source){
 if(source.component!=='TurnDuration')return [];
 const rows=(originalContext??n.runtime.ey()).messages?.()??[],index=rows.findIndex(row=>row.uuid===source.id&&row.type==='system'&&row.subtype==='turn_duration');
 if(index<0)return [];
 const ids=[];for(let i=index-1;i>=0&&ids.length<256;i--){const row=rows[i];if(row.type==='system'&&row.subtype==='turn_duration')break;if((row.type==='assistant'||row.type==='user')&&typeof row.uuid==='string'&&row.uuid.length<=256)ids.push(row.uuid);}
 return ids;
}
function terminalHostedDrawing(n,source,tree){
 let count=0;
 const visit=node=>{
  if(typeof node==='string'||!node||typeof node!=='object')return node;
  if(++count>2048)throw Error('Native hosted drawing exceeds limit');
  let press=node.press;
  if(press){
   const matches=n.engine.r5.hostedButtonsOf(press.plugin,node.props?.key).filter(item=>item.button.handle===press.handle&&item.button.tag===node.type&&item.button.surface==='terminal'&&item.button.component===source.component&&item.button.requestId===source.input.requestId);
   if(matches.length!==1)throw Error('Original terminal action is not uniquely hosted');
   press={...press,handle:matches[0].hosted};
  }
  return{...node,...(press?{press}:{}),...(Array.isArray(node.children)?{children:node.children.map(visit)}:{})};
 };
 return visit(tree);
}
function nativeTerminalPlacements(n){
 const result=new Map(),sources=nativeComposerInputs(n,terminalPlacementSignatures,65536,128);
 for(const source of sources.values()){
  const onScreen=n.engine.vfe.askedOnScreen(source.input),input=onScreen===undefined?source.input:{...source.input,props:{...source.input.props,onScreen}};
  const hooked=n.engine.aK.hasRenderHooksFor(input),settled=hooked?n.engine.vfe.settled(input):undefined;if(hooked&&settled===undefined)continue;
  const tree=settled??{type:'engine',ref:0},raw=JSON.stringify(tree);if(raw.length>65536)throw Error('Native terminal placement drawing exceeds limit');
  let props=input.props,foundInput=false,hasClient=false,hasIneligiblePart=false;const pending=[tree];let nodes=0;
  while(pending.length){if(++nodes>2048)throw Error('Native terminal drawing exceeds node limit');const node=pending.pop();
   if(node?.type==='Client')hasClient=true;
   if(node?.part?.plugin&&n.engine.FPe(node.part.plugin)===false)hasIneligiblePart=true;
   if(!foundInput&&node?.type==='engine'&&node.ref){const held=n.engine.aK.heldRenderInput(tree,node.ref);if(held?.component===source.component){props=held.props;foundInput=true}}
   if(Array.isArray(node?.children))pending.push(...[...node.children].reverse());
  }
  if(hasClient||hasIneligiblePart)continue;
  let hosted;try{hosted=terminalHostedDrawing(n,source,tree)}catch{continue}
  const drawing=nativeDrawingUsesEngine(tree)?terminalDefaultDrawing(source,props):undefined;
  if(nativeDrawingUsesEngine(tree)&&drawing===undefined)continue;
  let drawingId=0;if(drawing&&typeof drawing==='object'){if(!composerFactoryIds.has(drawing))composerFactoryIds.set(drawing,++composerFactorySequence);drawingId=composerFactoryIds.get(drawing);}
  const id=source.component==='InfoNotice'?'notice-'+createHash('sha256').update(source.id).digest('hex'):source.id,anchorIds=terminalAnchorIds(n,source);
  const fingerprint=createHash('sha256').update(JSON.stringify([source.fingerprint,input.viewport,input.props,raw,hosted,props,drawingId,anchorIds])).digest('hex');
  result.set(JSON.stringify([source.component,id]),{...source,id,input,props,tree:hosted,drawing,hooked,anchorIds,fingerprint});
 }
 return result;
}
function terminalPlacementList(n){return [...nativeTerminalPlacements(n).values()].map(source=>({component:source.component,id:source.id,revision:source.fingerprint,anchorIds:source.anchorIds}));}
function terminalPlacementFacts(n,component,id){return nativeTerminalPlacements(n).get(JSON.stringify([component,id]));}
function currentTerminalPlacementAction(n,request){
 if(!isTerminalPlacement(request.component))return;
 const frame=terminalPlacementFrames.get(JSON.stringify([request.client_id,request.component,request.instance_id])),source=frame&&terminalPlacementFacts(n,request.component,request.instance_id);
 if(!source||source.fingerprint!==frame.fingerprint)throw Error('Native terminal placement changed or expired');
 return source;
}
function refreshTerminalPlacements(n){
 if(!clients.size)return;
 let list;try{list=terminalPlacementList(n)}catch{list=[]}
 for(const client of clients){if(!clientViewCurrent(n,client))continue;
  const next=new Map(list.map(item=>[JSON.stringify([item.component,item.id]),item.revision])),prior=terminalPlacementSeen.get(client),changed=[];
  for(const[key,revision]of next)if(!prior||prior.get(key)!==revision){const[component,id]=JSON.parse(key);n.nativeClients.suspendInstance(client,component,id);changed.push({surface:'desktop',component,instance_id:id});}
  for(const key of prior?.keys()??[])if(!next.has(key)){const[component,id]=JSON.parse(key);terminalPlacementFrames.delete(JSON.stringify([client,component,id]));changed.push({surface:'desktop',component,instance_id:id});}
  terminalPlacementSeen.set(client,next);if(changed.length)publish({type:'system',subtype:'ui_invalidate',event:'ui.render',terminal_placements:true,client_id:client,instances:changed});
 }
}
async function renderTerminalPlacement(n,value,clientId,instanceRevision,abort){
 const facts=terminalPlacementFacts(n,value.component,value.instance_id);if(!facts||facts.fingerprint!==value.props?.source_revision)throw Error('Native terminal placement changed before rendering');
 let engineOutput;
 if(nativeDrawingUsesEngine(facts.tree)){
  if(facts.drawing===null||facts.drawing===false)engineOutput='';else{
   const theme=nativeThemeProvider(n),tree=n.jsx.e(theme.type,{value:theme.value,children:facts.drawing});
   // This is the already-computed native default, with no live task store or viewport ref attached.
   engineOutput=await n.staticRender.v6e(tree,{columns:Math.max(20,Math.min(240,value.viewport?.columns??80))});
   if(typeof engineOutput!=='string'||engineOutput.length>65536)throw Error('Native terminal output exceeds limit');
  }
 }
 abort.signal.throwIfAborted();if(!clientViewCurrent(n,clientId)||instanceRevision!==undefined&&!instanceLifetimes.active({client_id:clientId,component:value.component,instance_id:value.instance_id},instanceRevision)||terminalPlacementFacts(n,value.component,value.instance_id)?.fingerprint!==facts.fingerprint)throw Error('Native terminal placement expired while rendering');
 terminalPlacementFrames.set(JSON.stringify([clientId,value.component,value.instance_id]),{fingerprint:facts.fingerprint});
 return{tree:nativeThemeTree(n,facts.tree),props:facts.props,rewritten:JSON.stringify(facts.props)!==JSON.stringify(facts.input.props),hooked:facts.hooked,...(engineOutput!==undefined?{engine_output:engineOutput}:{}),drawn_by:[]};
}
`
