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

it('merges newly staged roots with retained attachment roots without mutating either snapshot',()=>{
 const addDir=['/attached'],additionalDirs=['/extra project','/attached'],saved={...launch,addDir}
 expect(readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:saved,additionalDirs})?.addDir).toEqual(['/attached','/extra project'])
 expect(addDir).toEqual(['/attached']);expect(additionalDirs).toEqual(['/extra project','/attached'])
 expect(()=>readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:saved,additionalDirs:['']})).toThrow()
 expect(()=>readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:saved,additionalDirs:'bad'})).toThrow()
})

it('keeps the acknowledged pre-Plan mode with Plan and clears it after an explicit mode change',()=>{
 const saved={...launch,permissionMode:'plan',prePlanMode:'acceptEdits'}
 const state={sessionId,cwd:'/saved',nativeLaunch:saved,permissionMode:'plan',prePlanMode:'acceptEdits'}
 expect(readSavedClaudeNativeLaunch(state)).toMatchObject({permissionMode:'plan',prePlanMode:'acceptEdits'})
 expect(readSavedClaudeNativeLaunch({...state,permissionMode:'default'})?.prePlanMode).toBeUndefined()
 expect(()=>readSavedClaudeNativeLaunch({...state,prePlanMode:'plan'})).toThrow()
 expect(()=>readSavedClaudeNativeLaunch({...state,prePlanMode:'invalid'})).toThrow()
 expect(saved.prePlanMode).toBe('acceptEdits')
})

it('retains explicit channel selection on saved resume without sharing its mutable array',async()=>{
 const {snapshotClaudeNativeLaunch}=await import('#features/code/be/services/claude-code/native-launch.ts')
 const channels=['plugin:review@owned'],saved=snapshotClaudeNativeLaunch({...launch,permissionMode: 'acceptEdits',channels})
 channels.push('plugin:other@owned')
 expect(saved.channels).toEqual(['plugin:review@owned'])
 expect(readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:saved})?.channels).toEqual(['plugin:review@owned'])
 expect(()=>readSavedClaudeNativeLaunch({sessionId,cwd:'/saved',nativeLaunch:{...saved,channels:['']}})).toThrow()
})
