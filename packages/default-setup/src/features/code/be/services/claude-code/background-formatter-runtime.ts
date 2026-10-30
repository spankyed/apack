/** Authored prefix observes only the exact native-admitted root formatter, preserving its streams. */
export const claudeBackgroundFormatterRuntime = String.raw`import {spawn} from 'node:child_process';
import http from 'node:http';
const [electronState,encoded,command,...extra]=process.argv.slice(1);
if(extra.length||!encoded?.startsWith('-')||typeof command!=='string'){process.exit(64);}
if(electronState.startsWith('x:'))process.env.ELECTRON_RUN_AS_NODE=electronState.slice(2);else delete process.env.ELECTRON_RUN_AS_NODE;
const config=JSON.parse(Buffer.from(encoded.slice(1),'base64url').toString());
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
let originalCommand=command;
if(config.originalPrefix){const split=config.originalPrefix.lastIndexOf(' -');originalCommand=split>0?quote(config.originalPrefix.slice(0,split))+' '+config.originalPrefix.slice(split+1)+' '+quote(command):quote(config.originalPrefix)+' '+quote(command);}
const observed=command===config.command,startedAt=process.hrtime.bigint().toString();
const child=spawn('/bin/sh',['-c',originalCommand],{stdio:observed?['pipe','pipe','inherit']:'inherit'});
const input=[],output=[];let inputBytes=0,outputBytes=0;
if(observed){
 process.stdin.on('data',chunk=>{inputBytes+=chunk.length;if(inputBytes<=65536)input.push(Buffer.from(chunk));});process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});
 child.stdout.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes<=32768)output.push(Buffer.from(chunk));if(!process.stdout.write(chunk)){child.stdout.pause();process.stdout.once('drain',()=>child.stdout.resume());}});
}
const handlers=['SIGINT','SIGTERM','SIGHUP'].map(signal=>{const handler=()=>{try{child.kill(signal);}catch{}};process.on(signal,handler);return[signal,handler];});
const result=await new Promise(resolve=>{child.once('error',()=>resolve({code:127,signal:null}));child.once('close',(code,signal)=>resolve({code,signal}));});
for(const[signal,handler]of handlers)process.off(signal,handler);
if(observed&&!result.signal&&inputBytes<=65536){
 let payload;try{payload=JSON.parse(Buffer.concat(input).toString());}catch{}
 if(payload?.session_id===config.sessionId&&typeof payload.version==='string'&&payload.cost&&payload.context_window&&!payload.hook_event_name){
  await new Promise(resolve=>{const request=http.request({socketPath:config.socketPath,path:'/background-formatter',method:'POST',headers:{'x-apack-native-token':config.brokerToken,'content-type':'application/json'},timeout:150},response=>{response.resume();response.on('end',resolve);});request.on('timeout',()=>{request.destroy();resolve();});request.on('error',resolve);request.end(JSON.stringify({sessionId:config.sessionId,pid:config.pid,token:config.token,generation:config.generation,startedAt,code:result.code,truncated:outputBytes>32768,stdout:result.code===0&&outputBytes<=32768?Buffer.concat(output).toString('utf8'):''}));});
 }
}
if(result.signal)process.kill(process.pid,result.signal);else process.exitCode=result.code??1;
`;
