/** Original computer-use choices own app grants and OS permission effects; the host only delegates. */
export const claudeTerminalComputerPermissionRuntime = String.raw`
function nativeComputerPermission(n){
 const binding=originalContext??n.runtime.ey(),kind='computer_use_approval';
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native computer permission is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native computer permission session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined,payload=item?.payload;
 if(item?.kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 if(!payload||typeof payload!=='object')throw Error('Native computer permission payload changed');
 const os=!!payload.tccState,phase=os?'os_permissions':'apps';
 if(os?typeof payload.tccState.accessibility!=='boolean'||typeof payload.tccState.screenRecording!=='boolean':!Array.isArray(payload.apps)||!payload.requestedFlags||typeof payload.requestedFlags!=='object')throw Error('Native computer permission payload changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native computer permission producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native computer permission traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName(os?'gke':'hke')&&(os?fiber.memoizedProps?.tccState===payload.tccState:fiber.memoizedProps?.request===payload)){
   checked(fiber.type,os?'78ec867cab44009bbbf455f7b5213729232bf0728e3a2ddeb9253328ab793d57':'77608fdd68458defcd0a0162882bcc1275263731ac952f2fbef47086653fce16');
   if(typeof fiber.memoizedProps.onDone!=='function'||typeof fiber.memoizedProps.wouldTakeAnswer!=='function'||fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const length=os?39:79,selectorSlot=os?32:69,panelSlot=os?38:78;
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===length&&row[selectorSlot]?.props&&row[panelSlot]?.props);
   if(rows?.length!==1)throw Error('Native computer permission presentation changed');
   const row=rows[0],selector=row[selectorSlot],control=selector.props;
   if(typeof selector.type!=='function'||selector.type.name!==nativeFunctionName('Xe'))throw Error('Native computer permission selector changed');
   checked(selector.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
   if(typeof control.onChange!=='function'||typeof control.onCancel!=='function'||typeof control.refuseInput!=='function'||control.isDisabled===true||control.disableSelection===true||!Array.isArray(control.options))return {store,sessionId};
   const values=control.options.map(option=>option.value),expected=os?[...(!payload.tccState.accessibility?['open_accessibility']:[]),...(!payload.tccState.screenRecording?['open_screen_recording']:[]),'retry']:['deny','allow_all'];
   if(JSON.stringify(values)!==JSON.stringify(expected))throw Error('Native computer permission choices changed');
   const panel=row[panelSlot];if(panel.props.title!==(os?'Computer Use needs macOS permissions':'Computer Use wants to control these apps'))throw Error('Native computer permission title changed');
   matches.push({row,control,panel});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0],fingerprint=JSON.stringify(payload);if(fingerprint.length>1048576)throw Error('Native computer permission payload exceeds bound');let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control)revision={item,payload,fingerprint,sessionId,control:source.control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source,phase};
}
const computerPermissionDecisions={'deny':'computer_deny','allow_all':'computer_allow','open_accessibility':'computer_accessibility','open_screen_recording':'computer_screen_recording','retry':'computer_retry'};
async function projectNativeComputerPermission(n,d){
 const title=await nativeGenericPermissionText(n,d.source.panel.props.title),paragraphs=[];
 for(const slot of d.phase==='os_permissions'?[26,27]:[46,56,58,60]){const node=d.source.row[slot];if(node!==null&&node!==undefined){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}}
 const choices=[];for(const option of d.source.control.options)choices.push({value:computerPermissionDecisions[option.value],label:await nativeGenericPermissionText(n,option.label)});
 const current=nativeComputerPermission(n);if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native computer permission changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'computer_use_approval',phase:d.phase,title,paragraphs,choices,...d.phase==='apps'?{preferredChoice:'computer_deny'}:{}};
}
function answerNativeComputerPermission(n,request){
 const d=nativeComputerPermission(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native computer permission changed or expired');
 if(d.source.control.refuseInput())throw Error('Native computer permission is not ready for input');
 let value;
 if(request.decision==='computer_cancel')d.source.control.onCancel();
 else{value=Object.keys(computerPermissionDecisions).find(key=>computerPermissionDecisions[key]===request.decision);if(!value||!d.source.control.options.some(option=>option.value===value))throw Error('Native computer permission choice is unavailable');d.source.control.onChange(value);}
 // Opening System Settings intentionally leaves the original dialog alive; only native retry/cancel settles it.
 if(value==='open_accessibility'||value==='open_screen_recording')return;
 if(d.store.getState().open.includes(d.item))throw Error('Native computer permission did not accept the decision');
 dialogRevisions.delete('computer_use_approval');
}
`
