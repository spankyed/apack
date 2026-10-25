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
 const children=[owners[0].child],visited=new Set(),tabs=[],status=[],loaders=[],stats=[],statsTabs=[];
 while(children.length){
  const fiber=children.pop();if(!fiber||visited.has(fiber))continue;
  if(visited.size>=4096)throw Error('Native Settings frame exceeded bound');visited.add(fiber);
  const p=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&p){
   if(p.title===null&&typeof p.onTabChange==='function'&&['Overview','Models'].includes(p.selectedTab))statsTabs.push(p);
   if(p.title==='Settings'&&typeof p.onTabChange==='function')tabs.push(p);
   if(Object.hasOwn(p,'accountStatusRead')&&Object.hasOwn(p,'machineStatusRead')){checked(fiber,'status');status.push(fiber);}
   if(p.allTimePromise&&p.activeTimePromise){checked(fiber,'loader');loaders.push(fiber);}
   if(p.stats?.modelUsage){checked(fiber,Object.hasOwn(p,'allTimeStats')?'overview':'models');stats.push(fiber);}
  }
  // Do not visit the owner's siblings: a second dialog must never supply this frame's data.
  if(fiber.sibling)children.push(fiber.sibling);if(fiber.child)children.push(fiber.child);
 }
 if(tabs.length!==1||status.length>1||loaders.length>1||stats.length>1||statsTabs.length>1)throw Error('Native Settings controls are ambiguous');
 const panel=tabs[0],titles=(Array.isArray(panel.children)?panel.children:[panel.children]).map(child=>child?.props?.title);
 if(JSON.stringify(titles)!==JSON.stringify(['Status','Config','Usage','Stats'])||!titles.includes(panel.selectedTab)||typeof panel.hidden!=='boolean')throw Error('Native Settings tab contract changed');
 entry.current();if(entry.closed||entry.answered)throw Error('Native Settings frame expired');
 return {owner:owners[0],panel,status:status[0],loader:loaders[0],stats:stats[0],statsTabs:statsTabs[0]};
}
async function awaitNativeSettingsReading(promise,signal){
 signal?.throwIfAborted();let timer,cancel;
 try{return await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('Native Settings reading timed out')),5000);
  cancel=()=>reject(signal.reason??Error('Native Settings reading cancelled'));
  signal?.addEventListener('abort',cancel,{once:true});
  Promise.resolve(promise).then(resolve,reject);
 });}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
