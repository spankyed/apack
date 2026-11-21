import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalGoalProposalRuntime } from '#features/code/be/services/claude-code/terminal-goal-proposal-runtime.ts'

function fixture() {
  const sessionId = randomUUID(), item = { id: randomUUID(), kind: 'goal_proposal', payload: { condition: 'Finish the current review' } }, open = [item]
  const NCe = () => {}, lr = () => {}
  const hashes = new Map([
    ['80f8248717365a251bf9b02027e39b4a73b036dec3ab6393ff9e42bc6fe6da75', createHash('sha256').update(NCe.toString()).digest('hex')],
    ['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70', createHash('sha256').update(lr.toString()).digest('hex')],
  ])
  const onConfirm = vi.fn(() => { open.splice(0) }), onCancel = vi.fn(() => { open.splice(0) })
  const panel = { confirmLabel: 'Set this goal', cancelLabel: 'Not now', refuseInput: vi.fn(() => false), onConfirm, onCancel }
  const row = Array(46).fill(undefined)
  row[10] = 'Claude proposes a goal'; row[12] = item.payload.condition
  row[25] = 'Claude continues with the current work while you decide.'; row[27] = 'Approving replaces the current goal: previous goal'
  row[35] = { props: panel }
  const root = { type: NCe, memoizedProps: { payload: item.payload, wouldTakeAnswer: () => true }, updateQueue: { memoCache: { data: [row] } }, child: { type: lr, memoizedProps: panel } }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  let format = async (_n: unknown, node: string | undefined) => node ?? ''
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalGoalProposalRuntime) + ';({read:nativeGoalProposal,project:projectNativeGoalProposal,answer:answerNativeGoalProposal})', { originalContext: binding, AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), nativeGenericPermissionText: (...args: Parameters<typeof format>) => format(...args) })
  const request = () => { const d = runtime.read(n); return { id: item.id, revision: d.revision, session_id: sessionId, decision: 'goal_accept' } }
  return { runtime, n, root, item, open, row, panel, request, onConfirm, onCancel, setFormat: (next: typeof format) => { format = next } }
}
it.each(['goal_accept', 'goal_decline'])('uses original %s callback exactly once', async decision => {
  const f = fixture(), d = f.runtime.read(f.n), shown = await f.runtime.project(f.n, d)
  expect(shown.paragraphs).toEqual([f.item.payload.condition, f.row[25], f.row[27]])
  expect(shown.choices.map((choice: { value: string }) => choice.value)).toEqual(['goal_decline', 'goal_accept'])
  const request = { ...f.request(), decision }; f.runtime.answer(f.n, request)
  expect(decision === 'goal_accept' ? f.onConfirm : f.onCancel).toHaveBeenCalledTimes(1)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('keeps original refusal grace and does not retry an effect', () => {
  const f = fixture(), request = f.request(); f.panel.refuseInput.mockReturnValue(true)
  expect(() => f.runtime.answer(f.n, request)).toThrow('temporarily refused')
  expect(f.onConfirm).not.toHaveBeenCalled(); expect(f.open).toContain(f.item)
})
it('refuses foreign sessions, replaced payloads and invalid decisions', () => {
  const f = fixture(), request = f.request()
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'yes' })).toThrow('Invalid')
  f.item.payload.condition = 'Changed condition'
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.onConfirm).not.toHaveBeenCalled()
})
it('withdraws when original live admission refuses the answer', () => {
  const f = fixture(); f.root.memoizedProps.wouldTakeAnswer = () => false
  expect(f.runtime.read(f.n).item).toBeUndefined()
})
it('refuses ambiguous or unmounted original controls', () => {
  const f = fixture(); f.root.child.memoizedProps = { ...f.panel }
  expect(f.runtime.read(f.n).item).toBeUndefined()
})
it('rechecks ownership after all asynchronous formatting including title', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.setFormat(async (_n, text) => { if (text === f.row[10]) f.open.splice(0); return text ?? '' })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})
it('does not convert native stale-goal refusal into successful acknowledgement', () => {
  const f = fixture(); f.panel.onConfirm = vi.fn()
  expect(() => f.runtime.answer(f.n, f.request())).toThrow('did not accept')
  expect(f.panel.onConfirm).toHaveBeenCalledTimes(1)
})
