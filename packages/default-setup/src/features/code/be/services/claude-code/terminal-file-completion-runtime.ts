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
function nativeTeamMembers(n,context){
 if(!n.planTeams?.is())return [];
 const state=context.getAppState(),team=state.teamContext;
 if(!team||state.viewingAgentTaskId!==undefined)return [];
 const self=context.agentId??team.leadAgentId;
 return Object.entries(team.teammates??{}).flatMap(([id,member])=>
  id!==self&&typeof member.name==='string'&&member.name.length<=256&&/^[\w-]+$/u.test(member.name)
  ? [{id,team:team.teamName,name:member.name}] : []);
}
function nativeTeamAddress(n,context,text){
 const address=/^@([\w-]+)\s+(.+)$/su.exec(text);
 return address?.[2].trim()?nativeTeamMembers(n,context).find(member=>member.name===address[1]):undefined;
}
function sameNativeTeamAddress(left,right){
 return !!left&&!!right&&left.id===right.id&&left.team===right.team&&left.name===right.name;
}
const nativePeerRosters=new WeakMap();
async function nativeAddressCompletions(n,context,token,current){
 if(token.quoted||!/^[\p{L}\p{N}\p{M}\u200C\u200D_-]*$/u.test(token.query))return [];
 const normalize=n.addressNormalization?.lo??(value=>value.toLowerCase());
 const query=normalize(token.query);
 const names=new Set(),rows=[];
 const add=(label,description)=>{
  if(label.length>4096||!/^(?:@[\w-]+|@"[^"\u0000-\u001f\u007f]+")$/u.test(label))return;
  rows.push({label,text:label+' ',description,replacement:{start:token.start,end:token.end}});
 };
 for(const {name} of nativeTeamMembers(n,context)){
  if(!normalize(name).startsWith(query))continue;
  names.add(name);
  add('@'+name,'Send message');
 }
 const state=context.getAppState?.();
 for(const [name,id] of state?.agentNameRegistry??[]){
  if(names.has(name)||!normalize(name).startsWith(query))continue;
  const status=state.tasks?.[id]?.status;
  add('@'+name,status?'Send message · '+status:'Send message');
 }
 const allowPeers=()=>n.addressAdmission?.Yi()===true&&!n.referenceWorkspace.Ct();
 if(query&&allowPeers()){
  const {session,storageV5}=context;
  let entry=nativePeerRosters.get(session);
  if(!entry||!entry.pending&&Date.now()-entry.lastRead>=5000){
   entry={lastRead:0,pending:n.runtime.igr(session,state,{storageV5})};
   nativePeerRosters.set(session,entry);
   const held=entry;
   void held.pending.then(roster=>{held.roster=roster;},()=>{}).then(()=>{held.pending=undefined;held.lastRead=Date.now();});
  }
  const roster=entry.pending?await entry.pending.catch(()=>undefined):entry.roster;
  if(!current())return [];
  if(roster&&allowPeers())for(const row of n.runtime.Xps(roster,query))add(row.displayText,row.description);
 }
 return rows.slice(0,20);
}
const templateRefreshes=new WeakMap(),templateReconnectFailures=new WeakMap();
const nativeTemplateOffers=new Map();
function confirmNativeTemplate(clientId,box,ticket){
 const offers=nativeTemplateOffers.get(clientId);
 nativeTemplateOffers.delete(clientId);
 const offer=offers?.get(ticket),token=nativeFileCompletionToken(box);
 if(!offer||!token||token.start!==offer.token.start||token.end!==offer.token.end||
    token.query!==offer.token.query||token.quoted!==offer.token.quoted||!offer.current())return {suggestions:[]};
 return {start:token.start,suggestions:[offer.row]};
}
async function nativeResourceTemplates(transport,context,current){
 const mcp=context.getAppState().mcp;
 const listed=mcp?.resourceTemplates??{};
 if(!mcp?.clients.some(connection=>connection.type==='connected'&&!Object.hasOwn(listed,connection.name)))return listed;
 // Let the owning CLI backfill its inventory; concurrent app composers share that read.
 let pending=templateRefreshes.get(context.session);
 if(!pending){
  pending=transport.refreshResourceTemplates(mcp.clients,listed).finally(()=>templateRefreshes.delete(context.session));
  templateRefreshes.set(context.session,pending);
 }
 const refreshed=await pending;
 if(!current())return {};
 if(refreshed.length)context.setAppState(state=>{
  let templates=state.mcp.resourceTemplates;
  for(const {client,templates:rows} of refreshed){
   if(Object.hasOwn(templates,client.name)||!state.mcp.clients.some(connection=>
    connection.type==='connected'&&connection.name===client.name&&connection.client===client.client))continue;
   templates={...templates,[client.name]:rows};
  }
  return templates===state.mcp.resourceTemplates?state:{...state,mcp:{...state.mcp,resourceTemplates:templates}};
 });
 return context.getAppState().mcp.resourceTemplates;
}
function nativeTemplatePrefix(uri){return uri.split('{',1)[0];}
function nativeTemplateSlot(template,uri){
 const parts=template.uriTemplate.split(/\{([^{}]+)\}/u);
 const args=Object.create(null);
 let offset=0;
 for(let i=0;i<parts.length;i+=2){
  if(!uri.startsWith(parts[i],offset))return;
  offset+=parts[i].length;
  if(i+1>=parts.length)return;
  const arg=parts[i+1].replace(/^[+#./;?&]/u,'').replace(/\*$|:\d+$/u,'').split(',',1)[0];
  const following=parts[i+2]??'';
  const next=following?uri.indexOf(following,offset):-1;
  if(next<0){
   // Adjacent variables have no separator. Claude skips them to find the next literal.
   let suffixIndex=i+2;
   while(suffixIndex+1<parts.length&&!parts[suffixIndex])suffixIndex+=2;
   return {template,args,arg,value:uri.slice(offset),offset,suffix:parts[suffixIndex]??'',
    partial:!!following&&i+3<parts.length,variables:(parts.length-1)/2};
  }
  args[arg]=uri.slice(offset,next);
  offset=next;
 }
}
function nativeTemplateListing(server,template){
 return {type:'template',displayText:server+':'+nativeTemplatePrefix(template.uriTemplate),
  server,sourceTemplate:template,uriTemplate:template.uriTemplate,name:template.name||template.uriTemplate,description:template.description||template.name||template.uriTemplate,
  partial:true};
}
async function nativeTemplateCompletions(n,context,listed,query,transport,current){
 const colon=query.indexOf(':');
 if(colon<0)return;
 const server=query.slice(0,colon),uri=query.slice(colon+1);
 if(!Object.hasOwn(listed,server))return;
 const templates=listed[server];
 let slot;
 for(const template of templates){
  const candidate=nativeTemplateSlot(template,uri);
  if(!candidate)continue;
  const args=Object.keys(candidate.args).length,previous=slot&&Object.keys(slot.args).length;
  if(!slot||args>previous||args===previous&&(candidate.offset>slot.offset||
   candidate.offset===slot.offset&&candidate.variables>slot.variables))slot=candidate;
 }
 if(!slot){
  const prefixes=uri?templates.filter(template=>template.uriTemplate.length>uri.length&&template.uriTemplate.startsWith(uri)):[];
  return prefixes.length?prefixes.slice(0,15).map(template=>nativeTemplateListing(server,template)):undefined;
 }
 const connection=context.getAppState().mcp.clients.find(client=>client.name===server&&n.referenceSearch.Is(client));
 if(!connection||!current())return [];
 if(connection.type==='cached'&&Date.now()<(templateReconnectFailures.get(connection)??0))return [];
 const connected=await transport.ensureConnectedClient(connection,{context:'MCP template completion'}).catch(()=>{
  if(connection.type==='cached')templateReconnectFailures.set(connection,Date.now()+5000);
 });
 const stillConnected=()=>current()&&context.getAppState().mcp.clients.some(client=>client.name===server&&
  (client===connection||client.type==='connected'&&client.client===connected?.client))&&
  context.getAppState().mcp.resourceTemplates?.[server]?.includes(slot.template);
 if(!connected||!stillConnected())return [];
 const values=await transport.completeResourceTemplate(connected,slot.template.uriTemplate,slot.arg,slot.value,slot.args);
 if(!stillConnected())return [];
 return values.slice(0,15).flatMap(value=>{
  if(!validNativeMention(value))return [];
  const suffix=value+slot.suffix,mention=server+':'+uri.slice(0,slot.offset)+suffix;
  return [{displayText:suffix,mention,server,sourceTemplate:slot.template,sourceCurrent:stillConnected,description:slot.template.description||slot.template.name,partial:slot.partial}];
 });
}
function nativeReferenceRows(n,context,files,query,listed){
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
 const templates=Object.entries(listed).flatMap(([server,rows])=>rows.map(template=>nativeTemplateListing(server,template)));
 const references=[...resources,...templates,...agents];
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
 const current=()=>!abort.signal.aborted&&clientViewCurrent(n,clientId)&&(originalContext??n.runtime.ey())===binding;
 const addresses=await nativeAddressCompletions(n,context,token,current);
 if(!current()||addresses.length)return current()?addresses:[];
 let listed={},templateRows;
 if(n.referenceTransport&&!n.referenceWorkspace.Ct()){
  const transport=n.referenceTransport.mcpClientModule();
  const inventory=await nativeResourceTemplates(transport,context,current).catch(()=>context.getAppState().mcp?.resourceTemplates??{});
  if(!current())return [];
  listed=Object.fromEntries(Object.entries(inventory).flatMap(([server,templates])=>validNativeMention(server)
   ? [[server,templates.filter(template=>validNativeMention(template.uriTemplate)&&!n.engine.q0t({uri:template.uriTemplate,mimeType:template.mimeType}))]]
   : []));
  templateRows=await nativeTemplateCompletions(n,context,listed,token.query,transport,current).catch(()=>[]);
  if(!current())return [];
 }
 let rows=templateRows;
 if(!rows){
  const index=n.fileSuggestions.RSe;
  rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
  const tracked=index.fileListRefreshPromise,untracked=index.untrackedFetchPromise;
  if(tracked||untracked){
   await tracked;
   await (index.untrackedFetchPromise??untracked);
   if(!current())return [];
   rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
  }
  if(!current())return [];
  rows=nativeReferenceRows(n,context,rows,token.query,listed);
 }
 const offers=new Map();
 const suggestions=rows.flatMap(row=>{
  const label=row?.displayText,value=row?.mention??label;
  if(!validNativeMention(label)||!validNativeMention(value))return [];
  const template=row.type==='template'||row.mention!==undefined;
  const quoted=(!template&&token.quoted)||value.includes(' ');
  const description=typeof row.description==='string'&&row.description?row.description.slice(0,60):undefined;
  const text=(quoted?'@"'+value+(row.partial?'':'"'):'@'+value)+(row.partial?'':' ');
  const suggestion={label,text,...(description?{description}:{}),replacement:{start:token.start,end:token.end}};
  if(row.sourceTemplate){
   suggestion.templateOfferId=randomUUID();
   offers.set(suggestion.templateOfferId,{row:suggestion,token,current:()=>
    current()&&!n.referenceWorkspace.Ct()&&(row.sourceCurrent?.()??true)&&
    context.getAppState().mcp?.resourceTemplates?.[row.server]?.includes(row.sourceTemplate)});
  }
  return [suggestion];
 });
 if(offers.size)nativeTemplateOffers.set(clientId,offers);
 return suggestions;
}
`
