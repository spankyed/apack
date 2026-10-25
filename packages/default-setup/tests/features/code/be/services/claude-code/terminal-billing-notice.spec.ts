import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture() {
  const sessionId = randomUUID(), payload = { title: 'Original notice', paragraphs: ['Original gateway explanation'], helpUrl: 'https://code.claude.com/docs/en/auto-mode-classifier-billing' }
  const item = { id: randomUUID(), kind: 'auto_mode_server_fallback', payload }, open = [item], answer = vi.fn()
  const store = { getState: () => ({ open }), answer }, binding = { surface: 'terminal', toolContext: () => ({ dialogStore: store }) }
  const n = { runtime: { ey: () => binding }, questionOptions: { q: () => sessionId } }
  const helper = claudeTerminalUiRuntime.slice(claudeTerminalUiRuntime.indexOf('function nativeBillingNotice('), claudeTerminalUiRuntime.indexOf('function nativeDialog('))
  const handlers = claudeTerminalUiRuntime.slice(claudeTerminalUiRuntime.indexOf(" if(request.subtype==='apack_native_notice')"), claudeTerminalUiRuntime.indexOf(" if(request.subtype==='apack_workflow_dialogs')"))
  const run = vm.runInNewContext(helper + ';(async request=>{' + handlers + '})', { nativeLspRecommendation: () => ({}), answerNativeLspRecommendation: () => { throw Error('Wrong notice kind') }, AbortController, n, originalContext: binding, configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), abort: { signal: new AbortController().signal } })
  return { run, open, item, payload, answer, sessionId }
}
it('preserves the original notice and exact continue/interrupt results without a tool permission envelope', async () => {
  for (const decision of ['continue', 'interrupt']) {
    const f = fixture(), { notice } = await f.run({ subtype: 'apack_native_notice' })
    expect(notice).toMatchObject({ id: f.item.id, sessionId: f.sessionId, ...f.payload })
    await f.run({ subtype: 'apack_answer_native_notice', id: notice.id, revision: notice.revision, session_id: notice.sessionId, decision })
    expect(f.answer).toHaveBeenCalledExactlyOnceWith(f.item.id, decision)
  }
})
it('refuses stale payload, closed dialog, invalid result and foreign session', async () => {
  const f = fixture(), { notice } = await f.run({ subtype: 'apack_native_notice' })
  const request = { subtype: 'apack_answer_native_notice', id: notice.id, revision: notice.revision, session_id: notice.sessionId, decision: 'continue' }
  await expect(f.run({ ...request, decision: 'allow' })).rejects.toThrow('Invalid')
  await expect(f.run({ ...request, session_id: randomUUID() })).rejects.toThrow('expired')
  f.item.payload = { ...f.payload }
  await expect(f.run(request)).rejects.toThrow('expired')
  f.open.splice(0)
  await expect(f.run(request)).rejects.toThrow('expired')
  expect(f.answer).not.toHaveBeenCalled()
})
