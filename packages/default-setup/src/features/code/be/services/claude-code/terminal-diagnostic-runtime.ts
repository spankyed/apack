/** Read-only presentation of canonical native diagnostic attachments, independent of tool calls. */
export const claudeTerminalDiagnosticRuntime = String.raw`function nativeDiagnosticFacts(n){
 const binding=originalContext??n.runtime.ey();
 if(!binding||binding.toolContext(new AbortController()).getAppState().viewingAgentTaskId!==undefined)return new Map();
 const messages=binding.messages(),facts=new Map(),duplicates=new Set();let anchors=[];
 for(const message of messages){
  if((message.type==='user'||message.type==='assistant')&&typeof message.uuid==='string'&&message.uuid.length<=256)anchors=[message.uuid,...anchors].slice(0,256);
  if(message.type!=='attachment'||message.attachment?.type!=='diagnostics')continue;
  if(typeof message.uuid!=='string'||!message.uuid||message.uuid.length>256||!Array.isArray(message.attachment.files))throw Error('Invalid native diagnostic attachment');
  if(facts.has(message.uuid))duplicates.add(message.uuid);
  const serialized=JSON.stringify(message);if(serialized.length>131072)throw Error('Native diagnostic attachment exceeds desktop limit');
  facts.set(message.uuid,{message,messages,anchorIds:[...anchors],revision:createHash('sha256').update(serialized).digest('hex')});
 }
 for(const id of duplicates)facts.delete(id);
 if(facts.size>32)throw Error('Native diagnostic attachment count exceeds desktop limit');
 return facts;
}
async function nativeDiagnosticList(n,clientId,columns,signal){
 const source=nativeDiagnosticFacts(n),binding=originalContext??n.runtime.ey(),rows=[];let size=0;
 for(const [id,facts]of source){
  signal.throwIfAborted();
  const options={tools:binding.tools(),columns,signal};
  const summary=await renderNativeToolMessage(n,facts,facts.message,{...options,verbose:false,transcript:false});
  const detail=await renderNativeToolMessage(n,facts,facts.message,options);
  signal.throwIfAborted();
  if(!clientViewCurrent(n,clientId)||nativeDiagnosticFacts(n).get(id)?.revision!==facts.revision)throw Error('Native diagnostic attachment changed while formatting');
  size+=summary.length+detail.length;if(size>131072)throw Error('Native diagnostic presentation exceeds desktop limit');
  rows.push({id,revision:facts.revision,anchorIds:facts.anchorIds,summary,detail});
 }
 if(!clientViewCurrent(n,clientId)||JSON.stringify([...nativeDiagnosticFacts(n)].map(([id,row])=>[id,row.revision]))!==JSON.stringify([...source].map(([id,row])=>[id,row.revision])))throw Error('Native diagnostic view changed while formatting');
 return rows;
}`
