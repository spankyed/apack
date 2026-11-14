import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'
import { nativeSession } from '../../_support/native-terminal.ts'
const f = vi.hoisted(() => { vi.resetModules(); return { open: vi.fn(), journal: vi.fn(), request: vi.fn(), ready: true, nativePid: undefined as number | undefined, projection: { sessionId: '11111111-1111-4111-8111-111111111111', tasks: [] } } })
vi.mock('#generated/services.ts', () => ({ services: { terminal: { open: f.open } } }))
vi.mock('#features/code/be/services/claude-code/terminal-journal.ts', () => ({ createClaudeNativeJournalReader: () => f.journal }))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts', () => ({ createClaudeTerminalBridge: async () => ({ pluginRoot: '/private/fixture-plugin', bunOptions: 'fixture-preload', close: async () => {}, get ready() { return f.ready }, get nativePid() { return f.nativePid }, projection: f.projection, transcripts: [], session: { metadata: { permissionMode: 'default' }, update() {} }, uiTransport: { request: f.request } }) }))
beforeEach(() => { vi.clearAllMocks(); f.request.mockReset(); f.journal.mockReset().mockResolvedValue({ entries: [], pending: false, problems: [] }); f.projection.sessionId = '11111111-1111-4111-8111-111111111111'; f.ready = true; f.nativePid = undefined })
async function fixture() {
  f.open.mockImplementation(async (_options, listeners) => nativeSession(listeners))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: f.projection.sessionId, cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: { effective: {}, sources: [] } }), owner = await prepared.start()
  const notice = { id: 'original', revision: randomUUID(), sessionId: f.projection.sessionId, kind: 'autocompact_offer' as const, title: 'Autocompact sooner?', paragraphs: ['Original explanation'], selectedTokens: 400000, canPrevious: true, canNext: true, choices: [{ value: 'compact_keep' as const, label: 'Keep auto' }, { value: 'compact_accept' as const, label: 'Autocompact at 400k' }] }
  f.request.mockResolvedValueOnce({ notice, handoffPending: false, retirements: [] }); await owner.refreshNotice()
  const request = { id: notice.id, revision: notice.revision, sessionId: notice.sessionId, decision: 'compact_next' as const }
  return { prepared, owner, notice, request }
}
it('keeps the current card mounted until a size-only action receives the fresh native presentation', async () => {
  const { prepared, owner, notice, request } = await fixture()
  try {
    let resolve!: (value: unknown) => void
    f.request.mockResolvedValueOnce({ answered: true }).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const action = owner.answerNotice(request); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    expect(owner.state.notice).toEqual(notice)
    const next = { ...notice, revision: randomUUID(), selectedTokens: 500000, canNext: false }
    resolve({ notice: next, handoffPending: false, retirements: [] }); await action
    expect(owner.state.notice).toEqual(next)
  } finally { await prepared.dispose() }
})
it('retains the current card when size acknowledgement is refused', async () => {
  const { prepared, owner, notice, request } = await fixture()
  try {
    f.request.mockResolvedValueOnce({ answered: false })
    await expect(owner.answerNotice(request)).rejects.toThrow('not acknowledged')
    expect(owner.state.notice).toEqual(notice)
  } finally { await prepared.dispose() }
})
it('still retires the card after an original final decision', async () => {
  const { prepared, owner, request } = await fixture()
  try {
    f.request.mockResolvedValueOnce({ answered: true })
    await owner.answerNotice({ ...request, decision: 'compact_keep' })
    expect(owner.state.notice).toBeUndefined()
  } finally { await prepared.dispose() }
})

it('reads startup policy consent only after the original observer owns the process', async () => {
  const { prepared, owner, notice } = await fixture()
  try {
    f.ready = false; f.request.mockReset()
    await owner.refreshMcpInput(); expect(f.request).not.toHaveBeenCalled()
    await owner.refreshNotice(); expect(f.request).not.toHaveBeenCalled()
    f.nativePid = 12345
    const policy = { id: notice.id, revision: randomUUID(), sessionId: notice.sessionId, kind: 'managed_settings_security', title: 'Managed settings require approval', paragraphs: ['Original introduction', 'Original changes', 'Original advice', 'Original risks'], paragraphsAnsi: ['Original introduction', 'Original changes', 'Original advice', 'Original risks'], preferredChoice: 'policy_approve', choices: [{ value: 'policy_approve', label: 'Yes, I trust these settings' }, { value: 'policy_reject', label: 'No, exit Claude Code' }] }
    f.request.mockResolvedValueOnce({ notice: policy, handoffPending: false, retirements: [] })
    await owner.refreshNotice()
    expect(owner.state.notice).toEqual(policy)
    expect(f.request).toHaveBeenCalledExactlyOnceWith({ subtype: 'apack_native_notice' })
  } finally { await prepared.dispose() }
})

