import { expect, it, vi } from 'vitest'
import { mockService } from '@apackdev/testing/harness'
import { services, type Services } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { action } from '../../../../src/content/actions/claude-code/cc-session-ops.ts'

for (const live of [false, true]) it(`reopens the represented session without duplicating history or its owner (live: ${live})`, async () => {
 const source=repository.threadCommands.create({topic:'Source',instructions:''})
 const caller=repository.threadCommands.create({topic:'Caller',instructions:''})
 repository.threadCommands.update(source.id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}})
 const original=repository.chatCommands.addMessage({threadId:source.id,sender:'assistant',text:'Native answer',context:{cliUuid:'native-uuid'}})
 const read=vi.fn(),create=vi.fn(),open=vi.fn()
 mockService<Services,'cli'>('cli',{claudeCode:{listSessions:vi.fn(async()=>[{id:'native-session',cwd:'/fixture'}]),viewSession:read,getNativeTerminal:vi.fn((id:string)=>live&&id===source.id?{state:{sessionId:'native-session'}}:undefined),getConversation:vi.fn()} as never})
 mockService<Services,'chat'>('chat',{createThreadAndNotify:create,sendBlockMessage:vi.fn(),openThreadChatAndRefreshRecent:open})
 await action({command:'cc-resume',text:'native-session',threadId:caller.id},services,{} as never,'')
 expect(open).toHaveBeenCalledWith(source.id);expect(create).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled()
 expect(repository.chatQueries.threadData(source.id)?.messages?.map(m=>m.id)).toEqual([original.id])
})
it('does not reopen a staged fork as the original saved session', async () => {
 const fork=repository.threadCommands.create({topic:'Pending fork',instructions:''})
 repository.threadCommands.update(fork.id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture',forkFrom:{sessionId:'native-session'}}}})
 const transcript=vi.fn(async()=>[]),open=vi.fn(),create=vi.fn((opts:{topic:string;instructions:string})=>repository.threadCommands.create(opts))
 mockService<Services,'cli'>('cli',{claudeCode:{listSessions:vi.fn(async()=>[{id:'native-session',cwd:'/fixture'}]),viewSession:transcript,getNativeTerminal:vi.fn(),getConversation:vi.fn()} as never})
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()})
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn(),openThreadChatAndRefreshRecent:open,createThreadAndNotify:create})
 await action({command:'cc-resume',text:'native-session',threadId:fork.id},services,{} as never,'')
 expect(transcript).toHaveBeenCalledWith('native-session',{cwd:'/fixture'})
 expect(create).toHaveBeenCalledOnce();const imported=create.mock.results[0]!.value.id
 expect(open).toHaveBeenCalledWith(imported)
 expect(repository.threadQueries.byId(fork.id)?.context?.claudeCode?.forkFrom).toBeDefined()
 expect(repository.threadQueries.byId(imported)?.context?.claudeCode?.forkFrom).toBeUndefined()
})
