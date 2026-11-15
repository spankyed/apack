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
function nativePermissionsFrame(n,entry){
 entry.current();if(entry.closed||entry.answered||entry.commandName!=='permissions')throw Error('Native Permissions panel expired');
 const hash=nativeModelFunctionHash(entry.originalType),local=nativePermissionOwners.local.includes(hash);
 if(!local&&!nativePermissionOwners.remote.includes(hash))throw Error('Native Permissions producer changed');
 const owners=[];nativeIdeWalk(n.themeRoots.ai().get(process.stdout)?.container?.current,f=>{if(f.type===entry.originalType&&f.memoizedProps===entry.originalProps)owners.push(f);});
 if(owners.length!==1)throw Error('Native Permissions is not uniquely mounted');
 const owner=owners[0],tabs=[],pickers=[],inputs=[],paragraphs=[];
 let tabFrame,ruleList;const ruleLists=[],bodies=[];
 nativeIdeWalk(owner.child,f=>{const p=f.memoizedProps;if(typeof f.type!=='function'||!p)return;
  if(p.title==='Permissions'&&Array.isArray(p.children))tabFrame=p;
  if(typeof p.title==='string'&&typeof p.isCurrent==='boolean'&&typeof p.onClick==='function')tabs.push(p);
  if(typeof p.id==='string'&&typeof p.title==='string'&&p.children)bodies.push(f);
  if(['allow','ask','deny'].includes(p.tab)&&typeof p.getRulesOptions==='function'&&typeof p.handleToolSelect==='function')ruleLists.push(p);
 });
 let controlsRoot=owner.child;
 if(tabFrame){
  const selected=tabs.filter(t=>t.isCurrent);if(selected.length!==1)throw Error('Native Permissions active tab is ambiguous');
  const active=bodies.filter(f=>f.memoizedProps.title===selected[0].title&&f.child);
  if(active.length!==1)throw Error('Native Permissions active body changed');controlsRoot=active[0].child;
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
 for(const root of textRoots)nativeIdeWalk(root,f=>{const p=f.memoizedProps;if(typeof f.type==='function'&&(Array.isArray(p?.options)&&typeof (p.onChange??p.onSelect)==='function'||typeof p?.onSubmit==='function'&&typeof p?.value==='string'))return false;if(f.type!=='ink-text')return;let text='';nativeIdeWalk(f.child,c=>{if(c.tag===6&&typeof c.memoizedProps==='string')text+=c.memoizedProps;});if(text)paragraphs.push(text);return false;},false);
 const title=tabFrame?.title??bodyFrame?.memoizedProps.title??'Permissions';
 let cancel=owner.child?.memoizedProps?.onCancel;
 if(typeof cancel!=='function'){
  const caches=owner.updateQueue?.memoCache?.data?.filter(c=>Array.isArray(c)&&c.length===(local?226:19));
  if(caches?.length!==1||typeof caches[0][local?39:1]!=='function')throw Error('Native Permissions dismissal changed');cancel=caches[0][local?39:1];
 }
 const picker=pickers[0],input=inputs[0];
 const choices=(picker?.options??[]).map(o=>({value:o.value,label:nativePermissionText(o.label),...(o.description!==undefined?{description:nativePermissionText(o.description)}:{}),disabled:o.disabled===true||o.isDisabled===true||picker.props.isDisabled===true}));
 if(new Set(choices.map(o=>o.value)).size!==choices.length||tabs.length>16||paragraphs.length>256||paragraphs.some(t=>t.length>65536)||choices.some(o=>!o.value||o.value.length>16384||o.label.length>65536)||title.length>65536)throw Error('Native Permissions text or choices exceed bounds');
 const defaultFocusValue=picker?.props.defaultFocusValue??picker?.props.lastFocusedRuleKey;
 const permissions={title,...typeof defaultFocusValue==='string'&&choices.some(o=>o.value===defaultFocusValue)?{defaultFocusValue}:{},tabs:tabs.map(t=>({value:t.title,label:t.title,selected:t.isCurrent})),paragraphs,choices,readOnly:!local,...ruleList?{search:entry.permissionsSearch??ruleList.searchQuery??''}:{},...input?{form:{value:input.value,placeholder:input.placeholder,multiline:input.multiline===true,submitLabel:'Continue'}}:{}};
 const encoded=JSON.stringify(permissions),prior=entry.permissionsFrame,source=picker?.props??input??tabFrame??owner.memoizedProps;
 if(!prior||prior.encoded!==encoded||prior.source!==source||prior.cancel!==cancel)entry.permissionsFrame={encoded,source,cancel,picker,input,tabs,ruleList,snapshot:{revision:createHash('sha256').update(encoded+randomUUID()).digest('hex'),rows:[],permissions}};
 return entry.permissionsFrame;
}
async function nativePermissionsPanel(n,entry,request,abort){
 const before=nativePermissionsFrame(n,entry);abort.signal.throwIfAborted();if(request.operation==='read')return {snapshot:before.snapshot};
 if(request.operation!=='permissions'||request.revision!==before.snapshot.revision||before.consumed)throw Error('Native Permissions changed before this action');
 const command=request.command;if(!command||typeof command.action!=='string')throw Error('Native Permissions action is missing');
 let callback,args=[];
 if(command.action==='tab'){const tab=before.tabs.find(t=>t.title===command.value);if(!tab)throw Error('Native Permissions tab unavailable');callback=tab.onClick;}
 else if(command.action==='search'){if(!before.ruleList||typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission search unavailable');entry.permissionsSearch=command.value;return {snapshot:nativePermissionsFrame(n,entry).snapshot};}
 else if(command.action==='select'){const choice=before.snapshot.permissions.choices.find(o=>o.value===command.value&&!o.disabled);if(!choice||!before.picker)throw Error('Native permission choice unavailable');callback=before.picker.select;args=[command.value];}
 else if(command.action==='submit'){if(!before.input||typeof command.value!=='string'||command.value.length>16384)throw Error('Native permission input unavailable');callback=before.input.onSubmit;args=[typeof before.input.inputFilter==='function'?before.input.inputFilter(command.value):command.value];}
 else if(command.action==='cancel')callback=before.cancel;
 else throw Error('Unsupported native Permissions action');
 if(nativePermissionsFrame(n,entry)!==before)throw Error('Native Permissions changed before dispatch');entry.current();before.consumed=true;await callback(...args);
 for(let attempt=0;attempt<40;attempt++){abort.signal.throwIfAborted();if(entry.closed)return {snapshot:{revision:before.snapshot.revision,rows:[],permissions:{title:'Permissions',tabs:[],paragraphs:[],choices:[],readOnly:true}}};await new Promise(resolve=>setTimeout(resolve,25));entry.current();const after=nativePermissionsFrame(n,entry);if(after!==before)return {snapshot:after.snapshot};}
 return {snapshot:before.snapshot,problem:'Claude Code has not acknowledged the permission action. Refresh to check its current state.'};
}
async function closeNativePermissionsPanel(n,entry){const frame=nativePermissionsFrame(n,entry);entry.current();await frame.cancel();return {open:!entry.closed};}
`
