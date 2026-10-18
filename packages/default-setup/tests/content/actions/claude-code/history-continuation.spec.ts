import { chatService } from '#features/threads/be/services/chat.ts';
import { expect,it,vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services,type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as chat } from '../../../../src/content/actions/claude-code/chat.ts';
import { finalizeSessionError } from '../../../../src/content/actions/claude-code/_helpers/stream-consumer.ts';
import { action as reset } from '../../../../src/content/actions/claude-code/reset-session.ts';
for(const state of [{sessionId:'native-session',historyError:'boundary unavailable'},{revertTo:{cliUuid:'native-assistant'}}]){
 it(`blocks continuation of unresolved history ${JSON.stringify(state)}`,async()=>{
  const{id}=repository.threadCommands.create({topic:'Blocked history',instructions:''});
  repository.threadCommands.update(id,{context:{claudeCode:state}});
  const query=vi.fn(),notify=vi.fn();
  mockService<Services,'cli'>('cli',{claudeCode:{query} as never});
  mockService<Services,'chat'>('chat',{sendBlockMessage:notify});
  expect((await chat({threadId:id,text:'Continue'},services,{} as never,'')).success).toBe(false);
  expect(query).not.toHaveBeenCalled();expect(notify).toHaveBeenCalled();
  expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject(state);
 });
}
it('marks a native history error as blocked without discarding its session, and explicit reset clears the block',async()=>{
 const{id}=repository.threadCommands.create({topic:'History failure',instructions:''});
 repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session'}}});
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()});
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()});
 mockService<Services,'cli'>('cli',{claudeCode:{closeIdleConversation:vi.fn(async()=>true)} as never});
 const writer={finalize:vi.fn()};
 finalizeSessionError(services,id,writer as never,'No message found with message.uuid of: native-assistant',undefined,{isHistoryChange:true});
 expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({sessionId:'native-session',historyError:expect.stringContaining('No message found')});
 await reset({threadId:id},services,{} as never,'');
 expect(repository.threadQueries.byId(id)?.context?.claudeCode).toBeUndefined();
});

for(const worktreeMismatch of [false,true]) {
 it(`blocks a failed history startup without retrying different native history (worktree mismatch: ${worktreeMismatch})`,async()=>{
  const{id}=repository.threadCommands.create({topic:'History startup',instructions:''});
  repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture',revertTo:{cliUuid:'native-assistant'},useWorktree:worktreeMismatch,sessionWorktree:false}}});
  const query=vi.fn(async()=>{throw Error('Fixture executable unavailable');});
  mockService<Services,'cli'>('cli',{claudeCode:{openConversation:query,isConversationBusy:vi.fn(()=>false),getConversation:vi.fn(),getHandle:vi.fn(),sessionExists:vi.fn(async()=>true)} as never});
  mockService<Services,'chat'>('chat',{...chatService,resolveReferences:vi.fn(async()=>({textPrefix:'',imageBlocks:[]}))} as never);
  mockService<Services,'threads'>('threads',{updateChatState:vi.fn()});
  const result=await chat({threadId:id,text:'Continue'},services,{} as never,'');
  expect(result.success).toBe(false);
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.historyError).toBeDefined();
  await chat({threadId:id,text:'Another message'},services,{} as never,'');
  expect(query).toHaveBeenCalledTimes(worktreeMismatch?0:1);
 });
}

it('drains the idle owner before reset so its final journal cannot restore the old session',async()=>{
 const{id}=repository.threadCommands.create({topic:'Native reset',instructions:''});
 repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'old-session'}}});
 let release!:()=>void;
 const closing=new Promise<void>(resolve=>{release=resolve});
 const closeIdleConversation=vi.fn(async()=>{await closing;repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'old-session',turns:2}}});return true});
 mockService<Services,'cli'>('cli',{claudeCode:{closeIdleConversation} as never});
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()});
 const resetting=reset({threadId:id},services,{} as never,'');
 expect(repository.threadQueries.byId(id)?.context?.claudeCode?.sessionId).toBe('old-session');
 release();expect(await resetting).toMatchObject({success:true});
 expect(repository.threadQueries.byId(id)?.context?.claudeCode).toBeUndefined();
});
it('preserves the session when its owner is busy instead of reporting a completed reset',async()=>{
 const{id}=repository.threadCommands.create({topic:'Busy reset',instructions:''});
 repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'busy-session'}}});
 mockService<Services,'cli'>('cli',{claudeCode:{closeIdleConversation:vi.fn(async()=>false)} as never});
 const notify=vi.fn();mockService<Services,'chat'>('chat',{sendBlockMessage:notify});
 expect(await reset({threadId:id},services,{} as never,'')).toMatchObject({success:false,error:expect.stringContaining('Pause')});
 expect(repository.threadQueries.byId(id)?.context?.claudeCode?.sessionId).toBe('busy-session');expect(notify).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('Pause')}));
});
