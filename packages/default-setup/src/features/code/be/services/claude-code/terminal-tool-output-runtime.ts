/** Authored bridge to the original static transcript export renderer and its schema/error handling. */
export const claudeTerminalToolOutputRuntime = String.raw`async function renderNativeToolMessage(n,facts,message,options){
 options.signal?.throwIfAborted();
 const columns=Math.max(20,Math.min(240,options.columns??process.stdout.columns??80));
 const theme=nativeThemeProvider(n),tools=n.toolExport.uer(options.tools);
 const source=n.runtime.sQt(facts.messages.map(message=>({message})));
 const props={message,lookups:source.lookups,containerWidth:columns,addMargin:false,tools,commands:[],verbose:options.verbose!==false,inProgressToolUseIDs:facts.progress??source.inProgressToolUseIDs,progressMessagesForMessage:[],shouldAnimate:false,shouldShowDot:options.toolUse===true,style:'condensed',isTranscriptMode:true,isStatic:true,disableDisplayOverride:true};
 // Match Claude's export providers. A fresh default app store never owns the live view's tasks.
 const tree=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.toolRendering.h3,props)})});
 const text=await n.staticRender.v6e(tree,{columns});
 options.signal?.throwIfAborted();
 if(typeof text!=='string'||text.length>65536)throw Error('Native formatted tool result exceeds the desktop output limit');
 return text;
}
async function formatNativeToolResult(n,facts,output,options){
 // A mounted result renders only its canonical block, never sibling results from that user row.
 const message={...facts.message,message:{...facts.message.message,content:[facts.block]},toolUseResult:output};
 return renderNativeToolMessage(n,facts,message,options);
}
async function formatNativeToolUse(n,facts,props,options){
 const block={...facts.block,input:props.input},message={...facts.message,message:{...facts.message.message,content:[block]}};
 let tools=options.tools;
 if(props.tool!==facts.block.name){
  if(typeof props.tool!=='string')throw Error('Native ToolUse label rewrite is invalid');
  tools=n.toolExport.uer(tools).map(tool=>{
   if(tool.name!==facts.block.name)return tool;
   // Original Wu uses toolLabel in place of userFacingName. This descriptor is presentation-only.
   const shown=Object.create(tool);Object.defineProperty(shown,'userFacingName',{value:()=>props.tool});return shown;
  });
 }
 const compactWorkflow=['Workflow','RunWorkflow'].includes(facts.block.name)&&typeof props.input?.script==='string'&&props.input.script.length>65536;
 const text=await renderNativeToolMessage(n,facts,message,{...options,tools,toolUse:true,...(compactWorkflow?{verbose:false}:{})});
 return compactWorkflow?text+'\nFull Workflow script omitted from this view.':text;
}
function nativeDrawingUsesEngine(tree){
 const pending=[tree];let count=0;
 while(pending.length){const value=pending.pop();if(++count>4096)throw Error('Native tool drawing exceeds the desktop tree limit');if(!value||typeof value!=='object')continue;if(value.type==='engine')return true;if(Array.isArray(value.children))pending.push(...value.children);}
 return false;
}`
