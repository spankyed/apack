import { createHash } from 'node:crypto'
import { claudeTerminalActionKeyRuntime } from '#features/code/be/services/claude-code/terminal-action-key-runtime.ts'

// Execute only our generated adapter. Original native code remains a disposable-CI boundary.
const createBridge = new Function('createHash', `${claudeTerminalActionKeyRuntime}; return createNativeActionKeyBridge`)(createHash)
function fixture(extraOptions: Record<string, unknown> = {}) {
  const registry = new Map<string, Set<any>>(), held = new Map<number, any>()
  const terminal = vi.fn(), hiddenEdit = vi.fn(), press = vi.fn(async () => ({ handled: true })), changed = vi.fn()
  let selectedView = 'main', eligible = true, activeRevision = 1
  const dialog = { blocked: false }
  const stroke = { key: 'u', ctrl: true, alt: true, meta: false, shift: false, super: false }
  const props = { bindings: [{ action: 'review', context: 'Global', chord: [stroke] }] as { action: string | null; context: string; chord: typeof stroke[] }[], activeContexts: new Set(), pendingChordRef: { current: null as any }, handlerRegistryRef: { current: registry } }
  registry.set('review', new Set([{ action: 'review', context: 'Global', fallback: true, handler: terminal }]))
  const context = {
    bindings: props.bindings,
    setPendingChord: (value: any) => { props.pendingChordRef.current = value },
    registerHandler: (entry: any) => {
      if (!registry.has(entry.action)) registry.set(entry.action, new Set())
      const entries = registry.get(entry.action)!
      entries.add(entry)
      return () => { entries.delete(entry); if (!entries.size) registry.delete(entry.action) }
    },
  }
  const capture = vi.fn((event: any) => {
    for (const entry of registry.get('review') ?? []) if (entry.fallback && entry.handler() !== false) { event.defaultPrevented = true; break }
  })
  const node = { _eventHandlers: { onKeyDownCapture: capture } }
  const provider = { props, context, capture, node, owner: { focusManager: { activeElement: { nodeName: 'native-editable' } }, rootNode: {} } }
  class Key {
    name: string; key: string; ctrl: boolean; meta: boolean; shift: boolean; superKey: boolean; defaultPrevented = false; stopped = false
    constructor(value: any) { this.name = this.key = value.name; this.ctrl = value.ctrl; this.meta = value.meta ? true : value.option; this.shift = value.shift; this.superKey = value.super }
    stopImmediatePropagation() { this.stopped = true }
  }
  const n = {
    runtime: { ey: () => ({ surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => dialog } }) }) },
    nativeKeyDialogs: { gk: vi.fn((state: typeof dialog) => state.blocked ? {} : null) },
    nativeKeyBindings: { o_o: vi.fn((action: string, context: string, bindings: any[]) => bindings.filter((b, i) => b.action === action && b.context === context && !bindings.slice(i + 1).some(later => later.context === context && JSON.stringify(later.chord) === JSON.stringify(b.chord))).map(b => b.chord)), hCs: () => true, fCs: () => false, Xwe: (e: Key) => ({ key: e.key, ctrl: e.ctrl, alt: e.meta, meta: e.meta, shift: e.shift, super: e.superKey }), FUe: (a: any, b: any) => a.key === b.key && a.ctrl === b.ctrl && (a.alt || a.meta) === (b.alt || b.meta) && a.shift === b.shift && a.super === b.super },
    nativeKeyEvents: { zDe: Key, R8: { dispatchDiscrete: vi.fn((_target: any, event: Key) => { node._eventHandlers.onKeyDownCapture(event); if (!event.stopped) hiddenEdit() }) } },
    nativeClients: { action: () => undefined },
    engine: { FPe: () => eligible, r5: { heldPress: (_plugin: string, handle: number) => held.get(handle) } },
  }
  const options = { current: (_n: any, scope: any) => scope.instance_revision === activeRevision, view: () => selectedView, changed, provider: () => provider, ...extraOptions }
  const bridge = createBridge(options)
  const draw = (component: string, id: string, handle: number, client = 'main-window') => {
    held.set(handle, { component, requestId: id })
    bridge.capture(n, { client_id: client, surface: 'desktop', component, instance_id: id, instance_revision: 1 }, { type: 'Button', props: { action: 'review', key: 'review' }, press: { plugin: 'review-plugin', handle } })
  }
  const event = { key: 'u', ctrl: true, alt: true, shift: false, super: false, from_composer: true }
  const key = (revision = bridge.snapshot(n, 'main-window').revision) => bridge.key(n, { client_id: 'main-window', revision, event }, new AbortController(), press)
  return { n, bridge, options, props, provider, context, registry, capture, node, terminal, hiddenEdit, press, changed, draw, key, event, dialog,
    move: () => { selectedView = 'agent' }, revoke: () => { eligible = false }, replace: () => { activeRevision++ } }
}

