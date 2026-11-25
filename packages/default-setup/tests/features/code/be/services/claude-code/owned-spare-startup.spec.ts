import { prepareClaudeOwnedProfile } from '#features/code/be/services/claude-code/owned-profile.ts'
import { claudeTerminalStatusRuntime } from '#features/code/be/services/claude-code/terminal-status-runtime.ts'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const test = it.skipIf(process.platform === 'win32')
const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('observes the first claimed helper once while unclaimed child I/O and caller options pass through', async () => {
 vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', undefined)
 const temporary=process.platform==='darwin'?'/private/tmp':'/tmp'
 const root=await mkdtemp(join(temporary,'cc-spare-test-')),observer=await mkdtemp(join(temporary,'cc-child-'));roots.push(root,observer)
 const profile=await prepareClaudeOwnedProfile({userDataDir:join(root,"app's profile")}),bin=join(profile.configDir,'..','bin'),plugin=join(observer,'plugin')
 const spareRoot=join('/tmp','cc-spares-'+createHash('sha256').update(await realpath(join(profile.configDir,'..'))).digest('hex').slice(0,32));roots.push(spareRoot)
 const sessionId='11111111-1111-4111-8111-111111111111'
 await mkdir(plugin,{mode:0o700})
 await writeFile(join(observer,'child-ui-launch.json'),JSON.stringify({directory:observer,configDir:profile.configDir,executable:await realpath(process.execPath),socketPath:join(observer,'status.sock'),token:'a'.repeat(64)}),{mode:0o600})
 // Authored stand-ins keep this focused check out of the original runtime; Linux app acceptance uses the real modules.
 await writeFile(join(bin,'helper-policy-reader.mjs'),'let ready=false;export async function prepareNativeHelperPolicy(){ready=true};export function readNativeHelperCommands(){return {main:null,subagent:null,prefix:undefined}};export function readNativeHelperPolicy(){if(!ready)throw Error("policy not ready");return "[false,false,false]"}',{mode:0o600})
 await writeFile(join(observer,'child-ui-template.mjs'),'export function bindNativeHelperObservationReader(reader){globalThis.mainObservation=reader};export async function prepareNativeHelperPolicy(){};export function readNativeHelperCommands(){return {main:null,subagent:null,prefix:undefined}};export function readNativeHelperPolicy(){return "[false,false,false]"}',{mode:0o600})
 await writeFile(join(observer,'child-helper-template.mjs'),claudeTerminalStatusRuntime,{mode:0o600})
 const executions=join(root,'executions.jsonl'),helper=join(root,'helper.mjs')
 await writeFile(helper,`import{appendFileSync}from'node:fs';let input='';for await(const chunk of process.stdin)input+=chunk;appendFileSync(${JSON.stringify(executions)},input+'\\n');process.stdout.write('Claimed Ω🙂\\n');`,{mode:0o600})
 const payload={session_id:sessionId,version:'2.1.302',cost:{total_cost_usd:0.00042},context_window:{}}
 const code=`
 const fs=await import('node:fs/promises'),url=await import('node:url'),{spawn}=await import('node:child_process');
 const launcher=await import(${JSON.stringify(pathToFileURL(join(bin,'launch.mjs')).href)});
 process.argv=[process.execPath,'authored-spare','--bg-spare',${JSON.stringify(join(root,'claim.sock'))}];
 const preload=launcher.prepareClaudeOwnedWarmSpareStartup({configDir:${JSON.stringify(profile.configDir)},pid:process.pid,argv:[process.execPath,'--bg-spare',${JSON.stringify(join(root,'claim.sock'))}]});
 if(!preload)throw Error('Warm preload missing');process.env.BUN_OPTIONS='caller-options --preload='+preload;
 await import(url.pathToFileURL(preload).href);
 async function run(){const child=spawn(process.execPath,[${JSON.stringify(helper)}]);let text='';child.stdout.on('data',chunk=>text+=chunk);child.stdin.end(${JSON.stringify(JSON.stringify(payload))});const exit=await new Promise(resolve=>child.once('close',resolve));return{text,exit}}
 const before=await run(),beforeFiles=await fs.readdir(${JSON.stringify(observer)});
 process.argv=[process.execPath,'authored-spare','--session-id',${JSON.stringify(sessionId)},'--plugin-dir',${JSON.stringify(plugin)}];
 process.env.CLAUDE_BG_RENDEZVOUS_SOCK='/owned/rendezvous';
 const after=await run(),identity=JSON.parse(await fs.readFile(${JSON.stringify(observer)}+'/worker-'+process.pid+'.json','utf8'));
 const config=JSON.parse(await fs.readFile(identity.configPath,'utf8')),cached=JSON.parse(await fs.readFile(url.fileURLToPath(new URL('./startup-main.json',url.pathToFileURL(identity.configPath))),'utf8'));
 console.log(JSON.stringify({pid:process.pid,before,after,beforeFiles,identity,config,cached,bun:process.env.BUN_OPTIONS}));`
 const {stdout}=await execFileWhileWorking(process.execPath,['--input-type=module','-e',code],{timeout:10000,env:{...process.env,CLAUDE_CONFIG_DIR:profile.configDir,CLAUDE_CODE_SESSION_KIND:'bg',CLAUDE_BG_RENDEZVOUS_SOCK:undefined,BUN_OPTIONS:'caller-options'}})
 const receipt=JSON.parse(stdout)
 expect(receipt.before).toEqual({text:'Claimed Ω🙂\n',exit:0});expect(receipt.after).toEqual(receipt.before)
 expect(receipt.beforeFiles.some((name:string)=>name.startsWith('worker-')||name==='workers')).toBe(false)
 expect(receipt.identity).toMatchObject({pid:receipt.pid,sessionId})
 expect(receipt.cached).toMatchObject({kind:'main',sessionId,parentPid:receipt.pid,policyKey:'[false,false,false]',totalCostUsd:0.00042,stdout:receipt.after.text,code:0})
 expect(receipt.cached.generation).toBe(receipt.config.generations.main)
 expect(receipt.bun).toBe('caller-options')
 expect((await readFile(executions,'utf8')).trim().split('\n').map(line=>JSON.parse(line))).toEqual([payload,payload])
 expect(await readdir(spareRoot)).toEqual([])
})

