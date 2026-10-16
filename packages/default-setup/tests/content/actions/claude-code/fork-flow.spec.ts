import { expect, it, vi } from 'vitest';
import { mockService, startApp } from '@apackdev/testing/harness';
import type { Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { actionLabel, writeDefaultFlows } from '../../../_support/flows.ts';

it('compiled cc-fork reports native rejection before creating a thread', async () => {
  writeDefaultFlows();
  mockService<Services, 'codex'>('codex', { start: vi.fn(async () => {}) });
  const validate=vi.fn(async()=>{throw Error('No message found with message.uuid');});
  const create=vi.fn(), notify=vi.fn();
  mockService<Services,'cli'>('cli',{claudeCode:{validateResumeTarget:validate,closeIdleConversation:vi.fn(async()=>true),getHandle:vi.fn()} as never});
  mockService<Services,'chat'>('chat',{createThreadAndNotify:create,sendBlockMessage:notify});
  const app=await startApp({systems:['brain']});
  await app.runFlow('Claude Code');
  const {id}=repository.threadCommands.create({topic:'Compiled fork',instructions:''});
  repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}});
  repository.chatCommands.addMessage({threadId:id,sender:'assistant',text:'Original',context:{cliUuid:'native-assistant'}});
  const run=await app.runFlow('Claude Code',{event:'user.command',data:{command:'cc-fork',threadId:id}});
  expect(run.steps.map(actionLabel)).toContain('CC: Fork');
  expect(validate).toHaveBeenCalledWith({sessionId:'native-session',messageUuid:'native-assistant',cwd:'/fixture'});
  expect(create).not.toHaveBeenCalled();
  expect(repository.threadCommands.forkCount(id)).toBe(0);
  expect(repository.chatQueries.threadData(id)?.messages).toHaveLength(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('No message found')}));
});
