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
 await waitForNativeSettingsConfig(n,entry,signal);
 const api=await import('/$bunfs/root/chunk-1ghyy712.js');
 const context=entry.context;let handles=api.configRowHandles(context);
 if(await refreshNativeSettingsConfigCallbacks(n,entry,handles,signal)){
  handles=api.configRowHandles(context);
  const descriptors=nativeSettingsMountedDescriptors(n,entry);
  for(const expected of handles.map(handle=>handle.row).filter(row=>['autoUpdatesChannel','remoteHomeSettings'].includes(row.key))){
   const mounted=descriptors.filter(row=>row.id===expected.key);
   if(mounted.length!==1||!Object.is(expected.value,mounted[0].value))throw Error('Native Settings changed during refresh; refresh before editing');
  }
 }
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
  for(const row of nativeSettingsMountedConsentRows(n,entry)){if(!rows.some(existing=>existing.key===row.key))rows.push(row);}
  if(frame.hidden){const native=await waitForNativeSettingsEditor(n,entry,signal);if(native)editor={...native.snapshot,revision:native.revision};}
  else {delete entry.settingsEditorLabel;const controls=await nativeSettingsEditorOpeners(n,entry);for(const row of rows){const provider=handles.find(handle=>handle.row.key===row.key)?.row.provider;const supported=row.key==='outputStyle'||row.key==='language'||row.key==='theme'||row.key==='model'||row.key==='agentsView'||row.key==='notifChannel'||row.key==='showExternalIncludesDialog'||row.key==='autoUpdatesChannel'||row.key==='remoteHomeSettings'||typeof provider?.plugin==='string'&&provider.plugin!=='engine';if(supported&&controls.openers.has(row.key)&&!row.isLocked)row.editorAvailable=true;if(row.key==='remoteHomeSettings'&&controls.notices?.has(row.key))row.description=controls.notices.get(row.key);}}
 }

 let problem,savedKey;
 const commit=entry.settingsCommit;
 if(commit){
  const row=rows.find(row=>row.key===commit.key);
  if(!row){delete entry.settingsCommit;problem='The native setting is no longer available. Refresh to check its current state.';}
  else if(!Object.is(row.value,commit.before)){if(commit.scalar)savedKey=commit.key;delete entry.settingsCommit;}
  else if(Date.now()>=commit.until){delete entry.settingsCommit;problem='Claude Code has not acknowledged the setting change. Refresh to check its current value.';}
 }
 const commitPending=!!entry.settingsCommit;
 // Timed copy feedback is presentation state, not authority to change settings or Stats controls.
 const revisionFrame=frame.stats?{...frame,stats:{...frame.stats,copyState:undefined}}:frame;
 const revision=createHash('sha256').update(JSON.stringify({rows,frame:revisionFrame,editor,commitPending})).digest('hex');
 return {snapshot:{revision,rows,frame,...editor?{editor}:{},...commitPending?{commitPending:true}:{}},...problem?{problem}:{},...savedKey?{savedKey}:{},handles,api};
}
async function nativeSettings(n,request,abort){
 await n.gate._Jo('desktop');
 const entry=nativeSettingsPanel(request),isEditorCancel=request.operation==='editor'&&request.command?.action==='cancel';
 let cancelledLease;
 if(entry.settingsEditorLease){
  const lease=entry.settingsEditorLease;
  if(isEditorCancel){
   if(lease.revision!==request.editor_revision||lease.panelRevision!==request.revision)throw Error('Native Settings editor changed before cancellation');
   cancelledLease=lease;lease.controller.abort(Error('Native Settings editor cancelled'));
  }else if(request.operation!=='read')throw Error('A native Settings editor operation is pending');
 }
 if(entry.settingsConfigRefresh)throw Error('Native Settings refresh is already pending');
 const read=await readNativeSettings(n,entry,abort.signal);nativeSettingsPanel(request);
 if(request.operation==='read')return {snapshot:read.snapshot,...read.problem?{problem:read.problem}:{},...read.savedKey?{savedKey:read.savedKey}:{}};
 if(entry.settingsCommit&&request.operation!=='editor')throw Error('A native setting change is pending');
 if(request.operation==='open'||request.operation==='editor'){
  if(entry.settingsCommit&&!isEditorCancel)throw Error('A native setting change is pending');
  const editorRow=read.snapshot.rows.find(row=>row.key===entry.settingsEditorKey);
  // Background Config cache updates do not retire an unchanged, still-advertised editor.
  const currentEditor=request.operation==='editor'&&!!read.snapshot.editor&&read.snapshot.editor.revision===request.editor_revision&&editorRow&&!editorRow.isLocked;
  if(request.revision!==read.snapshot.revision&&!currentEditor&&!cancelledLease)throw Error('Native Settings changed; refresh before editing');
  if(isEditorCancel){
   const current=await readNativeSettingsEditor(n,entry,abort.signal);nativeSettingsPanel(request);
   if(!current&&cancelledLease){
    const config=nativeSettingsConfig(n,entry);if(!sameNativeSettingsFiber(config.owner,cancelledLease.owner))throw Error('Native Settings editor owner changed before cancellation');
    return {snapshot:read.snapshot};
   }
   if(!current||cancelledLease&&!sameNativeSettingsFiber(current.owner,cancelledLease.owner))throw Error('Native Settings editor owner changed before cancellation');
   const result=await actNativeSettingsEditor(n,entry,{action:'cancel',revision:cancelledLease?current.revision:request.editor_revision},abort.signal);
   await new Promise(resolve=>setTimeout(resolve,40));nativeSettingsPanel(request);
   return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot,...result};
  }
  if(entry.settingsEditorLease)throw Error('A native Settings editor operation is pending');
  const controller=new AbortController(),cancel=()=>controller.abort(abort.signal.reason);
  abort.signal.addEventListener('abort',cancel,{once:true});if(abort.signal.aborted)cancel();
  if(!entry.settingsEditorLifetime){entry.settingsEditorLifetime=new AbortController();void entry.done.then(()=>entry.settingsEditorLifetime.abort(),()=>entry.settingsEditorLifetime.abort());}
  const retire=()=>controller.abort();entry.settingsEditorLifetime.signal.addEventListener('abort',retire,{once:true});if(entry.settingsEditorLifetime.signal.aborted)retire();
  let lease;
  try{
   const native=request.operation==='editor'?await readNativeSettingsEditor(n,entry,controller.signal):undefined;
   if(entry.settingsEditorLease)throw Error('A native Settings editor operation is pending');
   if(request.operation==='editor'&&(!native||native.revision!==request.editor_revision))throw Error('Native Settings editor changed; refresh before editing');
   lease={controller,revision:request.editor_revision,panelRevision:request.revision,owner:native?.owner};entry.settingsEditorLease=lease;
   if(request.operation==='open'){
    const visible=new Set(read.snapshot.rows.filter(row=>row.editorAvailable&&!row.isLocked).map(row=>row.key));
    entry.settingsEditorLabel=read.snapshot.rows.find(row=>row.key===request.key)?.label;entry.settingsEditorKey=request.key;
    const openingRow=read.snapshot.rows.find(row=>row.key===request.key);
    await activateNativeSettingsEditor(n,entry,request.key,visible,controller.signal);
    // Stable/slow opens perform the original direct switch instead of mounting a picker.
    if(request.key==='autoUpdatesChannel'&&['stable','slow'].includes(openingRow?.value)){
     const opened=await readNativeSettings(n,entry,controller.signal);
     if(!opened.snapshot.editor&&!opened.snapshot.frame.hidden)entry.settingsCommit={key:request.key,before:openingRow.value,until:Date.now()+5000};
    }
   }else{
    const command=request.command;
    if(!command||!['select','save','preview','toggleSyntax','focusModel','adjustEffort','setGroup'].includes(command.action))throw Error('Native Settings editor command changed');
    const result=command.action==='save'?await saveNativeSettingsEditor(n,entry,request.editor_revision,command.values,controller.signal):await actNativeSettingsEditor(n,entry,{...command,revision:request.editor_revision},controller.signal);
    nativeSettingsPanel(request);
    if(result?.problem)return {snapshot:(await readNativeSettings(n,entry,controller.signal)).snapshot,problem:result.problem};
    const row=read.snapshot.rows.find(row=>row.key===entry.settingsEditorKey);
    const language=entry.settingsEditorKey==='language'&&command.action==='save';
    const selected=command.action==='select'?command.value:language?command.values?.language:command.values?.value;
    const proposed=row?.kind==='number'?Number(selected):selected;
    const sameChoice=command.action==='select'&&read.snapshot.editor?.kind==='choice'&&Object.is(read.snapshot.editor.value,selected);
    // This only identifies a no-op draft; the original submit callback owns normalization and writes.
    const sameLanguage=language&&typeof selected==='string'&&read.snapshot.editor?.kind==='form'&&selected.trim()===(read.snapshot.editor.fields.find(field=>field.key==='language')?.value??'').trim();
    if(row&&entry.settingsEditorKey!=='remoteHomeSettings'&&!read.snapshot.editor?.consent&&selected!==undefined&&!sameChoice&&!sameLanguage&&!Object.is(row.value,proposed))entry.settingsCommit={key:row.key,before:row.value,until:Date.now()+5000};
   }
   controller.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,40));nativeSettingsPanel(request);
   return {snapshot:(await readNativeSettings(n,entry,controller.signal)).snapshot};
  }finally{
   if(entry.settingsEditorLease===lease)delete entry.settingsEditorLease;
   abort.signal.removeEventListener('abort',cancel);entry.settingsEditorLifetime.signal.removeEventListener('abort',retire);
  }
 }
 if(request.operation==='stats'){
  if(request.revision!==read.snapshot.revision)throw Error('Native Settings changed; refresh before changing Stats');
  await actNativeSettingsStats(n,entry,request.action,abort.signal);nativeSettingsPanel(request);
  return {snapshot:(await readNativeSettings(n,entry,abort.signal)).snapshot};
 }
 if(request.operation==='tab'){
  // Navigation carries no row value. The live panel/hidden-tab fences own it, even after background updates.
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
  if(acknowledged&&!Object.is(result.value,handle.row.value)&&['boolean','choice','number'].includes(handle.row.kind)){
   // An accepted callback may precede native cache refresh; the existing read loop owns acknowledgement.
   entry.settingsCommit={key:request.key,before:visible.value,until:Date.now()+5000,scalar:true};
  }
  const after=await readNativeSettings(n,entry,controller.signal);nativeSettingsPanel(request);
  if(!acknowledged)return {snapshot:after.snapshot,problem:typeof result?.deny==='string'?result.deny:'Claude Code did not acknowledge this setting'};
  if(after.problem)return {snapshot:after.snapshot,problem:after.problem};
  return {snapshot:after.snapshot,...after.snapshot.commitPending?{}:{savedKey:request.key}};

 }finally{entry.settingsBusy=false;abort.signal.removeEventListener('abort',cancel);}
}
`