it('routes an admitted action to the current desktop Pane with native ordering and window ownership', async () => {
  const f = fixture()
  f.draw('AbovePrompt', 'above', 1); f.draw('Pane', 'first-pane', 2); f.draw('Pane', 'later-pane', 3); f.draw('Pane', 'other-window-pane', 4, 'other-window')
  const keys = f.bridge.snapshot(f.n, 'main-window')
  expect(keys.bindings).toHaveLength(1); expect(JSON.stringify(keys)).not.toContain('review-plugin')
  expect(await f.key()).toMatchObject({ handled: true })
  expect(f.press).toHaveBeenCalledWith({ subtype: 'ui_press', surface: 'desktop', client_id: 'main-window', component: 'Pane', instance_id: 'later-pane', instance_revision: 1, plugin: 'review-plugin', handle: 3, key: 'review' })
  expect(f.terminal).not.toHaveBeenCalled(); expect(f.hiddenEdit).not.toHaveBeenCalled()
  expect(f.node._eventHandlers.onKeyDownCapture).toBe(f.capture)
  expect(f.registry.get('review')?.size).toBe(1)
})

it.each(['move', 'revoke', 'replace'] as const)('refuses a callback when native dispatch causes %s before desktop invocation', async change => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  const capture = f.provider.capture
  f.provider.capture = vi.fn(event => { capture(event); f[change]() })
  expect(await f.key()).toMatchObject({ handled: false })
  expect(f.press).not.toHaveBeenCalled(); expect(f.terminal).not.toHaveBeenCalled()
  expect(f.node._eventHandlers.onKeyDownCapture).toBe(f.capture)
})

it('withdraws old bindings and genuine dialog eligibility before dispatching any callback', async () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  const old = f.bridge.snapshot(f.n, 'main-window').revision
  f.props.bindings = [{ ...f.props.bindings[0], chord: [{ ...f.props.bindings[0]!.chord[0]!, key: 'r' }] }]
  expect(await f.key(old)).toMatchObject({ handled: false }); expect(f.capture).not.toHaveBeenCalled()
  f.dialog.blocked = true
  expect(f.bridge.snapshot(f.n, 'main-window').bindings).toEqual([])
  expect(await f.key()).toMatchObject({ handled: false }); expect(f.press).not.toHaveBeenCalled()
})

it('leaves text editing in the desktop composer when the original capture does not consume the key', async () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  f.provider.capture = vi.fn()
  expect(await f.key()).toMatchObject({ handled: false })
  expect(f.hiddenEdit).not.toHaveBeenCalled(); expect(f.press).not.toHaveBeenCalled()
  expect(f.node._eventHandlers.onKeyDownCapture).toBe(f.capture)
})

it('restores the original capture after a dispatch failure without resurrecting removed callbacks', async () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  f.provider.capture = vi.fn(() => { f.registry.get('review')!.clear(); throw Error('Native capture failed') })
  await expect(f.key()).rejects.toThrow('Native capture failed')
  expect(f.node._eventHandlers.onKeyDownCapture).toBe(f.capture)
  expect(f.registry.get('review')?.size ?? 0).toBe(0)
  expect(f.press).not.toHaveBeenCalled()
})

it('keeps unavailable or unknown native producer identities from advertising keyboard support', () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  const unsupported = createBridge({ ...f.options, provider: undefined })
  const fake = { ...f.n, themeRoots: { ai: () => new Map([[process.stdout, { container: { current: { type: function nvt() {}, memoizedProps: {} } } }]]) } }
  unsupported.capture(fake, { client_id: 'main-window', surface: 'desktop', component: 'AbovePrompt', instance_id: 'above', instance_revision: 1 }, { type: 'Button', props: { action: 'review', key: 'review' }, press: { plugin: 'review-plugin', handle: 1 } })
  expect(unsupported.snapshot(fake, 'main-window').bindings).toEqual([])
})


it('advertises only bindings that the original effective-binding helper retains', () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  const old = f.props.bindings[0]!
  f.props.bindings.push({ ...old, action: null })
  expect(f.bridge.snapshot(f.n, 'main-window').bindings).toEqual([])
  expect(f.n.nativeKeyBindings.o_o).toHaveBeenCalledWith('review', 'Global', f.props.bindings)
})

it('withdraws optional shortcut metadata instead of failing an otherwise valid large drawing', () => {
  const f = fixture(); f.draw('AbovePrompt', 'above', 1)
  const tree = { type: 'Box', children: Array.from({ length: 8193 }, () => ({ type: 'Text', children: [] })) }
  expect(() => f.bridge.capture(f.n, { surface: 'desktop', client_id: 'main-window', component: 'AbovePrompt', instance_id: 'above', instance_revision: 1 }, tree)).not.toThrow()
  expect(f.bridge.snapshot(f.n, 'main-window').bindings).toEqual([])
})


it('provides the native option fallback for unmodified key strokes', async () => {
  const f = fixture()
  f.props.bindings = [{ action: 'review', context: 'Global', chord: [{ key: 'u', ctrl: false, alt: false, meta: false, shift: false, super: false }] }]
  f.draw('AbovePrompt', 'above', 1)
  const keys = f.bridge.snapshot(f.n, 'main-window')
  const event = { key: 'u', ctrl: false, alt: false, shift: false, super: false, from_composer: false }
  expect(await f.bridge.key(f.n, { client_id: 'main-window', revision: keys.revision, event }, new AbortController(), f.press)).toMatchObject({ handled: true })
  expect(f.n.nativeKeyEvents.R8.dispatchDiscrete.mock.calls[0]![1].meta).toBe(false)
  expect(f.press).toHaveBeenCalledOnce(); expect(f.terminal).not.toHaveBeenCalled()
})

