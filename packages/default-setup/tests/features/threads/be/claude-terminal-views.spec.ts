import { randomUUID } from 'node:crypto'
import type { ClaudeBackgroundStatus } from '#features/code/common/native-background.ts'
import { createClaudeTerminalViews, type ClaudeTerminalViewReply } from '#features/threads/be/claude-terminal-views.ts'
import { ClaudeTeammateEnded } from '#features/code/be/services/claude-code/teammate-recovery.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import { CLAUDE_UI_TEXT_LIMIT_MESSAGE, CLAUDE_UI_TEXT_MAX_LENGTH } from '#features/code/be/services/claude-code/ui-text-limits.ts'
const mount = { type: 'CLAUDE_TERMINAL_MOUNT', threadId: 'thread', mountId: randomUUID() } as const
function fixture(prepareInput?: Parameters<typeof createClaudeTerminalViews>[0]['prepareInput'], beforeViewChange?: Parameters<typeof createClaudeTerminalViews>[0]['beforeViewChange'], command?: Parameters<typeof createClaudeTerminalViews>[0]['command']) {
  const listeners = new Set<() => void>()
  const output = [{ sequence: 1, text: 'native\r\n' }]
  const owner = { state: { ownerId: randomUUID(), sessionId: randomUUID(), cwd: '/fixture', status: 'live', tasks: [] }, output,
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    uiTransport: {request: vi.fn(async () => ({handled: true}))},
    answerNotice: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}),
    operateTask: vi.fn(async () => ({ stopped: true })),
    submit: vi.fn(async (text: string) => ({ sessionId: owner.state.sessionId, uuid: randomUUID(), text })), input: vi.fn(), resize: vi.fn(), close: vi.fn(async () => {}), kill: vi.fn() } as unknown as ClaudeNativeTerminalOwner
  let current: ClaudeNativeTerminalOwner | undefined = owner
  const open = vi.fn(async () => owner)
  const accepted = vi.fn()
  const views = createClaudeTerminalViews({ get: () => current, open, prepareInput, accepted, beforeViewChange, command })
  const send = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
  return { owner, output, listeners, open, views, send, accepted, setCurrent(value?: ClaudeNativeTerminalOwner) { current = value } }
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
it('keeps Claude present for any focused conversation window and leaves the raw terminal in charge when focused', async () => {
  const f = fixture()
  const raw = { ...mount, mountId: randomUUID() }
  const {ownerId, sessionId} = f.owner.state
  const presence = (focused: boolean, terminal = false) => ({ownerId, sessionId, focused, terminal})
  const request = vi.mocked(f.owner.uiTransport.request)
  try {
    f.views.handle({ ...mount, presence: presence(true) }, 'one', f.send)
    f.views.handle({ ...mount, presence: presence(false) }, 'two', f.send)
    await vi.waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      subtype: 'apack_desktop_presence', session_id: sessionId, focused: true,
    })))

    f.views.handle({ ...mount, presence: presence(false) }, 'one', f.send)
    f.views.handle({ ...mount, presence: presence(true) }, 'two', f.send)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    f.views.handle({ ...raw, presence: presence(true, true) }, 'raw', f.send)
    f.views.handle({ ...mount, presence: presence(false) }, 'two', f.send)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    f.views.handle({ ...raw, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'raw', f.send)
    await vi.waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ focused: false })))
    expect(request).toHaveBeenCalledTimes(2)
  } finally { f.views.clear() }
})
it('drops a queued desktop presence change when its native owner is replaced', async () => {
  const f = fixture()
  const {ownerId, sessionId} = f.owner.state
  try {
    f.views.handle({ ...mount, presence: {ownerId, sessionId, focused: true, terminal: false} }, 'one', f.send)
    f.setCurrent()
    await Promise.resolve()
    expect(f.owner.uiTransport.request).not.toHaveBeenCalled()
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
    const submit = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: 'Original draft' } as const
    f.views.handle(submit, 'other-window', f.send)
    f.views.handle({ ...submit, ownerId: randomUUID() }, 'one', f.send)
    expect(f.owner.submit).not.toHaveBeenCalled()
    f.views.handle(submit, 'one', f.send); f.views.handle(submit, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toEqual({ ownerId: submit.ownerId, revision: 1, status: 'accepted', receipt }))
    f.views.handle(submit, 'one', f.send)
    expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith('Original draft')
  } finally { f.views.clear() }
})
it('settles an oversized owned submission and lets the same composer send a long draft afterward', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    const submit = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId } as const
    const oversized = { ...submit, revision: 1, text: '😀'.repeat(CLAUDE_UI_TEXT_MAX_LENGTH / 2) + 'x' }
    f.views.handle(oversized, 'other-window', f.send)
    expect(f.send.mock.calls.at(-1)![0].submission).toBeUndefined()
    f.views.handle(oversized, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].submission).toEqual({ ownerId: submit.ownerId, revision: 1, status: 'rejected', problem: CLAUDE_UI_TEXT_LIMIT_MESSAGE })
    expect(f.owner.submit).not.toHaveBeenCalled()
    const text = 'Review the release checklist. '.repeat(1800)
    f.views.handle({ ...submit, revision: 2, text }, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission?.status).toBe('accepted'))
    f.views.handle(oversized, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].submission?.revision).toBe(2)
    expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith(text)
  } finally { f.views.clear() }
})
it('reports native refusal without an accepted prompt receipt', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    vi.mocked(f.owner.submit).mockRejectedValue(new Error('Native prompt refused'))
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: 'Keep this draft' }, 'one', f.send)
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
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: 'Old draft' }, 'one', f.send)
    await vi.waitFor(() => expect(f.owner.submit).toHaveBeenCalledOnce()); const count = f.send.mock.calls.length
    f.setCurrent(); resolve({ sessionId: f.owner.state.sessionId, uuid: randomUUID(), text: 'Old accepted prompt' })
    await Promise.resolve(); await Promise.resolve()
    expect(f.send).toHaveBeenCalledTimes(count)
  } finally { f.views.clear() }
})


it('resolves image-only references before native submission and retains owner fencing across preparation', async () => {
  let finish!: (value: { text: string; images: { mediaType: 'image/png'; data: string }[] }) => void
  const prepare = vi.fn(() => new Promise<{ text: string; images: { mediaType: 'image/png'; data: string }[] }>(resolve => { finish = resolve }))
  const f = fixture(prepare)
  const event = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT' as const, ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: '', references: { images: [{ name: 'pixel.png', url: 'media://fixture/pixel.png' }] } }
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

it.each(['delivery', 'preparation'] as const)('fences a draft from the preceding session at %s even when the owner stays live', async point => {
  let finish!: (value: { text: string; images: [] }) => void
  const prepare = vi.fn(async (text: string) => ({ text, images: [] as [] }))
  if (point === 'preparation') prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const f = fixture(prepare)
  try {
    f.views.handle(mount, 'one', f.send)
    const request = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: 'Old session draft' } as const
    if (point === 'preparation') {
      f.views.handle(request, 'one', f.send)
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    }
    f.owner.state.sessionId = randomUUID()
    for (const notify of f.listeners) notify()
    if (point === 'delivery') f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toMatchObject({
      revision: 1, status: 'rejected', problem: 'The Claude session changed. Your draft was kept.',
    }))
    expect(f.owner.submit).not.toHaveBeenCalled()
    expect(f.accepted).not.toHaveBeenCalled()
    f.views.handle({ ...request, sessionId: f.owner.state.sessionId, revision: 2, text: 'New session draft' }, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toMatchObject({ revision: 2, status: 'accepted' }))
    if (point === 'preparation') {
      finish({ text: request.text, images: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith('New session draft')
    expect(f.send.mock.calls.at(-1)![0].submission?.revision).toBe(2)
  } finally { f.views.clear() }
})

it('persists accepted reference identity after the submitting view detaches', async () => {
  const f = fixture(async text => ({ text, images: [] }))
  let finish!: (receipt: { sessionId: string; uuid: string; text: string }) => void
  vi.mocked(f.owner.submit).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const references = { files: [{ name: 'example.ts', path: '/project/example.ts', typeLabel: 'TypeScript', isImage: false }] }
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: '', references }, 'one', f.send)
    await vi.waitFor(() => expect(f.owner.submit).toHaveBeenCalledOnce())
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    references.files[0].name = 'new draft name'
    const receipt = { sessionId: f.owner.state.sessionId, uuid: randomUUID(), text: 'Accepted file context' }
    finish(receipt)
    await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledExactlyOnceWith(f.owner, receipt, { files: [{ ...references.files[0], name: 'example.ts' }] }))
  } finally { f.views.clear() }
})

it('admits task controls only for the leased window, exact owner, live task and fresh revision', async () => {
  const f = fixture(); f.owner.state.tasks.push({ id: 'agent-a', name: 'worker', status: 'running' })
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, taskId: 'agent-a', revision: 1, operation: 'stop' } as const
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(request, 'foreign', f.send); f.views.handle({ ...request, ownerId: 'old-owner' }, 'one', f.send); f.views.handle({ ...request, taskId: 'foreign' }, 'one', f.send)
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    f.views.handle(request, 'one', f.send); f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].task?.status).toBe('done'))
    expect(f.owner.operateTask).toHaveBeenCalledExactlyOnceWith('agent-a', 'stop')
    f.views.handle(request, 'one', f.send); expect(f.owner.operateTask).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it('rejects a delayed Stop after the same owner clears while retaining the task', async () => {
  const f = fixture()
  f.owner.state.tasks.push({ id: 'scan', kind: 'managed', name: 'Auto mode scan', status: 'running' })
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId,
    sessionId: f.owner.state.sessionId, taskId: 'scan', revision: 1, operation: 'stop' } as const
  try {
    f.views.handle(mount, 'one', f.send)
    f.owner.state.sessionId = randomUUID()
    for (const notify of f.listeners) notify()
    await Promise.resolve()
    f.views.handle(request, 'one', f.send)
    await Promise.resolve()
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    f.views.handle({ ...request, sessionId: f.owner.state.sessionId, revision: 2 }, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].task?.status).toBe('done'))
    expect(f.owner.operateTask).toHaveBeenCalledExactlyOnceWith('scan', 'stop')
  } finally { f.views.clear() }
})

it('retires an in-flight task result across session reset and admits a fresh task action', async () => {
  const f = fixture()
  f.owner.state.tasks.push({ id: 'scan', kind: 'managed', name: 'Auto mode scan', status: 'running' })
  let finish!: () => void
  vi.mocked(f.owner.operateTask).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ stopped: true })
  }))
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId,
    sessionId: f.owner.state.sessionId, taskId: 'scan', revision: 1, operation: 'stop' } as const
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(f.owner.operateTask).toHaveBeenCalledOnce())
    f.owner.state.sessionId = randomUUID()
    for (const notify of f.listeners) notify()
    await Promise.resolve()
    expect(f.send.mock.calls.at(-1)![0].task).toBeUndefined()
    f.views.handle({ ...request, sessionId: f.owner.state.sessionId }, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].task).toMatchObject({
      status: 'done', sessionId: f.owner.state.sessionId,
    }))
    expect(f.owner.operateTask).toHaveBeenCalledTimes(2)
    const publishes = f.send.mock.calls.length
    finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.send.mock.calls).toHaveLength(publishes)
  } finally { f.views.clear() }
})

