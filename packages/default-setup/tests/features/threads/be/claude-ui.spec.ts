import type { ClaudePromptHost } from '#features/code/be/services/claude-code/ui-prompt-host.ts'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { handleClaudeUiView, clearClaudeUiViews, releaseClaudeUiViews } from '#features/threads/be/claude-ui.ts'
import { openConversation, killAllHandles, closeIdleConversation } from '#features/code/be/services/claude-code/handle-store.ts'
import { runThreadTeardown } from '#features/threads/be/thread-teardown.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { OutgoingThreadsEvents } from '#features/threads/be/types.ts'

async function native(threadId = 'thread') {
  const events = new PassThrough({ objectMode: true })
  const ui = { scroll: vi.fn(async () => ({ moved: true, offset: 0 })), panes: vi.fn(async () => ({ panes: [], shown_id: null, focused_id: null, focus_requested_id: null })), showPane: vi.fn(async () => ({ shown_id: null })), focusPane: vi.fn(async () => ({ focused_id: null })), closePane: vi.fn(async () => ({ closed: true })), servePrompt: vi.fn((_id: string, _host: ClaudePromptHost) => () => {}), focus: vi.fn(async () => ({ moved: true, element: null as { plugin: string; key: string } | null })), promptAutocomplete: vi.fn(async () => ({ suggestions: [{ text: 'native', label: 'Native row' }], start: 0 })), promptEdit: vi.fn(async () => ({ text: 'native draft', cursor: 12 })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })), attach: vi.fn(async () => ({ surfaces: ['desktop'] })), detach: vi.fn(async () => ({ detached: true, surfaces: [] })),
    render: vi.fn(async () => ({ tree: { type: 'Button', props: { label: 'Run', key: 'run' }, press: { plugin: 'fixture', handle: 1 } }, props: {}, hooked: true, rewritten: true })),
    press: vi.fn(async () => ({ handled: true })) }
  const handle = { ui, events, kill: () => events.end(), close: async () => { events.end() } } as unknown as QueryHandle
  const owner = await openConversation(threadId, 'fixture', async () => handle, async () => {})
  return { ui, owner, events }
}
const mountId = randomUUID()
const mount = { type: 'CLAUDE_UI_MOUNT', threadId: 'thread', mountId } as const
const reply = () => vi.fn<(event: OutgoingThreadsEvents) => void>()
function action(delivery: ReturnType<typeof reply>): string {
  const event = delivery.mock.calls.at(-1)?.[0]
  if (event?.type !== 'CLAUDE_UI_STATE' || event.state.status !== 'live' || event.state.tree.kind !== 'button') throw new Error('expected live button')
  return event.state.tree.actionId!
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { clearClaudeUiViews(); killAllHandles(); vi.useRealTimers() })

it('scopes state/actions to delivery identity and refuses foreign clients or threads', async () => {
  const { ui } = await native(); const first = reply(), other = reply()
  handleClaudeUiView(mount, 'window-one', first); await vi.advanceTimersByTimeAsync(100)
  const id = action(first)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: id }, 'window-two', other)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', threadId: 'foreign-thread', actionId: id }, 'window-one', first)
  expect(ui.press).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: id }, 'window-one', first)
  await vi.advanceTimersByTimeAsync(100)
  expect(ui.press).toHaveBeenCalledOnce()
})

it('does not start a process when mounted from history and attaches when a real owner becomes available', async () => {
  const delivery = reply(); handleClaudeUiView(mount, 'window', delivery)
  expect(delivery.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: 'disconnected' } })
  const { ui } = await native(); await vi.advanceTimersByTimeAsync(1100)
  expect(ui.attach).toHaveBeenCalledOnce(); expect(action(delivery)).toBeTruthy()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).toHaveBeenCalledOnce()
})

it('expires abandoned views, renews live leases, and clears them on thread teardown', async () => {
  const { ui } = await native(); const first = reply(), second = reply()
  handleClaudeUiView(mount, 'one', first); handleClaudeUiView(mount, 'two', second)
  await vi.advanceTimersByTimeAsync(20000)
  handleClaudeUiView(mount, 'two', second)
  await vi.advanceTimersByTimeAsync(11000)
  expect(ui.detach).toHaveBeenCalledTimes(1)
  expect(first.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: 'disconnected' } })
  runThreadTeardown('thread'); await vi.advanceTimersByTimeAsync(0)
  expect(ui.detach).toHaveBeenCalledTimes(2)
  expect(second.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: 'disconnected' } })
})

