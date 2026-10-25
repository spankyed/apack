/** Read grouped Config controls from the original mounted view; never synthesize row admission. */
export const claudeTerminalSettingsGroupRuntime = String.raw`
async function readNativeSettingsGroup(n,entry,signal){
 signal?.throwIfAborted();
 const key=entry.settingsEditorKey;
 if(!['agentsView','notifChannel'].includes(key))return;
 const {frame,owner}=nativeSettingsConfig(n,entry);
 if(!frame.panel.hidden)return;
 const {qh}=await import('/$bunfs/root/chunk-07y7va8x.js');
 const {Se}=await import('/$bunfs/root/chunk-35cyt9ex.js');
 const fibers=[owner.child],seen=new Set(),groups=[],notifications=[];
 while(fibers.length){
  const fiber=fibers.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Settings group traversal exceeded bound');seen.add(fiber);
  if(key==='notifChannel'&&typeof fiber.type==='function'){
   const hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');
   if(['9846f32a337e1d0f1f360570d69e06e6fec1dcbe165d3ad884b8223acd8f35e3','dc69f6b8da2820e90db5876a9b0dac418417f9833f4280b1ec91ef4bb84757e2'].includes(hash))notifications.push(fiber);
  }
  if(fiber.type===Se&&fiber.memoizedProps?.title===(key==='agentsView'?'Agents view':'Notifications'))groups.push(fiber);
  if(fiber.sibling)fibers.push(fiber.sibling);if(fiber.child)fibers.push(fiber.child);
 }
 if(groups.length!==1||key==='notifChannel'&&notifications.length!==1)throw Error('Native Settings group is not uniquely supported');
 const fiber=groups[0],props=fiber.memoizedProps,notificationProps=notifications[0]?.memoizedProps;
 if(typeof props.onCancel!=='function')throw Error('Native Settings group close changed');
 if(key==='notifChannel'){
  const parent=notifications[0],p=parent.memoizedProps;
  currentNativeSettingsFiber(parent,fiber);
  if(p.onClose!==props.onCancel)throw Error('Native Notifications owner changed');
 }
 const nodes=[props.children],elements=new Set(),rows=[],actions=new Map();
 while(nodes.length){
  const item=nodes.pop();if(!item||typeof item!=='object'||elements.has(item))continue;
  if(elements.size>=8192)throw Error('Native Settings group elements exceeded bound');elements.add(item);
  if(Array.isArray(item)){for(let i=item.length-1;i>=0;i--)nodes.push(item[i]);continue;}
  if(item.type===qh.Field){
   const control=item.props?.children,p=control?.props;
   if(!p||typeof p.onChange!=='function'||!['string','object'].includes(typeof item.props.label))throw Error('Native Settings group field changed');
   const id=typeof item.key==='string'?item.key:String(rows.length),label=await awaitNativeSettingsReading(nativeGenericPermissionText(n,item.props.label),signal);
   if(typeof label!=='string'||label.length>65536||actions.has(id)||rows.length>=64)throw Error('Native Settings group field exceeded bound');
   let row;
   if(control.type===qh.Toggle&&typeof p.value==='boolean')row={key:id,label,kind:'boolean',value:p.value,disabled:p.disabled===true};
   else if(control.type===qh.Select&&typeof p.value==='string'&&Array.isArray(p.options)&&p.options.length<=256){
    const options=[],values=new Set();
    for(const option of p.options){
     if(!option||typeof option.value!=='string'||option.value.length>16384||values.has(option.value))throw Error('Native Settings group option changed');values.add(option.value);
     const text=await awaitNativeSettingsReading(nativeGenericPermissionText(n,option.label),signal);
     if(typeof text!=='string'||text.length>65536)throw Error('Native Settings group option exceeded bound');
     options.push({value:option.value,label:text,disabled:option.disabled===true});
    }
    row={key:id,label,kind:'choice',value:p.value,disabled:p.disabled===true,options};
   }else throw Error('Native Settings group control changed');
   rows.push(row);actions.set(id,{element:item,control,props:p,callback:p.onChange});continue;
  }
  nodes.push(item.props?.children);
 }
 signal?.throwIfAborted();entry.current();
 const current=nativeSettingsConfig(n,entry);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,owner)||current.frame.panel!==frame.panel||currentNativeSettingsFiber(current.owner,fiber).memoizedProps!==props||key==='notifChannel'&&currentNativeSettingsFiber(current.owner,notifications[0]).memoizedProps!==notificationProps)throw Error('Native Settings group changed while reading');
 const snapshot={kind:'group',title:props.title,rows};
 return {snapshot,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),owner,fiber,props,actions,onCancel:props.onCancel};
}
`
