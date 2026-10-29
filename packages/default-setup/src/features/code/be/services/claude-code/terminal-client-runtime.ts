/** Authored ownership bridge around the original native Client sandbox. */
export const claudeTerminalClientRuntime = String.raw`function createNativeClientHost(createRegistry,invalidate,clientRequestId,callbacks){
 const entries=new Map(),tokens=new Map(),registries=new Map(),settling=new Map();
 const scopeOf=(client,component,requestId)=>JSON.stringify([client,component,requestId]);
 function settleAfterRelease(scope){let pending=settling.get(scope);if(!pending){let resolve;const promise=new Promise(done=>{resolve=done;});pending={promise,resolve};settling.set(scope,pending);}if(pending.timer)clearTimeout(pending.timer);pending.timer=setTimeout(()=>{settling.delete(scope);pending.resolve();},0);pending.timer.unref();}
 const drop=entry=>{if(entries.get(entry.identity)!==entry)return;entries.delete(entry.identity);tokens.delete(entry.token);entry.stop();if(![...entries.values()].some(other=>other.timers===entry.timers)){for(const timer of entry.timers)clearInterval(timer);entry.timers.clear();}entry.instance.release();settleAfterRelease(entry.scope);if(![...entries.values()].some(other=>other.client===entry.client)){const registry=registries.get(entry.client);registries.delete(entry.client);const timer=setTimeout(()=>registry?.dispose(),0);timer.unref();}};
 function policySuspend(entry){if(entry.policySuspended)return;entry.policySuspended=true;entry.enabled=false;tokens.delete(entry.token);entry.frameRefs?.clear();}
 function current(entry){try{if(callbacks?.current?.(entry)===false){drop(entry);return false;}if(callbacks?.eligible?.(entry)===false){policySuspend(entry);return false;}return !entry.policySuspended;}catch{}drop(entry);return false;}
 function render(client,component,requestId,tree,instanceRevision){
  const scope=scopeOf(client,component,requestId),seen=new Set();
  const visit=value=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   if(value.type!=='Client')return {...value,...(Array.isArray(value.children)?{children:value.children.map(visit)}:{})};
   const props=value.props,plugin=value.client?.plugin;
   if(!props||typeof plugin!=='string'||typeof props.key!=='string'||typeof props.module!=='string')throw Error('Invalid native Client drawing');
   const identity=JSON.stringify([scope,plugin,props.key]);
   if(seen.has(identity))throw Error('Duplicate native Client key');seen.add(identity);
   let entry=entries.get(identity);
   if(callbacks?.eligible?.({plugin,client,component,requestId})===false){if(entry)policySuspend(entry);throw Error('Native Client module is no longer eligible');}
   if(entry&&(entry.module!==props.module||entry.instanceRevision!==instanceRevision||entry.borrowed&&typeof entry.instance.isCurrent==='function'&&!entry.instance.isCurrent())){drop(entry);entry=undefined;}
   if(!entry){
    if(entries.size>=512)throw Error('Native Client instance limit reached');
    const borrowed=callbacks?.borrow?.({client,component,requestId,plugin,key:props.key,module:props.module});
    let registry=registries.get(client);if(!borrowed&&!registry){registry=createRegistry();registries.set(client,registry);}
    let timers=new Set(),instance;
    const alive=()=>[...entries.values()].some(other=>(other===entry||instance?.id!==undefined&&other.client===client&&other.instance.id===instance.id)&&current(other));
    try{instance=borrowed??registry.acquire({plugin,component,requestId,surface:'desktop',key:props.key,module:props.module,props:props.props,clock:{every(ms,fn){if(entry&&!alive())return()=>{};const timer=setInterval(()=>{if(entry&&alive())fn();else if(![...entries.values()].some(other=>other.timers===timers)){clearInterval(timer);timers.delete(timer);}},ms);timers.add(timer);timer.unref();return()=>{clearInterval(timer);timers.delete(timer);};}}});}catch(error){for(const timer of timers)clearInterval(timer);if(![...entries.values()].some(other=>other.client===client)){registries.delete(client);const timer=setTimeout(()=>registry?.dispose(),0);timer.unref();}throw error;}
    const peer=instance.id===undefined?undefined:[...entries.values()].find(other=>other.client===client&&other.instance.id===instance.id);if(peer){for(const timer of timers)peer.timers.add(timer);timers=peer.timers;}
    entry={plugin,borrowed:!!borrowed,surface:borrowed?.surface??'desktop',timers,instanceRevision,identity,scope,client,component,requestId,key:props.key,callbackId:borrowed?.callbackRequestId??clientRequestId(requestId,props.key),module:props.module,token:randomUUID(),propsKey:JSON.stringify(props.props),instance,enabled:true,sequence:0,stop:()=>{}};
    entry.stop=instance.subscribe(()=>{if(entries.get(identity)===entry&&current(entry))invalidate(entry);});
    entries.set(identity,entry);tokens.set(entry.token,entry);
   }else if(entry.propsKey!==JSON.stringify(props.props)){entry.propsKey=JSON.stringify(props.props);entry.instance.setProps(props.props);}
   if(entry.policySuspended){entry.policySuspended=false;entry.token=randomUUID();entry.sequence=0;tokens.set(entry.token,entry);}
   entry.enabled=true;
   const snapshot=entry.instance.getSnapshot();
   entry.frameRefs??=new Map();
   const remember=node=>{if(!node||typeof node!=='object')return;if(node.press&&['Button','Input','Select','Markdown'].includes(node.type))entry.frameRefs.set(node.press.handle,{type:node.type,key:node.props?.key,plugin:node.press.plugin});if(Array.isArray(node.children))node.children.forEach(remember);};
   if(snapshot.status==='drawn')remember(snapshot.tree);
   // A delivered field can cross a redraw in transit; callback execution still resolves its current key.
   while(entry.frameRefs.size>1024)entry.frameRefs.delete(entry.frameRefs.keys().next().value);
   const children=snapshot.status==='drawn'?[snapshot.tree]:[{type:'Text',children:[snapshot.status==='failed'?snapshot.text:'Loading native module…']}];
   return {type:'NativeClient',props:{id:entry.token,...(props.width!==undefined?{width:props.width}:{}),...(props.height!==undefined?{height:props.height}:{}),...(props.flexGrow!==undefined?{flexGrow:props.flexGrow}:{}),pointer:entry.instance.acceptsPointer(),keys:entry.instance.acceptsKeys()},part:{plugin},children};
  };
  const result=visit(tree);
  for(const entry of [...entries.values()])if(entry.scope===scope&&!seen.has(entry.identity)){current(entry);if(!entry.policySuspended)drop(entry);}
  return result;
 }
 function event(client,id,sequence,event){
  const entry=tokens.get(id);
  if(!entry||entry.client!==client||!entry.enabled||!current(entry)||!Number.isSafeInteger(sequence)||sequence<=entry.sequence)return {handled:false};
  const instance=entry.instance;
  if(!event||typeof event!=='object')throw Error('Invalid native Client input');
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000;
  if(event.kind==='resize'){
   if(!Number.isInteger(event.columns)||!Number.isInteger(event.rows)||event.columns<0||event.rows<0||event.columns>100000||event.rows>100000)throw Error('Invalid native Client region');
   entry.sequence=sequence;instance.resize(event.columns,event.rows);instance.laidOut();
  }else if(event.kind==='key'){
   if(typeof event.key!=='string'||!event.key.length||event.key.length>32||event.key==='escape')throw Error('Invalid native Client key');
   if(!instance.acceptsKeys())return {handled:false};
   entry.sequence=sequence;instance.key({key:event.key,...(event.ctrl===true?{ctrl:true}:{}),...(event.shift===true?{shift:true}:{}),...(event.meta===true?{meta:true}:{})});
  }else if(event.kind==='pointer'){
   if(!['down','move','up','enter','leave'].includes(event.type)||!finite(event.x)||!finite(event.y)||!Number.isInteger(event.x)||!Number.isInteger(event.y)||event.fine!==undefined&&(!finite(event.fine?.x)||!finite(event.fine?.y))||event.button!==undefined&&!['left','middle','right'].includes(event.button))throw Error('Invalid native Client pointer');
   if(!instance.acceptsPointer())return {handled:false};
   entry.sequence=sequence;instance.pointer({type:event.type,x:event.x,y:event.y,...(event.fine?{fine:{x:event.fine.x,y:event.fine.y}}:{}),...(event.button?{button:event.button}:{}),...(event.ctrl===true?{ctrl:true}:{}),...(event.shift===true?{shift:true}:{}),...(event.alt===true?{alt:true}:{})});
  }else throw Error('Invalid native Client operation');
  return {handled:true};
 }
 async function dispatchAction(client,value){
  for(const entry of entries.values()){
   if(entry.borrowed)continue;
   const ref=entry.client===client?entry.frameRefs?.get(value.handle):undefined;
   if(!ref||ref.plugin!==value.plugin||typeof ref.key!=='string'||ref.key!==value.key||ref.type==='Markdown')continue;
   if(!entry.enabled||!current(entry)||entry.instanceRevision!==undefined&&(value.instance_revision!==entry.instanceRevision||value.component!==entry.component||value.instance_id!==entry.requestId))return {handled:false};
   const type=value.subtype==='ui_press'?'Button':value.subtype==='ui_input'?'Input':value.subtype==='ui_select'?'Select':undefined;
   if(type!==ref.type)return {handled:false};
   const event=type==='Button'?{type:'press'}:type==='Input'?{type:'input',kind:value.kind,value:value.value}:{type:'select',value:value.value};
   const actionToken=entry.token;
   const result=await callbacks.dispatch({plugin:ref.plugin,module:entry.module,key:entry.key,component:entry.component,requestId:entry.requestId,element:ref.key,event});
   if(entries.get(entry.identity)!==entry||entry.token!==actionToken||!entry.enabled||!current(entry)||!result?.reached)return {handled:false};
   const reached=result.reached,snapshot=entry.instance.getSnapshot();if(snapshot.status!=='drawn')return {handled:false};
   const matches=[];const find=node=>{if(!node||typeof node!=='object')return;if(node.type===type&&node.press?.plugin===ref.plugin&&node.props?.key===reached.element)matches.push(node);for(const child of node.children??[])find(child);};find(snapshot.tree);
   if(matches.length!==1)return {handled:false};const target=matches[0];
   if(type==='Select'&&!target.props.options.some(option=>option.value===reached.value))return {handled:false};
   const handled=callbacks.run({plugin:ref.plugin,handle:target.press.handle,key:target.props.key,component:entry.component,requestId:entry.callbackId,event:reached});
   return {handled,...(handled?{element:reached.element,...(type!=='Button'?{value:reached.value}:{})}:{})};
  }
 }
 function action(client,value){
  for(const entry of entries.values()){
   const ref=entry.client===client?entry.frameRefs?.get(value.handle):undefined;
   if(!ref||ref.plugin!==value.plugin||ref.key!==value.key)continue;
   if(!entry.enabled||!current(entry)||entry.instanceRevision!==undefined&&(value.instance_revision!==entry.instanceRevision||value.component!==entry.component||value.instance_id!==entry.requestId))return false;
   const type=value.subtype==='ui_press'?['Button','Markdown']:value.subtype==='ui_input'?['Input']:['Select'];
   if(!type.includes(ref.type))return false;
   const snapshot=entry.instance.getSnapshot();if(snapshot.status!=='drawn')return false;
   const matches=[];const find=node=>{if(!node||typeof node!=='object')return;if(node.type===ref.type&&node.press?.plugin===ref.plugin&&(typeof ref.key==='string'?node.props?.key===ref.key:node.press.handle===value.handle))matches.push(node);for(const child of node.children??[])find(child);};
   find(snapshot.tree);
   return matches.length===1?{handle:matches[0].press.handle,component:entry.component,requestId:entry.callbackId,surface:entry.surface}:false;
  }
 }
 return {render,event,action,dispatchAction,surface(client,id){const entry=tokens.get(id);return entry&&entry.client===client&&entry.enabled&&current(entry)?entry.surface:undefined;},settle(client,component,requestId){return settling.get(scopeOf(client,component,requestId))?.promise??Promise.resolve();},release(client,component,requestId){for(const entry of [...entries.values()])if(entry.scope===scopeOf(client,component,requestId))drop(entry);},suspendInstance(client,component,requestId){for(const entry of entries.values())if(entry.client===client&&entry.component===component&&entry.requestId===requestId){if(entry.borrowed&&typeof entry.instance.isCurrent==='function'&&current(entry))continue;entry.enabled=false;}},suspend(instances){for(const entry of entries.values())if(!instances||instances.some(site=>site.surface==='desktop'&&site.component===entry.component&&site.requestId===entry.requestId))entry.enabled=false;},detach(client){for(const entry of [...entries.values()])if(client===undefined||entry.client===client)drop(entry);},count:()=>entries.size};
}`
