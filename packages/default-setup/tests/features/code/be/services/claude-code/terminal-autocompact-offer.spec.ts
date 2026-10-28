import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalAutocompactOfferRuntime } from '#features/code/be/services/claude-code/terminal-autocompact-offer-runtime.ts'

function fixture() {
  const sessionId = randomUUID(), item = { id: randomUUID(), kind: 'autocompact_offer', payload: { sizes: [{ tokens: 300000, firesAt: 280000 }, { tokens: 400000, firesAt: 380000 }, { tokens: 500000, firesAt: 480000 }] } }, open = [item]
  const dbe = () => {}, Xe = () => {}, hashes = new Map([
    ['2c54d2af4782ef795f859c90e6d55bba81fcc01b5f38c412b10a8b4e08f78b68', createHash('sha256').update(dbe.toString()).digest('hex')],
    ['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5', createHash('sha256').update(Xe.toString()).digest('hex')],
  ])
  const onChange = vi.fn(() => { open.splice(0) }), onCancel = vi.fn(() => { open.splice(0) })
  const control = { isDisabled: false, options: [{ value: 'keep', label: 'Keep auto (1m tokens)' }, { value: 'accept', label: 'Autocompact at 400k tokens' }], onChange, onCancel }
  const row = Array(101).fill(undefined); row[10] = 1; row[46] = 400000; row[52] = ['Original usage and summary tradeoff', 'Original proposed window explanation']; row[61] = 'This conversation will be summarized on your next message.'
  row[88] = { props: control }; row[96] = { props: { title: 'Autocompact sooner?' } }
  row[43] = vi.fn((_text: string, keys: { rightArrow?: boolean; leftArrow?: boolean }) => {
    if (keys.rightArrow || keys.leftArrow) { row[10] += keys.rightArrow ? 1 : -1; row[46] = item.payload.sizes[row[10]]!.tokens; return true }
    return false
  })
  const root = { type: dbe, memoizedProps: { payload: item.payload }, updateQueue: { memoCache: { data: [row] } }, child: { type: Xe, memoizedProps: control } }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  const binding = { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) }
  let format = async (_n: unknown, text: string | undefined) => text ?? ''
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalAutocompactOfferRuntime) + ';({read:nativeAutocompactOffer,project:projectNativeAutocompactOffer,answer:answerNativeAutocompactOffer})', { originalContext: binding, AbortController, setTimeout, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(), nativeGenericPermissionText: (...args: Parameters<typeof format>) => format(...args) })
  const request = (decision = 'compact_accept') => { const d = runtime.read(n); return { id: item.id, revision: d.revision, session_id: sessionId, decision } }
  const abort = new AbortController()
  return { runtime, n, row, root, control, onChange, onCancel, open, item, request, abort, setFormat: (next: typeof format) => { format = next } }
}
it.each(['compact_accept', 'compact_keep', 'compact_dismiss'])('uses original %s control once', async decision => {
  const f = fixture(), request = f.request(decision); await f.runtime.answer(f.n, request, f.abort)
  if (decision === 'compact_dismiss') expect(f.onCancel).toHaveBeenCalledTimes(1)
  else expect(f.onChange).toHaveBeenCalledExactlyOnceWith(decision === 'compact_accept' ? 'accept' : 'keep')
  await expect(f.runtime.answer(f.n, request, f.abort)).rejects.toThrow('expired')
})
it('retains native choice ordering, explanations and next-turn warning', async () => {
  const f = fixture(), shown = await f.runtime.project(f.n, f.runtime.read(f.n))
  expect(shown.choices.map((choice: { value: string }) => choice.value)).toEqual(['compact_keep', 'compact_accept'])
  expect(shown.paragraphs).toEqual([...f.row[52], f.row[61]])
  expect(shown).toMatchObject({ selectedTokens: 400000, canPrevious: true, canNext: true })
})
it.each(['compact_previous', 'compact_next'])('uses the original %s key filter and retires the old revision', async decision => {
  const f = fixture(), request = f.request(decision); await f.runtime.answer(f.n, request, f.abort)
  expect(f.row[43]).toHaveBeenCalledTimes(1); expect(f.row[46]).toBe(decision === 'compact_next' ? 500000 : 300000)
  expect(f.onChange).not.toHaveBeenCalled(); expect(f.open).toContain(f.item)
  await expect(f.runtime.answer(f.n, request, f.abort)).rejects.toThrow('expired')
})
it('preserves native input grace and does not invoke an answer after refusal', async () => {
  const f = fixture(); f.row[43].mockReturnValue(true)
  await expect(f.runtime.answer(f.n, f.request(), f.abort)).rejects.toThrow('temporarily refused')
  expect(f.onChange).not.toHaveBeenCalled(); expect(f.open).toContain(f.item)
})
it('withdraws disabled native controls and refuses screen-reader stepper substitution', async () => {
  const f = fixture(); f.control.isDisabled = true; expect(f.runtime.read(f.n).item).toBeUndefined()
  f.control.isDisabled = false; f.row[36] = true
  const shown = await f.runtime.project(f.n, f.runtime.read(f.n)); expect(shown.canNext).toBe(false)
  await expect(f.runtime.answer(f.n, f.request('compact_next'), f.abort)).rejects.toThrow('unavailable')
})
it('refuses a foreign session and out-of-range size without an effect', async () => {
  const f = fixture(); const request = f.request()
  await expect(f.runtime.answer(f.n, { ...request, session_id: randomUUID() }, f.abort)).rejects.toThrow('expired')
  f.row[10] = 2; f.row[46] = 500000
  await expect(f.runtime.answer(f.n, f.request('compact_next'), f.abort)).rejects.toThrow('unavailable')
  expect(f.row[43]).not.toHaveBeenCalled(); expect(f.onChange).not.toHaveBeenCalled()
})
it('refuses replaced mounted controls during asynchronous title formatting', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.setFormat(async (_n, text) => { if (text === 'Autocompact sooner?') f.root.child.memoizedProps = { ...f.control }; return text ?? '' })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})
it('waits only for acknowledgement and never retries a refused size effect', async () => {
  const f = fixture(); f.row[43].mockReturnValue(true)
  await expect(f.runtime.answer(f.n, f.request('compact_next'), f.abort)).rejects.toThrow('not acknowledged')
  expect(f.row[43]).toHaveBeenCalledTimes(1); expect(f.onChange).not.toHaveBeenCalled()
})

it('serializes native effects while awaiting a size acknowledgement', async () => {
  const f = fixture(), request = f.request('compact_next'); f.row[43].mockReturnValue(true)
  const first = f.runtime.answer(f.n, request, f.abort)
  const rejected = expect(first).rejects.toThrow()
  await expect(f.runtime.answer(f.n, request, f.abort)).rejects.toThrow('operation is pending')
  expect(f.row[43]).toHaveBeenCalledTimes(1)
  f.abort.abort(); await rejected
})