it('rebinds to a replacement process with fresh authority and removes a mount explicitly', async () => {
  const first = await native(); const delivery = reply()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  const old = action(delivery); await closeIdleConversation('thread')
  const second = await native(); handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  expect(action(delivery)).not.toBe(old)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: old }, 'window', delivery)
  expect(second.ui.press).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'window', delivery)
  await vi.advanceTimersByTimeAsync(0)
  expect(first.ui.detach).toHaveBeenCalledOnce(); expect(second.ui.detach).toHaveBeenCalledOnce()
})

it('ignores requests without a return connection and malformed mount identities', async () => {
  const { ui } = await native()
  handleClaudeUiView(mount)
  handleClaudeUiView({ ...mount, mountId: 'bad' }, 'window', reply())
  await vi.advanceTimersByTimeAsync(1000)
  expect(ui.attach).not.toHaveBeenCalled()
})

it('answers native UI updates only to the requesting connection through the actual threads system', async () => {
  vi.useRealTimers()
  const { startApp } = await import('@apackdev/testing/harness')
  const { testRootEvents } = await import('@apackdev/sdk/testing')
  const sent: (string | undefined)[] = []
  const stop = testRootEvents.onPluginSend(message => {
    if (message.event.type === 'CLAUDE_UI_STATE') sent.push(message.client)
  })
  try {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    await app.send('threads', mount, { sender: 'default-setup/threads', client: 'requested-window' })
    await app.send('threads', { type: 'CLAUDE_UI_FIELD', revision: 1, threadId: mount.threadId, mountId, actionId: randomUUID(), kind: 'change', value: 'foreign' }, { sender: 'default-setup/threads', client: 'requested-window' })
    await app.send('threads', { type: 'CLAUDE_PROMPT_EDIT', threadId: mount.threadId, mountId, revision: 1, by: 'person', text: 'draft', cursor: 5 }, { sender: 'default-setup/threads', client: 'requested-window' })
    await app.settle()
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(client => client === 'requested-window')).toBe(true)
  } finally { stop() }
})

it('returns composer replies only to the connection that owns the mounted native client', async () => {
  const { ui } = await native(), delivery = reply(), foreign = reply()
  handleClaudeUiView(mount, 'owner-window', delivery); await vi.advanceTimersByTimeAsync(50)
  const edit = { type: 'CLAUDE_PROMPT_EDIT' as const, threadId: 'thread', mountId, revision: 1, by: 'person' as const, text: 'draft', cursor: 5 }
  handleClaudeUiView(edit, 'foreign-window', foreign)
  expect(ui.promptEdit).not.toHaveBeenCalled()
  handleClaudeUiView(edit, 'owner-window', delivery); await vi.advanceTimersByTimeAsync(0)
  expect(ui.promptEdit).toHaveBeenCalledWith(expect.objectContaining({ text: 'draft', cursor: 5, by: 'person', surface: 'desktop' }))
  expect(delivery).toHaveBeenCalledWith({ type: 'CLAUDE_PROMPT_STATE', threadId: 'thread', mountId, result: { revision: 1, status: 'applied', frame: { text: 'native draft', cursor: 12 } } })
  expect(foreign).not.toHaveBeenCalled()
})


it('routes autocomplete only to the requesting mounted window and refuses foreign thread identities', async () => {
  const { ui } = await native(), delivery = reply(), foreign = reply()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  const request = { ...mount, type: 'CLAUDE_PROMPT_AUTOCOMPLETE' as const, revision: 1, text: 'tok', cursor: 3 }
  handleClaudeUiView(request, 'foreign-window', foreign)
  handleClaudeUiView({ ...request, threadId: 'foreign-thread' }, 'window', delivery)
  expect(ui.promptAutocomplete).not.toHaveBeenCalled()
  handleClaudeUiView(request, 'window', delivery); await vi.advanceTimersByTimeAsync(0)
  expect(delivery.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'CLAUDE_PROMPT_COMPLETIONS', mountId, threadId: 'thread', result: { revision: 1, status: 'ready' } })
  expect(foreign).not.toHaveBeenCalled()
})


