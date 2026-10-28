/** Present only the original mounted refusal choices; native owns routing, retractions and settlement. */
export const claudeTerminalRefusalRuntime = String.raw`
const nativeRefusalRetirementStores=new WeakMap();
function nativeRefusalRetirements(n,store){
 let state=nativeRefusalRetirementStores.get(store);
 if(!state){
  if(typeof store.subscribe!=='function'||typeof store.onClosed!=='function')throw Error('Native refusal lifetime changed');
  state={pending:new Map(),retired:new Map(),problem:undefined};nativeRefusalRetirementStores.set(store,state);
  const capture=()=>{try{for(const item of store.getState().open){
   if(item.kind!=='refusal_fallback_prompt')continue;
   const sessionId=String(n.questionOptions.q()),uuids=item.payload?.retractedMessageUuids??[];
   if(!/^[a-f0-9-]{36}$/i.test(sessionId)||!Array.isArray(uuids)||uuids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw Error('Invalid original refusal retirement');
   state.pending.set(item.id,{sessionId,uuids:[...new Set(uuids)]});
  }}catch(error){state.problem=String(error)}};
  capture();store.subscribe(capture);
  store.onClosed(event=>{
   const pending=state.pending.get(event.id);if(!pending)return;state.pending.delete(event.id);
   let retired=state.retired.get(pending.sessionId);if(!retired){retired=new Set();state.retired.set(pending.sessionId,retired);}
   for(const uuid of pending.uuids)retired.add(uuid);
  });
 }
 if(state.problem)throw Error(state.problem);
 return [...state.retired].map(([sessionId,uuids])=>({sessionId,uuids:[...uuids]}));
}
function nativeRefusalControl(n,item){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native refusal producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native refusal traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='UCe'&&fiber.memoizedProps?.payload===item.payload){
   checked(fiber.type,'5c0cdd900e2aff12b223358a8e67a3e0757edda8dba0e7aed14c02b45480a331');
   if(typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()!==true)return;
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===48&&typeof row[17]==='string'&&row[21]);
   if(rows?.length!==1)throw Error('Native refusal presentation changed');
   const row=rows[0],children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native refusal controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name==='Xe'){
     checked(child.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
     const control=child.memoizedProps;
     if(control?.options===row[9]&&typeof control.onChange==='function'&&typeof control.onCancel==='function'&&control.isDisabled!==true&&JSON.stringify(control.options.map(option=>option.value))===JSON.stringify(['retry_fallback','edit_prompt'])&&control.options.every(option=>typeof option.label==='string'&&option.label.length>0&&option.label.length<=4000))matches.push({control,row});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?matches[0]:undefined;
}
function nativeRefusal(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native refusal is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native refusal session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,retirements=nativeRefusalRetirements(n,store),open=store.getState().open,item=open.length===1?open[0]:undefined,payload=item?.payload,kind='refusal_fallback_prompt';
 if(item?.kind!==kind||!['originalModel','fallbackModel'].every(key=>typeof payload?.[key]==='string'&&payload[key].length>0&&payload[key].length<=16000)){dialogRevisions.delete(kind);return {store,sessionId,retirements};}
 const source=nativeRefusalControl(n,item);if(!source)return {store,sessionId,retirements};
 const fingerprint=JSON.stringify([payload,source.control.options.map(option=>[option.value,option.label])]);if(fingerprint.length>200000)throw Error('Native refusal payload exceeded bound');
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source,retirements};
}
async function projectNativeRefusal(n,d){
 const paragraphs=[];for(const node of [d.source.row[21],d.source.row[22]]){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}
 const raw=d.source.row[21]?.props?.children,helpUrl=typeof raw==='string'?raw.match(/https:\/\/[^\s<>"\x60]+/u)?.[0]:undefined;
 const current=nativeRefusal(n);if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native refusal changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'refusal_fallback_prompt',originalModel:d.payload.originalModel,fallbackModel:d.payload.fallbackModel,title:d.source.row[17],paragraphs,...(helpUrl?{helpUrl}:{}),choices:d.source.control.options.map(option=>({value:option.value,label:option.label}))};
}
function answerNativeRefusal(n,request){
 const d=nativeRefusal(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native refusal changed or expired');
 if(request.decision==='cancelled')d.source.control.onCancel();
 else{if(!d.source.control.options.some(option=>option.value===request.decision))throw Error('Invalid native refusal decision');d.source.control.onChange(request.decision);}
 if(d.store.getState().open.includes(d.item))throw Error('Native refusal did not accept the decision');
 dialogRevisions.delete('refusal_fallback_prompt');
}
`
