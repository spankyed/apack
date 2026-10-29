/** Authored tickets around original command execution, independent of one HTTP request. */
export const claudeTerminalParentCommandRuntime = String.raw`
const parentCommands=new Map(),parentCommandLoaders=new WeakSet();
function parentCommandScope(n,entry,transition=false){
 const facts=nativeViewFacts(n,originalContext??n.runtime.ey(),new AbortController());
 if(facts.view.kind!=='main')throw Error('Native parent command view changed');
 if(facts.sessionId===entry.sessionId&&facts.sequence===entry.sequence){
  if(!clients.has(entry.clientId)||!clientViewCurrent(n,entry.clientId))throw Error('Native parent command client detached');
  return facts;
 }
 const run=entry.lifecycle;
 if(transition&&run?.returned&&run.reset&&run.sessionAfter!==entry.sessionId&&facts.sessionId===run.sessionAfter&&facts.sequence===run.sequenceAfter)return facts;
 throw Error('Native parent command session or selection changed');
}
function observeNativeParentCommand(command){
 if(parentCommandLoaders.has(command))return;
 const descriptor=Object.getOwnPropertyDescriptor(command,'load');
 if(!descriptor?.writable||typeof descriptor.value!=='function')throw Error('Original native command loader cannot be observed');
 const originalLoad=descriptor.value,modules=new WeakMap();
 const wrap=module=>{
  if(!module||typeof module.call!=='function')return module;
  if(modules.has(module))return modules.get(module);
  const descriptor=Object.getOwnPropertyDescriptor(module,'call');
  if(descriptor&&!descriptor.configurable&&descriptor.writable===false)throw Error('Original native command call cannot be observed');
  const original=module.call;let proxy;
  const call=function(...args){
   const operation=agentDispatch,entry=operation?.parentTicket;
   if(!entry||operation.commandDefinition!==command||entry.lifecycle)return Reflect.apply(original,this===proxy?module:this,args);
   const run=entry.lifecycle={started:true},context=args[1],query=context&&Object.getOwnPropertyDescriptor(context,'onQueryEvent');
   run.commandMessageId=typeof context?.commandMessageUuid==='string'?context.commandMessageUuid:undefined;
   let restore=()=>{};
   if(query?.writable&&typeof query.value==='function'){
    const originalQuery=query.value,observe=function(event,...rest){if(event?.type==='conversation_reset'&&typeof event.newConversationId==='string')run.reset={conversationId:event.newConversationId};return Reflect.apply(originalQuery,this,[event,...rest]);};
    context.onQueryEvent=observe;restore=()=>{if(context.onQueryEvent===observe)Object.defineProperty(context,'onQueryEvent',query);};
   }
   const returned=value=>{restore();run.returned=true;const after=nativeViewFacts(operation.native,originalContext??operation.native.runtime.ey(),new AbortController());run.sessionAfter=after.sessionId;run.sequenceAfter=after.sequence;run.resultType=value?.type;run.emptyText=value?.type==='text'&&value.value==='';const boundary=value?.compactionResult?.boundaryMarker;if(boundary?.type==='system'&&boundary.subtype==='compact_boundary'&&boundary.compactMetadata?.trigger==='manual')run.boundaryId=boundary.uuid;return value;};
   const failed=error=>{restore();run.failed=true;throw error;};
   try{const result=Reflect.apply(original,this===proxy?module:this,args);return result&&typeof result.then==='function'?result.then(returned,failed):returned(result);}catch(error){return failed(error);}
  };
  proxy=new Proxy(module,{get(target,key,receiver){return key==='call'?call:Reflect.get(target,key,receiver);}});modules.set(module,proxy);return proxy;
 };
 command.load=function(...args){const result=Reflect.apply(originalLoad,this,args);return result&&typeof result.then==='function'?result.then(wrap):wrap(result);};parentCommandLoaders.add(command);
}
async function nativeParentCommand(n,request){
 await n.gate._Jo('desktop');
 if(request.operation==='prepare'){
  if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native parent command client detached');
  const binding=originalContext??n.runtime.ey(),facts=nativeViewFacts(n,binding,new AbortController());
  if(facts.view.kind!=='main')throw Error('Return to the native main view before running a parent command');
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>32768)throw Error('Native input is empty or too long');
  const prepared=n.runtime.GYt(request.text,{}),parsed=n.commandInput.IS(prepared.input.trimEnd()),command=parsed&&n.engine.Rs(parsed.commandName,binding.commands());
  if(!command||!['local','local-jsx'].includes(command.type))return {kind:'not_command'};
  if(prepared.removed.removedTotal>0)return {kind:'review',text:prepared.input,removed:prepared.removed.removedTotal};
  for(const [id,entry] of parentCommands)if(entry.state==='prepared'&&Date.now()-entry.createdAt>30000||parentCommands.size>=16&&['finished','failed'].includes(entry.state))parentCommands.delete(id);
  if(parentCommands.size>=16||[...parentCommands.values()].some(entry=>entry.state==='running'))throw Error('A native parent command is pending');
  const id=randomUUID(),entry={id,clientId:request.client_id,sessionId:facts.sessionId,sequence:facts.sequence,text:prepared.input,createdAt:Date.now(),state:'prepared'};
  parentCommands.set(id,entry);return {kind:'prepared',id};
 }
 const entry=parentCommands.get(request.command_id);
 if(!entry||entry.clientId!==request.client_id)throw Error('Native parent command ticket expired');
 parentCommandScope(n,entry,true);
 if(request.operation==='read')return {kind:entry.state,id:entry.id,...(entry.result?{result:entry.result}:{}),...(entry.error?{message:entry.error}:{})};
 if(request.operation!=='start'||entry.state!=='prepared'||Date.now()-entry.createdAt>30000)throw Error('Native parent command ticket is expired or already used');
 parentCommandScope(n,entry);
 if(agentDispatch||[...parentCommands.values()].some(value=>value!==entry&&value.state==='running')||[...agentCommandDialogs.values()].some(value=>!value.closed))throw Error('A native command is pending');
 entry.state='running';
 // The ticket is already held by the requester if this short start reply is lost during reset.
 setTimeout(()=>{void dispatchNativeInput(n,{client_id:entry.clientId,text:entry.text},new AbortController(),true,entry).then(result=>{entry.result=result;entry.state='finished';},error=>{entry.error=String(error?.message??error);entry.state='failed';});},0);
 return {kind:'running',id:entry.id};
}
`