it.each(['send', 'input'] as const)('admits only bounded %s task input through the current lease and exact native receipt', async operation => {
  const f = fixture(); f.owner.state.tasks.push({ id: 'agent-a', name: 'worker', status: 'running' })
  const input = { messageId: randomUUID(), mode: 'queued' as const }
  vi.mocked(f.owner.operateTask).mockResolvedValue(operation === 'input' ? { input } : { sent: true })
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, taskId: 'agent-a', revision: 1, operation, text: 'Keep working on this instruction' } as const
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(request, 'foreign', f.send); f.views.handle({ ...request, text: ' ' }, 'one', f.send); f.views.handle({ ...request, text: 'x'.repeat(16385) }, 'one', f.send)
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].task?.status).toBe('done'))
    expect(operation === 'input' ? f.send.mock.calls.at(-1)![0].task?.input : f.send.mock.calls.at(-1)![0].task?.sent).toEqual(operation === 'input' ? input : true)
    expect(f.owner.operateTask).toHaveBeenCalledExactlyOnceWith('agent-a', operation, request.text)
    f.views.handle(request, 'one', f.send); expect(f.owner.operateTask).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it.each([false, true])('awaits prompt host release and rechecks owner replacement (%s)', async replacement => {
  let finish!: () => void
  const release = vi.fn(() => new Promise<void>(resolve => { finish = resolve })), f = fixture(undefined, release)
  f.owner.state.tasks.push({ id: 'agent', name: 'Worker', status: 'running' })
  vi.mocked(f.owner.operateTask).mockResolvedValue({ view: { taskId: 'agent' } })
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, taskId: 'agent', revision: 1, operation: 'foreground' }, 'window', f.send)
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('window', 'thread'))
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    if (replacement) f.setCurrent(undefined)
    finish()
    if (replacement) { await new Promise(resolve => setTimeout(resolve, 0)); expect(f.owner.operateTask).not.toHaveBeenCalled() }
    else await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].task).toMatchObject({ status: 'done', operation: 'foreground', view: { taskId: 'agent' } }))
  } finally { f.views.clear() }
})

it('returns the submitting window native command outcome without a fabricated human receipt', async () => {
  const nextSession = randomUUID()
  const command = vi.fn(async () => {
    f.owner.state.sessionId = nextSession
    return { kind: 'command_complete' as const, commandName: 'clear', messageId: randomUUID(), sessionId: nextSession, conversationId: randomUUID() }
  })
  const f = fixture(undefined, undefined, command)
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: '/clear' }, 'window', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toMatchObject({ status: 'accepted', command: { kind: 'command_complete' } }))
    expect(command).toHaveBeenCalledExactlyOnceWith('window', 'thread', mount.mountId, 1, '/clear', false)
    expect(f.owner.submit).not.toHaveBeenCalled(); expect(f.accepted).not.toHaveBeenCalled()
    expect(f.send.mock.calls.at(-1)![0].submission?.receipt).toBeUndefined()
  } finally { f.views.clear() }
})

it('answers only the exact live notice and refuses stale or detached controls', async () => {
  const f = fixture()
  try {
    const notice = { id: 'notice', revision: randomUUID(), sessionId: f.owner.state.sessionId, kind: 'auto_mode_server_fallback' as const, title: 'Original notice', paragraphs: ['Original explanation'], helpUrl: 'https://code.claude.com/docs/en/auto-mode-classifier-billing' }
    f.owner.state.notice = notice
    f.views.handle(mount, 'one', f.send)
    const request = { ...mount, type: 'CLAUDE_TERMINAL_NOTICE' as const, ownerId: f.owner.state.ownerId, notice: { id: notice.id, revision: notice.revision, sessionId: notice.sessionId, decision: 'continue' as const } }
    f.views.handle({ ...request, notice: { ...request.notice, revision: randomUUID() } }, 'one', f.send)
    f.views.handle(request, 'other-window', f.send)
    expect(f.owner.answerNotice).not.toHaveBeenCalled()
    f.views.handle(request, 'one', f.send)
    f.views.handle(request, 'one', f.send)
    expect(f.owner.answerNotice).toHaveBeenCalledExactlyOnceWith(request.notice)
    await Promise.resolve(); await Promise.resolve()
    expect(f.send.mock.calls.at(-1)![0].noticeAnswer?.status).toBe('done')
    f.owner.state.notice = { ...notice, revision: randomUUID() }
    f.views.handle(request, 'one', f.send)
    expect(f.owner.answerNotice).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it('cancels only the matching opening view and waits for cleanup before permitting retry', async () => {
 const pending:Array<{signal:AbortSignal;reject:(error:Error)=>void}>=[],replies:ClaudeTerminalViewReply[]=[];
 const open=vi.fn((_thread:string,signal:AbortSignal)=>new Promise<ClaudeNativeTerminalOwner>((_,reject)=>pending.push({signal,reject})));
 const views=createClaudeTerminalViews({get:()=>undefined,open});
 const send=(event:Parameters<typeof views.handle>[0],client='first')=>views.handle(event,client,reply=>replies.push(reply));
 send(mount);send({...mount,type:'CLAUDE_TERMINAL_OPEN'});const openingId=replies.at(-1)!.openingId!;
 expect(openingId).toBeTruthy();send({...mount,type:'CLAUDE_TERMINAL_MOUNT'},'second');
 send({...mount,type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId},'second');
 send({...mount,type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId:randomUUID()});expect(pending[0].signal.aborted).toBe(false);
 send({...mount,type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId});expect(pending[0].signal.aborted).toBe(true);expect(replies.at(-1)).toMatchObject({opening:true,cancelling:true});
 send({...mount,type:'CLAUDE_TERMINAL_OPEN'});expect(open).toHaveBeenCalledTimes(1);
 pending[0].reject(new Error('Child exited'));await vi.waitFor(()=>expect(replies.at(-1)).toMatchObject({opening:false,problem:'Native startup cancelled'}));
 send({...mount,type:'CLAUDE_TERMINAL_OPEN'});expect(open).toHaveBeenCalledTimes(2);expect(replies.at(-1)!.openingId).not.toBe(openingId);
 send({...mount,type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId});expect(pending[1].signal.aborted).toBe(false);
 send({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'});expect(pending[1].signal.aborted).toBe(true);pending[1].reject(new Error('Child exited'));views.clear();
});
it('drains a late published owner after cancellation without attaching it to the retired opening', async () => {
 let resolve!:(owner:ClaudeNativeTerminalOwner)=>void,finish!:()=>void;
 const done=new Promise<void>(yes=>{finish=yes}),close=vi.fn(async()=>{}),owner={state:{ownerId:'late'},done,close} as unknown as ClaudeNativeTerminalOwner;
 let current:ClaudeNativeTerminalOwner|undefined;const replies:ClaudeTerminalViewReply[]=[];
 const views=createClaudeTerminalViews({get:()=>current,open:()=>new Promise(yes=>{resolve=yes})});
 const send=(event:Parameters<typeof views.handle>[0])=>views.handle(event,'client',reply=>replies.push(reply));
 send(mount);send({...mount,type:'CLAUDE_TERMINAL_OPEN'});send({...mount,type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId:replies.at(-1)!.openingId!});current=owner;resolve(owner);
 await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(replies.at(-1)).toMatchObject({opening:true,cancelling:true});expect(replies.at(-1)!.state).toBeUndefined();finish();
 await vi.waitFor(()=>expect(replies.at(-1)!.opening).toBe(false));views.clear();
});


it.each(['foreground', 'background'] as const)('holds shared UI suspension until %s completes and resumes after native failure', async operation => {
  const resume = vi.fn(), release = vi.fn(async () => resume), f = fixture(undefined, release)
  f.owner.state.tasks.push({ id: 'agent', name: 'Worker', status: 'running' })
  const fromAgent = operation === 'background' ? { taskId: 'agent', revision: 3 } : undefined
  if (fromAgent) f.owner.state.view = { kind: 'agent', taskId: 'agent', registryId: 'registry-agent', revision: fromAgent.revision }
  let fail!: (error: Error) => void
  vi.mocked(f.owner.operateTask).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, taskId: 'agent', revision: 1, operation, fromAgent }, 'window', f.send)
    await vi.waitFor(() => expect(f.owner.operateTask).toHaveBeenCalledOnce())
    expect(resume).not.toHaveBeenCalled()
    fail(Error('native view refused'))
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].task).toMatchObject({ status: 'error', problem: 'native view refused' }))
    expect(resume).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})


it('refuses a delayed return for a newly selected instance of the same Agent before suspending UI', async () => {
  const suspend = vi.fn(async () => vi.fn()), f = fixture(undefined, suspend)
  f.owner.state.view = { kind: 'agent', taskId: 'agent', registryId: 'registry-agent', revision: 5 }
  vi.mocked(f.owner.operateTask).mockResolvedValue({ view: { taskId: null } })
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId,
    sessionId: f.owner.state.sessionId, taskId: 'agent', revision: 1, operation: 'background' } as const
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle({ ...request, fromAgent: { taskId: 'agent', revision: 3 } }, 'window', f.send)
    await vi.waitFor(() => expect(f.send.mock.lastCall?.[0].task).toMatchObject({ revision: 1, status: 'error' }))
    expect(suspend).not.toHaveBeenCalled()
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    const fromAgent = { taskId: 'agent', revision: 5 }
    f.views.handle({ ...request, revision: 2, fromAgent }, 'window', f.send)
    await vi.waitFor(() => expect(f.owner.operateTask).toHaveBeenCalledExactlyOnceWith('agent', 'background', undefined, undefined, fromAgent))
    expect(suspend).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it('routes a completed ancestor outside the ordinary roster only from its current selection', async () => {
  const resume = vi.fn(), suspend = vi.fn(async () => resume), f = fixture(undefined, suspend)
  f.owner.state.view = { kind: 'agent', taskId: 'child', registryId: 'registry-child', revision: 5 }
  vi.mocked(f.owner.operateTask).mockResolvedValue({ view: { taskId: 'parent' } })
  try {
    f.views.handle(mount, 'window', f.send)
    const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId,
      sessionId: f.owner.state.sessionId, taskId: 'parent', revision: 1, operation: 'foreground' } as const
    f.views.handle(request, 'window', f.send)
    f.views.handle({ ...request, fromAgent: { taskId: 'child', revision: 4 } }, 'window', f.send)
    expect(suspend).not.toHaveBeenCalled()
    const fromAgent = { taskId: 'child', revision: 5 }
    f.views.handle({ ...request, fromAgent }, 'window', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].task).toMatchObject({
      status: 'done', operation: 'foreground', view: { taskId: 'parent' },
    }))
    expect(f.owner.operateTask).toHaveBeenCalledExactlyOnceWith('parent', 'foreground', undefined, undefined, fromAgent)
    expect(resume).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it('carries the selected phase only to the authenticated owner and preserves a native refusal', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    const submit = { ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, sessionId: f.owner.state.sessionId, revision: 1, text: 'Retain my plan draft', phase: 'Plan' } as const
    f.views.handle(submit, 'other-window', f.send)
    expect(f.owner.submit).not.toHaveBeenCalled()
    vi.mocked(f.owner.submit).mockRejectedValue(new Error('Original policy refusal'))
    f.views.handle(submit, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].submission).toMatchObject({status:'rejected',problem:'Original policy refusal'}))
    expect(f.owner.submit).toHaveBeenCalledExactlyOnceWith(submit.text, undefined, 'Plan')
    expect(f.send.mock.calls.at(-1)![0].submission?.receipt).toBeUndefined()
  } finally { f.views.clear() }
})