it('returns focus only to the requesting delivery and drops replies after unmount', async () => {
  const { ui } = await native(), delivery = reply(), foreign = reply()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  const drawn = delivery.mock.calls.at(-1)?.[0]
  if (drawn?.type !== 'CLAUDE_UI_STATE' || drawn.state.status !== 'live' || drawn.state.tree.kind !== 'button') throw Error('expected button')
  const event = { ...mount, type: 'CLAUDE_UI_FOCUS' as const, revision: 1, isHeld: true, by: 'person' as const, focusId: drawn.state.tree.focusId! }
  handleClaudeUiView(event, 'foreign', foreign); expect(ui.focus).not.toHaveBeenCalled()
  handleClaudeUiView(event, 'window', delivery); await vi.advanceTimersByTimeAsync(0)
  expect(delivery.mock.calls.at(-1)?.[0]).toEqual({ type: 'CLAUDE_UI_FOCUS_STATE', threadId: 'thread', mountId, result: { revision: 1, moved: true, focusId: null } })
  let resolve!: (value: { moved: boolean; element: null }) => void
  ui.focus.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  handleClaudeUiView({ ...event, revision: 2 }, 'window', delivery); await vi.advanceTimersByTimeAsync(0)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'window', delivery)
  const count = delivery.mock.calls.length
  resolve({ moved: true, element: null }); await vi.advanceTimersByTimeAsync(0)
  expect(delivery.mock.calls).toHaveLength(count); expect(foreign).not.toHaveBeenCalled()
})


it('correlates queued native prompt requests to the right view and retires them on unmount', async () => {
  const { ui } = await native(), delivery = reply(), foreign = reply()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  const host = ui.servePrompt.mock.calls[0]![1], controller = new AbortController(), expires = Date.now() + 3500
  const reading = host.read(controller.signal, expires)
  await vi.advanceTimersByTimeAsync(0)
  const request = delivery.mock.calls.at(-1)?.[0]
  if (request?.type !== 'CLAUDE_PROMPT_HOST_REQUEST') throw Error('expected read request')
  expect(request.request).toMatchObject({ kind: 'read', revision: 0, expiresAt: expires })
  const response = { ...mount, type: 'CLAUDE_PROMPT_HOST_RESPONSE' as const, requestId: request.request.requestId, kind: 'read' as const, box: { text: 'live draft', cursor: 4 } }
  handleClaudeUiView(response, 'foreign', foreign)
  handleClaudeUiView(response, 'window', delivery)
  await expect(reading).resolves.toEqual(response.box)
  const first = host.read(controller.signal, expires), second = host.fill({ mode: 'append', text: ' native' }, controller.signal, expires)
  await vi.advanceTimersByTimeAsync(0)
  const queued = delivery.mock.calls.at(-1)?.[0]
  if (queued?.type !== 'CLAUDE_PROMPT_HOST_REQUEST' || queued.request.kind !== 'read') throw Error('expected queued read')
  handleClaudeUiView({ ...response, requestId: queued.request.requestId }, 'window', delivery)
  await first; await vi.advanceTimersByTimeAsync(0)
  expect(delivery.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'CLAUDE_PROMPT_HOST_REQUEST', request: { kind: 'fill', input: { mode: 'append', text: ' native' } } })
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'window', delivery)
  await expect(second).resolves.toBe(false)
  expect(foreign).not.toHaveBeenCalled()
})

it('keeps toast dismissal scoped to the requesting window, thread and current notice id', async () => {
  const { events } = await native(), first = reply(), second = reply(), foreign = reply()
  handleClaudeUiView(mount, 'first', first); handleClaudeUiView(mount, 'second', second); await vi.advanceTimersByTimeAsync(100)
  events.write({ type: 'system', subtype: 'ui_toast', uuid: 'native-toast', session_id: 'native-session', plugin: 'fixture', text: 'Native toast', timeout_ms: 1000 })
  await vi.advanceTimersByTimeAsync(0)
  const toasts = (delivery: ReturnType<typeof reply>) => { const value = delivery.mock.calls.at(-1)?.[0]; return value?.type === 'CLAUDE_UI_STATE' ? value.state.notices?.toasts ?? [] : [] }
  expect(toasts(first)).toHaveLength(1); expect(toasts(second)).toHaveLength(1)
  const event = { ...mount, type: 'CLAUDE_UI_NOTICE' as const, kind: 'dismiss' as const, id: 'native-toast' }
  handleClaudeUiView(event, 'foreign', foreign); handleClaudeUiView({ ...event, threadId: 'foreign-thread' }, 'first', first)
  handleClaudeUiView({ ...event, id: 'foreign-toast' }, 'first', first)
  expect(toasts(first)).toHaveLength(1); expect(foreign).not.toHaveBeenCalled()
  handleClaudeUiView(event, 'first', first)
  expect(toasts(first)).toHaveLength(0); expect(toasts(second)).toHaveLength(1)
})

