import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalResumeReturnRuntime } from '#features/code/be/services/claude-code/terminal-resume-return-runtime.ts'

function fixture() {
  const sessionId = randomUUID(), item = { id: randomUUID(), kind: 'resume_return', payload: { sessionAgeMinutes: 90, estimatedTokens: 120000, hasPrecomputedSummary: true } }, open = [item]
  const BCo = () => {}, vwe = () => {}, Xe = () => {}
  const hashes = new Map([
    ['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5', createHash('sha256').update(Xe.toString()).digest('hex')],
    ['eb1d5c3dc90bb98e32ee2cae9da94b6f918fe5e6d93a653cf7e108db9565e62d', createHash('sha256').update(BCo.toString()).digest('hex')],
    ['8c9ad04491cf97fdfc934537c57e592350bdaa27b1253b1390cdd226acabddd8', createHash('sha256').update(vwe.toString()).digest('hex')],
  ])
  const answer = vi.fn((_choice: string) => { open.splice(0) })
  const control = { options: [{ value: 'compact', label: 'Resume from summary (instant, recommended)' }, { value: 'continue', label: 'Resume full session as-is' }, { value: 'never', label: "Don't ask me again" }], onChange: answer }
  const panel = { title: 'This session is 90 minutes old and 120k tokens.', onCancel: () => answer('dismiss') }
  const row = Array(22).fill(undefined); row[6] = 'We recommend resuming from a summary.'; row[17] = { props: control }; row[21] = { props: panel }
  const view = { type: vwe, memoizedProps: { ...item.payload, onDone: answer }, updateQueue: { memoCache: { data: [row] } } }
  Object.assign(view, { child: { memoizedProps: panel, child: { type: Xe, memoizedProps: control } } })
  const root = { type: BCo, memoizedProps: { payload: item.payload, answer }, child: view }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  let format = async (_n: unknown, text: string) => text
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalResumeReturnRuntime) + ';({read:nativeResumeReturn,project:projectNativeResumeReturn,answer:answerNativeResumeReturn})', { originalContext: binding, AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), nativeGenericPermissionText: (...args: Parameters<typeof format>) => format(...args) })
  const request = () => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision: 'resume_compact' })
  return { runtime, n, item, open, root, view, row, panel, control, answer, request, setFormat: (next: typeof format) => { format = next } }
}
it.each(['compact', 'continue', 'never', 'dismiss'])('settles original %s once without implementing its native effect', async choice => {
  const f = fixture(), shown = await f.runtime.project(f.n, f.runtime.read(f.n))
  expect(shown.title).toBe(f.panel.title); expect(shown.paragraphs).toEqual([f.row[6]])
  expect(shown.choices).toEqual(f.control.options.map(option => ({ value: 'resume_' + option.value, label: option.label })))
  const request = { ...f.request(), decision: 'resume_' + choice }; f.runtime.answer(f.n, request)
  expect(f.answer).toHaveBeenCalledExactlyOnceWith(choice)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('rejects foreign sessions, stale facts and invalid choices before any native callback', () => {
  const f = fixture(), request = f.request()
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'compact_accept' })).toThrow('Invalid')
  f.item.payload.estimatedTokens++
  expect(() => f.runtime.answer(f.n, request)).toThrow('facts changed')
  expect(f.answer).not.toHaveBeenCalled()
})
it('withdraws when the original dialog has a competitor or its view is unmounted', () => {
  const f = fixture(); f.open.push({ ...f.item, id: randomUUID() })
  expect(f.runtime.read(f.n).item).toBeUndefined(); f.open.pop()
  f.view.memoizedProps.onDone = vi.fn()
  expect(f.runtime.read(f.n).item).toBeUndefined(); expect(f.answer).not.toHaveBeenCalled()
})
it('rejects a replaced control and refuses changed native choices', () => {
  const f = fixture(), request = f.request(); f.row[17] = { props: { ...f.control } }
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  f.control.options[0]!.value = 'unknown'
  expect(() => f.runtime.read(f.n)).toThrow('choices changed')
})
it('rechecks native ownership after asynchronous source-text formatting', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.setFormat(async (_n, text) => { f.open.splice(0); return text })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})
it('does not acknowledge a native callback that refused to settle', () => {
  const f = fixture(); f.control.onChange = vi.fn()
  expect(() => f.runtime.answer(f.n, f.request())).toThrow('did not accept')
  expect(f.control.onChange).toHaveBeenCalledExactlyOnceWith('compact')
})

it('does not expose a mounted-looking view without its original wrapper answer', () => {
  const f = fixture(); Reflect.deleteProperty(f.root.memoizedProps, 'answer'); Reflect.deleteProperty(f.view.memoizedProps, 'onDone')
  expect(f.runtime.read(f.n).item).toBeUndefined(); expect(f.answer).not.toHaveBeenCalled()
})

it('refuses retained memo state after the original choice control unmounts', () => {
  const f = fixture(), request = f.request(); Reflect.deleteProperty(f.view, 'child')
  expect(f.runtime.read(f.n).item).toBeUndefined()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired'); expect(f.answer).not.toHaveBeenCalled()
})
