import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, rm, readFile, writeFile, symlink} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {claimClaudeBackgroundCheckpoint} from '#features/code/be/services/claude-code/background-observer-checkpoint.ts'
const exec=promisify(execFile),parent='24be904a-3c35-4981-9793-cbe7a6c19d46'
const temporary=process.platform==='darwin'?'/private/tmp':tmpdir()
const owned:string[]=[]
function scope(){const profile='/owned-test/'+randomUUID();const key=createHash('sha256').update(JSON.stringify([profile,parent])).digest('hex');const index=join(temporary,'apack-claude-background-'+process.getuid?.(),key);owned.push(index);return {profile,parentSessionId:parent,index}}
async function endpoint(){const directory=await mkdtemp(join(temporary,'cc-child-'));owned.push(directory);return {directory,token:'a'.repeat(64)}}
afterEach(async()=>{for(const path of owned.splice(0))await rm(path,{recursive:true,force:true})})
describe.skipIf(process.platform==='win32')('private background endpoint ownership',()=>{
 it('refuses takeover from a live API, isolates profiles and never restores a retired endpoint',async()=>{
  const s=scope(),value=await endpoint(),first=await claimClaudeBackgroundCheckpoint({...s,endpoint:value})
  await expect(claimClaudeBackgroundCheckpoint(s)).rejects.toThrow('live API owner')
  expect(await claimClaudeBackgroundCheckpoint(scope())).toBeUndefined()
  await first!.retire();expect(await claimClaudeBackgroundCheckpoint(s)).toBeUndefined()
  const next=await claimClaudeBackgroundCheckpoint({...s,endpoint:await endpoint()});expect(next?.directory).not.toBe(first?.directory);await next!.retire()
 })
 it('atomically elects one replacement after the actual old Node process exits',async()=>{
  const s=scope(),value=await endpoint(),module=new URL('../../../../../../src/features/code/be/services/claude-code/background-observer-checkpoint.ts',import.meta.url).href
  const script='const {claimClaudeBackgroundCheckpoint}=await import('+JSON.stringify(module)+');await claimClaudeBackgroundCheckpoint('+JSON.stringify({...s,endpoint:value})+');console.log(process.pid)'
  const child=await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',script]);expect(Number(child.stdout.trim())).toBeGreaterThan(1)
  const results=await Promise.allSettled([claimClaudeBackgroundCheckpoint(s),claimClaudeBackgroundCheckpoint(s)])
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1)
  const winner=results.find(result=>result.status==='fulfilled')!;if(winner.status!=='fulfilled')throw Error('No owner');expect(winner.value?.directory).toBe(value.directory);expect(winner.value?.token).toBe(value.token)
  await winner.value!.retire()
 })
 it('rejects symlinked endpoint directories and symlinked registry pointers',async()=>{
  const s=scope(),real=await endpoint(),fake=join(temporary,'cc-child-'+randomUUID().replaceAll('-',''));owned.push(fake);await symlink(real.directory,fake)
  await expect(claimClaudeBackgroundCheckpoint({...s,endpoint:{...real,directory:fake}})).rejects.toThrow('not private')
  const owner=await claimClaudeBackgroundCheckpoint({...s,endpoint:real});await owner!.retire()
  const head=join(s.index,'head'),bytes=await readFile(head);await rm(head);const target=join(s.index,'foreign');await writeFile(target,bytes,{mode:0o600});await symlink(target,head)
  await expect(claimClaudeBackgroundCheckpoint(s)).rejects.toThrow()
 })
})
