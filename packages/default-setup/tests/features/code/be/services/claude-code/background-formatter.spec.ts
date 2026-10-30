import {afterEach, expect, it, vi} from 'vitest'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createClaudeBackgroundFormatter, installClaudeBackgroundFormatterLauncher} from '#features/code/be/services/claude-code/background-formatter.ts'

const cleanups: (()=>Promise<unknown>)[] = []
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close()})
const message = (command: string | null = 'cat', shellPrefix: string | null = null, policy = 'personal') => ({sessionId:'11111111-1111-4111-8111-111111111111',pid:119,token:'lease',formatter:{command,shellPrefix,policy}})
function config(prefix: string) {return JSON.parse(Buffer.from(prefix.slice(prefix.lastIndexOf(' -')+2),'base64url').toString())}
const input = Buffer.from(JSON.stringify({session_id:message().sessionId,version:'2.1.302',cost:{total_cost_usd:0},context_window:{used_percentage:1}}))
async function fixture() {
 const directory=await mkdtemp(join(tmpdir(),'cc-formatter-test-')),socketPath=join(directory,'broker.sock'),exports: any[]=[]
 cleanups.push(()=>rm(directory,{recursive:true,force:true}))
 const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;exports.push({path:req.url,token:req.headers['x-apack-native-token'],body:JSON.parse(text)});res.end('{}')})
 await new Promise<void>(resolve=>server.listen(socketPath,resolve))
 let closed=false;const close=async()=>{if(!closed){closed=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
 cleanups.push(close)
 const launcher=await installClaudeBackgroundFormatterLauncher()
 const formatter=createClaudeBackgroundFormatter({launcher,socketPath,brokerToken:'broker-token',changed:vi.fn()})
 async function run(prefix: string, command: string, stdin=input, environment: NodeJS.ProcessEnv = {...process.env,CLAUDE_CODE_SHELL_PREFIX:prefix}) {
  const cfg=config(prefix),encoded='-'+Buffer.from(JSON.stringify(cfg)).toString('base64url')
  const process=spawn(launcher,[encoded,command],{stdio:'pipe',env:environment}),stdout:Buffer[]=[],stderr:Buffer[]=[]
  process.stdout.on('data',part=>stdout.push(part));process.stderr.on('data',part=>stderr.push(part));process.stdin.on('error',()=>{});process.stdin.end(stdin)
  const result=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{process.once('error',reject);process.once('close',(code,signal)=>resolve({code,signal}))})
  return {...result,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr).toString()}
 }
 return {directory,exports,close,formatter,run,launcher}
}
it('streams the exact native helper input/output and publishes only its bound session',async()=>{
 const f=await fixture(),reply=f.formatter.configure(message())!,result=await f.run(reply.shellPrefix!,'cat')
 expect(result.code).toBe(0);expect(result.stdout).toEqual(input);expect(f.exports).toHaveLength(1)
 expect(f.exports[0]).toMatchObject({path:'/background-formatter',token:'broker-token',body:{sessionId:message().sessionId,pid:119,token:'lease',stdout:input.toString()}})
 expect(f.formatter.matches(f.exports[0].body)).toBe(true)
})
it('preserves native existing-prefix quoting and flags, including executable paths containing apostrophes',async()=>{
 const f=await fixture(),path=join(f.directory,"user's prefix")
 await writeFile(path,'#!/bin/sh\nif [ "$1" != "-mode" ]; then exit 79; fi\nshift\nprintf "original-prefix" >&2\nexec /bin/sh -c "$1"\n',{mode:0o700})
 const reply=f.formatter.configure(message('cat',path+' -mode'))!,result=await f.run(reply.shellPrefix!,'cat')
 expect(result.code).toBe(0);expect(result.stdout).toEqual(input);expect(result.stderr).toContain('original-prefix');expect(f.exports).toHaveLength(1)
})
it('delegates other native commands unchanged without interpreting their binary input as status',async()=>{
 const f=await fixture(),reply=f.formatter.configure(message('another command'))!,bytes=Buffer.from([0,255,27,0,128])
 const result=await f.run(reply.shellPrefix!,'cat',bytes)
 expect(result.code).toBe(0);expect(result.stdout).toEqual(bytes);expect(f.exports).toEqual([])
})
it('keeps the original helper usable after the broker has disappeared',async()=>{
 const f=await fixture(),reply=f.formatter.configure(message())!;await f.close()
 const result=await f.run(reply.shellPrefix!,'cat')
 expect(result.code).toBe(0);expect(result.stdout).toEqual(input)
})
it('preserves a native nonzero result and clears previously displayed formatter output',async()=>{
 const f=await fixture(),command='cat; exit 23',reply=f.formatter.configure(message(command))!,result=await f.run(reply.shellPrefix!,command)
 expect(result.code).toBe(23);expect(result.stdout).toEqual(input);expect(f.exports).toHaveLength(1);expect(f.exports[0].body).toMatchObject({code:23,stdout:''})
})
it('preserves output above the observation bound and withdraws the displayed formatter',async()=>{
 const f=await fixture(),command='head -c 40000 /dev/zero',reply=f.formatter.configure(message(command))!,result=await f.run(reply.shellPrefix!,command)
 expect(result.code).toBe(0);expect(result.stdout).toHaveLength(40000);expect(f.exports).toHaveLength(1);expect(f.exports[0].body).toMatchObject({truncated:true,stdout:''})
})
it('refuses foreign-session helper output while preserving its bytes',async()=>{
 const f=await fixture(),reply=f.formatter.configure(message())!,foreign=Buffer.from(input.toString().replace(message().sessionId,'22222222-2222-4222-8222-222222222222'))
 const result=await f.run(reply.shellPrefix!,'cat',foreign)
 expect(result.stdout).toEqual(foreign);expect(result.code).toBe(0);expect(f.exports).toEqual([])
})
it('retains one generation through identical polls and invalidates output on helper/policy/lease changes',()=>{
 const f=createClaudeBackgroundFormatter({launcher:'/owned/launcher',socketPath:'/owned/socket',brokerToken:'private',changed:vi.fn()})
 const first=f.configure(message())!,old={...config(first.shellPrefix!),startedAt:'1',stdout:'original status'}
 f.accept(old);expect(f.value).toBe('original status');expect(f.configure(message())).toEqual(first)
 const next=f.configure(message('cat',null,'managed'))!;expect(next).not.toEqual(first);expect(f.value).toBeUndefined();expect(()=>f.accept(old)).toThrow('generation expired')
 const fresh={...config(next.shellPrefix!),startedAt:'2',stdout:'managed status'};f.accept(fresh)
 f.configure({...message('cat',null,'managed'),token:'new-lease'});expect(f.value).toBeUndefined();expect(()=>f.accept(fresh)).toThrow()
})
it('restores the exact user prefix when native policy withdraws the configured command',()=>{
 const f=createClaudeBackgroundFormatter({launcher:'/owned/launcher',socketPath:'/owned/socket',brokerToken:'private',changed:vi.fn()})
 const old={...config(f.configure(message('cat','user -flag'))!.shellPrefix!),startedAt:'1',stdout:'old'};f.accept(old)
 expect(f.configure(message(null,'user -flag','hooks-disabled'))).toEqual({shellPrefix:'user -flag',originalPrefix:'user -flag'});expect(f.value).toBeUndefined();expect(()=>f.accept(old)).toThrow()
 f.reset();expect(f.matches(old)).toBe(false)
})

