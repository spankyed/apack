import { expect, it, vi } from 'vitest'
import { mockService, startApp } from '@apackdev/testing/harness'
import { testRootEvents } from '@apackdev/sdk/testing'
import type { Services } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { chatService } from '#features/threads/be/services/chat.ts'
import { registerThreadTeardown } from '#features/threads/be/thread-teardown.ts'

function fixture(validate = vi.fn(async () => {})) {
  const {id} = repository.threadCommands.create({topic:'Native source',instructions:''})
  repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}})
  const first=repository.chatCommands.addMessage({threadId:id,sender:'assistant',text:'First',context:{cliUuid:'native-first'}})
  const pivot=repository.chatCommands.addMessage({threadId:id,sender:'user',text:'Pivot',context:{agent:'Claude Code'}})
  repository.chatCommands.addMessage({threadId:id,sender:'assistant',text:'Later',context:{cliUuid:'native-later'}})
  const notify=vi.fn()
  mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:vi.fn(),validateResumeTarget:validate,closeIdleConversation:vi.fn(async()=>true),getHandle:vi.fn()} as never})
  mockService<Services,'chat'>('chat',{...chatService,sendBlockMessage:notify})
  return {id,first,pivot,validate,notify}
}
for (const type of ['FORK_THREAD','REVERT_THREAD','SUMMARIZE_THREAD'] as const) {
  it(`${type} preserves source history and processes when native validation rejects`,async()=>{
    const app=await startApp({systems:['threads']})
    const f=fixture(vi.fn(async()=>{throw Error('No message found')}))
    const before=repository.chatQueries.threadData(f.id)?.messages
    const teardown=vi.fn();registerThreadTeardown(threadId=>{if(threadId===f.id)teardown()})
    await app.send('threads',{type,threadId:f.id,messageId:type==='FORK_THREAD'?f.first.id:f.pivot.id})
    await vi.waitFor(()=>expect(f.notify).toHaveBeenCalled())
    expect(f.validate).toHaveBeenCalledWith(expect.objectContaining({sessionId:'native-session',messageUuid:'native-first',signal:expect.any(AbortSignal)}))
    expect(repository.chatQueries.threadData(f.id)?.messages).toEqual(before)
    expect(repository.threadCommands.forkCount(f.id)).toBe(0)
    expect(teardown).not.toHaveBeenCalled()
  })
}
it('keeps the fork navigation reply addressed to its original requester after validation',async()=>{
  const app=await startApp({systems:['threads']})
  const f=fixture()
  const clients:Array<string|undefined>=[]
  const off=testRootEvents.onSurfaceSend(message=>{if(message.to==='default-setup/threads'&&message.event.type==='LOAD_CHAT_THREAD')clients.push(message.client)})
  try {
    await app.send('threads',{type:'FORK_THREAD',threadId:f.id,messageId:f.first.id},{sender:'default-setup/threads',client:'fork-window'})
    await vi.waitFor(()=>expect(repository.threadCommands.forkCount(f.id)).toBe(1))
    expect(clients).toEqual(['fork-window'])
  } finally {off()}
})
it('cancels a menu mutation if the source changes during native validation',async()=>{
  const app=await startApp({systems:['threads']})
  let release!:()=>void
  const f=fixture(vi.fn(()=>new Promise<void>(resolve=>{release=resolve})))
  await app.send('threads',{type:'REVERT_THREAD',threadId:f.id,messageId:f.pivot.id})
  await vi.waitFor(()=>expect(f.validate).toHaveBeenCalled())
  repository.chatCommands.addMessage({threadId:f.id,sender:'user',text:'Concurrent input'})
  release()
  await vi.waitFor(()=>expect(f.notify).toHaveBeenCalled())
  expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(4)
})
for (const type of ['REVERT_THREAD','SUMMARIZE_THREAD'] as const) {
  it(`${type} tears down and deletes only after native validation accepts`,async()=>{
    const app=await startApp({systems:['threads']})
    let release!:()=>void
    const f=fixture(vi.fn(()=>new Promise<void>(resolve=>{release=resolve})))
    const teardown=vi.fn();registerThreadTeardown(threadId=>{if(threadId===f.id)teardown()})
    await app.send('threads',{type,threadId:f.id,messageId:f.pivot.id})
    await vi.waitFor(()=>expect(f.validate).toHaveBeenCalled())
    expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(3)
    expect(teardown).not.toHaveBeenCalled()
    release()
    await vi.waitFor(()=>expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(1))
    expect(teardown).toHaveBeenCalledOnce()
  })
}
it('stopping the parent aborts pending native validation and prevents late mutation',async()=>{
  const app=await startApp({systems:['threads']})
  let release!:()=>void
  const f=fixture(vi.fn(()=>new Promise<void>(resolve=>{release=resolve})))
  await app.send('threads',{type:'REVERT_THREAD',threadId:f.id,messageId:f.pivot.id})
  await vi.waitFor(()=>expect(f.validate).toHaveBeenCalled())
  const signal=(f.validate.mock.calls[0] as unknown as [{signal:AbortSignal}])[0].signal
  app.stop()
  expect(signal.aborted).toBe(true)
  release()
  await new Promise(resolve=>setTimeout(resolve,0))
  expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(3)
  expect(f.notify).not.toHaveBeenCalled()
})
it('does not ask Claude to validate a revert affecting only another provider',async()=>{
  const app=await startApp({systems:['threads']})
  const f=fixture(vi.fn(async()=>{throw Error('must not run')}))
  const other=repository.chatCommands.addMessage({threadId:f.id,sender:'user',text:'Other provider',context:{agent:'Codex'}})
  repository.chatCommands.addMessage({threadId:f.id,sender:'assistant',text:'Other reply',context:{agent:'Codex'}})
  await app.send('threads',{type:'REVERT_THREAD',threadId:f.id,messageId:other.id})
  await vi.waitFor(()=>expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(3))
  expect(f.validate).not.toHaveBeenCalled()
  expect(f.notify).not.toHaveBeenCalled()
})
it('rejects an unavailable file checkpoint before deleting conversation history',async()=>{
 const app=await startApp({systems:['threads']});const f=fixture();
 const preview=vi.fn(async()=>({canRewind:false,error:'No file checkpoint found'}));
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:vi.fn(),closeIdleConversation:vi.fn(async()=>true),getHandle:vi.fn(),validateResumeTarget:f.validate,getFileRewindPreview:preview} as never});
 await app.send('threads',{type:'REVERT_THREAD',threadId:f.id,messageId:f.pivot.id,restoreFiles:true,userCliUuid:'native-user'});
 await vi.waitFor(()=>expect(f.notify).toHaveBeenCalled());
 expect(preview).toHaveBeenCalledWith(expect.objectContaining({sessionId:'native-session',userMessageId:'native-user'}));
 expect(repository.chatQueries.threadData(f.id)?.messages).toHaveLength(3);
 expect(f.validate).not.toHaveBeenCalled();
});

