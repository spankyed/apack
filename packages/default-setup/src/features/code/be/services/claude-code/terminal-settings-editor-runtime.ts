/** Project only original Config editor-opening controls from its owned element tree. */
export const claudeTerminalSettingsEditorRuntime = String.raw`
async function nativeSettingsEditorOpeners(n,entry){
 const {qh}=await import('/$bunfs/root/chunk-07y7va8x.js');
 const frame=nativeSettingsFrame(n,entry);
 if(frame.panel.selectedTab!=='Config'||frame.panel.hidden)throw Error('Native Config editor is unavailable');
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
 if(owners.length!==1)throw Error('Native Config is not uniquely mounted');
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
 if(entry.closed||entry.answered||current.owner!==frame.owner||current.panel!==frame.panel)throw Error('Native Config owner changed');
 return {owner:owners[0],openers};
}
async function activateNativeSettingsEditor(n,entry,key,visibleKeys,signal){
 signal?.throwIfAborted();
 if(typeof key!=='string'||!visibleKeys.has(key))throw Error('Native setting is no longer visible');
 const before=await nativeSettingsEditorOpeners(n,entry),candidate=before.openers.get(key);
 if(!candidate)throw Error('Native setting has no available editor');
 const current=await nativeSettingsEditorOpeners(n,entry);
 signal?.throwIfAborted();entry.current();
 if(entry.closed||entry.answered||current.owner!==before.owner||current.openers.get(key)?.callback!==candidate.callback)throw Error('Native Config editor changed before opening');
 // The original row callback owns locks, consent and editor selection. Never call a row writer here.
 return await awaitNativeSettingsReading(candidate.callback(),signal);
}
`
