import {tmpdir} from 'node:os'
import {prepareClaudeNativeTerminal} from '#features/code/be/services/claude-code/terminal-owner.ts'
const f=vi.hoisted(()=>{vi.resetModules();return{spawn:vi.fn(),owns:vi.fn(),nativePid:2202 as number|undefined}})
vi.mock('node-pty',()=>({spawn:f.spawn}))
vi.mock('#features/code/be/services/claude-code/native-process-ownership.ts',()=>({isClaudeNativeDescendant:f.owns}))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts',()=>({createClaudeTerminalBridge:async()=>({
 pluginRoot:'/private/fixture-plugin',bunOptions:'fixture-preload',close:async()=>{},ready:true,get nativePid(){return f.nativePid},
 projection:{sessionId:'11111111-1111-1111-1111-111111111111',tasks:[]},session:{metadata:{}},uiTransport:{},
})}))
async function fixture(){
 let onExit!:(event:{exitCode:number})=>void
 const kill=vi.fn(()=>onExit({exitCode:0}))
 f.spawn.mockReturnValue({pid:2201,onData(){},onExit(callback:typeof onExit){onExit=callback},kill})
 const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:tmpdir(),cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]}})
 const owner=await prepared.start()
 return{owner,kill,exit:()=>onExit({exitCode:0})}
}
beforeEach(()=>{vi.clearAllMocks();f.nativePid=2202;f.owns.mockResolvedValue(true)})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
it('signals only the verified original CLI first, leaving its owned servers alive for shutdown',async()=>{
 const signal=vi.spyOn(process,'kill').mockReturnValue(true),x=await fixture()
 x.owner.kill();await Promise.resolve();await Promise.resolve()
 expect(f.owns).toHaveBeenCalledWith(2202,2201)
 expect(signal).toHaveBeenCalledExactlyOnceWith(2202,'SIGTERM');expect(x.kill).not.toHaveBeenCalled()
 x.exit();await x.owner.done
})
it('falls back to the owned group when the native identity cannot be verified',async()=>{
 f.owns.mockResolvedValue(false)
 const signal=vi.spyOn(process,'kill').mockReturnValue(true),x=await fixture()
 x.owner.kill();await Promise.resolve();await x.owner.done
 expect(signal).toHaveBeenCalledWith(-2201,'SIGTERM');expect(signal).not.toHaveBeenCalledWith(2202,'SIGTERM');expect(x.kill).toHaveBeenCalledOnce()
})
it('does not signal a late ownership result after the terminal has already exited',async()=>{
 let release!:(value:boolean)=>void;f.owns.mockImplementation(()=>new Promise<boolean>(yes=>{release=yes}))
 const signal=vi.spyOn(process,'kill').mockReturnValue(true),x=await fixture()
 x.owner.kill();x.exit();await x.owner.done;release(true);await Promise.resolve()
 expect(signal).not.toHaveBeenCalled();expect(x.kill).not.toHaveBeenCalled()
})
it('retains the bounded hard group stop when the original CLI does not exit',async()=>{
 const signal=vi.spyOn(process,'kill').mockReturnValue(true),x=await fixture();vi.useFakeTimers()
 x.owner.kill();x.owner.kill();await Promise.resolve()
 expect(signal).toHaveBeenCalledExactlyOnceWith(2202,'SIGTERM')
 await vi.advanceTimersByTimeAsync(2000);expect(signal).toHaveBeenLastCalledWith(-2201,'SIGKILL')
 x.exit();await x.owner.done
})
it('uses group cancellation before the native CLI has connected',async()=>{
 f.nativePid=undefined
 const signal=vi.spyOn(process,'kill').mockReturnValue(true),x=await fixture()
 x.owner.kill();await x.owner.done
 expect(f.owns).not.toHaveBeenCalled();expect(signal).toHaveBeenCalledWith(-2201,'SIGTERM')
})
