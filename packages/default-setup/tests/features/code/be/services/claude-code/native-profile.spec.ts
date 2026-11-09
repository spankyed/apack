import { execFileSync } from 'node:child_process'
import { snapshotClaudeProfile, claudeProfileOptions, sameClaudeProfile } from '#features/code/common/native-profile.ts'
import { buildChildEnv } from '#features/code/be/services/claude-code/runner.ts'

afterEach(() => vi.unstubAllEnvs())

it('retains an unset default profile after inheritance changes, including the native Keychain selector', () => {
 const profile=JSON.parse(JSON.stringify(snapshotClaudeProfile({})))
 expect(profile).toEqual({})
 vi.stubEnv('CLAUDE_CONFIG_DIR','/later/config')
 vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR','/later/credentials')
 const env=buildChildEnv(claudeProfileOptions({profile}).env)
 const result=execFileSync(process.execPath,['-e','console.log(JSON.stringify({config:Object.hasOwn(process.env,"CLAUDE_CONFIG_DIR"),secureStorage:Object.hasOwn(process.env,"CLAUDE_SECURESTORAGE_CONFIG_DIR")}))'],{env,encoding:'utf8',timeout:10000})
 expect(JSON.parse(result)).toEqual({config:false,secureStorage:false})
})

it('preserves explicit and empty native selectors without retaining credentials', () => {
 const profile=snapshotClaudeProfile({CLAUDE_CONFIG_DIR:'/original/config',CLAUDE_SECURESTORAGE_CONFIG_DIR:'',ANTHROPIC_API_KEY:'not-for-thread-state'})
 expect(JSON.parse(JSON.stringify(profile))).toEqual({configDir:'/original/config',secureStorageConfigDir:''})
 expect(claudeProfileOptions({profile})).toEqual({env:{CLAUDE_CONFIG_DIR:'/original/config',CLAUDE_SECURESTORAGE_CONFIG_DIR:''}})
 expect(sameClaudeProfile({}, {configDir:'/original/config'})).toBe(false)
 expect(sameClaudeProfile({}, {secureStorageConfigDir:''})).toBe(false)
})
