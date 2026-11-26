import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalRemoteCalloutRuntime } from '#features/code/be/services/claude-code/terminal-remote-callout-runtime.ts'

interface FixtureFiber { child?: FixtureFiber }

function fixture() {
  const sessionId = randomUUID()
  let sequence = 1
  let viewKind = 'main'
  const item = { id: 'first-use', kind: 'remote_callout', payload: {} }
  const open = [item]
  const wrapperType = () => {}
  const viewType = () => {}
  const panelType = () => {}
  const selectType = () => {}
  const hashes = new Map([
    [wrapperType, 'e4c66f2a69905f7004ce8ccb86fbda43f2720d7e134bcec30030f8e41ab6deed'],
    [viewType, 'b6cac59c176992c5dd86a4383b5e822f3433748169b0e5f42df5b672c371a22c'],
    [selectType, 'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'],
  ])
  const answer = vi.fn((_decision: string) => { open.length = 0 })
  const defaultSelect = {
    isDisabled: false,
    options: [
      { value: 'enable', label: 'Enable Remote Control', description: 'Original connection disclosure' },
      { value: 'dismiss', label: 'Never mind', description: 'Original dismissal disclosure' },
    ],
    onChange: vi.fn((decision: string) => answer(decision)),
    onCancel: vi.fn(() => answer('dismiss')),
  }
  const details = { props: { children: [{ props: { children: 'Original remote session disclosure' } }] } }
  const panel = { type: panelType, props: { title: 'Remote Control', children: { props: { children: [details, { props: { children: { props: defaultSelect } } }] } } } }
  const viewElement = { props: { onDone: answer } }
  const wrapperRow = [answer, 'remote-callout-0', undefined, viewElement]
  const viewRow = Array<unknown>(12)
  viewRow[4] = details
  viewRow[11] = panel
  const view = { type: viewType, memoizedProps: viewElement.props, updateQueue: { memoCache: { data: [viewRow] } }, child: { type: panelType, memoizedProps: panel.props, child: { type: selectType, memoizedProps: defaultSelect } } }
  const root = { type: wrapperType, memoizedProps: { payload: item.payload, answer }, updateQueue: { memoCache: { data: [wrapperRow] } }, child: view }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalRemoteCalloutRuntime) + ';({read:nativeRemoteCallout,answer:answerNativeRemoteCallout})', {
    originalContext: { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) },
    nativeViewFacts: () => ({ sessionId, sequence, view: { kind: viewKind } }),
    AbortController, process: { stdout: undefined }, randomUUID, dialogRevisions: new Map(), configUrl: 'private',
    readFileSync: () => JSON.stringify({ sessionId }), nativeFunctionHash: (hash: string) => hash,
    nativeModelFunctionHash: (fn: () => void) => hashes.get(fn),
    nativeModelFibers: (fiber: FixtureFiber | undefined) => {
      const nodes: FixtureFiber[] = []
      for (let node = fiber; node; node = node.child) nodes.push(node)
      return nodes
    },
  })
  const request = (decision = 'remote_enable') => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision })
  return { runtime, n, request, answer, defaultSelect, changeView: () => { sequence++; viewKind = 'agent' } }
}

it.each([['remote_enable', 'enable'], ['remote_dismiss', 'dismiss']])('sends only the original decision for %s', (decision, native) => {
  const f = fixture()
  expect(ClaudeNativeNoticeSchema.parse(f.runtime.read(f.n).notice)).toMatchObject({
    kind: 'remote_callout', paragraphs: ['Original remote session disclosure'], choices: [{ value: 'remote_enable' }, { value: 'remote_dismiss' }],
  })
  const request = f.request(decision)
  f.runtime.answer(f.n, request)
  expect(f.answer).toHaveBeenCalledExactlyOnceWith(native)
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})

it('keeps native disabled and refused input from settling locally', () => {
  const f = fixture()
  const request = f.request()
  f.defaultSelect.isDisabled = true
  expect(f.runtime.read(f.n).notice.disabled).toBe(true)
  expect(() => f.runtime.answer(f.n, request)).toThrow('not accepting')
  expect(f.answer).not.toHaveBeenCalled()
  f.defaultSelect.isDisabled = false
  f.defaultSelect.onChange.mockImplementationOnce(() => {})
  expect(() => f.runtime.answer(f.n, request)).toThrow('refused')
  expect(f.runtime.read(f.n).notice.id).toBe(request.id)
  expect(f.answer).not.toHaveBeenCalled()
})

it('retires the visible decision when the native owner switches to an Agent', () => {
  const f = fixture()
  const request = f.request()
  f.changeView()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.answer).not.toHaveBeenCalled()
})
