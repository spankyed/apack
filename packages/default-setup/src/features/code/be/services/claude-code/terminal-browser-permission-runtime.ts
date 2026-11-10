/** Browser approval reads the original mounted choices; domain grants and tool effects stay native. */
export const claudeTerminalBrowserPermissionRuntime = String.raw`
function nativeBrowserPermission(n){
 const binding=originalContext??n.runtime.ey(),kind='permission_browser';
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native browser permission is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native browser permission session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined,payload=item?.payload;
 if(item?.kind!==kind){dialogRevisions.delete(kind);return {store,sessionId};}
 if(typeof payload?.requestId!=='string'||!payload.requestId||payload.requestId.length>256||typeof payload.toolName!=='string'||!payload.toolName.startsWith('mcp__claude-in-chrome__')||payload.toolName.length>256||typeof payload.verbPhrase!=='string'||payload.verbPhrase.length>16000||!payload.input||typeof payload.input!=='object'||!payload.permissionResult||typeof payload.permissionResult!=='object')throw Error('Native browser permission payload changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native browser permission producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native browser permission traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('tCe')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,'348a33f1ead463a4a6fb8cd44b40bcfc142906989dd2c78a1f7328263ed2d3d0');
   if(typeof fiber.memoizedProps.answer!=='function'||typeof fiber.memoizedProps.wouldTakeAnswer!=='function'||fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===44&&row[31]?.props&&row[43]?.props);
   if(rows?.length!==1)throw Error('Native browser permission presentation changed');
   const row=rows[0],selector=row[31],control=selector.props;
   if(typeof selector.type!=='function'||selector.type.name!==nativeFunctionName('Xe'))throw Error('Native browser permission selector changed');
   checked(selector.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
   if(typeof control.onChange!=='function'||typeof control.onCancel!=='function'||control.isDisabled===true||control.disableSelection===true||control.refuseInput!==undefined||!Array.isArray(control.options))return {store,sessionId};
   const values=control.options.map(option=>option.value);
   if(JSON.stringify(values)!==JSON.stringify(['allow','deny'])&&JSON.stringify(values)!==JSON.stringify(['allow','allow-domain','deny']))throw Error('Native browser permission choices changed');
   matches.push({row,control});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const source=matches[0],fingerprint=JSON.stringify(payload);if(fingerprint.length>1048576)throw Error('Native browser permission payload exceeds bound');let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control)revision={item,payload,fingerprint,sessionId,control:source.control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source};
}
async function projectNativeBrowserPermission(n,d){
 const title=await nativeGenericPermissionText(n,d.source.row[43].props.title),paragraphs=[];
 for(const node of [d.source.row[22],d.source.row[24],d.source.row[27]])if(node!==null&&node!==undefined){const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);}
 const decisions={'allow':'browser_allow','allow-domain':'browser_domain','deny':'browser_deny'},choices=[];
 for(const option of d.source.control.options)choices.push({value:decisions[option.value],label:await nativeGenericPermissionText(n,option.label)});
 const current=nativeBrowserPermission(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native browser permission changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'permission_browser',toolName:d.payload.toolName,requestId:d.payload.requestId,title,paragraphs,choices};
}
function answerNativeBrowserPermission(n,request){
 const d=nativeBrowserPermission(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native browser permission changed or expired');
 if(request.decision==='browser_cancel')d.source.control.onCancel();
 else{const value=({'browser_allow':'allow','browser_domain':'allow-domain','browser_deny':'deny'})[request.decision];if(!value||!d.source.control.options.some(option=>option.value===value))throw Error('Native browser permission choice is unavailable');d.source.control.onChange(value);}
 if(d.store.getState().open.includes(d.item))throw Error('Native browser permission did not accept the decision');
 dialogRevisions.delete('permission_browser');
}
`
