/** Nonblocking native goal proposal: original controls retain input grace and stale-goal admission. */
export const claudeTerminalGoalProposalRuntime = String.raw`
function nativeGoalProposal(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native goal proposal is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native goal proposal session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,kind='goal_proposal';
 const items=open.filter(item=>item.kind===kind);if(items.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=items[0],payload=item.payload;
 if(typeof payload?.condition!=='string'||payload.condition.length>16000)throw Error('Native goal proposal payload changed');
 const fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native goal proposal producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native goal proposal traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('NCe')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'80f8248717365a251bf9b02027e39b4a73b036dec3ab6393ff9e42bc6fe6da75');
   if(typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===46&&row[35]?.props);
   if(rows?.length!==1)throw Error('Native goal proposal presentation changed');
   const row=rows[0],children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native goal proposal controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('lr')&&child.memoizedProps===row[35].props){
     checked(child.type,'3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70');
     const panel=child.memoizedProps;
     if(panel.confirmLabel!=='Set this goal'||panel.cancelLabel!=='Not now'||typeof panel.refuseInput!=='function'||typeof panel.onConfirm!=='function'||typeof panel.onCancel!=='function')throw Error('Native goal proposal choices changed');
     matches.push({panel,row});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1?{store,...revision,source:matches[0]}:{store,sessionId};
}
async function projectNativeGoalProposal(n,d){
 const paragraphs=[];for(const node of [d.source.row[12],d.source.row[25],d.source.row[27]]){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}
 const title=await nativeGenericPermissionText(n,d.source.row[10]);
 const current=nativeGoalProposal(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.panel!==d.source.panel)throw Error('Native goal proposal changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'goal_proposal',title,paragraphs,choices:[{value:'goal_decline',label:d.source.panel.cancelLabel},{value:'goal_accept',label:d.source.panel.confirmLabel}]};
}
function answerNativeGoalProposal(n,request){
 const d=nativeGoalProposal(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native goal proposal changed or expired');
 if(!['goal_accept','goal_decline'].includes(request.decision))throw Error('Invalid native goal proposal decision');
 if(d.source.panel.refuseInput())throw Error('Native goal proposal input is temporarily refused');
 if(request.decision==='goal_accept')d.source.panel.onConfirm();else d.source.panel.onCancel();
 if(d.store.getState().open.includes(d.item))throw Error('Native goal proposal did not accept the decision');
 dialogRevisions.delete('goal_proposal');
}
`
