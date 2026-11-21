import vm from 'node:vm'
import { claudeTerminalStreamRuntime } from '#features/code/be/services/claude-code/terminal-stream-runtime.ts'
function fixture() {
  let state = {}, current: unknown
  const turn = { turnId: 'turn', cancelled: () => false }
  current = turn
  const store = { getState: () => state, getDerived: () => ({ displayed: 'Original **partial** text\nNext', hideTrailingLine: true }) }
  const controller = { guard: { isRunning: true }, _requireHost: () => ({ session: { id: 'session' } }), stream: { previewStore: store } }
  const producer = { type: () => {}, memoizedProps: { store } }
  const root = { memoizedProps: { turn: controller }, child: producer }
  const render = vi.fn(async () => 'Original partial text')
  const n = { themeRoots: { ai: () => new Map([[process.stdout, { container: { current: root } }]]) }, runtime: { lpe: () => current }, appProvider: { d_: 'app' }, questionOptions: { j: () => 'session' }, jsx: { e: (type: unknown, props: unknown) => ({ type, props }) }, staticRender: { v6e: render } }
  const read = vm.runInNewContext(claudeTerminalStreamRuntime + ';nativeStreamingPreview', { process, nativeThemeProvider: () => ({ type: 'theme', value: 'dark' }) })
  const facts = { sessionId: 'session', view: { kind: 'main' } }
  return { n, read, facts, turn, store, root, producer, controller, render, changeState: () => { state = {} }, replaceTurn: () => { current = {} } }
}
it('mirrors the original mounted formatter and caches unchanged native state', async () => {
  const f = fixture()
  expect(await f.read(f.n, f.facts, f.turn)).toEqual({ turnId: 'turn', output: 'Original partial text' })
  await f.read(f.n, f.facts, f.turn)
  expect(f.render).toHaveBeenCalledTimes(1)
  f.changeState(); await f.read(f.n, f.facts, f.turn)
  expect(f.render).toHaveBeenCalledTimes(2)
})
it.each(['agent', 'cancelled', 'foreign', 'ambiguous', 'missing'] as const)('does not mirror a %s source', async change => {
  const f = fixture()
  if (change === 'agent') f.facts.view.kind = 'agent'
  if (change === 'cancelled') f.turn.cancelled = () => true
  if (change === 'foreign') f.facts.sessionId = 'foreign'
  if (change === 'ambiguous') Object.assign(f.producer, { sibling: { ...f.producer } })
  if (change === 'missing') f.controller.guard.isRunning = false
  expect(await f.read(f.n, f.facts, f.turn)).toBeNull()
  expect(f.render).not.toHaveBeenCalled()
})
it.each(['state', 'turn'] as const)('drops output if the original %s changes while formatting', async change => {
  const f = fixture()
  f.render.mockImplementation(async () => { if (change === 'state') f.changeState(); else f.replaceTurn(); return 'stale' })
  expect(await f.read(f.n, f.facts, f.turn)).toBeNull()
})
