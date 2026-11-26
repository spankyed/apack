import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import vm from 'node:vm'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'
import { claudeNativeLinuxBindings } from '#features/code/be/services/claude-code/native-platform-bindings.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalUltraplanChoiceRuntime } from '#features/code/be/services/claude-code/terminal-ultraplan-choice-runtime.ts'

interface Fiber { child?: Fiber; type: object }

function fixture(platform = 'darwin') {
  const nativeFunctionHash = (hash: string) => platform === 'linux' ? claudeNativeLinuxBindings.functionHashes[hash] : hash
  const sessionId = randomUUID()
  const facts = { sessionId, view: { kind: 'main' }, sequence: 1 }
  const plan = Array.from({ length: 35 }, (_, index) => `Review step ${index + 1}`).join('\n')
  const item = { id: randomUUID(), kind: 'ultraplan_choice', payload: { plan: `\x1b[1m${plan}\x1b[0m` } }
  const open = [item]
  const nativeAnswer = vi.fn()
  const onChange = vi.fn((_value: string) => true)
  const wrapperType = () => {}, viewType = () => {}, panelType = () => {}, selectType = () => {}
  const hashes = new Map([
    [wrapperType, 'be11caa5c9ae3c88fbf925f7c7b8276c09202dce03b8afc07c1974958f581bb5'],
    [viewType, '317101b04ec4ea38de8707e4b36efdd3142fe7092dd19691ce016ea2dafca8e6'],
    [selectType, 'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'],
  ] as const)
  const mountedHashes = new Map([...hashes].map(([type, hash]) => [type, nativeFunctionHash(hash)]))
  const select = { props: { onChange, options: [
    { value: 'here', label: 'Implement here', description: 'Inject plan into the current conversation' },
    { value: 'fresh', label: 'Start new session', description: 'Clear conversation and start with only the plan' },
    { value: 'cancel', label: 'Cancel', description: 'Save the plan and return' },
  ] } }
  const panel = { type: panelType, props: { title: 'Ultraplan approved', subtitle: 'How should the plan be implemented?', children: { props: { children: [{}, select] } } } }
  const row = Array<unknown>(40).fill(undefined)
  row[34] = select
  row[39] = panel
  const selection = { type: selectType, memoizedProps: select.props }
  const mountedPanel = { type: panelType, memoizedProps: panel.props, child: selection }
  const view = { type: viewType, memoizedProps: { plan: item.payload.plan, onDone: nativeAnswer }, updateQueue: { memoCache: { data: [row] } }, child: mountedPanel }
  const root = { type: wrapperType, memoizedProps: { payload: item.payload, answer: nativeAnswer }, child: view }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalUltraplanChoiceRuntime) + ';({read:nativeUltraplanChoice,answer:answerNativeUltraplanChoice})', {
    originalContext: { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) },
    AbortController, process: { stdout: undefined }, randomUUID, dialogRevisions: new Map(), configUrl: 'private', stripVTControlCharacters,
    nativeViewFacts: () => facts, readFileSync: () => JSON.stringify({ sessionId }), nativeFunctionHash,
    nativeModelFunctionHash: (type: () => void) => mountedHashes.get(type),
    nativeModelFibers: (root: Fiber | undefined) => {
      const fibers: Fiber[] = []
      for (let fiber = root; fiber; fiber = fiber.child) fibers.push(fiber)
      return fibers
    },
  })
  const request = (decision: string) => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision })
  return { runtime, request, n, plan, item, facts, onChange, nativeAnswer, mountedPanel }
}

it.each([
  ['darwin', 'ultraplan_here', 'here'],
  ['linux', 'ultraplan_fresh', 'fresh'],
  ['linux', 'ultraplan_cancel', 'cancel'],
])('on %s reviews the full plan and sends %s through the original guarded choice once', (platform, decision, result) => {
  const f = fixture(platform)
  expect(ClaudeNativeNoticeSchema.parse(f.runtime.read(f.n).notice)).toMatchObject({ kind: 'ultraplan_choice', plan: f.plan })
  const request = f.request(decision)
  f.runtime.answer(f.n, request)
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith(result)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.runtime.read(f.n)).toBeUndefined()
  expect(f.nativeAnswer).not.toHaveBeenCalled()
})

it('retains the offer when Claude refuses and never bypasses its retry wrapper', () => {
  const f = fixture()
  const request = f.request('ultraplan_here')
  f.onChange.mockReturnValueOnce(false)
  expect(() => f.runtime.answer(f.n, request)).toThrow('Claude refused')
  expect(f.runtime.read(f.n).revision).toBe(request.revision)
  expect(f.nativeAnswer).not.toHaveBeenCalled()
})

it('withdraws an unmounted choice and rejects a foreign session or an old native view revision', () => {
  const f = fixture()
  const request = f.request('ultraplan_here')
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  f.facts.sequence++
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  Reflect.deleteProperty(f.mountedPanel, 'child')
  expect(f.runtime.read(f.n)).toBeUndefined()
  expect(f.onChange).not.toHaveBeenCalled()
})
