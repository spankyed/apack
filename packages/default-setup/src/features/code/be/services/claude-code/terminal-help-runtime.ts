/** Read original Help content and invoke only callbacks belonging to its mounted dialog. */
export const claudeTerminalHelpRuntime = String.raw`
function nativeHelpFrame(n,entry){
 entry.current();if(entry.closed||entry.answered)throw Error('Native Help expired');
 const hashes={owner:['0213a1edea00aa0432c363c9a0e878160305d7586b51b8944e2edfc7967bfd7c','070e5819763820f34cc9ad3f553c8e6551f01bb3bf939145a8d7253c4be7acb5'],wrapper:['9848f88d74e42a102b8cbdced12d71e71c6e56ef1c84fd8c58ab8aa0898e707d','a2ed848a66ba4a3055694ea64f27b7f1b126f093b0b13c9c56f98c72d41a242c'],list:['0f320d22293cf6a9efcd7b1b853d73882db9f67b3901c4aed6d915c26d9a9936','2769c59607086f715df3b4d768ee939feb9ecd289d35dcde4971ac6727494ad7']};
 function digest(fiber){if(typeof fiber.type!=='function')return;let value=composerFunctionHashes.get(fiber.type);if(!value){value=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,value);}return value;}
 function visit(root,callback){const pending=[root],seen=new Set();while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native Help traversal exceeded bound');seen.add(fiber);callback(fiber);if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);}}
 const owners=[];visit(n.themeRoots.ai().get(process.stdout)?.container?.current,fiber=>{if(fiber.memoizedProps?.onClose===entry.originalProps.onClose&&fiber.memoizedProps?.commands===entry.originalProps.commands&&hashes.owner.includes(digest(fiber)))owners.push(fiber)});
 if(owners.length!==1)throw Error('Native Help is not uniquely mounted');
 const wrappers=[];visit(owners[0].child,fiber=>{if(fiber.memoizedProps?.title==='Help'&&hashes.wrapper.includes(digest(fiber)))wrappers.push(fiber)});
 if(wrappers.length!==1)throw Error('Native Help tabs changed');
 const tabs=[],bodies=[],lists=[];visit(wrappers[0].child,fiber=>{
  const p=fiber.memoizedProps;if(!p)return;
  if(['General','Commands','Custom commands'].includes(p.title)&&typeof p.isCurrent==='boolean'&&typeof p.onClick==='function')tabs.push(p);
  if(['general','commands','custom'].includes(p.id)&&p.children)bodies.push(fiber);
  if(hashes.list.includes(digest(fiber)))lists.push(fiber);
 });
 if(JSON.stringify(tabs.map(tab=>tab.title))!==JSON.stringify(['General','Commands','Custom commands'])||tabs.filter(tab=>tab.isCurrent).length!==1)throw Error('Native Help tab controls changed');
 const selected=tabs.find(tab=>tab.isCurrent).title,id={'General':'general','Commands':'commands','Custom commands':'custom'}[selected],body=bodies.filter(fiber=>fiber.memoizedProps.id===id&&fiber.child);
 if(body.length!==1)throw Error('Native Help active content changed');
 const paragraphs=[],links=[];visit(body[0].child,fiber=>{
  if(fiber.tag===6&&typeof fiber.memoizedProps==='string')paragraphs.push(fiber.memoizedProps);
  const p=fiber.memoizedProps;if(typeof p?.url==='string'&&/^https:\/\//.test(p.url)&&!links.includes(p.url))links.push(p.url);
 });
 visit(owners[0].child,fiber=>{const p=fiber.memoizedProps;if(typeof p?.url==='string'&&/^https:\/\//.test(p.url)&&!links.includes(p.url))links.push(p.url)});
 const commands=[];
 if(lists.length>1)throw Error('Native Help command list is ambiguous');
 if(lists.length){const caches=lists[0].updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===13);if(caches?.length!==1||!Array.isArray(caches[0][1]))throw Error('Native Help command descriptions are not ready');for(const row of caches[0][1]){if(typeof row.name!=='string'||typeof row.label!=='string'||typeof row.description!=='string')throw Error('Native Help command row changed');commands.push({name:row.name,label:row.label,description:row.description});}}
 if(commands.length>2048||paragraphs.length>4096||paragraphs.some(text=>text.length>65536)||links.length>32)throw Error('Native Help content exceeded bound');
 const help={selectedTab:selected,tabs:tabs.map(tab=>tab.title),paragraphs,commands,links};
 const revision=createHash('sha256').update(JSON.stringify(help)).digest('hex');
 return {snapshot:{revision,rows:[],help},tabs,owner:owners[0]};
}
function nativeHelpDismissCallback(n,entry){
 const {owner}=nativeHelpFrame(n,entry),caches=owner.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===41);
 if(caches?.length!==1||typeof caches[0][3]!=='function')throw Error('Native Help dismissal changed');return caches[0][3];
}
async function nativeHelpPanel(n,entry,request,abort){
 const before=nativeHelpFrame(n,entry);abort.signal.throwIfAborted();
 if(request.operation==='read')return {snapshot:before.snapshot};
 if(request.operation!=='helpTab'||request.revision!==before.snapshot.revision)throw Error('Native Help changed; refresh before navigating');
 const tab=before.tabs.find(tab=>tab.title===request.tab);if(!tab)throw Error('Native Help tab is unavailable');
 entry.current();tab.onClick();
 for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,25));abort.signal.throwIfAborted();nativeSettingsPanel(request);const after=nativeHelpFrame(n,entry);if(after.snapshot.help.selectedTab===request.tab)return {snapshot:after.snapshot};}
 throw Error('Native Help has not acknowledged navigation');
}
`
