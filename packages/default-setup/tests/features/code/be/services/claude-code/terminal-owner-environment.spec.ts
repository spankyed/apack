import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'
import { nativeSession } from '../../_support/native-terminal.ts'

const native = vi.hoisted(() => { vi.resetModules(); return { open: vi.fn(), uiRequest: vi.fn(), closeBridge: vi.fn(async () => {}) } })
vi.mock('#generated/services.ts', () => ({ services: { terminal: { open: native.open } } }))
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
  native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] }, env: { FORCE_COLOR: color, FORCE_HYPERLINK: links } })
  const owner = await prepared.start()
  try {
    expect(owner.state.terminalSession).toEqual({id:'native-1',target:null})
    expect(native.open).toHaveBeenCalledWith(expect.objectContaining({ images:true,imageFiles:true, colors:expect.objectContaining({background:'#191919',foreground:'#d4d0ca',cursor:'#d3aa8e'}), shell: process.execPath, env: expect.objectContaining({ FORCE_COLOR: expectedColor, FORCE_HYPERLINK: expectedLinks }) }), expect.anything())
  } finally { await prepared.dispose() }
  expect(native.closeBridge).toHaveBeenCalledOnce()
})

it('preserves inherited capability overrides when no launch override is supplied', async () => {
  vi.stubEnv('FORCE_COLOR', '0'); vi.stubEnv('FORCE_HYPERLINK', '0')
  native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] } })
  await prepared.start()
  try { expect(native.open.mock.calls[0][0].env).toMatchObject({ FORCE_COLOR: '0', FORCE_HYPERLINK: '0' }) }
  finally { await prepared.dispose() }
})

it.each([undefined, '2'])('honors native NO_COLOR precedence, explicit FORCE_COLOR: %s', async color => {
  vi.stubEnv('FORCE_COLOR', undefined); vi.stubEnv('FORCE_HYPERLINK', undefined); vi.stubEnv('NO_COLOR', '1')
  native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath,
    permissionMode: 'default', settings: { effective: {}, sources: [] }, env: { FORCE_COLOR: color } })
  await prepared.start()
  try {
    const env = native.open.mock.calls[0][0].env
    expect(env.NO_COLOR).toBe('1'); expect(env.FORCE_COLOR).toBe(color); expect(env.FORCE_HYPERLINK).toBe('1')
    if (color === undefined) expect(env).not.toHaveProperty('FORCE_COLOR')
  } finally { await prepared.dispose() }
})

it.each([[undefined,undefined],['',''],['0','0'],['1','1']])('uses broker negotiation while preserving explicit image overrides: %s',async(images,expected)=>{
 vi.stubEnv('CLAUDE_CODE_FORCE_TERMINAL_IMAGES',undefined)
 native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
 const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:tmpdir(),cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]},env:{CLAUDE_CODE_FORCE_TERMINAL_IMAGES:images}})
 await prepared.start()
 try{expect(native.open.mock.calls[0][0].env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES).toBe(expected)}finally{await prepared.dispose()}
})


it.each([[0, undefined, 'exited'], [1, undefined, 'error'], [0, 'SIGKILL', 'error'], [0, 'SIGTERM', 'error']] as const)('classifies actual PTY exit code %s / signal %s without hiding an unexpected termination', async (exitCode, signal, status) => {
  let exited!: (event: { exitCode: number; signal?: string }) => void
  native.open.mockImplementation(async (_options, listeners) => { exited = event => listeners.onExit(event.exitCode, event.signal ?? null); return nativeSession(listeners) })
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: {effective:{},sources:[]} })
  const owner = await prepared.start();exited({exitCode,signal});await owner.done
  expect(owner.state.status).toBe(status);expect(owner.state.exitCode).toBe(exitCode)
})

it('keeps intentional signal-driven shutdown classified as exited', async () => {
  native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: {effective:{},sources:[]} })
  const owner = await prepared.start();await prepared.dispose();expect(owner.state.status).toBe('exited')
})


it('leaves file/shared-memory reads and capability replies to the broker and binds references to its session', async () => {
  let data!: (text: string) => void
  const write = vi.fn(async () => {}), pause = vi.fn(async () => {}), resume = vi.fn(async () => {})
  native.open.mockImplementation(async (_options, listeners) => { data = listeners.onOutput; return nativeSession(listeners, { write, pause, resume }) })
  native.uiRequest.mockResolvedValue({ tree: { type: 'NativeImageReference', props: { imageId: 7, columns: 2, rows: 1, alt: 'Cover' } } })
  const prepared = await prepareClaudeNativeTerminal({ sessionId: '11111111-1111-1111-1111-111111111111', cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: { effective: {}, sources: [] } })
  const owner = await prepared.start()
  try {
    // Neither name exists. The observer must not read, unlink, answer or rewrite either transport.
    const file = Buffer.from('/nonexistent/fixture-frame.rgba').toString('base64'), shm = Buffer.from('/fixture-unavailable-image').toString('base64')
    const frames = ['\x1b_Gi=24,s=1,v=1,a=q,t=f,f=32;' + file + '\x1b\\', '\x1b_Ga=T,U=1,q=1,f=32,s=1,v=1,t=s,i=7,c=2,r=1;' + shm + '\x1b\\']
    for (const frame of frames) data(frame)
    expect(await owner.uiTransport.request({ subtype: 'ui_render' })).toMatchObject({ tree: { type: 'NativeBrokerImage', props: { imageId: 7, terminalSession: { id: 'native-1', target: null } } } })
    expect(owner.output.map(chunk => chunk.text).join('')).toBe(frames.join(''))
    expect(write).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled()
    expect(native.uiRequest).toHaveBeenCalledExactlyOnceWith({ subtype: 'ui_render' })
  } finally { await prepared.dispose() }
  await expect(owner.uiTransport.request({ subtype: 'ui_render' })).rejects.toThrow('owner closed')
})


it('launches a PATH-selected native CLI from the captured environment', async () => {
 const root=await mkdtemp(join(tmpdir(),'cc-native-path-')),executable=join(root,'claude')
 await writeFile(executable,'authored executable fixture',{mode:0o700})
 native.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
 try {
  const prepared=await prepareClaudeNativeTerminal({sessionId:'11111111-1111-1111-1111-111111111111',cwd:root,cliPath:'claude',permissionMode:'default',settings:{effective:{},sources:[]},env:{PATH:root}})
  try {await prepared.start();expect(native.open.mock.calls[0][0].shell).toBe(await realpath(executable));expect(native.open.mock.calls[0][0].env.PATH).toBe(root)} finally {await prepared.dispose()}
 } finally {await rm(root,{recursive:true,force:true})}
})