it('does not retarget an Agent mount to the parent print conversation when its target disappears', async () => {
  const { ui } = await native(); const delivery = reply()
  const selected = { ...mount, nativeView: { ownerId: 'native-owner', sessionId: 'native-session', revision: 2, taskId: 'native-agent' } }
  handleClaudeUiView(selected, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).not.toHaveBeenCalled()
  handleClaudeUiView(mount, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'window', delivery)
  handleClaudeUiView({ ...mount, mountId: randomUUID() }, 'window', delivery); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).toHaveBeenCalledOnce()
})

it('awaits native detach acknowledgments for this window while preserving other windows', async () => {
  const { ui } = await native(), first = reply(), second = reply()
  handleClaudeUiView(mount, 'selecting-window', first); handleClaudeUiView(mount, 'other-window', second)
  await vi.advanceTimersByTimeAsync(100)
  let finish!: () => void
  ui.detach.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ detached: true, surfaces: [] }) }))
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'selecting-window', first)
  let released = false
  const release = releaseClaudeUiViews('selecting-window', 'thread').then(() => { released = true })
  await vi.advanceTimersByTimeAsync(0)
  expect(released).toBe(false); expect(ui.detach).toHaveBeenCalledOnce()
  expect(second.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: 'live' } })
  finish(); await release; expect(released).toBe(true)
  expect(ui.detach).toHaveBeenCalledOnce()
})

function lease(delivery: ReturnType<typeof reply>) {
  const event = [...delivery.mock.calls].reverse().map(([event]) => event).find(event => event.type === 'CLAUDE_UI_STATE')
  if (event?.type !== 'CLAUDE_UI_STATE') throw Error('expected native lease')
  expect(event.resumeKey).toEqual(expect.any(String))
  return { resumeKey: event.resumeKey, attachmentId: event.attachmentId }
}
it('resumes the same native attachment on a new delivery identity and retires the old identity', async () => {
  const { ui } = await native(), first = reply(), next = reply()
  handleClaudeUiView(mount, 'old-connection', first); await vi.advanceTimersByTimeAsync(100)
  const original = lease(first), id = action(first)
  handleClaudeUiView({ ...mount, resumeKey: original.resumeKey }, 'new-connection', next); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).toHaveBeenCalledOnce(); expect(ui.detach).not.toHaveBeenCalled()
  expect(lease(next).attachmentId).toBe(original.attachmentId)
  expect(lease(next).resumeKey).not.toBe(original.resumeKey)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: id }, 'old-connection', first)
  expect(ui.press).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: id }, 'new-connection', next); await vi.advanceTimersByTimeAsync(50)
  expect(ui.press).toHaveBeenCalledOnce()
  const host = ui.servePrompt.mock.calls[0][1], pending = host.read(new AbortController().signal, Date.now() + 3500)
  await vi.advanceTimersByTimeAsync(0)
  const request = next.mock.calls.at(-1)![0]
  expect(request.type).toBe('CLAUDE_PROMPT_HOST_REQUEST')
  if (request.type !== 'CLAUDE_PROMPT_HOST_REQUEST') throw Error('expected rebound prompt host')
  handleClaudeUiView({ ...mount, type: 'CLAUDE_PROMPT_HOST_RESPONSE', requestId: request.request.requestId, kind: 'read', box: { text: 'new window draft', cursor: 3 } }, 'new-connection', next)
  await expect(pending).resolves.toEqual({ text: 'new window draft', cursor: 3 })
})
it('does not resume an attachment using a guessed key, another scope or a revoked key', async () => {
  const { ui } = await native(), first = reply(), other = reply()
  handleClaudeUiView(mount, 'first', first); await vi.advanceTimersByTimeAsync(100)
  const original = lease(first)
  handleClaudeUiView({ ...mount, resumeKey: randomUUID() }, 'guessed', other)
  expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_LEASE_EXPIRED' }))
  handleClaudeUiView({ ...mount, threadId: 'foreign', resumeKey: original.resumeKey }, 'wrong-scope', other)
  expect(ui.attach).toHaveBeenCalledOnce(); expect(ui.detach).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, resumeKey: original.resumeKey }, 'resumed', other); await vi.advanceTimersByTimeAsync(100)
  handleClaudeUiView({ ...mount, resumeKey: original.resumeKey }, 'replayed', first)
  expect(first).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_LEASE_EXPIRED' }))
  expect(ui.attach).toHaveBeenCalledOnce()
})
it('expires a disconnected lease and permits an explicitly fresh attachment without stale action authority', async () => {
  const { ui } = await native(), first = reply(), next = reply()
  handleClaudeUiView(mount, 'expired', first); await vi.advanceTimersByTimeAsync(100)
  const old = lease(first), id = action(first)
  await vi.advanceTimersByTimeAsync(31000)
  handleClaudeUiView({ ...mount, resumeKey: old.resumeKey }, 'new', next)
  expect(next).toHaveBeenLastCalledWith({ type: 'CLAUDE_UI_LEASE_EXPIRED', threadId: mount.threadId, mountId, resumeKey: old.resumeKey })
  handleClaudeUiView(mount, 'new', next); await vi.advanceTimersByTimeAsync(100)
  expect(ui.attach).toHaveBeenCalledTimes(2); expect(lease(next).attachmentId).not.toBe(old.attachmentId)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: id }, 'new', next); await vi.advanceTimersByTimeAsync(50)
  expect(ui.press).not.toHaveBeenCalled()
})

