import {readSavedClaudeNativeLaunch} from '#features/code/be/services/claude-code/native-launch.ts'
const sessionId='11111111-1111-4111-8111-111111111111'
const launch={sessionId,cwd:'/saved',model:'old-model',permissionMode:'acceptEdits',allowedTools:['Read'],disallowedTools:['Bash'],appendSystemPrompt:'Keep review instructions'}
it('preserves launch restrictions while using the latest staged model and permission choices',()=>{
 const result=readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:launch,modelOverride:'haiku',permissionMode:'plan'})
 expect(result).toEqual({...launch,model:'haiku',permissionMode:'plan'})
 expect(launch.model).toBe('old-model')
})
it('clears a forced model when the user chooses the native default',()=>{
 expect(readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:launch,modelOverride:'default'})?.model).toBeUndefined()
})
it('refuses a stale identity, invalid mode or extra settings instead of launching a different contract',()=>{
 expect(()=>readSavedClaudeNativeLaunch({sessionId:'other',cwd:'/saved',nativeLaunch:launch})).toThrow('matches')
 expect(()=>readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:launch,permissionMode:'invented'})).toThrow()
 expect(()=>readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:{...launch,settings:{}}})).toThrow()
})
