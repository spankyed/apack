import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'

const native = vi.hoisted(() => { vi.resetModules(); return { spawn: vi.fn(), uiRequest: vi.fn(), closeBridge: vi.fn(async () => {}) } })
vi.mock('node-pty', () => ({ spawn: native.spawn }))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts', () => ({ createClaudeTerminalBridge: async () => ({ pluginRoot: '/private/fixture-plugin', bunOptions: 'fixture-preload', close: native.closeBridge, ready: true, uiTransport: { request: native.uiRequest, subscribe: () => () => {}, promptHosts: {} }, projection: { sessionId: '11111111-1111-1111-1111-111111111111', tasks: [] }, session: { metadata: undefined } }) }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it.each([
  [undefined, undefined, '3', '1'],
  ['0', '0', '0', '0'],
  ['', '', '', ''],
  ['2', '1', '2', '1'],
  ['false', '0', 'false', '0'],
])('passes explicit native capabilities through the actual launch boundary: %s / %s', async (color, links, expectedColor, expectedLinks) => {
  vi.stubEnv('FORCE_COLOR', undefined); vi.stubEnv('FORCE_HYPERLINK', undefined); vi.stubEnv('NO_COLOR', undefined)
  let exited: ((event: { exitCode: number }) => void) | undefined
  native.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exited) { exited = callback }, kill() { exited?.({ exitCode: 0 }) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] }, env: { FORCE_COLOR: color, FORCE_HYPERLINK: links } })
  await prepared.start()
  try {
    expect(native.spawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ FORCE_COLOR: expectedColor, FORCE_HYPERLINK: expectedLinks }) }))
  } finally { await prepared.dispose() }
  expect(native.closeBridge).toHaveBeenCalledOnce()
})

it('preserves inherited capability overrides when no launch override is supplied', async () => {
  vi.stubEnv('FORCE_COLOR', '0'); vi.stubEnv('FORCE_HYPERLINK', '0')
  let exited: ((event: { exitCode: number }) => void) | undefined
  native.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exited) { exited = callback }, kill() { exited?.({ exitCode: 0 }) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] } })
  await prepared.start()
  try { expect(native.spawn.mock.calls[0][2].env).toMatchObject({ FORCE_COLOR: '0', FORCE_HYPERLINK: '0' }) }
  finally { await prepared.dispose() }
})

it.each([undefined, '2'])('honors native NO_COLOR precedence, explicit FORCE_COLOR: %s', async color => {
  vi.stubEnv('FORCE_COLOR', undefined); vi.stubEnv('FORCE_HYPERLINK', undefined); vi.stubEnv('NO_COLOR', '1')
  let exited: ((event: { exitCode: number }) => void) | undefined
  native.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exited) { exited = callback }, kill() { exited?.({ exitCode: 0 }) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] }, env: { FORCE_COLOR: color } })
  await prepared.start()
  try {
    const env = native.spawn.mock.calls[0][2].env
    expect(env.NO_COLOR).toBe('1'); expect(env.FORCE_COLOR).toBe(color); expect(env.FORCE_HYPERLINK).toBe('1')
    if (color === undefined) expect(env).not.toHaveProperty('FORCE_COLOR')
  } finally { await prepared.dispose() }
})

it.each([[undefined,'1'],['',''],['0','0'],['1','1']])('declares image support while preserving caller opt-out: %s',async(images,expected)=>{
 vi.stubEnv('CLAUDE_CODE_FORCE_TERMINAL_IMAGES',undefined)
 let exited:((event:{exitCode:number})=>void)|undefined
 native.spawn.mockImplementation(()=>({pid:0,onData(){},onExit(callback:typeof exited){exited=callback},kill(){exited?.({exitCode:0})}}))
 const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:tmpdir(),cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]},env:{CLAUDE_CODE_FORCE_TERMINAL_IMAGES:images}})
 await prepared.start()
 try{expect(native.spawn.mock.calls[0][2].env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES).toBe(expected)}finally{await prepared.dispose()}
})


it.each([[0, undefined, 'exited'], [1, undefined, 'error'], [0, 9, 'error'], [0, 15, 'error']] as const)('classifies actual PTY exit code %s / signal %s without hiding an unexpected termination', async (exitCode, signal, status) => {
  let exited!: (event: { exitCode: number; signal?: number }) => void
  native.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exited) { exited = callback }, kill() { exited({exitCode:0,signal:15}) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: {effective:{},sources:[]} })
  const owner = await prepared.start();exited({exitCode,signal});await owner.done
  expect(owner.state.status).toBe(status);expect(owner.state.exitCode).toBe(exitCode)
})

it('keeps intentional signal-driven shutdown classified as exited', async () => {
  let exited!: (event: { exitCode: number; signal?: number }) => void
  native.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exited) { exited = callback }, kill() { exited({exitCode:0,signal:15}) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: {effective:{},sources:[]} })
  const owner = await prepared.start();await prepared.dispose();expect(owner.state.status).toBe('exited')
})


it('reads file pixels in the live terminal owner and projects them without giving the engine bytes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'claude-owner-image-')),path=join(directory,'frame.rgba'),pixels=Buffer.from([255,128,0,255])
  await writeFile(path,pixels)
  let data!: (text:string)=>void, exited!: (event:{exitCode:number})=>void
  const write=vi.fn(),pause=vi.fn(),resume=vi.fn()
  native.spawn.mockImplementation(()=>({pid:0,write,pause,resume,onData(callback:typeof data){data=callback},onExit(callback:typeof exited){exited=callback},kill(){exited({exitCode:0})}}))
  native.uiRequest.mockResolvedValue({tree:{type:'NativeImageReference',props:{imageId:7,columns:2,rows:1,alt:'Cover'}}})
  const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:directory,cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]}})
  const owner=await prepared.start(),changed=vi.fn(),detach=owner.uiTransport.subscribe(changed)
  try{
    const name=Buffer.from(path).toString('base64')
    data('\x1b_Gi=24,s=1,v=1,a=q,t=f,f=32;'+name+'\x1b\\')
    await vi.waitFor(()=>expect(write).toHaveBeenCalledWith('\x1b_Gi=24;OK\x1b\\'))
    data('\x1b_Ga=T,U=1,q=1,f=32,s=1,v=1,t=f,i=7,c=2,r=1;'+name+'\x1b\\')
    await vi.waitFor(()=>expect(changed).toHaveBeenCalledOnce())
    expect(await owner.uiTransport.request({subtype:'ui_render'})).toMatchObject({tree:{type:'NativeImage',props:{format:'rgba',data:pixels.toString('base64')}}})
    expect(native.uiRequest).toHaveBeenCalledExactlyOnceWith({subtype:'ui_render'})
    expect(owner.output.map(chunk=>chunk.text).join('')).toContain('t=d')
    expect(owner.output.map(chunk=>chunk.text).join('')).not.toContain(name)
    expect(pause).toHaveBeenCalled();await vi.waitFor(()=>expect(resume).toHaveBeenCalled())
    data('\x1b_Ga=d,d=I,i=7,q=2;\x1b\\')
    expect(await owner.uiTransport.request({subtype:'ui_render'})).toMatchObject({tree:{type:'Text'}})
  }finally{detach();await prepared.dispose();await rm(directory,{recursive:true,force:true})}
})
