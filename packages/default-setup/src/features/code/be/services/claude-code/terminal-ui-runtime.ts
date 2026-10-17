/** Authored adapter to reviewed embedded native exports; no recovered vendor files are executed. */
export const claudeTerminalUiRuntime = String.raw`import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const configUrl=new URL('./observer.json',import.meta.url),config=JSON.parse(readFileSync(configUrl,'utf8'));
const clients=new Set(),seen=new Set();let native,initializing,activeSession=config.sessionId,inFlight=0,highestSequence=0;
async function initialize(){
 if(native)return native;
 if(initializing)return initializing;
 initializing=(async()=>{
  if(createHash('sha256').update(readFileSync(process.execPath)).digest('hex')!=='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37')throw Error('Native UI transport requires the reviewed Claude Code 2.1.302 binary');
  const gate=await import('/$bunfs/root/chunk-wn0572jb.js');
  const engine=await import('/$bunfs/root/chunk-c7wcn77x.js');
  const session=await import('/$bunfs/root/chunk-a32bd1ts.js');
  const roster=await import('/$bunfs/root/chunk-nkxb8t4d.js');
  const schemas=await import('/$bunfs/root/chunk-5c94ftfz.js');
  const runtime=await import('/$bunfs/root/chunk-hqtnbrjd.js');
  await import('/$bunfs/root/chunk-rpe8kh25.js');
  engine.I9e.onInvalidate(instances=>{try{const current=JSON.parse(readFileSync(configUrl,'utf8'));const event={type:'system',subtype:'ui_invalidate',event:'ui.render',...(gate.e5r()?{prompts_screened:true}:{}),...(instances?{instances:instances.map(item=>({surface:item.surface,component:item.component,instance_id:item.requestId}))}:{})};const request=http.request({socketPath:config.socketPath,path:'/ui-event',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:500},response=>response.resume());request.on('error',()=>{});request.on('timeout',()=>request.destroy());request.end(JSON.stringify({sessionId:current.sessionId,pid:process.pid,event}));}catch{}});
  return native={gate,engine,session,roster,schemas,runtime};
 })();
 return initializing;
}
const schemaNames={ui_attach:'M5n',ui_detach:'H5n',ui_render:'D5n',ui_press:'vUt',ui_input:'AUt',ui_select:'RUt'};
async function control(request){
 const n=await initialize(),schema=schemaNames[request.subtype];
 if(!schema)throw Error('Native terminal UI operation is not integrated: '+request.subtype);
 const value=n.schemas[schema]().parse(request);
 if(value.surface!==undefined&&value.surface!=='desktop')throw Error('This app owns a desktop UI surface');
 const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};
 if(n.gate.Uvn(value.subtype,()=>facts))throw Error('Native UI eligibility refused this operation');
 const clientId=value.client_id;
 if(value.subtype==='ui_attach'){
  if(!clients.has(clientId)&&clients.size>=64)throw Error('Native UI attachment limit reached');
  if(value.answers?.length)throw Error('Native reverse UI host transport is not integrated');
  await n.session.I9s({surface:'desktop',clientId,...(value.viewport?{viewport:value.viewport}:{})},[]);clients.add(clientId);
  return {surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_detach'){
  const detached=clients.delete(clientId);if(detached)await n.session.d2t(clientId,'detach');
  return {detached,surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_render'){
  if(!clients.has(clientId))throw Error('Native UI client is not attached to this owner');
  await n.gate._Jo('desktop');
  const props={...value.props};
  if((value.component==='ToolUse'||value.component==='ToolResult')&&typeof props.tool_use_id!=='string')props.tool_use_id=value.instance_id;
  if(typeof props.output==='string'&&props.output.length>65536)props.output=props.output.slice(0,65536);
  const result=await n.engine.I9e.run({surface:'desktop',component:value.component,requestId:value.instance_id,...(value.viewport?{viewport:value.viewport}:{}),props});
  return {tree:result.tree,props:result.props,rewritten:result.rewritten,hooked:n.gate.n5r(value.component,'desktop'),...(Object.keys(result.clientModules).length?{client_modules:result.clientModules}:{}),drawn_by:result.drawnBy};
 }
 if(!clients.size)throw Error('Native UI has no attached app view');
 const args={plugin:value.plugin,handle:value.handle,surface:'desktop',...(value.key!==undefined?{element:value.key}:{}),...(value.component!==undefined?{component:value.component}:{}),...(value.instance_id!==undefined?{requestId:value.instance_id}:{})};
 const result=value.subtype==='ui_press'?await n.engine.I9e.press({...args,...(value.href!==undefined?{link:{href:value.href}}:{})}):value.subtype==='ui_input'?await n.engine.I9e.input({...args,kind:value.kind,value:value.value}):await n.engine.I9e.select({...args,value:value.value});
 return result===undefined?{handled:false}:{handled:true,element:result.element,...(value.subtype!=='ui_press'?{value:result.value}:{})};
}
const server=http.createServer(async(request,response)=>{
 const reply=(status,value)=>{if(response.destroyed)return;response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
 if(request.method!=='POST'||request.url!=='/control'||request.headers['x-apack-native-token']!==config.token)return reply(403,{});
 let body;
 try{
  let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>1048576)return reply(413,{});chunks.push(chunk);}
  body=JSON.parse(Buffer.concat(chunks).toString());
  const current=JSON.parse(readFileSync(configUrl,'utf8'));
  if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id)||!Number.isSafeInteger(body.sequence)||body.sequence<1||body.ownerPid!==process.pid||body.sessionId!==current.sessionId)return reply(409,{});
  const identity={id:body.id,pid:process.pid,sessionId:body.sessionId};
  if(seen.has(body.sequence)||body.sequence<=highestSequence-4096||inFlight>=64)return reply(409,{...identity,error:'Native UI request is repeated, stale or exceeds its concurrent limit'});
  highestSequence=Math.max(highestSequence,body.sequence);seen.add(body.sequence);for(const sequence of seen)if(sequence<=highestSequence-4096)seen.delete(sequence);inFlight++;
  try{
   if(activeSession!==body.sessionId){if(native)for(const id of clients)await native.session.d2t(id,'detach');clients.clear();activeSession=body.sessionId;}
   const result=await control(body.request);
   if(JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==body.sessionId)throw Error('Native session changed during UI request');
   reply(200,{...identity,result});
  }catch(error){reply(400,{...identity,error:String(error?.message??error)});}finally{inFlight--;}
 }catch{reply(400,{});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.uiSocketPath,resolve);});server.unref();
`
