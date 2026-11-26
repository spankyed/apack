/** Mirror the original mounted streaming preview without creating a stored transcript row. */
export const claudeTerminalStreamRuntime = String.raw`let nativePreviewCache;
async function nativeStreamingPreview(n,facts,turn){
 if(facts.view.kind!=='main'||!turn||turn.cancelled()){nativePreviewCache=undefined;return null;}
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),stores=new Set(),frames=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=8192)throw Error('Native preview traversal exceeded bound');seen.add(fiber);
  const controller=fiber.memoizedProps?.turn;
  if(controller?.guard?.isRunning&&typeof controller._requireHost==='function'&&controller._requireHost().session?.id===facts.sessionId&&controller.stream?.previewStore)stores.add(controller.stream.previewStore);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(stores.size!==1){nativePreviewCache=undefined;return null;}
 const store=[...stores][0];
 for(const fiber of seen)if(fiber.memoizedProps?.store===store&&fiber.child?.memoizedProps?.store!==store&&typeof store.getDerived==='function')frames.push(fiber);
 if(frames.length!==1){nativePreviewCache=undefined;return null;}
 const source=frames[0],state=store.getState(),derived=store.getDerived();
 if(typeof derived.displayed!=='string'||!derived.displayed){nativePreviewCache=undefined;return null;}
 if(derived.displayed.length>65536)throw Error('Native preview exceeds desktop limit');
 const columns=Math.max(20,Math.min(240,process.stdout.columns??80)),theme=nativeThemeProvider(n),cached=nativePreviewCache;
 if(cached?.store===store&&cached.state===state&&cached.turnId===turn.turnId&&cached.columns===columns&&cached.theme===theme.value)return cached.value;
 const tree=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(source.elementType??source.type,source.memoizedProps)})});
 const output=await n.staticRender.v6e(tree,{columns});
 if(store.getState()!==state||n.runtime.lpe()!==turn||turn.cancelled())return null;
 if(typeof output!=='string'||output.length>65536)throw Error('Native rendered preview exceeds desktop limit');
 const value=output.trim()?{turnId:turn.turnId,output}:null;
 nativePreviewCache={store,state,turnId:turn.turnId,columns,theme:theme.value,value};return value;
}
`;