test('uses the original job identity when a background restart names its owned transcript', async () => {
  vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', undefined)
  const temporary = process.platform === 'darwin' ? '/private/tmp' : '/tmp'
  const root = await mkdtemp(join(temporary, 'cc-spare-resume-'))
  const observer = await mkdtemp(join(temporary, 'cc-child-'))
  roots.push(root, observer)
  const profile = await prepareClaudeOwnedProfile({ userDataDir: root })
  const jobSessionId = '11111111-1111-4111-8111-111111111111'
  const sessionId = '22222222-2222-4222-8222-222222222222'
  const job = join(profile.configDir, 'jobs', '11111111')
  const project = join(profile.configDir, 'projects', 'release-review')
  const transcript = join(project, sessionId + '.jsonl')
  const foreign = join(root, sessionId + '.jsonl')
  const plugin = join(observer, 'plugin')
  await Promise.all([mkdir(job, { recursive: true }), mkdir(project, { recursive: true }), mkdir(plugin)])
  await Promise.all([
    writeFile(join(job, 'state.json'), JSON.stringify({ sessionId: jobSessionId, resumeSessionId: sessionId }), { mode: 0o600 }),
    writeFile(transcript, '{}\n', { mode: 0o600 }),
    writeFile(foreign, '{}\n', { mode: 0o600 }),
    writeFile(join(observer, 'child-ui-launch.json'), JSON.stringify({
      directory: observer, configDir: profile.configDir, executable: await realpath(process.execPath),
      socketPath: join(observer, 'status.sock'), token: 'a'.repeat(64),
    }), { mode: 0o600 }),
    writeFile(join(observer, 'child-ui-template.mjs'), 'export {}', { mode: 0o600 }),
    writeFile(join(observer, 'child-helper-template.mjs'), 'export {}', { mode: 0o600 }),
  ])
  const launcher = join(profile.configDir, '..', 'bin', 'launch.mjs')
  const run = (path: string) => execFileWhileWorking(process.execPath, [
    launcher, profile.configDir, String(process.pid), process.execPath, '--resume', path, '--plugin-dir', plugin,
  ], { timeout: 10000, env: { ...process.env, CLAUDE_CONFIG_DIR: profile.configDir, CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_BG_RENDEZVOUS_SOCK: '/owned/rendezvous', CLAUDE_JOB_DIR: job } })
  expect((await run(foreign)).stdout).toBe('')
  const { stdout } = await run(transcript)
  expect(stdout).toContain('/startup.mjs')
  const config = JSON.parse(await readFile(join(stdout, '..', 'observer.json'), 'utf8'))
  expect(config).toMatchObject({ sessionId, jobSessionId })
})
