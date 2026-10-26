import { tmpdir } from 'node:os'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'

const f = vi.hoisted(() => {
  vi.resetModules()
  return { metadata: {permissionMode:'default',modelSelection:undefined as string|undefined}, spawn: vi.fn(), request: vi.fn(), submit: vi.fn(), update: vi.fn(), projection: { sessionId:'11111111-1111-1111-1111-111111111111', tasks: [] } }
})
vi.mock('node-pty', () => ({spawn:f.spawn}))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts', () => ({createClaudeTerminalBridge: async () => ({
  pluginRoot:'/private/fixture-plugin', bunOptions:'fixture-preload', close:async()=>{}, ready:true,
  projection:f.projection, session:{metadata:f.metadata,update:f.update},
  uiTransport:{request:f.request}, submit:f.submit,
})}))
async function fixture(options: {model?: string;permissionMode?: 'plan';prePlanMode?: 'acceptEdits'} = {}) {
  let exit!: (event:{exitCode:number})=>void
  f.spawn.mockImplementation(() => ({pid:0,onData(){},onExit(callback:typeof exit){exit=callback},kill(){exit({exitCode:0})}}))
  const prepared = await prepareClaudeNativeTerminal({sessionId:f.projection.sessionId,cwd:tmpdir(),cliPath:process.execPath,permissionMode:'default',settings:{effective:{},sources:[]},...options})
  return {prepared,owner:await prepared.start()}
}
beforeEach(() => {
  vi.clearAllMocks()
  f.metadata.modelSelection=undefined;f.update.mockReset()
  f.projection.sessionId='11111111-1111-1111-1111-111111111111'
  f.request.mockReset(); f.submit.mockReset()
})
it('requires the native phase acknowledgement before admitting the human prompt', async () => {
  const {prepared,owner}=await fixture()
  try {
    const order:string[]=[]
    f.request.mockImplementation(async request => {order.push(request.subtype);return request.subtype==='apack_parent_prompt_state'?{main:true}:{mode:'plan',prePlanMode:'default'}})
    f.submit.mockImplementation(async () => {order.push('human');return {sessionId:f.projection.sessionId,uuid:'original',text:'My plan'}})
    await expect(owner.submit('My plan',undefined,'Plan')).resolves.toMatchObject({uuid:'original'})
    expect(order).toEqual(['apack_parent_prompt_state','apack_set_composer_phase','human'])
    expect(f.update).toHaveBeenCalledWith({permissionMode:'plan',prePlanMode:'default'})
  } finally {await prepared.dispose()}
})
it.each(['refused','unacknowledged','session-changed'])('retains the prompt when phase application is %s', async failure => {
  const {prepared,owner}=await fixture()
  try {
    f.request.mockImplementation(async request => {
      if(request.subtype==='apack_parent_prompt_state')return {main:true}
      if(failure==='refused')throw Error('Original policy refusal')
      if(failure==='session-changed')f.projection.sessionId='22222222-2222-2222-2222-222222222222'
      return {mode:failure==='unacknowledged'?'default':'plan'}
    })
    await expect(owner.submit('Keep this draft',undefined,'Plan')).rejects.toThrow(failure==='refused'?'Original policy refusal':failure==='session-changed'?'session changed':'not acknowledged')
    expect(f.submit).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled()
  } finally {await prepared.dispose()}
})
it('does not apply a phase to an Agent view and refuses overlapping parent submissions', async () => {
  const {prepared,owner}=await fixture()
  try {
    f.request.mockResolvedValueOnce({main:false})
    await expect(owner.submit('Parent',undefined,'Plan')).rejects.toThrow('main view')
    expect(f.request).toHaveBeenCalledTimes(1);expect(f.submit).not.toHaveBeenCalled()
    let release!: (value:unknown)=>void
    f.request.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
    const pending=owner.submit('Parent',undefined,'Plan')
    await expect(owner.setPermissionMode('acceptEdits')).rejects.toThrow('parent input is changing')
    await expect(owner.submit('Overlapping',undefined,'Edit')).rejects.toThrow('draft was retained')
    f.request.mockResolvedValue({mode:'plan'});f.submit.mockResolvedValue({sessionId:f.projection.sessionId,uuid:'original',text:'Parent'})
    release({main:true});await pending
  } finally {await prepared.dispose()}
})

