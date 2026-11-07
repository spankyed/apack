/** Borrow original IDE screens and mounted choice callbacks; discovery, auth and persistence stay native. */
export const claudeTerminalIdeRuntime = String.raw`
const nativeIdeHashes={"root":["20cb9825565dde5e85ba7802108b241b58ca2e8c38c7d51ddbbfff04de3e02cf","11d1d2c9dc4b56180d339dceedebd13f7f75c60aa099c64cfed6a81d73ec3d8e"],"selection":["ca8753bdcfe036129fea578fb07787a09acf9099b7c4891c848ff337e0c40b2f","784108bfb84b78b089645992e5806566aa0a215ec9602bac82794b35e40990e7"],"enable":["d5e83fa9b83ff1e82135fc882f0c9c8f28acff933c6491c60100f394b9d6d218","de1e2a61c987b7987b2bdfbd883371e4ef5d4bf4c7a06e201fd54bc67e47edee"],"disable":["b7a8f585e422cf738455c2cc9412803b1bbdd358f1c74816a72b98260a64fb1a","643c670597c0898193999078e94f1baa611b87e03185b2ae50f442e9902b3360"]};
function nativeIdeWalk(root,visit,rootSibling=true){const pending=[root],seen=new Set();while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native IDE traversal exceeded bound');seen.add(fiber);if(fiber.sibling&&(fiber!==root||rootSibling))pending.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)pending.push(fiber.child);}}
function nativeIdeFrame(n,entry){
 entry.current();if(entry.closed||entry.answered||entry.commandName!=='ide'||!nativeIdeHashes.root.includes(nativeModelFunctionHash(entry.originalType)))throw Error('Native IDE panel expired or changed');
 const owners=[];nativeIdeWalk(n.themeRoots.ai().get(process.stdout)?.container?.current,fiber=>{if(fiber.type===entry.originalType&&fiber.memoizedProps===entry.originalProps)owners.push(fiber);});
 if(owners.length!==1)throw Error('Native IDE is not uniquely mounted');
 const screens=[];nativeIdeWalk(owners[0].child,fiber=>{if(typeof fiber.type!=='function')return;for(const stage of ['selection','enable','disable'])if(nativeIdeHashes[stage].includes(nativeModelFunctionHash(fiber.type)))screens.push({fiber,stage});});
 if(screens.filter(s=>s.stage==='selection').length>1||screens.filter(s=>s.stage!=='selection').length>1)throw Error('Native IDE screen is ambiguous');
 const screen=screens.find(s=>s.stage!=='selection')??screens[0];
 if(!screen){
  const cache=owners[0].updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===27);
  if(cache?.length!==1||!cache[0][0]||typeof cache[0][0].name!=='string'||cache[0][0]!==cache[0][5])throw Error('Native IDE connection state is not ready');
  const paragraphs=[];nativeIdeWalk(owners[0].child,f=>{if(f.type==='ink-text'){let text='';nativeIdeWalk(f.child,c=>{if(c.tag===6&&typeof c.memoizedProps==='string')text+=c.memoizedProps;});if(text)paragraphs.push(text);return false;}});
  return nativeIdeLease(entry,{stage:'connecting',title:'IDE connection',paragraphs,options:[]},owners[0].memoizedProps,undefined,undefined);
 }
 const wrappers=[];nativeIdeWalk(screen.fiber.child,f=>{const p=f.memoizedProps;if(typeof p?.title==='string'&&typeof p.onCancel==='function')wrappers.push(f);});
 if(wrappers.length!==1)throw Error('Native IDE dialog frame changed');const wrapper=wrappers[0].memoizedProps;
 const controls=[];nativeIdeWalk(screen.fiber.child,f=>{const p=f.memoizedProps;if(screen.stage==='selection'){if(typeof p?.onSelect==='function'&&Array.isArray(p.children)&&p.children.length&&p.children.every(c=>typeof c?.props?.label==='string'&&typeof c.key==='string')){controls.push({fiber:f,props:p,kind:'index'});return false;}}else if(typeof p?.onChange==='function'&&Array.isArray(p.options)&&p.options.length&&p.options.every(o=>typeof o?.value==='string'&&typeof o.label==='string')){controls.push({fiber:f,props:p,kind:'value'});return false;}});
 if(controls.length>1||screen.stage!=='selection'&&controls.length!==1)throw Error('Native IDE choice control changed');
 const control=controls[0],items=control?.kind==='index'?control.props.children.map((item,index)=>({value:String(index),label:item.props.label,...typeof item.props.description==='string'?{description:item.props.description}:{}})):control?.props.options.map(item=>({value:item.value,label:item.label,...typeof item.description==='string'?{description:item.description}:{}}))??[];
 if(items.length>256||items.some(o=>o.label.length>65536||o.value.length>1024||o.description?.length>65536)||new Set(items.map(o=>o.value)).size!==items.length)throw Error('Native IDE choices exceed bounds');
 const paragraphs=[],bodyElements=Array.isArray(wrapper.children)?wrapper.children:[wrapper.children];
 for(const element of bodyElements){if(!element||typeof element!=='object')continue;const roots=[];nativeIdeWalk(screen.fiber.child,f=>{if(f.type===element.type&&f.memoizedProps===element.props)roots.push(f);});if(roots.length!==1)throw Error('Native IDE body is not uniquely mounted');nativeIdeWalk(roots[0],f=>{if(f===control?.fiber)return false;if(f.type==='ink-text'){let text='';nativeIdeWalk(f.child,c=>{if(c.tag===6&&typeof c.memoizedProps==='string')text+=c.memoizedProps;});if(text)paragraphs.push(text);return false;}},false);}
 if(paragraphs.length>256||paragraphs.some(p=>p.length>65536)||wrapper.title.length>65536||wrapper.subtitle!==undefined&&typeof wrapper.subtitle!=='string')throw Error('Native IDE text exceeds bounds');
 const selectedValue=control?.kind==='index'&&Number.isInteger(control.props.defaultFocusIndex)&&control.props.defaultFocusIndex>=0?String(control.props.defaultFocusIndex):typeof control?.props.defaultFocusValue==='string'?control.props.defaultFocusValue:undefined;
 return nativeIdeLease(entry,{stage:screen.stage,title:wrapper.title,...wrapper.subtitle?{description:wrapper.subtitle}:{},paragraphs,options:items,...selectedValue!==undefined?{selectedValue}:{},disabled:control?.props.isDisabled===true},screen.fiber.memoizedProps,control,wrapper.onCancel);
}
function nativeIdeLease(entry,ide,props,control,cancel){
 const encoded=JSON.stringify(ide),before=entry.ideFrame;if(!before||before.encoded!==encoded||before.props!==props||before.control?.props!==control?.props||before.cancel!==cancel)entry.ideFrame={encoded,props,control,cancel,snapshot:{revision:createHash('sha256').update(encoded+randomUUID()).digest('hex'),rows:[],ide}};
 return entry.ideFrame;
}
async function nativeIdePanel(n,entry,request,abort){
 const before=nativeIdeFrame(n,entry);abort.signal.throwIfAborted();if(request.operation==='read')return {snapshot:before.snapshot};
 if(request.operation!=='ideSelect'||request.revision!==before.snapshot.revision||typeof request.value!=='string'||before.snapshot.ide.disabled||!before.snapshot.ide.options.some(o=>o.value===request.value)||!before.control||before.consumed)throw Error('Native IDE choice changed or is unavailable');
 const current=nativeIdeFrame(n,entry);if(current!==before)throw Error('Native IDE changed before selection');entry.current();before.consumed=true;
 if(before.control.kind==='index')await before.control.props.onSelect(Number(request.value));else await before.control.props.onChange(request.value);
 for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();if(entry.closed)return {snapshot:{revision:before.snapshot.revision,rows:[],ide:{stage:'finished',title:before.snapshot.ide.title,paragraphs:[],options:[]}}};await new Promise(resolve=>setTimeout(resolve,25));if(entry.closed)continue;entry.current();const after=nativeIdeFrame(n,entry);if(after!==before)return {snapshot:after.snapshot};}
 return {snapshot:before.snapshot,problem:'Claude Code has not acknowledged the IDE selection. Refresh to check its current state.'};
}
async function closeNativeIdePanel(n,entry){
 const frame=nativeIdeFrame(n,entry);entry.current();if(frame.cancel)await frame.cancel();else await entry.cancel();return {open:!entry.closed};
}

const nativeIdeContextLeases=new Map();
function nativeIdeContextSource(n,clientId){
 if(!clients.has(clientId)||!clientViewCurrent(n,clientId))return;
 const binding=originalContext??n.runtime.ey();
 if(!binding||nativeViewFacts(n,binding,new AbortController()).view.kind!=='main')return;
 const roots=[];
 nativeIdeWalk(n.themeRoots.ai().get(process.stdout)?.container?.current,f=>{if(typeof f.type==='function'&&['27d5a95406b3213bae0037343d4ac93c17db5140c9466cf138beacd105723b25','bbe8ae7138c0835f0f581081d990d2bb6b45ba17036c2ed5f078ac1e2ac6e521'].includes(nativeModelFunctionHash(f.type)))roots.push(f);});
 if(roots.length!==1||roots[0].memoizedProps?.ideSelection?.source==='diff')return;
 const dismiss=roots[0].memoizedProps?.chrome?.dismissIdeSelection;if(typeof dismiss!=='function')return;
 const pills=new Set();nativeIdeWalk(roots[0].child,f=>{const pill=f.memoizedProps?.leadingPill;if(pill&&pill.onDelete===dismiss&&typeof pill.text==='string'&&pill.text.length>0&&pill.text.length<=256)pills.add(pill);});
 if(pills.size!==1)return;return [...pills][0];
}
function nativeIdeContext(n,clientId){
 const pill=nativeIdeContextSource(n,clientId);if(!pill){nativeIdeContextLeases.delete(clientId);return;}
 let lease=nativeIdeContextLeases.get(clientId);
 if(!lease||lease.pill!==pill||lease.text!==pill.text||lease.callback!==pill.onDelete){lease={pill,text:pill.text,callback:pill.onDelete,revision:createHash('sha256').update(randomUUID()).digest('hex')};nativeIdeContextLeases.set(clientId,lease);}
 return lease.consumed?undefined:{text:lease.text,revision:lease.revision};
}
function refreshNativeIdeContext(n){
 for(const clientId of clients.keys()){
  const previous=nativeIdeContextLeases.get(clientId);const before=previous&&!previous.consumed?previous.revision:undefined;let after;
  try{after=nativeIdeContext(n,clientId)?.revision;}catch{nativeIdeContextLeases.delete(clientId);}
  if(before!==after)publish({type:'system',subtype:'ui_invalidate',event:'ui.render',client_id:clientId,component:'AbovePrompt'});
 }
}
async function dismissNativeIdeContext(n,request){
 await n.gate._Jo('desktop');
 const current=nativeIdeContext(n,request.client_id),lease=nativeIdeContextLeases.get(request.client_id);
 if(!current||!lease||lease.consumed||current.revision!==request.revision)return {handled:false};
 lease.consumed=true;await lease.callback();
 publish({type:'system',subtype:'ui_invalidate',event:'ui.render',client_id:request.client_id,component:'AbovePrompt'});
 return {handled:true};
}
`
