/** Authored task ownership adapter; callbacks and transcript readers remain native. */
export const claudeTerminalTaskRuntime = String.raw`function nativeWorkflowTasks(registry){return Object.values(registry.all()).filter(task=>task.type==='local_workflow').slice(0,256).map(task=>({id:task.id,name:String(task.description??task.summary??task.workflowName??'Workflow').slice(0,256),status:task.status}));}
function nativeWorkflowProgress(n,task){
 let budget=65536,truncated=false;
 const text=value=>{if(typeof value!=='string')return;const limit=Math.min(4096,budget);if(value.length>limit)truncated=true;const shown=value.slice(0,limit);budget-=shown.length;return shown;};
 const raw=Array.isArray(task.workflowProgress)?task.workflowProgress:[],withheld=task.withholdScriptFromSdkEvents===true;
 const visible=withheld?n.workflowTasks.$ar(raw.filter(n.workflowTasks.mAn)):raw;
 if(visible.length>100)truncated=true;
 const progress=visible.slice(-100).flatMap(event=>{
  if(!['workflow_phase','workflow_agent','workflow_log'].includes(event.type))return [];
  const item={type:event.type};
  for(const key of ['index','phaseIndex','tokens','toolCalls'])if(Number.isSafeInteger(event[key])&&event[key]>=0)item[key]=event[key];
  for(const key of ['title','kind','label','state','phaseTitle','agentId','model','error','resultPreview','message']){const value=text(event[key]);if(value!==undefined)item[key]=value;}
  for(const key of ['cached','skipped'])if(typeof event[key]==='boolean')item[key]=event[key];
  return [item];
 });
 let output,outputUnavailable=false;
 if(task.result!==undefined){try{let nodes=0;const encoded=JSON.stringify(task.result,(_key,value)=>{if(++nodes>10000)throw Error('Workflow result preview exceeds node limit');return value;});if(typeof encoded==='string'){const limit=Math.min(32768,budget);output=encoded.slice(0,limit);if(output.length<encoded.length)truncated=true;budget-=output.length;}}catch{outputUnavailable=true;}}
 const logs=withheld?[]:(Array.isArray(task.logs)?task.logs:[]).slice(-100).flatMap(line=>typeof line==='string'?[text(line)]:[]);
 if(!withheld&&Array.isArray(task.logs)&&task.logs.length>100)truncated=true;
 return {progress,logs,...(output!==undefined?{output}:{}),outputUnavailable,truncated};
}
async function nativeTaskControl(n,binding,request,abort,current){
 current();
 if(typeof request.task_id!=='string'||!request.task_id||request.task_id.length>256||!['inspect','stop','send','input','foreground','background'].includes(request.operation))throw Error('Invalid native task operation');
 const context=binding.toolContext(abort),registry=context.taskRegistry;
 if(request.operation==='background'){
  await retireNativeAgentCommands();current();
  const selected=context.getAppState().viewingAgentTaskId;
  const selectedTask=selected===undefined?undefined:registry.get(selected);
  if(selectedTask&&(n.runtime.flt(selectedTask)?.id??selected)!==request.task_id)throw Error('A different native Agent is selected');
  if(typeof binding.view?.show!=='function'||await binding.view.show({})!=='shown')throw Error('Native main view is unavailable');
  current();if(context.getAppState().viewingAgentTaskId!==undefined)throw Error('Native view moved during selection');
  return {view:{taskId:null}};
 }
 const matches=Object.values(registry.all()).filter(task=>task.type==='local_workflow'?task.id===request.task_id:n.runtime.flt(task)?.id===request.task_id);
 if(matches.length!==1)throw Error('Native task is no longer owned by this session');
 const task=matches[0];
 if(task.type==='local_workflow'){
  if(!['inspect','stop'].includes(request.operation))throw Error('Workflow tasks support inspection and native stop only');
  if(request.operation==='stop'){await n.taskControls.gAe(task.id,{taskRegistry:registry,setAppState:context.setAppState,getAppState:context.getAppState,session:context.session,storageV5:context.storageV5,source:'user'});current();return {stopped:true};}
  const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined,start=numeric(task.startTime),end=numeric(task.endTime);
  current();return {details:{taskId:task.id,name:String(task.description??task.summary??task.workflowName??'Workflow').slice(0,256),status:task.status,canInput:false,canMessage:false,workflow:{...nativeWorkflowProgress(n,task),...(typeof task.workflowName==='string'?{name:task.workflowName.slice(0,256)}:{}),...(typeof task.workflowRunId==='string'?{runId:task.workflowRunId.slice(0,256)}:{}),agentCount:numeric(task.agentCount)??0,phaseCount:Array.isArray(task.phases)?task.phases.length:0},metadata:{promptTruncated:false,errorTruncated:(task.error?.length??0)>16384,...(typeof task.error==='string'?{error:task.error.slice(0,16384)}:{}),...(start===undefined?{}:{elapsedMs:Math.max(0,(end??Date.now())-start)}),tokenCount:numeric(task.totalTokens),toolUseCount:numeric(task.totalToolCalls)},messages:[],truncated:false}};
 }
 if(request.operation==='foreground'){
  if(typeof binding.view?.show!=='function'||await binding.view.show({agentId:request.task_id})!=='shown')throw Error('Native Agent view is unavailable');
  current();if(context.getAppState().viewingAgentTaskId!==task.id)throw Error('Native view moved during selection');
  return {view:{taskId:request.task_id}};
 }
 const liveTeammate=task.type==='in_process_teammate'&&!['completed','failed','killed'].includes(task.status);
 const endedTeammateAddress=task.type==='in_process_teammate'&&!liveTeammate&&request.task_id.includes('@');
 const canMessage=!endedTeammateAddress&&typeof binding.tools==='function'&&binding.tools().some(tool=>tool.name==='SendMessage');
 const canInput=task.type==='local_agent'&&!task.resuming&&['running','completed','failed','killed'].includes(task.status);
 if(request.operation==='input'){
  if(!canInput)throw Error('This Agent cannot accept user input now');
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>16384)throw Error('Agent input must contain 1 to 16384 characters');
  if(task.status!=='running'&&(typeof context.messageQueue?.getCommandQueueSnapshot!=='function'||typeof context.getMessages!=='function'))throw Error('Native live transcript context is unavailable');
  n.runtime.Dhs(task.id,registry);
  const message=n.runtime.Ae({content:request.text,origin:{kind:'human'}});
  n.runtime.WXt(task.id,message,registry);
  let mode='queued';
  if(task.status==='running')n.runtime.jXt(task.id,request.text,registry,{isMeta:true,origin:{kind:'human'},shownAs:message.uuid});
  else{
   try{
    const result=await n.taskResume.MQ({agentId:task.id,prompt:request.text,promptIsMeta:true,promptOrigin:{kind:'human'},toolUseContext:context,liveTranscript:n.taskInputGate.ekt(context.messageQueue,context.getMessages),canUseTool:binding.canUseTool,userInitiated:true});
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
  const exactText=text.length<=budget;
  if(!exactText){text=text.slice(-budget);truncated=true;}
  const renderable=row.isMeta!==true&&(typeof content==='string'||Array.isArray(content)&&content.every(block=>block.type==='text'))&&exactText;
  messages.unshift({uuid:row.uuid,role:row.type,text,...(renderable?{renderText:text,origin:n.runtime.Jgr(row.origin),...(typeof row.message?.id==='string'?{apiMessageId:row.message.id}:{})}:{})});budget-=text.length;if(!budget)break;
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
