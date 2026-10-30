import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalLeftArrowRuntime } from '#features/code/be/services/claude-code/terminal-leftarrow-runtime.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { ClaudeNativeNoticeSchema, isClaudeNativeNoticeDecision } from '#features/code/common/native-notice.ts'

function fixture() {
  const sessionId = randomUUID(), payload = { summary: '', carryOverCount: 1, monitorParkCount: 0, workflowAgents: { running: 1 } }
  const item = { id: randomUUID(), kind: 'left_arrow_confirm', payload }, open = [item]
  const onConfirm = vi.fn(() => { open.splice(0) }), onCancel = vi.fn(() => { open.splice(0) })
  const panel = { confirmLabel: 'Background anyway (1 subagent restarts)', cancelLabel: 'Stay', onConfirm, onCancel }
  const modal = { title: 'Background this session?', subtitle: '1 task carries over. 1 running workflow subagent restarts.', onCancel }
  const row = Array(20); row[15] = { props: panel }; row[19] = { props: modal }
  function KCo() {} function mte() {} function lr() {}
  const hashes = new Map([
    ['e611c57cc8b263026de5a0b2a40644179fda5bc54e5a40b49919b51d8adc08f4', KCo],
    ['eef71f5d1f4e2efcc0c9a0f485d5a530d5943f3e81bab60f2e6575174541c9e7', mte],
    ['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70', lr],
  ].map(([hash, fn]) => [hash, createHash('sha256').update(String(fn)).digest('hex')]))
  const producer = { type: mte, memoizedProps: payload, updateQueue: { memoCache: { data: [row] } }, child: { type: lr, memoizedProps: panel } }
  const root = { type: KCo, memoizedProps: { payload }, child: producer }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  const gate = vi.fn(async () => {}), n = { gate: { _Jo: gate }, questionOptions: { q: () => sessionId }, themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalLeftArrowRuntime) + ';({read:nativeLeftArrowReview,project:projectNativeLeftArrow,answer:answerNativeLeftArrow})', { originalContext: binding, AbortController, process: { stdout: undefined }, createHash, randomUUID, configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), composerFunctionHashes: new WeakMap(), dialogRevisions: new Map(), nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash) })
  const request = () => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision: 'background_confirm' })
  return { runtime, n, item, open, payload, producer, panel, modal, gate, onConfirm, onCancel, request }
}
it.each(['background_confirm', 'background_stay'])('delegates %s once to the original mounted control', async decision => {
  const f = fixture(), notice = ClaudeNativeNoticeSchema.parse(f.runtime.project(f.n, f.runtime.read(f.n)))
  expect(notice.kind).toBe('left_arrow_confirm'); expect(notice.paragraphs).toEqual([f.modal.subtitle])
  expect(isClaudeNativeNoticeDecision(notice, decision)).toBe(true); expect(isClaudeNativeNoticeDecision(notice, 'yes')).toBe(false)
  const request = { ...f.request(), decision }; await f.runtime.answer(f.n, request)
  expect(decision === 'background_confirm' ? f.onConfirm : f.onCancel).toHaveBeenCalledTimes(1)
  expect(f.gate).toHaveBeenCalledTimes(decision === 'background_confirm' ? 1 : 0)
  await expect(f.runtime.answer(f.n, request)).rejects.toThrow('expired')
})
it('refuses changed payload, foreign session and unsupported decisions', async () => {
  const f = fixture(), request = f.request()
  await expect(f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).rejects.toThrow('expired')
  await expect(f.runtime.answer(f.n, { ...request, decision: 'continue' })).rejects.toThrow('Invalid')
  f.payload.carryOverCount++
  await expect(f.runtime.answer(f.n, request)).rejects.toThrow('expired'); expect(f.onConfirm).not.toHaveBeenCalled()
})
it('does not confirm after native policy admission replaces the review', async () => {
  const f = fixture(), request = f.request()
  f.gate.mockImplementation(async () => { f.open.splice(0) })
  await expect(f.runtime.answer(f.n, request)).rejects.toThrow('expired'); expect(f.onConfirm).not.toHaveBeenCalled()
})
it('retains Stay after native policy refuses confirmation', async () => {
  const f = fixture(), request = f.request()
  f.gate.mockRejectedValue(new Error('Original policy refusal'))
  await expect(f.runtime.answer(f.n, request)).rejects.toThrow('Original policy refusal')
  await f.runtime.answer(f.n, { ...request, decision: 'background_stay' }); expect(f.onCancel).toHaveBeenCalledTimes(1)
})
it('withdraws with conflicting dialogs or unmounted controls', () => {
  const f = fixture(); f.open.push({ ...f.item, id: randomUUID() }); expect(f.runtime.read(f.n).item).toBeUndefined()
  f.open.pop(); f.producer.child.memoizedProps = { ...f.panel }; expect(f.runtime.read(f.n).item).toBeUndefined()
})
it('rejects stale mounted callback identities', async () => {
  const f = fixture(), request = f.request()
  f.panel = { ...f.panel }; f.producer.child.memoizedProps = f.panel
  await expect(f.runtime.answer(f.n, request)).rejects.toThrow('expired'); expect(f.onConfirm).not.toHaveBeenCalled()
})