it('closes a retained idle process before validating menu history', async () => {
  const app = await startApp({ systems: ['threads'] })
  const f = fixture()
  let idle = true
  const close = vi.fn(async () => { idle = false; return true })
  mockService<Services, 'cli'>('cli', { claudeCode: {
    getNativeTerminal:vi.fn(), closeIdleConversation: close, getHandle: vi.fn(() => idle ? {} : undefined), validateResumeTarget: f.validate,
  } as never })
  await app.send('threads', { type: 'FORK_THREAD', threadId: f.id, messageId: f.first.id })
  await vi.waitFor(() => expect(repository.threadCommands.forkCount(f.id)).toBe(1))
  expect(close).toHaveBeenCalledWith(f.id)
  expect(close.mock.invocationCallOrder[0]).toBeLessThan(f.validate.mock.invocationCallOrder[0])
})

it('preserves a busy process and history before menu validation', async () => {
  const app = await startApp({ systems: ['threads'] })
  const f = fixture()
  const before = repository.chatQueries.threadData(f.id)?.messages
  mockService<Services, 'cli'>('cli', { claudeCode: {
    getNativeTerminal:vi.fn(), closeIdleConversation: vi.fn(async () => false), getHandle: vi.fn(() => ({})), validateResumeTarget: f.validate,
  } as never })
  await app.send('threads', { type: 'REVERT_THREAD', threadId: f.id, messageId: f.pivot.id })
  await vi.waitFor(() => expect(f.notify).toHaveBeenCalled())
  expect(f.validate).not.toHaveBeenCalled()
  expect(repository.chatQueries.threadData(f.id)?.messages).toEqual(before)
})

it('validates an idle native terminal without publishing shutdown changes before the history commit', async () => {
 const app=await startApp({systems:['threads']});const f=fixture()
 const close=vi.fn(async()=>{throw Error('Native shutdown must happen at commit')})
 const teardown=vi.fn();registerThreadTeardown(id=>{if(id===f.id)teardown()})
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:vi.fn(()=>({busy:false})),isConversationBusy:vi.fn(()=>false),closeIdleConversation:close,getHandle:vi.fn(),validateResumeTarget:f.validate} as never})
 await app.send('threads',{type:'REVERT_THREAD',threadId:f.id,messageId:f.pivot.id})
 await vi.waitFor(()=>expect(teardown).toHaveBeenCalled())
 expect(f.validate).toHaveBeenCalled();expect(close).not.toHaveBeenCalled()
 expect(f.validate.mock.invocationCallOrder[0]).toBeLessThan(teardown.mock.invocationCallOrder[0]!)
});