function mcpFormFor(request: { id: string; revision: string; sessionId: string; token: string }) {
  const { id, revision, sessionId, token } = request
  return { id, revision, sessionId, token, ready: true, serverName: 'test', message: 'Confirm this',
    schema: {}, propertyOrder: [], values: {}, errors: {}, resolvingFields: [], focusedButton: null, textInputValue: '' }
}

it('never publishes an old MCP form failure to its replacement or blocks the replacement action', async () => {
  const f = fixture()
  let rejectOld!: (error: Error) => void
  let completeNew!: () => void
  vi.mocked(f.owner.operateMcpForm)
    .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { completeNew = resolve }))
  const first = { id: 'dialog', revision: randomUUID(), sessionId: f.owner.state.sessionId,
    token: 'a'.repeat(64), action: { operation: 'accept' as const } }
  const second = { ...first, revision: randomUUID(), token: 'b'.repeat(64) }
  const event = { ...mount, type: 'CLAUDE_TERMINAL_MCP_FORM' as const, ownerId: f.owner.state.ownerId }
  try {
    f.owner.state.mcpForm = mcpFormFor(first)
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...event, sequence: 1, request: first }, 'one', f.send)
    await Promise.resolve()
    expect(f.owner.operateMcpForm).toHaveBeenCalledExactlyOnceWith(first)
    expect(f.send.mock.calls.at(-1)![0].mcpOperation).toMatchObject({ sequence: 1, status: 'pending' })

    f.owner.state.mcpForm = mcpFormFor(second)
    for (const notify of f.listeners) notify()
    await Promise.resolve()
    expect(f.send.mock.calls.at(-1)![0].mcpOperation).toBeUndefined()

    f.views.handle({ ...event, sequence: 2, request: first }, 'one', f.send)
    f.views.handle({ ...event, sequence: 3, request: second }, 'one', f.send)
    await Promise.resolve()
    expect(f.owner.operateMcpForm).toHaveBeenCalledTimes(2)
    expect(f.owner.operateMcpForm).toHaveBeenLastCalledWith(second)
    rejectOld(new Error('Old dialog expired'))
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].mcpOperation).toMatchObject({ sequence: 3, status: 'pending' }))
    completeNew()
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].mcpOperation).toEqual({ sequence: 3, status: 'done' }))
    expect(f.send.mock.calls.some(([reply]) => reply.mcpOperation?.problem === 'Old dialog expired')).toBe(false)
  } finally { f.views.clear() }
})

it('addresses MCP operations to the live lease and deduplicates pending and completed sequences', async () => {
  const f = fixture(); let finish!: () => void
  vi.mocked(f.owner.operateMcpForm).mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const request = { ...mount, type: 'CLAUDE_TERMINAL_MCP_FORM' as const, ownerId: f.owner.state.ownerId, sequence: 1, request: { id: 'dialog', revision: randomUUID(), sessionId: f.owner.state.sessionId, token: 'a'.repeat(64), action: { operation: 'cancel' as const } } }
  try {
    f.owner.state.mcpForm = mcpFormFor(request.request)
    f.views.handle(mount, 'one', f.send)
    f.views.handle(request, 'foreign', f.send); f.views.handle({ ...request, ownerId: 'foreign' }, 'one', f.send)
    expect(f.owner.operateMcpForm).not.toHaveBeenCalled()
    f.views.handle(request, 'one', f.send); f.views.handle(request, 'one', f.send); f.views.handle({ ...request, sequence: 2 }, 'one', f.send)
    await Promise.resolve(); expect(f.owner.operateMcpForm).toHaveBeenCalledExactlyOnceWith(request.request)
    finish(); await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].mcpOperation?.status).toBe('done'))
    f.views.handle(request, 'one', f.send); expect(f.owner.operateMcpForm).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})
it('withdraws queued MCP work when its view detaches before dispatch', async () => {
  const f = fixture()
  const request = { id: 'dialog', revision: randomUUID(), sessionId: f.owner.state.sessionId, token: 'a'.repeat(64), action: { operation: 'accept' as const } }
  try {
    f.owner.state.mcpForm = mcpFormFor(request)
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_MCP_FORM', ownerId: f.owner.state.ownerId, sequence: 1, request }, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    await Promise.resolve(); expect(f.owner.operateMcpForm).not.toHaveBeenCalled(); expect(f.owner.close).not.toHaveBeenCalled()
  } finally { f.views.clear() }
})

it('shares sequencing across form/URL requests and rejects a detached URL action', async () => {
  const f = fixture(); let finish!: () => void
  vi.mocked(f.owner.operateMcpUrl).mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const request = { ...mount, type: 'CLAUDE_TERMINAL_MCP_URL' as const, ownerId: f.owner.state.ownerId, sequence: 1, request: { id: 'url', revision: randomUUID(), sessionId: f.owner.state.sessionId, token: 'a'.repeat(64), action: { operation: 'open' as const } } }
  try {
    f.owner.state.mcpUrl = { ...request.request, ready: true, kind: 'mcp_url_elicitation', phase: 'prompt', serverName: 'test',
      message: 'Confirm this', url: 'https://example.net/', title: 'Owned fixture', userConfirmsCompletion: false, choices: [], warnings: [] }
    f.views.handle(mount, 'one', f.send); f.views.handle(request, 'foreign', f.send); expect(f.owner.operateMcpUrl).not.toHaveBeenCalled()
    f.views.handle(request, 'one', f.send)
    f.views.handle({ ...request, type: 'CLAUDE_TERMINAL_MCP_FORM', sequence: 2, request: { ...request.request, action: { operation: 'accept' } } }, 'one', f.send)
    await Promise.resolve(); expect(f.owner.operateMcpUrl).toHaveBeenCalledExactlyOnceWith(request.request); expect(f.owner.operateMcpForm).not.toHaveBeenCalled()
    finish(); await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].mcpOperation?.status).toBe('done'))
    f.views.handle({ ...request, sequence: 2 }, 'one', f.send); f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    await Promise.resolve(); expect(f.owner.operateMcpUrl).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})


describe('background session view lifetime', () => {
  const link = { sessionId: '24be904a-3c35-4981-9793-cbe7a6c19d46', continuedInSessionId: '05ff1d31-597d-4537-8737-4407191add6e', timestamp: '2026-10-29T12:13:13.909Z' }
  const request = { ...mount, type: 'CLAUDE_TERMINAL_BACKGROUND' as const, ...link, revision: 1, operation: 'refresh' as const }
  it('uses the persisted link after the foreground owner has exited, and reopens on a new mount', async () => {
    const background = vi.fn(async () => undefined), send = vi.fn()
    const views = createClaudeTerminalViews({ get: () => undefined, open: vi.fn(), continuation: () => link, background })
    try {
      views.handle(mount, 'one', send); views.handle(request, 'one', send)
      await vi.waitFor(() => expect(send.mock.calls.at(-1)![0].background?.status).toBe('done'))
      expect(background).toHaveBeenCalledOnce()
      views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', send)
      const remount = { ...mount, mountId: randomUUID() }
      views.handle(remount, 'one', send); views.handle({ ...request, mountId: remount.mountId }, 'one', send)
      await vi.waitFor(() => expect(background).toHaveBeenCalledTimes(2))
    } finally { views.clear() }
  })
  it('rejects another window, foreign session and replayed revisions', async () => {
    const background = vi.fn(async () => undefined), send = vi.fn()
    const views = createClaudeTerminalViews({ get: () => undefined, open: vi.fn(), continuation: () => link, background })
    try {
      views.handle(mount, 'one', send)
      views.handle(request, 'two', send)
      views.handle({ ...request, continuedInSessionId: randomUUID() }, 'one', send)
      expect(background).not.toHaveBeenCalled()
      views.handle(request, 'one', send)
      await vi.waitFor(() => expect(send.mock.calls.at(-1)![0].background?.status).toBe('done'))
      views.handle(request, 'one', send)
      await Promise.resolve(); expect(background).toHaveBeenCalledOnce()
    } finally { views.clear() }
  })
  it.each(['unmount', 'replacement'])('does not publish a late read after %s', async change => {
    let current = link, finish!: () => void
    const background = vi.fn(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined) })), send = vi.fn()
    const views = createClaudeTerminalViews({ get: () => undefined, open: vi.fn(), continuation: () => current, background })
    try {
      views.handle(mount, 'one', send); views.handle(request, 'one', send)
      await vi.waitFor(() => expect(background).toHaveBeenCalledOnce())
      if (change === 'unmount') views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', send)
      else current = { ...link, continuedInSessionId: randomUUID() }
      const before = send.mock.calls.length; finish(); await Promise.resolve(); await Promise.resolve()
      expect(send.mock.calls).toHaveLength(before)
    } finally { views.clear() }
  })
  it('lets a new child refresh while the previous child read is still pending', async () => {
    let current = link, finish!: () => void
    const background = vi.fn().mockImplementationOnce(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined) })).mockResolvedValue(undefined), send = vi.fn()
    const views = createClaudeTerminalViews({ get: () => undefined, open: vi.fn(), continuation: () => current, background })
    try {
      views.handle(mount, 'one', send); views.handle(request, 'one', send)
      await vi.waitFor(() => expect(background).toHaveBeenCalledOnce())
      current = { ...link, continuedInSessionId: randomUUID() }
      views.handle({ ...request, ...current, revision: 2 }, 'one', send)
      await vi.waitFor(() => expect(send.mock.calls.at(-1)![0].background).toMatchObject({ continuedInSessionId: current.continuedInSessionId, status: 'done' }))
      finish(); await Promise.resolve(); await Promise.resolve()
      expect(send.mock.calls.at(-1)![0].background.continuedInSessionId).toBe(current.continuedInSessionId)
    } finally { views.clear() }
  })

})

