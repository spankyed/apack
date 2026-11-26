import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalCostWarningRuntime } from '#features/code/be/services/claude-code/terminal-cost-warning-runtime.ts'

interface FixtureFiber { child?: FixtureFiber }

function fixture() {
  const sessionId = randomUUID()
  let currentSession = sessionId
  const item = { id: 'cost-warning', kind: 'cost_threshold', payload: {} }
  const open = [item]
  const acknowledgement = vi.fn(() => { open.length = 0 })
  const wrapper = () => {}
  const view = () => {}
  const panelType = () => {}
  const select = () => {}
  const hashes = new Map([
    [wrapper, '03e82ecbd848c2e58a725afc1f530a979f12b404b92fdf5222c9a28009a2e513'],
    [view, 'c74ab3745fbced047db05aa4b19ce1f4bb6126c65ef86e99fa83d03ec2a93e77'],
    [select, 'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'],
  ])
  const body = { props: { children: [{ props: { children: 'Original spending disclosure' } }, { props: { url: 'https://code.claude.com/docs/en/costs' } }] } }
  const choice = { props: { options: [{ value: 'ok', label: 'Got it' }], onChange: acknowledgement } }
  const panel = { type: panelType, props: { title: 'Original cost warning', onCancel: acknowledgement, children: [body, choice] } }
  const selection = { type: select, memoizedProps: choice.props }
  const mountedPanel = { type: panelType, memoizedProps: panel.props, child: selection }
  const mountedView = { type: view, memoizedProps: { onDone: acknowledgement }, updateQueue: { memoCache: { data: [[body, [], acknowledgement, choice, acknowledgement, choice, panel]] } }, child: mountedPanel }
  const root = { type: wrapper, memoizedProps: { answer: acknowledgement, payload: item.payload }, child: mountedView }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => currentSession } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalCostWarningRuntime) + ';({read:nativeCostWarning,answer:answerNativeCostWarning})', {
    originalContext: { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) },
    AbortController, process: { stdout: undefined }, randomUUID, dialogRevisions: new Map(), configUrl: 'private',
    readFileSync: () => JSON.stringify({ sessionId }), nativeFunctionHash: (hash: string) => hash,
    nativeModelFunctionHash: (fn: () => void) => hashes.get(fn),
    nativeModelFibers: (root: FixtureFiber | undefined) => {
      const fibers: FixtureFiber[] = []
      for (let fiber = root; fiber; fiber = fiber.child) fibers.push(fiber)
      return fibers
    },
  })
  const request = () => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision: 'cost_acknowledge' })
  return { runtime, request, n, choice, item, open, acknowledgement, mountedPanel, hashes, view, replaceSession: () => { currentSession = randomUUID() } }
}

it('borrows the original disclosure and one native acknowledgement', () => {
  const f = fixture()
  const warning = ClaudeNativeNoticeSchema.parse(f.runtime.read(f.n).notice)
  expect(warning).toMatchObject({ kind: 'cost_threshold', title: 'Original cost warning', paragraphs: ['Original spending disclosure'], choices: [{ value: 'cost_acknowledge', label: 'Got it' }] })
  const request = f.request()
  f.runtime.answer(f.n, request)
  expect(f.acknowledgement).toHaveBeenCalledExactlyOnceWith('ok')
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})

it('refuses unmounted or changed native controls', () => {
  const f = fixture()
  const request = f.request()
  Reflect.deleteProperty(f.mountedPanel, 'child')
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.acknowledgement).not.toHaveBeenCalled()
  f.hashes.delete(f.view)
  expect(f.runtime.read(f.n)).toBeUndefined()
})

it('refuses a foreign session and a non-native decision without acknowledgement', () => {
  const f = fixture()
  const request = f.request()
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'cancelled' })).toThrow('Invalid')
  f.replaceSession()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.acknowledgement).not.toHaveBeenCalled()
})
