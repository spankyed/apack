/** Project the original Config update dialogs; native callbacks own channel/version decisions. */
export const claudeTerminalSettingsUpdateRuntime = String.raw`
async function readNativeSettingsUpdate(n,entry,signal){
 if(entry.settingsEditorKey!=='autoUpdatesChannel')throw Error('Native update editor is unavailable');
 signal?.throwIfAborted();const {frame,owner}=nativeSettingsConfig(n,entry);
 if(!frame.panel.hidden)return;
 const {Se}=await import('/$bunfs/root/chunk-35cyt9ex.js'),{Xe,Fi}=await import('/$bunfs/root/chunk-0d2czwx3.js');
 const pending=[owner.child],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native update dialog traversal exceeded bound');seen.add(fiber);
  if(fiber.type===Se&&['Enable Auto-Updates','Switch to Stable Channel'].includes(fiber.memoizedProps?.title))matches.push(fiber);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length===0)throw Error('Native Settings editor is not ready');
 if(matches.length!==1)throw Error('Native update dialog is ambiguous');
 const fiber=matches[0],p=fiber.memoizedProps,originalChildren=p.children,originalCancel=p.onCancel;
 if(typeof p.onCancel!=='function')throw Error('Native update dialog cancellation changed');
 const nodes=[p.children],elements=new Set(),choices=[],description=[];
 while(nodes.length){
  const item=nodes.pop();if(item===undefined||item===null||item===false)continue;
  if(elements.size>=256)throw Error('Native update dialog elements exceeded bound');
  if(typeof item==='object'){
   if(elements.has(item))throw Error('Native update dialog elements are ambiguous');elements.add(item);
   if(Array.isArray(item)){if(item.length>256)throw Error('Native update dialog elements exceeded bound');for(let i=item.length-1;i>=0;i--)nodes.push(item[i]);continue;}
   if(item.type===Symbol.for('react.fragment')){nodes.push(item.props?.children);continue;}
   if(item.type===Xe){choices.push(item);continue;}
  }
  description.push(item);
 }
 if(choices.length>1||p.title==='Switch to Stable Channel'&&choices.length!==1)throw Error('Native update choices changed');
 const text=async value=>{const result=await awaitNativeSettingsReading(nativeGenericPermissionText(n,value),signal);if(typeof result!=='string'||result.length>65536)throw Error('Native update text exceeded bound');return result;};
 const detail=await text(description),choice=choices[0],control=choice?.props;let snapshot,actions={onCancel:p.onCancel};
 if(choice){
  if(!Array.isArray(control.options)||control.options.length>256||typeof control.onChange!=='function')throw Error('Native update picker changed');
  const options=[],values=new Set();
  for(const option of control.options){
   if(!option||typeof option.value!=='string'||option.value.length>16384||values.has(option.value)||option.type==='input')throw Error('Native update option changed');values.add(option.value);
   options.push({value:option.value,label:await text(option.label),...option.description!==undefined?{description:await text(option.description)}:{},disabled:option.disabled===true});
  }
  const value=control.selectedValue===Fi?control.defaultValue:control.selectedValue??control.defaultValue;
  if(value!==undefined&&typeof value!=='string')throw Error('Native update selection changed');
  snapshot={kind:'choice',title:p.title,...detail?{description:detail}:{},options,disabled:control.isDisabled===true||control.disableSelection===true||!!control.refuseInput,...typeof value==='string'?{value}:{}};
  actions={...control,onCancel:p.onCancel};
 }else{
  if(!detail)throw Error('Native update explanation is absent');
  snapshot={kind:'information',title:p.title,description:detail};
 }
 signal?.throwIfAborted();entry.current();const current=nativeSettingsConfig(n,entry);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,owner)||current.frame.panel!==frame.panel||currentNativeSettingsFiber(current.owner,fiber).memoizedProps!==p||p.children!==originalChildren||p.onCancel!==originalCancel||choice&&choice.props!==control)throw Error('Native update dialog changed while reading');
 return {snapshot,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),owner:current.owner,fiber:currentNativeSettingsFiber(current.owner,fiber),props:p,actions,updateChoice:choice};
}
`
