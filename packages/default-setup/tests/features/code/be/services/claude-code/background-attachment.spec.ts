// Attaching to a background worker, over the host's terminal service.
//
// **The pty is the broker's, so what this stands in for is the service and not a binding.** A pack owns no
// process: an addon loaded inside one puts a pty back in the API process and takes the Electron-ABI rebuild
// with it, which `findNodePtyImports` refuses. So what a case here asserts is the session the pack asked
// for and the signals it sent, which is the whole of its side of the contract.
//
// **Its own stand-in rather than `_support/terminal-broker.ts`.** That one installs through `mockService`,
// which needs the harness this file does not share: `vi.resetModules()` below is what makes the mock of a
// pack module apply at all — `tests/setup.ts` imports `pack-entry.ts`, so without the reset these modules
// are already in the graph — and the reset gives this file its own copy of the harness too.
import {tmpdir} from 'node:os'
import {openBackgroundAttachment} from '#features/code/be/services/claude-code/background-attachment.ts'
const f = vi.hoisted(() => {
  vi.resetModules()
  return {
    query:vi.fn(),open:vi.fn(),write:vi.fn(async()=>{}),resize:vi.fn(async()=>{}),signal:vi.fn(),terminate:vi.fn(async()=>{}),
    output:undefined as undefined|((text:string)=>void),
    exit:undefined as undefined|((code:number|null,signal:string|null)=>void),
  }
})
vi.mock('#features/code/be/services/claude-code/background-sessions.ts',()=>({backgroundSession:f.query}))
vi.mock('#generated/services.ts',()=>({services:{terminal:{open:f.open}}}))
const continuation={sessionId:'11111111-1111-4111-8111-111111111111',continuedInSessionId:'22222222-2222-4222-8222-222222222222',timestamp:'2026-10-30T09:00:00Z'}
const job={id:'22222222',sessionId:continuation.continuedInSessionId,cwd:tmpdir(),state:'working',pid:99}
beforeEach(()=>{
  vi.clearAllMocks();f.query.mockReset().mockResolvedValue(job)
  f.open.mockImplementation(async(_options:unknown,listeners:{onOutput:(text:string)=>void;onExit:(code:number|null,signal:string|null)=>void})=>{
    f.output=listeners.onOutput;f.exit=listeners.onExit
    return {
      id:'broker-1',pid:12345,scrollback:1000,write:f.write,resize:f.resize,terminate:f.terminate,
      pause:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),
      // A signal that ends the client is what ends the session, as it does for the real broker: the process
      // it started is in its own group
      signal:f.signal.mockImplementation(async(name:string)=>{f.exit?.(null,name)}),
    }
  })
})
afterEach(()=>vi.restoreAllMocks())
it('launches the exact linked job in its own cwd without another resume writer or leaked API key',async()=>{
  const owner=await openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,env:{ANTHROPIC_API_KEY:'must-not-leak'}})
  try {
    expect(f.query).toHaveBeenCalledWith(continuation,{operation:'refresh'},expect.anything())
    expect(f.open).toHaveBeenCalledWith(expect.objectContaining({shell:process.execPath,args:['attach',job.id],cwd:job.cwd}),expect.anything())
    expect(f.open.mock.calls[0][0].env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(owner.snapshot.sessionId).toBe(job.sessionId)
  } finally {await owner.close()}
})
it('refuses changed child identity before starting any native client',async()=>{
  f.query.mockResolvedValue({...job,sessionId:continuation.sessionId})
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath})).rejects.toThrow('changed');expect(f.open).not.toHaveBeenCalled()
})
it('does not launch a cancelled client, including cancellation while native identity is queried',async()=>{
  const abort=new AbortController();abort.abort()
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,signal:abort.signal})).rejects.toThrow('cancelled');expect(f.query).not.toHaveBeenCalled()
  const during=new AbortController();f.query.mockImplementationOnce(async()=>{during.abort();return job})
  await expect(openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath,signal:during.signal})).rejects.toThrow('cancelled');expect(f.open).not.toHaveBeenCalled()
})
it('bounds replay, refuses stale input/resize and closes only its attacher group',async()=>{
  const owner=await openBackgroundAttachment(continuation,job.id,{cliPath:process.execPath})
  for(let i=0;i<8;i++)f.output!('x'.repeat(262144))
  expect(owner.snapshot.output.reduce((size,chunk)=>size+Buffer.byteLength(chunk.text),0)).toBeLessThanOrEqual(1048576)
  expect(owner.input('stale','text')).toBe(false);expect(owner.input(owner.snapshot.id,'text')).toBe(true)
  expect(owner.resize('stale',80,24)).toBe(false);expect(owner.resize(owner.snapshot.id,80,24)).toBe(true)
  await owner.close();await owner.close()
  // **Its own group, and never the session ended outright.** `terminate` would take the worker this attached
  // to with it; what has to go is the `attach` process this started
  expect(f.signal).toHaveBeenCalledExactlyOnceWith('SIGTERM',{kind:'group'})
  expect(f.terminate).not.toHaveBeenCalled()
  expect(owner.snapshot.status).toBe('exited');expect(owner.input(owner.snapshot.id,'late')).toBe(false)
})
