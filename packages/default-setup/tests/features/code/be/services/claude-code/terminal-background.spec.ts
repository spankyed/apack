import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalBackgroundRuntime } from '#features/code/be/services/claude-code/terminal-background-runtime.ts'
function fixture() {
  const HIe = () => {}, lr = () => {}, tasks = { first: { id: 'first', status: 'running' } }
  let currentTasks = tasks
  const onConfirm = vi.fn(), onCancel = vi.fn(), refuseInput = vi.fn(() => false)
  const panel = { confirmLabel: 'Background with running review', cancelLabel: 'Stay', onConfirm, onCancel, refuseInput }
  const props = { onDone: vi.fn(), seed: {}, messages: [] }, row = Array(81).fill(undefined)
  row[18] = false; row[32] = tasks; row[76] = { props: panel }; row[80] = { props: { title: 'Background this session?', subtitle: 'The active reviewer will restart.', onCancel } }
  const root = { type: HIe, memoizedProps: props, updateQueue: { memoCache: { data: [row] } }, child: { type: lr, memoizedProps: panel } }
  const item = { id: randomUUID(), kind: 'local_jsx', payload: { nodeId: 'node' } }, open = [item]
  const entry = { id: randomUUID(), kind: 'panel', commandName: 'background', clientId: 'client', dialogId: item.id, nodeId: 'node', originalProps: props,
    current: vi.fn(), closed: false, store: { getState: () => ({ open }) }, context: { taskRegistry: { all: () => currentTasks } } }
  const hashes = new Map([['8c1a9dcbdd4a1c9e2db39937f22289db72758d4671938522306b44b77147b403', createHash('sha256').update(HIe.toString()).digest('hex')], ['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70', createHash('sha256').update(lr.toString()).digest('hex')]])
  const gate = vi.fn(async () => {}), n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, gate: { _Jo: gate } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalBackgroundRuntime) + ';nativeBackgroundReview', { agentCommandDialogs: new Map([[entry.id, entry]]), process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, randomUUID, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash) })
  const request = { client_id: 'client', panel_id: entry.id, operation: 'read' }
  return { runtime, n, entry, request, row, panel, onConfirm, onCancel, refuseInput, open, gate,
    replaceTasks(render = true) { currentTasks = { ...currentTasks }; if (render) row[32] = currentTasks } }
}
it.each(['confirm', 'cancel'])('delegates %s to the original mounted callback once', async operation => {
  const f = fixture(), read = await f.runtime(f.n, f.request)
  expect(read.review).toMatchObject({ title: 'Background this session?', paragraphs: ['The active reviewer will restart.'], cancelLabel: 'Stay', defaultFocus: 'confirm' })
  const answer = { ...f.request, operation, revision: read.review.revision }
  await expect(f.runtime(f.n, answer)).resolves.toEqual({ answered: true })
  expect(operation === 'confirm' ? f.onConfirm : f.onCancel).toHaveBeenCalledOnce()
  expect((f.entry as typeof f.entry & { answered?: boolean }).answered).toBe(true)
  await expect(f.runtime(f.n, answer)).rejects.toThrow('expired')
})
it('rejects a replaced task even when the displayed warning text is unchanged', async () => {
  const f = fixture(), first = await f.runtime(f.n, f.request); f.replaceTasks()
  const second = await f.runtime(f.n, f.request); expect(second.review.revision).not.toBe(first.review.revision)
  await expect(f.runtime(f.n, { ...f.request, operation: 'confirm', revision: first.review.revision })).rejects.toThrow('expired')
  expect(f.onConfirm).not.toHaveBeenCalled()
})
it('rejects an unrendered task change before exposing or applying old choices', async () => {
  const f = fixture(), first = await f.runtime(f.n, f.request); f.replaceTasks(false)
  await expect(f.runtime(f.n, { ...f.request, operation: 'confirm', revision: first.review.revision })).rejects.toThrow('tasks changed')
  expect(f.onConfirm).not.toHaveBeenCalled()
})
it('rechecks task authority after asynchronous native policy admission', async () => {
  const f = fixture(), first = await f.runtime(f.n, f.request); f.gate.mockImplementation(async () => { f.replaceTasks() })
  await expect(f.runtime(f.n, { ...f.request, operation: 'confirm', revision: first.review.revision })).rejects.toThrow('expired')
  expect(f.onConfirm).not.toHaveBeenCalled()
})
it('preserves native policy denial and still permits Stay', async () => {
  const f = fixture(), first = await f.runtime(f.n, f.request); f.gate.mockRejectedValue(new Error('Original policy denied'))
  await expect(f.runtime(f.n, { ...f.request, operation: 'confirm', revision: first.review.revision })).rejects.toThrow('policy denied')
  expect(f.onConfirm).not.toHaveBeenCalled()
  await expect(f.runtime(f.n, { ...f.request, operation: 'cancel', revision: first.review.revision })).resolves.toEqual({ answered: true })
  expect(f.onCancel).toHaveBeenCalledOnce()
})
it('retains original input refusal and does not auto-confirm absent controls', async () => {
  const f = fixture(), first = await f.runtime(f.n, f.request); f.refuseInput.mockReturnValue(true)
  await expect(f.runtime(f.n, { ...f.request, operation: 'confirm', revision: first.review.revision })).rejects.toThrow('temporarily refused')
  f.row[18] = true; await expect(f.runtime(f.n, f.request)).resolves.toEqual({ open: true })
  expect(f.onConfirm).not.toHaveBeenCalled()
})
it('rejects foreign clients and replaced dialogs', async () => {
  const f = fixture(); await expect(f.runtime(f.n, { ...f.request, client_id: 'other' })).rejects.toThrow('expired')
  f.open.splice(0); await expect(f.runtime(f.n, f.request)).rejects.toThrow('replaced')
  expect(f.onConfirm).not.toHaveBeenCalled(); expect(f.onCancel).not.toHaveBeenCalled()
})
