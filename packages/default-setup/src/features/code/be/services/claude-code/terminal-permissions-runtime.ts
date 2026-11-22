/** Project original mounted Permissions controls; never implement a second rules engine. */
export const claudeTerminalPermissionsRuntime = String.raw`
const nativePermissionOwners={local:['8e4ca278c03aa64a7d666f3951ff4a1e343a5269a5acf07a03e21d7489ad37ff','c8a050b9b1f2b0cdd458b6ebee147fb759d6eb7d9bc2f2dea9b53d2c140b7bcd'],remote:['bd588d9655799c36f26b7f6cd6e88da340848918d3b7f3ccb35fbf71a63d6628','c83126250600d4c3d787c86d3952e3e5fe1b21f79bf564cdce8fa270a03828be']};
function nativePermissionParagraph(n,root){
 const runs=[],pending=[{fiber:root,style:{},alert:false}],seen=new Set();let length=0,alert=false;
 while(pending.length){
  const item=pending.pop(),f=item.fiber;if(!f||seen.has(f))continue;if(seen.size>=4096)throw Error('Native Permissions paragraph traversal exceeded bound');seen.add(f);
  if(f!==root&&f.sibling)pending.push({...item,fiber:f.sibling});
  const p=f.memoizedProps;let style=item.style,isAlert=item.alert;
  if(n.terminalComponents?.n&&f.type===n.terminalComponents.n&&p?.color==='error')isAlert=true;
  if(f.type==='ink-text'||f.type==='ink-virtual-text'){
   style={...style};const paint=p?.textStyles;
   if(paint!==undefined&&(!paint||typeof paint!=='object'||Array.isArray(paint)))throw Error('Native Permissions text paint changed');
   for(const key of ['color','backgroundColor'])if(paint?.[key]!==undefined){if(typeof paint[key]!=='string'||paint[key].length>256)throw Error('Native Permissions color changed');style[key]=paint[key];}
   for(const [key,target]of [['bold','bold'],['italic','italic'],['underline','underline'],['strikethrough','strikethrough'],['inverse','inverse'],['dim','dimColor']])if(paint?.[key]!==undefined){if(typeof paint[key]!=='boolean')throw Error('Native Permissions emphasis changed');style[target]=paint[key];}
  }
  if(f.tag===6&&typeof p==='string'&&p){length+=p.length;if(length>65536)throw Error('Native Permissions paragraph exceeded text bound');runs.push({text:p,style});alert||=isAlert;}
  if(f.child)pending.push({fiber:f.child,style,alert:isAlert});
 }
 return runs.length?{runs,...alert?{role:'alert'}:{}}:undefined;
}
function nativePermissionText(value,depth=0){
 if(depth>32)throw Error('Native permission text nesting exceeded bound');
 if(value===null||value===undefined||typeof value==='boolean')return '';
 if(typeof value==='string'||typeof value==='number')return String(value);
 if(Array.isArray(value))return value.map(v=>nativePermissionText(v,depth+1)).join('');
 if(typeof value==='object'&&value.props&&Object.hasOwn(value.props,'children'))return nativePermissionText(value.props.children,depth+1);
 throw Error('Native permission label is not supported');
}
const nativePermissionDirectoryOwners=['82ec5e10ac78d83816820ac86a78e829cb590af5e337988668816b8650c15473','f253efbd23d08ded24b3b7a564dfe865d007cd97a0966e4ec7f3f75c79936b14'];
function nativePermissionDirectory(controlsRoot,input,entry){
 if(!input){entry.permissionsDirectoryLease=undefined;return;}
 const owners=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&typeof p?.onAddDirectory==='function'&&p.permissionContext)owners.push(f);});
 if(!owners.length){entry.permissionsDirectoryLease=undefined;return;}
 if(owners.length!==1||!nativePermissionDirectoryOwners.includes(nativeModelFunctionHash(owners[0].type)))throw Error('Native directory producer changed');
 const owner=owners[0],fields=[];nativeIdeWalk(owner.child,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&p?.onChange===input.onChange&&p.onSubmit===input.onSubmit&&Array.isArray(p.suggestions))fields.push(f);});
 if(fields.length!==1||!['c6cd02efcbe63ca1098635b105cf87343f6514880c19f38944088c26ce479eb6','81590b4e10c20acc4a6bcf8648017370a77b06a1b08f034b8493ef2cd1b6cfb7'].includes(nativeModelFunctionHash(fields[0].type)))throw Error('Native directory field changed');
 const field=fields[0].memoizedProps,caches=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===38);
 if(caches?.length!==1||typeof caches[0][7]!=='function'||field.value!==input.value||field.suggestions.length>128||field.error!=null&&typeof field.error!=='string'||!Number.isInteger(field.selectedSuggestion))throw Error('Native directory completion changed');
 const complete=caches[0][7];let lease=entry.permissionsDirectoryLease;
 if(!lease||lease.owner!==owner.memoizedProps||lease.change!==input.onChange||lease.submit!==input.onSubmit||lease.complete!==complete)lease=entry.permissionsDirectoryLease={owner:owner.memoizedProps,change:input.onChange,submit:input.onSubmit,complete,id:createHash('sha256').update(randomUUID()).digest('hex'),epoch:0,busy:false};
 const items=field.suggestions,suggestions=items.map(item=>{
  if(typeof item?.id!=='string'||!item.id||item.id.length>16384||typeof item.displayText!=='string'||item.displayText.length>65536||item.description!==undefined&&typeof item.description!=='string')throw Error('Native directory suggestion changed');
  const label=item.displayText,description=item.description;return {value:item.id,label,...description!==undefined?{description}:{},token:createHash('sha256').update(JSON.stringify([lease.id,lease.epoch,input.value,item.id,label,description])).digest('hex')};
 });
 if(new Set(suggestions.map(s=>s.value)).size!==suggestions.length)throw Error('Native directory suggestions are ambiguous');
 const selectedValue=items[field.selectedSuggestion]?.id,problem=field.error??undefined;
 const snapshot={kind:'directory',id:lease.id,revision:createHash('sha256').update(JSON.stringify([lease.id,lease.epoch,input.value,problem])).digest('hex'),suggestions,...selectedValue!==undefined?{selectedValue}:{},...problem!==undefined?{problem}:{}};
 return {lease,field,items,snapshot};
}
function nativePermissionAutoRule(controlsRoot,input,entry){
 if(!input){entry.permissionsAutoRuleLease=undefined;return;}
 const owners=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&['allow','soft_deny','hard_deny','environment'].includes(p?.section)&&typeof p.onSubmit==='function'&&typeof p.onCancel==='function')owners.push(f);});
 if(!owners.length){entry.permissionsAutoRuleLease=undefined;return;}
 if(owners.length!==1||!['015b00025c6788136ff0ca3ae813ac911cdce4a52d405ad01f7b87963622d501','fed4d2175d21f30aa5bcb8e2e69c048d1f3361f0c502d7f19ef98077fecfe135'].includes(nativeModelFunctionHash(owners[0].type)))throw Error('Native auto mode rule producer changed');
 const owner=owners[0],fields=[],problems=[];nativeIdeWalk(owner.child,f=>{const p=f.memoizedProps;if(p===input)fields.push(f);if(typeof f.type==='function'&&p?.color==='error'&&typeof p.children==='string'){problems.push(p);return false;}});
 if(fields.length!==1||input.multiline!==true||typeof input.inputFilter!=='function'||problems.length>1)throw Error('Native auto mode rule field changed');
 let lease=entry.permissionsAutoRuleLease;
 if(!lease||lease.owner!==owner.memoizedProps||lease.change!==input.onChange||lease.submit!==input.onSubmit)lease=entry.permissionsAutoRuleLease={owner:owner.memoizedProps,change:input.onChange,submit:input.onSubmit,id:createHash('sha256').update(randomUUID()).digest('hex'),epoch:0,busy:false};
 const problem=problems[0]?.children;if(problem?.length>65536)throw Error('Native auto mode validation exceeded bounds');
 return {lease,field:input,items:[],problemProps:problems[0],snapshot:{kind:'autoRule',id:lease.id,revision:createHash('sha256').update(JSON.stringify([lease.id,lease.epoch,input.value,problem])).digest('hex'),suggestions:[],...problem!==undefined?{problem}:{}}};
}
function nativePermissionDecisionState(owner){
 const matches=[],seen=new Set();let hook=owner.memoizedState;
 while(hook){if(seen.has(hook)||seen.size>=512)throw Error('Native denial state traversal exceeded bound');seen.add(hook);const state=hook.memoizedState?.current;
  if(state&&Array.isArray(state.denials)&&Object.prototype.toString.call(state.approved)==='[object Set]'&&Object.prototype.toString.call(state.retry)==='[object Set]')matches.push(state);hook=hook.next;
 }
 if(matches.length>1)throw Error('Native denial decisions are ambiguous');const state=matches[0];if(!state)return;
 if(state.denials.length>2048||[...state.approved,...state.retry].some(i=>!Number.isInteger(i)||i<0||i>=state.denials.length))throw Error('Native denial decisions changed');
 return {approved:state.approved.size,retry:state.retry.size};
}
function nativePermissionRecent(controlsRoot,picker){
 const owners=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&Array.isArray(p?.denials)&&typeof p.onStateChange==='function'&&typeof p.onHeaderFocusChange==='function')owners.push(f);});
 if(!owners.length)return;if(owners.length!==1||!['778577580f5ce69db75851a9cd5bca62db56721ba04ff74c8e1800fbe510cefa','b230f51612e3684854bbcd2284f7900cf428a128c6f1c7340ed2c004f6cedfd8'].includes(nativeModelFunctionHash(owners[0].type)))throw Error('Native recent denials producer changed');
 const owner=owners[0],cache=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===46);
 if(cache?.length!==1||!picker||picker.options.length!==owner.memoizedProps.denials.length||picker.props.onChange!==cache[0][15]||picker.props.onFocus!==cache[0][16]||typeof picker.props.onFocus!=='function'||typeof cache[0][20]!=='function'||!Number.isInteger(cache[0][17])||typeof cache[0][18]!=='boolean'||[13,25,29].some(i=>Object.prototype.toString.call(cache[0][i])!=='[object Set]'))throw Error('Native recent denials controls changed');
 const c=cache[0],container=c[45],handlers=[];if(container?.props?.onKeyDown!==c[20])throw Error('Native recent denial retry container changed');nativeIdeWalk(owner.child,f=>{if(f.type===container.type&&f.memoizedProps===container.props)handlers.push(f);});if(handlers.length!==1)throw Error('Native recent denial retry owner changed');
 const choices=picker.options.map((o,index)=>{
  const parts=o.label?.props?.children,status=parts?.[0];if(o.value!==String(index)||!Array.isArray(parts)||parts.length!==3||!['b7097cfb75fda499f36e9f7d7385de9b7d46a6c526e45268b2eea4d0c06d4670','3b05e00b8aec0c76fa3e70d0eb8e0dbf739c42e0e270a86f6f4104f65f622e6b'].includes(nativeModelFunctionHash(status?.type))||status.props?.status!==(c[25].has(index)?'success':'error')||status.props?.withSpace!==true)throw Error('Native recent denial label changed');
  if(nativePermissionText(parts[2])!==(c[29].has(index)?' (retry)':''))throw Error('Native recent denial retry label changed');
  return {value:o.value,label:nativePermissionText(parts[1]),...o.description!==undefined?{description:nativePermissionText(o.description)}:{},approved:c[25].has(index),retryScheduled:c[29].has(index),retryAvailable:true,disabled:picker.props.isDisabled===true||c[13].has(index)};
 });
 return {props:owner.memoizedProps,picker,focus:picker.props.onFocus,keyDown:c[20],focused:String(c[17]),headerFocused:c[18],choices};
}
function nativePermissionSearch(owner,controlsRoot,ruleList,entry,local){
 const autoLists=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&Array.isArray(p?.entries)&&p.builtinsState&&typeof p.onSelectBuiltins==='function'&&typeof p.onSelectEntry==='function'&&typeof p.onAddNew==='function'&&typeof p.searchQuery==='string')autoLists.push(f);});
 if(autoLists.length>1||autoLists.length&&ruleList)throw Error('Native permission search owner is ambiguous');
 const auto=autoLists[0];if(auto&&!['5492680dc6847a0efcf3b94da97323f463cad841677e5a44509103001e4c5665','3f709f17fa33f9e99e9e35cd8802e2f7221a0acbb185bd652afe65382ed32c5b'].includes(nativeModelFunctionHash(auto.type)))throw Error('Native auto mode search producer changed');
 if(!ruleList&&!auto){entry.permissionsSearchLease=undefined;return;}
 const props=ruleList??auto.memoizedProps,caches=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===226),change=caches?.[0]?.[24];
 if(!local||caches?.length!==1||typeof change!=='function'||!['5fe3df31f754a92dcf6b401e5a84c7847a17025d80993378dac3c7156c9fca6a','bea4a520d9eaa0cba97a113ebee911e6f0b6c02db598c6e383360b0a04a1a609'].includes(nativeModelFunctionHash(change))||typeof props.searchQuery!=='string'||props.searchQuery.length>16384)throw Error('Native permission query callback changed');
 const displays=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&p?.query===props.searchQuery&&typeof p.isTerminalFocused==='boolean'&&typeof p.isFocused==='boolean'&&Number.isInteger(p.cursorOffset))displays.push(f);});
 if(displays.length>1||auto&&displays.length!==1||displays.some(f=>!['f5c5ed1101f7b42dfb0dc71cca252bc576d03e9f93d00e32640a10ad50b63dc2','d9a668082ccaf460ad84c88c570367b30bceb97769653467ea0359b303ae17ec'].includes(nativeModelFunctionHash(f.type))))throw Error('Native permission query display changed');
 const tab=ruleList?.tab??'automode';let lease=entry.permissionsSearchLease;
 if(!lease||lease.tab!==tab||lease.change!==change)lease=entry.permissionsSearchLease={tab,change,token:createHash('sha256').update(randomUUID()).digest('hex'),busy:false};
 return {lease,value:props.searchQuery,displayProps:displays[0]?.memoizedProps};
}
function nativePermissionsFrame(n,entry){
 entry.current();if(entry.closed||entry.answered||!['permissions','add-dir'].includes(entry.commandName))throw Error('Native Permissions panel expired');
 const hash=nativeModelFunctionHash(entry.originalType),providedDirectory=entry.commandName==='add-dir';
 if(providedDirectory&&!nativePermissionDirectoryOwners.includes(hash))throw Error('Native directory producer changed');
 if(providedDirectory&&(typeof entry.originalProps?.directoryPath!=='string'||!entry.originalProps.directoryPath))throw Error('Use terminal controls to enter a working directory');
 const local=providedDirectory||nativePermissionOwners.local.includes(hash);
 if(!local&&!nativePermissionOwners.remote.includes(hash))throw Error('Native Permissions producer changed');
 const owners=[];nativeIdeWalk(n.themeRoots.ai().get(process.stdout)?.container?.current,f=>{if(f.type===entry.originalType&&f.memoizedProps===entry.originalProps)owners.push(f);});
 if(owners.length!==1)throw Error('Native Permissions is not uniquely mounted');
 const owner=owners[0],tabs=[],pickers=[],inputs=[],paragraphs=[];
 let tabFrame,tabOwner,focusBody,ruleList;const ruleLists=[],bodies=[];
 nativeIdeWalk(owner.child,f=>{const p=f.memoizedProps;if(typeof f.type!=='function'||!p)return;
  if(p.title==='Permissions'&&Array.isArray(p.children)){tabFrame=p;tabOwner=f;}
  if(typeof p.title==='string'&&typeof p.isCurrent==='boolean'&&typeof p.onClick==='function')tabs.push(p);
  if(typeof p.id==='string'&&typeof p.title==='string'&&p.children)bodies.push(f);
  if(['allow','ask','deny'].includes(p.tab)&&typeof p.getRulesOptions==='function'&&typeof p.handleToolSelect==='function')ruleLists.push(p);
 });
 let controlsRoot=owner.child;
 if(tabFrame){
  const selected=tabs.filter(t=>t.isCurrent);if(selected.length!==1)throw Error('Native Permissions active tab is ambiguous');
  const active=bodies.filter(f=>f.memoizedProps.title===selected[0].title&&f.child);
  if(active.length!==1)throw Error('Native Permissions active body changed');controlsRoot=active[0].child;
  if(!['a2ed848a66ba4a3055694ea64f27b7f1b126f093b0b13c9c56f98c72d41a242c','9848f88d74e42a102b8cbdced12d71e71c6e56ef1c84fd8c58ab8aa0898e707d'].includes(nativeModelFunctionHash(tabOwner.type)))throw Error('Native Permissions tab producer changed');
  const providers=[];nativeIdeWalk(tabOwner.child,f=>{const v=f.memoizedProps?.value;if(v&&typeof v.headerFocused==='boolean'&&typeof v.focusHeader==='function'&&typeof v.blurHeader==='function'&&typeof v.registerOptIn==='function'&&typeof v.registerNavigationOwner==='function')providers.push(v);});
  if(providers.length!==1||providers[0].selectedTab!==(active[0].memoizedProps.id??active[0].memoizedProps.title))throw Error('Native Permissions tab focus owner changed');
  focusBody=providers[0].headerFocused?providers[0].blurHeader:undefined;
  const activeRules=[];nativeIdeWalk(controlsRoot,f=>{if(ruleLists.includes(f.memoizedProps))activeRules.push(f.memoizedProps);});
  if(activeRules.length>1)throw Error('Native Permissions rule lists are ambiguous');ruleList=activeRules[0];
 }else if(ruleLists.length===1)ruleList=ruleLists[0];
 const search=nativePermissionSearch(owner,controlsRoot,ruleList,entry,local);
 // Root lists are read through the original getter, including its sorting/filtering and source keys.
 if(ruleList){
  const result=ruleList.getRulesOptions(ruleList.tab,ruleList.searchQuery);
  if(!Array.isArray(result?.options)||result.options.length>2048)throw Error('Native Permissions rule list changed');
  pickers.push({props:ruleList,options:result.options,select:value=>ruleList.handleToolSelect(value,ruleList.tab)});
 }else nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type!=='function'||!p)return;
  if(Array.isArray(p.options)&&typeof (p.onChange??p.onSelect)==='function'&&p.options.every(o=>typeof o?.value==='string'&&Object.hasOwn(o,'label'))){pickers.push({props:p,options:p.options,select:p.onChange??p.onSelect});return false;}
  if(typeof p.value==='string'&&typeof p.onChange==='function'&&typeof p.onSubmit==='function'&&typeof p.placeholder==='string'){inputs.push(p);return false;}
 });
 if(pickers.length>1||inputs.length>1||pickers.length&&inputs.length)throw Error('Native Permissions controls are ambiguous');
 const picker=pickers[0],input=inputs[0],liveForm=nativePermissionDirectory(controlsRoot,input,entry)??nativePermissionAutoRule(controlsRoot,input,entry);
 if(providedDirectory&&(!picker||typeof picker.props.onCancel!=='function'||picker.options.length!==3||picker.options.map(o=>o.value).join(',')!=='yes-session,yes-remember,no'))throw Error('Native directory decisions changed');
 const textRoots=[];let bodyFrame;
 if(!tabFrame){
  const frames=[];nativeIdeWalk(owner.child,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&typeof p?.title==='string'&&p.children!==undefined)frames.push(f);});
  bodyFrame=frames[0];
  if(bodyFrame){
   const children=Array.isArray(bodyFrame.memoizedProps.children)?bodyFrame.memoizedProps.children:[bodyFrame.memoizedProps.children];
   for(const element of children){if(element===null||element===undefined||typeof element==='boolean')continue;if(typeof element!=='object')throw Error('Native Permissions body element changed');const matches=[];nativeIdeWalk(bodyFrame.child,f=>{if(f.type===element.type&&f.memoizedProps===element.props)matches.push(f);});if(matches.length!==1)throw Error('Native Permissions body is not uniquely mounted');textRoots.push(matches[0]);}
  }else if(['19402997c9ec0c7bb57ebb4fe65ffd9e9fbdef857b9088fa1ed1eac99f9fe18d','61abd1560c3097702383db89a1347182baa6c2ce4d5d7d0733135f74682fd5f2'].includes(nativeModelFunctionHash(owner.child?.type))){
   const boxes=[];nativeIdeWalk(owner.child,f=>{if(f.memoizedProps?.borderStyle==='round'&&f.memoizedProps.borderColor==='error'){boxes.push(f);return false;}});if(boxes.length!==1)throw Error('Native Permissions delete context changed');textRoots.push(boxes[0]);
  }
 }
 if(!textRoots.length)textRoots.push(controlsRoot);
 for(const root of textRoots)nativeIdeWalk(root,f=>{const p=f.memoizedProps;if(liveForm?.problemProps&&p===liveForm.problemProps||search?.displayProps&&p===search.displayProps)return false;if(typeof f.type==='function'&&(Array.isArray(p?.options)&&typeof (p.onChange??p.onSelect)==='function'||typeof p?.onSubmit==='function'&&typeof p?.value==='string'))return false;if(f.type!=='ink-text'&&(!n.terminalComponents?.n||f.type!==n.terminalComponents.n))return;const paragraph=nativePermissionParagraph(n,f);if(paragraph)paragraphs.push(paragraph);return false;},false);
 const title=tabFrame?.title??bodyFrame?.memoizedProps.title??'Permissions';
 let cancel=providedDirectory?picker.props.onCancel:owner.child?.memoizedProps?.onCancel;
 if(typeof cancel!=='function'){
  const caches=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===(local?226:19));
  if(caches?.length!==1||typeof caches[0][local?39:1]!=='function')throw Error('Native Permissions dismissal changed');cancel=caches[0][local?39:1];
 }
 const recent=nativePermissionRecent(controlsRoot,picker),decisions=local&&!providedDirectory?nativePermissionDecisionState(owner):undefined;
 const choices=recent?.choices??(picker?.options??[]).map(o=>({value:o.value,label:nativePermissionText(o.label),...(o.description!==undefined?{description:nativePermissionText(o.description)}:{}),disabled:o.disabled===true||o.isDisabled===true||picker.props.isDisabled===true}));
 if(new Set(choices.map(o=>o.value)).size!==choices.length||tabs.length>16||paragraphs.length>256||paragraphs.some(p=>p.runs.reduce((size,run)=>size+run.text.length,0)>65536)||choices.some(o=>!o.value||o.value.length>16384||o.label.length>65536)||title.length>65536)throw Error('Native Permissions text or choices exceed bounds');
 const defaultFocusValue=recent?.focused??picker?.props.defaultFocusValue??picker?.props.lastFocusedRuleKey??(providedDirectory?choices.find(o=>!o.disabled)?.value:undefined);
 const permissions={title,...decisions?{decisions}:{},...typeof defaultFocusValue==='string'&&choices.some(o=>o.value===defaultFocusValue)?{defaultFocusValue}:{},tabs:tabs.map(t=>({value:t.title,label:t.title,selected:t.isCurrent})),paragraphs,choices,readOnly:!local,...search?{search:search.value,searchScope:search.lease.token}:{},...input?{form:{value:input.value,placeholder:input.placeholder,multiline:input.multiline===true,submitLabel:liveForm?.snapshot.kind==='directory'?'Add directory':liveForm?'Save rule':'Continue',...liveForm?{live:liveForm.snapshot}:{}}}:{}};
 const encoded=JSON.stringify(permissions),prior=entry.permissionsFrame,source=picker?.props??input??tabFrame??owner.memoizedProps;
 if(!prior||prior.encoded!==encoded||prior.source!==source||prior.cancel!==cancel||prior.focusBody!==focusBody||prior.liveForm?.field!==liveForm?.field||prior.recent?.props!==recent?.props||prior.recent?.keyDown!==recent?.keyDown)entry.permissionsFrame={encoded,source,cancel,focusBody,picker,input,liveForm,tabs,ruleList,search,recent,snapshot:{revision:createHash('sha256').update(encoded+randomUUID()).digest('hex'),rows:[],permissions}};
 return entry.permissionsFrame;
}
async function actNativePermissionRecent(n,entry,recent,value,retry,signal){
 await recent.focus(value);
 for(let attempt=0;attempt<40;attempt++){
  signal.throwIfAborted();entry.current();const current=nativePermissionsFrame(n,entry),active=current.recent;
  if(!active||active.props!==recent.props||!active.choices.some(o=>o.value===value&&!o.disabled)||active.headerFocused)throw Error('Native denial action expired');
  if(active.focused===value){
   if(retry)await active.keyDown({key:'r',ctrl:false,meta:false,shift:false,preventDefault(){}});
   else await active.picker.select(value);
   return;
  }
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw Error('Claude Code has not acknowledged denial focus. Refresh before trying again.');
}
function nativePermissionCommitMessages(n,entry){
 // The original root keeps its dismissal acknowledgement list in slot35; qr appends its save result there.
 const owners=[];nativeIdeWalk(n.themeRoots.ai().get(process.stdout)?.container?.current,f=>{if(f.type===entry.originalType&&f.memoizedProps===entry.originalProps)owners.push(f);});
 const cache=owners.length===1?owners[0].updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===226):undefined,messages=cache?.length===1?cache[0][35]:undefined;
 if(!Array.isArray(messages)||messages.length>256||messages.some(v=>typeof v!=='string'||v.length>65536))throw Error('Native environment commit acknowledgement changed');
 return messages;
}
function nativePermissionCommitStatus(n,entry,frame){
 const commit=entry.permissionsEditorCommit;if(!commit)return {pending:false};
 if(!frame.snapshot.permissions.tabs.length){entry.permissionsEditorCommit=undefined;return {pending:false};}
 const messages=nativePermissionCommitMessages(n,entry);
 if(messages===commit.messages)return {pending:true};
 if(messages.length!==commit.messages.length+1||commit.messages.some((v,i)=>messages[i]!==v))throw Error('Native environment commit result changed');
 const result=messages.at(-1);entry.permissionsEditorCommit=undefined;
 if(result.startsWith('Could not save the environment — '))return {pending:false,problem:result};
 if(!['Replaced the built-in auto mode environment with your own document','Saved your auto mode environment document'].includes(result))throw Error('Native environment commit result is not recognized');
 return {pending:false};
}
function nativePermissionCommittedResult(n,entry,frame){
 const commit=nativePermissionCommitStatus(n,entry,frame);
 return {snapshot:commit.pending?{...frame.snapshot,commitPending:true}:frame.snapshot,...commit.problem?{problem:commit.problem}:{}};
}
async function nativePermissionEditorAction(n,entry,request,before,invoke,onEnvironment){
 const value=request.command?.value,title=before.snapshot.permissions.title;
 const opensEnvironment=value==='environment-document'||value==='environment'||title==='Replace the built-in environment?'&&value==='confirm'||title==='Edit environment'&&value==='reopen';
 if(request.command?.action!=='select'||before.snapshot.permissions.readOnly||!opensEnvironment)return invoke();
 const get=n.questionOptions.Bc,set=n.questionOptions.dzo,path=n.runtime.hgs;
 if(!['755ff28597ef753308ce7c5638c7d137b281c32142c3bf96cda73c929f8609ed','0e511c19c284af7ac3b9eda8e7784918f2d44603145df66ac7a0510f2ee398ed'].includes(nativeModelFunctionHash(get))||!['ab76cee4f7db1822ee6020683639a9412b38512ce798500110df5a1d743833b1','22a5e02666af94c03e7d073869bd1faf12f87dbd380667aa0aeaaccf08553b86'].includes(nativeModelFunctionHash(set))||!['bc940c622b9e6d02ed188b36512d52ce43bb6e947ce1df71b81462bcf65f4b67','87fcbe09ecb16c1de5642ecab818520bcc7288c364001bb4c9000f9b21fa26e1'].includes(nativeModelFunctionHash(path)))throw Error('Native external editor capability or directory producer changed');
 const file=path('auto-mode-env-edit-0000000000000000.md');
 if(file===null)return invoke();
 const prepared=await ownerPost('/native-editor-prepare',{pid:process.pid,clientId:request.client_id,panelId:request.panel_id,directory:nativeEditorDirname(file)});
 if(typeof prepared.command!=='string'||!prepared.command.startsWith('/')||/\s/.test(prepared.command))throw Error('Native editor launcher is unavailable');
 if(nativePermissionsFrame(n,entry)!==before)throw Error('Native Permissions changed during editor preparation');entry.current();
 const previous=get(),commit={frame:before,messages:nativePermissionCommitMessages(n,entry)};entry.permissionsEditorCommit=commit;onEnvironment?.(commit);
 // Scope only the synchronous original callback. Never retain an editor override while awaiting settings IO.
 try{set({...previous,editor:prepared.command});return invoke();}finally{set(previous);}
}
async function nativePermissionsPanel(n,entry,request,abort){
 const before=nativePermissionsFrame(n,entry);abort.signal.throwIfAborted();if(request.operation==='read')return nativePermissionCommittedResult(n,entry,before);
 if(nativePermissionCommitStatus(n,entry,before).pending)throw Error('Wait for Claude Code to finish saving the environment');
 if(request.operation!=='permissions')throw Error('Unsupported native Permissions operation');
 const command=request.command;if(!command||typeof command.action!=='string')throw Error('Native Permissions action is missing');
 // Only the original query setter filters the native list and moves its cursor; search never writes a rule.
 if(command.action==='search'){
  const search=before.search,lease=search?.lease;
  if(!lease||command.scope!==lease.token||lease.busy||typeof command.value!=='string'||command.value.length>16384||nativePermissionsFrame(n,entry).search?.lease!==lease)throw Error('Native permission search unavailable');
  entry.current();lease.busy=true;
  try{
   await lease.change(command.value);
   for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();entry.current();const after=nativePermissionsFrame(n,entry);if(after.search?.lease!==lease)throw Error('Native permission search expired');if(after.search.value===command.value)return {snapshot:after.snapshot};await new Promise(resolve=>setTimeout(resolve,25));}
   return {snapshot:nativePermissionsFrame(n,entry).snapshot,problem:'Claude Code has not acknowledged the search. Refresh to check its current state.'};
  }finally{lease.busy=false;}
 }
 const liveForm=before.liveForm,liveSubmit=command.action==='submit'&&!!liveForm,liveCancel=command.action==='cancel'&&!!liveForm;
 if(command.action==='change'||command.action==='complete'||liveSubmit||liveCancel){
  if(!liveForm||command.scope!==liveForm.lease.id||liveForm.lease.busy)throw Error('Native permission field expired or busy');
  let callback,args,expected;
  if(command.action==='change'){
   if(typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission draft changed');
   expected=typeof before.input.inputFilter==='function'?before.input.inputFilter(command.value):command.value;callback=before.input.onChange;args=[expected];
  }else if(command.action==='complete'){
   const index=liveForm.snapshot.suggestions.findIndex(s=>s.value===command.value&&s.token===command.token);
   if(index<0||before.consumed)throw Error('Native directory suggestion changed');callback=liveForm.lease.complete;args=[liveForm.items[index]];
  }else if(liveCancel){callback=before.cancel;args=[];}else{
   if(command.formRevision!==liveForm.snapshot.revision||command.value!==before.input.value||before.consumed)throw Error('Native permission submission changed');callback=before.input.onSubmit;args=[command.value];
  }
  if(nativePermissionsFrame(n,entry)!==before)throw Error('Native permission field changed before dispatch');entry.current();liveForm.lease.epoch++;liveForm.lease.busy=true;if(command.action!=='change')before.consumed=true;
  try{await callback(...args);}finally{liveForm.lease.busy=false;}
  for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,25));entry.current();const after=nativePermissionsFrame(n,entry);
   if(after.liveForm?.lease!==liveForm.lease)return {snapshot:after.snapshot};
   if(command.action==='change'?after.input.value===expected:command.action==='complete'?after.liveForm.field!==liveForm.field||after.input.value!==before.input.value:true)return {snapshot:after.snapshot};
  }
  return {snapshot:nativePermissionsFrame(n,entry).snapshot,problem:'Claude Code has not acknowledged the permission edit. Refresh to check its current state.'};
 }
 if(command.scope!==undefined||command.formRevision!==undefined)throw Error('Native permission field expired');
 if(request.revision!==before.snapshot.revision||before.consumed)throw Error('Native Permissions changed before this action');
 let callback,args=[];
 if(command.action==='tab'){const tab=before.tabs.find(t=>t.title===command.value);if(!tab)throw Error('Native Permissions tab unavailable');callback=tab.onClick;}

 else if(command.action==='select'){const choice=before.snapshot.permissions.choices.find(o=>o.value===command.value&&!o.disabled);if(!choice||!before.picker)throw Error('Native permission choice unavailable');callback=before.recent?()=>actNativePermissionRecent(n,entry,before.recent,command.value,false,abort.signal):before.picker.select;args=before.recent?[]:[command.value];}
 else if(command.action==='retry'){
  const recent=before.recent,choice=recent?.choices.find(o=>o.value===command.value&&!o.disabled);if(!recent||!choice||recent.headerFocused)throw Error('Native denial retry unavailable');
  callback=()=>actNativePermissionRecent(n,entry,recent,command.value,true,abort.signal);
 }
 else if(command.action==='submit'){if(!before.input||typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission input unavailable');callback=before.input.onSubmit;args=[typeof before.input.inputFilter==='function'?before.input.inputFilter(command.value):command.value];}
 else if(command.action==='cancel')callback=before.cancel;
 else throw Error('Unsupported native Permissions action');
 if(nativePermissionsFrame(n,entry)!==before)throw Error('Native Permissions changed before dispatch');entry.current();let editorCommit;
 try{await nativePermissionEditorAction(n,entry,request,before,()=>{before.consumed=true;entry.permissionsSearchLease=undefined;return callback(...args);},commit=>{editorCommit=commit;});}catch(error){entry.permissionsEditorCommit=undefined;throw error;}
 let focusRequested=false;
 for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();if(!entry.closed&&!entry.answered)await new Promise(resolve=>setTimeout(resolve,25));if(entry.closed||entry.answered)return {snapshot:{revision:before.snapshot.revision,rows:[],permissions:{title:'Permissions',tabs:[],paragraphs:[],choices:[],readOnly:true}}};entry.current();const after=nativePermissionsFrame(n,entry);
  if(command.action==='tab'){
   if(after.snapshot.permissions.tabs.find(t=>t.selected)?.value!==command.value)continue;
   if(after.focusBody){if(!focusRequested){if(nativePermissionsFrame(n,entry)!==after)throw Error('Native Permissions focus changed before dispatch');entry.current();focusRequested=true;await after.focusBody();}continue;}
  }
  if(editorCommit&&after.snapshot.permissions.tabs.length)entry.permissionsEditorCommit=editorCommit;
  if(after!==before||editorCommit&&after.snapshot.permissions.tabs.length){const result=nativePermissionCommittedResult(n,entry,after);if(result.snapshot.commitPending)continue;return result;}}
 const pendingResult=nativePermissionCommittedResult(n,entry,nativePermissionsFrame(n,entry));if(editorCommit||pendingResult.snapshot.commitPending)return pendingResult;
 return {snapshot:before.snapshot,problem:'Claude Code has not acknowledged the permission action. Refresh to check its current state.'};
}
async function closeNativePermissionsPanel(n,entry){const frame=nativePermissionsFrame(n,entry);entry.current();await frame.cancel();return {open:!entry.closed};}
`
