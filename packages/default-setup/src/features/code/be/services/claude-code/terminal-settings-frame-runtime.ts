/** Correlate the original Settings tree to its owned local-JSX dialog before using callbacks. */
export const claudeTerminalSettingsFrameRuntime = String.raw`
function nativeSettingsFrame(n,entry){
 entry.current();
 if(entry.closed||entry.answered||!entry.originalProps||typeof entry.originalProps.onClose!=='function')throw Error('Native Settings frame expired');
 const hashes={
  frame:['50d817c838179e7eb8d6ce44d64db75544aa713210f62fc5892691a00f498615','8a56a17e7c83ad4879b026f7d8498fb45fea80c549f97547bcfdb4ef3b9725ee'],
  status:['7b371fd2243d1b95fd31ce55c7de6550de8b106f8067fd92cde73dff232a6c6b','8c89bb757b28a8a05a69fdc7d3beebb9b5bd02e74fc0bf54a238dc7b1921cf29'],
  loader:['e54f96f2b6cd3713f3f20e9bade68a31bf107725441bc42aaa2dfd4b13d8b021','dea182e69c551bbf30ca8dc15dbbd4ce008db3150028451a40b64fff5d53282a'],
  overview:['33a5a00834bcbb04d57467449df7d6714daad5bc891700b415a029d0bca890ef','c5b3f64e5af1267c75634025ba8c60e8b06fe422e02a157926deb0dc9af555d6'],
  models:['e6832f441d81959a9bbc554b7a3cd588d4ae34171a83ab16ca5f4441839ef320','81b82bfee5a2b4a365261e1814815ed043c073b29370102ddbf1522a8bdcd1d1'],
 };
 function checked(fiber,kind){
  let hash=composerFunctionHashes.get(fiber.type);
  if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
  if(!hashes[kind].includes(hash))throw Error('Native Settings '+kind+' producer changed');
 }
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),owners=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native Settings traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.memoizedProps?.onClose===entry.originalProps.onClose&&Object.hasOwn(fiber.memoizedProps,'credentials')&&Object.hasOwn(fiber.memoizedProps,'messages')){checked(fiber,'frame');owners.push(fiber);}
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(owners.length!==1)throw Error('Native Settings frame is not uniquely mounted');
 const children=[owners[0].child],visited=new Set(),tabs=[],status=[],loaders=[],stats=[];
 while(children.length){
  const fiber=children.pop();if(!fiber||visited.has(fiber))continue;
  if(visited.size>=4096)throw Error('Native Settings frame exceeded bound');visited.add(fiber);
  const p=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&p){
   if(p.title==='Settings'&&typeof p.onTabChange==='function')tabs.push(p);
   if(Object.hasOwn(p,'accountStatusRead')&&Object.hasOwn(p,'machineStatusRead')){checked(fiber,'status');status.push(fiber);}
   if(p.allTimePromise&&p.activeTimePromise){checked(fiber,'loader');loaders.push(fiber);}
   if(p.stats?.modelUsage){checked(fiber,Object.hasOwn(p,'allTimeStats')?'overview':'models');stats.push(fiber);}
  }
  // Do not visit the owner's siblings: a second dialog must never supply this frame's data.
  if(fiber.sibling)children.push(fiber.sibling);if(fiber.child)children.push(fiber.child);
 }
 if(tabs.length!==1||status.length>1||loaders.length>1||stats.length>1)throw Error('Native Settings controls are ambiguous');
 const panel=tabs[0],titles=(Array.isArray(panel.children)?panel.children:[panel.children]).map(child=>child?.props?.title);
 if(JSON.stringify(titles)!==JSON.stringify(['Status','Config','Usage','Stats'])||!titles.includes(panel.selectedTab)||typeof panel.hidden!=='boolean')throw Error('Native Settings tab contract changed');
 entry.current();if(entry.closed||entry.answered)throw Error('Native Settings frame expired');
 return {owner:owners[0],panel,status:status[0],loader:loaders[0],stats:stats[0]};
}
`
