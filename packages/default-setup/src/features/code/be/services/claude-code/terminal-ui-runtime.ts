import { claudeTerminalAgentInputRuntime } from './terminal-agent-input-runtime.ts'
import { claudeTerminalTaskRuntime } from './terminal-task-runtime.ts'
import { claudeTerminalClientRuntime } from './terminal-client-runtime.ts'
/** Authored adapter to reviewed embedded native exports; no recovered vendor files are executed. */
export const claudeTerminalUiRuntime = String.raw`import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const configUrl=new URL('./observer.json',import.meta.url),config=JSON.parse(readFileSync(configUrl,'utf8'));
const clients=new Set(),seen=new Set();let native,initializing,activeSession=config.sessionId,inFlight=0,highestSequence=0;
function publish(event){
 try{const current=JSON.parse(readFileSync(configUrl,'utf8'));const request=http.request({socketPath:config.socketPath,path:'/ui-event',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:500},response=>response.resume());request.on('error',()=>{});request.on('timeout',()=>request.destroy());request.end(JSON.stringify({sessionId:current.sessionId,pid:process.pid,event}));}catch{}
}
// Match native remote replay: latest status per plugin, bounded recent transients for first attach.
const noticeStatuses=new Map(),noticeTransient=[],noticeContexts=new WeakSet(),noticeMethods=new WeakSet();
let noticeSession=config.sessionId,noticeOrder=0,noticeAttached=false;
function resetNotices(sessionId){noticeSession=sessionId;noticeStatuses.clear();noticeTransient.length=0;noticeAttached=false;}
function recordNotice(subtype,plugin,text,timeout){
 const current=JSON.parse(readFileSync(configUrl,'utf8'));
 if(noticeSession!==current.sessionId)resetNotices(current.sessionId);
 const event={type:'system',subtype,plugin,text:text??null,uuid:randomUUID(),session_id:current.sessionId,...(subtype==='ui_toast'?{timeout_ms:timeout}:{})};
 const item={event,at:Date.now(),order:++noticeOrder};
 if(subtype==='ui_status'){noticeStatuses.delete(plugin);noticeStatuses.set(plugin,item);}
 else if(!clients.size){noticeTransient.push(item);noticeTransient.splice(0,Math.max(0,noticeTransient.length-20));}
 if(clients.size)publish(event);
}
function installNotices(n,context){
 if(context?.surface!=='terminal'||noticeContexts.has(context))return;
 if(noticeMethods.has(context.toast)&&noticeMethods.has(context.status)){noticeContexts.add(context);return;}
 noticeContexts.add(context);
 const toast=context.toast,status=context.status;
 context.toast=function(plugin,text,timeout){const result=Reflect.apply(toast,this,arguments);try{recordNotice('ui_toast',plugin,text,timeout??n.runtime.o7t);}catch{}return result;};
 context.status=function(plugin,text){const result=Reflect.apply(status,this,arguments);try{recordNotice('ui_status',plugin,text);}catch{}return result;};
 noticeMethods.add(context.toast);noticeMethods.add(context.status);
}
function replayNotices(){
 const current=JSON.parse(readFileSync(configUrl,'utf8'));
 if(noticeSession!==current.sessionId)resetNotices(current.sessionId);
 const items=[...noticeStatuses.values(),...(!noticeAttached?noticeTransient.filter(item=>Date.now()-item.at<=60000):[])].sort((a,b)=>a.order-b.order);
 noticeTransient.length=0;noticeAttached=true;
 for(const item of items)publish(item.event);
}
// Native hook dispatch owns admission and rewrites; this adapter supplies the remote layout.
const sites=new Map();
function siteExists(n,component,id){return component==='AbovePrompt'&&id===n.runtime.f4||component==='Pane'&&paneRoster(n).panes.some(pane=>pane.id===id);}
function siteOffset(site){return site.follow?Math.max(0,site.contentRows-site.bodyRows):site.offset;}
function dropSite(n,key){
 const site=sites.get(key);if(!site)return;sites.delete(key);site.abort.abort();
 for(const [registry,entry,previous] of [[n.runtime.xbe(),site.scrollEntry,site.previousScroll],[n.runtime.Eat(),site.focusEntry,site.previousFocus]])if(registry.get(key)===entry){if(previous)registry.set(key,previous);else registry.delete(key);}
}
function refreshSite(n,site){
 if(!clientViewCurrent(n,site.clientId))return;
 const key=n.runtime.kV(site.component,site.id),scrolls=n.runtime.xbe(),focuses=n.runtime.Eat();
 if(scrolls.get(key)!==site.scrollEntry)site.previousScroll=scrolls.get(key);
 if(focuses.get(key)!==site.focusEntry)site.previousFocus=focuses.get(key);
 const current=()=>sites.get(key)===site&&clients.has(site.clientId)&&siteExists(n,site.component,site.id);
 const moved=()=>publish({type:'system',subtype:'ui_scroll',client_id:site.clientId,component:site.component,instance_id:site.id,offset:siteOffset(site),...(site.follow?{follow_end:true}:{})});
 site.scrollEntry={component:site.component,requestId:site.id,owner:site.owner,bodyRows:site.bodyRows,contentRows:site.contentRows,maxOffset:Math.max(0,site.contentRows-site.bodyRows),offset:()=>siteOffset(site),keyRows:(plugin,key)=>{const row=site.keyed.find(row=>row.plugin===plugin&&row.key===key);return row&&{top:row.top,bottom:row.bottom};},commit:(offset,origin)=>{
  if(!current()||origin.kind==='person'&&site.superseded)return false;
  const end=Math.max(0,site.contentRows-site.bodyRows);site.offset=Math.min(end,Math.max(0,offset));
  if(origin.kind==='person')site.follow=site.follow&&site.offset>=end;
  else{site.superseded=site.moving;site.follow=false;moved();}return true;
 },followEnd:()=>{if(current()){site.follow=true;moved();}}};
 site.focusEntry={component:site.component,requestId:site.id,owner:site.owner,isHeldNow:()=>site.held,holderNow:()=>site.holder?.plugin,hasElement:(plugin,element)=>site.focusables.some(item=>item.plugin===plugin&&item.element===element),commit:input=>{
  if(!current())return 'no such site';
  if(input.plugin===undefined||input.element===undefined){site.holder=undefined;return;}
  if(!site.focusables.some(item=>item.plugin===input.plugin&&item.element===input.element))return 'no element of '+input.plugin+' is drawn under that key';
  site.holder={plugin:input.plugin,element:input.element};
  if(input.origin.kind==='plugin'&&!site.reporting)publish({type:'system',subtype:'ui_focus',client_id:site.clientId,component:site.component,instance_id:site.id,plugin:input.plugin,key:input.element});
 }};
 scrolls.set(key,site.scrollEntry);focuses.set(key,site.focusEntry);
}
function remoteSite(n,clientId,component,id){
 if(!clients.has(clientId)||!siteExists(n,component,id))return;
 const key=n.runtime.kV(component,id);let site=sites.get(key);
 if(site&&site.clientId!==clientId){dropSite(n,key);site=undefined;}
 if(!site){site={clientId,component,id,owner:component==='Pane'?paneRoster(n).panes.find(pane=>pane.id===id)?.plugin:undefined,offset:0,bodyRows:0,contentRows:0,keyed:[],focusables:[],held:false,follow:false,abort:new AbortController()};sites.set(key,site);}
 refreshSite(n,site);return site;
}
function synchronizePanes(n){
 const state=n.roster.Ui().getState();
 for(const [key,site] of sites){if(!siteExists(n,site.component,site.id)){dropSite(n,key);continue;}if(site.component==='Pane'){site.held=state.focusedId===site.id;if(!site.held)site.holder=undefined;}refreshSite(n,site);}
}
function siteTurn(site,kind,report,merge,run){
 const state=site[kind]??(site[kind]={});
 if(state.active){
  if(state.waiting){state.waiting.report=merge(state.waiting.report,report);return state.waiting.promise;}
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});state.waiting={report,promise,resolve,reject};return promise;
 }
 state.active=true;
 return Promise.resolve().then(()=>run(report)).finally(()=>{
  state.active=false;const next=state.waiting;state.waiting=undefined;
  if(next)siteTurn(site,kind,next.report,merge,run).then(next.resolve,next.reject);
 });
}
async function remoteFocus(n,value){
 const site=remoteSite(n,value.client_id??'desktop:default',value.component,value.instance_id);
 if(!site)return {moved:false,element:null,deny:'no such site'};
 return siteTurn(site,'focusQueue',value,(before,after)=>after.element===undefined&&after.is_held&&before.element!==undefined?{...after,element:before.element,by:before.by}:after,async value=>{
  if(site.abort.signal.aborted)return {moved:false,element:null,deny:'no such site'};
  site.held=value.is_held;if(!site.held)site.holder=undefined;site.reporting=true;refreshSite(n,site);
  const element=value.element;let result={};
  try{if(element!==undefined&&site.held)result=await n.runtime.v7t({input:{component:site.component,requestId:site.id,...(element?{plugin:element.plugin,element:element.key}:{}),origin:value.by==='auto'&&element?{kind:'plugin',name:element.plugin}:{kind:'person'}},signal:site.abort.signal});}
  finally{site.reporting=false;}
  const holder=site.holder;return {moved:result.deny===undefined,element:holder?{plugin:holder.plugin,key:holder.element}:null,...(result.deny!==undefined?{deny:result.deny}:{})};
 });
}
async function remoteScroll(n,value){
 const site=remoteSite(n,value.client_id??'desktop:default',value.component,value.instance_id);
 if(!site)return {moved:false,offset:value.offset,deny:'no such site'};
 return siteTurn(site,'scrollQueue',value,(before,after)=>({...after,by:before.by+after.by}),async value=>{
  if(site.abort.signal.aborted)return {moved:false,offset:siteOffset(site),deny:'no such site'};
  const end=Math.max(0,value.content_rows-value.body_rows),before=site.follow?end:Math.min(site.offset,end),wasFollowing=site.follow;
  site.offset=before;site.bodyRows=value.body_rows;site.contentRows=value.content_rows;if(value.keyed)site.keyed=value.keyed;site.moving=true;site.superseded=false;refreshSite(n,site);
  let result;
  try{result=await n.runtime.vxt({input:{component:site.component,requestId:site.id,offset:Math.min(end,Math.max(0,before+value.by)),by:value.by,bodyRows:site.bodyRows,contentRows:site.contentRows,origin:{kind:'person'},...(value.pointer?{pointer:value.pointer}:{})},signal:site.abort.signal});}
  finally{site.moving=false;}
  if(site.abort.signal.aborted||site.superseded)return {moved:false,offset:siteOffset(site),deny:'the window moved meanwhile',...(site.follow?{follow_end:true}:{})};
  if(result.deny!==undefined)site.offset=before;
  else site.follow=site.follow||wasFollowing&&value.by>0&&site.offset>=end;
  return {moved:result.deny===undefined,offset:siteOffset(site),...(result.deny!==undefined?{deny:result.deny}:{}),...(site.follow?{follow_end:true}:{})};
 });
}
function recordDrawing(n,value,tree){
 const site=remoteSite(n,value.client_id,value.component,value.instance_id);if(!site)return;
 const scroll=value.props?.scroll;
 if(scroll&&Number.isInteger(scroll.bodyRows)&&scroll.bodyRows>=0)site.bodyRows=scroll.bodyRows;
 if(typeof value.props?.isFocused==='boolean')site.held=value.props.isFocused;
 site.focusables=n.session.Ket(tree);
 if(site.holder&&!site.focusables.some(item=>item.plugin===site.holder.plugin&&item.element===site.holder.element))site.holder=undefined;
 refreshSite(n,site);n.runtime.k7t().emit();
}

function paneRoster(n){
 const state=n.roster.Ui().getState(),visible=state.open.filter(pane=>n.engine.FPe(pane.plugin));
 const hidden=new Set(state.open.filter(pane=>!visible.includes(pane)).map(pane=>pane.id));
 return {panes:visible.map(pane=>({id:pane.id,title:pane.title,plugin:pane.plugin,...(pane.closeOnEscape?{close_on_escape:true}:{}),...(pane.holdToasts?{hold_toasts:true}:{}),...(pane.rows!==undefined?{rows:pane.rows}:{}),...(pane.columns!==undefined?{columns:pane.columns}:{})})),shown_id:hidden.has(state.shownId)?visible.at(-1)?.id??null:state.shownId,focused_id:hidden.has(state.focusedId)?null:state.focusedId,focus_requested_id:hidden.has(state.focusRequest)?null:state.focusRequest};
}
${claudeTerminalClientRuntime}
${claudeTerminalTaskRuntime}
${claudeTerminalAgentInputRuntime}
function nativeThemeTree(n,tree){
 const palette=n.themeResolver.UKe(n.themePreferences.lEn());
 const paint=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const result={...value};
  for(const key of ['color','backgroundColor','borderColor'])if(typeof result[key]==='string'&&Object.hasOwn(palette,result[key]))result[key]=palette[result[key]];
  return result;
 };
 const visit=(value,inheritedColor,inheritedBackground,parentType)=>{
  if(typeof value==='string')return parentType==='Box'?{type:'Text',props:{color:inheritedColor??palette.text},children:[value]}:value;
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const themed=['Text','Box','Button'].includes(value.type),props=themed?paint(value.props??{}):value.props;
  let color=inheritedColor,background=inheritedBackground;
  if(value.type==='Text'){
   props.color??=inheritedColor??palette.text;color=props.color;
   if(props.inverse===true)props.backgroundColor??=inheritedBackground??palette.inverseText;
  }
  if(themed&&props?.backgroundColor!==undefined)background=props.backgroundColor;
  return {...value,...(themed?{props}:{}),...(themed&&value.hover?{hover:paint(value.hover)}:{}),...(Array.isArray(value.children)?{children:value.children.map(child=>visit(child,color,background,value.type))}:{})};
 };
 return visit(tree);
}
let nativeThemeSnapshot;
function refreshNativeTheme(n){
 if(!clients.size)return;
 const next=JSON.stringify(n.themeResolver.UKe(n.themePreferences.lEn()));
 if(nativeThemeSnapshot===next)return;
 const changed=nativeThemeSnapshot!==undefined;nativeThemeSnapshot=next;
 if(changed)publish({type:'system',subtype:'ui_invalidate',event:'ui.render'});
}
async function initialize(){
 if(native)return native;
 if(initializing)return initializing;
 initializing=(async()=>{
  if(createHash('sha256').update(readFileSync(process.execPath)).digest('hex')!=='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37')throw Error('Native UI transport requires the reviewed Claude Code 2.1.302 binary');
  const clientRuntime=await import('/$bunfs/root/chunk-e980bbar.js');
  const nativeClients=createNativeClientHost(clientRuntime.x3r,entry=>publish({type:'system',subtype:'ui_invalidate',event:'ui.render',client_snapshot:true,client_id:entry.client,instances:[{surface:'desktop',component:entry.component,instance_id:entry.requestId}]}),clientRuntime.R3r,{dispatch:value=>engine.I9e.clientPress(value),run:value=>{const held=engine.r5.heldPress(value.plugin,value.handle,value.key);if(!held||held.component!==value.component||held.requestId!==value.requestId)return false;const run=engine.tut.runnerFor(value.plugin,held.handle);if(!run)return false;run(value.event);return true;}});
  const gate=await import('/$bunfs/root/chunk-wn0572jb.js');
  const engine=await import('/$bunfs/root/chunk-c7wcn77x.js');
  const session=await import('/$bunfs/root/chunk-a32bd1ts.js');
  const roster=await import('/$bunfs/root/chunk-nkxb8t4d.js');
  const schemas=await import('/$bunfs/root/chunk-5c94ftfz.js');
  const runtime=await import('/$bunfs/root/chunk-hqtnbrjd.js');
  const themeResolver=await import('/$bunfs/root/chunk-4z4q4qvr.js');
  const themePreferences=await import('/$bunfs/root/chunk-gnpc8ecg.js');
  const rename=await import('/$bunfs/root/chunk-swjk3jdr.js');
  const taskControls=await import('/$bunfs/root/chunk-nmzacz4p.js');
  const taskResume=await import('/$bunfs/root/chunk-jg0h78vk.js');
  const taskInputGate=await import('/$bunfs/root/chunk-ysbnj2tj.js');
  const mcp=await import('/$bunfs/root/chunk-7m5psxad.js');
  const mcpControls=await import('/$bunfs/root/chunk-aen4nr7w.js');
  const permissions=await import('/$bunfs/root/chunk-gpwdwjeb.js');
  const models=await import('/$bunfs/root/chunk-0xdgy4bd.js');
  const questionTool=(await import('/$bunfs/root/chunk-at6jwec6.js')).yQ;
  const questionOptions=await import('/$bunfs/root/chunk-hdxpvbx1.js');
  const questionText=await import('/$bunfs/root/chunk-xh5v0djg.js');
  const catalog=await import('/$bunfs/root/chunk-2bb0j573.js');
  const paths=await import('/$bunfs/root/chunk-27d659a1.js');
  const planConsent=await import('/$bunfs/root/chunk-3m4t81ea.js');
  const planAuto=await import('/$bunfs/root/chunk-5c94ftfz.js');
  const planNormalize=await import('/$bunfs/root/chunk-gpwdwjeb.js');
  const planTool=await import('/$bunfs/root/chunk-rhvre9pz.js');
  const planTeams=await import('/$bunfs/root/chunk-tt5gpzxk.js');
  const planStore=await import('/$bunfs/root/chunk-ehw6t5ag.js');
  const planProactivity=await import('/$bunfs/root/chunk-ck4jw7jw.js');

  await import('/$bunfs/root/chunk-rpe8kh25.js');
  const modules={gate,engine,session,roster,schemas,runtime,permissions,models,catalog,questionTool,questionOptions,questionText,paths,planConsent,planAuto,planNormalize,planTool,planTeams,planStore,planProactivity};
  engine.I9e.onInvalidate(instances=>{nativeClients.suspend(instances);for(const[client,frame]of questionFrames)if(!instances||instances.some(item=>item.surface==='desktop'&&item.component==='AskUserQuestion'&&item.requestId===frame.requestId))questionFrames.delete(client);try{publish({type:'system',subtype:'ui_invalidate',event:'ui.render',...(gate.e5r()?{prompts_screened:true}:{}),...(instances?{instances:instances.map(item=>({surface:item.surface,component:item.component,instance_id:item.requestId}))}:{})});}catch{}});
  let previousRoster=JSON.stringify(paneRoster(modules));
  runtime.k7t().subscribe(()=>{for(const site of sites.values())refreshSite(modules,site);});
  roster.Ui().subscribe(()=>{synchronizePanes(modules);const current=paneRoster(modules),encoded=JSON.stringify(current);if(encoded===previousRoster)return;previousRoster=encoded;publish({type:'system',subtype:'ui_panes',...current});});
  return native={nativeClients,gate,engine,session,roster,schemas,runtime,themeResolver,themePreferences,rename,taskControls,taskResume,taskInputGate,mcp,mcpControls,permissions,models,catalog,questionTool,questionOptions,questionText,paths,planConsent,planAuto,planNormalize,planTool,planTeams,planStore,planProactivity};
 })();
 return initializing;
}
let originalContext,wrappedContext,releaseHostGateway,hostSequence=0;
const clientViews=new Map();
function clientViewKey(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal')return undefined;
 const facts=nativeViewFacts(n,binding,new AbortController());
 return JSON.stringify([facts.sessionId,facts.sequence,facts.view]);
}
function clientViewCurrent(n,id){return !!n&&clientViews.has(id)&&clientViews.get(id)===clientViewKey(n);}
function clientAttachmentViewKey(n,expected){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal')throw Error('Native UI view is unavailable');
 const facts=nativeViewFacts(n,binding,new AbortController());
 if(expected===undefined){if(facts.view.kind!=='main')throw Error('Desktop parent UI cannot attach to a native Agent view');}
 else{
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||typeof expected.session_id!=='string'||!Number.isSafeInteger(expected.revision)||expected.revision<1||typeof expected.agent_id!=='string'||!expected.agent_id||expected.agent_id.length>256)throw Error('Invalid native Agent UI attachment');
  if(expected.session_id!==facts.sessionId||expected.revision!==facts.sequence||facts.view.kind!=='agent'||facts.view.taskId!==expected.agent_id)throw Error('Native Agent UI selection changed');
 }
 return JSON.stringify([facts.sessionId,facts.sequence,facts.view]);
}


async function askHost(subtype,args){
 if(!clients.has(args.clientId)||!clientViewCurrent(native,args.clientId))return undefined;
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
let preparedPrompt;
function promptOutcome(n,id){
 if(!preparedPrompt||preparedPrompt.id!==id)return {};
 const messages=(originalContext??n.runtime.ey())?.messages?.()??[];
 const message=messages.findLast(row=>row.promptSubmitEnding&&!preparedPrompt.before.has(row.uuid));
 if(!message){
  const candidates=messages.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true&&!preparedPrompt.before.has(row.uuid)&&!(Array.isArray(row.message?.content)&&row.message.content.some(block=>block.type==='tool_result')));
  if(candidates.length!==1)return {};
  const row=candidates[0],content=typeof row.message.content==='string'?[{type:'text',text:row.message.content}]:row.message.content;
  return {accepted:{uuid:row.uuid,door:'prompt',origin:row.origin??{kind:'native'},message:{type:'user',content}}};
 }
 const ending=message.promptSubmitEnding.ending;
 return {drop:typeof ending?.reason==='string'&&ending.reason?ending.reason:'Native prompt was not submitted'};
}
async function prepareTerminalPrompt(n,text,id,allowEmpty=false){
 if(typeof text!=='string'||!allowEmpty&&!text.trim()||text.length>32768)throw Error('Native terminal draft is invalid');
 if(!n.gate.ioe({isRemoteTransport:false,redactsWhatItPersists:false}))throw Error('Native local UI eligibility refused this operation');
 const context=originalContext??n.runtime.ey(),composer=context?.composer;
 if(context?.surface!=='terminal'||!composer)throw Error('Native terminal composer is not bound');
 if(context.toolContext(new AbortController()).getAppState().viewingAgentTaskId!==undefined)throw Error('Return to the native main view before submitting a parent prompt');
 const prior=(await composer.read()).text;
 if(prior&&prior!==preparedPrompt?.text)return {filled:false};
 const before=new Set((context.messages?.()??[]).map(row=>row.uuid));
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
 const actual=(await composer.read()).text,filled=result.isFilled===true&&actual===text;
 if(filled)preparedPrompt={id,text:actual,before};
 return {filled};
}
// Keep remote edit state separate from the hidden terminal draft used for submission.
const edits=new Map();
function clearEdit(clientId){
 const state=edits.get(clientId);if(!state)return;
 edits.delete(clientId);state.active?.abort();
 for(const item of state.waiting)item.answer({...item.box,superseded:true});state.waiting=[];
}
function editPrompt(n,clientId,box,key,by){
 let state=edits.get(clientId);
 if(!state){state={box:{text:'',cursor:0},waiting:[]};edits.set(clientId,state);}
 box=n.session.o_n(box);
 if(by==='app'){
  for(const item of state.waiting)item.answer({...item.box,superseded:true});
  state.waiting=[];state.box=box;state.offered=undefined;state.stale=!!state.active;return box;
 }
 return new Promise(answer=>{state.waiting.push({box,key,answer});drainEdit(n,clientId,state);});
}
function drainEdit(n,clientId,state){
 if(state.active||!state.waiting.length)return;
 const batch=state.waiting,next=batch.at(-1);
 for(const item of batch.slice(0,-1))item.answer({...item.box,superseded:true});
 const distance=before=>{const diff=n.session.Aze(before,next.box);return diff.end-diff.start+diff.inputText.length;};
 const before=state.offered&&distance(state.offered)<distance(state.box)?state.offered:state.box;
 const key=batch.length===1?next.key:undefined;
 const nativeKey=key?{key:key.key==='space'?' ':key.key,name:key.key==='space'||[...key.key].length===1?'':key.key,ctrl:key.ctrl===true,shift:key.shift===true,meta:key.meta===true}:undefined;
 state.box=next.box;state.offered=undefined;state.waiting=[];
 const abort=new AbortController();state.active=abort;
 Promise.resolve().then(()=>n.session.kGr({before,after:next.box,...(nativeKey?{key:nativeKey}:{})},abort.signal)).catch(()=>next.box).then(result=>{
  state.active=undefined;
  if(abort.signal.aborted||edits.get(clientId)!==state){next.answer({...next.box,superseded:true});return;}
  const box=n.session.o_n(result),decorations=n.runtime.qgr(n.runtime.nxe(result.decorations,box.text));
  if((box.text!==next.box.text||box.cursor!==next.box.cursor)&&!state.waiting.length&&!state.stale)state.offered=box;
  state.stale=false;next.answer({...box,...(decorations.length?{decorations}:{})});drainEdit(n,clientId,state);
 });
}
// Each attached composer has one native completion chain and at most one queued draft.
const completions=new Map();
function clearCompletion(clientId){
 const state=completions.get(clientId);if(!state)return;
 completions.delete(clientId);state.active?.abort();
 state.waiting?.answer({suggestions:[],superseded:true});state.waiting=undefined;
}
function autocomplete(n,clientId,box){
 let state=completions.get(clientId);
 if(!state){state={};completions.set(clientId,state);}
 return new Promise(answer=>{
  state.waiting?.answer({suggestions:[],superseded:true});
  state.waiting={box,answer};drainCompletion(n,clientId,state);
 });
}
function drainCompletion(n,clientId,state){
 if(state.active){state.active.abort();return;}
 const next=state.waiting;
 if(!next){if(completions.get(clientId)===state)completions.delete(clientId);return;}
 state.waiting=undefined;
 const args=n.session.rwt(next.box);
 if(!args){next.answer({suggestions:[]});drainCompletion(n,clientId,state);return;}
 const abort=new AbortController();state.active=abort;
 Promise.resolve().then(()=>n.session.r_n(args,abort.signal)).then(result=>n.session.n_n(result.suggestions),()=>[]).then(suggestions=>{
  state.active=undefined;
  next.answer(abort.signal.aborted||completions.get(clientId)!==state?{suggestions:[],superseded:true}:{suggestions,start:args.start});
  if(completions.get(clientId)===state)drainCompletion(n,clientId,state);
 });
}
// A revision binds the actual native descriptor and payload objects; no client-supplied tool input.
const dialogRevisions=new Map(),questionFrames=new Map(),questionFrameHistory=new Map(),frozenQuestionFrames=new Map();
let mcpControlActive=false;
function nativeDialog(n,kind){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native dialogs are not ready');
 const context=binding.toolContext(new AbortController()),store=context.dialogStore;
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native dialog session changed or expired');
 const open=store.getState().open;
 // Other native dialogs retain their original interface until their contracts are integrated.
 const item=open.length===1?open[0]:undefined,payload=item?.payload;
 const supported=kind==='permission_bash'?payload?.toolName==='Bash'&&typeof payload.input?.command==='string':kind==='permission_file'?(payload?.toolName==='Read'&&payload.operationType==='read'||['Write','Edit'].includes(payload?.toolName)&&payload.operationType==='write'&&typeof payload.input?.file_path==='string'&&['file-edit-diff','file-write-diff','no-changes'].includes(payload.content?.kind)):kind==='permission_enter_plan_mode'?payload?.toolName==='EnterPlanMode':kind==='permission_exit_plan_mode_v2'?payload?.toolName==='ExitPlanMode'&&typeof payload.plan==='string':kind==='permission_ask_user_question'&&payload?.toolName==='AskUserQuestion'&&Array.isArray(payload.questions);
 if(item?.kind!==kind||!supported||typeof payload.requestId!=='string'||!payload.input||typeof payload.input!=='object'){
  dialogRevisions.delete(kind);return {store,sessionId};
 }
 let revision=dialogRevisions.get(kind);
 const planFacts=['permission_enter_plan_mode','permission_exit_plan_mode_v2'].includes(kind)?planPresentation(n,context,payload):undefined;
 const fingerprint=JSON.stringify([payload,planFacts]);
 if(revision?.fingerprint!==fingerprint||revision?.item!==item||revision?.payload!==payload||revision?.sessionId!==sessionId)
  revision={item,payload,sessionId,fingerprint,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {store,context,planFacts,sessionId,...revision};
}
// Frozen iCe/xit: constructor-produced mode rows and original native reset/message helpers.
function planPresentation(n,context,payload){
 const state=context.getAppState(),permission=state.toolPermissionContext,enter=payload.toolName==='EnterPlanMode';
 const raw=enter?'':payload.plan,empty=raw.trim()==='',withheld=!empty&&(raw.length>200000||n.questionText.VL(raw));
 const choices=[],auto=permission.isAutoModeAvailable===true&&n.runtime.ty(),bypass=permission.isBypassPermissionsModeAvailable===true;
 const add=(value,label,mode,clearContext=false)=>{const row=mode==='auto'?n.planConsent.Y_n('exit-plan-resume'):n.planConsent.kTe(mode,{isBypassPermissionsModeAvailable:bypass});if(row&&n.planConsent.hv(row))choices.push({value,label,mode,clearContext});};
 if(enter)add('yes','Enter plan mode','plan');
 else if(empty)add('yes','Exit plan mode','default');
 else if(!withheld){
  const mode=bypass?'bypassPermissions':auto?'auto':'acceptEdits',label=mode==='bypassPermissions'?'bypass permissions':mode==='auto'?'use auto mode':'auto-accept edits';
  if(state.settings.showClearContextOnPlanAccept===true&&n.paths.Ar()===null)add(mode==='auto'?'yes-auto-clear-context':mode==='bypassPermissions'?'yes-bypass-permissions':'yes-accept-edits','Clear context and '+label,mode,true);
  add(mode==='auto'?'yes-resume-auto-mode':'yes-accept-edits-keep-context','Keep context and '+label,mode);
  add('yes-default-keep-context','Keep context and manually approve edits','default');
 }
 return {plan:withheld?'':raw,...(typeof payload.planFilePath==='string'?{planFilePath:payload.planFilePath}:{}),empty,withheld,choices,initialChoice:state.proactivityLevel==='ask'&&n.planProactivity.BG()&&choices.some(option=>option.value==='yes-default-keep-context')&&!choices.some(option=>option.value==='yes-resume-auto-mode')?'yes-default-keep-context':choices[0]?.value??'',
  permissionMode:permission.mode,prePlanMode:permission.prePlanMode,autoActive:n.planAuto.yp()};
}
async function answerPlan(n,d,request){
 if(request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native plan feedback');
 const feedback=request.feedback?.trim();
 if(request.choice==='no'){d.store.answer(d.item.id,{behavior:'deny',...(feedback?{feedback}:{})});return;}
 const option=d.planFacts.choices.find(option=>option.value===request.choice);
 if(!option)throw Error('Native plan choice is unavailable');
 const enter=d.payload.toolName==='EnterPlanMode',edited=request.plan!==undefined&&request.plan!==d.payload.plan;
 if(request.plan!==undefined&&(enter||d.planFacts.empty||typeof request.plan!=='string'||request.plan.length>200000||n.questionText.VL(request.plan)))throw Error('Native plan cannot be reviewed');
 const plan=edited?request.plan:d.payload.plan,state=d.context.getAppState(),permission=state.toolPermissionContext;
 if(enter){const row=n.planConsent.kTe('plan');if(!row||!n.planConsent.hv(row))throw Error('Native plan entry is unavailable');n.questionOptions.Sye(permission.mode,'plan');d.store.answer(d.item.id,{behavior:'allow',updatedInput:{},permissionUpdates:row.applies});return;}
 if(option.mode!=='auto'&&n.planAuto.yp()){
  n.planAuto.Fx(false);n.questionOptions.EN(true);
  d.context.setAppState(current=>({...current,toolPermissionContext:{...n.planNormalize.vSe(current.toolPermissionContext),prePlanMode:undefined}}));
 }
 if(option.clearContext){
  if(edited&&typeof d.payload.planFilePath==='string'){await n.planStore.ATo(d.payload.planFilePath,plan,d.context.storageV5);n.runtime.rat(d.context.storageV5);if(await n.planStore.bYe(d.context.agentId,d.context.storageV5)!==plan)throw Error('Native revised plan could not be saved');if(nativeDialog(n,d.item.kind).revision!==d.revision)throw Error('Native plan changed while saving');}
  const pointer=n.runtime.Cf(d.sessionId),teamHint=n.planTool.Cxn(n.planTeams.is());
  // Original xit queues the native reset, then resolves this tool as denied.
  d.context.setAppState(current=>({...current,initialMessage:{message:{...n.runtime.Ae({content:'Implement the following plan:\n\n'+plan+'\n\nIf you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: '+pointer+teamHint+(feedback?'\n\nUser feedback on this plan: '+feedback:''),origin:{kind:'auto-continuation'}}),planContent:plan,queueSkipAttachments:true},clearContext:true,resetTrigger:'plan_mode_exit',mode:option.mode}}));
  if(option.mode==='auto')n.planAuto.Fx(true);
  n.questionOptions.x$(true);d.store.answer(d.item.id,{behavior:'deny'});return;
 }
 n.questionOptions.x$(true);n.questionOptions.s3(true);
 let row;
 if(option.mode==='auto'){
  n.planAuto.Fx(true);
  d.context.setAppState(current=>({...current,toolPermissionContext:n.planNormalize.nV({...current.toolPermissionContext,mode:'auto',prePlanMode:undefined,startupModeDecidedByProactivityLevel:undefined})}));
  row=n.planConsent.Y_n('exit-plan-resume');
 }else row=n.planConsent.kTe(option.mode,{isBypassPermissionsModeAvailable:permission.isBypassPermissionsModeAvailable===true});
 if(!row||!n.planConsent.hv(row))throw Error('Native plan choice is no longer available');
 d.store.answer(d.item.id,{behavior:'allow',updatedInput:edited?{plan}:{},permissionUpdates:row.applies,...(feedback?{feedback}:{})});
}
// Frozen terminal nrt/Yyo contract: native schema first, then presentation-only relabel bounds.
function questionShownInput(n,payload,questions){
 const original=n.questionTool.shownCardInput(payload.input),asked=original.questions;
 const parsed=n.questionTool.inputSchema.safeParse({questions});
 if(!parsed.success)return original;
 const drawn=parsed.data.questions;
 if(drawn.length!==asked.length)return original;
 for(let index=0;index<asked.length;index++){
  const before=asked[index],after=drawn[index];
  if((after.multiSelect??false)!==(before.multiSelect??false))return original;
  for(const field of ['label','preview'])if(JSON.stringify(after.options.map(option=>option[field]))!==JSON.stringify(before.options.map(option=>option[field])))return original;
  if(drawn.some((question,other)=>other!==index&&question.question===after.question)||asked.some((question,other)=>other!==index&&question.question===after.question))return original;
 }
 return {...original,questions:drawn};
}
function rememberQuestionFrame(frame){
 for(const[token,previous]of questionFrameHistory)if(previous.client===frame.client&&(previous.item!==frame.item||previous.revision!==frame.revision))questionFrameHistory.delete(token);
 questionFrameHistory.set(frame.token,frame);
 const owned=[...questionFrameHistory.values()].filter(previous=>previous.client===frame.client);
 for(const previous of owned.slice(0,Math.max(0,owned.length-32)))questionFrameHistory.delete(previous.token);
}
function holdQuestionFrame(dialog,token,client){
 const frame=questionFrameHistory.get(token);
 if(!frame||frame.client!==client||!clients.has(client)||frame.item!==dialog.item||frame.revision!==dialog.revision||frame.sessionId!==dialog.sessionId)throw Error('Native question draft drawing changed or expired');
 const prior=frozenQuestionFrames.get(client);
 if(prior&&prior.item===dialog.item&&prior.revision===dialog.revision)return prior;
 frozenQuestionFrames.set(client,frame);return frame;
}
function forgetQuestionClient(client){
 questionFrames.delete(client);frozenQuestionFrames.delete(client);
 for(const[token,frame]of questionFrameHistory)if(frame.client===client)questionFrameHistory.delete(token);
}
function questionCanonicalAnswer(n,dialog,request){
 const original=n.questionTool.shownCardInput(dialog.payload.input);
 if(request.render_token===undefined)return n.questionTool.admitCardAnswer(original,request.answer);
 let frame=[...questionFrames.values(),...frozenQuestionFrames.values()].find(frame=>frame.token===request.render_token);
 if(request.draft_started===true){
  const issued=questionFrameHistory.get(request.render_token);
  const held=issued&&holdQuestionFrame(dialog,request.render_token,issued.client);
  if(!held||held.token!==request.render_token)throw Error('Native question draft belongs to another drawing');
  frame=held;
 }
 if(!frame||!clients.has(frame.client)||frame.item!==dialog.item||frame.revision!==dialog.revision||frame.sessionId!==dialog.sessionId)throw Error('Native question drawing changed or expired');
 const admitted=n.questionTool.admitCardAnswer(frame.shownInput,request.answer);
 if(admitted.kind!=='admitted')return admitted;
 const remap=values=>{
  if(values===undefined)return values;
  const mapped=Object.create(null);
  for(const [question,value]of Object.entries(values)){
   const index=frame.shownInput.questions.findIndex(candidate=>candidate.question===question);
   if(index<0)throw Error('Native question answer has no original identity');
   mapped[original.questions[index].question]=value;
  }
  return mapped;
 };
 const answer={...original,answers:remap(admitted.input.answers),...(admitted.input.annotations!==undefined?{annotations:remap(admitted.input.annotations)}:{}),...(admitted.input.response!==undefined?{response:admitted.input.response}:{}),...(admitted.input.followUp!==undefined?{followUp:admitted.input.followUp}:{})};
 return n.questionTool.admitCardAnswer(original,answer);
}
function questionPresentation(n,payload){
 const previewFormat=n.questionOptions.yjr()??null,previews=[];
 for(const question of payload.questions)for(const option of question.options??[]){
  if(typeof option.preview!=='string')continue;
  // Frozen terminal h4 producer: its 2000-character display cap and native text helpers.
  const kind=option.preview.length>2000?'withheld':!n.questionText.zL(option.preview)?'empty':n.questionText.VL(option.preview)?'withheld':'full';
  previews.push({question:question.question,option:option.label,kind,...(kind==='full'?(previewFormat==='html'?{html:option.preview}:{markdown:n.questionText._gt(option.preview)}):{})});
 }
 return {previewFormat,extendedQuestions:n.questionOptions.ZCe(),optionalDescriptions:n.questionOptions.Hzo(),previews};
}
const schemaNames={ui_focus:'HUt',ui_scroll:'MUt',ui_panes:'xUt',ui_pane_show:'PUt',ui_pane_focus:'IUt',ui_close:'OUt',ui_prompt_edit:'DUt',ui_prompt_autocomplete:'LUt',ui_attach:'M5n',ui_detach:'H5n',ui_render:'D5n',ui_press:'vUt',ui_input:'AUt',ui_select:'RUt'};
let nativeViewSequence=0,nativeViewKey;
function nativeViewFacts(n,binding,abort){
 const context=binding.toolContext(abort),selected=context.getAppState().viewingAgentTaskId;
 const task=selected===undefined?undefined:context.taskRegistry.get(selected),identity=task?n.runtime.flt(task):undefined;
 const view=selected===undefined?{kind:'main'}:{kind:'agent',registryId:selected,...(identity?{taskId:identity.id}:{})};
 const sessionId=String(n.questionOptions.q()),key=JSON.stringify([sessionId,view]);
 if(key!==nativeViewKey){nativeViewKey=key;nativeViewSequence++;}
 return {sessionId,view,sequence:nativeViewSequence};
}
async function control(request,abort){
 const n=await initialize();
 if(typeof request.client_id==='string'&&clients.has(request.client_id)&&!['ui_attach','ui_detach'].includes(request.subtype)&&!clientViewCurrent(n,request.client_id))throw Error('Native UI client belongs to a different selected view');
 if(request.subtype==='apack_ui_agent_dispatch')return dispatchNativeAgentInput(n,request,abort);
 if(request.subtype==='apack_ui_agent_command')return answerNativeAgentCommand(n,request);
 if(request.subtype==='apack_parent_prompt_state'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native parent view is unavailable');
  return {main:binding.toolContext(abort).getAppState().viewingAgentTaskId===undefined};
 }
 if(request.subtype==='apack_owner_snapshot'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native owner is not bound');
  const globals=await import('/$bunfs/root/chunk-hdxpvbx1.js'),settings=await import('/$bunfs/root/chunk-1pjd7qsk.js'),paths=await import('/$bunfs/root/chunk-27d659a1.js');
  const sessionId=String(globals.q());
  if(sessionId!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId&&request.follow_native_session!==true)throw Error('Native owner session changed');
  const effective=settings.ut(),policy=settings.me('policySettings')??{};
  const facts=nativeViewFacts(n,binding,abort),view=facts.view;
  if(request.policy_only===true)return {...facts,policy:{allowManagedHooksOnly:policy.allowManagedHooksOnly===true,disableAllHooks:policy.disableAllHooks===true},hooksDisabled:effective.disableAllHooks===true};
  const context=binding.toolContext(abort),messages=binding.messages(),usage=await n.runtime.Hco({},'apack native owner');
  const helpers=(policy.allowManagedHooksOnly||effective.disableAllHooks&&!policy.disableAllHooks)?policy:effective;
  const command=value=>value?.type==='command'&&typeof value.command==='string'?value.command:null;
  // Frozen native her: exclude synthetic/meta/virtual tool-result inputs from the human turn count.
  const turns=messages.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true&&!(Array.isArray(row.message?.content)&&row.message.content.some(block=>block.type==='tool_result'))).length;
  const turn=n.runtime.lpe();
  return {sessionId,view,busy:context.turnActivity.getSnapshot()===true,transcriptPath:n.runtime.Cf(sessionId),hooksDisabled:effective.disableAllHooks===true,metadata:{permissionMode:context.getAppState().toolPermissionContext.mode,cwd:paths.ce(),model:binding.model(),turns,startedAt:usage.startedAt,totalCostUsd:usage.cost.usd},statusCommand:policy.disableAllHooks?null:command(helpers.statusLine),subagentCommand:policy.disableAllHooks?null:command(helpers.subagentStatusLine),shellPrefix:process.env.CLAUDE_CODE_SHELL_PREFIX??null,policy:{allowManagedHooksOnly:policy.allowManagedHooksOnly===true,disableAllHooks:policy.disableAllHooks===true},turn:turn?{id:turn.turnId,cancelled:turn.cancelled()}:null,taskFacts:Object.values(context.taskRegistry.all()).flatMap(task=>{const identity=n.runtime.flt(task);return identity?[{...identity,status:task.status,isIdle:task.isIdle===true,finalizing:task.finalizing===true,awaitingPlanApproval:task.awaitingPlanApproval===true,keepaliveReasons:[...task.keepaliveReasons??[]]}]:[]})};
 }
 if(request.subtype==='apack_plan_dialogs'){
  let d=nativeDialog(n,'permission_enter_plan_mode');if(!d.item)d=nativeDialog(n,'permission_exit_plan_mode_v2');if(!d.item)return {dialogs:[]};
  const{permissionMode,prePlanMode,autoActive,...presentation}=d.planFacts;
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:d.payload.toolName,input:d.payload.input,presentation,...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{})}]};
 }
 if(request.subtype==='apack_answer_plan_dialog'){
  abort.signal.throwIfAborted();let d=nativeDialog(n,'permission_enter_plan_mode');if(!d.item)d=nativeDialog(n,'permission_exit_plan_mode_v2');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native plan changed or expired');
  await answerPlan(n,d,request);dialogRevisions.delete(d.item.kind);return {answered:true};
 }
 if(request.subtype==='apack_bash_dialogs'){
  const d=nativeDialog(n,'permission_bash');if(!d.item)return {dialogs:[]};
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:'Bash',cwd:n.paths.ce(),command:d.payload.input.command,...(typeof d.payload.description==='string'?{description:d.payload.description}:{}),...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{}),input:d.payload.input}]};
 }
 if(request.subtype==='apack_answer_bash_dialog'){
  abort.signal.throwIfAborted();const d=nativeDialog(n,'permission_bash');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native Bash approval changed or expired');
  if(!['allow','deny'].includes(request.decision)||request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native Bash decision');
  const result=request.decision==='allow'?{behavior:'allow',updatedInput:d.payload.input}:{behavior:'deny',...(request.feedback?{feedback:request.feedback}:{})};
  d.store.answer(d.item.id,result);dialogRevisions.delete('permission_bash');return {answered:true};
 }
 if(request.subtype==='apack_file_dialogs'){
  const d=nativeDialog(n,'permission_file');if(!d.item)return {dialogs:[]};
  const p=d.payload;
  const content=p.content,isWrite=['Write','Edit'].includes(p.toolName);
  const withheld=p.contentWithheld===true||content?.kind==='no-changes';
  const review=isWrite?{withheld,...(typeof content?.message==='string'?{notice:content.message}:typeof content?.notice==='string'?{notice:content.notice}:{}),...(!withheld?(content.kind==='file-write-diff'?{...(content.fileExists?{before:content.oldContent}:{}),after:content.content}:{before:content.edits[0].old_string,after:content.edits[0].new_string,replaceAll:content.edits[0].replace_all===true}):{})}:undefined;
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:p.requestId,toolName:p.toolName,title:p.title??'File permission',question:p.question?.kind==='plain'?p.question.text:p.question?.kind==='file-action'?'Allow Claude to '+p.question.verbPhrase+' '+p.question.fileName+'?':'Allow this file operation?',...(review?{review}:{}),...(typeof p.permissionResult?.message==='string'?{reason:p.permissionResult.message}:{}),input:p.input}]};
 }
 if(request.subtype==='apack_answer_file_dialog'){
  abort.signal.throwIfAborted();
  const d=nativeDialog(n,'permission_file');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native approval changed or expired');
  if(!['allow','deny'].includes(request.decision)||request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native file decision');
  const result=request.decision==='allow'?{behavior:'allow',updatedInput:d.payload.input}:{behavior:'deny',...(request.feedback?{feedback:request.feedback}:{})};
  // The native requestDialog validates and dispatches this result through its original ask path.
  d.store.answer(d.item.id,result);dialogRevisions.delete('permission_file');
  return {answered:true};
 }
 if(request.subtype==='apack_question_dialogs'){
  const d=nativeDialog(n,'permission_ask_user_question');if(!d.item)return {dialogs:[]};
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:'AskUserQuestion',shownInput:n.questionTool.shownCardInput(d.payload.input),presentation:questionPresentation(n,d.payload)}]};
 }
 if(request.subtype==='apack_hold_question_dialog'){
  abort.signal.throwIfAborted();const d=nativeDialog(n,'permission_ask_user_question');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native question changed or expired');
  holdQuestionFrame(d,request.render_token,request.client_id);return {held:true};
 }
 if(request.subtype==='apack_answer_question_dialog'){
  abort.signal.throwIfAborted();
  const d=nativeDialog(n,'permission_ask_user_question');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native question changed or expired');
  const admitted=questionCanonicalAnswer(n,d,request);
  if(admitted.kind!=='admitted')throw Error('Native question answer refused: '+admitted.rule);
  // The original tool validates answer keys, shown fields, previews/notes and host-only fields.
  d.store.answer(d.item.id,{behavior:'allow',updatedInput:admitted.input});dialogRevisions.delete('permission_ask_user_question');
  return {answered:true};
 }
 if(request.subtype==='apack_task_control'){
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native task session changed');};
  const binding=originalContext??n.runtime.ey();if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native task controls are not ready');
  if(request.operation==='foreground'){
   if(clients.size)throw Error('Detach desktop prompt handlers before selecting a native Agent view');
   if((await ownerPost('/owner-pending',{})).pending)throw Error('A native parent prompt is pending');
  }
  const result=await nativeTaskControl(n,binding,request,abort,current);
  if(result.view)await ownerPost('/native-view',{...nativeViewFacts(n,binding,abort),pid:process.pid});
  return result;
 }
 if(request.subtype==='apack_mcp_control'){
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native MCP session changed');};
  current();
  if(typeof request.server_name!=='string'||!request.server_name.trim()||!['reconnect','enable','disable'].includes(request.operation))throw Error('Invalid native MCP control');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native MCP controls are not ready');
  const liveMcp=()=>binding.toolContext(abort).getAppState().mcp;
  if(!liveMcp().clients.some(client=>client.name===request.server_name))throw Error('Native MCP server not found');
  if(mcpControlActive)throw Error('Another native MCP control is in progress');
  mcpControlActive=true;try{
  const reconnect=n.mcpControls.Mot(),toggle=n.mcpControls.urs(),disabled=n.mcpControls.Z_e();
  if(typeof reconnect!=='function'||typeof toggle!=='function'||typeof disabled!=='function')throw Error('Native MCP controls are not ready');
  let outcome;
  if(request.operation==='reconnect')outcome=(await reconnect(request.server_name)).client;
  else if(disabled(request.server_name)===(request.operation==='enable'))outcome=await toggle(request.server_name);
  // Original CRe batches store publication on a 16ms timer after its callback resolves.
  const deadline=Date.now()+4000;
  while(outcome){
   current();const row=liveMcp().clients.find(client=>client.name===request.server_name);
   if(row?.type===outcome.type&&(outcome.type!=='connected'||row.client===outcome.client))break;
   if(Date.now()>=deadline)throw Error('Native MCP connection state has not settled; read status again');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  current();
  if(reconnect!==n.mcpControls.Mot()||toggle!==n.mcpControls.urs())throw Error('Native MCP owner changed');
  const context=liveMcp();return {mcpServers:n.mcp.Q_n({connections:context.clients,tools:context.tools})};
  }finally{mcpControlActive=false;}
 }
 if(request.subtype==='apack_mcp_status'){
  const expected=request.session_id;
  if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native MCP session changed');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native MCP status is not ready');
  const context=binding.toolContext(abort).getAppState().mcp;
  return {mcpServers:n.mcp.Q_n({connections:context.clients,tools:context.tools})};
 }
 if(request.subtype==='apack_rename_session'){
  if(typeof request.title!=='string')throw Error('Native title must be a string');
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native rename session changed');};
  current();
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native rename controls are not ready');
  const context=binding.toolContext(abort),result=await n.rename.Qar(request.title,context,true);
  current();if(typeof result.newName!=='string'||!result.newName)throw Error(result.message??'Native rename was refused');
  if(result.isGenerated!==true){
   await context.appendSystemMessage(n.runtime.Ae({content:n.rename.G8s(result.newName,result.requestedName),isMeta:true}));
   current();
  }
  return {title:result.newName,message:result.message};
 }
 if(request.subtype==='apack_list_models')return {models:n.catalog.kae(n.catalog.dOe(request.include_unsupported_models===true))};
 if(request.subtype==='apack_set_model'){
  if(typeof request.model!=='string'||!request.model.trim()||request.model.length>256)throw Error('Invalid native model selection');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native model controls are not ready');
  const context=binding.toolContext(abort),sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId,deadline=Date.now()+4000;
  const current=()=>{abort.signal.throwIfAborted();if(Date.now()>deadline||JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==sessionId)throw Error('Native model selection expired or changed session');};
  return n.runtime.DS(context.session,async()=>{
   current();
   const validation=await n.models.dRe(request.model,context.storageV5,context.credentials,{deadlineMs:2500});
   current();if(!validation.ok)throw Error(validation.message);
   if(n.models.Ooe(validation.model))throw Error('This model requires native interactive consent; choose it with /model in the native interface');
   const hooks=await n.models.SC(context.session,context.getAppState,validation.model,'sdk',{signal:abort.signal});
   current();if(hooks.decision!=='proceed')throw Error(n.models.BKe(hooks));
   const notice=await n.models.jKe(context.session,validation.model,context.getAppState,context.setAppState,false,'sdk',validation.substitutedFrom,context.storageV5);
   const state=context.getAppState(),selection=state.mainLoopModelForSession??state.mainLoopModel??'default';
   return {selection,notice};
  });
 }
 if(request.subtype==='apack_ui_capabilities'){const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};return {capabilities:n.gate.Uvn('ui_attach',()=>facts)?[]:['ui_surface_v1','apack_native_view_v1']};}
 if(request.subtype==='apack_observe_notices'){installNotices(n,n.runtime.ey());return {observing:true};}
 if(request.subtype==='apack_get_permission_mode'||request.subtype==='apack_set_permission_mode'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native permission controls are not ready');
  const context=binding.toolContext(new AbortController());
  const before=context.getAppState().toolPermissionContext;
  if(request.subtype==='apack_get_permission_mode')return {mode:before.mode};
  const result=n.permissions.bC(request.mode,before,update=>context.setToolPermissionContext(update));
  if(!result.ok)throw Error(result.error);
  const mode=context.getAppState().toolPermissionContext.mode;
  if(mode!==result.mode)throw Error('Native permission mode was not applied');
  return {mode};
 }
 if(request.subtype==='apack_prompt_outcome')return promptOutcome(n,request.submission_id);
 if(request.subtype==='apack_terminal_draft'){
  if(preparedPrompt?.id!==request.submission_id)throw Error('Native prepared prompt identity changed');
  const box=await (originalContext??n.runtime.ey()).composer.read();
  const images=[...box.text.matchAll(/\[image\s*#\d+\]/gi)].length;
  if(request.remember===true)preparedPrompt.text=box.text;
  return {...box,images};
 }
 if(request.subtype==='apack_prepare_prompt')return prepareTerminalPrompt(n,request.text,request.submission_id,request.allow_empty===true);
 let boundQuestion;
 if(request.subtype==='apack_render_question_dialog'){
  abort.signal.throwIfAborted();boundQuestion=nativeDialog(n,'permission_ask_user_question');
  if(!boundQuestion.item||request.id!==boundQuestion.item.id||request.revision!==boundQuestion.revision||request.session_id!==boundQuestion.sessionId)throw Error('Native question changed or expired');
  request={subtype:'ui_render',surface:'desktop',client_id:request.client_id,component:'AskUserQuestion',instance_id:boundQuestion.payload.requestId,props:{},...(request.viewport?{viewport:request.viewport}:{})};
 }
 if(request.subtype==='apack_ui_client'){if(!clients.has(request.client_id))throw Error('Native Client view is detached');await n.gate._Jo('desktop');return n.nativeClients.event(request.client_id,request.id,request.sequence,request.event);}
 const schema=schemaNames[request.subtype];
 if(!schema)throw Error('Native terminal UI operation is not integrated: '+request.subtype);
 const value=n.schemas[schema]().parse(request);
 if(value.surface!==undefined&&value.surface!=='desktop')throw Error('This app owns a desktop UI surface');
 const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};
 if(n.gate.Uvn(value.subtype,()=>facts))throw Error('Native UI eligibility refused this operation');
 const clientId=value.client_id;
 if(value.subtype==='ui_attach'){
  const viewKey=clientAttachmentViewKey(n,request.native_view);
  if(!clients.has(clientId)&&clients.size>=64)throw Error('Native UI attachment limit reached');
  const answers=value.answers??[];if(answers.some(answer=>!['ui_prompt_read','ui_prompt_fill','ui_prompt_suggest'].includes(answer)))throw Error('Native reverse UI operation is not integrated');
  installNotices(n,n.runtime.ey());
  if(answers.length)installHosts(n);
  if(clients.has(clientId)&&clientViews.get(clientId)!==viewKey)throw Error('Detach the previous native view before attaching again');
  clients.add(clientId);clientViews.set(clientId,viewKey);
  try{await n.session.I9s({surface:'desktop',clientId,...(value.viewport?{viewport:value.viewport}:{})},answers);if(clientViewKey(n)!==viewKey)throw Error('Native selected view changed during attachment');}catch(error){clients.delete(clientId);clientViews.delete(clientId);try{await n.session.d2t(clientId,'detach');}catch{}if(!n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.length))restoreHosts(n);throw error;}
  replayNotices();
  return {surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_detach'){
  await retireNativeAgentCommands(clientId);
  n.nativeClients.detach(clientId);
  for(const [key,site] of sites)if(site.clientId===clientId)dropSite(n,key);
  clearEdit(clientId);clearCompletion(clientId);
  forgetQuestionClient(clientId);
  clientViews.delete(clientId);
  const detached=clients.delete(clientId);if(detached)await n.session.d2t(clientId,'detach');
  if(!n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.length))restoreHosts(n);
  return {detached,surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_focus')return remoteFocus(n,value);
 if(value.subtype==='ui_scroll')return remoteScroll(n,value);
 if(['ui_panes','ui_pane_show','ui_pane_focus','ui_close'].includes(value.subtype)){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  if(value.subtype==='ui_panes')return paneRoster(n);
  if(value.subtype==='ui_pane_show'){n.roster.avr(value.id);return {shown_id:n.roster.Ui().getState().shownId};}
  if(value.subtype==='ui_pane_focus'){n.roster.GY(value.id);return {focused_id:n.roster.Ui().getState().focusedId};}
  await n.roster.rct(value.id,{kind:'person'});
  return {closed:!n.roster.Hwe(n.roster.Ui().getState()).some(pane=>pane.id===value.id)};
 }
 if(value.subtype==='ui_prompt_edit'){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  return editPrompt(n,id,{text:value.text,cursor:value.cursor},value.key,value.by);
 }
 if(value.subtype==='ui_prompt_autocomplete'){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  return autocomplete(n,id,n.session.o_n({text:value.text,cursor:value.cursor}));
 }
 if(value.subtype==='ui_render'){
  if(!clients.has(clientId))throw Error('Native UI client is not attached to this owner');
  await n.gate._Jo('desktop');
  if(!clientViewCurrent(n,clientId))throw Error('Native UI client belongs to a different selected view');
  const question=boundQuestion;
  const props=question?{tool:question.payload.toolName,questions:question.payload.questions,...(question.payload.metadataSource?{metadataSource:question.payload.metadataSource}:{})}:{...value.props};
  if(value.component==='AbovePrompt'||value.component==='Pane'){
   const selected=nativeViewFacts(n,originalContext??n.runtime.ey(),abort).view;
   if(selected.kind==='agent'&&!selected.taskId)throw Error('Native selected Agent is no longer available');
   props.view=selected.kind==='main'?{}:{agentId:selected.taskId};
  }
  if((value.component==='ToolUse'||value.component==='ToolResult')&&typeof props.tool_use_id!=='string')props.tool_use_id=value.instance_id;
  if(typeof props.output==='string'&&props.output.length>65536)props.output=props.output.slice(0,65536);
  const result=await n.engine.I9e.run({surface:'desktop',component:value.component,requestId:value.instance_id,...(value.viewport?{viewport:value.viewport}:{}),props});
  if(!clientViewCurrent(n,clientId))throw Error('Native UI selection changed while rendering');
  let questionFrame;
  if(question){
   abort.signal.throwIfAborted();
   const current=nativeDialog(n,'permission_ask_user_question');
   if(!clients.has(clientId)||current.item!==question.item||current.revision!==question.revision)throw Error('Native question changed while rendering');
   const prior=frozenQuestionFrames.get(clientId);
   const held=prior?.item===question.item&&prior.revision===question.revision?prior:undefined;
   if(!held)frozenQuestionFrames.delete(clientId);
   const shownInput=held?.shownInput??questionShownInput(n,question.payload,result.props.questions),token=held?.token??randomUUID();
   if(!questionFrames.has(clientId)&&questionFrames.size>=64)questionFrames.delete(questionFrames.keys().next().value);
   const frame={client:clientId,token,item:question.item,revision:question.revision,sessionId:question.sessionId,requestId:question.payload.requestId,shownInput};
   questionFrames.set(clientId,frame);rememberQuestionFrame(frame);
   questionFrame={token,dialogId:question.item.id,revision:question.revision,shownInput,presentation:questionPresentation(n,{...question.payload,questions:shownInput.questions})};
  }
  refreshNativeTheme(n);
  recordDrawing(n,value,result.tree);
  return {...(questionFrame?{question:questionFrame}:{}),tree:nativeThemeTree(n,n.nativeClients.render(clientId,value.component,value.instance_id,result.tree)),props:questionFrame?{...result.props,questions:questionFrame.shownInput.questions}:result.props,rewritten:result.rewritten,hooked:n.gate.n5r(value.component,'desktop'),...(Object.keys(result.clientModules).length?{client_modules:result.clientModules}:{}),drawn_by:result.drawnBy};
 }
 if(!clients.size)throw Error('Native UI has no attached app view');
 for(const site of sites.values())refreshSite(n,site);
 const dispatched=await n.nativeClients.dispatchAction(clientId,value);if(dispatched!==undefined)return dispatched;
 const clientAction=n.nativeClients.action(clientId,value);if(clientAction===false)return {handled:false};
 const args={plugin:value.plugin,handle:clientAction?.handle??value.handle,surface:'desktop',...(value.key!==undefined?{element:value.key}:{}),...(clientAction?{component:clientAction.component,requestId:clientAction.requestId}:{...(value.component!==undefined?{component:value.component}:{}),...(value.instance_id!==undefined?{requestId:value.instance_id}:{})})};
 const result=value.subtype==='ui_press'?await n.engine.I9e.press({...args,...(value.href!==undefined?{link:{href:value.href}}:{})}):value.subtype==='ui_input'?await n.engine.I9e.input({...args,kind:value.kind,value:value.value}):await n.engine.I9e.select({...args,value:value.value});
 return result===undefined?{handled:false}:{handled:true,element:result.element,...(value.subtype!=='ui_press'?{value:result.value}:{})};
}
const server=http.createServer(async(request,response)=>{
 const abort=new AbortController();response.once('close',()=>abort.abort());
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
   if(activeSession!==body.sessionId){await retireNativeAgentCommands();if(native){native.nativeClients.detach();for(const key of sites.keys())dropSite(native,key);for(const id of clients){clearEdit(id);clearCompletion(id);await native.session.d2t(id,'detach');}restoreHosts(native);}clients.clear();clientViews.clear();questionFrames.clear();questionFrameHistory.clear();frozenQuestionFrames.clear();preparedPrompt=undefined;resetNotices(body.sessionId);activeSession=body.sessionId;}
   const result=await control(body.request,abort);
   if(JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==body.sessionId)throw Error('Native session changed during UI request');
   reply(200,{...identity,result});
  }catch(error){reply(400,{...identity,error:String(error?.message??error)});}finally{inFlight--;}
 }catch{reply(400,{});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.uiSocketPath,resolve);});server.unref();


async function ownerPost(path,body){
 return new Promise((resolve,reject)=>{const request=http.request({socketPath:config.socketPath,path,method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:2000},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{if(response.statusCode!==200)throw Error('Native owner broker refused');resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch(error){reject(error);}});});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('Native owner broker timeout')));request.end(JSON.stringify({sessionId:JSON.parse(readFileSync(configUrl,'utf8')).sessionId,...body}));});
}
function ownerAgents(facts){
 const result=new Map();
 for(const task of facts){
  // Frozen native zln projection; task identity comes from the original flt export.
  let status=task.status;
  if(status==='running'&&(task.awaitingPlanApproval||task.isIdle))status='waiting';
  else if(status==='completed')status=task.finalizing?'running':task.keepaliveReasons.some(reason=>reason!=='flag:idle-window')?'waiting':task.name||task.keepaliveReasons.length?'idle':'completed';
  else if(status==='paused')status='idle';
  const prior=result.get(task.id);if(prior&&['running','waiting','idle'].includes(prior.status))continue;
  result.set(task.id,{id:task.id,type:task.type,status});
 }
 return [...result.values()];
}
let ownerReading=false,ownerIndependent=false,reportedView;
const ownerTimer=setInterval(async()=>{
 if(ownerReading)return;ownerReading=true;
 try{
  const gate=await control({subtype:'apack_owner_snapshot',policy_only:true,follow_native_session:true},new AbortController());
  const viewKey=JSON.stringify([gate.sessionId,gate.view,gate.sequence]);
  if(viewKey!==reportedView){await ownerPost('/native-view',{sessionId:gate.sessionId,pid:process.pid,view:gate.view,sequence:gate.sequence});reportedView=viewKey;}
  if(gate.policy.allowManagedHooksOnly||gate.policy.disableAllHooks||gate.hooksDisabled)ownerIndependent=true;
  if(native)refreshNativeTheme(native);
  if(!ownerIndependent)return;
  const snapshot=await control({subtype:'apack_owner_snapshot',follow_native_session:true},new AbortController());
  const body={...snapshot,agents:ownerAgents(snapshot.taskFacts),directOwner:true};
  const command=await ownerPost('/poll',body);
  await ownerPost('/transcript',{path:snapshot.transcriptPath});
  if(command.id){
   let filled=command.prepared===true;
   if(!filled)filled=(await control({subtype:'apack_prepare_prompt',text:command.text,submission_id:command.id},new AbortController())).filled===true;
   await ownerPost('/result',{id:command.id,filled});
  }
  const pending=await ownerPost('/owner-pending',{});
  if(pending.id){
   const outcome=await control({subtype:'apack_prompt_outcome',submission_id:pending.id},new AbortController());
   if(outcome.drop)await ownerPost('/submission',{id:pending.id,drop:outcome.drop});
   else if(outcome.accepted){await ownerPost('/append',{...outcome.accepted,submissionId:pending.id});await ownerPost('/submission',{id:pending.id,accepted:true});}
  }
 }catch{}finally{ownerReading=false;}
},250);ownerTimer.unref();
`
