import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalManagedSecurityRuntime } from '#features/code/be/services/claude-code/terminal-managed-security-runtime.ts'
function fixture() {
  const sessionId = randomUUID(), payload = { settings: { hooks: { private: 'NOT_FOR_APP_PAYLOAD' } }, baseline: null as unknown, reveal: 'default' }
  const item = { id: randomUUID(), kind: 'managed_settings_security', payload }, open = [item]
  const XCo = () => {}, Je = () => {}, lr = () => {}, hashes = new Map([
    ['b6c0babc158b7585de81413d552cb23f2c0cb99b0d32177dc6f0d22bbd851bcf', createHash('sha256').update(XCo.toString()).digest('hex')],
    ['88e14cdf10a3baf23d955bcabd01d36dafc7aa9a6f6c5fd305a3c72643df90c7', createHash('sha256').update(Je.toString()).digest('hex')],
    ['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70', createHash('sha256').update(lr.toString()).digest('hex')],
  ])
  const onConfirm = vi.fn(() => { open.splice(0) }), onCancel = vi.fn(() => { open.splice(0) })
  const panel = { confirmLabel: 'Yes, I trust these settings', cancelLabel: 'No, exit Claude Code', cancelFirst: false, focus: 'confirm', refuseInput: vi.fn(() => false), onConfirm, onCancel }
  const row = Array(98).fill(undefined); row[0] = payload.baseline; row[2] = payload.settings; row[45] = 'Original policy explanation'; row[69] = 'Original bounded security changes'; row[71] = 'Original advice'; row[73] = '\x1b[33mApproving applies: original risk\x1b[0m'; row[85] = { props: panel }; row[97] = { props: { title: 'Managed settings require approval' } }
  const inner = { type: Je, memoizedProps: { ...payload }, updateQueue: { memoCache: { data: [row] } }, child: { type: lr, memoizedProps: panel } }
  const root = { type: XCo, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: inner }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  let format = async (_n: unknown, text: string) => text
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalManagedSecurityRuntime) + ';({read:nativeManagedSecurity,project:projectNativeManagedSecurity,answer:answerNativeManagedSecurity})', { originalContext: binding, AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), stripVTControlCharacters, nativeGenericPermissionText: (...args: Parameters<typeof format>) => format(...args) })
  const request = (decision = 'policy_approve') => { const d = runtime.read(n); return { id: item.id, revision: d.revision, session_id: sessionId, decision } }
  return { runtime, n, item, open, root, inner, row, panel, request, onConfirm, onCancel, setFormat: (next: typeof format) => { format = next } }
}
it.each(['policy_approve', 'policy_reject'])('uses original %s callback exactly once', decision => {
  const f = fixture(), request = f.request(decision); f.runtime.answer(f.n, request)
  expect(decision === 'policy_approve' ? f.onConfirm : f.onCancel).toHaveBeenCalledTimes(1)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('projects only original bounded risk presentation and preserves native ANSI', async () => {
  const f = fixture(), shown = await f.runtime.project(f.n, f.runtime.read(f.n))
  expect(JSON.stringify(shown)).not.toContain('NOT_FOR_APP_PAYLOAD')
  expect(shown.paragraphs).toEqual([f.row[45], f.row[69], f.row[71], 'Approving applies: original risk'])
  expect(shown.paragraphsAnsi[3]).toBe(f.row[73]); expect(shown.preferredChoice).toBe('policy_approve')
})
it('retains original login-handoff cancellation order and input grace', async () => {
  const f = fixture(); f.item.payload.reveal = f.inner.memoizedProps.reveal = 'login_handoff'
  f.panel.cancelFirst = true; f.panel.focus = 'cancel'; f.panel.refuseInput.mockReturnValue(true)
  const shown = await f.runtime.project(f.n, f.runtime.read(f.n))
  expect(shown.choices.map((choice: { value: string }) => choice.value)).toEqual(['policy_reject', 'policy_approve'])
  expect(shown.preferredChoice).toBe('policy_reject')
  expect(() => f.runtime.answer(f.n, f.request())).toThrow('temporarily refused'); expect(f.onConfirm).not.toHaveBeenCalled()
})
it('invalidates old settings/baseline decisions on a streamed replacement', () => {
  const f = fixture(), request = f.request()
  f.item.payload = { settings: { hooks: { private: 'replacement' } }, baseline: {}, reveal: 'default' }
  f.root.memoizedProps.payload = f.item.payload; f.inner.memoizedProps = { ...f.item.payload }; f.row[0] = f.item.payload.baseline; f.row[2] = f.item.payload.settings
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired'); expect(f.onConfirm).not.toHaveBeenCalled()
})
it('does not stale an unchanged policy because native callback wrappers redrew', () => {
  const f = fixture(), request = f.request(), fresh = { ...f.panel, onConfirm: vi.fn(() => { f.open.splice(0) }) }
  f.row[85] = { props: fresh }; f.inner.child.memoizedProps = fresh
  f.runtime.answer(f.n, request); expect(fresh.onConfirm).toHaveBeenCalledOnce(); expect(f.onConfirm).not.toHaveBeenCalled()
})
it('withdraws when original wouldTakeAnswer refuses or the settings view is not mounted', () => {
  const f = fixture(); f.root.memoizedProps.wouldTakeAnswer = () => false; expect(f.runtime.read(f.n).item).toBeUndefined()
  f.root.memoizedProps.wouldTakeAnswer = () => true; f.inner.memoizedProps.settings = { hooks: { private: 'foreign' } }
  expect(f.runtime.read(f.n).item).toBeUndefined()
})
it('refuses foreign sessions, unsupported decisions and an unsettled original callback', () => {
  const f = fixture(), request = f.request()
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'deferred_no_consent_surface' })).toThrow('Invalid')
  f.panel.onConfirm = vi.fn(); expect(() => f.runtime.answer(f.n, request)).toThrow('did not accept')
})
it('refuses mixed presentation when original risk nodes change during formatting', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.setFormat(async (_n, text) => { f.row[73] = 'A different policy risk'; return text })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})
