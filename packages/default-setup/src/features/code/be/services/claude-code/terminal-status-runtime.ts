/** Authored preload observes native helper I/O without changing commands or stream flow. */
export const claudeTerminalStatusRuntime = String.raw`import { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
const configUrl=new URL('./observer.json',import.meta.url);
const config=JSON.parse(readFileSync(configUrl,'utf8'));
if(config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
async function publish(path,body){await new Promise(resolve=>{const request=http.request({socketPath:config.socketPath,path,method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:500},response=>{response.resume();response.on('end',resolve)});request.on('error',resolve);request.on('timeout',()=>{request.destroy();resolve()});request.end(JSON.stringify(body))})}
let readNativeHelperPolicy;
const original=ChildProcess.prototype.spawn;
if(typeof original!=='function')await publish('/observer-error',{sessionId:config.sessionId,message:'Native child-process observation is unavailable'});
else {
ChildProcess.prototype.spawn=function(...args){
 const startedAt=process.hrtime.bigint().toString();let startedGenerations,policyKey;try{policyKey=readNativeHelperPolicy?.()}catch{}try{startedGenerations=JSON.parse(readFileSync(configUrl,'utf8')).generations}catch{}
 const result=Reflect.apply(original,this,args),child=this;
 const input=[],output=[];let inputBytes=0,outputBytes=0,ending=false,payload,kind,generation,invalid=false;
 function remember(chunk,encoding){if(chunk===undefined||chunk===null||typeof chunk==='function'||inputBytes>1048576)return;const bytes=typeof chunk==='string'?Buffer.from(chunk,typeof encoding==='string'?encoding:'utf8'):ArrayBuffer.isView(chunk)?Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength):undefined;if(!bytes)return;inputBytes+=bytes.length;if(inputBytes<=1048576)input.push(Buffer.from(bytes))}
 function classify(){if(inputBytes>1048576)return;try{const value=JSON.parse(Buffer.concat(input).toString('utf8'));if(!value||typeof value.session_id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.session_id)||value.hook_event_name)return;const sub=Array.isArray(value.tasks)&&typeof value.columns==='number';if(!sub&&(typeof value.version!=='string'||!value.cost||!value.context_window))return;payload=value;kind=sub?'subagent':'main';generation=startedGenerations?.[kind];if(typeof generation!=='string')invalid=true}catch{}}
 if(child.stdin){const write=child.stdin.write,end=child.stdin.end;child.stdin.write=function(...values){try{if(!ending)remember(values[0],values[1])}catch{invalid=true}return Reflect.apply(write,this,values)};child.stdin.end=function(...values){try{remember(values[0],values[1]);classify()}catch{invalid=true}ending=true;try{return Reflect.apply(end,this,values)}finally{ending=false}}}
 if(child.stdout){const emit=child.stdout.emit;child.stdout.emit=function(event,...values){if(event==='data'&&kind&&outputBytes<=32768)try{const bytes=typeof values[0]==='string'?Buffer.from(values[0],this.readableEncoding??'utf8'):values[0];outputBytes+=bytes.length;if(outputBytes<=32768)output.push(Buffer.from(bytes))}catch{invalid=true}return Reflect.apply(emit,this,[event,...values])}}
 child.once('close',(code,signal)=>{if(!kind||invalid)return;const cancelled=args[0]?.signal?.aborted===true;void publish('/native-status',{sessionId:payload.session_id,parentPid:process.pid,childPid:child.pid,kind,generation,...(policyKey===undefined?{}:{policyKey}),command:child.spawnargs?.at(-1),startedAt,code,signal:cancelled?'aborted':signal,stdout:Buffer.concat(output).toString('utf8'),truncated:outputBytes>32768,...(kind==='subagent'?{tasks:payload.tasks.slice(0,256).map(task=>({id:task.id,status:task.status}))}:{})}).catch(()=>{})});
 return result;
};
await publish('/observer-ready',{sessionId:config.sessionId,pid:process.pid});
if(config.uiSocketPath)readNativeHelperPolicy=(await import('./ui.mjs')).readNativeHelperPolicy;
}
`
