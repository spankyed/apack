import {tmpdir} from 'node:os'
import {openBackgroundAttachment} from '#features/code/be/services/claude-code/background-attachment.ts'
const f = vi.hoisted(() => {vi.resetModules();return {query:vi.fn(),spawn:vi.fn(),write:vi.fn(),resize:vi.fn(),data:undefined as undefined|((text:string)=>void),exit:undefined as undefined|((value:{exitCode:number})=>void)}})
vi.mock('#features/code/be/services/claude-code/background-sessions.ts',()=>({backgroundSession:f.query}))
vi.mock('node-pty',()=>({spawn:f.spawn}))
const continuation={sessionId:'11111111-1111-4111-8111-111111111111',continuedInSessionId:'22222222-2222-4222-8222-222222222222',timestamp:'2026-10-30T09:00:00Z'}
const job={id:'22222222',sessionId:continuation.continuedInSessionId,cwd:tmpdir(),state:'working',pid:99}
beforeEach(()=>{
  vi.clearAllMocks();f.query.mockReset().mockResolvedValue(job)
  f.spawn.mockImplementation(()=>({pid:12345,write:f.write,resize:f.resize,onData(callback:(value:string)=>void){f.data=callback;return {dispose:vi.fn()}},onExit(callback:(value:{exitCode:number})=>void){f.exit=callback;return {dispose:vi.fn()}}}))
  vi.spyOn(process,'kill').mockImplementation(()=>{f.exit?.({exitCode:143});return true})
})
afterEach(()=>vi.restoreAllMocks())
it('launches the exact linked job in its own cwd without another resume writer or leaked API key',async()=>{
  const owner=await openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,env:{ANTHROPIC_API_KEY:'must-not-leak'}})
  try {expect(f.query).toHaveBeenCalledWith(continuation,{operation:'refresh'},expect.anything());expect(f.spawn).toHaveBeenCalledWith(process.execPath,['attach',job.id],expect.objectContaining({cwd:job.cwd}));expect(f.spawn.mock.calls[0][2].env.ANTHROPIC_API_KEY).toBeUndefined();expect(owner.snapshot.sessionId).toBe(job.sessionId)}finally{await owner.close()}
})
it('refuses changed child identity before starting any native client',async()=>{
  f.query.mockResolvedValue({...job,sessionId:continuation.sessionId})
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath})).rejects.toThrow('changed');expect(f.spawn).not.toHaveBeenCalled()
})
it('does not launch a cancelled client, including cancellation while native identity is queried',async()=>{
  const abort=new AbortController();abort.abort()
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,signal:abort.signal})).rejects.toThrow('cancelled');expect(f.query).not.toHaveBeenCalled()
  const during=new AbortController();f.query.mockImplementationOnce(async()=>{during.abort();return job})
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,signal:during.signal})).rejects.toThrow('cancelled');expect(f.spawn).not.toHaveBeenCalled()
})
it('bounds replay, refuses stale input/resize and closes only its attacher group',async()=>{
  const owner=await openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath})
  for(let i=0;i<8;i++)f.data!('x'.repeat(262144))
  expect(owner.snapshot.output.reduce((size,chunk)=>size+Buffer.byteLength(chunk.text),0)).toBeLessThanOrEqual(1048576)
  expect(owner.input('stale','text')).toBe(false);expect(owner.input(owner.snapshot.id,'text')).toBe(true)
  expect(owner.resize('stale',80,24)).toBe(false);expect(owner.resize(owner.snapshot.id,80,24)).toBe(true)
  await owner.close();await owner.close();expect(process.kill).toHaveBeenCalledExactlyOnceWith(-12345,'SIGTERM');expect(owner.snapshot.status).toBe('exited');expect(owner.input(owner.snapshot.id,'late')).toBe(false)
})
