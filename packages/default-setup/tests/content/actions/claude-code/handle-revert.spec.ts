import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as handleRevert } from '../../../../src/content/actions/claude-code/handle-revert.ts';
import type { EARS } from '@apackdev/ears';

// The action runs on the harness's services: a real thread and messages in the in-memory database,
// with the CLI and the chat, threads, settings and artifact services it drives mocked
async function createServices(nativeError?: Error, sendBlockMessage = vi.fn()) {
  const { id: threadId } = repository.threadCommands.create({ topic: 'Revert', instructions: '', tags: ['claude-code'] });
  repository.threadCommands.update(threadId, { context: { claudeCode: { sessionId: 'session-1', cwd: '/project', isRunning: false } } });
  repository.chatCommands.addMessage({ threadId, sender: 'user', text: 'hello' });
  const assistant = repository.chatCommands.addMessage({ threadId, sender: 'assistant', text: 'hi', context: { cliUuid: 'uuid-1' } });

  const clearHandle = vi.fn();
  const validateResumeTarget = vi.fn(async () => { if (nativeError) throw nativeError; });
  mockService<Services, 'cli'>('cli', {
    claudeCode: {
      closeIdleConversation:vi.fn(async()=>true),getNativeTerminal: vi.fn(() => undefined), getHandle: vi.fn(() => undefined),
      clearHandle, validateResumeTarget,
    } as never,
  });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'artifact'>('artifact', { findOrCreateByType: vi.fn(() => ({ artifactId: 'Artifact-art-1' as EARS.EntityId, created: true })) });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { threadId, messageId: assistant.id, clearHandle, validateResumeTarget };
}

describe('CC: Handle Revert', () => {
  it('persists the boundary accepted by native resume', async () => {
    const {threadId,messageId,...spies}=await createServices();
    const result=await handleRevert({threadId,messageId},services);
    expect(result).toMatchObject({success:true,cliUuid:'uuid-1'});
    expect(spies.validateResumeTarget).toHaveBeenCalledWith({sessionId:'session-1',messageUuid:'uuid-1',cwd:'/project'});
    expect(repository.threadQueries.byId(threadId)?.context?.claudeCode).toMatchObject({sessionId:'session-1',revertTo:{cliUuid:'uuid-1'}});
  });
  it('preserves native session state when the boundary is rejected instead of starting fresh',async()=>{
    const {threadId,messageId,...spies}=await createServices(new Error('No message found'));
    const before=repository.threadQueries.byId(threadId)?.context;
    expect((await handleRevert({threadId,messageId},services)).success).toBe(false);
    expect(repository.threadQueries.byId(threadId)?.context).toMatchObject({...before,claudeCode:{...before?.claudeCode,historyError:'No message found'}});
    expect(spies.clearHandle).not.toHaveBeenCalled();
  });
  it('rejects a source changed during validation instead of overwriting its newer state',async()=>{
    const {threadId,messageId,...spies}=await createServices();
    let release!:()=>void;
    vi.mocked(spies.validateResumeTarget).mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
    const pending=handleRevert({threadId,messageId},services);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    repository.threadCommands.update(threadId,{context:{claudeCode:{sessionId:'new-session',cwd:'/project'}}});
    release();
    expect((await pending).success).toBe(false);
    expect(repository.threadQueries.byId(threadId)?.context?.claudeCode?.sessionId).toBe('new-session');
  });
  it('starts fresh only when the selected remaining prefix has no native assistant',async()=>{
    const {threadId,messageId,...spies}=await createServices();
    repository.chatCommands.softDeleteMessagesAfter({threadId,messageId});
    expect(await handleRevert({threadId,messageId},services)).toMatchObject({success:true,cliUuid:undefined});
    expect(spies.validateResumeTarget).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(threadId)?.context?.claudeCode?.sessionId).toBeUndefined();
  });
  it('preserves an active turn instead of killing it during downstream validation',async()=>{
    const {threadId,messageId,...spies}=await createServices();
    repository.threadCommands.update(threadId,{context:{claudeCode:{sessionId:'session-1',cwd:'/project',isRunning:true}}});
    expect((await handleRevert({threadId,messageId},services)).success).toBe(false);
    expect(spies.validateResumeTarget).not.toHaveBeenCalled();
    expect(spies.clearHandle).not.toHaveBeenCalled();
  });

});
