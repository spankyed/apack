import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareClaudeOwnedChildUi, prepareClaudeOwnedProfile, prepareClaudeOwnedProfileSetup } from '#features/code/be/services/claude-code/owned-profile.ts'

const test = it.skipIf(process.platform === 'win32')
const roots: string[] = []
async function directory(prefix: string) {
  const value = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : '/tmp', prefix))
  roots.push(value)
  return value
}
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true}))) })
beforeEach(() => vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', undefined))

test('uses original JSON argv syntax for spaced paths and passes unrelated self-spawns through', async () => {
  const root = await directory('cc-owned-profile-')
  const profile = await prepareClaudeOwnedProfile({userDataDir: join(root, "app's profile with spaces")})
  const settings = JSON.parse(await readFile(join(profile.configDir, 'settings.json'), 'utf8'))
  expect(JSON.parse(settings.processWrapper)).toEqual([profile.launcher])
  const output = execFileSync(profile.launcher, [process.execPath, '-e', 'console.log(JSON.stringify({pid:process.pid,bun:process.env.BUN_OPTIONS,electron:process.env.ELECTRON_RUN_AS_NODE}))'],
    {encoding: 'utf8', timeout: 10000, env: {...process.env, CLAUDE_CONFIG_DIR: profile.configDir, BUN_OPTIONS: 'original-options', ELECTRON_RUN_AS_NODE: undefined}})
  expect(JSON.parse(output)).toMatchObject({bun: 'original-options'})
  expect(JSON.parse(output)).not.toHaveProperty('electron')
  expect(await prepareClaudeOwnedProfile({userDataDir: join(root, "app's profile with spaces")})).toEqual(profile)
})

test('does not adopt existing data or replace a user-selected launcher', async () => {
  const root = await directory('cc-owned-profile-')
  await mkdir(join(root, 'claude-code-profile'), {mode: 0o700})
  await writeFile(join(root, 'claude-code-profile', 'keep.txt'), 'Keep this data')
  await expect(prepareClaudeOwnedProfile({userDataDir: root})).rejects.toThrow('Refusing to adopt')
  expect(await readFile(join(root, 'claude-code-profile', 'keep.txt'), 'utf8')).toBe('Keep this data')
  const next = await directory('cc-owned-profile-')
  const profile = await prepareClaudeOwnedProfile({userDataDir: next})
  const settings = JSON.stringify({processWrapper: '/another/launcher', theme: 'dark'})
  await writeFile(join(profile.configDir, 'settings.json'), settings)
  await expect(prepareClaudeOwnedProfile({userDataDir: next})).rejects.toThrow('another launcher')
  expect(await readFile(join(profile.configDir, 'settings.json'), 'utf8')).toBe(settings)
})

test('refuses a conflicting secure-storage override before creating the owned profile', async () => {
  const root = await directory('cc-owned-profile-')
  await expect(prepareClaudeOwnedProfile({userDataDir: root, env: {CLAUDE_SECURESTORAGE_CONFIG_DIR: ''}})).rejects.toThrow('credential store')
  expect(await readdir(root)).toEqual([])
})

test('boots only a matching app child, retains its PID and reaps retired bootstrap files', async () => {
  const root = await directory('cc-owned-profile-'), observer = await directory('cc-child-')
  const profile = await prepareClaudeOwnedProfile({userDataDir: join(root, 'profile with spaces')})
  const plugin = join(observer, 'plugin'), sessionId = '11111111-1111-4111-8111-111111111111'
  await mkdir(plugin, {mode: 0o700})
  await writeFile(join(observer, 'child-ui-launch.json'), JSON.stringify({directory: observer, configDir: profile.configDir, executable: await realpath(process.execPath), socketPath: join(observer, 'status.sock'), token: 'a'.repeat(64)}), {mode: 0o600})
  await writeFile(join(observer, 'child-ui-template.mjs'), 'globalThis.childUiStarted = JSON.parse((await import("node:fs")).readFileSync(new URL("./observer.json",import.meta.url),"utf8")).sessionId;', {mode: 0o600})
  const code = 'const marker=process.env.BUN_OPTIONS.split("--preload=").at(-1); import(require("node:url").pathToFileURL(marker).href).then(()=>console.log(JSON.stringify({pid:process.pid,sessionId:globalThis.childUiStarted,bun:process.env.BUN_OPTIONS})));'
  for (let attempt=0; attempt<2; attempt++) {
    const output = execFileSync(profile.launcher, [process.execPath, '-e', code, '--', '--session-id', sessionId, '--plugin-dir', plugin],
      {encoding: 'utf8', timeout: 10000, env: {...process.env, CLAUDE_CONFIG_DIR: profile.configDir, CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_BG_RENDEZVOUS_SOCK: '/owned/rendezvous', BUN_OPTIONS: 'original-options'}})
    const receipt = JSON.parse(output)
    expect(receipt).toMatchObject({sessionId, bun: 'original-options'})
    const identity = JSON.parse(await readFile(join(observer, `worker-${receipt.pid}.json`), 'utf8'))
    expect(identity).toMatchObject({pid: receipt.pid, sessionId})
    expect(await readdir(join(observer, 'workers'))).toHaveLength(1)
  }
})


test('honors captured absence when the host credential selector changes later', async () => {
 const root=await directory('cc-owned-profile-')
 vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR','/later/credentials')
 await expect(prepareClaudeOwnedProfile({userDataDir:root,env:{CLAUDE_SECURESTORAGE_CONFIG_DIR:undefined}})).resolves.toHaveProperty('configDir',join(root,'claude-code-profile','config'))
})


test('runs native onboarding with spaced paths and the owned credential selectors only', async () => {
 const root=await directory('cc-owned-profile-'), executable=join(root,"native cli's setup")
 await writeFile(executable,"#!/bin/sh\nprintf '%s\\n' \"$CLAUDE_CONFIG_DIR\" \"${CLAUDE_SECURESTORAGE_CONFIG_DIR-unset}\" \"$#\"\n",{mode:0o700})
 const prepared=await prepareClaudeOwnedProfileSetup({userDataDir:join(root,"app's profile"),cwd:'/selected/project',cliPath:executable,env:{CLAUDE_SECURESTORAGE_CONFIG_DIR:undefined}})
 const output=execFileSync('/bin/sh',['-c',prepared.command],{encoding:'utf8',timeout:10000,env:{...process.env,CLAUDE_CONFIG_DIR:'/wrong/profile',CLAUDE_SECURESTORAGE_CONFIG_DIR:'/wrong/credentials'}}).trim().split('\n')
 expect(output).toEqual([join(root,"app's profile",'claude-code-profile','config'),'unset','0'])
 expect(prepared.cwd).toBe('/selected/project')
})


test('preserves malformed private settings and does not expose their contents in a setup error', async () => {
 const root=await directory('cc-owned-profile-'),profile=await prepareClaudeOwnedProfile({userDataDir:root})
 const raw='{"privateFixtureSecret":"not-for-ui",'
 await writeFile(join(profile.configDir,'settings.json'),raw)
 const error=await prepareClaudeOwnedProfile({userDataDir:root}).then(()=>undefined,error=>error)
 expect(error.message).toContain('not valid JSON')
 expect(error.message).not.toContain('privateFixtureSecret')
 expect(await readFile(join(profile.configDir,'settings.json'),'utf8')).toBe(raw)
})


test('resolves the owned worker executable using the launch PATH and cwd without executing it', async () => {
 const root=await directory('cc-owned-path-'), profile=await prepareClaudeOwnedProfile({userDataDir:root})
 const cwd=join(root,'project'), bin=join(cwd,'bin'), blocked=join(root,'blocked'), ambient=join(root,'ambient')
 await Promise.all([mkdir(bin,{recursive:true}),mkdir(blocked),mkdir(ambient)])
 await writeFile(join(bin,'native'),'never execute this fixture',{mode:0o700})
 await symlink('native',join(bin,'claude'))
 await writeFile(join(blocked,'claude'),'not executable',{mode:0o600})
 await writeFile(join(ambient,'claude'),'wrong CLI',{mode:0o700})
 vi.stubEnv('PATH',ambient)
 const options={userDataDir:root,configDir:profile.configDir,executable:'claude',cwd,searchPath:blocked+':bin',directory:join(root,'observer'),socketPath:join(root,'status.sock'),token:'a'.repeat(64)}
 expect(await prepareClaudeOwnedChildUi(options)).toBe(true)
 const descriptor=()=>readFile(join(options.directory,'child-ui-launch.json'),'utf8').then(JSON.parse)
 expect((await descriptor()).executable).toBe(await realpath(join(bin,'native')))
 await prepareClaudeOwnedChildUi({...options,executable:'./bin/claude',searchPath:''})
 expect((await descriptor()).executable).toBe(await realpath(join(bin,'native')))
 await expect(prepareClaudeOwnedChildUi({...options,searchPath:blocked})).rejects.toThrow('selected Claude executable is unavailable')
})
