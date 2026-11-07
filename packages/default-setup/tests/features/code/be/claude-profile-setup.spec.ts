import { mockService, startApp } from '@apackdev/testing/harness'
import type { Services } from '#generated/services.ts'

it('answers setup only to the requesting code surface and refuses an unaddressed request',async()=>{
 const prepare=vi.fn(async()=>({cwd:'/project',command:'native-onboarding'}))
 mockService<Services,'cli'>('cli',{claudeCode:{prepareOwnedProfileSetup:prepare} as never})
 const app=await startApp({systems:['code']});await app.connect()
 await app.send('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'})
 await app.settle();expect(prepare).not.toHaveBeenCalled()
 await app.send('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'},{sender:'default-setup/code',client:'c-main'})
 expect(await app.nextEmit('code','CLAUDE_PROFILE_SETUP_PREPARED')).toMatchObject({result:{cwd:'/project',command:'native-onboarding'}})
 expect(prepare).toHaveBeenCalledOnce()
})

it('returns preparation failures to the requester instead of starting a shell or dropping the request',async()=>{
 mockService<Services,'cli'>('cli',{claudeCode:{prepareOwnedProfileSetup:vi.fn(async()=>{throw new Error('Choose a project first')})} as never})
 const app=await startApp({systems:['code']});await app.connect()
 await app.send('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'},{sender:'default-setup/code',client:'c-main'})
 expect(await app.nextEmit('code','CLAUDE_PROFILE_SETUP_PREPARED')).toMatchObject({result:{error:'Choose a project first'}})
 expect(app.emitted('code').some(event=>event.type==='terminal.OPENED')).toBe(false)
})
