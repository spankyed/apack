import { action as onboardImport } from '../../../../src/content/actions/onboarding/steps/handle-cc-import-threads-step.ts'
import { chatService } from '#features/threads/be/services/chat.ts'
import { importedSessionMetadata } from '../../../../src/content/actions/claude-code/_helpers/session-import.ts'
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
 const transcript=vi.fn(async()=>[{type:'cost-state',totalCostUSD:1.25}]),open=vi.fn(),create=vi.fn((opts:{topic:string;instructions:string})=>repository.threadCommands.create(opts))
 mockService<Services,'cli'>('cli',{claudeCode:{listSessions:vi.fn(async()=>[{id:'native-session',cwd:'/fixture'}]),viewSession:transcript,getNativeTerminal:vi.fn(),getConversation:vi.fn()} as never})
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()})
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn(),openThreadChatAndRefreshRecent:open,createThreadAndNotify:create})
 await action({command:'cc-resume',text:'native-session',threadId:fork.id},services,{} as never,'')
 expect(transcript).toHaveBeenCalledWith('native-session',{cwd:'/fixture'})
 expect(create).toHaveBeenCalledOnce();const imported=create.mock.results[0]!.value.id
 expect(open).toHaveBeenCalledWith(imported)
 expect(repository.threadQueries.byId(fork.id)?.context?.claudeCode?.forkFrom).toBeDefined()
 expect(repository.threadQueries.byId(imported)?.context?.claudeCode?.forkFrom).toBeUndefined()
 expect(repository.threadQueries.byId(imported)?.context?.claudeCode?.totalCostUsd).toBe(1.25)
})

it('bulk import retains native cumulative cost without charging a new turn', async () => {
 const caller=repository.threadCommands.create({topic:'Import',instructions:''})
 const transcript=[{type:'cost-state',totalCostUSD:0.5},{type:'cost-state',totalCostUSD:1.25},{type:'cost-state',totalCostUSD:-1},{type:'cost-state',totalCostUSD:Number.NaN}]
 mockService<Services,'cli'>('cli',{claudeCode:{listSessions:vi.fn(async()=>[{id:'saved-native',cwd:'/fixture'}]),viewSession:vi.fn(async()=>transcript)} as never})
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn(()=>({messageId:'Message-progress' as const})),updateMessageState:vi.fn()})
 await action({command:'cc-import',threadId:caller.id},services,{} as never,'')
 const imported=repository.threadQueries.all().find(t=>t.context?.claudeCode?.sessionId==='saved-native')
 expect(imported?.context?.claudeCode).toMatchObject({cwd:'/fixture',totalCostUsd:1.25})
});

it('projects native model, turn UUIDs, tools and timestamps without counting tool-result or meta inputs', () => {
 const user={type:'user',uuid:'human',timestamp:'2026-10-18T01:00:00Z',message:{content:'Hello'}}
 expect(importedSessionMetadata([user,user,{type:'user',uuid:'tool',message:{content:[{type:'tool_result'}]}},{type:'user',isMeta:true,message:{content:'Meta'}},{type:'assistant',timestamp:'2026-10-18T01:00:02Z',message:{model:'native-model',content:[{type:'tool_use',id:'tool-id'}]}},{type:'assistant',message:{model:'<synthetic>',content:[{type:'tool_use',id:'tool-id'}]}},{type:'cost-state',totalCostUSD:1.25}])).toEqual({model:'native-model',turns:1,toolCallCount:1,startedAt:Date.parse('2026-10-18T01:00:00Z'),lastTurnAt:Date.parse('2026-10-18T01:00:02Z'),totalCostUsd:1.25})
});

it('onboarding imports the same native metadata into thread context and remains idempotent', async () => {
 const caller=repository.threadCommands.create({topic:'Onboarding',instructions:''})
 repository.threadCommands.update(caller.id,{context:{onboarding:{step:'import-threads',threadId:caller.id,pendingMessageId:'Message-choice',data:{ccSessionCount:1}}}})
 const transcript=[{type:'user',uuid:'native-user',timestamp:'2026-10-18T01:00:00Z',message:{role:'user',content:'Hello'}},{type:'assistant',uuid:'native-answer',timestamp:'2026-10-18T01:00:02Z',message:{model:'native-model',content:[{type:'text',text:'Answer'}]}},{type:'cost-state',totalCostUSD:1.25}]
 mockService<Services,'cli'>('cli',{claudeCode:{listAllSessions:vi.fn(async()=>[{id:'onboarding-native',cwd:'/fixture'}]),viewSession:vi.fn(async()=>transcript)} as never})
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()})
 mockService<Services,'chat'>('chat',{...chatService,sendChoiceBlock:vi.fn(()=>({messageId:'Message-choice' as const})),sendRecentThreadsRefresh:vi.fn()})
 await onboardImport({threadId:caller.id,response:['cc']},services)
 const imported=repository.threadQueries.all().find(t=>t.context?.claudeCode?.sessionId==='onboarding-native')
 expect(imported?.context?.claudeCode).toMatchObject({cwd:'/fixture',model:'native-model',turns:1,totalCostUsd:1.25,startedAt:Date.parse('2026-10-18T01:00:00Z'),lastTurnAt:Date.parse('2026-10-18T01:00:02Z')})
 expect(repository.chatQueries.threadData(imported!.id)?.messages?.map(m=>m.context?.cliUuid)).toEqual(['native-user','native-answer'])
 await onboardImport({threadId:caller.id,response:['cc']},services)
 expect(repository.threadQueries.all().filter(t=>t.context?.claudeCode?.sessionId==='onboarding-native')).toHaveLength(1)
});
