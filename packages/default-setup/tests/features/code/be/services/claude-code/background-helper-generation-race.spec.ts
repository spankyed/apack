import { vi, expect, it } from 'vitest'
import { request } from 'node:http'
import { mkdtemp, mkdir, chmod, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClaudeBackgroundStatusObserver } from '#features/code/be/services/claude-code/background-status-observer.ts'

it.each(['newer status', 'new registration'] as const)('does not rewrite helper generations after %s supersedes a pending config read', async replacement => {
 const parent = '24be904a-3c35-4981-9793-cbe7a6c19d46', child = '05ff1d31-597d-4537-8737-4407191add6e'
 const identity = {jobId: '05ff1d31', sessionId: child, activeSessionId: child, pid: 119, start: 'worker-start', hostPid: 100, hostStart: 'host-start', cwd: '/owned'}
 const profile = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'cc-generation-'))
 const observer = await createClaudeBackgroundStatusObserver({profile, parentSessionId: parent, childUiLaunch: {configDir: join(profile, 'claude-code-profile', 'config'), executable: process.execPath, cwd: '/owned', searchPath: process.env.PATH}, target: () => ({sessionId: child, cwd: '/owned'}), changed() {}, authority: () => ({identify: async () => ({...identity}), close: async () => {}})})
 const worker = join(observer.directory, 'workers', 'w-119-abcdef'), configPath = join(worker, 'observer.json')
 const post = (path: string, value: unknown) => new Promise<{code: number; value: {token: string}}>((resolve, reject) => {
  const req = request({socketPath: observer.socketPath, path, method: 'POST', headers: {'x-apack-native-token': observer.token}}, response => {
   let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({code: response.statusCode!, value: JSON.parse(text)}))
  }); req.on('error', reject); req.end(JSON.stringify(value))
 })
 let release!: () => void, entered!: () => void
 const ready = new Promise<void>(resolve => { entered = resolve }), held = new Promise<void>(resolve => { release = resolve })
 let pending: ReturnType<typeof post> | undefined
 let readSpy: {mockRestore(): void} | undefined
 try {
  await mkdir(worker, {recursive: true, mode: 0o700}); await chmod(join(observer.directory, 'workers'), 0o700)
  await writeFile(join(observer.directory, 'worker-119.json'), JSON.stringify({pid: 119, sessionId: child, start: identity.start, configPath}), {mode: 0o600})
  await writeFile(configPath, JSON.stringify({sessionId: child, jobSessionId: child, token: 'b'.repeat(64), uiSocketPath: join(worker, 'ui.sock'), mainObservationClaimed: false, generations: {main: 'main-generation', subagent: 'subagent-generation'}}), {mode: 0o600})
  let lease = (await post('/background-register', {sessionId: child, pid: 119})).value.token
  const snapshot = (sequence: number, restricted: boolean) => ({sessionId: child, pid: 119, token: lease, sequence, metadata: {model: 'sonnet', turns: 2}, usage: {startedAt: 1, cost: {usd: 0.00042}}, helpers: {command: 'caption-helper', policyKey: JSON.stringify([restricted, false, false]), agents: []}})
  expect((await post('/background-status', snapshot(1, false))).code).toBe(200)
  const oldOwner = observer.desktopOwner!.id
  const originalRead = fsPromises.readFile
  let armed = true
  readSpy = vi.spyOn(fsPromises, 'readFile').mockImplementation((async (...args: Parameters<typeof originalRead>) => {
   const bytes = await originalRead(...args)
   if (armed && args[0] === configPath) { armed = false; entered(); await held }
   return bytes
  }) as typeof originalRead)
  syncBuiltinESMExports()
  pending = post('/background-status', snapshot(2, true)); await ready
  if (replacement === 'new registration') lease = (await post('/background-register', {sessionId: child, pid: 119})).value.token
  expect((await post('/background-status', snapshot(replacement === 'new registration' ? 1 : 3, false))).code).toBe(200)
  const current = readFileSync(configPath, 'utf8')
  if (replacement === 'new registration') expect(observer.desktopOwner!.id).not.toBe(oldOwner)
  release(); expect((await pending).code).toBe(409)
  expect(readFileSync(configPath, 'utf8')).toBe(current)
 } finally {
  readSpy?.mockRestore(); syncBuiltinESMExports(); release(); await pending?.catch(() => {}); await observer.close(); await rm(profile, {recursive: true, force: true})
 }
})
