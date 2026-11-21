/** Original complete focus selection, before viewport virtualization; folded members stay owned by ToolGroup. */
export const claudeTerminalFocusRuntime = String.raw`function nativeFocusProjection(n,facts){try{return readNativeFocusProjection(n,facts)}catch{return;}}
function readNativeFocusProjection(n,facts){
 if(facts.view.kind!=='main')return;
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native focus traversal exceeds bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='Xx'&&fiber.memoizedProps?.screen!=='transcript'){
   let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash==='c9216d60891ddbee9f6c3b4b737f771eda26ce91860b0a6d92aecb21e4490477'){
    const cache=fiber.updateQueue?.memoCache?.data?.[0],producerId=fiber.memoizedProps.conversationId;
    if(Array.isArray(cache?.[56])&&Array.isArray(cache?.[83])&&typeof producerId==='string'&&producerId.length>0&&producerId.length<=256)matches.push({base:cache[56],selected:cache[83],producerId});
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const {base,selected,producerId}=matches[0],active=base!==selected;
 if(!active)return {producerId,active:false,hidden:[]};
 const ids=rows=>{const result=new Set(),pending=[...rows];let count=0;while(pending.length){if(++count>16384)throw Error('Native focus member traversal exceeds bound');const row=pending.pop();if(!row||typeof row.uuid!=='string'||!row.uuid||row.uuid.length>256)throw Error('Native focus row identity changed');result.add(row.uuid);if(result.size>4096)throw Error('Native focus row limit');if(Array.isArray(row.messages))pending.push(...row.messages);}return result;};
 const before=ids(base),kept=ids(selected);
 // Folded rows retain their canonical members for the existing original ToolGroup projection.
 for(const row of selected)if(!before.has(row.uuid)&&!(row.type==='collapsed_read_search'&&Array.isArray(row.messages)))return;
 return {producerId,active:true,hidden:[...before].filter(id=>!kept.has(id))};
}`
