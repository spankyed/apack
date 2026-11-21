/** Original autocompact offer controls retain native readiness, step counts and persistence. */
export const claudeTerminalAutocompactOfferRuntime = String.raw`
const nativeAutocompactOperations=new WeakSet();
function nativeAutocompactOffer(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native autocompact offer is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native autocompact offer session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,kind='autocompact_offer',items=store.getState().open.filter(item=>item.kind===kind);
 if(items.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=items[0],payload=item.payload;
 if(!Array.isArray(payload?.sizes)||payload.sizes.length<1||payload.sizes.length>9||!payload.sizes.every(size=>Number.isSafeInteger(size.tokens)&&size.tokens>0&&Number.isFinite(size.firesAt)))throw Error('Native autocompact offer sizes changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native autocompact offer producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native autocompact offer traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('dbe')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'2c54d2af4782ef795f859c90e6d55bba81fcc01b5f38c412b10a8b4e08f78b68');
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===101&&row[88]?.props);
   if(rows?.length!==1)throw Error('Native autocompact offer presentation changed');
   const row=rows[0],props=row[88].props,children=[fiber.child],visited=new Set();
   if(typeof row[43]!=='function'||!Number.isSafeInteger(row[10])||payload.sizes[row[10]]?.tokens!==row[46]||!Array.isArray(row[52]))throw Error('Native autocompact offer state changed');
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native autocompact offer controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('Xe')&&child.memoizedProps===props){
     checked(child.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
     if(!Array.isArray(props.options)||JSON.stringify(props.options.map(option=>option.value).sort())!==JSON.stringify(['accept','keep'])||typeof props.onChange!=='function'||typeof props.onCancel!=='function')throw Error('Native autocompact offer choices changed');
     if(props.isDisabled===false)matches.push({row,control:props});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return {store,sessionId};
 const source=matches[0],fingerprint=JSON.stringify([payload,source.row[46],source.row[84]]);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control)revision={item,payload,fingerprint,sessionId,control:source.control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source};
}
async function projectNativeAutocompactOffer(n,d){
 const paragraphs=[];for(const node of [...d.source.row[52],d.source.row[61]]){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}
 const choices=[];for(const option of d.source.control.options)choices.push({value:'compact_'+option.value,label:await nativeGenericPermissionText(n,option.label)});
 const title=await nativeGenericPermissionText(n,d.source.row[96].props.title),current=nativeAutocompactOffer(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native autocompact offer changed while formatting');
 const index=d.source.row[10],screenReader=d.source.row[36]===true;
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'autocompact_offer',title,paragraphs,choices,selectedTokens:d.source.row[46],canPrevious:!screenReader&&index>0,canNext:!screenReader&&index<d.payload.sizes.length-1};
}
async function answerNativeAutocompactOffer(n,request,abort){
 abort.signal.throwIfAborted();
 const d=nativeAutocompactOffer(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native autocompact offer changed or expired');
 if(!['compact_previous','compact_next','compact_accept','compact_keep','compact_dismiss'].includes(request.decision))throw Error('Invalid native autocompact offer decision');
 if(nativeAutocompactOperations.has(d.item))throw Error('Native autocompact operation is pending');
 nativeAutocompactOperations.add(d.item);
 try{
 if(['compact_previous','compact_next'].includes(request.decision)){
  const delta=request.decision==='compact_next'?1:-1,index=d.source.row[10]+delta,target=d.payload.sizes[index]?.tokens;
  if(d.source.row[36]===true||target===undefined)throw Error('Native autocompact size is unavailable');
  d.source.row[43]('',delta>0?{rightArrow:true}:{leftArrow:true},delta>0?'\x1b[C':'\x1b[D');
  for(let attempt=0;attempt<20;attempt++){
   abort.signal.throwIfAborted();const current=nativeAutocompactOffer(n);
   if(current.item===d.item&&current.source?.row[46]===target)return;
   if(!d.store.getState().open.includes(d.item))throw Error('Native autocompact offer expired during size change');
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Native autocompact size change was not acknowledged');
 }
 const dismiss=request.decision==='compact_dismiss';
 if(d.source.row[43]('',dismiss?{escape:true}:{return:true},dismiss?'\x1b':'\r')!==false)throw Error('Native autocompact input is temporarily refused');
 if(dismiss)d.source.control.onCancel();else d.source.control.onChange(request.decision==='compact_accept'?'accept':'keep');
 if(d.store.getState().open.includes(d.item))throw Error('Native autocompact offer did not accept the decision');
 dialogRevisions.delete('autocompact_offer');
 }finally{nativeAutocompactOperations.delete(d.item);}
}
`
