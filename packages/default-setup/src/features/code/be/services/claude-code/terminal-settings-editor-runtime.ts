import { claudeTerminalSettingsModelRuntime } from './terminal-settings-model-runtime.ts'

/** Project only original Config editor-opening controls from its owned element tree. */
export const claudeTerminalSettingsEditorRuntime = String.raw`
${claudeTerminalSettingsModelRuntime}
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
 const hashes={model:['cc13401c36b04a99e33d816a7f89fa08eaad44657a2933747d41c1b839be8451','c0cf4bcdab4f51bf2da39b356899e179c0a8f40f309822461c09d46c4a0e7040'],theme:['0333a3f408c68ec72bd8c5d0777f46e5e145c460013adb5a0ff665bbf7162ae7','b9f5ab35590945b214b817f84d10a4cb1469872f52ab96cc93f8a47613b31987'],language:['080eee2fde8fe097c91811244a1dc193b139c7df65f12765827c4117230eace6','4251c8f399ee8c6b3dfe922dfa46ef8adfa3e34dc8de1d52aec1b1aaa617b3e9'],choice:['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'],form:['7fa52a5f24b4241caf7eca5d99985519e0a485aab0f347cc323ba1a92f3ffa0c','e2474315a210faf7b3cbaab9c4b40793486c2f19ed4b0a997e16fede82b933b4']};
 const pending=[owner.child],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Settings editor traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'){
   const hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');
   let kind=Object.keys(hashes).find(key=>hashes[key].includes(hash));if(['7a75ef860f505658cc6d6bf1c39bd26ab265f7849ec6e6e25a693cd147a89270','5086145442ea1552b1fcb76267a376e9e083bf0056bf30262bba2eda09408bcf'].includes(hash))kind='outputStyle';if(kind){matches.push({kind,fiber,props:fiber.memoizedProps});if(kind==='model'){if(fiber.sibling)pending.push(fiber.sibling);continue;}}
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length===0)throw Error('Native Settings editor is not ready');
 if(matches.length!==1)throw Error('Native Settings editor is not uniquely supported');
 const match=matches[0],p=match.props;let controls=p,cancelFiber,cancelProps,languageInput,themeCache,modelControl;
 if(match.kind==='outputStyle'){
  const caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===15);
  const consumer=caches?.length===1?caches[0][9]?.props?.children?.[1]?.props?.children?.props:undefined;
  if(!consumer||consumer.styleOptionsPromise!==caches[0][7]||consumer.onComplete!==p?.onComplete||consumer.initialStyle!==p.initialStyle||typeof p.onComplete!=='function'||typeof p.onCancel!=='function')throw Error('Native output style callbacks changed');
  cancelFiber=match.fiber;cancelProps=p;
  controls={options:await awaitNativeSettingsReading(consumer.styleOptionsPromise,signal),defaultValue:consumer.initialStyle,onChange:p.onComplete,onCancel:p.onCancel};
 }
 if(match.kind==='model'){modelControl=nativeSettingsModelControl(match);controls={...modelControl.controls,onCancel:p.onCancel};}
 if(match.kind==='theme'){
  const caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===109);
  const cache=caches?.length===1?caches[0]:undefined,picker=cache?.[72]?.props;
  if(!cache||!picker||p.skipExitHandling!==true||p.onCustomTheme!==undefined||cache[61]!==p.onThemeSelect||cache[14]!==p.onCancel||cache[62]!==cache[30]||cache[56]!==cache[30]||picker.onFocus!==cache[57]||picker.onSelect!==cache[63]||typeof cache[57]!=='function'||typeof cache[63]!=='function'||typeof cache[15]!=='function'||typeof cache[11]!=='function'||typeof cache[54]!=='string'||typeof cache[65]!=='string')throw Error('Native Theme picker callbacks changed');
  themeCache={cache,options:cache[30],preview:cache[54],value:cache[65],picker:cache[72],sample:cache[84],cancel:cache[15],toggle:cache[11]};
  controls={options:cache[30],selectedValue:cache[65],onChange:value=>cache[63](themeCache.options.findIndex(option=>option.value===value)),onPreview:value=>cache[57](themeCache.options.findIndex(option=>option.value===value)),onToggle:cache[0]===null?cache[11]:undefined,onCancel:cache[15]};
 }
 if(match.kind==='language'){
  const caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===13);
  const cache=caches?.length===1?caches[0]:undefined,input=cache?.[9]?.props?.children?.[1]?.props;
  if(!input||cache[2]!==p.onComplete||cache[3]!==input.onSubmit||cache[7]!==input.onSubmit||cache[8]!==input.value||typeof input.value!=='string'||typeof input.onChange!=='function'||typeof input.onSubmit!=='function'||typeof p.onCancel!=='function')throw Error('Native Language input callbacks changed');
  languageInput=input;
  controls={title:entry.settingsEditorLabel??'Language',subtitle:cache[10]?.props?.children,fields:[{type:'text',key:'language',label:cache[4]?.props?.children}],values:{language:input.value},onChange:(_key,value)=>input.onChange(value),onSubmit:input.onSubmit,onCancel:p.onCancel};
 }
 if(!controls||typeof controls.onChange!=='function'||typeof controls.onCancel!=='function')throw Error('Native Settings editor callbacks changed');
 const text=async(value)=>{const result=await awaitNativeSettingsReading(nativeGenericPermissionText(n,value),signal);if(typeof result!=='string'||result.length>65536)throw Error('Native Settings editor text exceeded bound');return result;};
 let snapshot;
 if(match.kind==='choice'||match.kind==='outputStyle'||match.kind==='theme'||match.kind==='model'){
  if(!Array.isArray(controls.options)||controls.options.length>256)throw Error('Native Settings editor option limit exceeded');
  const options=[],values=new Set();
  for(const option of controls.options){
   if(option.type==='input'||typeof option.value!=='string'||option.value.length>16384||values.has(option.value))throw Error('Native Settings editor option changed');values.add(option.value);
   options.push({value:option.value,label:await text(option.label),...(option.description??(themeCache?option.origin:undefined))!=null?{description:await text(option.description??option.origin)}:{},disabled:option.disabled===true,...modelControl&&option.description!=null?{descriptionAnsi:await awaitNativeSettingsReading(nativeGenericPermissionText(n,option.description,true),signal)}:{}});
   if(options.at(-1).descriptionAnsi?.length>65536)throw Error('Native Model description exceeded bound');
  }
  const value=controls.selectedValue??controls.defaultValue;
  if(value!==undefined&&typeof value!=='string')throw Error('Native Settings editor selection changed');
  snapshot={kind:'choice',...typeof entry.settingsEditorLabel==='string'?{title:entry.settingsEditorLabel}:{},options,...typeof value==='string'?{value}:{},disabled:controls.isDisabled===true||controls.disableSelection===true||!!controls.refuseInput};
  if(modelControl)snapshot.model={...modelControl.focusValue!==undefined?{focusValue:modelControl.focusValue}:{},description:await text(modelControl.description),effortText:await text(modelControl.detail),canAdjustEffort:modelControl.canAdjust,...modelControl.fastNotice?{fastModeNotice:await text(modelControl.fastNotice)}:{}};
  if(themeCache){const lines=themeCache.cache[77]?.lines;if(!Array.isArray(lines)||lines.length>256||lines.some(line=>typeof line!=='string'||line.length>16384||line.includes('\n')||![' ','+','-'].includes(line[0])))throw Error('Native Theme sample changed');const palette=nativeThemePalette(n);themeCache.palette=JSON.stringify(palette);const detail=await awaitNativeSettingsReading(nativeGenericPermissionDetail(n,'Theme preview',themeCache.sample),signal);if(typeof palette.text!=='string'||typeof palette.inverseText!=='string')throw Error('Native Theme preview palette changed');snapshot.preview={theme:{text:palette.text,inverseText:palette.inverseText},text:detail.value,...detail.ansi!==undefined?{ansi:detail.ansi}:{},lines:[...lines],caption:await text(themeCache.cache[81])};snapshot.previewValue=themeCache.preview;snapshot.canPreview=true;snapshot.canToggleSyntax=typeof controls.onToggle==='function';}
 }else{
  if(!Array.isArray(controls.fields)||controls.fields.length>64||typeof controls.onSubmit!=='function'||!controls.values||typeof controls.values!=='object')throw Error('Native Settings form changed');
  const fields=[],keys=new Set();
  for(const field of controls.fields){
   if(field.type!=='text'||typeof field.key!=='string'||field.key.length>4096||keys.has(field.key)||typeof controls.values[field.key]!=='string'||controls.values[field.key].length>16384)throw Error('Native Settings form field is unsupported');keys.add(field.key);
   fields.push({key:field.key,label:await text(field.label),value:controls.values[field.key]});
  }
  snapshot={kind:'form',title:await text(controls.title),...controls.subtitle?{description:await text(controls.subtitle)}:{},submitLabel:await text(controls.submitLabel??'Save'),fields};
 }
 if(themeCache&&(JSON.stringify(nativeThemePalette(n))!==themeCache.palette||themeCache.cache[30]!==themeCache.options||themeCache.cache[54]!==themeCache.preview||themeCache.cache[65]!==themeCache.value||themeCache.cache[72]!==themeCache.picker||themeCache.cache[84]!==themeCache.sample||themeCache.cache[15]!==themeCache.cancel||themeCache.cache[11]!==themeCache.toggle))throw Error('Native Theme changed while reading');
 signal?.throwIfAborted();entry.current();const current=nativeSettingsConfig(n,entry);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,owner)||current.frame.panel!==frame.panel||currentNativeSettingsFiber(current.owner,match.fiber).memoizedProps!==p||modelControl&&currentNativeSettingsFiber(current.owner,match.fiber).child?.memoizedProps!==modelControl.root||themeCache&&currentNativeSettingsFiber(current.owner,match.fiber).updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===109)?.[0]!==themeCache.cache||languageInput&&currentNativeSettingsFiber(current.owner,match.fiber).updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===13)?.[0]?.[9]?.props?.children?.[1]?.props!==languageInput||cancelFiber&&currentNativeSettingsFiber(current.owner,cancelFiber).memoizedProps!==cancelProps)throw Error('Native Settings editor changed while reading');
 return {snapshot,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),owner:current.owner,fiber:currentNativeSettingsFiber(current.owner,match.fiber),props:p,actions:controls,cancelProps,languageInput,themeCache,modelControl};
}
async function actNativeSettingsEditor(n,entry,request,signal){
 const before=await readNativeSettingsEditor(n,entry,signal);
 if(!before||before.revision!==request.revision)throw Error('Native Settings editor changed; refresh before editing');
 const p=before.props,actions=before.actions;let callback,args=[],validationProblem;
 if(request.action==='cancel')callback=actions.onCancel;
 else if(['select','preview','focusModel'].includes(request.action)&&before.snapshot.kind==='choice'){
  const option=before.snapshot.options.find(option=>option.value===request.value);
  if(before.snapshot.disabled||!option||option.disabled)throw Error('Native Settings choice is unavailable');
  callback=request.action==='focusModel'?before.modelControl?.controls.onFocus:request.action==='preview'?actions.onPreview:actions.onChange;if(typeof callback!=='function')throw Error('Native Settings preview is unavailable');args=[option.value];
 }else if(request.action==='adjustEffort'&&before.snapshot.model?.canAdjustEffort&&['left','right'].includes(request.direction)){
  callback=before.modelControl.adjust;args=[request.direction];
 }else if(request.action==='toggleSyntax'&&before.snapshot.kind==='choice'&&before.snapshot.canToggleSyntax){
  callback=actions.onToggle;
 }else if(request.action==='change'&&before.snapshot.kind==='form'){
  if(!before.snapshot.fields.some(field=>field.key===request.key)||typeof request.value!=='string'||request.value.length>16384)throw Error('Native Settings form change is invalid');
  callback=actions.onChange;args=[request.key,request.value];
 }else if(request.action==='submit'&&before.snapshot.kind==='form'){
  for(const field of actions.fields){
   if(typeof field.validate!=='function')continue;
   const problem=await awaitNativeSettingsReading(field.validate(actions.values[field.key]),signal);
   if(typeof problem==='string'){if(problem.length>16384)throw Error('Native Settings validation exceeded bound');validationProblem=problem;break;}
   if(problem!==undefined&&problem!==null)throw Error('Native Settings validation contract changed');
  }
  callback=actions.onSubmit;
 }else throw Error('Native Settings editor action is unavailable');
 const current=await readNativeSettingsEditor(n,entry,signal);
 signal?.throwIfAborted();entry.current();
 if(entry.closed||entry.answered||!current||!sameNativeSettingsFiber(current.owner,before.owner)||!sameNativeSettingsFiber(current.fiber,before.fiber)||current.props!==p||current.cancelProps!==before.cancelProps||current.languageInput!==before.languageInput||before.modelControl&&(current.modelControl?.root!==before.modelControl.root||current.modelControl?.controls!==before.modelControl.controls||current.modelControl?.adjust!==before.modelControl.adjust)||before.themeCache&&(current.themeCache?.picker!==before.themeCache.picker||current.themeCache?.sample!==before.themeCache.sample||current.themeCache?.cancel!==before.themeCache.cancel||current.themeCache?.toggle!==before.themeCache.toggle)||current.revision!==before.revision)throw Error('Native Settings editor changed before action');
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
