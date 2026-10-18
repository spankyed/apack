import { randomUUID } from 'node:crypto'
import { createClaudeTerminalViews, type ClaudeTerminalViewReply } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
const mount = { type: 'CLAUDE_TERMINAL_MOUNT', threadId: 'thread', mountId: randomUUID() } as const
function fixture(prepareInput?: Parameters<typeof createClaudeTerminalViews>[0]['prepareInput']) {
  const listeners = new Set<() => void>()
  const output = [{ sequence: 1, text: 'native\r\n' }]
  const owner = { state: { ownerId: randomUUID(), sessionId: randomUUID(), cwd: '/fixture', status: 'live', tasks: [] }, output,
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    submit: vi.fn(async (text: string) => ({ sessionId: owner.state.sessionId, uuid: randomUUID(), text })), input: vi.fn(), resize: vi.fn(), close: vi.fn(async () => {}), kill: vi.fn() } as unknown as ClaudeNativeTerminalOwner
  let current: ClaudeNativeTerminalOwner | undefined = owner
  const open = vi.fn(async () => owner)
  const views = createClaudeTerminalViews({ get: () => current, open, prepareInput })
  const send = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
  return { owner, output, listeners, open, views, send, setCurrent(value?: ClaudeNativeTerminalOwner) { current = value } }
}
afterEach(() => vi.useRealTimers())
it('requires the live window lease, matching thread and current owner for terminal controls', () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    const input = { ...mount, type: 'CLAUDE_TERMINAL_INPUT', ownerId: f.owner.state.ownerId, text: 'draft' } as const
    f.views.handle(input, 'two', f.send)
    f.views.handle({ ...input, threadId: 'other' }, 'one', f.send)
    f.views.handle({ ...input, ownerId: randomUUID() }, 'one', f.send)
    expect(f.owner.input).not.toHaveBeenCalled()
    f.views.handle(input, 'one', f.send)
    expect(f.owner.input).toHaveBeenCalledExactlyOnceWith(input.ownerId, 'draft')
    f.setCurrent(); f.views.handle(input, 'one', f.send)
    expect(f.owner.input).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})
it('publishes incremental bytes, replays to a new view and detaches without stopping the session', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].output).toEqual(f.output)
    f.views.handle(mount, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].output).toEqual([])
    f.output.push({ sequence: 2, text: 'next' }); for (const notify of f.listeners) notify()
    await Promise.resolve()
    expect(f.send.mock.calls.at(-1)![0].output).toEqual([{ sequence: 2, text: 'next' }])
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    expect(f.listeners.size).toBe(0); expect(f.owner.close).not.toHaveBeenCalled()
    f.views.handle(mount, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].output).toEqual(f.output)
  } finally { f.views.clear() }
})
it('expires abandoned controls and deduplicates handoff while retaining the owner after detach', async () => {
  vi.useFakeTimers()
  const f = fixture(); f.setCurrent()
  let resolve!: (owner: ClaudeNativeTerminalOwner) => void
  f.open.mockImplementation(() => new Promise(done => { resolve = done }))
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_OPEN' }, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_OPEN' }, 'one', f.send)
    expect(f.open).toHaveBeenCalledOnce()
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    resolve(f.owner); await Promise.resolve(); await Promise.resolve()
    expect(f.owner.kill).not.toHaveBeenCalled(); expect(f.owner.close).not.toHaveBeenCalled()
    f.setCurrent(f.owner); f.views.handle(mount, 'one', f.send)
    await vi.advanceTimersByTimeAsync(31000)
    expect(f.listeners.size).toBe(0)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_CLOSE', ownerId: f.owner.state.ownerId }, 'one', f.send)
    expect(f.owner.close).not.toHaveBeenCalled()
  } finally { f.views.clear() }
})

it('submits once for the owning view and publishes the native accepted prompt identity', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    const receipt = { sessionId: f.owner.state.sessionId, uuid: randomUUID(), text: 'Native rewrite' }
    vi.mocked(f.owner.submit).mockResolvedValue(receipt)
    const submit = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, revision: 1, text: 'Original draft' } as const
    f.views.handle(submit, 'other-window', f.send)
    f.views.handle({ ...submit, ownerId: randomUUID() }, 'one', f.send)
    expect(f.owner.submit).not.toHaveBeenCalled()
    f.views.handle(submit, 'one', f.send); f.views.handle(submit, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toEqual({ ownerId: submit.ownerId, revision: 1, status: 'accepted', receipt }))
    f.views.handle(submit, 'one', f.send)
    expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith('Original draft')
  } finally { f.views.clear() }
})
it('reports native refusal without an accepted prompt receipt', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    vi.mocked(f.owner.submit).mockRejectedValue(new Error('Native prompt refused'))
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, revision: 1, text: 'Keep this draft' }, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toMatchObject({ revision: 1, status: 'rejected', problem: 'Native prompt refused' }))
    expect(f.send.mock.calls.at(-1)![0].submission?.receipt).toBeUndefined()
  } finally { f.views.clear() }
})
it('discards receipts after owner replacement', async () => {
  const f = fixture()
  let resolve!: (receipt: { sessionId: string; uuid: string; text: string }) => void
  vi.mocked(f.owner.submit).mockImplementation(() => new Promise(done => { resolve = done }))
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, revision: 1, text: 'Old draft' }, 'one', f.send)
    await Promise.resolve(); const count = f.send.mock.calls.length
    f.setCurrent(); resolve({ sessionId: f.owner.state.sessionId, uuid: randomUUID(), text: 'Old accepted prompt' })
    await Promise.resolve(); await Promise.resolve()
    expect(f.send).toHaveBeenCalledTimes(count)
  } finally { f.views.clear() }
})


it('resolves image-only references before native submission and retains owner fencing across preparation', async () => {
  let finish!: (value: { text: string; images: { mediaType: 'image/png'; data: string }[] }) => void
  const prepare = vi.fn(() => new Promise<{ text: string; images: { mediaType: 'image/png'; data: string }[] }>(resolve => { finish = resolve }))
  const f = fixture(prepare)
  const event = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT' as const, ownerId: f.owner.state.ownerId, revision: 1, text: '', references: { images: [{ name: 'pixel.png', url: 'media://fixture/pixel.png' }] } }
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(event, 'one', f.send)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    expect(f.owner.submit).not.toHaveBeenCalled()
    const input = { text: '[Image: pixel.png]', images: [{ mediaType: 'image/png' as const, data: 'YQ==' }] }
    finish(input)
    await vi.waitFor(() => expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith(input.text, input.images))
    await vi.waitFor(() => expect(f.send.mock.lastCall![0].submission?.status).toBe('accepted'))
    f.views.handle({ ...event, revision: 2 }, 'one', f.send)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
    f.setCurrent(); finish(input)
    await Promise.resolve(); await Promise.resolve()
    expect(f.owner.submit).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})
