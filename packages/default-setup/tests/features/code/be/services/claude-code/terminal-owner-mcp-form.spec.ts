import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prepareClaudeNativeTerminal } from '#features/code/be/services/claude-code/terminal-owner.ts'
const f = vi.hoisted(() => { vi.resetModules(); return { spawn: vi.fn(), request: vi.fn(), projection: { sessionId: '11111111-1111-1111-1111-111111111111', tasks: [] } } })
vi.mock('node-pty', () => ({ spawn: f.spawn }))
vi.mock('#features/code/be/services/claude-code/terminal-bridge.ts', () => ({ createClaudeTerminalBridge: async () => ({ pluginRoot: '/private/fixture-plugin', bunOptions: 'fixture-preload', close: async () => {}, ready: true, projection: f.projection, session: { metadata: { permissionMode: 'default' }, update() {} }, uiTransport: { request: f.request } }) }))
beforeEach(() => { vi.clearAllMocks(); f.request.mockReset() })
async function fixture() {
  let exit!: (event: { exitCode: number }) => void
  f.spawn.mockImplementation(() => ({ pid: 0, onData() {}, onExit(callback: typeof exit) { exit = callback }, kill() { exit({ exitCode: 0 }) } }))
  const prepared = await prepareClaudeNativeTerminal({ sessionId: f.projection.sessionId, cwd: tmpdir(), cliPath: process.execPath, permissionMode: 'default', settings: { effective: {}, sources: [] } }), owner = await prepared.start()
  const form = { id: 'original', revision: randomUUID(), sessionId: f.projection.sessionId, token: 'a'.repeat(64), ready: true, serverName: 'Research', message: 'Review', schema: { type: 'object', properties: {} }, propertyOrder: [], values: { enabled: false, count: 0 }, errors: {}, resolvingFields: [], focusedButton: 'accept', textInputValue: '' }
  f.request.mockResolvedValueOnce({ form }); await owner.refreshMcpForm()
  const request = { id: form.id, revision: form.revision, sessionId: form.sessionId, token: form.token, action: { operation: 'cancel' as const } }
  return { prepared, owner, form, request }
}
it('ignores an older refresh completed after a newer original field operation', async () => {
  const { prepared, owner, form, request } = await fixture()
  try {
    let resolve!: (value: unknown) => void; f.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const old = owner.refreshMcpForm(), next = { ...form, token: 'b'.repeat(64) }
    f.request.mockResolvedValueOnce({ settled: false, form: next }); await owner.operateMcpForm(request)
    resolve({ form }); await old; expect(owner.state.mcpForm?.token).toBe(next.token)
  } finally { await prepared.dispose() }
})
it('requires matching explicit native acknowledgement and refuses concurrent or stale requests', async () => {
  const { prepared, owner, request } = await fixture()
  try {
    await expect(owner.operateMcpForm({ ...request, token: '0'.repeat(64) })).rejects.toThrow('changed')
    let resolve!: (value: unknown) => void; f.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const action = owner.operateMcpForm(request)
    await expect(owner.operateMcpForm(request)).rejects.toThrow('busy'); resolve({}); await expect(action).rejects.toThrow('not acknowledged')
  } finally { await prepared.dispose() }
})
it('withdraws an old form when refreshing its original renderer fails', async () => {
  const { prepared, owner } = await fixture()
  try { f.request.mockRejectedValueOnce(Error('Original renderer changed')); await expect(owner.refreshMcpForm()).rejects.toThrow('changed'); expect(owner.state.mcpForm).toBeUndefined() }
  finally { await prepared.dispose() }
})
it('does not restore form state from an operation completed after owner exit', async () => {
  const { prepared, owner, form, request } = await fixture()
  let resolve!: (value: unknown) => void; f.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const action = owner.operateMcpForm(request); await prepared.dispose(); resolve({ settled: false, form })
  await expect(action).rejects.toThrow('exited'); expect(owner.state.mcpForm).toBeUndefined()
})
