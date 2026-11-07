import {expect,it,vi} from 'vitest';
import {mockService} from '@apackdev/testing/harness';
import {services,type Services} from '#generated/services.ts';
import {repository} from '#generated/repository.ts';
import {action} from '../../../../src/content/actions/claude-code/handle-fork.ts';
function fixture(reject=false){
 const source=repository.threadCommands.create({topic:'Native source',instructions:''}).id;
 const target=repository.threadCommands.create({topic:'Fork target',instructions:''}).id;
 repository.threadCommands.update(source,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}});
 repository.threadCommands.update(target,{context:{claudeCode:{forkPending:true}}});
 const initialUser=repository.chatCommands.addMessage({threadId:source,sender:'user',text:'Initial request'});
 const first=repository.chatCommands.addMessage({threadId:source,sender:'assistant',text:'First',context:{cliUuid:'first-uuid'}});
 const user=repository.chatCommands.addMessage({threadId:source,sender:'user',text:'Next'});
 repository.chatCommands.addMessage({threadId:source,sender:'assistant',text:'Later',context:{cliUuid:'later-uuid'}});
 const validate=vi.fn(async()=>{if(reject)throw Error('No message found');});
 const context=vi.fn(async()=>({}));
 mockService<Services,'cli'>('cli',{claudeCode:{closeIdleConversation:vi.fn(async()=>true),getHandle:vi.fn(),validateResumeTarget:validate,getContextUsage:context} as never});
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()});
 return{source,target,first,user,initialUser,validate,context};
}
it('uses the selected earlier native boundary rather than the end',async()=>{
 const f=fixture();
 expect(await action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:f.user.id},services)).toMatchObject({success:true,cliUuid:'first-uuid'});
 expect(f.validate).toHaveBeenCalledWith({sessionId:'native-session',messageUuid:'first-uuid',cwd:'/fixture'});
 expect(repository.threadQueries.byId(f.target)?.context?.claudeCode).toMatchObject({forkFrom:{sessionId:'native-session',cliUuid:'first-uuid'}});
});
it('blocks a failed fork without copying an unvalidated session or replaying queued input',async()=>{
 const f=fixture(true);const before=repository.threadQueries.byId(f.source)?.context;
 repository.threadCommands.update(f.target,{context:{claudeCode:{forkPending:true,queuedMessage:{text:'Keep this input'}}}});
 expect((await action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:f.first.id},services)).success).toBe(false);
 expect(repository.threadQueries.byId(f.target)?.context?.claudeCode).toMatchObject({historyError:'No message found',queuedMessage:{text:'Keep this input'}});
 expect(repository.threadQueries.byId(f.target)?.context?.claudeCode?.sessionId).toBeUndefined();
 expect(repository.threadQueries.byId(f.source)?.context).toEqual(before);
});
it('validates an explicitly requested whole-session fork without a selected boundary',async()=>{
 const f=fixture();
 expect((await action({sourceThreadId:f.source,newThreadId:f.target},services)).success).toBe(true);
 expect(f.context).toHaveBeenCalled();expect(f.validate).not.toHaveBeenCalled();
});
it('refuses a selected message that disappeared instead of changing the fork point',async()=>{
 const f=fixture();
 expect((await action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:'missing'},services)).success).toBe(false);
 expect(f.validate).not.toHaveBeenCalled();expect(f.context).not.toHaveBeenCalled();
});
it('allows a native-accepted boundary inherited by a nested fork',async()=>{
 const f=fixture();
 repository.threadCommands.update(f.source,{context:{claudeCode:{sessionId:'nested-session',cwd:'/fixture'}}});
 expect((await action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:f.first.id},services)).success).toBe(true);
 expect(f.validate).toHaveBeenCalledWith({sessionId:'nested-session',messageUuid:'first-uuid',cwd:'/fixture'});
});
it('rejects a source changed during native validation',async()=>{
 const f=fixture();let release!:()=>void;
 f.validate.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
 const pending=action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:f.first.id},services);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 repository.chatCommands.addMessage({threadId:f.source,sender:'user',text:'Concurrent turn'});release();
 expect((await pending).success).toBe(false);
 expect(repository.threadQueries.byId(f.target)?.context?.claudeCode?.sessionId).toBeUndefined();
});

it('does not substitute session end when the selected prefix has no native assistant',async()=>{
 const f=fixture();
 expect((await action({sourceThreadId:f.source,newThreadId:f.target,sourceMessageId:f.initialUser.id},services)).success).toBe(false);
 expect(f.validate).not.toHaveBeenCalled();expect(f.context).not.toHaveBeenCalled();
 expect(repository.threadQueries.byId(f.target)?.context?.claudeCode?.historyError).toBeDefined();
});
