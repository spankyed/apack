/** Canonical source facts stay inside the owning native process. */
export const claudeNativeToolResultRuntime = String.raw`function nativeToolResultFacts(messages,id,resultUuid,assistantUuid){
 const results=messages.filter(row=>row.uuid===resultUuid&&row.type==='user').flatMap(row=>Array.isArray(row.message?.content)?row.message.content.filter(block=>block.type==='tool_result'&&block.tool_use_id===id).map(block=>({row,block})):[]);
 const calls=messages.filter(row=>row.uuid===assistantUuid&&row.type==='assistant').flatMap(row=>Array.isArray(row.message?.content)?row.message.content.filter(block=>block.type==='tool_use'&&block.id===id):[]);
 if(results.length!==1||calls.length!==1||typeof calls[0].name!=='string')return;
 const {row,block}=results[0],call=calls[0],content=block.content;
 if(row.sourceToolAssistantUUID!==undefined&&row.sourceToolAssistantUUID!==assistantUuid)return;
 const text=typeof content==='string'?content:Array.isArray(content)?content.filter(item=>item.type==='text').map(item=>item.text).join('\n'):'';
 if(text.length>65536||JSON.stringify(row.toolUseResult??null).length>65536)return;
 return {message:row,messages,block,props:{tool_use_id:id,tool:call.name,output:row.toolUseResult,isErrored:block.is_error===true},text,fingerprint:JSON.stringify([assistantUuid,call,row.uuid,block,row.toolUseResult])};
}
function nativePrintToolRender(value,binding,sessionId){
 if(value.component!=='ToolResult'||!Object.hasOwn(value.props??{},'source_uuid'))return value;
 const p=value.props;
 if(value.surface!=='desktop'||p.session_id!==String(sessionId)||typeof binding?.messages!=='function')throw Error('Print tool result session is unavailable or changed');
 const facts=nativeToolResultFacts(binding.messages(),value.requestId,p.source_uuid,p.assistant_uuid);
 if(!facts||p.text!==facts.text||p.tool!==facts.props.tool||p.isErrored!==facts.props.isErrored)throw Error('Print tool result does not match its original source');
 return {...value,props:facts.props};
}
`