async function attachmentFixture() {
  let link = {sessionId:randomUUID(),continuedInSessionId:randomUUID(),timestamp:'2026-10-30T09:00:00Z'}, listener:(()=>void)|undefined
  const job = {id:'abcdef12',sessionId:link.continuedInSessionId,cwd:'/child',state:'working' as const,pid:99}
  const child = {snapshot:{id:randomUUID(),terminalSession:{id:'child-broker-1',target:null},jobId:job.id,sessionId:job.sessionId,cwd:job.cwd,clientPid:123,status:'live' as const,output:[{sequence:1,text:'original child'}]},subscribe:vi.fn((value:()=>void)=>{listener=value;return vi.fn()}),input:vi.fn(),resize:vi.fn(),close:vi.fn(async()=>{})}
  const openAttachment = vi.fn(async(_continuation:typeof link,_jobId:string,_threadId:string,_signal:AbortSignal)=>child), background = vi.fn(async()=>job), send = vi.fn()
  const views = createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background,openAttachment})
  views.handle(mount,'one',send)
  views.handle({...mount,type:'CLAUDE_TERMINAL_BACKGROUND',...link,revision:1,operation:'refresh'},'one',send)
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background.status).toBe('done'))
  const request = {...mount,type:'CLAUDE_BACKGROUND_OPEN' as const,...link,jobId:job.id,revision:1}
  return {views,send,child,openAttachment,background,request,notify:()=>listener?.(),changeLink:()=>{link={...link,continuedInSessionId:randomUUID()}}}
}
it('opens only the listed linked child and keeps input/resize authority on its own attachment',async()=>{
  const f=await attachmentFixture()
  try {
    f.views.handle({...f.request,jobId:'12345678'},'one',f.send);expect(f.openAttachment).not.toHaveBeenCalled()
    f.views.handle(f.request,'one',f.send);await vi.waitFor(()=>expect(f.send.mock.calls.at(-1)![0].attachment?.status).toBe('ready'))
    f.views.handle({...mount,type:'CLAUDE_BACKGROUND_INPUT',attachmentId:'stale',text:'no'},'one',f.send);expect(f.child.input).not.toHaveBeenCalled()
    f.views.handle({...mount,type:'CLAUDE_BACKGROUND_INPUT',attachmentId:f.child.snapshot.id,text:'yes'},'one',f.send);expect(f.child.input).toHaveBeenCalledExactlyOnceWith(f.child.snapshot.id,'yes')
    f.views.handle({...mount,type:'CLAUDE_BACKGROUND_RESIZE',attachmentId:f.child.snapshot.id,columns:80,rows:24},'one',f.send);expect(f.child.resize).toHaveBeenCalledExactlyOnceWith(f.child.snapshot.id,80,24,undefined)
    const requestId=f.send.mock.calls.at(-1)![0].attachment.requestId
    f.views.handle({...mount,type:'CLAUDE_BACKGROUND_CLOSE',requestId},'one',f.send);expect(f.child.close).toHaveBeenCalled();expect(f.background.mock.calls).toHaveLength(1)
    f.views.handle(f.request,'one',f.send);expect(f.openAttachment).toHaveBeenCalledOnce()
  }finally{f.views.clear()}
})
it('aborts a pending attach on window unmount and closes an ignored late result',async()=>{
  const f=await attachmentFixture();let finish!:(value:typeof f.child)=>void
  f.openAttachment.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  try {
    f.views.handle(f.request,'one',f.send);await vi.waitFor(()=>expect(f.openAttachment).toHaveBeenCalledOnce())
    const signal=f.openAttachment.mock.calls[0]![3]
    f.views.handle({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'},'one',f.send);expect(signal.aborted).toBe(true)
    const count=f.send.mock.calls.length;finish(f.child);await vi.waitFor(()=>expect(f.child.close).toHaveBeenCalledOnce());expect(f.send.mock.calls).toHaveLength(count)
  }finally{f.views.clear()}
})
it('retires the child client when the durable continuation changes without redirecting old input',async()=>{
  const f=await attachmentFixture()
  try {
    f.views.handle(f.request,'one',f.send);await vi.waitFor(()=>expect(f.send.mock.calls.at(-1)![0].attachment?.status).toBe('ready'))
    f.changeLink();f.views.handle({...mount,type:'CLAUDE_BACKGROUND_INPUT',attachmentId:f.child.snapshot.id,text:'stale'},'one',f.send);expect(f.child.input).not.toHaveBeenCalled()
    f.notify();expect(f.child.close).toHaveBeenCalledOnce();expect(f.send.mock.calls.at(-1)![0].attachment).toBeUndefined()
  }finally{f.views.clear()}
})

describe('background reply ownership', () => {
  const link={sessionId:'24be904a-3c35-4981-9793-cbe7a6c19d46',continuedInSessionId:'05ff1d31-597d-4537-8737-4407191add6e',timestamp:'2026-10-29T12:13:13.909Z'}
  const job={id:'05ff1d31',sessionId:link.continuedInSessionId,cwd:'/owned',pid:119,state:'working' as const}
  async function ready(replyBackground:NonNullable<Parameters<typeof createClaudeTerminalViews>[0]['replyBackground']>) {
    const send=vi.fn(),background=vi.fn(async()=>job),views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background,replyBackground})
    views.handle(mount,'one',send)
    expect(send.mock.calls.at(-1)![0].canReplyBackground).toBe(true)
    views.handle({...mount,...link,type:'CLAUDE_TERMINAL_BACKGROUND',operation:'refresh',revision:1},'one',send)
    await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.status).toBe('done'))
    const request={...mount,...link,type:'CLAUDE_TERMINAL_BACKGROUND' as const,operation:'reply' as const,id:job.id,pid:job.pid,text:'Follow up.',revision:2}
    return {send,views,request}
  }
  it('rejects another window, stale workers and duplicate pending sends', async()=>{
    let finish!:(value:typeof job)=>void
    const reply=vi.fn(()=>new Promise<typeof job>(resolve=>{finish=resolve})),f=await ready(reply)
    try{
      f.views.handle(f.request,'two',f.send);f.views.handle({...f.request,pid:120},'one',f.send);await Promise.resolve();expect(reply).not.toHaveBeenCalled()
      f.views.handle(f.request,'one',f.send);await vi.waitFor(()=>expect(reply).toHaveBeenCalledOnce())
      f.views.handle({...f.request,revision:3},'one',f.send);await Promise.resolve();expect(reply).toHaveBeenCalledOnce()
      finish(job);await vi.waitFor(()=>expect(f.send.mock.calls.at(-1)![0].background).toMatchObject({status:'done',operation:'reply',revision:2}))
      f.views.handle(f.request,'one',f.send);await Promise.resolve();expect(reply).toHaveBeenCalledOnce()
    }finally{f.views.clear()}
  })
  it('does not send when its window closes before dispatch', async()=>{
    const reply=vi.fn(async()=>job),f=await ready(reply)
    try{f.views.handle(f.request,'one',f.send);f.views.handle({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'},'one',f.send);await Promise.resolve();expect(reply).not.toHaveBeenCalled()}finally{f.views.clear()}
  })
  it('publishes an original refusal without retrying the send', async()=>{
    const reply=vi.fn(async()=>{throw Error('Original native refusal')}),f=await ready(reply)
    try{f.views.handle(f.request,'one',f.send);await vi.waitFor(()=>expect(f.send.mock.calls.at(-1)![0].background).toMatchObject({status:'error',operation:'reply',problem:'Original native refusal'}));expect(reply).toHaveBeenCalledOnce()}finally{f.views.clear()}
  })
})

it('publishes retained child status to a window without a parent owner and releases its subscription on detach',()=>{
 let updated!:(()=>void),info:any={sessionId:'child',pid:119,model:'sonnet',turns:2},unsubscribe=vi.fn()
 const send=vi.fn(),views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),backgroundInfo:()=>info,subscribeBackground:(_key,changed)=>{updated=changed;return unsubscribe}})
 try{
  views.handle(mount,'surviving-window',send);expect(send.mock.calls.at(-1)?.[0].backgroundInfo).toEqual(info)
  info={...info,turns:3};updated();expect(send.mock.calls.at(-1)?.[0].backgroundInfo?.turns).toBe(3)
  views.handle({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'},'surviving-window',send);expect(unsubscribe).toHaveBeenCalledOnce()
  const count=send.mock.calls.length;updated();expect(send).toHaveBeenCalledTimes(count)
 }finally{views.clear()}
})

it('recovers background observation once for a mounted view and ignores completion after that view detaches',async()=>{
 let done!:()=>void
 const restoreBackground=vi.fn(()=>new Promise<void>(resolve=>{done=resolve})),send=vi.fn()
 const views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),restoreBackground})
 try{
  views.handle(mount,'one',send);views.handle(mount,'one',send)
  expect(restoreBackground).toHaveBeenCalledExactlyOnceWith('thread')
  views.handle({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'},'one',send)
  const count=send.mock.calls.length;done();await Promise.resolve();expect(send).toHaveBeenCalledTimes(count)
 }finally{views.clear()}
})

it('publishes desktop controls only for the refreshed original child, and retires late or replaced results', async () => {
 const link={sessionId:'parent',continuedInSessionId:'child',timestamp:'2026-11-04T00:00:00Z'}
 const job={id:'11111111',sessionId:'child',cwd:'/owned',pid:119,state:'working' as const}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:job.id,pid:119,processStart:'native-start'}
 let finish!:(target:typeof desktop)=>void, alive=true, notify!:()=>void
 const prepare=vi.fn(()=>new Promise<typeof desktop>(resolve=>{finish=resolve}))
 const send=vi.fn(), views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background:async()=>job,
  backgroundQuestion:()=>({id:'question-1',revision:'question-revision'}),desktop:prepare,desktopCurrent:()=>alive,subscribeBackground:(_key,changed)=>{notify=changed;return()=>{}}})
 const refresh={...mount,type:'CLAUDE_TERMINAL_BACKGROUND' as const,...link,revision:1,operation:'refresh' as const}
 try {
  views.handle(mount,'window-one',send);views.handle(refresh,'window-one',send)
  await vi.waitFor(()=>expect(prepare).toHaveBeenCalledOnce())
  expect(send.mock.calls.at(-1)![0].background).toMatchObject({status:'done',session:job})
  finish(desktop);await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background.desktop).toEqual(desktop))
  expect(send.mock.calls.at(-1)![0].background.question).toEqual({id:'question-1',revision:'question-revision'})
  alive=false;notify();expect(send.mock.calls.at(-1)![0].background.desktop).toBeUndefined()
  expect(send.mock.calls.at(-1)![0].background.question).toBeUndefined()
  views.handle({...refresh,revision:2},'window-one',send)
  await vi.waitFor(()=>expect(prepare).toHaveBeenCalledTimes(2))
  views.handle({...mount,type:'CLAUDE_TERMINAL_UNMOUNT'},'window-one',send)
  send.mockClear();finish(desktop);await new Promise(resolve=>setTimeout(resolve,0));expect(send).not.toHaveBeenCalled()
 }finally{views.clear()}
})


