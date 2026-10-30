import {readFile,writeFile,stat,access} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {replyBackgroundSession} from '#features/code/be/services/claude-code/background-reply.ts'
const f=vi.hoisted(()=>{vi.resetModules();return {read:vi.fn(),exec:vi.fn()}})
vi.mock('#features/code/be/services/claude-code/background-sessions.ts',()=>({backgroundSession:f.read}))
vi.mock('#features/code/be/services/claude-code/runner.ts',async importOriginal=>({...await importOriginal<typeof import('#features/code/be/services/claude-code/runner.ts')>(),execOnce:f.exec}))
const link={sessionId:'11111111-1111-4111-8111-111111111111',continuedInSessionId:'22222222-2222-4222-8222-222222222222',timestamp:'2026-10-30T09:00:00Z'}
const job={id:'22222222',sessionId:link.continuedInSessionId,cwd:'/owned/child',state:'working',pid:99}
const request={operation:'reply' as const,id:job.id,pid:job.pid,text:'Review the checklist.'}
const options={env:{HOME:'/owned/profile',ANTHROPIC_API_KEY:'must-not-leak',BUN_OPTIONS:'--preload=/owned/user.mjs'},cliPath:'/owned/claude'}
function preload(opts:any){const path=opts.env.BUN_OPTIONS.match(/--preload=([^\s]+)$/)?.[1];expect(path).toBeTruthy();return path as string}
beforeEach(()=>{vi.clearAllMocks();f.read.mockReset().mockResolvedValue(job);f.exec.mockReset()})
it('uses a private native helper in the original child cwd and removes its files after acknowledgement',async()=>{
 let path=''
 f.exec.mockImplementationOnce(async(args,opts)=>{path=preload(opts);expect(args).toEqual(['--version']);expect(opts.cwd).toBe(job.cwd);expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();expect(opts.env.BUN_OPTIONS).toContain('--preload=/owned/user.mjs ');expect(opts.env.BUN_OPTIONS).toMatch(/ --preload=\/[^'\"\s]+$/);expect((await stat(path)).mode&0o777).toBe(0o600);expect((await stat(dirname(path))).mode&0o777).toBe(0o700);const source=await readFile(path,'utf8');expect(source).toContain('requireClaudeNativePlatform();const result=await replyNativeBackground(');expect(source).toContain(JSON.stringify(request.text));expect(source).toContain('child_session_id');await writeFile(join(dirname(path),'result.json'),JSON.stringify({queued:true}));return {stdout:'',stderr:'',exitCode:0}})
 await expect(replyBackgroundSession(link,request,options)).resolves.toMatchObject(job)
 await expect(access(dirname(path))).rejects.toMatchObject({code:'ENOENT'})
})
it.each([{id:'12345678'},{pid:100},{state:'stopped'}])('refuses changed native identity before creating a sender %#',async change=>{
 f.read.mockResolvedValueOnce({...job,...change});await expect(replyBackgroundSession(link,request,options)).rejects.toThrow('changed');expect(f.exec).not.toHaveBeenCalled()
})
it('preserves native refusal and frees the pending slot without retrying',async()=>{
 let path='';f.exec.mockImplementationOnce(async(_args,opts)=>{path=preload(opts);throw Error('Original native refusal')})
 await expect(replyBackgroundSession(link,request,options)).rejects.toThrow('Original native refusal');expect(f.exec).toHaveBeenCalledOnce();await expect(access(dirname(path))).rejects.toMatchObject({code:'ENOENT'})
 f.read.mockResolvedValueOnce({...job,pid:100});await expect(replyBackgroundSession(link,request,options)).rejects.toThrow('changed');expect(f.read).toHaveBeenCalledTimes(2)
})
it('refuses concurrent sends to the same child and cancels before a helper starts',async()=>{
 let finish!:(value:typeof job)=>void;const abort=new AbortController();f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const first=replyBackgroundSession(link,request,{...options,signal:abort.signal})
 await expect(replyBackgroundSession(link,request,options)).rejects.toThrow('already pending');abort.abort();finish(job);await expect(first).rejects.toThrow('cancelled');expect(f.exec).not.toHaveBeenCalled()
})
it('requires original acknowledgement rather than successful helper exit',async()=>{
 f.exec.mockImplementationOnce(async(_args,opts)=>{await writeFile(join(dirname(preload(opts)),'result.json'),JSON.stringify({queued:false}));return {exitCode:0}})
 await expect(replyBackgroundSession(link,request,options)).rejects.toThrow('not acknowledged')
})
