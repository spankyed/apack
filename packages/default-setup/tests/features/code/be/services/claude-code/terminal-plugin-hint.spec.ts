import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalPluginHintRuntime } from '#features/code/be/services/claude-code/terminal-plugin-hint-runtime.ts'

function fixture() {
  const sessionId = randomUUID(), payload = { pluginName: 'Review', marketplaceName: 'Owned', sourceCommand: '/usr/bin/printf' }
  const item = { id: randomUUID(), kind: 'plugin_hint', payload }, open = [item]
  const onChange = vi.fn(() => { open.splice(0) }), control = { options: ['yes', 'no', 'disable'].map(value => ({ value, label: value })), isDisabled: false, onChange, onCancel: vi.fn() }
  const QCo = () => {}, dA = () => {}, Xe = () => {}, es = () => {}
  const hashes = new Map([['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5', createHash('sha256').update(Xe.toString()).digest('hex')], ['aabc115cca76c61f3f756409361c604dcf269fddd97ea9a4d36f610669b8deeb', createHash('sha256').update(QCo.toString()).digest('hex')], ['d9c6180f635894ac408460cf32f79529e1cb94fbf2badb35fe134315c286e142', createHash('sha256').update(dA.toString()).digest('hex')]])
  const panel = { type: dA, memoizedProps: { title: 'Plugin recommendation', pluginName: payload.pluginName, marketplaceName: payload.marketplaceName, unansweredResponse: 'no', intro: 'The command suggests installing a plugin.', question: 'Would you like to install it?' }, child: { type: Xe, memoizedProps: control, child: { type: es, memoizedProps: control } } }
  const root = { type: QCo, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: panel }
  const store = { getState: () => ({ open }) }, binding = { surface: 'terminal', toolContext: () => ({ dialogStore: store }) }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalPluginHintRuntime) + ';({read:nativePluginHint,project:projectNativePluginHint,answer:answerNativePluginHint})', { originalContext: binding, AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), nativeGenericPermissionText: async (_n: unknown, text: string) => text })
  return { runtime, n, root, panel, control, open, item, onChange, sessionId }
}
it.each(['yes', 'no', 'disable'])('calls the original %s choice once with a current mounted identity', async decision => {
  const f = fixture(), d = f.runtime.read(f.n), shown = await f.runtime.project(f.n, d)
  expect(shown.choices.map((choice: { value: string }) => choice.value)).toEqual(['yes', 'no', 'disable'])
  const request = { id: shown.id, revision: shown.revision, session_id: shown.sessionId, decision }
  f.runtime.answer(f.n, request)
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith(decision)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('withdraws disabled controls and refuses timeout, foreign session and replaced native descriptors', () => {
  const f = fixture(), d = f.runtime.read(f.n), request = { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'no' }
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'cancelled' })).toThrow('Invalid')
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  f.control.isDisabled = true
  expect(f.runtime.read(f.n).item).toBeUndefined()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  f.control.isDisabled = false; f.open.splice(0, 1, { ...f.item })
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.onChange).not.toHaveBeenCalled()
})
it('refuses an original callback that no longer settles the request', () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.onChange.mockImplementation(() => {})
  expect(() => f.runtime.answer(f.n, { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'no' })).toThrow('did not accept')
})

it('withdraws a source-ready menu when the original host answer gate refuses it', () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.root.memoizedProps.wouldTakeAnswer = () => false
  expect(f.runtime.read(f.n).item).toBeUndefined()
  expect(() => f.runtime.answer(f.n, { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'no' })).toThrow('expired')
  expect(f.onChange).not.toHaveBeenCalled()
})
