/** Desktop projection of the original /theme command; all writes and admission remain native. */
export const claudeTerminalThemePanelRuntime = String.raw`
const nativeThemePanelHashes={"root":["661b2d361cc5c8225f327b4aa6f302f7b2695af564c0205efe51eb7e284539ba","256d4c261a421cdba7c48ea62af9a4df1af50a543a6586931a15ea4232a96606"],"picker":["0333a3f408c68ec72bd8c5d0777f46e5e145c460013adb5a0ff665bbf7162ae7","b9f5ab35590945b214b817f84d10a4cb1469872f52ab96cc93f8a47613b31987"],"editor":["f9135fea064bf5bd257a0413951940263c2393909867f58a00439ac0cda548ca","29a33d5abde7e063ff2436553f12b0c3ef2b0a6cdce16e28840519dcc9099a49"]};
function nativeThemeCommandFrame(n,entry){
 entry.current();
 if(entry.closed||entry.answered||entry.commandName!=='theme'||typeof entry.originalProps?.onDone!=='function'||!nativeThemePanelHashes.root.includes(nativeModelFunctionHash(entry.originalType)))throw Error('Native theme panel expired or changed');
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const owners=nativeModelFibers(root).filter(fiber=>fiber.type===entry.originalType&&fiber.memoizedProps?.onDone===entry.originalProps.onDone);
 if(owners.length!==1)throw Error('Native theme panel is not uniquely mounted');return owners[0];
}
function nativeThemeCache(fiber,length){
 const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===length);
 if(rows?.length!==1)throw Error('Native theme presentation changed');return rows[0];
}
async function readNativeThemePanel(n,entry,signal){
 signal?.throwIfAborted();const owner=nativeThemeCommandFrame(n,entry),fibers=nativeModelFibers(owner);
 const matches=fibers.flatMap(fiber=>{const hash=nativeModelFunctionHash(fiber.type),kind=['editor','picker'].find(kind=>nativeThemePanelHashes[kind].includes(hash));return kind?[{fiber,kind}]:[];});
 if(matches.length!==1)throw Error('Native theme controls are not ready');
 const {fiber,kind}=matches[0],p=fiber.memoizedProps;let editor,controls,identity,cacheStamp;
 if(kind==='picker'){
  const cache=nativeThemeCache(fiber,109),options=cache[30];
  if(!Array.isArray(options)||options.length>256||typeof cache[57]!=='function'||typeof cache[63]!=='function'||typeof cache[15]!=='function'||typeof cache[11]!=='function'||cache[61]!==p.onThemeSelect||cache[14]!==p.onCancel)throw Error('Native theme picker callbacks changed');
  const values=new Set();
  const rows=options.map(option=>{if(typeof option.value!=='string'||option.value.length>16384||values.has(option.value)||typeof option.label!=='string'||option.label.length>65536)throw Error('Native theme option changed');values.add(option.value);return {value:option.value,label:option.label,...typeof option.origin==='string'?{description:option.origin}:{},disabled:false,...typeof p.onCustomTheme==='function'&&option.value.startsWith('custom:')?{canEdit:true}:{}};});
  editor={kind:'choice',title:'Theme',description:typeof p.helpText==='string'?p.helpText:'',disabled:false,options:rows,value:cache[65],previewValue:cache[54],canPreview:true,canToggleSyntax:cache[0]===null};
  controls={select:value=>cache[63](options.findIndex(option=>option.value===value)),preview:value=>cache[57](options.findIndex(option=>option.value===value)),cancel:cache[15],toggle:cache[0]===null?cache[11]:undefined,edit:typeof p.onCustomTheme==='function'?cache[41]:undefined};
  if(cache[77]?.lines&&cache[84]){const palette=nativeThemePalette(n),detail=await awaitNativeSettingsReading(nativeGenericPermissionDetail(n,'Theme preview',cache[84]),signal),lines=cache[77].lines;if(!Array.isArray(lines)||lines.length>256||lines.some(line=>typeof line!=='string'||line.length>16384))throw Error('Native theme preview changed');editor.preview={theme:{text:palette.text,inverseText:palette.inverseText},text:detail.value,...detail.ansi!==undefined?{ansi:detail.ansi}:{},lines:[...lines],caption:await awaitNativeSettingsReading(nativeGenericPermissionText(n,cache[81]),signal)};}
  identity=cache;cacheStamp=[...cache];
 }else{
  const cache=nativeThemeCache(fiber,152);identity=cache;cacheStamp=[...cache];
  // Inspect only the original editor's mounted controls, never another terminal input.
  const descendants=nativeModelFibers(fiber).slice(1),ownedInputs=[cache[73]?.props?.children?.[1]?.props,cache[113]?.props?.children?.[1]?.props].filter(Boolean);
  // TextInput forwards callbacks to its rendering child. Bind only the element created by this hash-pinned editor.
  const inputs=descendants.filter(child=>ownedInputs.includes(child.memoizedProps)&&typeof child.memoizedProps?.value==='string'&&typeof child.memoizedProps.onChange==='function'&&typeof child.memoizedProps.onSubmit==='function'&&typeof child.memoizedProps.onExit==='function'&&child.memoizedProps.focus===true);
  const lists=descendants.filter(child=>child.memoizedProps===cache[151]?.props&&child.memoizedProps?.placeholder==='Filter color tokens…'&&typeof child.memoizedProps.onSelect==='function'&&typeof child.memoizedProps.onCancel==='function'&&Array.isArray(child.memoizedProps.items));
  if(inputs.length===1&&!lists.length){
   const input=inputs[0].memoizedProps,isName=input.placeholder==='my-theme';
   if(input.value.length>16384||!isName&&typeof cache[98]?.props?.children!=='string')throw Error('Native theme field changed');
   const field=isName?'name':'color',title=isName?'Name custom theme':'Edit '+cache[98].props.children;
   let form=entry.themeForm;if(!form||!sameNativeSettingsFiber(form.fiber,fiber)||form.field!==field){form={fiber,field,id:randomUUID()};entry.themeForm=form;}
   editor={kind:'form',title,live:{id:form.id},description:isName?'Create a personal theme. Themes supplied by extensions are forked before editing.':'Accepts rgb(r,g,b), #rrggbb, ansi256(n), or ansi:name. Preview follows the original theme editor.',submitLabel:isName?'Create theme':'Save color',fields:[{key:field,label:isName?'Theme name':'Color value',value:input.value}]};
   controls={input,field,cancel:input.onExit,valid:isName?cache[56]?.length>0:cache[91]===true};
  }else if(!inputs.length&&lists.length===1){
   delete entry.themeForm;const list=lists[0].memoizedProps;
   if(list.items.length>256||typeof list.renderPreview!=='function'||typeof list.onTab?.handler!=='function'||typeof list.title!=='string')throw Error('Native theme token controls changed');
   const options=[];for(const key of list.items){signal?.throwIfAborted();if(typeof key!=='string'||key.length>16384)throw Error('Native theme token changed');const description=await awaitNativeSettingsReading(nativeGenericPermissionText(n,list.renderPreview(key)),signal);if(typeof description!=='string'||description.length>65536)throw Error('Native theme token preview exceeded bound');options.push({value:key,label:key,description,disabled:false,canReset:true});}
   editor={kind:'choice',title:list.title,description:'Choose a color token to edit. Reset restores that token to the original preset.',disabled:false,options};controls={select:list.onSelect,reset:list.onTab.handler,cancel:list.onCancel};
  }else throw Error('Native theme editor controls are not ready');
 }
 signal?.throwIfAborted();const current=nativeThemeCommandFrame(n,entry),live=currentNativeSettingsFiber(current,fiber);
 if(!sameNativeSettingsFiber(owner,current)||live.memoizedProps!==p||nativeThemeCache(live,kind==='picker'?109:152)!==identity||identity.some((value,index)=>!Object.is(value,cacheStamp[index])))throw Error('Native theme changed while reading');
 const revision=createHash('sha256').update(JSON.stringify(editor)).digest('hex');return {snapshot:{revision,rows:[],editor:{...editor,revision}},owner,fiber:live,props:p,controls,identity};
}
async function waitForNativeThemePanel(n,entry,signal){
 const deadline=Date.now()+1500;while(true){try{return await readNativeThemePanel(n,entry,signal);}catch(error){signal?.throwIfAborted();entry.current();if(entry.closed||Date.now()>=deadline||!['Native theme panel is not uniquely mounted','Native theme controls are not ready','Native theme editor controls are not ready','Native theme changed while reading'].includes(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
}
async function nativeThemePanel(n,entry,request,abort){
 if(request.operation!=='read'&&entry.themeOperation)throw Error('A native theme action is pending');
 const operation={};if(request.operation!=='read')entry.themeOperation=operation;
 try{
  let before=await waitForNativeThemePanel(n,entry,abort.signal);if(request.operation==='read')return {snapshot:before.snapshot};
  if(request.operation!=='editor'||request.revision!==before.snapshot.revision||request.editor_revision!==before.snapshot.editor.revision)throw Error('Native theme changed; refresh before editing');
  const command=request.command,editor=before.snapshot.editor;let callback,args=[];
  if(command?.action==='cancel')callback=before.controls.cancel;
  else if(['select','preview','themeEdit','themeReset'].includes(command?.action)&&editor.kind==='choice'){
   const option=editor.options.find(option=>option.value===command.value);if(!option||option.disabled)throw Error('Native theme option is unavailable');
   if(command.action==='themeEdit'&&!option.canEdit||command.action==='themeReset'&&!option.canReset)throw Error('Native theme action is unavailable');
   if(command.action==='themeEdit'){
    // Original Ctrl+E edits its focused theme and wraps pending commits. Focus through its own preview callback first.
    if(editor.previewValue!==command.value){await awaitNativeSettingsReading(before.controls.preview(command.value),abort.signal);const deadline=Date.now()+500;while(true){const after=await waitForNativeThemePanel(n,entry,abort.signal);if(after.snapshot.editor.kind==='choice'&&after.snapshot.editor.previewValue===command.value){before=after;break;}if(Date.now()>=deadline)throw Error('Native theme focus was not acknowledged');await new Promise(resolve=>setTimeout(resolve,20));}}
    if(!before.snapshot.editor.options.some(option=>option.value===command.value&&option.canEdit))throw Error('Native theme edit is no longer available');
    callback=before.controls.edit;
   }else {callback=before.controls[{select:'select',preview:'preview',themeReset:'reset'}[command.action]];args=[command.value];}
  }else if(command?.action==='toggleSyntax'&&editor.kind==='choice'&&editor.canToggleSyntax)callback=before.controls.toggle;
  else if(command?.action==='change'&&editor.kind==='form'&&command.formId===editor.live.id&&command.key===before.controls.field){callback=before.controls.input.onChange;args=[command.value];}
  else if(command?.action==='save'&&editor.kind==='form'){
   if(Object.keys(command.values??{}).length!==1||command.values[before.controls.field]!==before.controls.input.value)throw Error('Native theme draft changed; wait for its acknowledgement');
   if(!before.controls.valid)throw Error('Claude Code has not accepted this theme value');callback=before.controls.input.onSubmit;
  }
  if(typeof callback!=='function')throw Error('Native theme action is unavailable');
  abort.signal.throwIfAborted();const checked=await readNativeThemePanel(n,entry,abort.signal);if(checked.snapshot.revision!==before.snapshot.revision)throw Error('Native theme changed before action');const owner=nativeThemeCommandFrame(n,entry),live=currentNativeSettingsFiber(owner,before.fiber);
  if(!sameNativeSettingsFiber(owner,before.owner)||live.memoizedProps!==before.props)throw Error('Native theme changed before action');
  await awaitNativeSettingsReading(callback(...args),abort.signal);
  const deadline=Date.now()+500;while(!entry.closed){try{const after=await readNativeThemePanel(n,entry,abort.signal);if(after.snapshot.revision!==before.snapshot.revision||Date.now()>=deadline)return {snapshot:after.snapshot};}catch(error){abort.signal.throwIfAborted();if(Date.now()>=deadline)throw error;}await new Promise(resolve=>setTimeout(resolve,20));}
  return {snapshot:before.snapshot};
 }finally{if(entry.themeOperation===operation)delete entry.themeOperation;}
}
`
