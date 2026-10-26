import { expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/cc-fork.ts';

function fixture(validate = vi.fn(async () => {})) {
  const {id} = repository.threadCommands.create({topic:'Source',instructions:''});
  repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}});
  repository.chatCommands.addMessage({threadId:id,sender:'assistant',text:'Original',context:{cliUuid:'native-assistant'}});
  const create = vi.fn((opts: {topic:string;instructions:string})=>repository.threadCommands.create(opts));
  const notify = vi.fn(), open = vi.fn();
  mockService<Services,'cli'>('cli',{claudeCode:{validateResumeTarget:validate,closeIdleConversation:vi.fn(async()=>true),getHandle:vi.fn() } as never});
  mockService<Services,'chat'>('chat',{createThread:create,sendBlockMessage:notify,showThread:open});
  return {id,create,notify,validate,open};
}
it('rejects unavailable native history before creating or copying a thread', async () => {
  const f = fixture(vi.fn(async()=>{throw Error('No message found');}));
  const before = repository.chatQueries.threadData(f.id)?.messages;
  const result = await action({threadId:f.id},services,{} as never,'');
  expect(result.success).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
  expect(repository.threadCommands.forkCount(f.id)).toBe(0);
  expect(repository.chatQueries.threadData(f.id)?.messages).toEqual(before);
  expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('No message found')}));
});
it('validates the native boundary before creating a fork with matching session state', async () => {
  const f=fixture();
  const result=await action({threadId:f.id},services,{} as never,'');
  expect(result.success).toBe(true);
  expect(f.validate).toHaveBeenCalledWith({sessionId:'native-session',messageUuid:'native-assistant',cwd:'/fixture'});
  expect(f.validate.mock.invocationCallOrder[0]).toBeLessThan(f.create.mock.invocationCallOrder[0]);
  const newId=f.create.mock.results[0].value.id;
  expect(repository.threadQueries.byId(newId)?.context).toMatchObject({claudeCode:{sessionId:'native-session',forkFrom:{sessionId:'native-session',cliUuid:'native-assistant'}}});
  expect(repository.chatQueries.threadData(newId)?.messages).toHaveLength(1);
  expect(f.open).toHaveBeenCalledWith(newId);
  expect(f.open.mock.invocationCallOrder[0]).toBeGreaterThan(f.create.mock.invocationCallOrder[0]!);
});
it('rejects a source changed while native validation was pending', async () => {
  let release!:()=>void;
  const f=fixture(vi.fn(()=>new Promise<void>(resolve=>{release=resolve;})));
  const pending=action({threadId:f.id},services,{} as never,'');
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  repository.chatCommands.addMessage({threadId:f.id,sender:'user',text:'A new turn'});
  release();
  expect((await pending).success).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
});
it('requires an idle source and a known native session before creating a fork', async () => {
  const f=fixture();
  repository.threadCommands.update(f.id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture',isRunning:true}}});
  expect((await action({threadId:f.id},services,{} as never,'')).success).toBe(false);
  repository.threadCommands.update(f.id,{context:{claudeCode:{sessionId:undefined,cwd:'/fixture',isRunning:false}}});
  expect((await action({threadId:f.id},services,{} as never,'')).success).toBe(false);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
