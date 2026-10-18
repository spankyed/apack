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
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: store }) }
  const start = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const end = claudeTerminalUiRuntime.indexOf('const server=http.createServer')
  const control = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};control`, {
    originalContext: binding, initialize: async () => ({ questionOptions: { q: () => nativeSessionId }, paths: { ce: () => '/workspace' } }), AbortController, randomUUID,
    readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'fixture',
  }) as (request: Record<string, unknown>, abort: AbortController) => Promise<any>
  const snapshot = async () => (await control({ subtype: 'apack_file_dialogs' }, new AbortController())).dialogs[0]
  const reply = (dialog: any, overrides = {}) => control({ subtype: 'apack_answer_file_dialog', id: dialog.id, revision: dialog.revision, session_id: dialog.sessionId, decision: 'allow', ...overrides }, new AbortController())
  return { state, item, answer, snapshot, reply, control, replaceNativeSession() { nativeSessionId = randomUUID() }, replaceSession() { sessionId = randomUUID() } }
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
