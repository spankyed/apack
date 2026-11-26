import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import vm from 'node:vm'
import { ClaudeNativeNoticeSchema, isClaudeNativeNoticeDecision } from '#features/code/common/native-notice.ts'
import { claudeNativeLinuxBindings } from '#features/code/be/services/claude-code/native-platform-bindings.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalUltraplanLaunchRuntime } from '#features/code/be/services/claude-code/terminal-ultraplan-launch-runtime.ts'

const termsUrl = 'https://code.claude.com/docs/en/claude-code-on-the-web'
const types = { wrapper: () => {}, view: () => {}, body: () => {}, select: () => {}, panel: () => {}, text: () => {} }
interface Fiber {
  type: object
  memoizedProps?: object
  memoizedState?: object | null
  tag?: number
  updateQueue?: { memoCache: { data: unknown[][] } }
  child?: Fiber
  sibling?: Fiber
  return?: Fiber
}
const element = <P extends object>(props: P, type = types.text) => ({ props, type })
const text = (children: string) => element({ children })
function mount(parent: Fiber, ...children: Fiber[]) {
  parent.child = children[0]
  children.forEach((child, index) => { child.return = parent; child.sibling = children[index + 1] })
}

function fixture({ platform = 'darwin', terms = true, relay = true, bridge = false } = {}) {
  const sessionId = randomUUID(), pending = { sessionId, view: { kind: 'main' }, sequence: 1 }
  const payload = { promptIdentifier: 'simple_plan', prompt: 'A raw prompt', showTerms: terms, deliveredByRelay: relay }
  const item = { kind: 'ultraplan_launch', id: randomUUID(), payload }
  const open = [item]
  const wouldTakeAnswer = vi.fn(() => true)
  const answer = vi.fn((_value: string) => { open.length = 0 })
  const onCancel = vi.fn(() => answer('cancel'))
  const onChange = vi.fn((value: string) => answer(value))
  const refuseInput = vi.fn(() => !wouldTakeAnswer())
  const select = element({ onChange, refuseInput, selectedValue: 'cancelled', options: [
    { value: 'run', label: terms ? 'Yes' : 'Run ultraplan', description: bridge ? 'Disable remote control and launch in a cloud session' : 'launch in a cloud session' },
    { value: 'cancel', label: terms ? 'No' : 'Not now' },
  ] }, types.select)
  const prompt = element({ children: [text(relay ? 'Prompt (sent from a connected channel): ' : 'Prompt: '), 'Review the SDK'] })
  const more = element({ url: termsUrl })
  const details = terms
    ? element({ children: [text('Original disclosure'), element({ children: [text('This will upload your repository to a cloud session.'), element({ children: ['More information: ', more] })] }), text('Proceed?')] })
    : element({ children: [element({ children: [text('Original disclosure'), bridge && text('This will disable Remote Control for this session.')] }), !bridge && text('Original pipeline')] })
  const bodyRow = Array<unknown>(41).fill(undefined)
  bodyRow[12] = prompt; bodyRow[18] = details; bodyRow[36] = select
  bodyRow[40] = element({ children: [prompt, details, select] })
  const fallback = text('Loading…')
  const primary = element({ onChoice: onChange }, types.body)
  const panel = element({ title: 'Run ultraplan in the cloud?', subtitle: 'a few minutes', onCancel, children: element({ fallback, children: primary }) }, types.panel)
  const panelRow = Array<unknown>(27).fill(undefined)
  panelRow[13] = fallback; panelRow[26] = panel
  const wrapper: Fiber = { type: types.wrapper, memoizedProps: { payload, answer, wouldTakeAnswer } }
  const view: Fiber = { type: types.view, memoizedProps: { ...payload, onDone: answer, wouldTakeAnswer }, updateQueue: { memoCache: { data: [panelRow] } } }
  const mountedPanel: Fiber = { type: types.panel, memoizedProps: panel.props }
  const body: Fiber = { type: types.body, memoizedProps: primary.props, updateQueue: { memoCache: { data: [bodyRow] } } }
  const control: Fiber = { type: types.select, memoizedProps: select.props }
  const fallbackHost: Fiber = { type: types.text, memoizedProps: fallback.props }
  const offscreen: Fiber = { type: {}, tag: 22, memoizedState: {} }
  mount(wrapper, view); mount(view, mountedPanel); mount(mountedPanel, offscreen, fallbackHost)
  mount(offscreen, body); mount(body, control)
  const ready = () => { offscreen.memoizedState = null; mount(mountedPanel, offscreen) }
  function nativeFunctionHash(hash: string) {
    if (platform === 'darwin') return hash
    const linux = claudeNativeLinuxBindings.functionHashes[hash]
    if (!linux) throw new Error(`No reviewed Linux selector for ${hash}`)
    return linux
  }
  const hashes = new Map<object, string>([
    [types.wrapper, '707334db26f3d0bd9bb606bdfec78c2b2ae808b2c2d2d9e500038a3b2805c150'],
    [types.view, '5303115411ecfe721d34d59c4253fa2f2ab65c00187a94bfc7ee70b7287ed51f'],
    [types.body, '85cfc66614f6b36ec4854e0f20bbaaa6364483b6df5635046b7d62ba90283941'],
    [types.select, 'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'],
  ])
  function nativeModelFibers(root?: Fiber): Fiber[] {
    if (!root) return []
    const fibers = [root]
    for (let child = root.child; child; child = child.sibling) fibers.push(...nativeModelFibers(child))
    return fibers
  }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: wrapper } }]]) } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalUltraplanLaunchRuntime) + ';({read:nativeUltraplanLaunch,answer:answerNativeUltraplanLaunch})', {
    originalContext: { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) },
    AbortController, process: { stdout: undefined }, randomUUID, dialogRevisions: new Map(), configUrl: 'private', stripVTControlCharacters,
    nativeViewFacts: () => pending, readFileSync: () => JSON.stringify({ sessionId }), nativeFunctionHash, nativeModelFibers,
    nativeModelFunctionHash: (type: object) => { const hash = hashes.get(type); return hash && nativeFunctionHash(hash) },
  })
  const read = () => ClaudeNativeNoticeSchema.parse(runtime.read(n).notice)
  const request = (decision: string) => ({ id: item.id, revision: read().revision, session_id: sessionId, decision })
  return { read, request, runtime, n, item, ready, answer, onCancel, onChange, refuseInput, wouldTakeAnswer, pending, more, body }
}

