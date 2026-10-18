/** Authored task ownership adapter; callbacks and transcript readers remain native. */
export const claudeTerminalTaskRuntime = String.raw`async function nativeTaskControl(n,binding,request,abort,current){
 current();
 if(typeof request.task_id!=='string'||request.task_id.length>256||!['inspect','stop'].includes(request.operation))throw Error('Invalid native task operation');
 const context=binding.toolContext(abort),registry=context.taskRegistry;
 const matches=Object.values(registry.all()).filter(task=>n.runtime.flt(task)?.id===request.task_id);
 if(matches.length!==1)throw Error('Native task is no longer owned by this session');
 const task=matches[0];
 if(request.operation==='stop'){
  await n.taskControls.gAe(task.id,{taskRegistry:registry,setAppState:context.setAppState,getAppState:context.getAppState,session:context.session,storageV5:context.storageV5,source:'user'});
  current();return {stopped:true};
 }
 const live=registry.getTranscript(task.id)?.messages??[];
 const saved=typeof binding.savedAgentMessages==='function'?await binding.savedAgentMessages(request.task_id):[];
 current();
 const unique=new Map();for(const row of [...saved??[],...live])if(row?.uuid)unique.set(row.uuid,row);
 let budget=131072,truncated=unique.size>100;const messages=[];
 for(const row of [...unique.values()].slice(-100).reverse()){
  if(!['user','assistant'].includes(row.type)||row.isMeta===true||row.isVirtual===true)continue;
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
 return {details:{taskId:request.task_id,name:task.description??task.agentType??request.task_id,status:task.status,messages,truncated}};
}`
