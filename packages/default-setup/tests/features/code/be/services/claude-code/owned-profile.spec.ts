import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareClaudeOwnedProfile } from '#features/code/be/services/claude-code/owned-profile.ts'

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