it('waits for an outstanding permission change before admitting a parent prompt', async () => {
  const {prepared,owner}=await fixture()
  try {
    let release!: (value:unknown)=>void
    f.request.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
    const changing=owner.setPermissionMode('acceptEdits')
    await expect(owner.submit('Keep my draft',undefined,'Plan')).rejects.toThrow('draft was retained')
    expect(f.submit).not.toHaveBeenCalled()
    release({mode:'acceptEdits'});await changing
  } finally {await prepared.dispose()}
})

it('checks saved Plan restoration through the existing session-bound owner snapshot before parent admission',async()=>{
 const {prepared,owner}=await fixture({permissionMode:'plan',prePlanMode:'acceptEdits'})
 try{
  const order:string[]=[]
  f.request.mockImplementation(async request=>{order.push(request.subtype);return request.subtype==='apack_owner_snapshot'?{sessionId:f.projection.sessionId}:request.subtype==='apack_parent_prompt_state'?{main:true}:{mode:'acceptEdits'}})
  f.submit.mockImplementation(async()=>{order.push('human');return {sessionId:f.projection.sessionId,uuid:'original',text:'Edit'}})
  await owner.submit('Edit',undefined,'Edit')
  expect(order).toEqual(['apack_owner_snapshot','apack_parent_prompt_state','apack_set_composer_phase','human'])
  order.length=0;await owner.submit('Continue',undefined,'Edit')
  expect(order).toEqual(['apack_parent_prompt_state','apack_set_composer_phase','human'])
 }finally{await prepared.dispose()}
})

it('carries original Config selections and default reset into continuation without retaining the launch override', async()=>{
 const {prepared,owner}=await fixture({model:'opus'})
 try{
  expect(owner.modelSelection).toBe('opus')
  f.metadata.modelSelection='sonnet';expect(owner.modelSelection).toBe('sonnet')
  f.metadata.modelSelection='default';expect(owner.modelSelection).toBe('default')
  f.request.mockResolvedValue({selection:'haiku',notice:'Set model to Haiku for this session only'})
  f.update.mockImplementation(value=>Object.assign(f.metadata,value))
  await expect(owner.setModel('haiku')).resolves.toEqual({selection:'haiku',notice:'Set model to Haiku for this session only'})
  expect(owner.modelSelection).toBe('haiku')
  f.metadata.modelSelection='sonnet';expect(owner.modelSelection).toBe('sonnet')
 }finally{await prepared.dispose()}
})

it('retains the native model notice and restart warnings as desktop text', async () => {
 const {prepared,owner}=await fixture()
 try {
  f.request.mockResolvedValue({selection:'haiku',notice:'Set model to \u001b[1mHaiku\u001b[0m for this session only\n     Managed settings pins Sonnet — that applies on restart'})
  await expect(owner.setModel('haiku')).resolves.toEqual({selection:'haiku',notice:'Set model to Haiku for this session only\n     Managed settings pins Sonnet — that applies on restart'})
 }finally{await prepared.dispose()}
})

it('refuses a missing model notice without claiming a complete acknowledgement', async () => {
 const {prepared,owner}=await fixture({model:'opus'})
 try {
  f.request.mockResolvedValue({selection:'haiku'})
  await expect(owner.setModel('haiku')).rejects.toThrow('model notice was not acknowledged')
  expect(owner.modelSelection).toBe('opus');expect(f.update).not.toHaveBeenCalled();expect(owner.busy).toBe(false)
 }finally{await prepared.dispose()}
})
