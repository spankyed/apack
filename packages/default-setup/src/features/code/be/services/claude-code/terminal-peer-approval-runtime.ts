/** Present the held message rendered by Claude, and answer through its mounted Select callbacks. */
export const claudeTerminalPeerApprovalRuntime = String.raw`
function nativePeerApproval(n){
 const binding=originalContext??n.runtime.ey(),kind='peer_inbound_approval';
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native held peer message is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native held peer message session changed');
 const store=binding.toolContext(new AbortController()).dialogStore;
 const items=store.getState().open.filter(item=>item.kind===kind);
 const absent=()=>{dialogRevisions.delete(kind);return {store,sessionId};};
 if(!items.length)return absent();
 const pending=[[n.themeRoots.ai().get(process.stdout)?.container?.current,false]],seen=new Set(),matches=[];
 while(pending.length){
  const [fiber,inside]=pending.pop();
  if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native peer message traversal exceeded bound');
  seen.add(fiber);
  let selection=inside;
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('nCe')){
   const item=items.find(candidate=>candidate.payload===fiber.memoizedProps?.payload);
   if(item){
    let hash=composerFunctionHashes.get(fiber.type);
    if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
    if(hash!=='ff0c47924a6d6280c6d5fdd5bae7c0513f82f4c16038f08829f8c01502fa0a27')throw Error('Native peer message producer changed');
    if(typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()!==true)return absent();
    const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===37&&row[29]?.props&&row[36]?.props);
    if(rows?.length!==1)throw Error('Native peer message presentation changed');
    selection={item,row:rows[0]};
   }
  }
  if(inside&&fiber.type===inside.row[29].type&&fiber.memoizedProps===inside.row[29].props)matches.push({...inside,control:fiber.memoizedProps});
  if(fiber.sibling)pending.push([fiber.sibling,inside]);
  if(fiber.child)pending.push([fiber.child,selection]);
 }
 if(matches.length!==1)return absent();
 const source=matches[0],{item,control}=source,payload=item.payload;
 if(typeof payload?.preview!=='string'||payload.preview.length>16000||typeof payload.holdCause!=='string')throw Error('Native peer message payload changed');
 if(control.defaultFocusValue!=='deny'||!Array.isArray(control.options)||control.options.length!==2||
    control.options[0]?.value!=='deny'||control.options[1]?.value!=='approve'||
    typeof control.refuseInput!=='function'||typeof control.onChange!=='function'||typeof control.onCancel!=='function')throw Error('Native peer message choices changed');
 const fingerprint=JSON.stringify(payload);
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.payload!==payload||revision.fingerprint!==fingerprint||revision.sessionId!==sessionId||revision.control!==control){
  revision={item,payload,fingerprint,sessionId,control,revision:randomUUID()};
 }
 dialogRevisions.set(kind,revision);
 return {store,...revision,source};
}
async function projectNativePeerApproval(n,d){
 const {row,control}=d.source;
 const title=await nativeGenericPermissionText(n,row[36].props.title);
 const paragraphs=[];
 for(const node of [row[8],row[12],row[14]]){
  const text=await nativeGenericPermissionText(n,node);
  if(text)paragraphs.push(text);
 }
 const choices=[];
 for(const option of control.options){
  choices.push({value:option.value==='deny'?'peer_deny':'peer_deliver',label:await nativeGenericPermissionText(n,option.label)});
 }
 const current=nativePeerApproval(n);
 if(current.item!==d.item||current.revision!==d.revision)throw Error('Native peer message changed while formatting');
 // Preserve message line breaks. The browser displays this as literal text, with no ANSI or markup interpretation.
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'peer_inbound_approval',title,paragraphs,message:stripVTControlCharacters(d.payload.preview),choices};
}
function answerNativePeerApproval(n,request){
 const kind='peer_inbound_approval',d=nativePeerApproval(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native peer message changed or expired');
 const decision=request.decision,control=d.source.control;
 if(!['peer_deny','peer_deliver','peer_cancel'].includes(decision))throw Error('Invalid native peer message decision');
 if(control.refuseInput())throw Error('Native peer message input is temporarily refused');
 if(decision==='peer_cancel')control.onCancel();
 else control.onChange(decision==='peer_deny'?'deny':'approve');
 if(d.store.getState().open.includes(d.item))throw Error('Native peer message did not accept the decision');
 dialogRevisions.delete(kind);
}
`