it('unwraps only its own same-worker observer after a native hook reload',()=>{
 const f=createClaudeBackgroundFormatter({launcher:'/owned/launcher',socketPath:'/owned/socket',brokerToken:'private',changed:vi.fn()})
 const previous=f.configure(message('cat','original -flag'))!.shellPrefix!;f.reset()
 const reloaded=f.configure({...message('cat',previous),token:'fresh-lease'})!
 expect(reloaded.originalPrefix).toBe('original -flag');expect(config(reloaded.shellPrefix!).originalPrefix).toBe('original -flag')
 const foreign={...config(previous),pid:999};const unrelated='/owned/launcher -'+Buffer.from(JSON.stringify(foreign)).toString('base64url')
 expect(f.configure(message('cat',unrelated))!.originalPrefix).toBe(unrelated)
})
it('refuses a late older helper even while the native helper generation is unchanged',()=>{
 const f=createClaudeBackgroundFormatter({launcher:'/owned/launcher',socketPath:'/owned/socket',brokerToken:'private',changed:vi.fn()})
 const producer=config(f.configure(message())!.shellPrefix!)
 f.accept({...producer,startedAt:'20',stdout:'new output'});expect(()=>f.accept({...producer,startedAt:'10',stdout:'late old output'})).toThrow()
 expect(f.value).toBe('new output')
})

it('matches original native line normalization and withdraws an empty successful helper result',()=>{
 const f=createClaudeBackgroundFormatter({launcher:'/owned/launcher',socketPath:'/owned/socket',brokerToken:'private',changed:vi.fn()})
 const producer=config(f.configure(message())!.shellPrefix!)
 f.accept({...producer,startedAt:'1',stdout:'  first  \n \n second \n'});expect(f.value).toBe('first\nsecond')
 f.accept({...producer,startedAt:'2',stdout:' \n '});expect(f.value).toBeUndefined()
})

it('hides the internal prefix and restores the original Electron-mode environment before delegation',async()=>{
 const f=await fixture(),command='printf "%s" "${CLAUDE_CODE_SHELL_PREFIX-unset}:${ELECTRON_RUN_AS_NODE-unset}"'
 const prefix=f.formatter.configure(message(command))!.shellPrefix!
 const environment={...process.env,CLAUDE_CODE_SHELL_PREFIX:prefix,ELECTRON_RUN_AS_NODE:'original-value'}
 const result=await f.run(prefix,command,input,environment)
 expect(result.code).toBe(0);expect(result.stdout.toString()).toBe('unset:original-value')
})
