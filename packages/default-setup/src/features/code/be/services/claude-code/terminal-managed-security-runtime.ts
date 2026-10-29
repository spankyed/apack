/** Original managed-policy consent; streamed updates invalidate decisions without exposing raw settings. */
export const claudeTerminalManagedSecurityRuntime = String.raw`
function nativeManagedSecurity(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return nativeStandaloneManagedSecurity(n);
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native managed settings review session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,kind='managed_settings_security',items=store.getState().open.filter(item=>item.kind===kind);
 if(items.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=items[0],payload=item.payload;
 if(typeof payload?.settings!=='object'||payload.settings===null||payload.baseline!==null&&typeof payload.baseline!=='object'||!['default','login_handoff'].includes(payload.reveal))throw Error('Native managed settings payload changed');
 const fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native managed settings producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native managed settings traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('XCo')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'b6c0babc158b7585de81413d552cb23f2c0cb99b0d32177dc6f0d22bbd851bcf');
   if(typeof fiber.memoizedProps.wouldTakeAnswer!=='function'||fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native managed settings controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('Je')&&child.memoizedProps?.settings===payload.settings&&child.memoizedProps?.baseline===payload.baseline&&child.memoizedProps?.reveal===payload.reveal){
     checked(child.type,'88e14cdf10a3baf23d955bcabd01d36dafc7aa9a6f6c5fd305a3c72643df90c7');
     matches.push(...nativeManagedSecurityControls(n,child,payload,checked));
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?{store,...revision,source:matches[0]}:{store,sessionId};
}

function nativeManagedSecurityControls(n,child,payload,checked){
 const matches=[];
 const rows=child.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===98&&row[0]===payload.baseline&&row[2]===payload.settings&&row[85]?.props);
 if(rows?.length!==1)throw Error('Native managed settings presentation changed');
 const row=rows[0],panel=row[85].props,controls=[child.child],controlSeen=new Set();
 while(controls.length){
  const control=controls.pop();if(!control||controlSeen.has(control))continue;if(controlSeen.size>=1024)throw Error('Native managed settings selector exceeded bound');controlSeen.add(control);
  if(typeof control.type==='function'&&control.type.name===nativeFunctionName('lr')&&control.memoizedProps===panel){
   checked(control.type,'3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70');
   if(panel.confirmLabel!=='Yes, I trust these settings'||panel.cancelLabel!=='No, exit Claude Code'||typeof panel.refuseInput!=='function'||typeof panel.onConfirm!=='function'||typeof panel.onCancel!=='function'||!['confirm','cancel'].includes(panel.focus)||row[97]?.props?.title!=='Managed settings require approval')throw Error('Native managed settings choices changed');
   matches.push({panel,title:row[97].props.title,nodes:[row[45],row[69],row[71],row[73]],preferredChoice:panel.focus==='cancel'?'policy_reject':'policy_approve'});
  }
  if(control.sibling)controls.push(control.sibling);if(control.child)controls.push(control.child);
 }
 return matches;
}

function nativeStandaloneManagedSecurity(n){
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId,kind='managed_settings_security_startup';
 // Native consent runs before --resume replaces its temporary session identity.
 const nativeSessionId=String(n.questionOptions.q());
 if(!/^[a-f0-9-]{36}$/i.test(nativeSessionId))throw Error('Native managed settings startup session changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native managed settings startup producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native managed settings startup traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('$n')){
   const payload=fiber.memoizedProps;
   if(payload?.settings&&typeof payload.settings==='object'&&(payload.baseline===null||typeof payload.baseline==='object')&&typeof payload.onAccept==='function'&&typeof payload.onReject==='function'){
    checked(fiber.type,'3df530c59832e0a9a0e98969b590cffd72fc98bed31c64a264673e75936a69ae');
    const caches=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===11&&row[6]===payload.baseline&&row[7]===payload.settings);
    if(caches?.length!==1)throw Error('Native managed settings startup lifetime changed');
    const children=[fiber.child],visited=new Set();
    while(children.length){
     const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native managed settings startup controls exceeded bound');visited.add(child);
     if(typeof child.type==='function'&&child.type.name===nativeFunctionName('Je')&&child.memoizedProps?.settings===payload.settings&&child.memoizedProps?.baseline===payload.baseline&&child.memoizedProps?.reveal==='default'&&child.memoizedProps?.wouldTakeAnswer===undefined){
      checked(child.type,'88e14cdf10a3baf23d955bcabd01d36dafc7aa9a6f6c5fd305a3c72643df90c7');
      for(const source of nativeManagedSecurityControls(n,child,payload,checked))matches.push({payload,mount:fiber,inputClock:caches[0][0],source});
     }
     if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
    }
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {startup:true,sessionId};}
 const {payload,mount,inputClock,source}=matches[0],fingerprint=JSON.stringify([payload.settings,payload.baseline]);let revision=dialogRevisions.get(kind);
 if(revision?.nativeSessionId!==nativeSessionId||(revision?.mount!==mount&&revision?.mount!==mount.alternate)||revision?.inputClock!==inputClock||revision?.settings!==payload.settings||revision?.baseline!==payload.baseline||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item:{id:randomUUID()},nativeSessionId,mount,inputClock,settings:payload.settings,baseline:payload.baseline,fingerprint,sessionId,revision:randomUUID(),settled:false};
 dialogRevisions.set(kind,revision);
 return revision.settled?{startup:true,sessionId}:{startup:true,...revision,source};
}

// Read the original painted cells: creating another render waits for startup consent itself.
function nativeManagedSecurityFrameText(n,node,owner,frame){
 if(node===null||node===undefined||node===false)return '';
 const screen=frame?.screen,pending=[owner?.container?.current],seen=new Set(),found=[];
 if(!screen||typeof owner?.stylePool?.get!=='function'||typeof n.nativeKeyEvents?.Jre!=='function')throw Error('Native managed settings frame is not ready');
 for(const[fn,hash]of[[n.nativeKeyEvents.Jre,'2ae48b174e08569312fe73be8e3a53dc3ab8aada8bbac0ad2728830bad3fea86'],[owner.stylePool.get,'56012d2b3e0dcaefc69e774334770496357f8eac063327fc734c1b927741fea9']]){
  let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}
  if(actual!==hash)throw Error('Native managed settings painted reader changed');
 }
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native managed settings frame lookup exceeded bound');seen.add(fiber);
  if(fiber.type===node.type&&fiber.memoizedProps===node.props)found.push(fiber);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(found.length!==1)throw Error('Native managed settings paragraph is not uniquely painted');
 let host=found[0];while(host&&!host.stateNode?.yogaNode)host=host.child;
 if(!host)throw Error('Native managed settings paragraph has no layout');
 const ink=host.stateNode,layout=ink.yogaNode;let x=0,y=0,depth=0;
 for(let current=ink;current;current=current.parentNode){if(++depth>64)throw Error('Native managed settings layout exceeded bound');x+=current.yogaNode?.getComputedLeft()??0;y+=current.yogaNode?.getComputedTop()??0;}
 x=Math.floor(x);y=Math.floor(y);const width=Math.ceil(layout.getComputedWidth()),height=Math.ceil(layout.getComputedHeight());
 if(![x,y,width,height].every(Number.isSafeInteger)||x<0||y<0||width<0||height<0||width*height>16000||x+width>screen.width||y+height>screen.height)throw Error('Native managed settings paragraph is outside its painted frame');
 const lines=[];
 for(let row=y;row<y+height;row++){
  const cells=[];for(let col=x;col<x+width;col++)cells.push(n.nativeKeyEvents.Jre(screen,row*screen.width+col));
  while(cells.length&&/^\s*$/u.test(cells.at(-1).char))cells.pop();
  let line='',style;
  for(const cell of cells){
   if(cell.width===2||cell.width===3)continue;
   if(style!==cell.styleId){if(style!==undefined)line+=owner.stylePool.get(style).slice().reverse().map(value=>value.endCode).join('');line+=owner.stylePool.get(cell.styleId).map(value=>value.code).join('');style=cell.styleId;}
   line+=cell.char;
  }
  if(style!==undefined)line+=owner.stylePool.get(style).slice().reverse().map(value=>value.endCode).join('');lines.push(line);
 }
 const result=lines.join('\n').trim();if(result.length>200000)throw Error('Native managed settings painted text exceeded bound');return result;
}
async function projectNativeManagedSecurity(n,d){
 const owner=n.themeRoots.ai().get(process.stdout),frame=owner?.frontFrame;
 const paragraphsAnsi=d.source.nodes.map(node=>nativeManagedSecurityFrameText(n,node,owner,frame));
 const current=nativeManagedSecurity(n);
 if(owner?.frontFrame!==frame||current.item!==d.item||current.revision!==d.revision||current.source?.nodes.some((node,index)=>node!==d.source.nodes[index]))throw Error('Native managed settings changed while formatting');
 const confirm={value:'policy_approve',label:d.source.panel.confirmLabel},cancel={value:'policy_reject',label:d.source.panel.cancelLabel};
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'managed_settings_security',title:d.source.title,paragraphs:paragraphsAnsi.map(value=>stripVTControlCharacters(value)),paragraphsAnsi,preferredChoice:current.source.preferredChoice,choices:d.source.panel.cancelFirst?[cancel,confirm]:[confirm,cancel]};
}
function answerNativeManagedSecurity(n,request){
 const d=nativeManagedSecurity(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native managed settings changed or expired');
 if(!['policy_approve','policy_reject'].includes(request.decision))throw Error('Invalid native managed settings decision');
 if(d.source.panel.refuseInput())throw Error('Native managed settings input is temporarily refused');
 if(d.startup){
  const held=dialogRevisions.get('managed_settings_security_startup');
  if(held.answering)throw Error('Native managed settings decision is already pending');
  held.answering=true;
  return (async()=>{try{
   if(request.decision==='policy_approve')d.source.panel.onConfirm();else d.source.panel.onCancel();
   for(let attempt=0;attempt<10;attempt++){
    await new Promise(resolve=>setTimeout(resolve,25));
    const current=nativeManagedSecurity(n);
    if(!current.item){held.settled=true;return;}
    if(current.item!==d.item||current.revision!==d.revision)throw Error('Native managed settings changed while awaiting acknowledgement');
   }
   throw Error('Native managed settings startup did not accept the decision');
  }finally{held.answering=false;}})();
 }
 if(request.decision==='policy_approve')d.source.panel.onConfirm();else d.source.panel.onCancel();
 if(d.store.getState().open.includes(d.item))throw Error('Native managed settings did not accept the decision');
 dialogRevisions.delete('managed_settings_security');
}
`
