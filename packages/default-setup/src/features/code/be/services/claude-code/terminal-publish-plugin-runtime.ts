/** Project Claude's original publish review and invoke its mounted, guarded controls. */
export const claudeTerminalPublishPluginRuntime = String.raw`
function nativePublishPlugin(n) {
 const kind='permission_publish_plugin',d=nativeDialog(n,kind);
 if(!d.item)return;
 const {card,everything}=d.payload;
 const validLines=lines=>Array.isArray(lines)&&lines.length<=4096&&lines.every(line=>typeof line==='string'&&line.length<=16000);
 const review=card!==undefined;
 if(!validLines(everything)||review&&(!card||typeof card.question!=='string'||!card.question.length||card.question.length>4000||!validLines(card.lines)||!validLines(card.values)))return;
 if(Buffer.byteLength(JSON.stringify([card,everything]))>200000)return;
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const pending=[root],seen=new Set(),renderers=[];
 const name=nativeFunctionName('RCe');
 while(pending.length){
  const fiber=pending.pop();
  if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native plugin publish traversal exceeded bound');
  seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===name&&fiber.memoizedProps?.payload===d.payload)renderers.push(fiber);
  if(fiber.child)pending.push(fiber.child);
  if(fiber.sibling)pending.push(fiber.sibling);
 }
 if(renderers.length!==1)return;
 const renderer=renderers[0];
 let fingerprint=composerFunctionHashes.get(renderer.type);
 if(!fingerprint){
  fingerprint=createHash('sha256').update(Function.prototype.toString.call(renderer.type)).digest('hex');
  composerFunctionHashes.set(renderer.type,fingerprint);
 }
 if(fingerprint!=='f0c85915ba6b06bb18753d48b98ddbddc62ea5259a096b0c5bd52f18b06e550e')throw Error('Native plugin publish renderer changed');
 if(renderer.memoizedProps.wouldTakeAnswer?.()!==true)return;
 const children=[renderer.child],visited=new Set(),controls=[];
 while(children.length){
  const fiber=children.pop();
  if(!fiber||visited.has(fiber))continue;
  if(visited.size>=2048)throw Error('Native plugin publish controls exceeded bound');
  visited.add(fiber);
  const source=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&source?.focus==='cancel'&&source.confirmLabel===(review?'Yes, publish':'Dismiss')
    &&source.cancelLabel==='No'&&typeof source.onConfirm==='function'&&typeof source.onCancel==='function')controls.push(source);
  if(fiber.child)children.push(fiber.child);
  if(fiber.sibling)children.push(fiber.sibling);
 }
 if(controls.length!==1)return;
 const control=controls[0];
 const notice={id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind,
  title:review?card.question:'Publish a plugin?',
  paragraphs:review?card.lines:['This request to publish could not be read. Nothing is sent.'],
  previewFiles:review?card.values:[],files:review?everything:[],
  choices:[...(review?[{value:'publish_plugin_confirm',label:control.confirmLabel}]:[]),{value:'publish_plugin_decline',label:control.cancelLabel}]};
 return {d,control,notice};
}
async function answerNativePublishPlugin(n,request,abort){
 const projected=nativePublishPlugin(n);
 if(!projected||request.id!==projected.notice.id||request.revision!==projected.notice.revision||request.session_id!==projected.notice.sessionId)throw Error('Native plugin publish request changed or expired');
 if(!projected.notice.choices.some(choice=>choice.value===request.decision))throw Error('Native plugin publish decision is unavailable');
 const {d,control}=projected;
 abort.signal.throwIfAborted();
 if(control.refuseInput?.()===true)throw Error('Native plugin publish refused the decision');
 if(request.decision==='publish_plugin_confirm')control.onConfirm();
 else control.onCancel();
 const deadline=Date.now()+1000;
 while(d.store.getState().open.includes(d.item)){
  abort.signal.throwIfAborted();
  if(Date.now()>=deadline)throw Error('Native plugin publish did not accept the decision');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 dialogRevisions.delete('permission_publish_plugin');
}
`
