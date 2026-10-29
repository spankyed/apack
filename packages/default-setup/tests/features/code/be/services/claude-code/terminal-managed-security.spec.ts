import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalManagedSecurityRuntime } from '#features/code/be/services/claude-code/terminal-managed-security-runtime.ts'
function fixture(startup = false) {
  const sessionId = randomUUID(), payload = { settings: { hooks: { private: 'NOT_FOR_APP_PAYLOAD' } }, baseline: null as unknown, reveal: 'default' }
  const item = { id: randomUUID(), kind: 'managed_settings_security', payload }, open = [item]
  const XCo = () => {}, Je = () => {}, lr = () => {}, $n = () => {}, hashes = new Map([
    ['b6c0babc158b7585de81413d552cb23f2c0cb99b0d32177dc6f0d22bbd851bcf', createHash('sha256').update(XCo.toString()).digest('hex')],
    ['88e14cdf10a3baf23d955bcabd01d36dafc7aa9a6f6c5fd305a3c72643df90c7', createHash('sha256').update(Je.toString()).digest('hex')],
    ['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70', createHash('sha256').update(lr.toString()).digest('hex')],
  ])
  hashes.set('3df530c59832e0a9a0e98969b590cffd72fc98bed31c64a264673e75936a69ae', createHash('sha256').update($n.toString()).digest('hex'))
  const onConfirm = vi.fn(() => { open.splice(0) }), onCancel = vi.fn(() => { open.splice(0) })
  const panel = { confirmLabel: 'Yes, I trust these settings', cancelLabel: 'No, exit Claude Code', cancelFirst: false, focus: 'confirm', refuseInput: vi.fn(() => false), onConfirm, onCancel }
  const texts = ['Original policy explanation', 'Original bounded security changes', 'Original advice', 'Approving applies: original risk']
  const nodes = texts.map(text => ({ type: 'ink-text', props: { children: text } }))
  const row = Array(98).fill(undefined); row[0] = payload.baseline; row[2] = payload.settings; row[45] = nodes[0]; row[69] = nodes[1]; row[71] = nodes[2]; row[73] = nodes[3]; row[85] = { props: panel }; row[97] = { props: { title: 'Managed settings require approval' } }
  const width = Math.max(...texts.map(text => text.length)), screen = { width, height: 4 }
  let onRead = () => {}
  const Jre = (_screen: unknown, index: number) => { onRead(); const line = Math.floor(index / width); return { char: texts[line]?.[index % width] ?? ' ', width: 0, styleId: line === 3 ? 1 : 0 } }
  const stylePool = { get(id: number) { return id === 1 ? [{ code: '\x1b[33m', endCode: '\x1b[0m' }] : [] } }
  hashes.set('2ae48b174e08569312fe73be8e3a53dc3ab8aada8bbac0ad2728830bad3fea86', createHash('sha256').update(Jre.toString()).digest('hex'))
  hashes.set('56012d2b3e0dcaefc69e774334770496357f8eac063327fc734c1b927741fea9', createHash('sha256').update(stylePool.get.toString()).digest('hex'))
  const hostFibers = nodes.map((node, index) => ({ type: node.type, memoizedProps: node.props, stateNode: { yogaNode: { getComputedLeft: () => 0, getComputedTop: () => index, getComputedWidth: () => width, getComputedHeight: () => 1 } }, sibling: undefined as unknown }))
  for (let index = 0; index < hostFibers.length - 1; index++) hostFibers[index]!.sibling = hostFibers[index + 1]

  const inner = { type: Je, memoizedProps: { ...payload }, updateQueue: { memoCache: { data: [row] } }, child: { type: lr, memoizedProps: panel, sibling: hostFibers[0] } }
  const requester = { type: XCo, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: inner }
  const lifetime = Array(11).fill(undefined); lifetime[0] = () => Date.now(); lifetime[6] = payload.baseline; lifetime[7] = payload.settings
  const startupRoot = { type: $n, memoizedProps: { settings: payload.settings, baseline: payload.baseline, onAccept: onConfirm, onReject: onCancel }, updateQueue: { memoCache: { data: [lifetime] } }, child: inner }
  const root = startup ? startupRoot : requester
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  const inkRoot = { container: { current: root }, frontFrame: { screen }, stylePool }
  const n = { nativeKeyEvents: { Jre }, runtime: { ey: () => startup ? undefined : binding }, themeRoots: { ai: () => new Map([[undefined, inkRoot]]) }, questionOptions: { q: () => sessionId } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalManagedSecurityRuntime) + ';({read:nativeManagedSecurity,project:projectNativeManagedSecurity,answer:answerNativeManagedSecurity})', { originalContext: startup ? undefined : binding, setTimeout, AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), stripVTControlCharacters })
  const request = (decision = 'policy_approve') => { const d = runtime.read(n); return { id: item.id, revision: d.revision, session_id: sessionId, decision } }
  return { runtime, n, item, open, root: requester, startupRoot, lifetime, inner, row, panel, request, onConfirm, onCancel, screen, texts, inkRoot, setOnRead: (next: () => void) => { onRead = next } }
}
it.each(['policy_approve', 'policy_reject'])('uses original %s callback exactly once', decision => {
  const f = fixture(), request = f.request(decision); f.runtime.answer(f.n, request)
  expect(decision === 'policy_approve' ? f.onConfirm : f.onCancel).toHaveBeenCalledTimes(1)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('projects only original bounded risk presentation and preserves native ANSI', async () => {
  const f = fixture(), shown = await f.runtime.project(f.n, f.runtime.read(f.n))
  expect(JSON.stringify(shown)).not.toContain('NOT_FOR_APP_PAYLOAD')
  expect(shown.paragraphs).toEqual(f.texts)
  expect(shown.paragraphsAnsi[3]).toBe('\x1b[33mApproving applies: original risk\x1b[0m'); expect(shown.preferredChoice).toBe('policy_approve')
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
it('refuses a mixed painted presentation when native risk nodes change during projection', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.setOnRead(() => { f.row[73] = { type: 'ink-text', props: { children: 'A different policy risk' } } })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})

it.each(['policy_approve', 'policy_reject'])('routes startup %s through native callbacks before REPL admission', async decision => {
  const f = fixture(true), d = f.runtime.read(f.n)
  expect(d.startup).toBe(true)
  const shown = await f.runtime.project(f.n, d)
  expect(shown.paragraphsAnsi[3]).toBe('\x1b[33mApproving applies: original risk\x1b[0m')
  const callback = decision === 'policy_approve' ? f.onConfirm : f.onCancel
  callback.mockImplementation(() => { f.startupRoot.child = undefined as never })
  const request = { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision }
  await f.runtime.answer(f.n, request)
  expect(callback).toHaveBeenCalledOnce()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('retains original startup refusal instead of claiming an unacknowledged decision', async () => {
  const f = fixture(true), d = f.runtime.read(f.n)
  const request = { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'policy_approve' }
  const pending = f.runtime.answer(f.n, request)
  expect(() => f.runtime.answer(f.n, request)).toThrow('already pending')
  await expect(pending).rejects.toThrow('did not accept')
  expect(f.onConfirm).toHaveBeenCalledOnce()
})
it('rejects an old startup mount and refuses the native input grace', () => {
  const f = fixture(true), d = f.runtime.read(f.n)
  const request = { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'policy_approve' }
  f.lifetime[0] = () => 1
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  f.panel.refuseInput.mockReturnValue(true)
  const next = f.runtime.read(f.n)
  expect(() => f.runtime.answer(f.n, { ...request, id: next.item.id, revision: next.revision })).toThrow('temporarily refused')
  expect(f.onConfirm).not.toHaveBeenCalled()
})

it('binds startup policy to the requested owner and native temporary pre-resume lifetime', async () => {
  const f = fixture(true), temporary = randomUUID()
  f.n.questionOptions.q = () => temporary
  const d = f.runtime.read(f.n), shown = await f.runtime.project(f.n, d)
  expect(shown.sessionId).not.toBe(temporary)
  expect(shown.sessionId).toBe(d.sessionId)
  f.n.questionOptions.q = () => randomUUID()
  expect(() => f.runtime.answer(f.n, { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'policy_approve' })).toThrow('expired')
  expect(f.onConfirm).not.toHaveBeenCalled()
})

it('does not confuse a replaced startup review with an accepted decision', async () => {
  const f = fixture(true), d = f.runtime.read(f.n)
  f.onConfirm.mockImplementation(() => { f.lifetime[0] = () => 2 })
  await expect(f.runtime.answer(f.n, { id: d.item.id, revision: d.revision, session_id: d.sessionId, decision: 'policy_approve' })).rejects.toThrow('changed while awaiting acknowledgement')
  expect(f.onConfirm).toHaveBeenCalledOnce()
  expect(f.runtime.read(f.n).item).toBeDefined()
})

it('refuses paragraphs extending beyond the original painted frame', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.screen.height = 3
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('outside its painted frame')
  expect(f.onConfirm).not.toHaveBeenCalled()
})

it('retains a native alternate redraw but expires a genuine startup remount with identical settings', () => {
  const f = fixture(true), initial = f.runtime.read(f.n)
  const alternate = { ...f.startupRoot, alternate: f.startupRoot }
  f.inkRoot.container.current = alternate
  expect(f.runtime.read(f.n).revision).toBe(initial.revision)
  const remounted = { ...f.startupRoot }
  f.inkRoot.container.current = remounted
  const next = f.runtime.read(f.n)
  expect(next.revision).not.toBe(initial.revision)
  expect(() => f.runtime.answer(f.n, { id: initial.item.id, revision: initial.revision, session_id: initial.sessionId, decision: 'policy_approve' })).toThrow('expired')
  expect(f.onConfirm).not.toHaveBeenCalled()
})
