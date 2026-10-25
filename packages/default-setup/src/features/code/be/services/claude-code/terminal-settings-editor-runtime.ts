/** Project only original Config editor-opening controls from its owned element tree. */
export const claudeTerminalSettingsEditorRuntime = String.raw`
function nativeSettingsConfig(n,entry){
 const frame=nativeSettingsFrame(n,entry);
 if(frame.panel.selectedTab!=='Config')throw Error('Native Config editor is unavailable');
 const pending=[frame.owner.child],seen=new Set(),owners=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Config traversal exceeded bound');seen.add(fiber);
  const props=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&props?.onClose===entry.originalProps.onClose&&typeof props.setTabsHidden==='function'){
   const hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');
   if(!['a1aa9ebc9d9b0fd2c2c81e4ebf23ba9357260ebd2ddf924aa4322931122d6df0','f9c1d43d75a5b3536ba40462166d47979c88ee4e471ccbe19e493a83984d0707'].includes(hash))throw Error('Native Config producer changed');
   owners.push(fiber);
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(owners.length===0)throw Error('Native Config is not ready');
 if(owners.length!==1)throw Error('Native Config is not uniquely mounted');
 return {frame,owner:owners[0]};
}
function sameNativeSettingsFiber(a,b){
 return a===b||!!(a&&b&&a.type===b.type&&a.key===b.key&&a.alternate===b&&b.alternate===a);
}
function currentNativeSettingsFiber(owner,target){
 const pending=[owner],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Settings live editor traversal exceeded bound');seen.add(fiber);
  if(sameNativeSettingsFiber(fiber,target))matches.push(fiber);
  if(fiber!==owner&&fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)throw Error('Native Settings editor changed while reading');return matches[0];
}
async function waitForNativeSettingsConfig(n,entry,signal){
 const until=Date.now()+1500;
 while(true){
  signal?.throwIfAborted();entry.current();if(entry.closed||entry.answered)throw Error('Native Config owner expired');
  if(nativeSettingsFrame(n,entry).panel.selectedTab!=='Config')return;
  try{nativeSettingsConfig(n,entry);return;}
  catch(error){if(error.message!=='Native Config is not ready'||Date.now()>=until)throw error;}
  await new Promise(resolve=>setTimeout(resolve,40));
 }
}
async function waitForNativeSettingsEditor(n,entry,signal){
 const until=Date.now()+1500;
 while(true){
  try{return await readNativeSettingsEditor(n,entry,signal);}
  catch(error){if(!['Native Config is not ready','Native Settings editor is not ready'].includes(error.message)||Date.now()>=until)throw error;}
  signal?.throwIfAborted();entry.current();await new Promise(resolve=>setTimeout(resolve,40));
 }
}
async function nativeSettingsEditorOpeners(n,entry){
 const {qh}=await import('/$bunfs/root/chunk-07y7va8x.js');
 const {frame,owner}=nativeSettingsConfig(n,entry);if(frame.panel.hidden)throw Error('Native Config editor is unavailable');
 const owners=[owner];
 const nodes=[owners[0]],fibers=new Set(),elements=new Set(),openers=new Map();
 while(nodes.length){
  const item=nodes.pop();if(!item||typeof item!=='object')continue;
  if(fibers.size+elements.size>=8192)throw Error('Native Config elements exceeded bound');
  if(Array.isArray(item)){if(elements.has(item))continue;elements.add(item);nodes.push(...item);continue;}
  if(Object.hasOwn(item,'memoizedProps')){
   if(fibers.has(item))continue;fibers.add(item);nodes.push(item.memoizedProps?.children);if(item.child)nodes.push(item.child);if(item!==owners[0]&&item.sibling)nodes.push(item.sibling);continue;
  }
  if(elements.has(item))continue;elements.add(item);
  if(item.type===qh.Field&&typeof item.key==='string'){
   const control=item.props?.children;
   if(control&&!control.props?.disabled&&(control.type===qh.Button||control.type===qh.Link)){
    const callback=control.type===qh.Button?control.props?.onPress:control.props?.onOpen;
    if(typeof callback==='function'){
     if(openers.has(item.key)&&openers.get(item.key).callback!==callback)throw Error('Native Config editor is ambiguous');
     openers.set(item.key,{callback,label:item.props?.label});
    }
   }
  }
  nodes.push(item.props?.children);
 }
 entry.current();const current=nativeSettingsFrame(n,entry);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,frame.owner)||current.panel!==frame.panel)throw Error('Native Config owner changed');
 return {owner:owners[0],openers};
}
async function activateNativeSettingsEditor(n,entry,key,visibleKeys,signal){
 signal?.throwIfAborted();
 if(typeof key!=='string'||!visibleKeys.has(key))throw Error('Native setting is no longer visible');
 const before=await nativeSettingsEditorOpeners(n,entry),candidate=before.openers.get(key);
 if(!candidate)throw Error('Native setting has no available editor');
 const current=await nativeSettingsEditorOpeners(n,entry);
 signal?.throwIfAborted();entry.current();
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,before.owner)||current.openers.get(key)?.callback!==candidate.callback)throw Error('Native Config editor changed before opening');
 // The original row callback owns locks, consent and editor selection. Never call a row writer here.
 return await awaitNativeSettingsReading(candidate.callback(),signal);
}
async function readNativeSettingsEditor(n,entry,signal){
 signal?.throwIfAborted();const {frame,owner}=nativeSettingsConfig(n,entry);
 if(!frame.panel.hidden)return;
 const hashes={choice:['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'],form:['7fa52a5f24b4241caf7eca5d99985519e0a485aab0f347cc323ba1a92f3ffa0c','e2474315a210faf7b3cbaab9c4b40793486c2f19ed4b0a997e16fede82b933b4']};
 const pending=[owner.child],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Settings editor traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'){
   const hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');
   let kind=Object.keys(hashes).find(key=>hashes[key].includes(hash));if(['7a75ef860f505658cc6d6bf1c39bd26ab265f7849ec6e6e25a693cd147a89270','5086145442ea1552b1fcb76267a376e9e083bf0056bf30262bba2eda09408bcf'].includes(hash))kind='outputStyle';if(kind)matches.push({kind,fiber,props:fiber.memoizedProps});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length===0)throw Error('Native Settings editor is not ready');
 if(matches.length!==1)throw Error('Native Settings editor is not uniquely supported');
 const match=matches[0],p=match.props;let controls=p,cancelFiber,cancelProps;
 if(match.kind==='outputStyle'){
  const caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===15);
  const consumer=caches?.length===1?caches[0][9]?.props?.children?.[1]?.props?.children?.props:undefined;
  if(!consumer||consumer.styleOptionsPromise!==caches[0][7]||consumer.onComplete!==p?.onComplete||consumer.initialStyle!==p.initialStyle||typeof p.onComplete!=='function'||typeof p.onCancel!=='function')throw Error('Native output style callbacks changed');
  cancelFiber=match.fiber;cancelProps=p;
  controls={options:await awaitNativeSettingsReading(consumer.styleOptionsPromise,signal),defaultValue:consumer.initialStyle,onChange:p.onComplete,onCancel:p.onCancel};
 }
 if(!controls||typeof controls.onChange!=='function'||typeof controls.onCancel!=='function')throw Error('Native Settings editor callbacks changed');
 const text=async(value)=>{const result=await awaitNativeSettingsReading(nativeGenericPermissionText(n,value),signal);if(typeof result!=='string'||result.length>65536)throw Error('Native Settings editor text exceeded bound');return result;};
 let snapshot;
 if(match.kind==='choice'||match.kind==='outputStyle'){
  if(!Array.isArray(controls.options)||controls.options.length>256)throw Error('Native Settings editor option limit exceeded');
  const options=[],values=new Set();
  for(const option of controls.options){
   if(option.type==='input'||typeof option.value!=='string'||option.value.length>16384||values.has(option.value))throw Error('Native Settings editor option changed');values.add(option.value);
   options.push({value:option.value,label:await text(option.label),...option.description!=null?{description:await text(option.description)}:{},disabled:option.disabled===true});
  }
  const value=controls.selectedValue??controls.defaultValue;
  if(value!==undefined&&typeof value!=='string')throw Error('Native Settings editor selection changed');
  snapshot={kind:'choice',...typeof entry.settingsEditorLabel==='string'?{title:entry.settingsEditorLabel}:{},options,...typeof value==='string'?{value}:{},disabled:controls.isDisabled===true||controls.disableSelection===true||!!controls.refuseInput};
 }else{
  if(!Array.isArray(p.fields)||p.fields.length>64||typeof p.onSubmit!=='function'||!p.values||typeof p.values!=='object')throw Error('Native Settings form changed');
  const fields=[],keys=new Set();
  for(const field of p.fields){
   if(field.type!=='text'||typeof field.key!=='string'||field.key.length>4096||keys.has(field.key)||typeof p.values[field.key]!=='string'||p.values[field.key].length>16384)throw Error('Native Settings form field is unsupported');keys.add(field.key);
   fields.push({key:field.key,label:await text(field.label),value:p.values[field.key]});
  }
  snapshot={kind:'form',title:await text(p.title),...p.subtitle?{description:await text(p.subtitle)}:{},submitLabel:await text(p.submitLabel??'Save'),fields};
 }
 signal?.throwIfAborted();entry.current();const current=nativeSettingsConfig(n,entry);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,owner)||current.frame.panel!==frame.panel||currentNativeSettingsFiber(current.owner,match.fiber).memoizedProps!==p||cancelFiber&&currentNativeSettingsFiber(current.owner,cancelFiber).memoizedProps!==cancelProps)throw Error('Native Settings editor changed while reading');
 return {snapshot,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),owner:current.owner,fiber:currentNativeSettingsFiber(current.owner,match.fiber),props:p,actions:controls,cancelProps};
}
async function actNativeSettingsEditor(n,entry,request,signal){
 const before=await readNativeSettingsEditor(n,entry,signal);
 if(!before||before.revision!==request.revision)throw Error('Native Settings editor changed; refresh before editing');
 const p=before.props,actions=before.actions;let callback,args=[],validationProblem;
 if(request.action==='cancel')callback=actions.onCancel;
 else if(request.action==='select'&&before.snapshot.kind==='choice'){
  const option=before.snapshot.options.find(option=>option.value===request.value);
  if(before.snapshot.disabled||!option||option.disabled)throw Error('Native Settings choice is unavailable');
  callback=actions.onChange;args=[option.value];
 }else if(request.action==='change'&&before.snapshot.kind==='form'){
  if(!before.snapshot.fields.some(field=>field.key===request.key)||typeof request.value!=='string'||request.value.length>16384)throw Error('Native Settings form change is invalid');
  callback=p.onChange;args=[request.key,request.value];
 }else if(request.action==='submit'&&before.snapshot.kind==='form'){
  for(const field of p.fields){
   if(typeof field.validate!=='function')continue;
   const problem=await awaitNativeSettingsReading(field.validate(p.values[field.key]),signal);
   if(typeof problem==='string'){if(problem.length>16384)throw Error('Native Settings validation exceeded bound');validationProblem=problem;break;}
   if(problem!==undefined&&problem!==null)throw Error('Native Settings validation contract changed');
  }
  callback=p.onSubmit;
 }else throw Error('Native Settings editor action is unavailable');
 const current=await readNativeSettingsEditor(n,entry,signal);
 signal?.throwIfAborted();entry.current();
 if(entry.closed||entry.answered||!current||!sameNativeSettingsFiber(current.owner,before.owner)||!sameNativeSettingsFiber(current.fiber,before.fiber)||current.props!==p||current.cancelProps!==before.cancelProps||current.revision!==before.revision)throw Error('Native Settings editor changed before action');
 if(validationProblem!==undefined)return {problem:validationProblem};
 await awaitNativeSettingsReading(callback(...args),signal);
 return {};
}
async function saveNativeSettingsEditor(n,entry,revision,values,signal){
 let current=await readNativeSettingsEditor(n,entry,signal);
 if(!current||current.revision!==revision||current.snapshot.kind!=='form')throw Error('Native Settings form changed; refresh before saving');
 const fields=current.snapshot.fields,keys=new Set(fields.map(field=>field.key)),owner=current.owner;
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==keys.size||Object.keys(values).some(key=>!keys.has(key)))throw Error('Native Settings form values changed');
 for(const field of fields){
  const value=values[field.key];if(typeof value!=='string'||value.length>16384)throw Error('Native Settings form value is invalid');
 }
 for(const field of fields){
  const value=values[field.key];if(current.snapshot.fields.find(item=>item.key===field.key)?.value===value)continue;
  await actNativeSettingsEditor(n,entry,{action:'change',revision:current.revision,key:field.key,value},signal);
  const until=Date.now()+1500;
  while(true){
   signal?.throwIfAborted();entry.current();current=await readNativeSettingsEditor(n,entry,signal);
   if(!current||!sameNativeSettingsFiber(current.owner,owner)||current.snapshot.kind!=='form')throw Error('Native Settings form replaced while editing');
   if(current.snapshot.fields.find(item=>item.key===field.key)?.value===value)break;
   if(Date.now()>=until)throw Error('Native Settings form did not acknowledge its draft');
   await new Promise(resolve=>setTimeout(resolve,40));
  }
 }
 return await actNativeSettingsEditor(n,entry,{action:'submit',revision:current.revision},signal);
}
`
