/** Project the original /background warning; its callbacks still own task review and fork effects. */
export const claudeTerminalBackgroundRuntime = String.raw`
function nativeBackgroundPanel(n,request){
 const entry=agentCommandDialogs.get(request.panel_id);
 if(!entry||entry.kind!=='panel'||entry.commandName!=='background'||entry.clientId!==request.client_id)throw Error('Native background panel expired');
 entry.current();
 if(entry.closed||entry.backgroundAnswered)return {entry};
 if(!entry.store.getState().open.some(item=>item.id===entry.dialogId&&item.kind==='local_jsx'&&item.payload?.nodeId===entry.nodeId))throw Error('Native background panel replaced');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native background confirmation producer changed');};
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native background traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('HIe')&&fiber.memoizedProps?.onDone===entry.originalProps.onDone&&fiber.memoizedProps?.seed===entry.originalProps.seed&&fiber.memoizedProps?.messages===entry.originalProps.messages){
   checked(fiber.type,'8c1a9dcbdd4a1c9e2db39937f22289db72758d4671938522306b44b77147b403');
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===81);
   if(rows?.length!==1)throw Error('Native background memo contract changed');
   const row=rows[0],modal=row[80]?.props,panel=row[76]?.props;
   if(row[18]===true||!modal||!panel)continue;
   if(modal.title!=='Background this session?'||typeof modal.subtitle!=='string'||modal.subtitle.length>32000||typeof panel.confirmLabel!=='string'||panel.cancelLabel!=='Stay'||typeof panel.onConfirm!=='function'||typeof panel.onCancel!=='function'||modal.onCancel!==panel.onCancel)throw Error('Native background choices changed');
   const children=[fiber.child],visited=new Set();let mounted=0;
   while(children.length){const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native background controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('lr')&&child.memoizedProps===panel){checked(child.type,'3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70');mounted++;}
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
   if(mounted===1)matches.push({panel,modal,tasks:row[32]});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1){delete entry.backgroundReview;return {entry};}
 const source=matches[0];
 if(source.tasks!==entry.context.taskRegistry.all())throw Error('Native background tasks changed; refresh the review');
 const fingerprint=JSON.stringify([source.modal.title,source.modal.subtitle,source.panel.confirmLabel,source.panel.cancelLabel,source.panel.focus??'confirm']);
 let revision=entry.backgroundReview;
 if(!revision||revision.panel!==source.panel||revision.modal!==source.modal||revision.tasks!==source.tasks||revision.fingerprint!==fingerprint)revision={...source,fingerprint,revision:randomUUID()};
 entry.cancel=source.panel.onCancel;entry.backgroundReview=revision;return {entry,source:revision};
}
async function nativeBackgroundReview(n,request){
 let current=nativeBackgroundPanel(n,request);
 if(request.operation==='read')return {open:!current.entry.closed,...current.source?{review:{revision:current.source.revision,title:current.source.modal.title,paragraphs:current.source.modal.subtitle?[current.source.modal.subtitle]:[],confirmLabel:current.source.panel.confirmLabel,cancelLabel:current.source.panel.cancelLabel,defaultFocus:current.source.panel.focus??'confirm'}}:{}};
 if(!['confirm','cancel'].includes(request.operation)||current.entry.closed||current.entry.backgroundAnswered||!current.source||request.revision!==current.source.revision)throw Error('Native background review changed or expired');
 if(request.operation==='confirm')await n.gate._Jo('desktop');
 current=nativeBackgroundPanel(n,request);
 if(current.entry.closed||current.entry.backgroundAnswered||!current.source||request.revision!==current.source.revision)throw Error('Native background review changed or expired');
 if(typeof current.source.panel.refuseInput==='function'&&current.source.panel.refuseInput())throw Error('Native background input is temporarily refused');
 current.entry.backgroundAnswered=true;current.entry.answered=true;
 try{await (request.operation==='confirm'?current.source.panel.onConfirm:current.source.panel.onCancel)();return {answered:true};}
 catch(error){if(!current.entry.closed){current.entry.backgroundAnswered=false;current.entry.answered=false;}throw error;}
}
`
