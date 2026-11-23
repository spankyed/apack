/** Adapt the pinned native reference sources and the terminal's @ path replacement rules. */
export const claudeTerminalFileCompletionRuntime = String.raw`
const nativeAtPathChars=/^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
function nativeFileCompletionToken(box){
 const before=box.text.slice(0,box.cursor),after=box.text.slice(box.cursor);
 const quoted=/(?:^|[\s。、？！])@"([^"]*)"?$/u.exec(before);
 if(quoted){
  const start=quoted.index+quoted[0].indexOf('@');
  const closed=before.length>start+2&&before.endsWith('"');
  const suffix=closed?'':after.match(/^[^"\r\n]*"?/)?.[0]??'';
  const query=(quoted[1]+suffix).replace(/"$/,'');
  return {start,end:box.cursor+suffix.length,query,quoted:true};
 }
 const start=before.lastIndexOf('@');
 if(start<0||start>0&&!/[\s。、？！]/u.test(before[start-1]))return undefined;
 const prefix=before.slice(start+1);
 if(nativeAtPathChars.exec(prefix)?.[0]!==prefix)return undefined;
 const suffix=nativeAtPathChars.exec(after)?.[0]??'';
 return {start,end:box.cursor+suffix.length,query:prefix+suffix,quoted:false};
}
function validNativeMention(value){
 return typeof value==='string'&&value.length>0&&value.length<=4096&&!/["\u0000-\u001f\u007f]/u.test(value);
}
function nativeReferenceRows(n,context,files,query){
 if(!n.referenceSearch||n.referenceWorkspace.Ct())return files.slice(0,15);
 const state=context.getAppState();
 const resources=Object.values(state.mcp?.resources??{}).flat().flatMap(resource=>{
  if(!validNativeMention(resource?.server)||!validNativeMention(resource.uri)||n.engine.q0t(resource))return [];
  const {server,uri}=resource;
  const name=resource.name||uri;
  return [{type:'resource',displayText:server+':'+uri,server,name,description:resource.description||name}];
 });
 const agents=(state.agentDefinitions?.activeAgents??[]).flatMap(agent=>{
  if(typeof agent?.agentType!=='string'||!/^[\w:.@-]+$/.test(agent.agentType))return [];
  const {agentType}=agent,displayText=agentType+' (agent)';
  const match=query.toLowerCase();
  return !query||displayText.toLowerCase().includes(match)
   ? [{type:'agent',displayText,agentType,description:agent.whenToUse}]
   : [];
 });
 const references=[...resources,...agents];
 if(!query)return [...files,...references].slice(0,15);
 if(!references.length)return files.slice(0,15);
 // Match and rank against the same fields and scorer used in the pinned terminal.
 const keys=[{name:'displayText',weight:2},{name:'name',weight:3},{name:'server',weight:1},
  {name:'description',weight:1},{name:'agentType',weight:3},{name:'uriTemplate',weight:2}];
 const matches=new n.referenceSearch.ohe(references,{includeScore:true,threshold:0.6,keys}).search(query,{limit:15});
 return [...files.map(item=>({item,score:item.metadata?.score??0.5})),
  ...matches.map(({item,score})=>({item,score:(score??0.5)+(item.type==='resource'?0.15:0)}))]
  .sort((a,b)=>a.score-b.score).slice(0,15).map(row=>row.item);
}
async function nativeFileCompletions(n,clientId,token,abort){
 if(!token||token.query.length>4096||!n.fileSuggestions||abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return [];
 const context=binding.toolContext(abort),{storageV5}=context;
 const index=n.fileSuggestions.RSe;
 let rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
 const tracked=index.fileListRefreshPromise,untracked=index.untrackedFetchPromise;
 if(tracked||untracked){
  await tracked;
  await (index.untrackedFetchPromise??untracked);
  if(abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
  rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
 }
 if(abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
 return nativeReferenceRows(n,context,rows,token.query).flatMap(row=>{
  const value=row?.displayText;
  if(!validNativeMention(value))return [];
  const quoted=token.quoted||value.includes(' ');
  const description=typeof row.description==='string'&&row.description?row.description.slice(0,60):undefined;
  return [{label:value,text:quoted?'@"'+value+'" ':'@'+value+' ',...(description?{description}:{}),
   replacement:{start:token.start,end:token.end}}];
 });
}
`
