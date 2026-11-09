import { expect,it,vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services,type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/handle-rewind.ts';
function fixture(preview={canRewind:true},verdict:Record<string,unknown>={canRewind:true,skippedLinks:0}){
 const{id}=repository.threadCommands.create({topic:'Rewind',instructions:''});
 repository.threadCommands.update(id,{context:{claudeCode:{sessionId:'native-session',cwd:'/fixture'}}});
 const message=repository.chatCommands.addMessage({threadId:id,sender:'user',text:'Pivot',context:{cliUuid:'native-user'}});
 const inspect=vi.fn(async()=>preview),rewind=vi.fn(async()=>verdict),revert=vi.fn(async()=>({success:true})),notify=vi.fn();
 mockService<Services,'cli'>('cli',{claudeCode:{getFileRewindPreview:inspect,rewindFiles:rewind} as never});
 mockService<Services,'action'>('action',{executeIfFound:revert});
 mockService<Services,'chat'>('chat',{sendBlockMessage:notify});
 return{id,message,inspect,rewind,revert,notify};
}
it('checks native preview before common revert and restores the original session checkpoint',async()=>{
 const f=fixture();
 expect(await action({threadId:f.id,messageId:f.message.id},services)).toMatchObject({success:true,filesRestored:true});
 expect(f.inspect.mock.invocationCallOrder[0]).toBeLessThan(f.revert.mock.invocationCallOrder[0]);
 expect(f.revert.mock.invocationCallOrder[0]).toBeLessThan(f.rewind.mock.invocationCallOrder[0]);
 expect(f.rewind).toHaveBeenCalledWith({sessionId:'native-session',userMessageId:'native-user',cwd:'/fixture'});
});
it('does not revert or restore when a checkpoint is unavailable',async()=>{
 const f=fixture({canRewind:false});
 expect((await action({threadId:f.id,messageId:f.message.id},services)).success).toBe(false);
 expect(f.revert).not.toHaveBeenCalled();expect(f.rewind).not.toHaveBeenCalled();
});
it('reports a partial native restoration as failure',async()=>{
 const f=fixture({canRewind:true},{canRewind:true,skippedLinks:1});
 expect(await action({threadId:f.id,messageId:f.message.id},services)).toMatchObject({success:false,filesRestored:false});
 expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('some files may have been restored')}));
});
it('rejects a stale frontend checkpoint identity instead of restoring another turn',async()=>{
 const f=fixture();
 expect((await action({threadId:f.id,messageId:f.message.id,userCliUuid:'other-user'},services)).success).toBe(false);
 expect(f.inspect).not.toHaveBeenCalled();expect(f.revert).not.toHaveBeenCalled();expect(f.rewind).not.toHaveBeenCalled();
});
