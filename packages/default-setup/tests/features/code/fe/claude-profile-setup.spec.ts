import { createActor, fromTransition } from 'xstate'
import { answerTo } from '@apackdev/sdk/testing'
import { sentCall } from '../../../_support/calls.ts'
const sendToSystem=vi.hoisted(()=>vi.fn())
vi.mock('#generated/events.ts',()=>({sendToSystem}))
vi.mock('#extensions/terminal/pool.ts',()=>({terminalPool:{dispose:vi.fn(),syncProcesses:vi.fn()}}))
vi.mock('#features/code/fe/utils/terminal-events.ts',()=>({terminalEventBus:{emit:vi.fn(),clearOutput:vi.fn(),prunePersistedOutputs:vi.fn()}}))
const {default:codeState}=await import('#features/code/fe/state.ts')
const actors:ReturnType<typeof createActor>[]=[]
function windowActor(){
 const events:unknown[]=[]
 const empty=fromTransition(state=>state,{})
 const terminal=fromTransition((state,event)=>{events.push(event);return state},{})
 const machine=codeState.provide({actors:{explorerState:empty,terminalState:terminal,searchState:empty,commitState:empty,pullRequestState:empty,actionsState:empty,promptsState:empty} as never,actions:{restorePersistedTabs:()=>{}}})
 const actor=createActor(machine).start();actors.push(actor)
 return {actor,events}
}
afterEach(()=>{for(const actor of actors.splice(0))actor.stop();sendToSystem.mockReset()})

it('opens setup only for its window and call, ignoring duplicates and stale answers',()=>{
 const first=windowActor(),other=windowActor()
 first.actor.send({type:'OPEN_CLAUDE_PROFILE_SETUP'})
 first.actor.send({type:'OPEN_CLAUDE_PROFILE_SETUP'})
 const call=sentCall(sendToSystem,'PREPARE_CLAUDE_PROFILE_SETUP')
 expect(sendToSystem).toHaveBeenCalledTimes(1)
 const ready=answerTo(call,{type:'CLAUDE_PROFILE_SETUP_PREPARED' as const,result:{cwd:'/project',command:'native-onboarding'}})
 other.actor.send(ready);expect(other.events).toEqual([])
 first.actor.send(ready)
 expect(first.events).toEqual([{type:'terminal.CREATE',target:'tab',title:'Claude profile setup',cwd:'/project',command:'native-onboarding'}])
 first.actor.send(ready);expect(first.events).toHaveLength(1)
 first.actor.send({type:'OPEN_CLAUDE_PROFILE_SETUP'})
 first.actor.send(ready);expect(first.events).toHaveLength(1)
 expect(first.actor.getSnapshot().context.pendingClaudeProfileSetup).not.toBe(call)
 const next=sentCall(sendToSystem,'PREPARE_CLAUDE_PROFILE_SETUP',1)
 first.actor.send({type:'BASE_DIRECTORY_CHANGED',baseDirectory:'/another/project'})
 first.actor.send(answerTo(next,{type:'CLAUDE_PROFILE_SETUP_PREPARED',result:{cwd:'/project',command:'stale-onboarding'}}))
 expect(first.events).toHaveLength(1)
 expect(first.actor.getSnapshot().context.pendingClaudeProfileSetup).toBeUndefined()
})

it('shows a setup refusal and clears pending work without opening a terminal command',()=>{
 const {actor,events}=windowActor();actor.send({type:'OPEN_CLAUDE_PROFILE_SETUP'})
 const call=sentCall(sendToSystem,'PREPARE_CLAUDE_PROFILE_SETUP')
 actor.send(answerTo(call,{type:'CLAUDE_PROFILE_SETUP_PREPARED',result:{error:'Choose a project first'}}))
 expect(events).toEqual([])
 expect(actor.getSnapshot().context.claudeProfileSetupError).toBe('Choose a project first')
 expect(actor.getSnapshot().context.pendingClaudeProfileSetup).toBeUndefined()
 actor.send({type:'DISMISS_CLAUDE_PROFILE_SETUP_ERROR'})
 expect(actor.getSnapshot().context.claudeProfileSetupError).toBeUndefined()
})
