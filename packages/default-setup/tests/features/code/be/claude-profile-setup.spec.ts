import { mockService, startApp, takeSystemErrors } from '@apackdev/testing/harness'
import type { Services } from '#generated/services.ts'

it('answers setup only to the requesting code surface and refuses an unaddressed request',async()=>{
 const prepare=vi.fn(async()=>({cwd:'/project',command:'native-onboarding'}))
 mockService<Services,'cli'>('cli',{claudeCode:{prepareOwnedProfileSetup:prepare} as never})
 const app=await startApp({systems:['code']});await app.connect()
 await app.send('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'})
 await app.settle()
 expect(prepare).not.toHaveBeenCalled()
 expect(takeSystemErrors()).toMatchObject([{message:'Claude profile setup requires a requesting window'}])
 expect(await app.ask('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'},{client:'c-main'})).toEqual({
  ok:true,value:{cwd:'/project',command:'native-onboarding'},
 })
 expect(prepare).toHaveBeenCalledOnce()
})

it('returns preparation failures to the requester instead of starting a shell or dropping the request',async()=>{
 mockService<Services,'cli'>('cli',{claudeCode:{prepareOwnedProfileSetup:vi.fn(async()=>{throw new Error('Choose a project first')})} as never})
 const app=await startApp({systems:['code']});await app.connect()
 expect(await app.ask('code',{type:'PREPARE_CLAUDE_PROFILE_SETUP'},{client:'c-main'})).toMatchObject({
  ok:false,failure:{message:'Choose a project first'},
 })
 expect(takeSystemErrors()).toEqual([])
 expect(app.emitted('code').some(event=>event.type==='terminal.OPENED')).toBe(false)
})
