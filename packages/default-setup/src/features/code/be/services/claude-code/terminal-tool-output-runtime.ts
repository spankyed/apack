/** Authored bridge to the original static transcript export renderer and its schema/error handling. */
export const claudeTerminalToolOutputRuntime = String.raw`async function formatNativeToolResult(n,facts,output,options){
 options.signal?.throwIfAborted();
 const columns=Math.max(20,Math.min(240,options.columns??process.stdout.columns??80));
 const theme=nativeThemeProvider(n),tools=n.toolExport.uer(options.tools);
 // One mounted result must not render sibling blocks from the same original user row.
 const message={...facts.message,message:{...facts.message.message,content:[facts.block]},toolUseResult:output};
 const source=n.runtime.sQt(facts.messages.map(message=>({message})));
 const props={message,lookups:source.lookups,containerWidth:columns,addMargin:false,tools,commands:[],verbose:true,inProgressToolUseIDs:source.inProgressToolUseIDs,progressMessagesForMessage:[],shouldAnimate:false,shouldShowDot:false,style:'condensed',isTranscriptMode:true,isStatic:true,disableDisplayOverride:true};
 // Match Claude's export providers. A fresh default app store never owns the live view's tasks.
 const tree=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.toolRendering.h3,props)})});
 const text=await n.staticRender.v6e(tree,{columns});
 options.signal?.throwIfAborted();
 if(typeof text!=='string'||text.length>65536)throw Error('Native formatted tool result exceeds the desktop output limit');
 return text;
}
function nativeDrawingUsesEngine(tree){
 const pending=[tree];let count=0;
 while(pending.length){const value=pending.pop();if(++count>4096)throw Error('Native tool drawing exceeds the desktop tree limit');if(!value||typeof value!=='object')continue;if(value.type==='engine')return true;if(Array.isArray(value.children))pending.push(...value.children);}
 return false;
}`
