/** Project original mounted Permissions controls; never implement a second rules engine. */
export const claudeTerminalPermissionsRuntime = String.raw`
const nativePermissionOwners={local:['8e4ca278c03aa64a7d666f3951ff4a1e343a5269a5acf07a03e21d7489ad37ff','c8a050b9b1f2b0cdd458b6ebee147fb759d6eb7d9bc2f2dea9b53d2c140b7bcd'],remote:['bd588d9655799c36f26b7f6cd6e88da340848918d3b7f3ccb35fbf71a63d6628','c83126250600d4c3d787c86d3952e3e5fe1b21f79bf564cdce8fa270a03828be']};
function nativePermissionText(value,depth=0){
 if(depth>32)throw Error('Native permission text nesting exceeded bound');
 if(value===null||value===undefined||typeof value==='boolean')return '';
 if(typeof value==='string'||typeof value==='number')return String(value);
 if(Array.isArray(value))return value.map(v=>nativePermissionText(v,depth+1)).join('');
 if(typeof value==='object'&&value.props&&Object.hasOwn(value.props,'children'))return nativePermissionText(value.props.children,depth+1);
 throw Error('Native permission label is not supported');
}
function nativePermissionDirectory(controlsRoot,input,entry){
 if(!input){entry.permissionsDirectoryLease=undefined;return;}
 const owners=[];nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&typeof p?.onAddDirectory==='function'&&p.permissionContext)owners.push(f);});
 if(!owners.length){entry.permissionsDirectoryLease=undefined;return;}
 if(owners.length!==1||!['82ec5e10ac78d83816820ac86a78e829cb590af5e337988668816b8650c15473','f253efbd23d08ded24b3b7a564dfe865d007cd97a0966e4ec7f3f75c79936b14'].includes(nativeModelFunctionHash(owners[0].type)))throw Error('Native directory producer changed');
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
function nativePermissionsFrame(n,entry){
 entry.current();if(entry.closed||entry.answered||entry.commandName!=='permissions')throw Error('Native Permissions panel expired');
 const hash=nativeModelFunctionHash(entry.originalType),local=nativePermissionOwners.local.includes(hash);
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
 // Root lists are read through the original getter, including its sorting/filtering and source keys.
 if(ruleList){
  const result=ruleList.getRulesOptions(ruleList.tab,entry.permissionsSearch??ruleList.searchQuery??'');
  if(!Array.isArray(result?.options)||result.options.length>2048)throw Error('Native Permissions rule list changed');
  pickers.push({props:ruleList,options:result.options,select:value=>ruleList.handleToolSelect(value,ruleList.tab)});
 }else nativeIdeWalk(controlsRoot,f=>{const p=f.memoizedProps;if(typeof f.type!=='function'||!p)return;
  if(Array.isArray(p.options)&&typeof (p.onChange??p.onSelect)==='function'&&p.options.every(o=>typeof o?.value==='string'&&typeof o.label==='string')){pickers.push({props:p,options:p.options,select:p.onChange??p.onSelect});return false;}
  if(typeof p.value==='string'&&typeof p.onChange==='function'&&typeof p.onSubmit==='function'&&typeof p.placeholder==='string'){inputs.push(p);return false;}
 });
 if(pickers.length>1||inputs.length>1||pickers.length&&inputs.length)throw Error('Native Permissions controls are ambiguous');
 const picker=pickers[0],input=inputs[0],liveForm=nativePermissionDirectory(controlsRoot,input,entry)??nativePermissionAutoRule(controlsRoot,input,entry);
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
 for(const root of textRoots)nativeIdeWalk(root,f=>{const p=f.memoizedProps;if(liveForm?.problemProps&&p===liveForm.problemProps)return false;if(typeof f.type==='function'&&(Array.isArray(p?.options)&&typeof (p.onChange??p.onSelect)==='function'||typeof p?.onSubmit==='function'&&typeof p?.value==='string'))return false;if(f.type!=='ink-text')return;let text='';nativeIdeWalk(f.child,c=>{if(c.tag===6&&typeof c.memoizedProps==='string')text+=c.memoizedProps;});if(text)paragraphs.push(text);return false;},false);
 const title=tabFrame?.title??bodyFrame?.memoizedProps.title??'Permissions';
 let cancel=owner.child?.memoizedProps?.onCancel;
 if(typeof cancel!=='function'){
  const caches=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===(local?226:19));
  if(caches?.length!==1||typeof caches[0][local?39:1]!=='function')throw Error('Native Permissions dismissal changed');cancel=caches[0][local?39:1];
 }
 const choices=(picker?.options??[]).map(o=>({value:o.value,label:nativePermissionText(o.label),...(o.description!==undefined?{description:nativePermissionText(o.description)}:{}),disabled:o.disabled===true||o.isDisabled===true||picker.props.isDisabled===true}));
 if(new Set(choices.map(o=>o.value)).size!==choices.length||tabs.length>16||paragraphs.length>256||paragraphs.some(t=>t.length>65536)||choices.some(o=>!o.value||o.value.length>16384||o.label.length>65536)||title.length>65536)throw Error('Native Permissions text or choices exceed bounds');
 const defaultFocusValue=picker?.props.defaultFocusValue??picker?.props.lastFocusedRuleKey;
 if(!ruleList)entry.permissionsSearchLease=undefined;else if(entry.permissionsSearchLease?.tab!==ruleList.tab)entry.permissionsSearchLease={tab:ruleList.tab,token:createHash('sha256').update(randomUUID()).digest('hex')};
 const permissions={title,...typeof defaultFocusValue==='string'&&choices.some(o=>o.value===defaultFocusValue)?{defaultFocusValue}:{},tabs:tabs.map(t=>({value:t.title,label:t.title,selected:t.isCurrent})),paragraphs,choices,readOnly:!local,...ruleList?{search:entry.permissionsSearch??ruleList.searchQuery??'',searchScope:entry.permissionsSearchLease.token}:{},...input?{form:{value:input.value,placeholder:input.placeholder,multiline:input.multiline===true,submitLabel:liveForm?.snapshot.kind==='directory'?'Add directory':liveForm?'Save rule':'Continue',...liveForm?{live:liveForm.snapshot}:{}}}:{}};
 const encoded=JSON.stringify(permissions),prior=entry.permissionsFrame,source=picker?.props??input??tabFrame??owner.memoizedProps;
 if(!prior||prior.encoded!==encoded||prior.source!==source||prior.cancel!==cancel||prior.focusBody!==focusBody||prior.liveForm?.field!==liveForm?.field)entry.permissionsFrame={encoded,source,cancel,focusBody,picker,input,liveForm,tabs,ruleList,snapshot:{revision:createHash('sha256').update(encoded+randomUUID()).digest('hex'),rows:[],permissions}};
 return entry.permissionsFrame;
}
async function nativePermissionsPanel(n,entry,request,abort){
 const before=nativePermissionsFrame(n,entry);abort.signal.throwIfAborted();if(request.operation==='read')return {snapshot:before.snapshot};
 if(request.operation!=='permissions')throw Error('Unsupported native Permissions operation');
 const command=request.command;if(!command||typeof command.action!=='string')throw Error('Native Permissions action is missing');
 // Filtering reads the current native list; its lease survives renders but not another action or tab.
 if(command.action==='search'){
  if(!before.ruleList||command.scope!==before.snapshot.permissions.searchScope||typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission search unavailable');
  entry.permissionsSearch=command.value;return {snapshot:nativePermissionsFrame(n,entry).snapshot};
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

 else if(command.action==='select'){const choice=before.snapshot.permissions.choices.find(o=>o.value===command.value&&!o.disabled);if(!choice||!before.picker)throw Error('Native permission choice unavailable');callback=before.picker.select;args=[command.value];}
 else if(command.action==='submit'){if(!before.input||typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission input unavailable');callback=before.input.onSubmit;args=[typeof before.input.inputFilter==='function'?before.input.inputFilter(command.value):command.value];}
 else if(command.action==='cancel')callback=before.cancel;
 else throw Error('Unsupported native Permissions action');
 if(nativePermissionsFrame(n,entry)!==before)throw Error('Native Permissions changed before dispatch');entry.current();before.consumed=true;entry.permissionsSearchLease=undefined;await callback(...args);
 let focusRequested=false;
 for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();if(entry.closed)return {snapshot:{revision:before.snapshot.revision,rows:[],permissions:{title:'Permissions',tabs:[],paragraphs:[],choices:[],readOnly:true}}};await new Promise(resolve=>setTimeout(resolve,25));entry.current();const after=nativePermissionsFrame(n,entry);
  if(command.action==='tab'){
   if(after.snapshot.permissions.tabs.find(t=>t.selected)?.value!==command.value)continue;
   if(after.focusBody){if(!focusRequested){if(nativePermissionsFrame(n,entry)!==after)throw Error('Native Permissions focus changed before dispatch');entry.current();focusRequested=true;await after.focusBody();}continue;}
  }
  if(after!==before)return {snapshot:after.snapshot};}
 return {snapshot:before.snapshot,problem:'Claude Code has not acknowledged the permission action. Refresh to check its current state.'};
}
async function closeNativePermissionsPanel(n,entry){const frame=nativePermissionsFrame(n,entry);entry.current();await frame.cancel();return {open:!entry.closed};}
`
