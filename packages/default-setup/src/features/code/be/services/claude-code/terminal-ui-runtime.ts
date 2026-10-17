/** Authored adapter to reviewed embedded native exports; no recovered vendor files are executed. */
export const claudeTerminalUiRuntime = String.raw`import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
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
let originalContext,wrappedContext,releaseHostGateway,hostSequence=0;
async function askHost(subtype,args){
 if(!clients.has(args.clientId))return undefined;
 const current=JSON.parse(readFileSync(configUrl,'utf8')),id=randomUUID();
 return new Promise(resolve=>{
  const request=http.request({socketPath:config.socketPath,path:'/ui-host',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:4500},response=>{
   let bytes=0;const chunks=[];response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1048576)response.destroy();else chunks.push(chunk);});
   response.on('error',()=>resolve(undefined));response.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());resolve(response.statusCode===200&&value.request_id===id&&value.pid===process.pid&&value.sessionId===current.sessionId?value.result:undefined);}catch{resolve(undefined);}});
  });request.on('error',()=>resolve(undefined));request.on('timeout',()=>request.destroy());
  request.end(JSON.stringify({sessionId:current.sessionId,pid:process.pid,request_id:id,sequence:++hostSequence,request:{subtype,surface:'desktop',client_id:args.clientId,...(args.text!==undefined?{text:args.text}:{}),...(args.mode!==undefined?{mode:args.mode}:{}),...(args.decorations!==undefined?{decorations:args.decorations}:{})}}));
 });
}
function restoreHosts(n){
 releaseHostGateway?.();releaseHostGateway=undefined;
 if(wrappedContext&&n.runtime.ey()===wrappedContext)n.runtime.Zao(originalContext);
 originalContext=undefined;wrappedContext=undefined;
}
function installHosts(n){
 if(wrappedContext&&n.runtime.ey()===wrappedContext)return;
 if(wrappedContext)restoreHosts(n);
 const current=n.runtime.ey();if(!current?.composer)throw Error('Native terminal composer is not bound');
 originalContext=current;
 releaseHostGateway=n.runtime.TXs({reach:()=> 'first',copy:async()=>false,readSelection:async()=>({cause:'not_asked'}),readPrompt:args=>askHost('ui_prompt_read',args),fillPrompt:async args=>(await askHost('ui_prompt_fill',args))?.filled,suggestPrompt:async args=>(await askHost('ui_prompt_suggest',args))?.shown});
 const remote=n.runtime.AXs(current.composer),has=answer=>n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.includes(answer));
 wrappedContext={...current,composer:{...current.composer,read:()=>remote.read(),write:(...args)=>has('ui_prompt_fill')?remote.write(...args):current.composer.write(...args),propose:(...args)=>has('ui_prompt_suggest')?remote.propose(...args):current.composer.propose(...args)}};
 n.runtime.Zao(wrappedContext);
}
async function prepareTerminalPrompt(n,text){
 if(typeof text!=='string'||!text.trim()||text.length>32768)throw Error('Native terminal draft is invalid');
 if(!n.gate.ioe({isRemoteTransport:false,redactsWhatItPersists:false}))throw Error('Native local UI eligibility refused this operation');
 const context=originalContext??n.runtime.ey(),composer=context?.composer;
 if(context?.surface!=='terminal'||!composer)throw Error('Native terminal composer is not bound');
 if((await composer.read()).text)return {filled:false};
 const normalize=n.runtime.ilo();
 const core={name:'core',isCore:true,budgetMs:0,run:async input=>{
  const value=normalize(input.text);let decorations=input.decorations;
  if(decorations&&value!==input.text){
   const offsets=new Uint32Array(input.text.length+1);let from=0,to=0;
   for(const character of input.text){const next=String.fromCodePoint(value.codePointAt(to)??0),kept=to<value.length&&(character===next||((next==='\n'||next==='\uFFFD')&&normalize(character)===next));for(let unit=0;unit<character.length;unit++)offsets[from+unit]=to+(kept?unit:0);from+=character.length;if(kept)to+=next.length;}
   offsets[input.text.length]=to;const offset=index=>offsets[Math.max(0,Math.min(input.text.length,index))]??value.length;
   decorations=decorations.map(run=>({...run,start:offset(run.start),end:offset(run.end)}));
  }
  const write=()=>composer.write(value,input.mode,decorations);
  return composer.attribute?composer.attribute(input.origin,write):write();
 }};
 const result=await n.runtime.$i('prompt.fill',{core:{'prompt.fill':core}})({text,mode:'replace',origin:{kind:'plugin',name:'apack-native-terminal'}});
 return {filled:result.isFilled===true&&(await composer.read()).text===text};
}
const schemaNames={ui_attach:'M5n',ui_detach:'H5n',ui_render:'D5n',ui_press:'vUt',ui_input:'AUt',ui_select:'RUt'};
async function control(request){
 const n=await initialize();
 if(request.subtype==='apack_prepare_prompt')return prepareTerminalPrompt(n,request.text);
 const schema=schemaNames[request.subtype];
 if(!schema)throw Error('Native terminal UI operation is not integrated: '+request.subtype);
 const value=n.schemas[schema]().parse(request);
 if(value.surface!==undefined&&value.surface!=='desktop')throw Error('This app owns a desktop UI surface');
 const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};
 if(n.gate.Uvn(value.subtype,()=>facts))throw Error('Native UI eligibility refused this operation');
 const clientId=value.client_id;
 if(value.subtype==='ui_attach'){
  if(!clients.has(clientId)&&clients.size>=64)throw Error('Native UI attachment limit reached');
  const answers=value.answers??[];if(answers.some(answer=>!['ui_prompt_read','ui_prompt_fill','ui_prompt_suggest'].includes(answer)))throw Error('Native reverse UI operation is not integrated');
  if(answers.length)installHosts(n);
  clients.add(clientId);
  try{await n.session.I9s({surface:'desktop',clientId,...(value.viewport?{viewport:value.viewport}:{})},answers);}catch(error){clients.delete(clientId);throw error;}
  return {surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_detach'){
  const detached=clients.delete(clientId);if(detached)await n.session.d2t(clientId,'detach');
  if(!n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.length))restoreHosts(n);
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
   if(activeSession!==body.sessionId){if(native){for(const id of clients)await native.session.d2t(id,'detach');restoreHosts(native);}clients.clear();activeSession=body.sessionId;}
   const result=await control(body.request);
   if(JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==body.sessionId)throw Error('Native session changed during UI request');
   reply(200,{...identity,result});
  }catch(error){reply(400,{...identity,error:String(error?.message??error)});}finally{inFlight--;}
 }catch{reply(400,{});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.uiSocketPath,resolve);});server.unref();
`
