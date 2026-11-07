import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalDiagnosticRuntime } from '#features/code/be/services/claude-code/terminal-diagnostic-runtime.ts'
function fixture() {
  const attachment = { type: 'attachment', uuid: 'diagnostic', attachment: { type: 'diagnostics', files: [{ uri: 'file:///owned.review', diagnostics: [{ message: 'Current warning' }] }] } }
  const rows: any[] = [{ type: 'user', uuid: 'human' }, attachment]
  const state: { viewingAgentTaskId?: string } = {}
  let current = true
  const render = vi.fn(async (_n, _facts, _message, options): Promise<string> => options.transcript === false ? 'Original summary' : 'Original detail')
  const binding = { messages: () => rows, tools: () => [], toolContext: () => ({ getAppState: () => state }) }
  const functions = vm.runInNewContext(`${claudeTerminalDiagnosticRuntime};({facts:nativeDiagnosticFacts,list:nativeDiagnosticList})`, { createHash, AbortController, originalContext: binding, clientViewCurrent: () => current, renderNativeToolMessage: render })
  return { functions, rows, attachment, state, render, retire: () => { current = false }, list: () => functions.list({}, 'owned', 60, new AbortController().signal) }
}
it('renders canonical diagnostic identity and original summary/detail independently of tools', async () => {
  const f = fixture(), rows = await f.list()
  expect(rows).toEqual([{ id: 'diagnostic', revision: expect.stringMatching(/^[a-f0-9]{64}$/), anchorIds: ['human'], summary: 'Original summary', detail: 'Original detail' }])
  expect(f.render.mock.calls[0][2]).toBe(f.attachment)
  expect(f.render.mock.calls[0][3]).toMatchObject({ columns: 60, verbose: false, transcript: false })
})
it('rejects a late diagnostic render when attachment contents or view ownership changes', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.attachment.attachment.files[0]!.diagnostics[0]!.message = 'Replacement' }, (f: ReturnType<typeof fixture>) => f.retire()]) {
    const f = fixture(); f.render.mockImplementationOnce(async () => { mutate(f); return 'Old summary' })
    await expect(f.list()).rejects.toThrow(/changed while formatting/)
  }
})
it('withdraws main diagnostics in Agent view and refuses ambiguous identities', async () => {
  const f = fixture(); f.state.viewingAgentTaskId = 'agent'
  expect(await f.list()).toEqual([])
  delete f.state.viewingAgentTaskId; f.rows.push({ ...f.attachment })
  expect(await f.list()).toEqual([])
})
it('refuses excessive native diagnostic payloads before formatting', async () => {
  const f = fixture(); f.attachment.attachment.files[0]!.diagnostics[0]!.message = 'x'.repeat(131072)
  await expect(f.list()).rejects.toThrow(/exceeds desktop limit/)
  expect(f.render).not.toHaveBeenCalled()
})