it('attaches the child desktop when native registration arrives after the initial status refresh', async () => {
 const link={sessionId:'parent',continuedInSessionId:'child',timestamp:'2026-11-04T00:00:00Z'}
 const job={id:'11111111',sessionId:'child',cwd:'/owned',pid:119,state:'working' as const}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:job.id,pid:119,processStart:'native-start'}
 let info: ClaudeBackgroundStatus|undefined,notify!:()=>void
 const prepare=vi.fn().mockRejectedValueOnce(Error('Background desktop worker changed; refresh its status')).mockResolvedValue(desktop)
 const send=vi.fn(),views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background:async()=>job,
  backgroundInfo:()=>info,desktop:prepare,desktopCurrent:()=>true,subscribeBackground:(_key,changed)=>{notify=changed;return()=>{}}})
 try {
  views.handle(mount,'window-one',send)
  views.handle({...mount,type:'CLAUDE_TERMINAL_BACKGROUND',...link,revision:1,operation:'refresh'},'window-one',send)
  await vi.waitFor(()=>expect(prepare).toHaveBeenCalledOnce());await new Promise(resolve=>setTimeout(resolve,0))
  expect(send.mock.calls.at(-1)![0].background.desktop).toBeUndefined()
  info={sessionId:'other-child',jobId:job.id,pid:119,observedAt:1,model:'fixture',turns:1,startedAt:1};notify();expect(prepare).toHaveBeenCalledOnce()
  info={sessionId:'child',jobId:job.id,pid:119,observedAt:2,model:'fixture',turns:1,startedAt:1};notify();notify()
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background.desktop).toEqual(desktop))
  expect(prepare).toHaveBeenCalledTimes(2)
  notify();expect(prepare).toHaveBeenCalledTimes(2)
 } finally {views.clear()}
})

it('refreshes a PID-less job once when its verified worker registers and ignores repeated status ticks', async () => {
 const link={sessionId:'parent',continuedInSessionId:'child',timestamp:'now'}
 const job={id:'11111111',sessionId:'child',cwd:'/owned',state:'working' as const}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:job.id,pid:119,processStart:'start'}
 let info:ClaudeBackgroundStatus|undefined, notify!:()=>void
 const background=vi.fn().mockResolvedValueOnce(job).mockResolvedValue({...job,pid:119})
 const prepare=vi.fn(async()=>desktop),send=vi.fn()
 const views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background,backgroundInfo:()=>info,desktop:prepare,desktopCurrent:()=>true,subscribeBackground:(_key,changed)=>{notify=changed;return()=>{}}})
 try {
  views.handle(mount,'window',send)
  views.handle({...mount,type:'CLAUDE_TERMINAL_BACKGROUND',...link,revision:1,operation:'refresh'},'window',send)
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.status).toBe('done'))
  expect(prepare).not.toHaveBeenCalled()
  info={jobId:job.id,sessionId:'child',pid:119,observedAt:1,model:'sonnet',turns:1,startedAt:1}
  notify();notify();notify()
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.desktop).toEqual(desktop))
  expect(background).toHaveBeenCalledTimes(2)
  expect(background).toHaveBeenLastCalledWith(link,{operation:'refresh'},'thread')
  expect(send.mock.calls.at(-1)![0].background.session.pid).toBe(119)
 } finally { views.clear() }
})

it('refreshes the original job when its question disappears and does not keep a settled waiting label', async () => {
 const link={sessionId:'parent',continuedInSessionId:'child',timestamp:'now'}
 const job={id:'11111111',sessionId:'child',cwd:'/owned',state:'blocked' as const,status:'waiting' as const,waitingFor:'input needed',pid:119}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:job.id,pid:119,processStart:'start'}
 let question:{id:string;revision:string}|undefined={id:'question',revision:'revision'}, notify!:()=>void
 const background=vi.fn().mockResolvedValueOnce(job).mockResolvedValue({...job,state:'working',status:'idle',waitingFor:undefined})
 const send=vi.fn(),views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background,desktop:async()=>desktop,desktopCurrent:()=>true,backgroundQuestion:()=>question,subscribeBackground:(_key,changed)=>{notify=changed;return()=>{}}})
 try {
  views.handle(mount,'window',send)
  views.handle({...mount,type:'CLAUDE_TERMINAL_BACKGROUND',...link,revision:1,operation:'refresh'},'window',send)
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.question).toEqual(question))
  question=undefined;notify();notify()
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.session.status).toBe('idle'))
  expect(send.mock.calls.at(-1)![0].background.session.waitingFor).toBeUndefined()
  expect(background).toHaveBeenCalledTimes(2)
 } finally {views.clear()}
})

it('keeps child turn interruption separate from job Stop and refuses stale identities',async()=>{
 const link={sessionId:'parent',continuedInSessionId:'child',timestamp:'2026-11-05T00:00:00Z'}
 const job={id:'11111111',sessionId:'child',cwd:'/owned',pid:119,state:'working' as const}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:job.id,pid:119,processStart:'start'}
 let turn={id:'turn-one',cancelled:false}
 const background=vi.fn(async(_link:unknown,_request:{operation:string},_thread:string)=>job),interrupt=vi.fn(async()=>{turn={...turn,cancelled:true}}),send=vi.fn()
 const views=createClaudeTerminalViews({get:()=>undefined,open:vi.fn(),continuation:()=>link,background,desktop:async()=>desktop,desktopCurrent:()=>true,backgroundTurn:()=>turn,interruptBackground:interrupt})
 try{
  views.handle(mount,'window',send);views.handle({...mount,type:'CLAUDE_TERMINAL_BACKGROUND',...link,revision:1,operation:'refresh'},'window',send)
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background?.turn).toEqual(turn))
  const request={...mount,type:'CLAUDE_TERMINAL_BACKGROUND' as const,...link,revision:2,operation:'interrupt' as const,target:desktop,turnId:'turn-one'}
  views.handle({...request,turnId:'old'},'window',send);views.handle({...request,target:{...desktop,processStart:'replacement'}},'window',send);views.handle(request,'foreign-window',send)
  expect(interrupt).not.toHaveBeenCalled();views.handle(request,'window',send)
  await vi.waitFor(()=>expect(send.mock.calls.at(-1)![0].background).toMatchObject({status:'done',operation:'interrupt',turn:{cancelled:true}}))
  expect(interrupt).toHaveBeenCalledExactlyOnceWith('thread',request)
  expect(background.mock.calls.every(([,request])=>request.operation==='refresh')).toBe(true)
  views.handle({...request,revision:3},'window',send);await Promise.resolve();expect(interrupt).toHaveBeenCalledOnce()
 }finally{views.clear()}
})


it('publishes Stop acknowledgement, deduplicates pending requests and permits identical-error retries', async () => {
  const f = fixture(); let reject!: (error: Error) => void
  vi.mocked(f.owner.close).mockImplementation(() => new Promise((_resolve, no) => { reject = no }))
  const request = { ...mount, type: 'CLAUDE_TERMINAL_CLOSE' as const, ownerId: f.owner.state.ownerId }
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(request, 'one', f.send); f.views.handle(request, 'one', f.send)
    expect(f.send.mock.calls.at(-1)![0].stop).toMatchObject({ ownerId: request.ownerId, revision: 1, status: 'pending' })
    await vi.waitFor(() => expect(f.owner.close).toHaveBeenCalledOnce())
    reject(new Error('Original close failure'))
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].stop).toMatchObject({ revision: 1, status: 'error', problem: 'Original close failure' }))
    f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(f.owner.close).toHaveBeenCalledTimes(2))
    reject(new Error('Original close failure'))
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].stop).toMatchObject({ revision: 2, status: 'error', problem: 'Original close failure' }))
  } finally { f.views.clear() }
})

it('does not publish a late Stop result after its window detaches', async () => {
  const f = fixture(); let finish!: () => void
  vi.mocked(f.owner.close).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_CLOSE', ownerId: f.owner.state.ownerId }, 'one', f.send)
    await vi.waitFor(() => expect(f.owner.close).toHaveBeenCalledOnce())
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    const count = f.send.mock.calls.length; finish(); await Promise.resolve(); await Promise.resolve()
    expect(f.send).toHaveBeenCalledTimes(count)
  } finally { f.views.clear() }
})

it('still carries out an accepted Stop when its requesting window immediately detaches', async () => {
  const f = fixture()
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_CLOSE', ownerId: f.owner.state.ownerId }, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_UNMOUNT' }, 'one', f.send)
    const count = f.send.mock.calls.length
    await vi.waitFor(() => expect(f.owner.close).toHaveBeenCalledOnce())
    expect(f.send).toHaveBeenCalledTimes(count)
  } finally { f.views.clear() }
})

it('validates credit commands and publishes each request acknowledgement without changing dialog identity',async()=>{
 const f=fixture()
 try{
  f.views.handle(mount,'one',f.send)
  const notice={id:'credit',revision:randomUUID(),sessionId:f.owner.state.sessionId,kind:'fable_overage_consent_prompt' as const,title:'Usage credits',paragraphs:[],snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'information' as const,revision:'a'.repeat(64),title:'Usage credits',description:'Loading…'}}}
  f.owner.state.notice=notice
  const response={id:notice.id,revision:notice.revision,sessionId:notice.sessionId,decision:'credit' as const,credit:{requestId:randomUUID(),operation:{kind:'read' as const}}}
  f.views.handle({...mount,type:'CLAUDE_TERMINAL_NOTICE',ownerId:f.owner.state.ownerId,notice:{...response,credit:{...response.credit,requestId:'invalid'}}},'one',f.send)
  expect(f.owner.answerNotice).not.toHaveBeenCalled()
  f.views.handle({...mount,type:'CLAUDE_TERMINAL_NOTICE',ownerId:f.owner.state.ownerId,notice:response},'one',f.send)
  expect(f.owner.answerNotice).toHaveBeenCalledExactlyOnceWith(response)
  await vi.waitFor(()=>expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({noticeAnswer:expect.objectContaining({id:notice.id,revision:notice.revision,requestId:response.credit.requestId,status:'done'})})))
 }finally{f.views.clear()}
})


it('forwards Send now only from the live window and with the current turn and queue revision', async () => {
  const f = fixture()
  try {
    const queueRevision = 'a'.repeat(64)
    const state = f.owner.state
    state.view = {kind: 'main', revision: 4}
    state.activeTurnId = 'live-turn'
    state.promptQueue = {revision: queueRevision, count: 1, items: [{id: randomUUID(), text: 'Waiting follow-up', editable: true, cancellable: true}]}
    f.views.handle(mount, 'one', f.send)
    const action = {...mount, type: 'CLAUDE_TERMINAL_QUEUE_SEND_NOW', ownerId: state.ownerId, sessionId: state.sessionId,
      viewRevision: 4, turnId: state.activeTurnId, queueRevision, sequence: 1} as const
    f.views.handle(action, 'other-window', f.send)
    f.views.handle({...action, queueRevision: 'b'.repeat(64)}, 'one', f.send)
    f.views.handle({...action, turnId: 'expired-turn'}, 'one', f.send)
    expect(f.owner.uiTransport.request).not.toHaveBeenCalled()

    f.views.handle(action, 'one', f.send)
    f.views.handle(action, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].queueOperation?.status).toBe('done'))
    f.views.handle(action, 'one', f.send)
    expect(f.owner.uiTransport.request).toHaveBeenCalledExactlyOnceWith({
      subtype: 'apack_main_queue_send_now', session_id: state.sessionId, view_revision: 4, turn_id: 'live-turn', queue_revision: queueRevision,
    })
  } finally { f.views.clear() }
})


