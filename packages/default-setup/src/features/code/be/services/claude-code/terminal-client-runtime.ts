/** Authored ownership bridge around the original native Client sandbox. */
export const claudeTerminalClientRuntime = String.raw`function createNativeClientHost(createRegistry,invalidate){
 const entries=new Map(),tokens=new Map(),registries=new Map();
 const scopeOf=(client,component,requestId)=>JSON.stringify([client,component,requestId]);
 const drop=entry=>{entries.delete(entry.identity);tokens.delete(entry.token);entry.stop();entry.instance.release();if(![...entries.values()].some(other=>other.client===entry.client)){const registry=registries.get(entry.client);registries.delete(entry.client);const timer=setTimeout(()=>registry?.dispose(),0);timer.unref();}};
 function render(client,component,requestId,tree){
  const scope=scopeOf(client,component,requestId),seen=new Set();
  const visit=value=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   if(value.type!=='Client')return {...value,...(Array.isArray(value.children)?{children:value.children.map(visit)}:{})};
   const props=value.props,plugin=value.client?.plugin;
   if(!props||typeof plugin!=='string'||typeof props.key!=='string'||typeof props.module!=='string')throw Error('Invalid native Client drawing');
   const identity=JSON.stringify([scope,plugin,props.key]);
   if(seen.has(identity))throw Error('Duplicate native Client key');seen.add(identity);
   let entry=entries.get(identity);
   if(entry&&entry.module!==props.module){drop(entry);entry=undefined;}
   if(!entry){
    if(entries.size>=512)throw Error('Native Client instance limit reached');
    let registry=registries.get(client);if(!registry){registry=createRegistry();registries.set(client,registry);}
    const instance=registry.acquire({plugin,component,requestId,surface:'desktop',key:props.key,module:props.module,props:props.props,clock:{every(ms,fn){const timer=setInterval(fn,ms);timer.unref();return()=>clearInterval(timer);}}});
    entry={identity,scope,client,component,requestId,module:props.module,token:randomUUID(),propsKey:JSON.stringify(props.props),instance,enabled:true,sequence:0,stop:()=>{}};
    entry.stop=instance.subscribe(()=>{if(entries.get(identity)===entry)invalidate(entry);});
    entries.set(identity,entry);tokens.set(entry.token,entry);
   }else if(entry.propsKey!==JSON.stringify(props.props)){entry.propsKey=JSON.stringify(props.props);entry.instance.setProps(props.props);}
   entry.enabled=true;
   const snapshot=entry.instance.getSnapshot();
   const children=snapshot.status==='drawn'?[snapshot.tree]:[{type:'Text',children:[snapshot.status==='failed'?snapshot.text:'Loading native module…']}];
   return {type:'NativeClient',props:{id:entry.token,...(props.width!==undefined?{width:props.width}:{}),...(props.height!==undefined?{height:props.height}:{}),...(props.flexGrow!==undefined?{flexGrow:props.flexGrow}:{}),pointer:entry.instance.acceptsPointer(),keys:entry.instance.acceptsKeys()},part:{plugin},children};
  };
  const result=visit(tree);
  for(const entry of [...entries.values()])if(entry.scope===scope&&!seen.has(entry.identity))drop(entry);
  return result;
 }
 function event(client,id,sequence,event){
  const entry=tokens.get(id);
  if(!entry||entry.client!==client||!entry.enabled||!Number.isSafeInteger(sequence)||sequence<=entry.sequence)return {handled:false};
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
 return {render,event,suspend(instances){for(const entry of entries.values())if(!instances||instances.some(site=>site.surface==='desktop'&&site.component===entry.component&&site.requestId===entry.requestId))entry.enabled=false;},detach(client){for(const entry of [...entries.values()])if(client===undefined||entry.client===client)drop(entry);},count:()=>entries.size};
}`
