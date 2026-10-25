import { claudeTerminalSettingsEditorRuntime } from './terminal-settings-editor-runtime.ts'
import { claudeTerminalSettingsFrameRuntime } from './terminal-settings-frame-runtime.ts'

/** Desktop settings retain original describe hooks, config.set validation and dialog ownership. */
export const claudeTerminalSettingsRuntime = String.raw`
${claudeTerminalSettingsFrameRuntime}
${claudeTerminalSettingsEditorRuntime}
function nativeSettingsPanel(request){
 const entry=agentCommandDialogs.get(request.panel_id);
 if(!entry||entry.kind!=='panel'||entry.commandName!=='config'||entry.clientId!==request.client_id||entry.closed||entry.answered)throw Error('Native Settings panel expired');
 entry.current();
 if(!entry.store.getState().open.some(item=>item.id===entry.dialogId&&item.kind==='local_jsx'&&item.payload?.nodeId===entry.nodeId))throw Error('Native Settings panel replaced');
 return entry;
}
async function readNativeSettings(n,entry,signal){
 const api=await import('/$bunfs/root/chunk-1ghyy712.js');
 const context=entry.context,handles=api.configRowHandles(context);
 if(!Array.isArray(handles)||handles.length>256)throw Error('Native Settings row limit exceeded');
 const rows=[];
 for(const handle of handles){
  signal?.throwIfAborted();entry.current();if(entry.closed||entry.answered)throw Error('Native Settings panel expired');
  const described=await n.runtime.p_r(handle.row);
  if(!described)continue;
  const row={key:described.key,label:described.label,...(described.description!==undefined?{description:described.description}:{}),kind:described.kind,value:described.value??null,...(described.options?{options:described.options}:{}),isLocked:described.isLocked===true,...(handle.lockReason?{lockReason:handle.lockReason}:{})};
  rows.push(row);
 }
 const frame=await readNativeSettingsFrame(n,entry,signal);
 let editor;
 if(frame.selectedTab==='Config'){
  if(frame.hidden){const native=await readNativeSettingsEditor(n,entry,signal);if(native)editor={...native.snapshot,revision:native.revision};}
  else {const controls=await nativeSettingsEditorOpeners(n,entry);for(const row of rows)if(controls.openers.has(row.key)&&!row.isLocked)row.editorAvailable=true;}
 }

 // Timed copy feedback is presentation state, not authority to change settings or Stats controls.
 const revisionFrame=frame.stats?{...frame,stats:{...frame.stats,copyState:undefined}}:frame;
 const revision=createHash('sha256').update(JSON.stringify({rows,frame:revisionFrame,editor})).digest('hex');
 return {snapshot:{revision,rows,frame,...editor?{editor}:{}},handles,api};
}
async function nativeSettings(n,request,abort){
 await n.gate._Jo('desktop');
 const entry=nativeSettingsPanel(request),read=await readNativeSettings(n,entry,abort.signal);nativeSettingsPanel(request);
 if(request.operation==='read')return {snapshot:read.snapshot};
 if(request.operation==='open'||request.operation==='editor'){
  if(request.revision!==read.snapshot.revision)throw Error('Native Settings changed; refresh before editing');
  if(request.operation==='open'){
   const visible=new Set(read.snapshot.rows.filter(row=>row.editorAvailable&&!row.isLocked).map(row=>row.key));
   await activateNativeSettingsEditor(n,entry,request.key,visible,abort.signal);
  }else{
   const command=request.command;
   if(!command||!['select','save','cancel'].includes(command.action))throw Error('Native Settings editor command changed');
   const result=command.action==='save'?await saveNativeSettingsEditor(n,entry,request.editor_revision,command.values,abort.signal):await actNativeSettingsEditor(n,entry,{...command,revision:request.editor_revision},abort.signal);
   nativeSettingsPanel(request);
   if(result?.problem)return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot,problem:result.problem};
  }
  await new Promise(resolve=>setTimeout(resolve,40));nativeSettingsPanel(request);
  return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot};
 }
 if(request.operation==='stats'){
  if(request.revision!==read.snapshot.revision)throw Error('Native Settings changed; refresh before changing Stats');
  await actNativeSettingsStats(n,entry,request.action,abort.signal);nativeSettingsPanel(request);
  return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot};
 }
 if(request.operation==='tab'){
  if(request.revision!==read.snapshot.revision)throw Error('Native Settings changed; refresh before switching tabs');
  await selectNativeSettingsTab(n,entry,request.tab,abort.signal);nativeSettingsPanel(request);
  return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot};
 }
 if(request.operation!=='write'||typeof request.key!=='string'||request.revision!==read.snapshot.revision)throw Error('Native Settings changed; refresh before saving');
 const visible=read.snapshot.rows.find(row=>row.key===request.key),handle=read.handles.find(handle=>handle.row.key===request.key);
 if(!visible||!handle)throw Error('Native setting is no longer visible');
 if(entry.settingsBusy)throw Error('A native setting is being saved');
 entry.settingsBusy=true;
 const controller=new AbortController(),cancel=()=>controller.abort();abort.signal.addEventListener('abort',cancel,{once:true});
 if(abort.signal.aborted)cancel();void entry.done.then(cancel,cancel);
 try{
  const result=await n.runtime.Ims({...handle,value:request.value,origin:{kind:'composer'},signal:controller.signal,write:async value=>{
   controller.signal.throwIfAborted();nativeSettingsPanel(request);
   // Hooks may hold or rewrite the value. Recheck original ownership immediately before its writer.
   const fresh=read.api.configRowHandles(entry.context).find(item=>item.row.key===request.key);
   if(!fresh||JSON.stringify(fresh.row)!==JSON.stringify(handle.row)||fresh.lockReason!==handle.lockReason)throw Error('Native setting changed while a hook was deciding');
   return fresh.write(value);
  }});
  controller.signal.throwIfAborted();nativeSettingsPanel(request);
  const acknowledged=result&&result.deny===undefined&&Object.hasOwn(result,'value');
  let pending=false;
  if(acknowledged&&!Object.is(result.value,handle.row.value)){
   // Original toggle callbacks may return before their queued atomic write invalidates merged settings.
   const until=Date.now()+1500;
   while(true){
    controller.signal.throwIfAborted();nativeSettingsPanel(request);
    const fresh=read.api.configRowHandles(entry.context).find(item=>item.row.key===request.key);
    pending=!!fresh&&Object.is(fresh.row.value,handle.row.value);
    if(!pending||Date.now()>=until)break;
    await new Promise(resolve=>setTimeout(resolve,40));
   }
  }
  const after=await readNativeSettings(n,entry,controller.signal);nativeSettingsPanel(request);
  const waiting=pending&&['boolean','choice','number'].includes(handle.row.kind);
  return {snapshot:after.snapshot,...(acknowledged&&!waiting?{savedKey:request.key}:{problem:waiting?'Claude Code acknowledged the write, but its current value has not updated. Refresh to check it.':typeof result?.deny==='string'?result.deny:'Claude Code did not acknowledge this setting'})};
 }finally{entry.settingsBusy=false;abort.signal.removeEventListener('abort',cancel);}
}
`
