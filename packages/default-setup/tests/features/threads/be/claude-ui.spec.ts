import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { handleClaudeUiView, clearClaudeUiViews } from '#features/threads/be/claude-ui.ts'
import { openConversation, killAllHandles, closeIdleConversation } from '#features/code/be/services/claude-code/handle-store.ts'
import { runThreadTeardown } from '#features/threads/be/thread-teardown.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { OutgoingThreadsEvents } from '#features/threads/be/types.ts'

async function native(threadId = 'thread') {
  const events = new PassThrough({ objectMode: true })
  const ui = { focus: vi.fn(async () => ({ moved: true, element: null as { plugin: string; key: string } | null })), promptAutocomplete: vi.fn(async () => ({ suggestions: [{ text: 'native', label: 'Native row' }], start: 0 })), promptEdit: vi.fn(async () => ({ text: 'native draft', cursor: 12 })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })), attach: vi.fn(async () => ({ surfaces: ['desktop'] })), detach: vi.fn(async () => ({ detached: true, surfaces: [] })),
    render: vi.fn(async () => ({ tree: { type: 'Button', props: { label: 'Run', key: 'run' }, press: { plugin: 'fixture', handle: 1 } }, props: {}, hooked: true, rewritten: true })),
    press: vi.fn(async () => ({ handled: true })) }
  const handle = { ui, events, kill: () => events.end(), close: async () => { events.end() } } as unknown as QueryHandle
  const owner = await openConversation(threadId, 'fixture', async () => handle, async () => {})
  return { ui, owner }
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
