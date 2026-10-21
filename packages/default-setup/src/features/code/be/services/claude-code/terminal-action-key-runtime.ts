import { withClaudeDesktopActionFallbacks } from './native-action-fallbacks.ts'

/** Original key admission, with callbacks kept in the mounted desktop view's authority. */
export const claudeTerminalActionKeyRuntime = `${withClaudeDesktopActionFallbacks.toString()}\n` + String.raw`
const nativeActionProviderHashes=new WeakMap();
function readNativeActionKeyProvider(n){
 const owner=n.themeRoots.ai().get(process.stdout),root=owner?.container?.current;
 if(!root)return;
 const expected={nvt:'6edf8bd3b931a479f0396aaba3c24e95d024688ff923fdeb4786595753da185c',Yt:'e5fe403fa1df1d1a78036cc6c000de59e2f1fd60f012b324b1fd5ce1ea7f6ad9'};
 const pending=[root],seen=new Set(),found=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)return;seen.add(fiber);
  if(typeof fiber.type==='function'&&Object.hasOwn(expected,fiber.type.name)){
   let hash=nativeActionProviderHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');nativeActionProviderHashes.set(fiber.type,hash);}
   if(hash!==expected[fiber.type.name])return;
   found.push(fiber);
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 const providers=found.filter(f=>f.type.name==='nvt'),dispatchers=found.filter(f=>f.type.name==='Yt');
 if(providers.length!==1||dispatchers.length!==1)return;
 const props=providers[0].memoizedProps,context=providers[0].child?.memoizedProps?.value,dispatcher=dispatchers[0];
 if(!context||context.bindings!==props.bindings||dispatcher.memoizedProps?.handlerRegistryRef!==props.handlerRegistryRef||typeof context.registerHandler!=='function'||typeof context.setPendingChord!=='function'||!(props.handlerRegistryRef?.current instanceof Map)||!Array.isArray(props.bindings)||props.bindings.length>8192)return;
 const nodes=[dispatcher.child],visited=new Set(),captures=[];
 while(nodes.length){
  const fiber=nodes.pop();if(!fiber||visited.has(fiber))continue;if(visited.size>=4096)return;visited.add(fiber);
  const node=fiber.stateNode;if(node?.attributes?.keybindingScope==='Global'&&typeof node._eventHandlers?.onKeyDownCapture==='function')captures.push(node);
  if(fiber.sibling)nodes.push(fiber.sibling);if(fiber.child)nodes.push(fiber.child);
 }
 if(captures.length!==1)return;
 return {owner,props,context,node:captures[0],capture:captures[0]._eventHandlers.onKeyDownCapture};
}
function createNativeActionKeyBridge({current,view,changed,provider=readNativeActionKeyProvider,requestId=(n,scope)=>scope.instance_id}){
 const frames=new Map(),published=new Map();let sequence=0,pendingClient,pendingRef,pendingValue,pendingBindings;
 const frameKey=s=>JSON.stringify([s.client_id,s.component,s.instance_id]);
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 function held(n,frame,button){
  if(!frame.active||!current(n,frame.scope)||frame.view!==view(n)||!n.engine.FPe(button.plugin))return false;
  const request={subtype:'ui_press',surface:'desktop',...frame.scope,...button.press};
  const client=n.nativeClients.action(frame.scope.client_id,request);if(client===false)return false;if(client)return true;
  const entry=n.engine.r5.heldPress(button.plugin,button.press.handle,button.press.key);
  return entry?.component===frame.scope.component&&entry.requestId===requestId(n,frame.scope);
 }
 function buttons(n,client){
  const result=[];for(const frame of frames.values())if(frame.scope.client_id===client)for(const button of frame.buttons)if(held(n,frame,button))result.push({frame,button});return result;
 }
 function ownedPending(p){return p?.props.pendingChordRef===pendingRef&&p.props.pendingChordRef.current===pendingValue&&pendingValue!==null&&pendingValue!==undefined;}
 function cancelPending(n,client){
  if(pendingClient!==client)return;
  const p=provider(n);if(ownedPending(p))p.context.setPendingChord(null);
  pendingClient=undefined;pendingRef=undefined;pendingValue=undefined;pendingBindings=undefined;
 }
 function state(n,client){
  const p=provider(n),entries=buttons(n,client),binding= n.runtime.ey();
  const blocked=!p||binding?.surface!=='terminal'||typeof binding.toolContext!=='function'||n.nativeKeyDialogs.gk(binding.toolContext(new AbortController()).dialogStore.getState())!==null;
  const bindingHash=p?hash(p.props.bindings):undefined;
  const actions=new Set(entries.map(e=>e.button.action));
  const contexts=new Set(p?.props.bindings.map(b=>b.context));
  const bindings=[];
  if(!blocked)for(const action of actions)for(const context of contexts)for(const chord of n.nativeKeyBindings.o_o(action,context,p.props.bindings))if(chord.length)bindings.push(chord);
  const foreignPending=p?.props.pendingChordRef.current!=null&&!ownedPending(p);
  const effective=foreignPending?[]:bindings;
  const revision=hash([view(n),client,blocked,bindingHash,entries.map(e=>[e.frame.scope.component,e.frame.scope.instance_id,e.button.identity,e.button.sequence]),p?[...p.props.activeContexts]:[]]);
  const continuations=[],seenContinuations=new Set();
  if(effective.length)for(const binding of p.props.bindings){
   if(typeof binding.action!=='string'||!Array.isArray(binding.chord)||binding.chord.length<2||!effective.some(chord=>n.nativeKeyBindings.FUe(chord[0],binding.chord[0])))continue;
   const pair=JSON.stringify([binding.action,binding.context]);if(seenContinuations.has(pair))continue;seenContinuations.add(pair);
   for(const chord of n.nativeKeyBindings.o_o(binding.action,binding.context,p.props.bindings))if(chord.length>1&&effective.some(candidate=>n.nativeKeyBindings.FUe(candidate[0],chord[0])))continuations.push(chord);
  }
  return {p,entries,blocked,bindingHash,keys:{revision,bindings:effective,continuations,pending:!blocked&&pendingClient===client&&ownedPending(p)?pendingValue:null}};
 }
 function snapshot(n,client){try{
  const keys=state(n,client).keys;
  // Bound optional key metadata independently; ordinary drawing remains available without it.
  if(Buffer.byteLength(JSON.stringify(keys))>262144)return {revision:keys.revision,bindings:[],continuations:[],pending:null};
  return keys;
 }catch{return {revision:hash(['unavailable',client]),bindings:[],continuations:[],pending:null};}}
 function capture(n,scope,tree){
  if(scope.surface!=='desktop')return;
  const key=frameKey(scope),previous=frames.get(key),found=[],occurrences=new Map(),nodes=[{node:tree,depth:0}];let count=0;
  while(nodes.length){
   const {node,depth}=nodes.pop();if(++count>8192||depth>32){frames.delete(key);return;}
   if(!node||typeof node!=='object'||Array.isArray(node))continue;
   if(node.type==='Client')continue;
   if(node.type==='Button'&&typeof node.props?.action==='string'&&typeof node.props.key==='string'&&typeof node.press?.plugin==='string'&&Number.isSafeInteger(node.press.handle)&&n.nativeKeyBindings.hCs(node.props.action)&&!n.nativeKeyBindings.fCs(node.props.action)){
    const base=JSON.stringify([node.press.plugin,node.props.key,node.props.action]),occurrence=occurrences.get(base)??0;occurrences.set(base,occurrence+1);
    const identity=JSON.stringify([base,occurrence]),prior=previous?.view===view(n)?previous.buttons.find(b=>b.identity===identity):undefined;
    found.push({identity,sequence:prior?.sequence??++sequence,action:node.props.action,plugin:node.press.plugin,press:{plugin:node.press.plugin,handle:node.press.handle,key:node.props.key}});
   }
   if(Array.isArray(node.children))for(let i=node.children.length-1;i>=0;i--)nodes.push({node:node.children[i],depth:depth+1});
  }
  if(!found.length){frames.delete(key);return;}
  if(!frames.has(key)&&frames.size>=4096)return;
  frames.set(key,{active:true,view:view(n),scope:{client_id:scope.client_id,component:scope.component,instance_id:scope.instance_id,...(scope.instance_revision!==undefined?{instance_revision:scope.instance_revision}:{})},buttons:found});
 }
 function invalidate(scope){const frame=frames.get(frameKey(scope));if(frame)frame.active=false;}
 function retire(scope){frames.delete(frameKey(scope));}
 function detach(n,client){cancelPending(n,client);for(const[key,frame]of frames)if(frame.scope.client_id===client)frames.delete(key);published.delete(client);}
 function poll(n){
  if(pendingClient!==undefined){const value=state(n,pendingClient);if(value.blocked||!value.entries.length||value.bindingHash!==pendingBindings)cancelPending(n,pendingClient);}
  const clients=new Set([...frames.values()].map(frame=>frame.scope.client_id));for(const client of published.keys())clients.add(client);
  for(const client of clients){const keys=snapshot(n,client),encoded=JSON.stringify(keys);if(published.get(client)!==encoded){published.set(client,encoded);changed(client,keys);}}
 }
 async function key(n,request,abort,press){
  const input=request.event;
  if(typeof request.client_id!=='string'||typeof request.revision!=='string'||!input||typeof input.key!=='string'||!input.key.length||input.key.length>32||['ctrl','alt','shift','super','from_composer'].some(flag=>typeof input[flag]!=='boolean'))throw Error('Invalid native action key');
  abort.signal.throwIfAborted();
  let before=state(n,request.client_id),p=before.p;
  if(before.blocked||!p){cancelPending(n,request.client_id);return {handled:false,action_keys:snapshot(n,request.client_id)};}
  if(ownedPending(p)&&pendingClient===request.client_id&&pendingBindings!==before.bindingHash){cancelPending(n,request.client_id);before=state(n,request.client_id);p=before.p;}
  if(pendingClient!==request.client_id&&ownedPending(p)){cancelPending(n,pendingClient);before=state(n,request.client_id);p=before.p;}
  const continuing=pendingClient===request.client_id&&ownedPending(p)&&pendingBindings===before.bindingHash;
  if(request.revision!==before.keys.revision&&!continuing)return {handled:false,action_keys:snapshot(n,request.client_id)};
  const name=input.key==='enter'?'return':input.key===' '?'space':input.key;
  const event=new n.nativeKeyEvents.zDe({name,sequence:input.key==='enter'?'\r':input.key==='escape'?'\x1b':input.key.length===1?input.key:'',ctrl:input.ctrl,shift:input.shift,meta:input.alt,super:input.super,fn:false});
  const normalized=n.nativeKeyBindings.Xwe(event);
  if(!continuing&&(!normalized||input.from_composer&&!input.ctrl&&!input.alt&&!input.super||!before.keys.bindings.some(chord=>n.nativeKeyBindings.FUe(chord[0],normalized))))return {handled:false,action_keys:snapshot(n,request.client_id)};
  let admitted;
  const candidates=[...new Set(before.entries.map(e=>e.button.action))].map(action=>({action,contexts:[...new Set(p.props.bindings.filter(b=>b.action===action).map(b=>b.context))]}));
  const rank=e=>e.frame.scope.component==='Pane'?2:e.frame.scope.component==='AbovePrompt'?1:0;
  const admit=action=>{
   const eligible=buttons(n,request.client_id).filter(e=>e.button.action===action).sort((a,b)=>rank(b)-rank(a)||b.button.sequence-a.button.sequence);
   if(!eligible.length)return false;admitted=eligible[0];return true;
  };
  withClaudeDesktopActionFallbacks(p.props.handlerRegistryRef.current,candidates,entry=>p.context.registerHandler(entry),admit,()=>{
   const handlers=p.node._eventHandlers,original=handlers.onKeyDownCapture;
   // Keep original event phases/discrete updates, but leave text editing to the app's composer.
   const capture=source=>{try{p.capture(source);}finally{source.stopImmediatePropagation();}};
   handlers.onKeyDownCapture=capture;
   try{n.nativeKeyEvents.R8.dispatchDiscrete(p.owner.focusManager.activeElement??p.owner.rootNode,event);}
   finally{if(handlers.onKeyDownCapture===capture)handlers.onKeyDownCapture=original;}
  });
  const pending=p.props.pendingChordRef.current;
  if(pending!=null){pendingClient=request.client_id;pendingRef=p.props.pendingChordRef;pendingValue=pending;pendingBindings=before.bindingHash;}
  else if(pendingClient===request.client_id){pendingClient=undefined;pendingRef=undefined;pendingValue=undefined;pendingBindings=undefined;}
  let handled=event.defaultPrevented===true;
  if(admitted){
   abort.signal.throwIfAborted();
   if(!held(n,admitted.frame,admitted.button)||frames.get(frameKey(admitted.frame.scope))!==admitted.frame)return {handled:false,action_keys:snapshot(n,request.client_id)};
   const result=await press({subtype:'ui_press',surface:'desktop',...admitted.frame.scope,...admitted.button.press});handled=result.handled===true;
  }
  poll(n);return {handled,action_keys:snapshot(n,request.client_id)};
 }
 function clear(n){if(pendingClient!==undefined)cancelPending(n,pendingClient);frames.clear();published.clear();}
 return {capture,invalidate,retire,detach,snapshot,poll,key,clear};
}
`