async function readNativeSettingsFrameOnce(n,entry,signal){
 signal?.throwIfAborted();
 const source=nativeSettingsFrame(n,entry),panel=source.panel;
 const result={selectedTab:panel.selectedTab,tabs:panel.children.map(child=>child.props.title),hidden:panel.hidden};
 if(source.status){
  const caches=source.status.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===17);
  if(caches?.length!==1||!Array.isArray(caches[0][10]))throw Error('Native Settings Status rows are not ready');
  const groups=caches[0][10];if(groups.length>16)throw Error('Native Settings Status group limit exceeded');
  result.status=[];
  for(const group of groups){
   if(!Array.isArray(group)||group.length>128)throw Error('Native Settings Status row limit exceeded');
   const rows=[];
   for(const row of group){
    signal?.throwIfAborted();entry.current();
    if(typeof row.label!=='string'||row.label.length>16384)throw Error('Native Settings Status label changed');
    const value=await nativeGenericPermissionText(n,typeof row.value==='string'?row.value:n.jsx.e(n.terminalComponents.n,{children:row.value}));
    if(value.length>65536)throw Error('Native Settings Status value exceeded bound');
    rows.push({label:row.label,value});
   }
   result.status.push(rows);
  }
 }
 if(panel.selectedTab==='Usage'){
  // No breakdown argument: the original API only reads its existing ledger, without token-count requests.
  const usage=await awaitNativeSettingsReading(n.runtime.Hco({},'apack native Settings'),signal);
  result.usage={startedAt:usage.startedAt,context:{window:usage.context.window,...(usage.context.tokens!==undefined?{tokens:usage.context.tokens}:{}),...(usage.context.percent!==undefined?{percent:usage.context.percent}:{})},...(usage.cost?{cost:{usd:usage.cost.usd}}:{}),rateLimits:usage.rateLimits.map(row=>({kind:row.kind,percentUsed:row.percentUsed,...(row.resetsAt!==undefined?{resetsAt:row.resetsAt}:{})}))};
 }
 if(panel.selectedTab==='Stats'&&source.loader){
  const outcome=await awaitNativeSettingsReading(source.loader.memoizedProps.allTimePromise,signal);
  const props=source.stats?.memoizedProps;
  if(outcome.type==='success'&&!props)throw Error('Native Settings frame is not ready');
  result.stats={outcome:outcome.type,loading:props?.isLoading===true,...(outcome.type==='error'?{problem:String(outcome.message)}:{}),...(source.statsTabs?{view:source.statsTabs.selectedTab}:{}),...(props?{range:props.selectorRange??props.dateRange??'all'}:{})};
  const loaderCaches=source.loader.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===50);
  if(loaderCaches?.length!==1)throw Error('Native Stats controls changed');
  const copyText=loaderCaches[0][44];
  result.stats.copyState=copyText===' · copying…'?'pending':copyText===' · copied!'?'saved':copyText===' · copy failed'?'error':'idle';
  if(props){
   const data=props.stats;
   result.stats.data={totalSessions:data.totalSessions,totalMessages:data.totalMessages,totalDays:data.totalDays,activeDays:data.activeDays,dailyActivity:data.dailyActivity.map(row=>({date:row.date,messageCount:row.messageCount,sessionCount:row.sessionCount,toolCallCount:row.toolCallCount})),modelUsage:Object.fromEntries(Object.entries(data.modelUsage).map(([model,row])=>[model,{inputTokens:row.inputTokens,outputTokens:row.outputTokens,cacheReadInputTokens:row.cacheReadInputTokens,cacheCreationInputTokens:row.cacheCreationInputTokens,costUSD:row.costUSD}]))};
   const extra=result.stats.data;
   for(const key of ['firstSessionDate','lastSessionDate','peakActivityDay','peakActivityHour'])if(data[key]!==undefined)extra[key]=data[key];
   if(data.streaks)extra.streaks={currentStreak:data.streaks.currentStreak,longestStreak:data.streaks.longestStreak,...Object.fromEntries(['currentStreakStart','longestStreakStart','longestStreakEnd'].filter(key=>data.streaks[key]!==undefined).map(key=>[key,data.streaks[key]]))};
   if(data.longestSession!==undefined)extra.longestSession=data.longestSession===null?null:{sessionId:data.longestSession.sessionId,duration:data.longestSession.duration,messageCount:data.longestSession.messageCount,timestamp:data.longestSession.timestamp};
   if(data.dailyModelTokens)extra.dailyModelTokens=data.dailyModelTokens.map(row=>({date:row.date,tokensByModel:{...row.tokensByModel}}));
   if(outcome.type==='success')extra.allTimeActivity=outcome.data.dailyActivity.map(row=>({date:row.date,messageCount:row.messageCount,sessionCount:row.sessionCount,toolCallCount:row.toolCallCount}));
   if(Object.hasOwn(props,'allTimeStats')){
    const caches=source.stats.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===102);
    if(caches?.length!==1)throw Error('Native Stats Overview producer changed');
    if(typeof caches[0][23]==='string')result.stats.insight=caches[0][23];
    const calendar=caches[0][26]?.props?.children?.props?.children;
    if(calendar!==undefined){
     if(typeof calendar!=='string'||calendar.length>16384)throw Error('Native Stats calendar producer changed');
     result.stats.calendar=stripVTControlCharacters(calendar);
    }
   }

  }
 }
 signal?.throwIfAborted();const current=nativeSettingsFrame(n,entry);
 if(current.owner!==source.owner||current.panel!==source.panel||current.status!==source.status||current.stats!==source.stats||current.loader!==source.loader)throw Error('Native Settings frame changed while reading');
 return result;
}
async function readNativeSettingsFrame(n,entry,signal){
 const until=Date.now()+1500;
 while(true){
  try{return await readNativeSettingsFrameOnce(n,entry,signal);}
  catch(error){
   if(!['Native Settings Status rows are not ready','Native Settings frame is not ready','Native Settings frame changed while reading'].includes(error.message)||Date.now()>=until)throw error;
   signal?.throwIfAborted();entry.current();await new Promise(resolve=>setTimeout(resolve,40));
  }
 }
}
async function selectNativeSettingsTab(n,entry,tab,signal){
 const source=nativeSettingsFrame(n,entry);
 if(source.panel.hidden||!['Status','Config','Usage','Stats'].includes(tab))throw Error('Native Settings tab is unavailable');
 signal?.throwIfAborted();entry.current();source.panel.onTabChange(tab);
 const until=Date.now()+1500;
 while(true){
  signal?.throwIfAborted();const current=nativeSettingsFrame(n,entry);
  if(current.panel.selectedTab===tab)return;
  if(Date.now()>=until)throw Error('Claude Code has not acknowledged the selected Settings tab');
  await new Promise(resolve=>setTimeout(resolve,40));
 }
}
async function actNativeSettingsStats(n,entry,action,signal){
 signal?.throwIfAborted();const source=nativeSettingsFrame(n,entry);
 if(source.panel.selectedTab!=='Stats'||!source.loader)throw Error('Native Stats controls are unavailable');
 if(action==='Overview'||action==='Models'){
  if(!source.statsTabs)throw Error('Native Stats views are unavailable');
  source.statsTabs.onTabChange(action);
 }else if(action==='cycleDates'){
  const caches=source.loader.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===50);
  if(caches?.length!==1||typeof caches[0][3]!=='function')throw Error('Native Stats date control changed');
  caches[0][3]();
 }else if(action==='copy'){
  const caches=source.loader.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===50);
  if(caches?.length!==1||typeof caches[0][13]!=='function'||!source.stats)throw Error('Native Stats copy control changed');
  // Invoke the original Ctrl+S handler; original formatting, clipboard export and feedback remain native.
  caches[0][13]({key:'s',ctrl:true,meta:false,shift:false,alt:false,preventDefault(){},stopPropagation(){}});
 }else throw Error('Invalid native Stats action');
 // Let the original React state update; the following read still validates dialog identity.
 await new Promise(resolve=>setTimeout(resolve,40));signal?.throwIfAborted();entry.current();
}
`
