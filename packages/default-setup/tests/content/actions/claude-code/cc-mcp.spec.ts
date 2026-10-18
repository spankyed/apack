import { expect,it,vi } from 'vitest'
import { mockService } from '@apackdev/testing/harness'
import { services,type Services } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { action } from '../../../../src/content/actions/claude-code/cc-command.ts'
function fixture() {
 const{id}=repository.threadCommands.create({topic:'MCP',instructions:''})
 const exec=vi.fn(async()=>({stdout:'configured server',stderr:''})),get=vi.fn(),conversation=vi.fn()
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:get,getConversation:conversation,exec} as never})
 mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()})
 return {id,exec,get,conversation,run:(text='')=>action({command:'cc-mcp',threadId:id,text},services,{} as never,'')}
}
it('reads actual native status/tools without running the configuration CLI',async()=>{
 const f=fixture(),getMcpStatus=vi.fn(async()=>({mcpServers:[{name:'research',status:'connected',serverInfo:{name:'fixture',version:'1'},tools:[{name:'echo'}]}]}))
 f.get.mockReturnValue({state:{sessionId:'native'},getMcpStatus})
 const result=await f.run();expect(result.text).toContain('Live MCP connections:');expect(result.text).toContain('research: connected');expect(result.text).toContain('echo')
 expect(getMcpStatus).toHaveBeenCalledOnce();expect(f.exec).not.toHaveBeenCalled()
})
it('refuses an old owner response after replacement',async()=>{
 const f=fixture(),native={state:{sessionId:'native'},getMcpStatus:vi.fn(async()=>({mcpServers:[]}))}
 f.get.mockReturnValueOnce(native).mockReturnValueOnce({...native})
 expect((await f.run('status')).text).toContain('conversation changed');expect(f.exec).not.toHaveBeenCalled()
})
it('reads the existing print handle without another process',async()=>{
 const f=fixture(),getMcpStatus=vi.fn(async()=>({mcpServers:[{name:'failed-server',status:'failed'}]})),conversation={owner:{sessionId:'native',handle:{getMcpStatus}}}
 f.conversation.mockReturnValue(conversation)
 expect((await f.run('list')).text).toContain('failed-server: failed');expect(f.exec).not.toHaveBeenCalled()
})
it('distinguishes no live owner from saved configuration without starting one for status',async()=>{
 const f=fixture();expect((await f.run('status')).text).toContain('No live Claude conversation');expect(f.exec).not.toHaveBeenCalled()
 expect((await f.run('list')).text).toContain('Saved MCP configuration:');expect(f.exec).toHaveBeenCalledWith(['mcp','list'])
})
