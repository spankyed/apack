import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalInlineModelRuntime } from '#features/code/be/services/claude-code/terminal-inline-model-runtime.ts'

// Handwritten native-view doubles exercise our adapter only; recovered code never executes here.
function fixture() {
  const sessionId = randomUUID(), screen = vi.fn(), handler = vi.fn()
  function Ene() {}
  const props = { onScreen: screen, segments: [{ text: 'New model available · ' }, { text: 'ctrl+y', color: 'permission' }] }
  const notice = { key: 'newer-model-offer', kind: 'upsell', jsx: { type: Ene, props } }
  const state = { notifications: { current: notice as any, queue: [] as any[] } }
  const root = { child: { type: Ene, memoizedProps: props } as any }
  const edits = new Map<string, any>([['main-window', { box: { text: '' } }]])
  const hashes = new WeakMap<Function, string>([[Ene, 'ceceaddc79eb68b0964b0faa4f0a5a7c57bee5f88691610b3d52823a1f083eb5'], [screen, 'e9be39361cf51bba8fef8fb13ea8c3d407b8040785d1f72a7b1a0dd3b8512076']])
  const binding = { surface: 'terminal', toolContext: () => ({ getAppState: () => state }) }
  const n = { runtime: { ey: () => binding }, questionOptions: { q: () => sessionId }, themeRoots: { ai: () => new Map([[process.stdout, { container: { current: root } }]]) }, jsx: { e: (type: any, props: any) => ({ type, props }) }, terminalComponents: { n: 'Text' } }
  const view = { kind: 'main' }, viewRead = vi.fn(() => ({ view })), clients = new Set(['main-window'])
  const format = vi.fn(async (_n: any, node: any) => node.props.children.map((child: any) => child.props.children).join(''))
  const factory = new Function('readFileSync', 'configUrl', 'originalContext', 'nativeViewFacts', 'nativeFunctionName', 'composerFunctionHashes', 'createHash', 'randomUUID', 'process', 'nativeGenericPermissionText', 'stripVTControlCharacters', 'clients', 'clientViewCurrent', 'edits', `${claudeTerminalInlineModelRuntime};return {read:nativeInlineModelOffer,project:projectNativeInlineModelOffer,actions:nativeInlineModelActions}`)
  const bridge = factory(() => JSON.stringify({ sessionId }), '', undefined, viewRead, (name: string) => name, hashes, createHash, randomUUID, process, format, (text: string) => text, clients, () => view.kind === 'main', edits)
  const provider = { props: { handlerRegistryRef: { current: new Map([['chat:defaultToNewerModel', new Set([{ action: 'chat:defaultToNewerModel', context: 'Chat', handler }])]]) } } }
  return { bridge, n, state, notice, root, props, hashes, screen, handler, edits, view, clients, provider, format, viewRead }
}

it('projects exact original segments without invoking the mounted onScreen effect or action', async () => {
  const f = fixture(), source = f.bridge.read(f.n)
  expect(await f.bridge.project(f.n, source)).toMatchObject({ kind: 'newer_model_inline', sessionId: source.sessionId, ansi: 'New model available · ctrl+y' })
  expect(f.format.mock.calls[0]?.[1].props.children[1].props).toMatchObject({ color: 'permission' })
  expect(f.screen).not.toHaveBeenCalled(); expect(f.handler).not.toHaveBeenCalled()
})

it('advertises the original action only for its owned empty app draft and registered Chat handler', () => {
  const f = fixture()
  expect(f.bridge.actions(f.n, 'main-window', f.provider)).toMatchObject([{ action: 'chat:defaultToNewerModel', blocked: false }])
  f.edits.get('main-window').box.text = 'keep my draft'
  expect(f.bridge.actions(f.n, 'main-window', f.provider)).toMatchObject([{ blocked: true }])
  expect(f.bridge.actions(f.n, 'foreign-window', f.provider)).toEqual([])
  f.edits.delete('main-window')
  expect(f.bridge.actions(f.n, 'main-window', f.provider)).toMatchObject([{ blocked: true }])
  f.provider.props.handlerRegistryRef.current.clear()
  expect(f.bridge.actions(f.n, 'main-window', f.provider)).toEqual([])
  expect(f.handler).not.toHaveBeenCalled()
})

it('does not expose queued, unmounted or foreign-view offers and retires their revision', () => {
  const f = fixture(), before = f.bridge.read(f.n)
  f.state.notifications.queue.push(f.notice); f.state.notifications.current = { key: 'higher-priority' }
  expect(f.bridge.read(f.n)).toBeUndefined()
  f.state.notifications.current = f.notice; f.root.child = undefined
  expect(f.bridge.read(f.n)).toBeUndefined()
  f.root.child = { type: f.notice.jsx.type, memoizedProps: f.props }
  expect(f.bridge.read(f.n).revision).not.toBe(before.revision)
  f.view.kind = 'agent'; expect(f.bridge.read(f.n)).toBeUndefined()
})

it('refuses a changed producer or onScreen callback instead of borrowing a new effect', () => {
  const f = fixture(); f.hashes.set(f.screen, 'changed')
  expect(() => f.bridge.read(f.n)).toThrow('producer changed')
  expect(f.screen).not.toHaveBeenCalled()
})

it('rejects replacement during asynchronous text formatting', async () => {
  const f = fixture(), source = f.bridge.read(f.n)
  f.format.mockImplementationOnce(async () => { f.state.notifications.current = { key: 'expired' }; return 'old wording' })
  await expect(f.bridge.project(f.n, source)).rejects.toThrow('changed while formatting')
})

it('does not traverse native view state when this optional notification is absent', () => {
  const f = fixture(); f.state.notifications.current = undefined
  expect(f.bridge.read(f.n)).toBeUndefined(); expect(f.viewRead).not.toHaveBeenCalled()
})
