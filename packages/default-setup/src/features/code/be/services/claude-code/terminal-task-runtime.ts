/** Authored task ownership adapter; callbacks and transcript readers remain native. */
export const claudeTerminalTaskRuntime = String.raw`async function nativeTaskControl(n,binding,request,abort,current){
 current();
 if(typeof request.task_id!=='string'||request.task_id.length>256||!['inspect','stop','send','input'].includes(request.operation))throw Error('Invalid native task operation');
 const context=binding.toolContext(abort),registry=context.taskRegistry;
 const matches=Object.values(registry.all()).filter(task=>n.runtime.flt(task)?.id===request.task_id);
 if(matches.length!==1)throw Error('Native task is no longer owned by this session');
 const task=matches[0],liveTeammate=task.type==='in_process_teammate'&&!['completed','failed','killed'].includes(task.status);
 const endedTeammateAddress=task.type==='in_process_teammate'&&!liveTeammate&&request.task_id.includes('@');
 const canMessage=!endedTeammateAddress&&typeof binding.tools==='function'&&binding.tools().some(tool=>tool.name==='SendMessage');
 const canInput=task.type==='local_agent'&&!task.resuming&&['running','completed','failed','killed'].includes(task.status);
 if(request.operation==='input'){
  if(!canInput)throw Error('This Agent cannot accept user input now');
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>16384)throw Error('Agent input must contain 1 to 16384 characters');
  n.runtime.Dhs(task.id,registry);
  const message=n.runtime.Ae({content:request.text,origin:{kind:'human'}});
  n.runtime.WXt(task.id,message,registry);
  let mode='queued';
  if(task.status==='running')n.runtime.jXt(task.id,request.text,registry,{isMeta:true,origin:{kind:'human'},shownAs:message.uuid});
  else{
   try{
    const result=await n.taskResume.MQ({agentId:task.id,prompt:request.text,promptIsMeta:true,promptOrigin:{kind:'human'},toolUseContext:context,canUseTool:binding.canUseTool,userInitiated:true});
    if(n.taskResume.Y$(result))throw Error('Native Agent resume refused: '+result.deniedByPlugin);
    mode='resumed';
   }catch(error){
    if(!(error instanceof n.taskResume.OQ||error instanceof n.taskResume.uSe)||!n.runtime.CZ(task.id,request.text,registry,{isMeta:true,origin:{kind:'human'},userInitiated:true,shownAs:message.uuid}))throw error;
   }
  }
  current();return {input:{messageId:message.uuid,mode}};
 }
 if(request.operation==='send'){
  if(endedTeammateAddress)throw Error('No live teammate of this session has that address');
  if(!canMessage)throw Error('Agent messaging is not available in this session');
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>16384)throw Error('Agent message must contain 1 to 16384 characters');
  const to=liveTeammate?task.identity.agentName:request.task_id;
  const call={type:'tool_use',id:'toolu_apack_'+randomUUID().replaceAll('-',''),name:'SendMessage',input:{to,message:request.text}};
  const assistant=n.runtime._d({content:[call],isVirtual:true});let result,error;
  for await(const value of n.runtime.Z2(call,assistant,binding.canUseTool,context,()=>new Date().toISOString())){
   const row=value?.message;if(row?.type!=='user')continue;
   for(const block of row.message?.content??[])if(block.type==='tool_result'&&block.tool_use_id===call.id){result=row.toolUseResult;error=block.is_error===true||row.toolDenialKind!==undefined?block.content:undefined;}
  }
  current();if(error!==undefined||result?.success!==true)throw Error(typeof error==='string'?error:'The native SendMessage tool did not confirm delivery');
  return {sent:true};
 }
 if(request.operation==='stop'){
  await n.taskControls.gAe(task.id,{taskRegistry:registry,setAppState:context.setAppState,getAppState:context.getAppState,session:context.session,storageV5:context.storageV5,source:'user'});
  current();return {stopped:true};
 }
 const live=registry.getTranscript(task.id)?.messages??[];
 const saved=typeof binding.savedAgentMessages==='function'?await binding.savedAgentMessages(request.task_id):[];
 current();
 const liveIds=new Set(live.map(row=>row?.uuid));
 const unique=new Map();for(const row of [...(saved??[]).filter(row=>!liveIds.has(row?.uuid)),...live])if(row?.uuid)unique.set(row.uuid,row);
 const visibleHumanEnvelopes=new Set(live.filter(row=>row?.type==='user'&&row.origin?.kind==='human'&&row.isMeta!==true&&typeof row.message?.content==='string').map(row=>n.runtime.Ewe(row.message.content,{kind:'human'},{isMeta:true,wholeMessage:true})));
 const rows=[...unique.values()].filter(row=>!(row.type==='user'&&row.isMeta===true&&row.origin?.kind==='human'&&visibleHumanEnvelopes.has(row.message?.content)));
 if(rows.every(row=>typeof row.timestamp==='string'&&Number.isFinite(Date.parse(row.timestamp))))rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 let budget=131072,truncated=rows.length>100;const messages=[];
 for(const row of rows.slice(-100).reverse()){
  if(!['user','assistant'].includes(row.type)||row.isMeta===true&&!(row.type==='user'&&['coordinator','human'].includes(row.origin?.kind))||row.isVirtual===true)continue;
  const content=row.message?.content;let parts=[];
  if(typeof content==='string')parts=[content];
  else if(Array.isArray(content))for(const block of content){
   if(block.type==='text'&&typeof block.text==='string')parts.push(block.text);
   else if(block.type==='thinking'&&typeof block.thinking==='string')parts.push('Thinking: '+block.thinking);
   else if(block.type==='tool_use')parts.push(String(block.name)+' '+JSON.stringify(block.input));
   else if(block.type==='tool_result')parts.push(typeof block.content==='string'?block.content:JSON.stringify(block.content));
  }
  let text=parts.join('\n');if(!text)continue;
  if(text.length>budget){text=text.slice(-budget);truncated=true;}
  messages.unshift({role:row.type,text});budget-=text.length;if(!budget)break;
 }
 const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
 const prompt=typeof task.prompt==='string'?task.prompt:undefined,error=typeof task.error==='string'?task.error:undefined;
 const start=numeric(task.startTime),end=numeric(task.endTime),paused=numeric(task.totalPausedMs)??0;
 const metadata={prompt:prompt?.slice(0,16384),promptTruncated:(prompt?.length??0)>16384,
  model:typeof task.model==='string'?task.model:undefined,effort:typeof task.effort==='string'?task.effort:numeric(task.effort)!==undefined?String(task.effort):undefined,
  elapsedMs:start===undefined?undefined:Math.max(0,(end??Date.now())-start-paused),
  tokenCount:numeric(task.result?.totalTokens??task.progress?.tokenCount),toolUseCount:numeric(task.result?.totalToolUseCount??task.progress?.toolUseCount),
  error:error?.slice(0,16384),errorTruncated:(error?.length??0)>16384};
 return {details:{taskId:request.task_id,name:task.description??task.agentType??request.task_id,status:task.status,canMessage,canInput,metadata,messages,truncated}};
}`
