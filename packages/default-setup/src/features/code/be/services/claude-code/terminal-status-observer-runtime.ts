/** Shared native helper observation for cold and claimed warm workers. */
export const claudeTerminalStatusObserverRuntime = String.raw`import { ChildProcess } from 'node:child_process';
import { readFileSync,writeFileSync,renameSync,unlinkSync } from 'node:fs';
import http from 'node:http';
/** Resolve once, after a claimed spare has its real argv and environment. Never start a helper. */
export function installNativeHelperObserver({resolveConfig,readPolicy,readCommands,onReady,reconcileSignalledMain}){
 let signalledMain;
 let heldConfig,activation,retainedMainStartedAt=-1n,latestMainStartedAt=-1n,latestMainObservation,mainObservationPending=false,closed=false,warned=false;
 const warn=()=>{if(!warned){warned=true;process.stderr.write('apack: native helper observation could not initialize\n')}};
 async function publish(path,body){const config=heldConfig.config;await new Promise(resolve=>{const request=http.request({socketPath:config.socketPath,path,method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:500},response=>{response.resume();response.on('end',resolve)});request.on('error',resolve);request.on('timeout',()=>{request.destroy();resolve()});request.end(JSON.stringify({...body,ownerEpoch:config.transportEpoch}))})}
 const original=ChildProcess.prototype.spawn;
 function ensureConfig(){
  if(heldConfig||closed)return heldConfig;
  const configUrl=resolveConfig();if(!configUrl)return;
  const config=JSON.parse(readFileSync(configUrl,'utf8'));heldConfig={configUrl,config};
  activation=(async()=>{
   if(typeof original!=='function'){await publish('/observer-error',{sessionId:config.sessionId,message:'Native child-process observation is unavailable'});return}
   await publish('/observer-ready',{sessionId:config.sessionId,pid:process.pid});await onReady?.(heldConfig);
  })();activation.catch(warn);return heldConfig;
 }
const installed=function(...args){
 let held;try{held=ensureConfig()}catch{warn()}
 if(!held||closed)return Reflect.apply(original,this,args);
 const {config,configUrl}=held;
 const startedAt=process.hrtime.bigint().toString();let startedGenerations,policyKey,commands;try{policyKey=readPolicy?.()}catch{}try{commands={...readCommands()}}catch{}try{startedGenerations=JSON.parse(readFileSync(configUrl,'utf8')).generations}catch{}
 const result=Reflect.apply(original,this,args),child=this;
 const executedCommand=child.spawnargs?.at(-1);
 const argument=value=>/^[A-Za-z0-9_./:=@+,-]+$/.test(value)?value:"'"+value.replaceAll("'", "'\"'\"'")+"'";
 function observedCommand(){
  const configured=commands?.[kind],prefix=commands?.prefix;
  if(typeof configured!=='string'||executedCommand===configured||typeof prefix!=='string'||!prefix)return executedCommand;
  // Native shell prefixes receive the whole configured command as one quoted argument.
  const split=prefix.lastIndexOf(' -');
  const invocation=split>0?argument(prefix.slice(0,split))+' '+prefix.slice(split+1)+' '+argument(configured):argument(prefix)+' '+argument(configured);
  return executedCommand===invocation?configured:executedCommand;
 }
 const input=[],output=[];let inputBytes=0,outputBytes=0,ending=false,payload,kind,generation,invalid=false;
 function remember(chunk,encoding){if(chunk===undefined||chunk===null||typeof chunk==='function'||inputBytes>1048576)return;const bytes=typeof chunk==='string'?Buffer.from(chunk,typeof encoding==='string'?encoding:'utf8'):ArrayBuffer.isView(chunk)?Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength):undefined;if(!bytes)return;inputBytes+=bytes.length;if(inputBytes<=1048576)input.push(Buffer.from(bytes))}
 function classify(){if(inputBytes>1048576)return;try{const value=JSON.parse(Buffer.concat(input).toString('utf8'));if(!value||typeof value.session_id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.session_id)||value.hook_event_name)return;const sub=Array.isArray(value.tasks)&&typeof value.columns==='number';if(!sub&&(typeof value.version!=='string'||!value.cost||!value.context_window))return;payload=value;kind=sub?'subagent':'main';generation=startedGenerations?.[kind];if(typeof generation!=='string')invalid=true;if(kind==='main'&&BigInt(startedAt)>latestMainStartedAt){latestMainStartedAt=BigInt(startedAt);latestMainObservation=undefined;mainObservationPending=true;}}catch{}}
 if(child.stdin){const write=child.stdin.write,end=child.stdin.end;child.stdin.write=function(...values){try{if(!ending)remember(values[0],values[1])}catch{invalid=true}return Reflect.apply(write,this,values)};child.stdin.end=function(...values){try{remember(values[0],values[1]);classify()}catch{invalid=true}ending=true;try{return Reflect.apply(end,this,values)}finally{ending=false}}}
 if(child.stdout){const emit=child.stdout.emit;child.stdout.emit=function(event,...values){if(event==='data'&&kind&&outputBytes<=32768)try{const bytes=typeof values[0]==='string'?Buffer.from(values[0],this.readableEncoding??'utf8'):values[0];outputBytes+=bytes.length;if(outputBytes<=32768)output.push(Buffer.from(bytes))}catch{invalid=true}return Reflect.apply(emit,this,[event,...values])}}
 child.once('close',(code,signal)=>{if(kind==='main'&&BigInt(startedAt)===latestMainStartedAt)mainObservationPending=false;if(closed||!kind||invalid)return;const cancelled=args[0]?.signal?.aborted===true,command=observedCommand();const event={sessionId:payload.session_id,parentPid:process.pid,childPid:child.pid,kind,generation,...(policyKey===undefined?{}:{policyKey}),command,...(command!==executedCommand?{executedCommand}:{}),startedAt,code,signal:cancelled?'aborted':signal,stdout:Buffer.concat(output).toString('utf8'),truncated:outputBytes>32768,...(kind==='main'?{totalCostUsd:payload.cost.total_cost_usd}:{tasks:payload.tasks.slice(0,256).map(task=>({id:task.id,status:task.status}))})};
 if(kind==='main'&&typeof policyKey==='string'&&BigInt(startedAt)===latestMainStartedAt&&Buffer.byteLength(JSON.stringify(event))<=262144)latestMainObservation={...event};
 // The owned worker starts this observer before CLI code. Keep only its latest original main
 // result until registration claims startup, without delaying or reexecuting the native helper.
 if(kind==='main'&&config.jobSessionId&&typeof policyKey==='string')try{
  const current=JSON.parse(readFileSync(configUrl,'utf8'));
  if(current.mainObservationClaimed===false&&current.generations?.main===generation&&BigInt(startedAt)>retainedMainStartedAt){
   const target=new URL('./startup-main.json',configUrl),temporary=new URL('./startup-main.tmp',configUrl);
   const text=JSON.stringify(event);if(Buffer.byteLength(text)>262144)throw Error('Native startup observation exceeds bound');
   try{writeFileSync(temporary,text,{mode:0o600,flag:'wx'});renameSync(temporary,target);retainedMainStartedAt=BigInt(startedAt);}finally{try{unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error}}
  }
 }catch{process.stderr.write('apack: native helper startup observation could not be retained\n')}
 // The original renderer keeps its caption when its scheduler cancels a refresh.
 // A raw child signal can also come from a real failure. Wait for the native caption
 // to clear before projecting that failure; a newer settled result replaces it.
 if(kind==='main'&&reconcileSignalledMain?.()){
  if(event.signal){
   if(BigInt(startedAt)===latestMainStartedAt)signalledMain=event;
   return;
  }
  if(signalledMain&&BigInt(startedAt)>=BigInt(signalledMain.startedAt))signalledMain=undefined;
 }
 reportResult(event);});
 return result;
};
 if(typeof original==='function')ChildProcess.prototype.spawn=installed;
 else warn();
 function reportResult(event){void publish('/native-status',event).catch(()=>{})}
 return{
  get signalledMainStartedAt(){return signalledMain?.startedAt},
  reconcileMainStatus(startedAt,snapshot){
   const event=signalledMain;
   if(closed||!event||startedAt!==event.startedAt)return;
   if(event.sessionId!==snapshot.sessionId||event.command!==snapshot.statusCommand){signalledMain=undefined;return;}
   if(snapshot.cachedMainStatus!==null)return;
   signalledMain=undefined;reportResult(event);
  },
  get mainObservationPending(){return !closed&&mainObservationPending},get mainObservation(){return !closed&&latestMainObservation?{...latestMainObservation}:undefined},async activate(){ensureConfig();await activation},close(){closed=true;signalledMain=undefined;latestMainObservation=undefined;if(ChildProcess.prototype.spawn===installed)ChildProcess.prototype.spawn=original}};
}
`