it.each(['unmount', 'disconnect'])('recovers a selected queue edit after %s in the remaining composer only', async (detach) => {
  const f = fixture()
  try {
    const queueRevision = 'a'.repeat(64), first = randomUUID(), selected = randomUUID(), state = f.owner.state
    state.view = {kind: 'main', revision: 4}
    state.activeTurnId = 'live-turn'
    state.promptQueue = {revision: queueRevision, count: 2, items: [
      {id: first, text: 'Keep waiting', editable: true, cancellable: true},
      {id: selected, text: 'Return to the draft', editable: true, cancellable: true},
    ]}
    const firstMount = {...mount, queueComposer: true} as const
    const terminal = {...mount, mountId: randomUUID()}
    const second = {...firstMount, mountId: randomUUID()}
    const sendTerminal = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
    const sendSecond = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
    f.views.handle(firstMount, 'one', f.send)
    f.views.handle(terminal, 'two', sendTerminal)
    f.views.handle(second, 'two', sendSecond)
    let reply!: (value: unknown) => void
    const request = vi.mocked(f.owner.uiTransport.request)
    request.mockImplementation(() => new Promise(resolve => { reply = resolve }))
    const action = {...mount, type: 'EDIT_CLAUDE_QUEUED_PROMPT', ownerId: state.ownerId, sessionId: state.sessionId,
      viewRevision: 4, turnId: state.activeTurnId, queueRevision, sequence: 1, itemId: selected} as const
    const requester = new AbortController()
    f.views.handle({...action, itemId: randomUUID()}, 'one', f.send, requester.signal)
    f.views.handle({...action, mountId: terminal.mountId}, 'two', sendTerminal, requester.signal)
    const operation = f.views.handle(action, 'one', f.send, requester.signal)
    await Promise.resolve()
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({subtype: 'apack_main_queue_edit', item_id: selected}))
    if (detach === 'unmount') f.views.handle({...mount, type: 'CLAUDE_TERMINAL_UNMOUNT'}, 'one', f.send)
    else requester.abort()
    const images = detach === 'disconnect' ? [{mediaType: 'image/png', data: 'aW1hZ2U='}] : undefined
    reply({handled: true, restored: {id: selected, text: 'Return to the draft', images}})
    await operation
    expect(sendTerminal.mock.calls.every(([value]) => !value.queueDraft)).toBe(true)
    expect(f.send.mock.calls.every(([value]) => !value.queueDraft)).toBe(true)
    expect(sendSecond.mock.calls.at(-1)![0].queueDraft).toEqual({
      id: selected, sessionId: state.sessionId, text: 'Return to the draft', automatic: false, ...(images ? {images} : {}),
    })
    const ack = {...second, type: 'CLAUDE_TERMINAL_QUEUE_EDIT_APPLIED', ownerId: state.ownerId, sessionId: state.sessionId, itemId: selected} as const
    f.views.handle({...ack, itemId: first}, 'two', sendSecond)
    expect(sendSecond.mock.calls.at(-1)![0].queueDraft?.id).toBe(selected)
    f.views.handle(ack, 'two', sendSecond)
    expect(sendSecond.mock.calls.at(-1)![0].queueDraft).toBeUndefined()
  } finally { f.views.clear() }
})


it('requires an owned cancellable queue item and the matching native cancellation receipt', async () => {
  const f = fixture()
  try {
    const queueRevision = 'a'.repeat(64), eligible = randomUUID(), native = randomUUID(), state = f.owner.state
    state.view = {kind: 'main', revision: 4}
    state.activeTurnId = 'live-turn'
    state.promptQueue = {revision: queueRevision, count: 2, items: [
      {id: eligible, text: 'Desktop prompt', editable: true, cancellable: true},
      {id: native, text: 'Ordinary terminal prompt', editable: true, cancellable: false},
    ]}
    f.views.handle(mount, 'one', f.send)
    const action = {...mount, type: 'CLAUDE_TERMINAL_QUEUE_CANCEL', ownerId: state.ownerId, sessionId: state.sessionId,
      viewRevision: 4, turnId: state.activeTurnId, queueRevision, sequence: 1, itemId: eligible} as const
    const request = vi.mocked(f.owner.uiTransport.request)
    f.views.handle({...action, itemId: native}, 'one', f.send)
    f.views.handle({...action, queueRevision: 'b'.repeat(64)}, 'one', f.send)
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({handled: true, cancelled: native})
    f.views.handle(action, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].queueOperation?.status).toBe('error'))
    request.mockResolvedValueOnce({handled: true, cancelled: eligible})
    f.views.handle({...action, sequence: 2}, 'one', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].queueOperation?.status).toBe('done'))
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({subtype: 'apack_main_queue_cancel', item_id: eligible}))
  } finally { f.views.clear() }
})

it('owns only the teammate terminal client and retires it when the addressed task exits', async () => {
  const f = fixture(), { ownerId, sessionId } = f.owner.state
  const child = {
    snapshot: { id: randomUUID(), terminalSession: {id:'client',target:null}, jobId:'agent', sessionId, cwd:'/fixture', clientPid:234, status:'live' as const, output:[] },
    input: vi.fn(), resize: vi.fn(), subscribe: vi.fn(() => () => {}), close: vi.fn(async () => {}),
  }
  const open = vi.fn(async () => child)
  f.owner.openTeammateTerminal = open
  f.owner.state.tasks = [{ id:'agent', name:'Reviewer', status:'idle', canStop:true }]
  const request = { ...mount, type:'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId:'agent', revision:1 }
  try {
    f.views.handle(mount,'one',f.send)
    f.views.handle({...request,sessionId:randomUUID()},'one',f.send)
    f.views.handle({...request,taskId:'other'},'one',f.send)
    f.views.handle(request,'two',f.send)
    expect(open).not.toHaveBeenCalled()
    f.views.handle(request,'one',f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].attachment).toMatchObject({teammate:{ownerId,taskId:'agent'},status:'ready'}))
    expect(open).toHaveBeenCalledExactlyOnceWith('agent',expect.any(AbortSignal))
    f.owner.state.tasks = []
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)![0].attachment).toBeUndefined())
    expect(child.close).toHaveBeenCalledOnce()
    expect(f.owner.close).not.toHaveBeenCalled()
  } finally { f.views.clear() }
})

it('releases only the disconnected window’s teammate attachments, including an open in flight', async () => {
  const f = fixture(), { ownerId, sessionId } = f.owner.state
  const client = () => ({
    snapshot: { id: randomUUID(), terminalSession: { id: randomUUID(), target: null }, jobId: 'agent',
      sessionId, cwd: '/fixture', clientPid: 234, status: 'live' as const, output: [] },
    input: vi.fn(), resize: vi.fn(), subscribe: vi.fn(() => () => {}), close: vi.fn(async () => {}),
  })
  const active = client(), other = client(), late = client()
  let resolvePending!: (client: typeof late) => void
  const pending = new Promise<typeof late>(resolve => { resolvePending = resolve })
  const open = vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(other).mockReturnValueOnce(pending)
  f.owner.openTeammateTerminal = open
  f.owner.state.tasks = [{ id: 'agent', name: 'Reviewer', status: 'idle', canStop: true }]
  const request = { ...mount, type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId: 'agent', revision: 1 }
  const pendingMount = { ...mount, mountId: randomUUID() }
  const sendOther = vi.fn()
  try {
    f.views.handle(mount, 'closed', f.send)
    f.views.handle(request, 'closed', f.send)
    f.views.handle(mount, 'remaining', sendOther)
    f.views.handle(request, 'remaining', sendOther)
    f.views.handle(pendingMount, 'closed', f.send)
    f.views.handle({ ...request, mountId: pendingMount.mountId }, 'closed', f.send)
    await vi.waitFor(() => {
      expect(sendOther).toHaveBeenLastCalledWith(expect.objectContaining({
        attachment: expect.objectContaining({ state: other.snapshot, status: 'ready' }),
      }))
      expect(f.send).toHaveBeenCalledWith(expect.objectContaining({
        attachment: expect.objectContaining({ state: active.snapshot, status: 'ready' }),
      }))
      expect(open).toHaveBeenCalledTimes(3)
    })
    const [, signal] = open.mock.calls[2]!
    const closedUpdates = f.send.mock.calls.length

    f.views.disconnect('closed')
    expect(signal.aborted).toBe(true)
    expect(active.close).toHaveBeenCalledOnce()
    resolvePending(late)
    await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce())

    expect(f.send).toHaveBeenCalledTimes(closedUpdates)
    expect(other.close).not.toHaveBeenCalled()
    f.views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_INPUT', attachmentId: other.snapshot.id, text: 'still here' }, 'remaining', sendOther)
    expect(other.input).toHaveBeenCalledExactlyOnceWith(other.snapshot.id, 'still here')
    expect(f.owner.close).not.toHaveBeenCalled()
  } finally { f.views.clear() }
})

