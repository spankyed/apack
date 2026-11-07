/** Mirror only the original mounted inline offer; its native key dispatcher owns the effect. */
export const claudeTerminalInlineModelRuntime = String.raw`
let inlineModelRevision;
function nativeInlineModelOffer(n){
 const absent=()=>{inlineModelRevision=undefined;return undefined;};
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const context=binding.toolContext(new AbortController()),notice=context.getAppState().notifications?.current;
 if(notice?.key!=='newer-model-offer'||notice.kind!=='upsell')return absent();
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)return absent();
 if(nativeViewFacts(n,binding,new AbortController()).view.kind!=='main')return absent();
 const element=notice.jsx,props=element?.props;
 if(typeof element?.type!=='function'||element.type.name!==nativeFunctionName('Ene')||typeof props?.onScreen!=='function'||!Array.isArray(props.segments)||!props.segments.length||props.segments.length>64)return absent();
 const checked=(fn,expected)=>{let hash=composerFunctionHashes.get(fn);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,hash);}if(hash!==expected)throw Error('Native inline model offer producer changed');};
 checked(element.type,'ceceaddc79eb68b0964b0faa4f0a5a7c57bee5f88691610b3d52823a1f083eb5');
 checked(props.onScreen,'e9be39361cf51bba8fef8fb13ea8c3d407b8040785d1f72a7b1a0dd3b8512076');
 if(props.segments.some(segment=>!segment||typeof segment.text!=='string'||segment.text.length>16000||segment.color!==undefined&&segment.color!=='permission'||segment.dim!==undefined&&typeof segment.dim!=='boolean'||Object.keys(segment).some(key=>!['text','color','dim'].includes(key))))throw Error('Native inline model offer segments changed');
 const raw=JSON.stringify(props.segments);if(raw.length>32768)throw Error('Native inline model offer exceeds bound');
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set();let mounted=0;
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native inline model traversal exceeded bound');seen.add(fiber);
  if(fiber.type===element.type&&fiber.memoizedProps===props)mounted++;
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(mounted!==1)return absent();
 if(inlineModelRevision?.notice!==notice||inlineModelRevision?.props!==props||inlineModelRevision?.raw!==raw||inlineModelRevision?.sessionId!==sessionId)inlineModelRevision={notice,props,raw,sessionId,revision:randomUUID()};
 return inlineModelRevision;
}
async function projectNativeInlineModelOffer(n,offer){
 // Render source segments, never the original effect-bearing Ene component or its onScreen callback.
 const node=n.jsx.e(n.terminalComponents.n,{children:offer.props.segments.map(segment=>n.jsx.e(n.terminalComponents.n,{children:segment.text,color:segment.color,dimColor:segment.dim}))});
 const ansi=await nativeGenericPermissionText(n,node,true),current=nativeInlineModelOffer(n);
 if(!current||current.revision!==offer.revision)throw Error('Native inline model offer changed while formatting');
 return {id:offer.notice.key,revision:offer.revision,sessionId:offer.sessionId,kind:'newer_model_inline',title:'',paragraphs:[stripVTControlCharacters(ansi)],ansi};
}
function nativeInlineModelActions(n,client,provider){
 if(!clients.has(client)||!clientViewCurrent(n,client))return [];
 // Native's hidden draft is separate: do not let an app draft bypass its empty-draft guard.
 const edit=edits.get(client);
 const offer=nativeInlineModelOffer(n);if(!offer)return [];
 const action='chat:defaultToNewerModel',entries=provider.props.handlerRegistryRef.current.get(action);
 if(!(entries instanceof Set)||![...entries].some(entry=>entry.action===action&&entry.context==='Chat'&&entry.fallback!==true&&typeof entry.handler==='function'))return [];
 // Advertise only; the unchanged original dispatcher retains context, footer precedence and grace.
 return [{action,revision:offer.revision,blocked:!edit||edit.box.text!==''}];
}
`
