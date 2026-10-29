import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'
const f = vi.hoisted(() => { vi.resetModules(); return { spawn: vi.fn(), request: vi.fn(), ready: true, nativePid: undefined as number | undefined, projection: { sessionId: '11111111-1111-4111-8111-111111111111', tasks: [] } } })
vi.mock('node-pty', () => ({ spawn: f.spawn }))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts', () => ({ createClaudeTerminalBridge: async () => ({ pluginRoot: '/private/fixture-plugin', bunOptions: 'fixture-preload', close: async () => {}, get ready() { return f.ready }, get nativePid() { return f.nativePid }, projection: f.projection, transcripts: [], session: { metadata: { permissionMode: 'default' }, update() {} }, uiTransport: { request: f.request } }) }))
beforeEach(() => { vi.clearAllMocks(); f.request.mockReset(); f.ready = true; f.nativePid = undefined })
async function fixture() {
  let exit!: (event: { exitCode: number }) => void
  f.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exit) { exit = callback }, kill() { exit({ exitCode: 0 }) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: f.projection.sessionId, cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: { effective: {}, sources: [] } }), owner = await prepared.start()
  const notice = { id: 'original', revision: randomUUID(), sessionId: f.projection.sessionId, kind: 'autocompact_offer' as const, title: 'Autocompact sooner?', paragraphs: ['Original explanation'], selectedTokens: 400000, canPrevious: true, canNext: true, choices: [{ value: 'compact_keep' as const, label: 'Keep auto' }, { value: 'compact_accept' as const, label: 'Autocompact at 400k' }] }
  f.request.mockResolvedValueOnce({ notice, retirements: [] }); await owner.refreshNotice()
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
    resolve({ notice: next, retirements: [] }); await action
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
    f.request.mockResolvedValueOnce({ notice: policy, retirements: [] })
    await owner.refreshNotice()
    expect(owner.state.notice).toEqual(policy)
    expect(f.request).toHaveBeenCalledExactlyOnceWith({ subtype: 'apack_native_notice' })
  } finally { await prepared.dispose() }
})
