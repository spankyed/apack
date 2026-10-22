import { claudeNativeToolResultRuntime } from './native-tool-result-runtime.ts'
import { withClaudeNativePlatformRuntime } from './native-platform-runtime.ts'
import { claudeNativeThemeRuntime } from './native-theme-runtime.ts'
import { claudeTerminalClientRuntime } from './terminal-client-runtime.ts'

/** Runs inside the original print CLI; authored UI modules stay in its original sandbox. */
export function createClaudePrintClientRuntime(config: { socketPath: string; token: string; epoch: string; originalBunOptions?: string }): string {
  return withClaudeNativePlatformRuntime(`import {createServer} from 'node:http';import {randomUUID,createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
const config=${JSON.stringify(config)};
${claudeTerminalClientRuntime}
${claudeNativeThemeRuntime}
${claudeNativeToolResultRuntime}
` + String.raw`
if(createHash('sha256').update(readFileSync(process.execPath)).digest('hex')==='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37'){
if(config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
const scopes=new Map(),latest=new Map(),pendingInvalidations=new Map(),latestAt=new Map();let initialization,host,engine,gate,clients,roster,invalidating,themeSettings,themeResolver,themeFiles,themePalette,stopThemeWatch,loadingTheme;
const scopeKey=(client,component,instance)=>JSON.stringify([client,component,instance]);
function invalidate(entry){
 const key=scopeKey(entry.client,entry.component,entry.requestId);pendingInvalidations.set(key,entry);
 if(!invalidating){invalidating=setTimeout(()=>{invalidating=undefined;for(const[key,entry]of pendingInvalidations){if(!scopes.has(key))continue;process.stdout.write(JSON.stringify({type:'system',subtype:'ui_invalidate',event:'ui.render',client_snapshot:true,client_id:entry.client,instances:[{surface:'desktop',component:entry.component,instance_id:entry.requestId}]})+'\n');}pendingInvalidations.clear();},25);invalidating.unref();}
}
function remember(key,sequence){latest.set(key,sequence);latestAt.set(key,Date.now());}
function publishTheme(){
 const next=themeResolver.UKe(themeSettings.Ss('theme','dark').value),changed=JSON.stringify(themePalette)!==JSON.stringify(next),prior=themePalette;themePalette=next;
 if(changed){process.stdout.write(JSON.stringify({type:'system',subtype:'ui_prompt_theme',palette:next})+'\n');if(prior)process.stdout.write(JSON.stringify({type:'system',subtype:'ui_invalidate',event:'ui.render'})+'\n');}
 return next;
}
async function palette(){
 if(!stopThemeWatch){await (loadingTheme??=themeFiles.ETt().finally(()=>{loadingTheme=undefined}));stopThemeWatch??=themeFiles.vcr(()=>{void themeFiles.ETt().then(()=>{if(stopThemeWatch)publishTheme()}).catch(()=>{});});}
 return publishTheme();
}
function initialize(){return initialization??=(async()=>{
 themeSettings=await import('/$bunfs/root/chunk-c7857g1z.js');themeResolver=await import('/$bunfs/root/chunk-4z4q4qvr.js');themeFiles=await import('/$bunfs/root/chunk-5feck2gp.js');
 const source=await import('/$bunfs/root/chunk-hqtnbrjd.js'),session=await import('/$bunfs/root/chunk-hdxpvbx1.js');
 engine=await import('/$bunfs/root/chunk-c7wcn77x.js');gate=await import('/$bunfs/root/chunk-wn0572jb.js');clients=await import('/$bunfs/root/chunk-e980bbar.js');roster=await import('/$bunfs/root/chunk-nkxb8t4d.js');
 const originalRender=engine.I9e.run;
 engine.I9e.run=function(value){return Reflect.apply(originalRender,this,[nativePrintToolRender(value,source.ey(),session.q())]);};
 const registry=()=>clients.x3r({port:clients.A3r({run:({plugin,message})=>engine.I9e.clientMessage({plugin,component:message.component,requestId:message.requestId,key:message.element,module:message.module,data:message.data}).then(value=>value??{})})});
 host=createNativeClientHost(registry,invalidate,clients.R3r,{
  current:entry=>{const scope=scopes.get(scopeKey(entry.client,entry.component,entry.requestId));return scope&&scope.revision===entry.instanceRevision&&roster.Kw.list().some(client=>client.clientId===entry.client);},
  eligible:entry=>{const scope=scopes.get(scopeKey(entry.client,entry.component,entry.requestId));return engine.FPe(entry.plugin)&&scope?.hashes[entry.plugin]===engine.I9e.clientModule(entry.plugin)?.hash;},
  dispatch:value=>engine.I9e.clientPress(value),
  run:value=>{const held=engine.r5.heldPress(value.plugin,value.handle,value.key);if(!held||held.component!==value.component||held.requestId!==value.requestId)return false;const run=engine.tut.runnerFor(value.plugin,held.handle);if(!run)return false;run(value.event);return true;}
 });
})();}
function validSite(value){if(!value||typeof value.client_id!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(value.client_id)||typeof value.component!=='string'||typeof value.instance_id!=='string'||value.component.length>256||value.instance_id.length>256)throw Error('Invalid print Client scope');}
async function operation(body,live){
 await initialize();const value=body.value;
 if(body.operation==='decorations'){if(!value||typeof value.client_id!=='string'||!roster.Kw.list().some(client=>client.clientId===value.client_id))throw Error('Print prompt owner is unavailable');await gate._Jo('desktop');return nativePaletteDecorations(await palette(),value.decorations);}
 if(body.operation==='prepare-render'){validSite(value);if(value.surface!=='desktop')throw Error('Print render surface is unavailable');return {ready:true};}
 if(body.operation==='project'){
  validSite(value);if(value.surface!=='desktop')throw Error('Print Client surface is unavailable');
  const key=scopeKey(value.client_id,value.component,value.instance_id),sequence=body.sequence;
  if(sequence<=(latest.get(key)??0))throw Error('Print Client render expired');remember(key,sequence);
  await gate._Jo('desktop');
  const hashes=body.frame?.client_modules??{},signature=JSON.stringify(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)));
  for(const[plugin,hash]of Object.entries(hashes))if(typeof hash!=='string'||engine.I9e.clientModule(plugin)?.hash!==hash)throw Error('Native Client module changed before projection');
  const prior=scopes.get(key);
  if(prior&&(prior.revision!==value.instance_revision||prior.signature!==signature)){scopes.delete(key);host.release(value.client_id,value.component,value.instance_id);await host.settle(value.client_id,value.component,value.instance_id);}
  const resolvedPalette=await palette();
  if(!live()||latest.get(key)!==sequence||!roster.Kw.list().some(client=>client.clientId===value.client_id))throw Error('Print Client render was replaced');
  scopes.set(key,{revision:value.instance_revision,hashes,signature,requestId:body.id});
  return {...body.frame,tree:nativePaletteTree(resolvedPalette,host.render(value.client_id,value.component,value.instance_id,body.frame.tree,value.instance_revision))};
 }
 if(body.operation==='release'){
  validSite(value);const key=scopeKey(value.client_id,value.component,value.instance_id),scope=scopes.get(key);
  if(!scope||scope.revision!==value.instance_revision)return{released:false};
  remember(key,body.sequence);scopes.delete(key);pendingInvalidations.delete(key);host.release(value.client_id,value.component,value.instance_id);await host.settle(value.client_id,value.component,value.instance_id);return{released:true};
 }
 if(body.operation==='detach'){
  for(const[key]of scopes){if(JSON.parse(key)[0]===value.client_id){remember(key,body.sequence);scopes.delete(key);pendingInvalidations.delete(key);}}
  host.detach(value.client_id);if(!scopes.size){stopThemeWatch?.();stopThemeWatch=undefined;themePalette=undefined;}return{detached:true};
 }
 if(body.operation==='event'){await gate._Jo('desktop');return host.event(value.client_id,value.id,value.sequence,value.event);}
 if(body.operation==='action'){
  await gate._Jo('desktop');const dispatched=await host.dispatchAction(value.client_id,value);if(dispatched!==undefined)return dispatched;
  const action=host.action(value.client_id,value);if(action===false)return{handled:false};if(!action)return;
  const reached=await engine.I9e.press({plugin:value.plugin,handle:action.handle,element:value.key,surface:action.surface,component:action.component,requestId:action.requestId,...(value.href!==undefined?{link:{href:value.href}}:{})});
  return reached?{handled:true,element:reached.element}:{handled:false};
 }
 throw Error('Unknown print Client operation');
}
const server=createServer(async(request,response)=>{
 let id,body;
 response.once('close',()=>{if(response.writableEnded||body?.operation!=='project'||!host)return;const value=body.value;if(!value)return;const key=scopeKey(value.client_id,value.component,value.instance_id);if(scopes.get(key)?.requestId===id){scopes.delete(key);pendingInvalidations.delete(key);host.release(value.client_id,value.component,value.instance_id);}});
 const answer=(status,value)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify({id,pid:process.pid,epoch:config.epoch,...value}));};
 try{
  if(request.method!=='POST'||request.url!=='/clients'||request.headers['x-apack-native-token']!==config.token){answer(403,{error:'Print Client request refused'});return;}
  const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>2*1048576)throw Error('Print Client request exceeds limit');chunks.push(chunk);}
  body=JSON.parse(Buffer.concat(chunks));id=body.id;
  if(typeof id!=='string'||(body.operation!=='hello'&&body.ownerPid!==process.pid)||body.epoch!==config.epoch||!Number.isSafeInteger(body.sequence)||body.sequence<1)throw Error('Print Client owner changed');
  answer(200,{result:body.operation==='hello'?{ready:true}:await operation(body,()=>!response.destroyed)});
 }catch(error){answer(400,{error:error instanceof Error?error.message:'Print Client request failed'});}
});
server.on('error',()=>{});server.listen(config.socketPath);server.unref();
const sweep=setInterval(()=>{const now=Date.now();for(const[key,at]of latestAt){if(!scopes.has(key)&&now-at>10000){latestAt.delete(key);latest.delete(key);}}if(roster){const attached=new Set(roster.Kw.list().map(client=>client.clientId));for(const[key]of scopes){const[client,component,instance]=JSON.parse(key);if(!attached.has(client)){scopes.delete(key);pendingInvalidations.delete(key);host.release(client,component,instance);}}if(!scopes.size){stopThemeWatch?.();stopThemeWatch=undefined;themePalette=undefined;}}},1000);sweep.unref();
process.once('exit',()=>{clearInterval(sweep);stopThemeWatch?.();host?.detach();if(invalidating)clearTimeout(invalidating);server.close();});
}
`, 'print')
}