it('refuses parent submission during original park progress and restores it after Stay', async () => {
  const { prepared, owner, notice } = await fixture()
  try {
    const review = { ...notice, kind: 'left_arrow_confirm', preferredChoice: 'background_confirm', choices: [{ value: 'background_stay', label: 'Stay' }, { value: 'background_confirm', label: 'Background anyway' }] }
    f.request.mockResolvedValueOnce({ notice: review, handoffPending: true, retirements: [] }); await owner.refreshNotice()
    expect(owner.state.handoffPending).toBe(true)
    f.request.mockClear(); await expect(owner.submit('Retained notes', [])).rejects.toThrow('moving to the background'); expect(f.request).not.toHaveBeenCalled()
    f.request.mockResolvedValueOnce({ answered: true, handoffPending: false }); await owner.answerNotice({ id: notice.id, revision: notice.revision, sessionId: notice.sessionId, decision: 'background_stay' })
    expect(owner.state.handoffPending).toBe(false); expect(owner.state.notice).toBeUndefined()
  } finally { await prepared.dispose() }
})

it('keeps the completed parent and retires its controls when the native agents screen changes session', async () => {
  const { prepared, owner, notice } = await fixture()
  try {
    const continuation = { type: 'continued-in', sessionId: notice.sessionId, continuedInSessionId: '22222222-2222-4222-8222-222222222222', timestamp: new Date().toISOString() }
    f.journal.mockResolvedValueOnce({ entries: [{ sessionId: notice.sessionId, row: continuation }], pending: false, problems: [] })
    await owner.readJournal()
    f.projection.sessionId = '33333333-3333-4333-8333-333333333333'
    f.journal.mockResolvedValueOnce({ entries: [
      { sessionId: notice.sessionId, row: { type: 'cost-state', totalCostUSD: 0.00056 } },
      { sessionId: continuation.continuedInSessionId, row: { type: 'cost-state', totalCostUSD: 9 } },
      { sessionId: continuation.continuedInSessionId, row: { type: 'assistant', uuid: 'copied-parent-row' } },
    ], pending: false, problems: [] })
    const parentJournal = await owner.readJournal()
    expect(parentJournal.entries).toHaveLength(1)
    expect(parentJournal.entries[0]?.sessionId).toBe(notice.sessionId)
    expect(owner.state.session?.totalCostUsd).toBe(0.00056)
    expect(owner.busy).toBe(false)

    expect(owner.state).toMatchObject({ sessionId: notice.sessionId, continuation: { sessionId: notice.sessionId, continuedInSessionId: continuation.continuedInSessionId }, handoffPending: false, busy: false, tasks: [] })
    expect(owner.state.notice).toBeUndefined(); expect(owner.state.view).toBeUndefined()
    f.request.mockClear(); await owner.refreshMcpInput(); await owner.refreshNotice(); expect(f.request).not.toHaveBeenCalled()
  } finally { await prepared.dispose() }
})

it('keeps a resumed owner live when its journal replays an earlier handoff and still admits a new handoff', async () => {
  const { prepared, owner, notice } = await fixture()
  try {
    const marker = { type: 'continued-in', sessionId: notice.sessionId, continuedInSessionId: '22222222-2222-4222-8222-222222222222', timestamp: new Date(Date.now() - 60000).toISOString() }
    f.journal.mockResolvedValueOnce({ entries: [{ sessionId: notice.sessionId, row: marker }], pending: false, problems: [] })
    await owner.readJournal()
    expect(owner.state.status).toBe('live')
    expect(owner.state.continuation).toBeUndefined()
    expect(owner.state.notice).toEqual(notice)
    const fresh = { ...marker, continuedInSessionId: '33333333-3333-4333-8333-333333333333', timestamp: new Date().toISOString() }
    f.journal.mockResolvedValueOnce({ entries: [{ sessionId: notice.sessionId, row: fresh }], pending: false, problems: [] })
    await owner.readJournal()
    expect(owner.state.continuation?.continuedInSessionId).toBe(fresh.continuedInSessionId)
    expect(owner.state.notice).toBeUndefined()
  } finally { await prepared.dispose() }
})

it.each(['computer_accessibility','computer_screen_recording'] as const)('keeps computer permission guidance mounted through %s acknowledgement and refresh',async decision=>{
 const {prepared,owner,notice}=await fixture()
 try{
  const computer={id:notice.id,revision:randomUUID(),sessionId:notice.sessionId,kind:'computer_use_approval',phase:'os_permissions',title:'Computer Use needs macOS permissions',paragraphs:['Original OS permissions guidance'],choices:[{value:'computer_accessibility',label:'Open Accessibility'},{value:'computer_screen_recording',label:'Open Screen Recording'},{value:'computer_retry',label:'Try again'}]}
  f.request.mockResolvedValueOnce({notice:computer,handoffPending:false,retirements:[]});await owner.refreshNotice()
  let resolve!:(value:unknown)=>void
  f.request.mockResolvedValueOnce({answered:true}).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
  const action=owner.answerNotice({id:computer.id,revision:computer.revision,sessionId:computer.sessionId,decision})
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'))
  expect(owner.state.notice).toEqual(computer)
  const next={...computer,revision:randomUUID(),paragraphs:['Original refreshed OS status']}
  resolve({notice:next,handoffPending:false,retirements:[]});await action;expect(owner.state.notice).toEqual(next)
  f.request.mockResolvedValueOnce({answered:true});await owner.answerNotice({id:next.id,revision:next.revision,sessionId:next.sessionId,decision:'computer_cancel'});expect(owner.state.notice).toBeUndefined()
 }finally{await prepared.dispose()}
})

