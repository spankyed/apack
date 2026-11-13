/** The original effort controller owns the choice/option-order result and preference persistence. */
export const claudeTerminalEffortNudgeRuntime = String.raw`
function nativeEffortNudge(n){
 const binding=originalContext??n.runtime.ey(),kind='effort_medium_nudge';
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native effort preference is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native effort preference session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined,payload=item?.payload;
 if(item?.kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 if(typeof payload?.model!=='string'||payload.model.length>4096||!payload.copy||typeof payload.copy!=='object'||typeof payload.copy.body!=='string'||typeof payload.copy.fromLevel!=='string'||typeof payload.copy.toLevel!=='string')throw Error('Native effort preference payload changed');
 const fingerprint=JSON.stringify(payload);if(fingerprint.length>1048576)throw Error('Native effort preference payload exceeds bound');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native effort preference producer changed');};
 const find=(root,predicate)=>{const pending=[root],seen=new Set(),found=[];while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native effort preference traversal exceeded bound');seen.add(fiber);if(predicate(fiber))found.push(fiber);if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);}return found;};
 const wrappers=find(n.themeRoots.ai().get(process.stdout)?.container?.current,fiber=>typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('WCo')&&fiber.memoizedProps?.payload===payload);
 if(wrappers.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const wrapper=wrappers[0];checked(wrapper.type,'31de5abb44ffd78579919bfd0574f3f08c124efcc60007f3344c240ca2b2faa6');
 if(typeof wrapper.memoizedProps.answer!=='function'||typeof wrapper.memoizedProps.wouldTakeAnswer==='function'&&wrapper.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
 const renderers=find(wrapper.child,fiber=>typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('KSe')&&fiber.memoizedProps?.model===payload.model&&fiber.memoizedProps.copy===payload.copy);
 if(renderers.length!==1)throw Error('Native effort preference renderer changed');const renderer=renderers[0];checked(renderer.type,'2443a2be7a2af0dae5d76bfca389432c87abd845f0ff59ba3958aaf9790ab720');
 const rows=renderer.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===75&&row[62]?.props&&row[74]?.props);if(rows?.length!==1)throw Error('Native effort preference memo changed');
 const row=rows[0],control=row[62].props;
 if(typeof control.onConfirm!=='function'||typeof control.onCancel!=='function'||typeof control.refuseInput!=='function'||!['confirm','cancel'].includes(control.focus)||typeof control.cancelFirst!=='boolean'||control.confirmLabel==null||control.cancelLabel==null)throw Error('Native effort preference choices changed');
 if(control.isDisabled===true)return {store,sessionId};
 const controls=find(renderer.child,fiber=>typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('lr')&&fiber.memoizedProps===control);if(controls.length!==1)throw Error('Native effort preference control is not mounted');checked(controls[0].type,'3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70');
 let revision=dialogRevisions.get(kind);if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==control)revision={item,payload,fingerprint,sessionId,control,revision:randomUUID()};dialogRevisions.set(kind,revision);return {store,...revision,source:{row,control}};
}
async function projectNativeEffortNudge(n,d){
 const title=await nativeGenericPermissionText(n,d.source.row[74].props.title),paragraphs=[],body=await nativeGenericPermissionText(n,d.source.row[47]);if(body)paragraphs.push(body);
 const warning=d.source.row[49]?await nativeGenericPermissionText(n,d.source.row[49]):undefined;
 const confirm={value:'effort_accept',label:await nativeGenericPermissionText(n,d.source.control.confirmLabel)},cancel={value:'effort_decline',label:await nativeGenericPermissionText(n,d.source.control.cancelLabel)};
 const current=nativeEffortNudge(n);if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native effort preference changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'effort_medium_nudge',model:d.payload.model,title,paragraphs,...warning?{warning}:{},preferredChoice:d.source.control.focus==='cancel'?'effort_decline':'effort_accept',choices:d.source.control.cancelFirst?[cancel,confirm]:[confirm,cancel]};
}
let nativeEffortResultFrame;
function nativeEffortPreferenceResult(n){
 const absent=()=>{nativeEffortResultFrame=undefined;return undefined;},binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId||nativeViewFacts(n,binding,new AbortController()).view.kind!=='main')return absent();
 // Current native priority/expiry owns visibility; do not promote queued notices or fabricate outcomes.
 const context=binding.toolContext(new AbortController());if(context.dialogStore.getState().open.length)return absent();
 const notice=context.getAppState().notifications?.current;
 if(notice?.key!=='effort-medium-nudge-result'||!['warning','feedback'].includes(notice.kind)||typeof notice.text!=='string'||!notice.text||notice.text.length>16000||notice.jsx!==undefined)return absent();
 const fingerprint=JSON.stringify([notice.kind,notice.text]);
 if(nativeEffortResultFrame?.notice!==notice||nativeEffortResultFrame?.sessionId!==sessionId||nativeEffortResultFrame?.fingerprint!==fingerprint)nativeEffortResultFrame={notice,sessionId,fingerprint,revision:randomUUID()};
 return {id:notice.key,revision:nativeEffortResultFrame.revision,sessionId,kind:'effort_preference_result',severity:notice.kind,title:'Effort preference',paragraphs:[notice.text]};
}
function answerNativeEffortNudge(n,request){
 const d=nativeEffortNudge(n);if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native effort preference changed or expired');
 if(!['effort_accept','effort_decline'].includes(request.decision))throw Error('Native effort preference choice is unavailable');
 if(d.source.control.refuseInput())throw Error('Native effort preference is not ready for input');
 (request.decision==='effort_accept'?d.source.control.onConfirm:d.source.control.onCancel)();
 if(d.store.getState().open.includes(d.item))throw Error('Native effort preference has not accepted the decision');
 dialogRevisions.delete('effort_medium_nudge');
}
`
