/** Return/model offers borrow mounted native controls; effects and admission stay native. */
export const claudeTerminalResumeReturnRuntime = String.raw`
const nativeReturnOfferShapes={
 resume_return:{wrapper:'BCo',view:'vwe',wrapperHash:'eb1d5c3dc90bb98e32ee2cae9da94b6f918fe5e6d93a653cf7e108db9565e62d',viewHash:'8c9ad04491cf97fdfc934537c57e592350bdaa27b1253b1390cdd226acabddd8',size:22,control:17,panel:21,paragraph:6,values:['compact','continue','never'],decisions:{resume_compact:'compact',resume_continue:'continue',resume_never:'never'},dismiss:'resume_dismiss'},
 newer_model_offer:{wrapper:'UCo',view:'Rwe',wrapperHash:'70f73db42808df84f5da7f6d87cbea367577dc5a6e23934701267cd18c288442',viewHash:'c6a64e9c72bf8b4b22fdae5a3819700a899b9e04a63862f8020717293e25c772',size:20,control:15,panel:19,values:['keep','resume_on_newer_model'],decisions:{newer_keep:'keep',newer_accept:'resume_on_newer_model'},dismiss:'newer_dismiss'}
};
function nativeReturnOffer(n,kind){
 const spec=nativeReturnOfferShapes[kind];if(!spec)throw Error('Unknown native return offer');
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native resume offer is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native resume offer session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open;
 if(open.length!==1||open[0].kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 const item=open[0],payload=item.payload;
 if(kind==='resume_return'?!Number.isFinite(payload?.sessionAgeMinutes)||payload.sessionAgeMinutes<0||!Number.isFinite(payload.estimatedTokens)||payload.estimatedTokens<0||typeof payload.hasPrecomputedSummary!=='boolean':typeof payload?.from!=='string'||!payload.from||payload.from.length>16000||typeof payload.to!=='string'||!payload.to||payload.to.length>16000)throw Error('Native resume offer payload changed');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native resume offer producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native resume offer traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName(spec.wrapper)&&fiber.memoizedProps?.payload===payload&&typeof fiber.memoizedProps.answer==='function'){
   checked(fiber.type,spec.wrapperHash);
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native resume offer controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName(spec.view)&&child.memoizedProps?.onDone===fiber.memoizedProps.answer){
     checked(child.type,spec.viewHash);const props=child.memoizedProps;
     if(kind==='resume_return'?props.sessionAgeMinutes!==payload.sessionAgeMinutes||props.estimatedTokens!==payload.estimatedTokens||props.hasPrecomputedSummary!==payload.hasPrecomputedSummary:props.offer!==payload)throw Error('Native resume offer facts changed');
     const rows=child.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===spec.size&&row[spec.control]?.props&&row[spec.panel]?.props);
     if(rows?.length!==1)throw Error('Native resume offer presentation changed');
     const row=rows[0],control=row[spec.control].props,panel=row[spec.panel].props;
     if(!Array.isArray(control.options)||JSON.stringify(control.options.map(option=>option.value))!==JSON.stringify(spec.values)||typeof control.onChange!=='function'||typeof panel.onCancel!=='function')throw Error('Native resume offer choices changed');
     const mounted=[child.child],checkedNodes=new Set();let panelMounted=false,controlMounted=false;
     while(mounted.length){const node=mounted.pop();if(!node||checkedNodes.has(node))continue;if(checkedNodes.size>=2048)throw Error('Native resume offer mounting exceeded bound');checkedNodes.add(node);
      if(node.memoizedProps===panel)panelMounted=true;
      if(typeof node.type==='function'&&node.type.name===nativeFunctionName('Xe')&&node.memoizedProps===control){checked(node.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');controlMounted=true;}
      if(node.sibling)mounted.push(node.sibling);if(node.child)mounted.push(node.child);
     }
     if(panelMounted&&controlMounted)matches.push({row,control,panel});
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0],fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control||revision?.panel!==source.panel)revision={item,payload,fingerprint,sessionId,control:source.control,panel:source.panel,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source,spec};
}
function nativeResumeReturn(n){return nativeReturnOffer(n,'resume_return');}
function nativeNewerModelOffer(n){return nativeReturnOffer(n,'newer_model_offer');}
async function projectNativeReturnOffer(n,d){
 const title=await nativeGenericPermissionText(n,d.source.panel.title),paragraph=d.spec.paragraph===undefined?'':await nativeGenericPermissionText(n,d.source.row[d.spec.paragraph]),choices=[];
 for(const option of d.source.control.options){const decision=Object.keys(d.spec.decisions).find(key=>d.spec.decisions[key]===option.value);choices.push({value:decision,label:await nativeGenericPermissionText(n,option.label)});}
 const current=nativeReturnOffer(n,d.item.kind);
 if(current.item!==d.item||current.revision!==d.revision)throw Error('Native resume offer changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:d.item.kind,title,paragraphs:paragraph?[paragraph]:[],choices};
}
function answerNativeReturnOffer(n,request,kind){
 const d=nativeReturnOffer(n,kind);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native resume offer changed or expired');
 const selected=Object.hasOwn(d.spec.decisions,request.decision)?d.spec.decisions[request.decision]:undefined;
 if(request.decision!==d.spec.dismiss&&selected===undefined)throw Error('Invalid native resume offer decision');
 if(request.decision===d.spec.dismiss)d.source.panel.onCancel();else d.source.control.onChange(selected);
 if(d.store.getState().open.includes(d.item))throw Error('Native resume offer did not accept the decision');
 dialogRevisions.delete(kind);
}
function projectNativeResumeReturn(n,d){return projectNativeReturnOffer(n,d);}
function projectNativeNewerModelOffer(n,d){return projectNativeReturnOffer(n,d);}
function answerNativeResumeReturn(n,request){return answerNativeReturnOffer(n,request,'resume_return');}
function answerNativeNewerModelOffer(n,request){return answerNativeReturnOffer(n,request,'newer_model_offer');}
`
