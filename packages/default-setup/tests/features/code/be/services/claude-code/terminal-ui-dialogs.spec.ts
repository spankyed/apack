import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture() {
  let sessionId = '11111111-1111-4111-8111-111111111111'
  let nativeSessionId = sessionId
  const item = { id: 'dialog-1', kind: 'permission_file', payload: { requestId: 'read-1', toolName: 'Read', operationType: 'read', input: { file_path: '/original' } } }
  const state = { open: [item] }
  const answer = vi.fn(() => { state.open = [] })
  const store = { getState: () => state, answer }
  let appState = { mcp: {clients:[] as {name:string,type:string}[],tools:[] as {name:string}[]}, settings: { showClearContextOnPlanAccept: false }, toolPermissionContext: { mode: 'plan', prePlanMode: 'default', isAutoModeAvailable: true, isBypassPermissionsModeAvailable: false } }
  const context = { appendSystemMessage: vi.fn(async (_message: unknown) => {}), dialogStore: store, getAppState: () => appState, setAppState: (update: (state: typeof appState) => typeof appState) => { appState = update(appState) } }
  const binding = { surface: 'terminal', toolContext: () => context }
  let disabled = false
  const reconnect = vi.fn(async (_name: string) => ({client:{type:'connected'}})), toggle = vi.fn(async (_name: string) => {disabled = !disabled}), isDisabled = vi.fn(() => disabled)
  const native = { mcpControls: {Mot: () => reconnect, urs: () => toggle, Z_e: () => isDisabled}, mcp: { Q_n: vi.fn((_input: unknown) => [{name:'research',status:'connected'}]) }, rename: { Qar: vi.fn(async () => ({ newName: 'Native title', requestedName: 'Requested', isGenerated: false, message: 'Renamed' })), G8s: vi.fn(() => 'Original native reminder') }, questionOptions: { q: () => nativeSessionId, Sye: vi.fn(), x$: vi.fn(), s3: vi.fn(), EN: vi.fn() }, paths: { ce: () => '/workspace', Ar: () => null }, questionText: { VL: (value: string) => value.includes('UNSAFE') }, runtime: { ty: () => true, Cf: () => '/private/original.jsonl', Ae: vi.fn((value: unknown) => value) }, planConsent: { kTe: (mode: string) => ({ applies: [{ type: 'setMode', mode, destination: 'session' }] }), Y_n: () => ({ applies: [] }), hv: () => true }, planAuto: { yp: () => false, Fx: vi.fn() }, planNormalize: { nV: (value: unknown) => value, vSe: (value: unknown) => value }, planTool: { Cxn: () => '' }, planTeams: { is: () => false }, planProactivity: { BG: () => false } }

  const start = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const end = claudeTerminalUiRuntime.indexOf('const server=http.createServer')
  const control = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};control`, {
    originalContext: binding, initialize: async () => native, AbortController, randomUUID,
    readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'fixture',
  }) as (request: Record<string, unknown>, abort: AbortController) => Promise<any>
  const snapshot = async () => (await control({ subtype: 'apack_file_dialogs' }, new AbortController())).dialogs[0]
  const reply = (dialog: any, overrides = {}) => control({ subtype: 'apack_answer_file_dialog', id: dialog.id, revision: dialog.revision, session_id: dialog.sessionId, decision: 'allow', ...overrides }, new AbortController())
  return { state, item, answer, snapshot, reply, control, native, context, replaceNativeSession() { nativeSessionId = randomUUID() }, replaceSession() { sessionId = randomUUID() } }
}

it('allows only the original native input once, ignoring arbitrary permission updates', async () => {
  const f = fixture(), d = await f.snapshot()
  await f.reply(d, { updatedInput: { file_path: '/tampered' }, permissionUpdates: ['untrusted'] })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'allow', updatedInput: { file_path: '/original' } })
  await expect(f.reply(d)).rejects.toThrow('changed or expired')
  expect(f.answer).toHaveBeenCalledOnce()
})
it.each(['payload', 'nested input', 'session', 'closed', 'another dialog'])('rejects stale approval after %s changes', async change => {
  const f = fixture(), d = await f.snapshot()
  if (change === 'payload') f.item.payload = { ...f.item.payload }
  if (change === 'nested input') f.item.payload.input.file_path = '/changed'
  if (change === 'session') f.replaceSession()
  if (change === 'closed') f.state.open = []
  if (change === 'another dialog') f.state.open.push({ ...f.item, id: 'dialog-2' })
  await expect(f.reply(d)).rejects.toThrow('changed or expired')
  expect(f.answer).not.toHaveBeenCalled()
})
it('passes only native denial feedback and rejects unsupported decisions', async () => {
  const f = fixture(), d = await f.snapshot()
  await expect(f.reply(d, { decision: 'always_allow' })).rejects.toThrow('Invalid')
  await f.reply(d, { decision: 'deny', feedback: 'No thanks' })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'deny', feedback: 'No thanks' })
})

function bashFixture() {
  const f = fixture(); f.item.kind = 'permission_bash'
  const payload = Object.assign(f.item.payload, { toolName: 'Bash', command: 'printf original', classifierState: 'none', input: { command: 'printf original', description: 'Fixture command' } })
  const snapshot = async () => (await f.control({ subtype: 'apack_bash_dialogs' }, new AbortController())).dialogs[0]
  const reply = (dialog: any, extra = {}) => f.control({ subtype: 'apack_answer_bash_dialog', id: dialog.id, revision: dialog.revision, session_id: dialog.sessionId, decision: 'allow', ...extra }, new AbortController())
  return { ...f, payload, snapshot, reply }
}
it('allows the original Bash input once and ignores attempted command replacement', async () => {
  const f = bashFixture(), dialog = await f.snapshot()
  await f.reply(dialog, { updatedInput: { command: 'tampered' }, permissionUpdates: ['untrusted'] })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'allow', updatedInput: { command: 'printf original', description: 'Fixture command' } })
  await expect(f.reply(dialog)).rejects.toThrow('changed or expired')
})
it.each(['command', 'classifier', 'session', 'native session'] as const)('refuses a Bash decision after native %s changes', async change => {
  const f = bashFixture(), dialog = await f.snapshot()
  if (change === 'command') f.payload.input.command = 'printf changed'
  if (change === 'classifier') f.payload.classifierState = 'checking'
  if (change === 'session') f.replaceSession()
  if (change === 'native session') f.replaceNativeSession()
  await expect(f.reply(dialog)).rejects.toThrow('changed or expired')
  expect(f.answer).not.toHaveBeenCalled()
})

it.each(['Write', 'Edit'] as const)('retains original %s review/input and refuses a changed proposal', async toolName => {
  const f = fixture()
  const input = toolName === 'Write' ? { file_path: '/original', content: 'after' } : { file_path: '/original', old_string: 'before', new_string: 'after' }
  const content = toolName === 'Write' ? { kind: 'file-write-diff', fileExists: true, oldContent: 'before', content: 'after' } : { kind: 'file-edit-diff', edits: [{ old_string: 'before', new_string: 'after', replace_all: true }] }
  const payload = Object.assign(f.item.payload, { toolName, operationType: 'write', input, content, contentWithheld: false })
  const dialog = await f.snapshot()
  expect(dialog.review).toEqual({ withheld: false, before: 'before', after: 'after', ...(toolName === 'Edit' ? { replaceAll: true } : {}) })
  payload.contentWithheld = true
  await expect(f.reply(dialog)).rejects.toThrow('changed or expired')
  const withheld = await f.snapshot()
  expect(withheld.review).toEqual({ withheld: true })
  await f.reply(withheld, { updatedInput: { file_path: '/tampered', content: 'tampered' } })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'allow', updatedInput: input })
})
it('preserves the native withheld-content warning without leaking before/after text', async () => {
  const f = fixture()
  Object.assign(f.item.payload, { toolName: 'Write', operationType: 'write', contentWithheld: true, content: { kind: 'no-changes', message: 'Proposed content is too large to show' } })
  expect((await f.snapshot()).review).toEqual({ withheld: true, notice: 'Proposed content is too large to show' })
})

function planFixture() {
  const f = fixture()
  f.item.kind = 'permission_exit_plan_mode_v2'
  Object.assign(f.item.payload, { toolName: 'ExitPlanMode', plan: '# Original plan', planFilePath: '/private/plan.md', input: {} })
  const snapshot = async () => (await f.control({ subtype: 'apack_plan_dialogs' }, new AbortController())).dialogs[0]
  const reply = (dialog: any, extra = {}) => f.control({ subtype: 'apack_answer_plan_dialog', id: dialog.id, revision: dialog.revision, session_id: dialog.sessionId, choice: 'yes-default-keep-context', ...extra }, new AbortController())
  return { ...f, snapshot, reply }
}
it('constructs native plan mode updates and ignores arbitrary host permission updates', async () => {
  const f = planFixture(), dialog = await f.snapshot()
  await f.reply(dialog, { permissionUpdates: [{ mode: 'bypassPermissions' }], updatedInput: { plan: 'tampered' } })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'allow', updatedInput: {}, permissionUpdates: [{ type: 'setMode', mode: 'default', destination: 'session' }] })
  await expect(f.reply(dialog)).rejects.toThrow('changed or expired')
})
it('expires plan choices when native eligibility changes and withholds unsafe plans', async () => {
  const f = planFixture(), dialog = await f.snapshot()
  f.context.getAppState().toolPermissionContext.isAutoModeAvailable = false
  await expect(f.reply(dialog)).rejects.toThrow('changed or expired')
  Object.assign(f.item.payload, { plan: 'UNSAFE plan' })
  const withheld = await f.snapshot()
  expect(withheld.presentation.plan).toBe(''); expect(withheld.presentation.choices).toEqual([])
  await expect(f.reply(withheld)).rejects.toThrow('unavailable')
  await f.reply(withheld, { choice: 'no', feedback: 'Shorter plan please' })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'deny', feedback: 'Shorter plan please' })
})
it('queues native clear-context continuation and resolves with the native denial-shaped result', async () => {
  const f = planFixture(); f.context.getAppState().settings.showClearContextOnPlanAccept = true
  const dialog = await f.snapshot()
  await f.reply(dialog, { choice: 'yes-auto-clear-context', feedback: 'Keep the tests' })
  expect(f.context.getAppState()).toMatchObject({ initialMessage: { clearContext: true, resetTrigger: 'plan_mode_exit', mode: 'auto', message: { content: expect.stringContaining('# Original plan') } } })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'deny' })
})
it('passes an edited, reviewable plan through the native tool input only', async () => {
  const f = planFixture(), dialog = await f.snapshot()
  await expect(f.reply(dialog, { plan: 'UNSAFE replacement' })).rejects.toThrow('cannot be reviewed')
  await f.reply(dialog, { plan: '# Reviewed revision', feedback: 'Proceed carefully' })
  expect(f.answer).toHaveBeenCalledWith('dialog-1', { behavior: 'allow', updatedInput: { plan: '# Reviewed revision' }, permissionUpdates: [{ type: 'setMode', mode: 'default', destination: 'session' }], feedback: 'Proceed carefully' })
})

it('runs original native rename only for the current native and observer session',async()=>{
 const f=fixture(),request={subtype:'apack_rename_session',session_id:'11111111-1111-4111-8111-111111111111',title:'Requested'}
 expect(await f.control(request,new AbortController())).toEqual({title:'Native title',message:'Renamed'})
 expect(f.native.rename.Qar).toHaveBeenCalledWith('Requested',f.context,true)
 expect(f.native.rename.G8s).toHaveBeenCalledWith('Native title','Requested')
 expect(f.native.runtime.Ae).toHaveBeenCalledWith({content:'Original native reminder',isMeta:true})
 expect(f.context.appendSystemMessage).toHaveBeenCalledWith({content:'Original native reminder',isMeta:true})
 f.replaceNativeSession();await expect(f.control(request,new AbortController())).rejects.toThrow('session changed')
 expect(f.native.rename.Qar).toHaveBeenCalledOnce()
});

it('does not add a manual rename reminder for an original generated title',async()=>{
 const f=fixture();f.native.rename.Qar.mockResolvedValueOnce({newName:'Generated',requestedName:'Generated',isGenerated:true,message:'Generated title'})
 await f.control({subtype:'apack_rename_session',session_id:'11111111-1111-4111-8111-111111111111',title:''},new AbortController())
 expect(f.native.rename.G8s).not.toHaveBeenCalled();expect(f.context.appendSystemMessage).not.toHaveBeenCalled()
});

it('uses original native MCP formatting with live clients/tools and refuses a foreign session',async()=>{
 const f=fixture(),options={mcpClients:[{name:'research',type:'connected'}],tools:[{name:'mcp__research__echo'}]}
 Object.assign(f.context,{options});Object.assign(f.context.getAppState().mcp,{clients:options.mcpClients,tools:options.tools})
 const request={subtype:'apack_mcp_status',session_id:'11111111-1111-4111-8111-111111111111'}
 expect(await f.control(request,new AbortController())).toEqual({mcpServers:[{name:'research',status:'connected'}]})
 expect(f.native.mcp.Q_n).toHaveBeenCalledWith({connections:options.mcpClients,tools:options.tools})
 f.replaceNativeSession();await expect(f.control(request,new AbortController())).rejects.toThrow('session changed')
 expect(f.native.mcp.Q_n).toHaveBeenCalledOnce()
});

function mcpControlFixture() {
 const f=fixture();f.context.getAppState().mcp.clients=[{name:'research',type:'connected'}]
 const request={subtype:'apack_mcp_control',session_id:'11111111-1111-4111-8111-111111111111',server_name:'research',operation:'reconnect'}
 return {...f,request,run:(extra={})=>f.control({...request,...extra},new AbortController())}
}
it('uses registered original reconnect and idempotent native enable/disable callbacks',async()=>{
 const f=mcpControlFixture(),reconnect=f.native.mcpControls.Mot(),toggle=f.native.mcpControls.urs()
 await f.run();expect(reconnect).toHaveBeenCalledWith('research')
 await f.run({operation:'enable'});expect(toggle).not.toHaveBeenCalled()
 await f.run({operation:'disable'});await f.run({operation:'disable'});expect(toggle).toHaveBeenCalledTimes(1)
 await f.run({operation:'enable'});expect(toggle).toHaveBeenCalledTimes(2)
})
it('rejects unknown servers and changed sessions before native mutation',async()=>{
 const f=mcpControlFixture();await expect(f.run({server_name:'foreign'})).rejects.toThrow('not found')
 f.replaceNativeSession();await expect(f.run()).rejects.toThrow('session changed')
 expect(f.native.mcpControls.Mot()).not.toHaveBeenCalled();expect(f.native.mcpControls.urs()).not.toHaveBeenCalled()
})
it('preserves original policy refusal and releases the in-flight control slot',async()=>{
 const f=mcpControlFixture();f.native.mcpControls.Mot().mockRejectedValueOnce(new Error('blocked by enterprise managed policy'))
 await expect(f.run()).rejects.toThrow('enterprise managed policy');await f.run()
 expect(f.native.mcpControls.Mot()).toHaveBeenCalledTimes(2)
})
it('refuses overlapping mutations and stale results after a session changes',async()=>{
 const f=mcpControlFixture();let resolve!:()=>void
 f.native.mcpControls.Mot().mockImplementationOnce(()=>new Promise<any>(r=>{resolve=()=>r({client:{type:'connected'}})}))
 const pending=f.run();await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'))
 await expect(f.run({operation:'disable'})).rejects.toThrow('in progress')
 f.replaceSession();resolve();await expect(pending).rejects.toThrow('session changed')
 expect(f.native.mcpControls.urs()).not.toHaveBeenCalled()
})

it('reports the live engine connection after mutation rather than the startup tool snapshot',async()=>{
 const f=mcpControlFixture(),startup={mcpClients:[{name:'research',type:'connected'}],tools:[{name:'mcp__research__echo'}]}
 Object.assign(f.context,{options:startup})
 f.native.mcpControls.urs().mockImplementationOnce(async()=>{f.context.getAppState().mcp.clients=[{name:'research',type:'disabled'}]})
 await f.run({operation:'disable'})
 expect(f.native.mcp.Q_n).toHaveBeenLastCalledWith({connections:[{name:'research',type:'disabled'}],tools:[]})
 await f.control({subtype:'apack_mcp_status',session_id:f.request.session_id},new AbortController())
 expect(f.native.mcp.Q_n).toHaveBeenLastCalledWith({connections:[{name:'research',type:'disabled'}],tools:[]})
 expect(startup.mcpClients[0]?.type).toBe('connected')
})
