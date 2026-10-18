import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture() {
  let sessionId = '11111111-1111-4111-8111-111111111111'
  const item = { id: 'dialog-1', kind: 'permission_file', payload: { requestId: 'read-1', toolName: 'Read', operationType: 'read', input: { file_path: '/original' } } }
  const state = { open: [item] }
  const answer = vi.fn(() => { state.open = [] })
  const store = { getState: () => state, answer }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: store }) }
  const start = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const end = claudeTerminalUiRuntime.indexOf('const server=http.createServer')
  const control = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};control`, {
    originalContext: binding, initialize: async () => ({}), AbortController, randomUUID,
    readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'fixture',
  }) as (request: Record<string, unknown>, abort: AbortController) => Promise<any>
  const snapshot = async () => (await control({ subtype: 'apack_read_dialogs' }, new AbortController())).dialogs[0]
  const reply = (dialog: any, overrides = {}) => control({ subtype: 'apack_answer_read_dialog', id: dialog.id, revision: dialog.revision, session_id: dialog.sessionId, decision: 'allow', ...overrides }, new AbortController())
  return { state, item, answer, snapshot, reply, replaceSession() { sessionId = randomUUID() } }
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
