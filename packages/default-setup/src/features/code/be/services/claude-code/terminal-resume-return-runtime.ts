/** Present only the original mounted resume offer; compaction and persistence stay native. */
export const claudeTerminalResumeReturnRuntime = String.raw`
function nativeResumeReturn(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native resume offer is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native resume offer session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,kind='resume_return';
 if(open.length!==1||open[0].kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=open[0],payload=item.payload;
 if(!Number.isFinite(payload?.sessionAgeMinutes)||payload.sessionAgeMinutes<0||!Number.isFinite(payload.estimatedTokens)||payload.estimatedTokens<0||typeof payload.hasPrecomputedSummary!=='boolean')throw Error('Native resume offer payload changed');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native resume offer producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native resume offer traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('BCo')&&fiber.memoizedProps?.payload===payload&&typeof fiber.memoizedProps.answer==='function'){
   checked(fiber.type,'eb1d5c3dc90bb98e32ee2cae9da94b6f918fe5e6d93a653cf7e108db9565e62d');
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native resume offer controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('vwe')&&child.memoizedProps?.onDone===fiber.memoizedProps.answer){
     checked(child.type,'8c9ad04491cf97fdfc934537c57e592350bdaa27b1253b1390cdd226acabddd8');
     const props=child.memoizedProps;
     if(props.sessionAgeMinutes!==payload.sessionAgeMinutes||props.estimatedTokens!==payload.estimatedTokens||props.hasPrecomputedSummary!==payload.hasPrecomputedSummary)throw Error('Native resume offer facts changed');
     const rows=child.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===22&&row[17]?.props&&row[21]?.props);
     if(rows?.length!==1)throw Error('Native resume offer presentation changed');
     const row=rows[0],control=row[17].props,panel=row[21].props;
     if(!Array.isArray(control.options)||JSON.stringify(control.options.map(option=>option.value))!==JSON.stringify(['compact','continue','never'])||typeof control.onChange!=='function'||typeof panel.onCancel!=='function')throw Error('Native resume offer choices changed');
     matches.push({row,control,panel});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0],fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control||revision?.panel!==source.panel)revision={item,payload,fingerprint,sessionId,control:source.control,panel:source.panel,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source};
}
async function projectNativeResumeReturn(n,d){
 const title=await nativeGenericPermissionText(n,d.source.panel.title),paragraph=await nativeGenericPermissionText(n,d.source.row[6]),choices=[];
 for(const option of d.source.control.options)choices.push({value:'resume_'+option.value,label:await nativeGenericPermissionText(n,option.label)});
 const current=nativeResumeReturn(n);
 if(current.item!==d.item||current.revision!==d.revision)throw Error('Native resume offer changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'resume_return',title,paragraphs:paragraph?[paragraph]:[],choices};
}
function answerNativeResumeReturn(n,request){
 const d=nativeResumeReturn(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native resume offer changed or expired');
 if(!['resume_compact','resume_continue','resume_never','resume_dismiss'].includes(request.decision))throw Error('Invalid native resume offer decision');
 if(request.decision==='resume_dismiss')d.source.panel.onCancel();else d.source.control.onChange(request.decision.slice(7));
 if(d.store.getState().open.includes(d.item))throw Error('Native resume offer did not accept the decision');
 dialogRevisions.delete('resume_return');
}
`
