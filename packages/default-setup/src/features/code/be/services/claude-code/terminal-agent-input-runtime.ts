/** Authored correlation around the original terminal dispatcher; no copied command policy. */
export const claudeTerminalAgentInputRuntime = String.raw`
let agentDispatch;
const agentCommandHosts=new WeakMap(),agentCommandDialogs=new Map();
function installAgentCommandObserver(context){
 const host=context.localJsx;if(!host||typeof host.show!=='function'||agentCommandHosts.has(host))return;
 const original=host.show;
 host.show=function(element,options){
  const request=agentDispatch,props=element?.props,matching=request?.commandName!==undefined&&request.commandName===options?.commandName;
  const capture=matching&&!request.dialog&&typeof props?.title==='string'&&typeof props?.confirmLabel==='string'&&typeof props?.onConfirm==='function'&&typeof props?.onCancel==='function';
  const handle=Reflect.apply(original,this,arguments);
  const dialog=context.dialogStore?.getState?.().open?.find(item=>item.kind==='local_jsx'&&item.payload?.nodeId===handle?.nodeId);
  const panel=matching&&!request.dialog&&!capture&&typeof options?.commandName==='string'&&dialog&&typeof context.dialogStore.dismiss==='function';
  if(capture||panel){
   const entry={context,originalProps:props,originalType:element.type,kind:panel?'panel':'confirmation',id:randomUUID(),nodeId:handle.nodeId,dialogId:dialog?.id,store:context.dialogStore,clientId:request.clientId,taskId:request.taskId,sessionId:request.sessionId,sequence:request.sequence,title:props.title,confirmLabel:props.confirmLabel,commandName:options?.commandName,confirm:props.onConfirm,cancel:panel?()=>context.dialogStore.dismiss(dialog.id):props.onCancel,closed:false,current:request.current,restore:request.restore};
   if(panel&&options.commandName==='workflows'&&request.parentTicket?.workflowResumeTaskId&&typeof props?.onDone==='function')entry.workflowDone=props.onDone;
   request.dialog=entry;agentCommandDialogs.set(entry.id,entry);
   entry.done=Promise.resolve(handle.closed).then(async()=>{await entry.restore();entry.closed=true;if(entry.kind!=='panel')agentCommandDialogs.delete(entry.id);});
   for(const [id,old] of agentCommandDialogs)if(agentCommandDialogs.size>16&&old.closed)agentCommandDialogs.delete(id);
   void entry.done.catch(()=>{});
  }
  return handle;
 };
 agentCommandHosts.set(host,original);
}
async function answerNativeAgentCommand(n,request){
 const entry=agentCommandDialogs.get(request.command_id);
 if(!entry||entry.kind!=='confirmation'||entry.clientId!==request.client_id||entry.closed||entry.answered||!['confirm','cancel'].includes(request.decision))throw Error('Native command confirmation expired');
 entry.current();if(request.decision==='confirm')await n.gate._Jo('desktop');entry.current();entry.answered=true;
 try{await (request.decision==='confirm'?entry.confirm:entry.cancel)();await entry.done;return {answered:true};}
 catch(error){if(!entry.closed)entry.answered=false;throw error;}
}
async function nativeAgentPanel(n,request){
 await n.gate._Jo('desktop');
 const entry=agentCommandDialogs.get(request.panel_id);
 if(!entry||entry.kind!=='panel'||entry.clientId!==request.client_id)throw Error('Native command panel expired');
 entry.current();
 if(request.operation==='read')return {open:!entry.closed};
 if(entry.closed||entry.answered)throw Error('Native command panel expired');
 const shown=entry.store.getState().open.some(item=>item.id===entry.dialogId&&item.kind==='local_jsx'&&item.payload?.nodeId===entry.nodeId);
 if(!shown)throw Error('Native command panel is no longer shown');
 if(request.operation==='close'){entry.answered=true;try{await entry.cancel();await entry.done;}catch(error){if(!entry.closed)entry.answered=false;throw error;}return {open:false};}
 if(request.operation!=='input'||typeof request.text!=='string'||!request.text.length||request.text.length>4096)throw Error('Invalid native panel input');
 // Deliver synchronously to the original mounted terminal listeners after checking its live dialog.
 process.stdin.unshift(request.text);process.stdin.emit('readable');
 return {open:!entry.closed};
}
async function retireNativeAgentCommands(clientId){
 const retired=[];
 for(const entry of agentCommandDialogs.values())if((clientId===undefined||entry.clientId===clientId)&&!entry.answered&&!entry.closed){entry.answered=true;try{entry.cancel();retired.push(entry.done);}catch{entry.closed=true;agentCommandDialogs.delete(entry.id);} }
 await Promise.allSettled(retired);
 for(const [id,entry] of agentCommandDialogs)if((clientId===undefined||entry.clientId===clientId)&&entry.closed)agentCommandDialogs.delete(id);
}
async function dispatchNativeAgentInput(n,request,abort){return dispatchNativeInput(n,request,abort,false);}
async function dispatchNativeInput(n,request,abort,main,parentTicket){
 await n.gate._Jo('desktop');
 if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native Agent UI client is detached');
 if(agentDispatch||[...agentCommandDialogs.values()].some(entry=>!entry.closed))throw Error('A native Agent submission or command is pending');
 const binding=originalContext??n.runtime.ey(),facts=nativeViewFacts(n,binding,abort);
 if(main?facts.view.kind!=='main':facts.view.kind!=='agent'||!facts.view.taskId)throw Error(main?'Return to the native main view before running a parent command':'No native Agent is selected');
 const identityCurrent=()=>{const now=nativeViewFacts(n,binding,new AbortController());if(now.sessionId!==facts.sessionId||now.sequence!==facts.sequence)throw Error('Native Agent selection changed');};
 const viewCurrent=()=>{identityCurrent();if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native Agent UI client is detached');};
 const current=()=>{abort.signal.throwIfAborted();viewCurrent();};
 if(typeof request.text!=='string'||!request.text.trim()||request.text.length>(main?32768:16384))throw Error('Native input is empty or too long');
 const prepared=n.runtime.GYt(request.text,{});
 const text=prepared.input.trimEnd(),context=binding.toolContext(abort),composer=binding.composer;
 const parsed=n.commandInput.IS(text),command=parsed&&n.engine.Rs(parsed.commandName,binding.commands());
 const expectedRun=command&&['local','local-jsx'].includes(command.type)?n.engine.Cie(command,parsed.args):undefined;
 if(main&&!expectedRun)return {kind:'not_command'};
 if(prepared.removed.removedTotal>0)return {kind:'review',text:prepared.input,removed:prepared.removed.removedTotal};
 const task=main?undefined:Object.values(context.taskRegistry.all()).find(value=>n.runtime.flt(value)?.id===facts.view.taskId);
 if(!main&&(!task||task.type!=='local_agent'||task.resuming))throw Error('This Agent cannot accept input now');
 const original=await composer.read();current();
 if(original.text)throw Error('The native terminal has an unsent draft; your app draft was retained');
 const saved=main?[]:await binding.savedAgentMessages(facts.view.taskId);current();
 const before=new Set([...(saved??[]),...(task?context.taskRegistry.getTranscript(task.id)?.messages??[]:[])].map(row=>row.uuid));
 const notices=()=>{const state=context.getAppState();return [state.notifications?.current,...(state.notifications?.queue??[])].filter(Boolean);};
 const priorNotices=new Set(notices());
 const parentBefore=new Set((binding.messages?.()??[]).map(row=>row.uuid));
 const restore=async()=>{try{identityCurrent();const draft=await composer.read();identityCurrent();if(draft.text.trimEnd()===text)await composer.write(original.text,'replace');}catch{} };
 if(parentTicket&&command.type==='local')observeNativeParentCommand(command);
 const operation={native:n,parentTicket,commandDefinition:command,clientId:request.client_id,taskId:facts.view.taskId,sessionId:facts.sessionId,sequence:facts.sequence,commandName:expectedRun?.command,current:viewCurrent,restore,dialog:undefined};
 agentDispatch=operation;installAgentCommandObserver(context);
 try{
  await composer.write(text,'replace');current();
  if((await composer.read()).text!==text)throw Error('Original native draft preparation was not acknowledged');
  current();await ownerPost('/view-enter',{pid:process.pid,kind:facts.view.kind,taskId:facts.view.taskId,revision:facts.sequence});
  const deadline=Date.now()+4000;
  while(parentTicket||Date.now()<deadline){
   if(parentTicket){
    abort.signal.throwIfAborted();
    const run=parentTicket.lifecycle;
    if(run?.failed)throw Error('Original native command failed after dispatch; do not retry automatically');
    if(run?.reset&&!run.returned){await new Promise(resolve=>setTimeout(resolve,20));continue;}
    parentCommandScope(n,parentTicket,true);
    if(run?.returned&&run.commandMessageId){
     if(run.reset&&run.sessionAfter!==facts.sessionId)return {kind:'command_complete',commandName:expectedRun.command,messageId:run.commandMessageId,sessionId:run.sessionAfter,conversationId:run.reset.conversationId};
     if(run.resultType==='compact'&&run.boundaryId&&(binding.messages?.()??[]).some(row=>row.uuid===run.boundaryId&&row.type==='system'&&row.subtype==='compact_boundary'))return {kind:'command_complete',commandName:expectedRun.command,messageId:run.commandMessageId,boundaryId:run.boundaryId};
     if(run.emptyText)return {kind:'command_complete',commandName:expectedRun.command,messageId:run.commandMessageId};
    }
   }else current();
   if(operation.dialog){const value=operation.dialog;if(value.kind==='panel')return {kind:'panel',id:value.id,commandName:value.commandName};return {kind:'confirmation',id:value.id,title:value.title,confirmLabel:value.confirmLabel,commandName:value.commandName};}
   const rows=task?context.taskRegistry.getTranscript(task.id)?.messages??[]:[];
   const row=rows.find(row=>!before.has(row.uuid)&&row.type==='user'&&row.isMeta!==true&&row.origin?.kind==='human'&&row.message?.content===text);
   if(row)return {kind:'input',messageId:row.uuid,previousStatus:task.status};
   if(expectedRun){
    const outputs=(binding.messages?.()??[]).filter(row=>!parentBefore.has(row.uuid)&&row.type==='system'&&row.subtype==='local_command'&&row.commandRun?.command===expectedRun.command&&row.commandRun?.args===expectedRun.args&&row.commandRun?.plugin===expectedRun.plugin);
    if(outputs.length===1){
     const row=outputs[0],result=n.commandOutput.s4t(row.content,row.uuid,row.timestamp,row.contextUsage,row.commandRun,row.usageReport,row.commandOutcome),content=result?.message?.content;
     const output=typeof content==='string'?content:Array.isArray(content)?content.filter(block=>block.type==='text').map(block=>block.text).join('\n'):undefined;
     if(typeof output==='string'&&output.length>0&&output.length<=65536)return {kind:'command_output',messageId:row.uuid,commandName:expectedRun.command,text:output,isErrored:(n.commandTags.Ms(row.content,'local-command-stderr')??'').trim()!=='',...(typeof row.commandOutcome?.kind==='string'?{outcome:row.commandOutcome.kind}:{})};
    }
   }
   const notice=notices().find(value=>!priorNotices.has(value)&&value.key==='agent-view-command-notice');
   if(notice){await restore();return {kind:'blocked',message:notice.text??notice.segments?.map(segment=>segment.text??'').join('')??'Native command was blocked'};}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('Original native submission had no acknowledged outcome; your app draft was retained');
 }finally{if(agentDispatch===operation)agentDispatch=undefined;if(!operation.dialog)await restore();}
}
`