it('delivers a valid pending native edit to the resumed window without rerunning it', async () => {
  const { ui } = await native(), first = reply(), next = reply()
  handleClaudeUiView(mount, 'old', first); await vi.advanceTimersByTimeAsync(100)
  const original = lease(first)
  let finish!: (frame: { text: string; cursor: number }) => void
  ui.promptEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  handleClaudeUiView({ ...mount, type: 'CLAUDE_PROMPT_EDIT', revision: 1, text: 'draft', cursor: 5, by: 'person' }, 'old', first)
  await vi.advanceTimersByTimeAsync(0)
  handleClaudeUiView({ ...mount, resumeKey: original.resumeKey }, 'new', next)
  finish({ text: 'native rewrite', cursor: 14 }); await vi.advanceTimersByTimeAsync(10)
  expect(ui.promptEdit).toHaveBeenCalledOnce()
  expect(first.mock.calls.some(([event]) => event.type === 'CLAUDE_PROMPT_STATE')).toBe(false)
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_PROMPT_STATE', result: expect.objectContaining({ revision: 1, frame: { text: 'native rewrite', cursor: 14 } }) }))
})
it('releases a reconnecting window with its own lease proof without releasing other windows', async () => {
  const { ui } = await native(), first = reply(), other = reply()
  handleClaudeUiView(mount, 'first', first); handleClaudeUiView(mount, 'other', other); await vi.advanceTimersByTimeAsync(100)
  const original = lease(first)
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'reconnected', first)
  expect(ui.detach).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT', resumeKey: original.resumeKey }, 'reconnected', first); await vi.advanceTimersByTimeAsync(100)
  expect(ui.detach).toHaveBeenCalledOnce()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: action(other) }, 'other', other); await vi.advanceTimersByTimeAsync(100)
  expect(ui.press).toHaveBeenCalledOnce()
})

it('retires a replaced actor without a reply route only with its scoped lease credential', async () => {
  const { ui } = await native(), first = reply(), other = reply()
  handleClaudeUiView(mount, 'first', first); handleClaudeUiView(mount, 'other', other); await vi.advanceTimersByTimeAsync(100)
  const resumeKey = lease(first).resumeKey
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT' }, 'new')
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT', resumeKey: crypto.randomUUID() }, 'new')
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT', resumeKey, threadId: 'foreign' }, 'new')
  expect(ui.detach).not.toHaveBeenCalled()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT', resumeKey }, 'new'); await vi.advanceTimersByTimeAsync(100)
  expect(ui.detach).toHaveBeenCalledOnce()
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_UNMOUNT', resumeKey }, 'new')
  handleClaudeUiView({ ...mount, type: 'CLAUDE_UI_PRESS', actionId: action(other) }, 'other', other); await vi.advanceTimersByTimeAsync(100)
  expect(ui.detach).toHaveBeenCalledOnce(); expect(ui.press).toHaveBeenCalledOnce()
})
