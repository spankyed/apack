// How the native owner stops the CLI it drives, which is three signals to two targets and not one kill.
//
// **`terminate` is not what this wants.** It ends the session and everything under it, where shutting the
// CLI down means signalling the CLI so the servers it owns outlive its own shutdown handlers, then its
// group, then the group harder. `services.terminal` has `signal` with a scope for exactly that.
//
// **Which pid the broker owns is the broker's to check, not this process's.** It used to walk the parent
// chain with `ps` before signalling, to be sure the pid the bridge named was inside the tree. The broker
// refuses a pid outside the session's own tree (`OUTSIDE_SESSION`), so the walk is gone — and because a
// signal is carried out or refused with no answer on success, the app never learns that one was rejected.
// What covers a bridge naming a pid the broker does not own is the escalation below, which was always the
// backstop for a CLI that does not go.
import {tmpdir} from 'node:os'
import {prepareClaudeNativeTerminal} from '#features/code/be/services/claude-code/terminal-owner.ts'
import {nativeSession} from '../../_support/native-terminal.ts'
const f=vi.hoisted(()=>{vi.resetModules();return{open:vi.fn(),nativePid:2202 as number|undefined}})
vi.mock('#generated/services.ts',()=>({services:{terminal:{open:f.open}}}))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts',()=>({createClaudeTerminalBridge:async()=>({
 pluginRoot:'/private/fixture-plugin',bunOptions:'fixture-preload',close:async()=>{},ready:true,get nativePid(){return f.nativePid},
 projection:{sessionId:'11111111-1111-1111-1111-111111111111',tasks:[]},session:{metadata:{}},uiTransport:{},
})}))
/**
 * **The session's signal records and does not end it**, which is what lets a case see the escalation: the
 * real broker's SIGTERM may well be ignored by the CLI, and that is the case each of these is about.
 */
async function fixture(){
 let onExit!:(code:number|null,signal:string|null)=>void
 const signal=vi.fn(async()=>{})
 f.open.mockImplementation(async(_options,listeners)=>{onExit=listeners.onExit;return nativeSession(listeners,{pid:2201,signal})})
 const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:tmpdir(),cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]}})
 const owner=await prepared.start()
 return{owner,signal,exit:()=>onExit(0,null)}
}
beforeEach(()=>{vi.clearAllMocks();f.nativePid=2202})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
it('signals the original CLI by its own pid first, leaving its owned servers alive for shutdown',async()=>{
 const x=await fixture()
 x.owner.kill();await Promise.resolve();await Promise.resolve()
 // The CLI alone: the group would take the servers it is still tidying up with it
 expect(x.signal).toHaveBeenCalledExactlyOnceWith('SIGTERM',{kind:'pid',pid:2202})
 x.exit();await x.owner.done
})
it('uses the group and the session leader before the native CLI has connected',async()=>{
 f.nativePid=undefined
 const x=await fixture()
 x.owner.kill();await Promise.resolve();await Promise.resolve()
 expect(x.signal.mock.calls).toEqual([['SIGTERM',{kind:'group'}],['SIGTERM',{kind:'leader'}]])
 x.exit();await x.owner.done
})
it('escalates to the group once the CLI has not gone, however many times it was asked to stop',async()=>{
 const x=await fixture();vi.useFakeTimers()
 x.owner.kill();x.owner.kill();await Promise.resolve();await Promise.resolve()
 expect(x.signal).toHaveBeenCalledExactlyOnceWith('SIGTERM',{kind:'pid',pid:2202})
 await vi.advanceTimersByTimeAsync(2000)
 expect(x.signal.mock.calls.slice(1)).toEqual([['SIGKILL',{kind:'group'}],['SIGKILL',{kind:'leader'}]])
 x.exit();await x.owner.done
})
it('signals nothing more once the terminal has already exited',async()=>{
 const x=await fixture();vi.useFakeTimers()
 x.owner.kill();await Promise.resolve();await Promise.resolve()
 x.exit();await x.owner.done
 const sent=x.signal.mock.calls.length
 await vi.advanceTimersByTimeAsync(2000)
 expect(x.signal.mock.calls).toHaveLength(sent)
})