it('retains native review through picking/selection refresh, forwards only selected values, and clears after final submit',async()=>{
 const {prepared,owner,notice}=await fixture()
 try{
  const review={id:notice.id,revision:randomUUID(),sessionId:notice.sessionId,kind:'auto_mode_flagged_allow',phase:'review',title:'Review rules that skip checks',paragraphs:['Original warnings'],rules:[],selectedValues:[],choices:[{value:'auto_rules_all',label:'Remove them all'},{value:'auto_rules_pick',label:'Pick which to remove'},{value:'auto_rules_leave',label:'Leave them'}]}
  f.request.mockResolvedValueOnce({notice:review,handoffPending:false,retirements:[]});await owner.refreshNotice()
  const pick={...review,revision:randomUUID(),phase:'pick',rules:[{value:'Bash(*)',label:'Original Bash(*)'}],choices:[{value:'auto_rules_submit',label:'Remove selected'}]}
  f.request.mockResolvedValueOnce({answered:true}).mockResolvedValueOnce({notice:pick,handoffPending:false,retirements:[]});await owner.answerNotice({id:review.id,revision:review.revision,sessionId:review.sessionId,decision:'auto_rules_pick'});expect(owner.state.notice).toEqual(pick)
  const next={...pick,revision:randomUUID(),selectedValues:['Bash(*)']}
  f.request.mockResolvedValueOnce({answered:true}).mockResolvedValueOnce({notice:next,handoffPending:false,retirements:[]});await owner.answerNotice({id:pick.id,revision:pick.revision,sessionId:pick.sessionId,decision:'auto_rules_select',selectedValues:['Bash(*)']});expect(owner.state.notice).toEqual(next)
  expect(f.request.mock.calls.filter(([request])=>request.subtype==='apack_answer_native_notice').at(-1)![0]).toMatchObject({id:pick.id,revision:pick.revision,session_id:pick.sessionId,decision:'auto_rules_select',selected_values:['Bash(*)']})
  f.request.mockResolvedValueOnce({answered:true});await owner.answerNotice({id:next.id,revision:next.revision,sessionId:next.sessionId,decision:'auto_rules_submit'});expect(owner.state.notice).toBeUndefined()
 }finally{await prepared.dispose()}
})

it('keeps credit transitions mounted and retires only an explicitly settled native dialog',async()=>{
 const {prepared,owner,notice}=await fixture()
 try{
  const credit={id:notice.id,revision:notice.revision,sessionId:notice.sessionId,kind:'fable_overage_consent_prompt' as const,title:'Usage credits',paragraphs:[],snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'information' as const,revision:'a'.repeat(64),title:'Usage credits',description:'Looking up balance…'}}}
  f.request.mockResolvedValueOnce({notice:credit,handoffPending:false,retirements:[]});await owner.refreshNotice()
  const response={id:credit.id,revision:credit.revision,sessionId:credit.sessionId,decision:'credit' as const,credit:{requestId:randomUUID(),operation:{kind:'read' as const}}}
  const updated={...credit,snapshot:{...credit.snapshot,refreshPending:true,dismissible:false,editor:{...credit.snapshot.editor,description:'Processing payment…'}}}
  f.request.mockResolvedValueOnce({answered:true,notice:updated});await owner.answerNotice(response)
  expect(owner.state.notice).toEqual(updated)
  expect(f.request).toHaveBeenLastCalledWith({subtype:'apack_answer_native_notice',id:response.id,revision:response.revision,session_id:response.sessionId,decision:'credit',credit:response.credit})
  f.request.mockResolvedValueOnce({answered:true});await expect(owner.answerNotice(response)).rejects.toThrow('credit state was not acknowledged');expect(owner.state.notice).toEqual(updated)
  f.request.mockResolvedValueOnce({answered:true,notice:{...updated,sessionId:randomUUID()}});await expect(owner.answerNotice(response)).rejects.toThrow('changed owner');expect(owner.state.notice).toEqual(updated)
  f.request.mockResolvedValueOnce({answered:true,notice:null});await owner.answerNotice(response);expect(owner.state.notice).toBeUndefined()
 }finally{await prepared.dispose()}
})
