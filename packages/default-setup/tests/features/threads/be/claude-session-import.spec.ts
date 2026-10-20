import { expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { importClaudeSessionMessages } from '#features/threads/be/claude-session-import.ts'

it('imports native tool results, exact text and image references without replaying hidden rows', () => {
 const sessionId='11111111-1111-1111-1111-111111111111',uuid='22222222-2222-2222-2222-222222222222',resultUuid='33333333-3333-3333-3333-333333333333';
 const thread=repository.threadCommands.create({topic:'Native results',instructions:''});
 const assistant={sessionId,uuid,timestamp:'2026-10-19T10:00:00.123Z',type:'assistant',message:{content:[{type:'thinking',thinking:'Review the change'},{type:'text',text:'  Exact native text  '},{type:'tool_use',id:'read-result',name:'Read',input:{file_path:'/fixture/guide.md'}}]}};
 const result={sessionId,uuid:resultUuid,type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-result',content:'Complete guide'}]}};
 const image={sessionId,uuid:'44444444-4444-4444-4444-444444444444',type:'user',origin:{kind:'human'},message:{content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'YWJj'}}]}};
 expect(importClaudeSessionMessages({threadId:thread.id,transcript:[assistant,result,image,{...assistant,isSidechain:true},{...assistant,isMeta:true},{...assistant,sessionId:'another-session'}],sessionId})).toBe(2);
 const rows=repository.chatQueries.threadData(thread.id)!.messages!;
 expect(rows).toHaveLength(2);expect(rows[0].text).toBe('  Exact native text  ');expect(rows[0].timestamp).toBe(Date.parse(assistant.timestamp));
 expect(rows[0].context).toMatchObject({cliUuid:uuid,claudeTerminalMessage:{uuid,sessionId}});
 const tool=rows[0].blocks?.find(b=>b.type==='tool-activity')!.props.entries[0];
 expect(tool).toMatchObject({id:'read-result',status:'ok',nativeResult:{uuid:resultUuid,sessionId},details:{output:'Complete guide'}});
 expect(rows[0].blocks?.find(b=>b.type==='thinking')!.props.content).toBe('Review the change');
 expect(rows[1].references?.images).toEqual([{name:'Native image',url:'data:image/png;base64,YWJj'}]);
});
it('marks an interrupted saved tool as unresolved instead of leaving a live spinner or inventing a result', () => {
 const sessionId='11111111-1111-1111-1111-111111111111';
 const thread=repository.threadCommands.create({topic:'Interrupted',instructions:''});
 importClaudeSessionMessages({threadId:thread.id,transcript:[{sessionId,uuid:'22222222-2222-2222-2222-222222222222',type:'assistant',message:{content:[{type:'tool_use',id:'pending',name:'Read',input:{}}]}}],sessionId});
 const tool=repository.chatQueries.threadData(thread.id)!.messages![0].blocks![0].props.entries[0];
 expect(tool).toMatchObject({status:'error',details:{error:'Saved session has no recorded result'}});expect(tool.nativeResult).toBeUndefined();
});

it('loads imported native rows chronologically before pagination regardless of relation order', () => {
 const sessionId='11111111-1111-1111-1111-111111111111';
 const thread=repository.threadCommands.create({topic:'Imported order',instructions:'',tags:['imported']});
 repository.threadCommands.update(thread.id,{context:{claudeCode:{sessionId}}});
 const row=(uuid:string,timestamp:string,text:string)=>({sessionId,uuid,timestamp,type:'assistant',message:{content:[{type:'text',text}]}});
 importClaudeSessionMessages({threadId:thread.id,sessionId,transcript:[row('33333333-3333-3333-3333-333333333333','2026-10-19T10:00:01Z','Second'),row('22222222-2222-2222-2222-222222222222','2026-10-19T10:00:00Z','First')]});
 expect(repository.chatQueries.threadData(thread.id)!.messages!.map(m=>m.text)).toEqual(['First','Second']);
 expect(repository.chatQueries.threadDataPaginated(thread.id)!.messages!.map(m=>m.text)).toEqual(['First','Second']);
});