it.each(['crash', 'clean stop', 'session reset'] as const)('scopes an attached teammate across %s', async exit => {
  const f = fixture(), { ownerId, sessionId } = f.owner.state
  const parent = { ...f.owner, keepAttachedTeammatesAfterCrash: false }
  f.setCurrent(parent)
  parent.state.tasks = [{ id: 'agent', name: 'Reviewer', status: 'idle', canStop: true }]
  const child = {
    snapshot: { id: randomUUID(), terminalSession: { id: 'broker-client', target: null }, jobId: 'agent',
      sessionId, cwd: '/fixture', clientPid: 234, status: 'live' as const, output: [] },
    input: vi.fn(), resize: vi.fn(), subscribe: vi.fn(() => () => {}), close: vi.fn(async () => {}),
  }
  const open = vi.fn(async () => child)
  parent.openTeammateTerminal = open
  const request = { ...mount, type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId: 'agent', revision: 1 }
  try {
    f.views.handle(mount, 'teammate-window', f.send)
    f.views.handle(request, 'teammate-window', f.send)
    await vi.waitFor(() => expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      attachment: expect.objectContaining({ state: child.snapshot, status: 'ready' }),
    })))
    parent.state.tasks = []
    if (exit === 'crash') {
      parent.keepAttachedTeammatesAfterCrash = true
      parent.state.status = 'error'
      f.setCurrent()
    } else if (exit === 'clean stop') {
      parent.state.status = 'exited'
      f.setCurrent()
    } else {
      parent.state.sessionId = randomUUID()
    }
    for (const notify of f.listeners) notify()
    await Promise.resolve()

    if (exit === 'crash') {
      expect(child.close).not.toHaveBeenCalled()
      f.views.handle({ ...request, revision: 2 }, 'teammate-window', f.send)
      expect(open).toHaveBeenCalledOnce()
      f.views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_INPUT', attachmentId: child.snapshot.id, text: 'still connected' }, 'teammate-window', f.send)
      expect(child.input).toHaveBeenCalledExactlyOnceWith(child.snapshot.id, 'still connected')
      const replacement = { ...f.owner, state: { ...f.owner.state, status: 'live' as const, ownerId: randomUUID() } }
      f.setCurrent(replacement)
      f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_OPEN' }, 'parent-window', vi.fn())
      expect(child.close).not.toHaveBeenCalled()
      f.views.handle(mount, 'parent-window', vi.fn())
    }

    expect(child.close).toHaveBeenCalledOnce()
    expect(f.send.mock.calls.at(-1)?.[0].attachment).toBeUndefined()
    f.views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_INPUT', attachmentId: child.snapshot.id, text: 'stale' }, 'teammate-window', f.send)
    expect(child.input).not.toHaveBeenCalledWith(child.snapshot.id, 'stale')
    expect(parent.close).not.toHaveBeenCalled()
  } finally { f.views.clear() }
})

it('reconnects only the verified teammate after its parent crashes and the original client closes', async () => {
  const f = fixture(), {ownerId, sessionId} = f.owner.state
  const parent = {...f.owner, keepAttachedTeammatesAfterCrash: false}
  f.setCurrent(parent)
  parent.state.tasks = [{id:'agent', name:'Reviewer', status:'idle', canStop:true}]
  const client = () => ({
    snapshot: {id:randomUUID(), terminalSession:{id:randomUUID(), target:null}, jobId:'agent',
      sessionId, cwd:'/fixture', clientPid:234, status:'live' as const, output:[]},
    input:vi.fn(), resize:vi.fn(), subscribe:vi.fn(() => () => {}), close:vi.fn(async () => {}),
  })
  const original = client(), replacement = client()
  const reconnect = vi.fn(async (_signal: AbortSignal) => replacement)
  const open = vi.fn(async () => ({...original, reconnect}))
  parent.openTeammateTerminal = open
  const request = {...mount, type:'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId:'agent', revision:1}
  const latest = () => f.send.mock.calls.at(-1)![0]
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle(mount, 'another', vi.fn())
    f.views.handle(request, 'one', f.send)
    await vi.waitFor(() => expect(latest().attachment?.status).toBe('ready'))
    expect(latest().teammateReconnects).toBeUndefined()
    parent.keepAttachedTeammatesAfterCrash = true
    parent.state.status = 'error'
    parent.state.tasks = []
    f.setCurrent()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(latest().teammateReconnects).toEqual([{ownerId, sessionId, taskId:'agent', name:'Reviewer'}]))

    f.views.handle({...mount, type:'CLAUDE_BACKGROUND_CLOSE', requestId:latest().attachment!.requestId}, 'one', f.send)
    expect(original.close).toHaveBeenCalledOnce()
    f.views.handle({...request, revision:2}, 'another', vi.fn())
    f.views.handle({...request, revision:2, taskId:'unverified'}, 'one', f.send)
    f.views.handle(request, 'one', f.send)
    await Promise.resolve()
    expect(reconnect).not.toHaveBeenCalled()

    f.views.handle({...request, revision:2}, 'one', f.send)
    await vi.waitFor(() => expect(latest().attachment?.state?.id).toBe(replacement.snapshot.id))
    expect(open).toHaveBeenCalledOnce()
    expect(reconnect).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
    f.views.handle({...mount, type:'CLAUDE_BACKGROUND_INPUT', attachmentId:original.snapshot.id, text:'old'}, 'one', f.send)
    f.views.handle({...mount, type:'CLAUDE_BACKGROUND_INPUT', attachmentId:replacement.snapshot.id, text:'fresh'}, 'one', f.send)
    expect(original.input).not.toHaveBeenCalled()
    expect(replacement.input).toHaveBeenCalledExactlyOnceWith(replacement.snapshot.id, 'fresh')

    f.setCurrent({...f.owner, state:{...f.owner.state, status:'live', ownerId:randomUUID()}})
    f.views.handle(mount, 'another', vi.fn())
    expect(latest().teammateReconnects).toBeUndefined()
    expect(latest().attachment).toBeUndefined()
    expect(replacement.close).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})


it('hands off a verified teammate reconnect when its detached window closes', async () => {
  const f = fixture(), {ownerId, sessionId} = f.owner.state
  const parent = {...f.owner, keepAttachedTeammatesAfterCrash:false}
  f.setCurrent(parent)
  parent.state.tasks = [{id:'agent', name:'Reviewer', status:'idle', canStop:true}]
  const child = () => ({
    snapshot: {id:randomUUID(), terminalSession:{id:randomUUID(), target:null}, jobId:'agent',
      sessionId, cwd:'/fixture', clientPid:234, status:'live' as const, output:[]},
    input:vi.fn(), resize:vi.fn(), subscribe:vi.fn(() => () => {}), close:vi.fn(async () => {}),
  })
  const original = child(), renewed = child()
  const reconnect = vi.fn(async (_signal: AbortSignal) => renewed)
  parent.openTeammateTerminal = vi.fn(async () => ({...original, reconnect}))
  const request = {...mount, type:'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId:'agent', revision:1}
  const main = vi.fn<(state: ClaudeTerminalViewReply) => void>(), other = vi.fn()
  try {
    f.views.handle(mount, 'popout', f.send)
    f.views.handle({...mount, threadId:'unrelated'}, 'foreign', other)
    f.views.handle(mount, 'main', main)
    f.views.handle(request, 'popout', f.send)
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].attachment?.status).toBe('ready'))
    parent.keepAttachedTeammatesAfterCrash = true
    parent.state.status = 'error'
    parent.state.tasks = []
    f.setCurrent()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].teammateReconnects?.[0]?.taskId).toBe('agent'))
    expect(main.mock.calls.at(-1)?.[0].teammateReconnects).toBeUndefined()
    f.views.disconnect('popout')
    expect(original.close).toHaveBeenCalledOnce()
    expect(main.mock.calls.at(-1)?.[0].teammateReconnects?.[0]?.taskId).toBe('agent')
    expect(other.mock.calls.at(-1)?.[0].teammateReconnects).toBeUndefined()

    f.views.handle({...request, revision:2}, 'popout', f.send)
    f.views.handle(request, 'main', main)
    await vi.waitFor(() => expect(main.mock.calls.at(-1)?.[0].attachment?.state?.id).toBe(renewed.snapshot.id))
    expect(reconnect).toHaveBeenCalledOnce()

    f.views.clear(mount.threadId)
    expect(renewed.close).toHaveBeenCalledOnce()
    f.views.handle(mount, 'new-window', main)
    expect(main.mock.calls.at(-1)?.[0].teammateReconnects).toBeUndefined()
  } finally { f.views.clear() }
})

it('opens the earlier teammate separately after same-session resume and retires it on reset', async () => {
  const f = fixture(), {ownerId, sessionId} = f.owner.state
  const parent = {...f.owner, keepAttachedTeammatesAfterCrash:false}
  f.setCurrent(parent)
  parent.state.tasks = [{id:'agent', name:'Reviewer', status:'idle', canStop:true}]
  const child = () => ({
    snapshot: {id:randomUUID(), terminalSession:{id:randomUUID(), target:null}, jobId:'agent',
      sessionId, cwd:'/fixture', clientPid:234, status:'live' as const, output:[]},
    input:vi.fn(), resize:vi.fn(), subscribe:vi.fn(() => () => {}), close:vi.fn(async () => {}),
  })
  const old = child(), recovered = child()
  const reconnect = vi.fn(async (_signal: AbortSignal) => recovered)
  parent.openTeammateTerminal = vi.fn(async () => ({...old, reconnect}))
  const request = {...mount, type:'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId:'agent', revision:1}
  const latest = () => f.send.mock.calls.at(-1)?.[0]
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle(request, 'window', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.status).toBe('ready'))
    parent.keepAttachedTeammatesAfterCrash = true
    parent.state.status = 'error'
    parent.state.tasks = []
    f.setCurrent()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(latest()?.teammateReconnects?.[0]?.taskId).toBe('agent'))

    const resumed = {...f.owner, state:{...parent.state, ownerId:randomUUID(), status:'live' as const, tasks:[]}}
    f.setCurrent(resumed)
    f.views.handle({...mount, mountId:randomUUID(), queueComposer:true}, 'window', vi.fn())
    f.views.handle(mount, 'window', f.send)
    expect(old.close).toHaveBeenCalledOnce()
    expect(latest()?.state?.tasks).toEqual([])
    const recoveryId = latest()?.teammateReconnects?.[0]?.recoveryId
    expect(recoveryId).toBeTruthy()
    f.views.handle({...request, revision:2}, 'window', f.send)
    f.views.handle({...request, revision:2, recoveryId:randomUUID()}, 'window', f.send)
    f.views.handle({...request, revision:2, recoveryId}, 'other-window', f.send)
    await Promise.resolve()
    expect(reconnect).not.toHaveBeenCalled()

    f.views.handle({...request, revision:2, recoveryId}, 'window', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.state?.id).toBe(recovered.snapshot.id))
    expect(reconnect).toHaveBeenCalledOnce()
    f.views.handle({...mount, type:'CLAUDE_BACKGROUND_INPUT', attachmentId:recovered.snapshot.id, text:'still the old worker'}, 'window', f.send)
    expect(recovered.input).toHaveBeenCalledExactlyOnceWith(recovered.snapshot.id, 'still the old worker')
    expect(resumed.operateTask).not.toHaveBeenCalled()

    resumed.state.sessionId = randomUUID()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(latest()?.attachment).toBeUndefined())
    expect(latest()?.teammateReconnects).toBeUndefined()
    expect(recovered.close).toHaveBeenCalledOnce()
  } finally { f.views.clear() }
})