function inlineFixture() {
  let source: any[] = [{ action: 'chat:defaultToNewerModel', revision: 'offer-one', blocked: false }]
  const f = fixture({ nativeActions: () => source, knownClients: () => ['main-window'] })
  const entry = { action: 'chat:defaultToNewerModel', context: 'Chat', handler: vi.fn(() => true) }
  f.props.bindings = [{ action: entry.action, context: 'Chat', chord: [{ ...f.props.bindings[0]!.chord[0]! }] }]
  f.registry.set(entry.action, new Set([entry]))
  f.provider.capture = vi.fn(event => { if (entry.handler() !== false) event.defaultPrevented = true })
  return { ...f, entry, source: (next: any[]) => { source = next } }
}

it('dispatches an original inline action without a rendered plugin Button or desktop fallback', async () => {
  const f = inlineFixture()
  expect(f.bridge.snapshot(f.n, 'main-window').bindings).toHaveLength(1)
  expect(await f.key()).toMatchObject({ handled: true })
  expect(f.entry.handler).toHaveBeenCalledOnce(); expect(f.press).not.toHaveBeenCalled()
  expect(f.hiddenEdit).not.toHaveBeenCalled(); expect(f.registry.get(f.entry.action)?.size).toBe(1)
})

it('retains original inline grace refusal without retrying or substituting a desktop callback', async () => {
  const f = inlineFixture(); f.entry.handler.mockReturnValue(false)
  expect(await f.key()).toMatchObject({ handled: false })
  expect(f.entry.handler).toHaveBeenCalledOnce(); expect(f.press).not.toHaveBeenCalled()
})

it('uses original remapping and unbinding for the inline action rather than reserving a default key', async () => {
  const f = inlineFixture(), old = f.bridge.snapshot(f.n, 'main-window').revision
  f.props.bindings[0]!.chord[0]!.key = 'm'
  expect(await f.key(old)).toMatchObject({ handled: false })
  expect(await f.key()).toMatchObject({ handled: false }); expect(f.entry.handler).not.toHaveBeenCalled()
  f.event.key = 'm'; expect(await f.key()).toMatchObject({ handled: true })
  f.props.bindings = []; expect(f.bridge.snapshot(f.n, 'main-window').bindings).toEqual([])
})

it('withdraws the inline shortcut on source expiry and publishes without plugin frames', async () => {
  const f = inlineFixture(); f.bridge.poll(f.n)
  expect(f.changed).toHaveBeenLastCalledWith('main-window', expect.objectContaining({ bindings: expect.any(Array) }))
  const old = f.bridge.snapshot(f.n, 'main-window').revision
  f.source([]); f.bridge.poll(f.n)
  expect(f.changed).toHaveBeenLastCalledWith('main-window', expect.objectContaining({ bindings: [] }))
  expect(await f.key(old)).toMatchObject({ handled: false }); expect(f.entry.handler).not.toHaveBeenCalled()
})

it('a blocked native action cannot be re-advertised by a plugin Button sharing that action', async () => {
  const f = fixture({ nativeActions: () => [{ action: 'review', revision: 'draft-present', blocked: true }] })
  f.draw('AbovePrompt', 'above', 1)
  expect(f.bridge.snapshot(f.n, 'main-window').bindings).toEqual([])
  expect(await f.key()).toMatchObject({ handled: false })
  expect(f.capture).not.toHaveBeenCalled(); expect(f.press).not.toHaveBeenCalled()
})

it('retires a partial native chord when its source is replaced, even if the binding stays the same', async () => {
  const f = inlineFixture()
  f.props.bindings[0]!.chord.push({ ...f.props.bindings[0]!.chord[0]!, key: 'z' })
  f.provider.capture = vi.fn(() => f.context.setPendingChord([{ ...f.props.bindings[0]!.chord[0]! }]))
  await f.key(); expect(f.props.pendingChordRef.current).not.toBeNull()
  const old = f.bridge.snapshot(f.n, 'main-window').revision
  f.source([{ action: f.entry.action, revision: 'offer-two', blocked: false }]); f.event.key = 'z'
  expect(await f.key(old)).toMatchObject({ handled: false })
  expect(f.props.pendingChordRef.current).toBeNull(); expect(f.provider.capture).toHaveBeenCalledOnce()
})

it('refuses the original native callback when a prior native event phase replaces its inline source', async () => {
  const f = inlineFixture(), original = f.entry.handler
  f.provider.capture = vi.fn(event => {
    f.source([{ action: f.entry.action, revision: 'replacement-offer', blocked: false }])
    if (f.entry.handler() !== false) event.defaultPrevented = true
  })
  expect(await f.key()).toMatchObject({ handled: false })
  expect(original).not.toHaveBeenCalled(); expect(f.entry.handler).toBe(original)
})
