import { expect, it, vi } from 'vitest'
import { mockService } from '@apackdev/testing/harness'
import { services, type Services } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { action } from '../../../../src/content/actions/claude-code/cc-command.ts'
function fixture(rename=vi.fn(async()=>({title:'Native accepted title',message:'Native rename result'}))) {
 const {id}=repository.threadCommands.create({topic:'Before rename',instructions:''})
 repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}})
 const native={state:{sessionId:'native-session'},renameSession:rename},get=vi.fn(()=>native),fallback=vi.fn()
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:get,getConversation:vi.fn(),renameSession:fallback} as never})
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()})
 return {id,native,get,fallback,rename,run:()=>action({command:'cc-rename',threadId:id,text:'Requested title'},services,{} as never,'')}
}
it('publishes the original native applied title instead of the requested spelling',async()=>{
 const f=fixture();expect((await f.run()).text).toBe('Native rename result')
 expect(f.rename).toHaveBeenCalledWith('Requested title');expect(f.fallback).not.toHaveBeenCalled()
 expect(repository.threadQueries.byId(f.id)?.topic).toBe('Native accepted title')
})
it('keeps the app title when native rename refuses',async()=>{
 const f=fixture(vi.fn(async()=>{throw Error('Original native refusal')}))
 expect((await f.run()).text).toContain('Original native refusal')
 expect(repository.threadQueries.byId(f.id)?.topic).toBe('Before rename')
})
it('does not publish an old owner acknowledgement after replacement',async()=>{
 const f=fixture();f.get.mockReturnValueOnce(f.native).mockReturnValueOnce({...f.native})
 expect((await f.run()).text).toContain('conversation changed')
 expect(repository.threadQueries.byId(f.id)?.topic).toBe('Before rename')
})
it('uses the existing print handle instead of spawning another session writer',async()=>{
 const f=fixture(),rename=vi.fn(async()=>{}),conversation={owner:{handle:{renameSession:rename}}}
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:vi.fn(),getConversation:vi.fn(()=>conversation),renameSession:f.fallback} as never})
 await f.run();expect(repository.threadQueries.byId(f.id)?.topic).toBe('Requested title');expect(rename).toHaveBeenCalledWith('Requested title','native-session');expect(f.fallback).not.toHaveBeenCalled()
})
