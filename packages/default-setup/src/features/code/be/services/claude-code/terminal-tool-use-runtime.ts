/** Original ToolUse producer facts, scoped to the main native view and exact assistant row. */
export const claudeTerminalToolUseRuntime = String.raw`const toolUseFrames=new Map();
function toolUseFacts(n,id,assistantUuid,abort){
 const binding=originalContext??n.runtime.ey();if(!binding)return;
 const messages=binding.messages(),state=binding.toolContext(abort).getAppState();if(state.viewingAgentTaskId!==undefined)return;
 const found=messages.filter(message=>message.type==='assistant'&&message.uuid===assistantUuid).flatMap(message=>Array.isArray(message.message?.content)?message.message.content.filter(block=>block.type==='tool_use'&&block.id===id).map(block=>({message,block})):[]);
 if(found.length!==1||typeof found[0].block.name!=='string')return;
 const {message,block}=found[0],source=n.runtime.sQt(messages.map(message=>({message}))),result=source.lookups.toolResultByToolUseID.get(id);
 const progress=state.transcripts[n.transcriptState.vws(undefined)]?.inProgressToolUseIDs??n.transcriptState.wOt.inProgressToolUseIDs;
 const props={tool_use_id:id,tool:block.name,input:block.input,isRunning:progress.has(id),isErrored:source.lookups.erroredToolUseIDs.has(id),isInterrupted:n.engine.aK.isInterruptedCall(result),output:result?.type==='user'?result.toolUseResult:undefined};
 return {message,block,messages,progress,props,fingerprint:JSON.stringify([assistantUuid,block,result?.uuid,props])};
}
function currentToolUseAction(n,request){
 if(request.component!=='ToolUse')return;
 const frame=toolUseFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 if(!frame||toolUseFacts(n,request.instance_id,frame.assistantUuid,new AbortController())?.fingerprint!==frame.fingerprint)throw Error('Native tool use changed or expired');
}`
