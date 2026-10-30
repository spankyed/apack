/** Original left-arrow interstitial; its controller keeps admission, task review and agents-view effects. */
export const claudeTerminalLeftArrowRuntime = String.raw`
function nativeLeftArrowReview(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native agents review is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native agents review session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,kind='left_arrow_confirm';
 if(open.length!==1||open[0].kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=open[0],payload=item.payload;
 if(typeof payload?.summary!=='string'||payload.summary.length>16000||!Number.isSafeInteger(payload.carryOverCount)||payload.carryOverCount<0||!Number.isSafeInteger(payload.monitorParkCount)||payload.monitorParkCount<0||!payload.workflowAgents)throw Error('Native agents review payload changed');
 const fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.payload!==payload||revision.fingerprint!==fingerprint||revision.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native agents review producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native agents review traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('KCo')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'e611c57cc8b263026de5a0b2a40644179fda5bc54e5a40b49919b51d8adc08f4');
   const children=[fiber.child],visited=new Set();
   while(children.length){const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native agents review controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('mte')&&child.memoizedProps?.workflowAgents===payload.workflowAgents&&child.memoizedProps.summary===payload.summary&&child.memoizedProps.carryOverCount===payload.carryOverCount&&child.memoizedProps.monitorParkCount===payload.monitorParkCount){
     checked(child.type,'eef71f5d1f4e2efcc0c9a0f485d5a530d5943f3e81bab60f2e6575174541c9e7');
     const rows=child.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===20);
     if(rows?.length!==1)throw Error('Native agents review memo contract changed');
     const modal=rows[0][19]?.props,panel=rows[0][15]?.props;
     if(modal?.title!=='Background this session?'||typeof modal.subtitle!=='string'||modal.subtitle.length>32000||typeof panel?.confirmLabel!=='string'||panel.cancelLabel!=='Stay'||typeof panel.onConfirm!=='function'||typeof panel.onCancel!=='function'||modal.onCancel!==panel.onCancel)throw Error('Native agents review choices changed');
     const controls=[child.child],controlSeen=new Set();let mounted=0;
     while(controls.length){const c=controls.pop();if(!c||controlSeen.has(c))continue;if(controlSeen.size>=1024)throw Error('Native agents selector exceeded bound');controlSeen.add(c);
      if(typeof c.type==='function'&&c.type.name===nativeFunctionName('lr')&&c.memoizedProps===panel){checked(c.type,'3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70');mounted++;}
      if(c.sibling)controls.push(c.sibling);if(c.child)controls.push(c.child);
     }
     if(mounted===1)matches.push({modal,panel});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0];if(revision.source&&(revision.source.panel!==source.panel||revision.source.modal!==source.modal))revision={...revision,revision:randomUUID()};
 revision.source=source;dialogRevisions.set(kind,revision);return {store,...revision};
}
function projectNativeLeftArrow(n,d){
 const current=nativeLeftArrowReview(n);if(current.item!==d.item||current.revision!==d.revision)throw Error('Native agents review changed while formatting');
 const p=d.source.panel;
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'left_arrow_confirm',title:d.source.modal.title,paragraphs:d.source.modal.subtitle?[d.source.modal.subtitle]:[],preferredChoice:p.focus==='cancel'?'background_stay':'background_confirm',choices:[{value:'background_stay',label:p.cancelLabel},{value:'background_confirm',label:p.confirmLabel}]};
}
async function answerNativeLeftArrow(n,request){
 const read=()=>{const d=nativeLeftArrowReview(n);if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native agents review changed or expired');return d;};
 let d=read();if(!['background_confirm','background_stay'].includes(request.decision))throw Error('Invalid native agents review decision');
 if(request.decision==='background_confirm'){await n.gate._Jo('desktop');d=read();}
 if(typeof d.source.panel.refuseInput==='function'&&d.source.panel.refuseInput())throw Error('Native agents review input is temporarily refused');
 (request.decision==='background_confirm'?d.source.panel.onConfirm:d.source.panel.onCancel)();
 if(d.store.getState().open.includes(d.item))throw Error('Native agents review did not accept the decision');
 dialogRevisions.delete('left_arrow_confirm');
}
`
