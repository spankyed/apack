/** Desktop settings retain original describe hooks, config.set validation and dialog ownership. */
export const claudeTerminalSettingsRuntime = String.raw`
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
 const revision=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 return {snapshot:{revision,rows},handles,api};
}
async function nativeSettings(n,request,abort){
 await n.gate._Jo('desktop');
 const entry=nativeSettingsPanel(request),read=await readNativeSettings(n,entry,abort.signal);nativeSettingsPanel(request);
 if(request.operation==='read')return {snapshot:read.snapshot};
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
  const after=await readNativeSettings(n,entry,controller.signal);nativeSettingsPanel(request);
  const acknowledged=result&&result.deny===undefined&&Object.hasOwn(result,'value');
  return {snapshot:after.snapshot,...(acknowledged?{savedKey:request.key}:{problem:typeof result?.deny==='string'?result.deny:'Claude Code did not acknowledge this setting'})};
 }finally{entry.settingsBusy=false;abort.signal.removeEventListener('abort',cancel);}
}
`