it('restores a verified reconnect on a fresh mount after every matching window closes', async () => {
  const f = fixture(), {ownerId, sessionId} = f.owner.state
  const parent = {...f.owner, keepAttachedTeammatesAfterCrash:false}
  f.setCurrent(parent)
  parent.state.tasks = [{id:'agent', name:'Reviewer', status:'idle', canStop:true}]
  const child = () => ({
    snapshot:{id:randomUUID(), terminalSession:{id:randomUUID(),target:null}, jobId:'agent',
      sessionId, cwd:'/fixture', clientPid:234, status:'live' as const, output:[]},
    input:vi.fn(), resize:vi.fn(), subscribe:vi.fn(() => () => {}), close:vi.fn(async () => {}),
  })
  const first = child(), fresh = child()
  const reconnect = vi.fn(async (_signal: AbortSignal) => fresh)
  parent.openTeammateTerminal = vi.fn(async () => ({...first, reconnect, canReconnect:async () => true}))
  const request = {...mount, type:'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId:'agent', revision:1}
  const resumedMount = {...mount, mountId:randomUUID()}
  const latest = () => f.send.mock.calls.at(-1)?.[0]
  try {
    f.views.handle(mount, 'closed', f.send)
    f.views.handle(request, 'closed', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.status).toBe('ready'))
    parent.keepAttachedTeammatesAfterCrash = true
    parent.state.status = 'error'
    parent.state.tasks = []
    f.setCurrent()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(latest()?.teammateReconnects?.[0]?.taskId).toBe('agent'))
    f.views.disconnect('closed')
    expect(first.close).toHaveBeenCalledOnce()
    expect(f.listeners.size).toBe(0)

    f.views.handle(request, 'closed', f.send)
    f.views.handle({...resumedMount, mountId:randomUUID(), threadId:'other-thread'}, 'fresh', f.send)
    expect(latest()?.teammateReconnects).toBeUndefined()
    f.views.handle({...resumedMount, mountId:randomUUID(), queueComposer:true}, 'fresh', f.send)
    expect(latest()?.teammateReconnects).toBeUndefined()
    f.views.handle(resumedMount, 'fresh', f.send)
    expect(latest()?.teammateReconnects).toMatchObject([{ownerId, sessionId, taskId:'agent'}])
    f.views.handle({...request, mountId:resumedMount.mountId}, 'fresh', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.state?.id).toBe(fresh.snapshot.id))
    expect(reconnect).toHaveBeenCalledOnce()

    f.views.disconnect('fresh')
    f.views.clear(mount.threadId)
    f.views.handle(resumedMount, 'after-reset', f.send)
    expect(latest()?.teammateReconnects).toBeUndefined()
  } finally { f.views.clear() }
})


it('recovers two verified teammates after all windows close and keeps each resumed action distinct', async () => {
  const f = fixture(), { ownerId, sessionId } = f.owner.state
  const tasks = ['reviewer', 'editor']
  const parent = { ...f.owner, keepAttachedTeammatesAfterCrash: false }
  parent.state.tasks = tasks.map(id => ({ id, name: id, status: 'idle', canStop: true }))
  f.setCurrent(parent)
  const child = (jobId: string) => ({
    snapshot: { id: randomUUID(), terminalSession: { id: randomUUID(), target: null }, jobId,
      sessionId, cwd: '/fixture', clientPid: 234, status: 'live' as const, output: [] },
    input: vi.fn(), resize: vi.fn(), subscribe: vi.fn(() => () => {}), close: vi.fn(async () => {}),
  })
  const original = new Map(tasks.map(id => [id, child(id)]))
  const recovered = new Map(tasks.map(id => [id, child(id)]))
  const reconnect = vi.fn(async (id: string) => recovered.get(id)!)
  parent.openTeammateTerminal = vi.fn(async id => ({ ...original.get(id)!, reconnect: () => reconnect(id), canReconnect: async () => true }))
  const open = (id: string, revision: number) => ({ ...mount, type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ownerId, sessionId, taskId: id, revision })
  const send = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
  const latest = () => send.mock.lastCall?.[0]
  try {
    for (const id of tasks) {
      f.views.handle(mount, id, send)
      f.views.handle(open(id, 1), id, send)
      await vi.waitFor(() => expect(latest()?.attachment?.state?.jobId).toBe(id))
    }
    parent.keepAttachedTeammatesAfterCrash = true
    parent.state.status = 'error'
    parent.state.tasks = []
    f.setCurrent()
    for (const notify of f.listeners) notify()
    await vi.waitFor(() => expect(latest()?.teammateReconnects).toHaveLength(1))
    for (const id of tasks) f.views.disconnect(id)
    for (const client of original.values()) expect(client.close).toHaveBeenCalledOnce()

    f.views.handle(mount, 'new', send)
    expect(latest()?.teammateReconnects?.map(target => target.taskId).sort()).toEqual([...tasks].sort())
    const resumed = { ...f.owner, state: { ...parent.state, ownerId: randomUUID(), status: 'live' as const, tasks: [] } }
    f.setCurrent(resumed)
    f.views.handle(mount, 'new', send)
    const offers = new Map(latest()?.teammateReconnects?.map(target => [target.taskId, target.recoveryId]))
    expect(offers.size).toBe(2)
    expect(new Set(offers.values()).size).toBe(2)
    const ids = tasks.map(id => offers.get(id))
    expect(ids.every(Boolean)).toBe(true)
    f.views.handle({ ...open(tasks[0], 1), recoveryId: ids[1] }, 'new', send)
    expect(latest()?.attachment).toBeUndefined()
    for (const [index, id] of tasks.entries()) {
      f.views.handle({ ...open(id, index + 1), recoveryId: ids[index] }, 'new', send)
      await vi.waitFor(() => expect(latest()?.attachment?.state?.jobId).toBe(id))
      f.views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_INPUT', attachmentId: recovered.get(id)!.snapshot.id, text: id }, 'new', send)
      expect(recovered.get(id)!.input).toHaveBeenCalledExactlyOnceWith(recovered.get(id)!.snapshot.id, id)
      f.views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_CLOSE', requestId: latest()!.attachment!.requestId }, 'new', send)
    }
    expect(reconnect.mock.calls.flat()).toEqual(tasks)
    expect(resumed.operateTask).not.toHaveBeenCalled()
    f.views.disconnect('new')
    f.views.handle(mount, 'second-remount', send)
    expect(latest()?.teammateReconnects).toHaveLength(2)
    expect(latest()?.teammateReconnects?.every(target => target.recoveryId && target.recoveryId !== offers.get(target.taskId))).toBe(true)
  } finally { f.views.clear() }
})


it('restores a verified sleeping backend checkpoint only for the saved conversation', async () => {
  const f = fixture(), sessionId = f.owner.state.sessionId, taskId = 'restored-worker'
  const target = { ownerId: randomUUID(), sessionId, taskId, name: 'Reviewer' }
  const input = vi.fn()
  const close = vi.fn(async () => {})
  const reopened = {
    snapshot: { id: randomUUID(), terminalSession: { id: randomUUID(), target: null }, jobId: taskId,
      sessionId, cwd: '/fixture', clientPid: 234, status: 'live' as const, output: [] },
    input, resize: vi.fn(), subscribe: vi.fn(() => () => {}), close,
  }
  const open = vi.fn(async () => reopened)
  let saved = sessionId
  let owner: ClaudeNativeTerminalOwner | undefined
  const views = createClaudeTerminalViews({ get: () => owner, open: f.open, savedSession: () => saved,
    loadTeammateRecovery: async () => [{ target, open }] })
  const latest = () => f.send.mock.lastCall?.[0]
  try {
    views.handle(mount, 'restart', f.send)
    await vi.waitFor(() => expect(latest()?.teammateReconnects).toHaveLength(1))
    const recoveryId = latest()?.teammateReconnects?.[0]?.recoveryId
    expect(recoveryId).toBeTruthy()
    const request = { ...mount, type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const, ...target, recoveryId, revision: 1 }
    views.handle(request, 'incorrect-window', f.send)
    views.handle({ ...request, sessionId: randomUUID() }, 'restart', f.send)
    expect(open).not.toHaveBeenCalled()
    views.handle(request, 'restart', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.state?.id).toBe(reopened.snapshot.id))
    views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_INPUT', attachmentId: reopened.snapshot.id, text: 'worker draft' }, 'restart', f.send)
    expect(input).toHaveBeenCalledExactlyOnceWith(reopened.snapshot.id, 'worker draft')
    owner = f.owner
    views.handle(mount, 'restart', f.send)
    expect(close).toHaveBeenCalledOnce()
    expect(latest()?.teammateReconnects?.[0]?.recoveryId).not.toBe(recoveryId)
    saved = owner.state.sessionId = randomUUID()
    views.handle(mount, 'restart', f.send)
    expect(latest()?.teammateReconnects).toBeUndefined()
  } finally { views.clear() }
})


it('retires a confirmed ended checkpoint in every window but keeps a temporarily unavailable offer', async () => {
  const f = fixture(), { ownerId, sessionId } = f.owner.state
  const first = vi.fn(async () => { throw new ClaudeTeammateEnded() })
  const second = vi.fn(async () => { throw Error('The original teammate pane is unavailable') })
  const target = (taskId: string) => ({ ownerId, sessionId, taskId, name: taskId })
  const views = createClaudeTerminalViews({
    get: () => undefined, open: f.open, savedSession: () => sessionId,
    loadTeammateRecovery: async () => [
      { target: target('ended'), open: first },
      { target: target('inactive'), open: second },
    ],
  })
  const other = { ...mount, mountId: randomUUID() }
  const sendOther = vi.fn<(reply: ClaudeTerminalViewReply) => void>()
  const latest = () => f.send.mock.lastCall?.[0]
  const latestOther = () => sendOther.mock.lastCall?.[0]
  try {
    views.handle(mount, 'first', f.send)
    views.handle(other, 'other', sendOther)
    await vi.waitFor(() => expect(latest()?.teammateReconnects).toHaveLength(2))
    await vi.waitFor(() => expect(latestOther()?.teammateReconnects).toHaveLength(2))
    const open = (reply: ClaudeTerminalViewReply, taskId: string, revision: number) => ({
      threadId: reply.threadId, mountId: reply.mountId, type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN' as const,
      ...target(taskId), recoveryId: reply.teammateReconnects!.find(offer => offer.taskId === taskId)!.recoveryId, revision,
    })
    const close = () => views.handle({ ...mount, type: 'CLAUDE_BACKGROUND_CLOSE', requestId: latest()!.attachment!.requestId }, 'first', f.send)
    const replay = open(latestOther()!, 'ended', 1)

    views.handle(open(latest()!, 'inactive', 1), 'first', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.problem).toBe('The original teammate pane is unavailable'))
    close()
    expect(latest()?.teammateReconnects).toHaveLength(2)

    views.handle(open(latest()!, 'ended', 2), 'first', f.send)
    await vi.waitFor(() => expect(latest()?.attachment?.problem).toBe('The native teammate process ended'))
    expect(latest()?.teammateReconnects?.map(offer => offer.taskId)).toEqual(['inactive'])
    expect(latestOther()?.teammateReconnects?.map(offer => offer.taskId)).toEqual(['inactive'])
    views.handle(replay, 'other', sendOther)
    expect(latestOther()?.attachment).toBeUndefined()
    expect(first).toHaveBeenCalledOnce()
    close()
    expect(latest()?.attachment).toBeUndefined()
    expect(latest()?.teammateReconnects?.map(offer => offer.taskId)).toEqual(['inactive'])
  } finally { views.clear() }
})
