import vm from 'node:vm'
import { claudeTerminalFocusRuntime } from '#features/code/be/services/claude-code/terminal-focus-runtime.ts'
function fixture(base: any[], selected: any[]) {
  const stdout = {}, cache: any[] = []; cache[56] = base; cache[83] = selected
  const fiber: any = { type: function Xx() {}, memoizedProps: { conversationId: 'opaque-renderer-identity', screen: 'main' }, updateQueue: { memoCache: { data: [cache] } } }
  const n = { themeRoots: { ai: () => new Map([[stdout, { container: { current: fiber } }]]) } }
  const read = vm.runInNewContext(claudeTerminalFocusRuntime + ';nativeFocusProjection', { process: { stdout }, composerFunctionHashes: new WeakMap(), createHash: () => ({ update() { return this }, digest: () => 'c9216d60891ddbee9f6c3b4b737f771eda26ce91860b0a6d92aecb21e4490477' }) })
  return { n, fiber, read: (kind = 'main') => read(n, { view: { kind } }) }
}
it('uses full selection rather than viewport absence and retains native folded group members', () => {
  const tool = { uuid: 'tool', type: 'assistant' }, result = { uuid: 'result', type: 'user' }, final = { uuid: 'final', type: 'assistant' }
  const f = fixture([{ uuid: 'hidden', type: 'assistant' }, tool, result, final], [{ uuid: 'brief-tool', type: 'collapsed_read_search', messages: [tool, result] }, final])
  expect(f.read()).toEqual({ producerId: 'opaque-renderer-identity', active: true, hidden: ['hidden'] })
  expect(f.read('agent')).toBeUndefined()
})
it('restores inactive selection and refuses unknown folded identities or ambiguous producers', () => {
  const base = [{ uuid: 'kept', type: 'assistant' }], inactive = fixture(base, base)
  expect(inactive.read().active).toBe(false)
  expect(fixture(base, [{ uuid: 'unknown', type: 'unrecognized_fold' }]).read()).toBeUndefined()
  inactive.fiber.child = { ...inactive.fiber } as any
  expect(inactive.read()).toBeUndefined()
})
it('leaves focus unavailable for malformed native rows without disrupting other owner observations', () => {
  expect(fixture([{ type: 'changed-native-shape' }], []).read()).toBeUndefined()
})
