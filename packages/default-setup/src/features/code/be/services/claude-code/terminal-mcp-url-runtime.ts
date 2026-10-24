/** Project original URL choices and use their mounted keyboard callbacks, including waiting phases. */
export const claudeTerminalMcpUrlRuntime = String.raw`
function nativeMcpUrlSource(n,d){
 const wrappers={mcp_elicitation:['ZCo','275d086d7b1ac78d0b4b1939853b2a4fe61e3bc9062ab8c6e7fb281589c3c2db'],mcp_elicitation_waiting:['e_o','72bb984b5b6cf53a450e67dd52de7baf2f73defd50f4d9072e90c0699bd692cc'],mcp_url_elicitation:['t_o','77f448ae7516bdbfe0eb0551bad38f50cc372347ef95beaf2a87b9d6a8fdcdcc']};
 const expected=wrappers[d.item.kind],pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native MCP URL traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.memoizedProps?.payload===d.payload&&fiber.type.name===nativeFunctionName(expected[0])){if(mcpFunctionHash(fiber.type)!==expected[1])throw Error('Original MCP URL wrapper changed');matches.push(fiber);}
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const wrapper=matches[0],children=[wrapper.child],visited=new Set(),renderers=[];
 while(children.length){const fiber=children.pop();if(!fiber||visited.has(fiber))continue;if(visited.size>=2048)throw Error('Native MCP URL renderer exceeded bound');visited.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('tke')){if(mcpFunctionHash(fiber.type)!=='72edfab66d939fee12559ff708e9fa21a67c9cceb84a7937b7c1b0d994c7a747')throw Error('Original MCP URL renderer changed');renderers.push(fiber);}
  if(fiber.sibling)children.push(fiber.sibling);if(fiber.child)children.push(fiber.child);
 }
 if(renderers.length!==1)return;
 const renderer=renderers[0],nodes=[renderer.child],controlled=new Set(),keys=new Set(),panels=[],text=[],urlRegions=new Set();
 while(nodes.length){const fiber=nodes.pop();if(!fiber||controlled.has(fiber))continue;if(controlled.size>=2048)throw Error('Native MCP URL controls exceeded bound');controlled.add(fiber);const p=fiber.memoizedProps;
  if(p&&typeof p==='object'){
   if(typeof p.onKeyDown==='function'&&mcpFunctionHash(p.onKeyDown)==='552e78fe6f71f1e00ff8623b17c2a438cad341a521d8612d80f291b28ac62c2d'){keys.add(p.onKeyDown);if(Array.isArray(p.children)&&p.children[0]?.props)urlRegions.add(p.children[0]);}
   if(typeof p.title==='string'&&typeof p.onCancel==='function')panels.push({title:p.title,cancel:p.onCancel});
   if(typeof p.children==='string'&&p.children.length<=8000&&typeof p.bold==='boolean'&&(p.color===undefined||p.color==='success'||p.color==='error'))text.push({label:p.children.trim(),selected:p.bold});
   if(typeof p.children==='string'&&(p.children.startsWith('This URL cannot ')||p.children.startsWith('This URL’s ')||p.children.startsWith('This URL extends ')))text.push({warning:p.children});
  }
  if(fiber.sibling)nodes.push(fiber.sibling);if(fiber.child)nodes.push(fiber.child);
 }
 if(keys.size!==1||panels.length!==1||urlRegions.size!==1)return;
 // Read the original URL element, which includes browser normalization and withheld/truncated text.
 const urlNodes=[[...urlRegions][0]],urlSeen=new Set();let displayUrl='';
 while(urlNodes.length){const value=urlNodes.pop();if(typeof value==='string'){displayUrl+=value;if(displayUrl.length>65536)throw Error('Original MCP URL text exceeded bound');continue;}if(value==null||typeof value==='boolean')continue;
  if(typeof value!=='object'||urlSeen.has(value))throw Error('Invalid original MCP URL text');if(urlSeen.size>=2048)throw Error('Original MCP URL text traversal exceeded bound');urlSeen.add(value);
  if(Array.isArray(value)){for(let i=value.length-1;i>=0;i--)urlNodes.push(value[i]);}else if(value.props&&Object.hasOwn(value.props,'children'))urlNodes.push(value.props.children);else throw Error('Original MCP URL text changed');
 }
 if(!displayUrl)throw Error('Original MCP URL text is unavailable');
 const panel=panels[0],phase=panel.title.endsWith(' — waiting for completion')?'waiting':panel.title.endsWith(' wants to open a URL')?'prompt':undefined;if(!phase)throw Error('Original MCP URL phase changed');
 const actionLabel=renderer.memoizedProps.waitingState?.actionLabel??'Continue without waiting',choices=[];
 for(const row of text){if(!row.label)continue;let operation;
  if(phase==='prompt')operation=row.label==='Accept'||row.label==="I'm done, continue"?'accept':row.label==='Decline'?'decline':row.label==='Open in browser'||row.label==='Open again'?'open':undefined;
  else operation=row.label==='Reopen URL'?'open':row.label===actionLabel?'continue':row.label==='Cancel'?'cancel':undefined;
  if(operation){const prior=choices.find(choice=>choice.operation===operation);if(prior){if(prior.label!==row.label||prior.selected!==row.selected)throw Error('Ambiguous original MCP URL choice');}else choices.push({operation,label:row.label,selected:row.selected});}
 }
 if(choices.length>3||choices.filter(choice=>choice.selected).length!==1)throw Error('Original MCP URL choices are not ready');
 return {key:[...keys][0],cancel:panel.cancel,ready:typeof wrapper.memoizedProps.wouldTakeAnswer==='function'&&wrapper.memoizedProps.wouldTakeAnswer()===true,title:panel.title,phase,displayUrl,userConfirmsCompletion:renderer.memoizedProps.userConfirmsCompletion===true,choices,warnings:[...new Set(text.flatMap(row=>row.warning?[row.warning]:[]))]};
}
function nativeMcpUrlPresentation(n,d){
 if(!d.item)return;const source=nativeMcpUrlSource(n,d);if(!source)return;
 const facts={id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:d.item.kind,ready:source.ready,serverName:d.payload.serverName,message:d.payload.params.message,url:source.displayUrl,title:source.title,phase:source.phase,userConfirmsCompletion:source.userConfirmsCompletion,choices:source.choices,warnings:source.warnings};
 const encoded=JSON.stringify(facts);if(encoded.length>196608)throw Error('Native MCP URL presentation exceeded bound');return {...facts,token:createHash('sha256').update(encoded).digest('hex')};
}
async function operateNativeMcpUrl(n,request,signal){
 signal.throwIfAborted();const d=nativeMcpDialog(n,'url'),shown=nativeMcpUrlPresentation(n,d),operation=request.action?.operation;
 if(!shown||!shown.ready||request.id!==shown.id||request.revision!==shown.revision||request.session_id!==shown.sessionId||operation!=='cancel'&&request.token!==shown.token)throw Error('Native MCP URL changed or is not ready');
 if(!['open','accept','decline','continue','cancel'].includes(operation))throw Error('Invalid native MCP URL operation');
 const current=()=>{signal.throwIfAborted();const dialog=nativeMcpDialog(n,'url');if(dialog.item!==d.item||dialog.payload!==d.payload||dialog.revision!==d.revision)throw Error('Native MCP URL expired');const source=nativeMcpUrlSource(n,dialog);if(!source?.ready||source.phase!==shown.phase)throw Error('Native MCP URL phase changed');return source;};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 if(operation==='cancel')current().cancel();
 else{
  if(!shown.choices.some(choice=>choice.operation===operation))throw Error('Original MCP URL choice is unavailable');
  for(let step=0;step<4;step++){const source=current();if(source.choices.find(choice=>choice.selected)?.operation===operation)break;source.key({key:'right',ctrl:false,meta:false,shift:false,preventDefault(){}});await settle();}
  if(current().choices.find(choice=>choice.selected)?.operation!==operation)throw Error('Original MCP URL navigation did not settle');
  const grace=n.mcpInputTiming.AM;if(!Number.isSafeInteger(grace)||grace<0||grace>1000)throw Error('Original MCP input timing changed');await new Promise(resolve=>setTimeout(resolve,grace));
  current().key({key:'return',ctrl:false,meta:false,shift:false,preventDefault(){}});
 }
 await settle();signal.throwIfAborted();const after=nativeMcpDialog(n,'url');return {settled:after.item!==d.item,url:after.item===d.item?nativeMcpUrlPresentation(n,after):undefined};
}
`
