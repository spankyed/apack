/** Mid-session credit consent shares billing controls with /model, but not its root or lifetime. */
export const claudeTerminalCreditDialogRuntime = String.raw`
const nativeCreditDialogEntries=new WeakMap();
const nativeCreditDialogWrapperHashes=['78992b85babbb53889dc3395168432c43d1f0d96d895324d1691d195539b0dea','c22015901fc04791e0e413460c8a25a14aed2663c3535bcfce10a2bb24a362b1'];
function nativeCreditDialogContext(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native credit dialog is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native credit dialog session changed');
 return {binding,sessionId,store:binding.toolContext(new AbortController()).dialogStore};
}
function nativeCreditDialogFrame(n,entry){
 const context=nativeCreditDialogContext(n);
 if(context.binding!==entry.binding||context.sessionId!==entry.sessionId||context.store!==entry.store)throw Error('Native credit dialog owner changed');
 const open=context.store.getState().open;
 if(!open.includes(entry.item)){entry.closed=true;throw Error('Native credit dialog expired');}
 if(entry.closed||entry.answered||open.length!==1||open[0]!==entry.item||entry.item.kind!=='fable_overage_consent_prompt'||entry.item.payload!==entry.payload||JSON.stringify(entry.payload)!==entry.fingerprint)throw Error('Native credit dialog replaced');
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const owners=nativeModelFibers(root).filter(fiber=>fiber.type===entry.originalType&&fiber.memoizedProps?.payload===entry.payload&&fiber.memoizedProps.answer===entry.answer);
 if(owners.length!==1)throw Error('Native credit dialog is not uniquely mounted');
 const owner=owners[0];
 if(!nativeCreditDialogWrapperHashes.includes(nativeModelFunctionHash(owner.type)))throw Error('Native credit dialog producer changed');
 const credits=nativeModelFibers(owner).filter(fiber=>nativeModelPanelHashes.credits.includes(nativeModelFunctionHash(fiber.type)));
 if(credits.length!==1||credits[0].memoizedProps?.variant!=='mid-session'||credits[0].memoizedProps.model!==entry.payload.model||credits[0].memoizedProps.modelName!==entry.payload.modelName)throw Error('Native mid-session credit renderer changed');
 return owner;
}
function nativeCreditDialog(n){
 const context=nativeCreditDialogContext(n),open=context.store.getState().open,item=open.length===1?open[0]:undefined;
 if(item?.kind!=='fable_overage_consent_prompt')return undefined;
 const payload=item.payload;
 if(typeof payload?.overagesEnabled!=='boolean'||payload.model!==undefined&&typeof payload.model!=='string'||payload.modelName!==undefined&&typeof payload.modelName!=='string'||JSON.stringify(payload).length>1048576)throw Error('Native credit dialog payload changed');
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const owners=nativeModelFibers(root).filter(fiber=>fiber.memoizedProps?.payload===payload&&nativeCreditDialogWrapperHashes.includes(nativeModelFunctionHash(fiber.type)));
 if(owners.length!==1)throw Error('Native credit dialog is not uniquely mounted');
 const owner=owners[0];if(typeof owner.memoizedProps.answer!=='function')throw Error('Native credit dialog answer changed');
 let entry=nativeCreditDialogEntries.get(item);
 // The original host rebuilds answer when its native input-grace callback changes.
 // Reissue the drawing rather than permanently attaching to the retired callback.
 if(!entry||entry.answer!==owner.memoizedProps.answer){
  entry={kind:'credit-dialog',...context,item,payload,fingerprint:JSON.stringify(payload),originalType:owner.type,answer:owner.memoizedProps.answer,closed:false,answered:false,revision:randomUUID()};
  entry.current=()=>{
   const current=nativeCreditDialogContext(n);
   if(current.binding!==entry.binding||current.sessionId!==entry.sessionId||current.store!==entry.store)throw Error('Native credit dialog owner changed');
   if(!entry.store.getState().open.includes(entry.item)){entry.closed=true;return;}
   nativeCreditDialogFrame(n,entry);
  };
  nativeCreditDialogEntries.set(item,entry);
 }
 nativeCreditDialogFrame(n,entry);
 return entry;
}
function projectNativeCreditSnapshot(entry,snapshot){
 return {id:entry.item.id,revision:entry.revision,sessionId:entry.sessionId,kind:'fable_overage_consent_prompt',title:'Usage credits',paragraphs:[],snapshot};
}
async function projectNativeCreditDialog(n,entry,signal){
 const result=await nativeModelPanel(n,entry,{operation:'read'},{signal});
 entry.current();if(entry.closed)return null;
 return projectNativeCreditSnapshot(entry,result.snapshot);
}
async function operateNativeCreditDialog(n,request,abort){
 const entry=nativeCreditDialog(n);
 if(!entry||entry.item.id!==request.id||entry.revision!==request.revision||entry.sessionId!==request.session_id)throw Error('Native credit dialog changed or expired');
 const operation=request.credit?.operation;
 if(!operation||!['read','editor'].includes(operation.kind)||operation.kind==='editor'&&!['change','select','save','cancel'].includes(operation.command?.action))throw Error('Native credit action is unavailable');
 const result=await nativeModelPanel(n,entry,operation.kind==='read'?{operation:'read'}:{operation:'editor',revision:operation.revision,editor_revision:operation.editorRevision,command:operation.command},abort);
 entry.current();return {answered:true,notice:entry.closed?null:projectNativeCreditSnapshot(entry,result.snapshot)};
}
let nativeCreditResultFrame;
function nativeCreditConsentResult(n){
 const absent=()=>{nativeCreditResultFrame=undefined;return undefined;},binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId||nativeViewFacts(n,binding,new AbortController()).view.kind!=='main')return absent();
 const context=binding.toolContext(new AbortController());if(context.dialogStore.getState().open.length)return absent();
 const notice=context.getAppState().notifications?.current;
 if(notice?.key!=='fable-consent-result'||notice.kind!=='feedback'||typeof notice.text!=='string'||!notice.text||notice.text.length>16000||notice.jsx!==undefined)return absent();
 if(nativeCreditResultFrame?.notice!==notice||nativeCreditResultFrame?.sessionId!==sessionId||nativeCreditResultFrame?.text!==notice.text)nativeCreditResultFrame={notice,sessionId,text:notice.text,revision:randomUUID()};
 return {id:notice.key,revision:nativeCreditResultFrame.revision,sessionId,kind:'credit_consent_result',severity:'feedback',title:'Usage credits',paragraphs:[notice.text]};
}
`
