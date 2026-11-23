/** The original settings store owns diagnostic discovery and policy effects. */
export const claudeManagedSettingsDiagnosticRuntime=String.raw`async function readNativeManagedSettingsDiagnostics(current){
 if(!current())throw Error('Native settings diagnostic view is detached');
 const settings=await import('/$bunfs/root/chunk-1pjd7qsk.js');
 if(!current())throw Error('Native settings diagnostic view changed');
 const source=settings.D_();
 if(!Array.isArray(source)||source.length>256)throw Error('Native settings diagnostics exceed desktop limit');
 const diagnostics=source.map(({file,path,message,severity,errorClass,errno,statusOnly,userWritable})=>({file,path,message,severity,errorClass,errno,statusOnly,userWritable}));
 if(JSON.stringify(diagnostics).length>131072)throw Error('Native settings diagnostic output exceeds desktop limit');
 return diagnostics;
}
const nativeLinuxManagedSettingsFile='/etc/claude-code/managed-settings.json';
function nativeManagedFileStamp(){
 accessSync(nativeLinuxManagedSettingsFile,fsConstants.R_OK);
 const stat=statSync(nativeLinuxManagedSettingsFile,{bigint:true});
 if(!stat.isFile())throw Error('Claude managed settings is not a file');
 return [stat.dev,stat.ino,stat.mode,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
}
let nativeManagedFileRecheckInFlight=false;
async function recheckNativeManagedSettings(n,request,abort){
 if(nativeManagedFileRecheckInFlight)throw Error('Claude is already rechecking managed settings');
 nativeManagedFileRecheckInFlight=true;
 try{return await runNativeManagedSettingsRecheck(n,request,abort);}
 finally{nativeManagedFileRecheckInFlight=false;}
}
async function runNativeManagedSettingsRecheck(n,request,abort){
 if(process.platform!=='linux')throw Error('Managed settings recheck is unavailable on this platform');
 await n.gate._Jo('desktop');
 const settings=await import('/$bunfs/root/chunk-1pjd7qsk.js');
 const detector=await import('/$bunfs/root/chunk-ayzz9bjs.js');
 const hooks=await import('/$bunfs/root/chunk-ne2pzqpv.js');
 const current=()=>{
  abort.signal.throwIfAborted();
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal')throw Error('Claude settings owner changed');
  const facts=nativeViewFacts(n,binding,abort);
  const sameView=request.task_id===undefined?facts.view.kind==='main':facts.view.kind==='agent'&&facts.view.taskId===request.task_id;
  if(!sameView||facts.sessionId!==request.session_id||facts.sequence!==request.view_revision)throw Error('Claude settings owner changed');
  return binding.toolContext(abort);
 };
 const hasWarning=()=>settings.D_().some(row=>row.file===nativeLinuxManagedSettingsFile&&row.errno==='EACCES');
 const context=current();
 if(!hasWarning())return {rechecked:true};
 if(!detector.Ta.isWatching())throw Error('Claude settings watcher is unavailable');
 const stamp=nativeManagedFileStamp();
 // Invoke the same ConfigChange callback installed by the original foreground watcher.
 if(await hooks.dAe(context.session,context.storageV5,context.credentials)('policy_settings',nativeLinuxManagedSettingsFile))throw Error('Claude declined the managed settings recheck');
 current();
 if(!hasWarning())return {rechecked:true};
 if(stamp!==nativeManagedFileStamp())throw Error('The managed settings file changed during the recheck');
 detector.Ta.notifyChange('policySettings');
 publish({type:'system',subtype:'ui_invalidate',event:'ui.render',managed_settings_diagnostics:true});
 return {rechecked:true};
}
`
