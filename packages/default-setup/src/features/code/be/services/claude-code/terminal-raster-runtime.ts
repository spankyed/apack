/** Observe admitted paints on existing original terminal mounts; never register a new native target. */
export const claudeTerminalRasterRuntime = String.raw`function createNativeRasterMirrors(callbacks){
 const entries=new Map(),observed=new Map();
 const identity=scope=>JSON.stringify([scope.client_id,scope.component,scope.instance_id]);
 function unwatch(record){
  const observer=observed.get(record.mount);if(!observer)return;
  observer.listeners.delete(record);
  if(!observer.listeners.size){if(record.mount.paint===observer.paint)record.mount.paint=observer.original;observed.delete(record.mount);}
 }
 function drop(entry){if(entries.get(entry.id)!==entry)return;entries.delete(entry.id);if(entry.timer)clearTimeout(entry.timer);for(const record of entry.rasters.values())unwatch(record);entry.rasters.clear();}
 function current(entry){try{if(callbacks.current(entry.scope))return true;}catch{}drop(entry);return false;}
 function notify(entry){if(entry.timer||!current(entry))return;entry.timer=setTimeout(()=>{entry.timer=undefined;if(current(entry))callbacks.invalidate(entry.scope);},16);entry.timer.unref?.();}
 function observe(record,entry){
  let observer=observed.get(record.mount);
  if(!observer){
   const descriptor=Object.getOwnPropertyDescriptor(record.mount,'paint');if(!descriptor?.writable||typeof descriptor.value!=='function')return false;
   const original=descriptor.value,listeners=new Map();
   const paint=function(words){
    const result=Reflect.apply(original,this,arguments);
    for(const [record,owner] of [...listeners]){
     if(!current(owner)||!record.present())continue;
     record.words=new Uint32Array(words);notify(owner);
    }
    return result;
   };
   observer={original,paint,listeners};record.mount.paint=paint;observed.set(record.mount,observer);
  }
  observer.listeners.set(record,entry);return true;
 }
 function draw(n,scope,tree){
  const id=identity(scope);let entry=entries.get(id);
  if(entry&&(entry.scope.instance_revision!==scope.instance_revision||entry.scope.source_revision!==scope.source_revision)){drop(entry);entry=undefined;}
  if(!entry){if(entries.size>=512)throw Error('Native Raster mirror limit');entry={id,scope,rasters:new Map()};entries.set(id,entry);}
  if(!current(entry))throw Error('Native Raster placement expired');
  const seen=new Set(),registry=n.nativeHost.Le().mountedRasters;
  const visit=node=>{
   if(!node||typeof node!=='object')return node;
   if(node.type==='Raster'){
    const {key,columns,rows,cells}=node.props??{},plugin=node.raster?.plugin;
    const keyOf=JSON.stringify([plugin,key]);seen.add(keyOf);
    const group=registry.get(n.engine.htn(scope.native_request_id,key,plugin));
    const matches=[...group?.rasters??[]].filter(mount=>mount.plugin===plugin&&mount.requestId===scope.native_request_id&&mount.key===key&&mount.columns===columns&&mount.rows===rows);
    let record=entry.rasters.get(keyOf);
    if(record&&(matches.length!==1||record.mount!==matches[0])){unwatch(record);entry.rasters.delete(keyOf);record=undefined;}
    if(matches.length===1&&!record){
     record={mount:matches[0],source:cells,present:()=>n.engine.FPe(plugin)!==false&&registry.get(n.engine.htn(scope.native_request_id,key,plugin))?.rasters.has(record.mount)===true};
     if(observe(record,entry))entry.rasters.set(keyOf,record);else record=undefined;
    }
    if(record?.source!==cells&&record){record.source=cells;record.words=undefined;}
    return record?.words?{...node,props:{...node.props,cells:Buffer.from(record.words.buffer,record.words.byteOffset,record.words.byteLength).toString('base64')}}:node;
   }
   return Array.isArray(node.children)?{...node,children:node.children.map(visit)}:node;
  };
  const result=visit(tree);
  for(const [key,record]of entry.rasters)if(!seen.has(key)){unwatch(record);entry.rasters.delete(key);}
  if(!entry.rasters.size)drop(entry);
  return result;
 }
 return {draw,release(client,component,id){const entry=entries.get(JSON.stringify([client,component,id]));if(entry)drop(entry);},detach(client){for(const entry of [...entries.values()])if(client===undefined||entry.scope.client_id===client)drop(entry);},refresh(){for(const entry of [...entries.values()]){if(!current(entry))continue;for(const[key,record]of entry.rasters)if(!record.present()){unwatch(record);entry.rasters.delete(key);}if(!entry.rasters.size)drop(entry);}},count:()=>entries.size};
}
`;
