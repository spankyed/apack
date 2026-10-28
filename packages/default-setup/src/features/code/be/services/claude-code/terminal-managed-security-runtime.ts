/** Original managed-policy consent; streamed updates invalidate decisions without exposing raw settings. */
export const claudeTerminalManagedSecurityRuntime = String.raw`
function nativeManagedSecurity(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native managed settings review is not ready');
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
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?{store,...revision,source:matches[0]}:{store,sessionId};
}
async function projectNativeManagedSecurity(n,d){
 const paragraphsAnsi=[];for(const node of d.source.nodes)paragraphsAnsi.push(await nativeGenericPermissionText(n,node,true));
 const current=nativeManagedSecurity(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.nodes.some((node,index)=>node!==d.source.nodes[index]))throw Error('Native managed settings changed while formatting');
 const confirm={value:'policy_approve',label:d.source.panel.confirmLabel},cancel={value:'policy_reject',label:d.source.panel.cancelLabel};
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'managed_settings_security',title:d.source.title,paragraphs:paragraphsAnsi.map(value=>stripVTControlCharacters(value)),paragraphsAnsi,preferredChoice:current.source.preferredChoice,choices:d.source.panel.cancelFirst?[cancel,confirm]:[confirm,cancel]};
}
function answerNativeManagedSecurity(n,request){
 const d=nativeManagedSecurity(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native managed settings changed or expired');
 if(!['policy_approve','policy_reject'].includes(request.decision))throw Error('Invalid native managed settings decision');
 if(d.source.panel.refuseInput())throw Error('Native managed settings input is temporarily refused');
 if(request.decision==='policy_approve')d.source.panel.onConfirm();else d.source.panel.onCancel();
 if(d.store.getState().open.includes(d.item))throw Error('Native managed settings did not accept the decision');
 dialogRevisions.delete('managed_settings_security');
}
`