it('exposes loading Cancel but withholds Run even when React retains the hidden review', () => {
  const f = fixture()
  const loading = f.read()
  expect(loading).toMatchObject({ phase: 'loading', paragraphs: ['Loading…'], choices: [{ value: 'ultraplan_launch_cancel' }] })
  expect(isClaudeNativeNoticeDecision(loading, 'ultraplan_launch_run')).toBe(false)
  expect(ClaudeNativeNoticeSchema.safeParse({ ...loading, choices: [{ value: 'ultraplan_launch_run', label: 'Run' }] }).success).toBe(false)
  expect(() => f.runtime.answer(f.n, f.request('ultraplan_launch_run'))).toThrow('Invalid')
  f.runtime.answer(f.n, f.request('ultraplan_launch_cancel'))
  expect(f.onCancel).toHaveBeenCalledOnce()
  expect(f.answer).toHaveBeenCalledExactlyOnceWith('cancel')
  expect(f.onChange).not.toHaveBeenCalled()
})

it('requires the current mounted terms and guards Run before forwarding the native choice', () => {
  const f = fixture({ platform: 'linux' })
  const loading = f.request('ultraplan_launch_cancel')
  f.ready()
  expect(f.read()).toMatchObject({
    phase: 'terms', promptLabel: 'Prompt (sent from a connected channel): ', summary: 'Review the SDK',
    helpLabel: 'More information:', helpUrl: termsUrl,
    paragraphs: ['Original disclosure', 'This will upload your repository to a cloud session.', 'Proceed?'],
  })
  expect(() => f.runtime.answer(f.n, loading)).toThrow('expired')
  const run = f.request('ultraplan_launch_run')
  f.wouldTakeAnswer.mockReturnValueOnce(false)
  expect(() => f.runtime.answer(f.n, run)).toThrow('not accepting')
  expect(f.onChange).not.toHaveBeenCalled()
  f.runtime.answer(f.n, run)
  expect(f.refuseInput).toHaveBeenCalledTimes(2)
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('run')
  expect(f.answer).toHaveBeenCalledExactlyOnceWith('run')
  expect(() => f.runtime.answer(f.n, run)).toThrow('expired')
})

it('shows the bridge consequence and routes ready Cancel through the original guarded select', () => {
  const f = fixture({ terms: false, bridge: true, relay: false })
  f.ready()
  expect(f.read()).toMatchObject({
    phase: 'review', promptLabel: 'Prompt: ',
    paragraphs: ['Original disclosure', 'This will disable Remote Control for this session.'],
  })
  f.runtime.answer(f.n, f.request('ultraplan_launch_cancel'))
  expect(f.refuseInput).toHaveBeenCalledOnce()
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('cancel')
  expect(f.onCancel).not.toHaveBeenCalled()
})

it('uses the native panel’s Escape action and rejects foreign sessions and retired controls', () => {
  const f = fixture()
  f.ready()
  const escape = f.request('ultraplan_launch_escape')
  expect(() => f.runtime.answer(f.n, { ...escape, session_id: randomUUID() })).toThrow('expired')
  f.pending.sequence++
  expect(() => f.runtime.answer(f.n, escape)).toThrow('expired')
  f.runtime.answer(f.n, f.request('ultraplan_launch_escape'))
  expect(f.onCancel).toHaveBeenCalledOnce()
  expect(f.onChange).not.toHaveBeenCalled()
})

it('withdraws an unmounted select and refuses an unreviewed terms link', () => {
  const f = fixture()
  f.ready()
  const run = f.request('ultraplan_launch_run')
  f.more.props.url = 'https://example.test/terms'
  expect(f.runtime.read(f.n)).toBeUndefined()
  f.more.props.url = termsUrl
  Reflect.deleteProperty(f.body, 'child')
  expect(() => f.runtime.answer(f.n, run)).toThrow('expired')
  expect(f.onChange).not.toHaveBeenCalled()
})
