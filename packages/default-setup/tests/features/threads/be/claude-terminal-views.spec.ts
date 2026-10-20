import { randomUUID } from 'node:crypto'
import { createClaudeTerminalViews, type ClaudeTerminalViewReply } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
const mount = { type: 'CLAUDE_TERMINAL_MOUNT', threadId: 'thread', mountId: randomUUID() } as const
function fixture(prepareInput?: Parameters<typeof createClaudeTerminalViews>[0]['prepareInput'], beforeViewChange?: Parameters<typeof createClaudeTerminalViews>[0]['beforeViewChange'], command?: Parameters<typeof createClaudeTerminalViews>[0]['command']) {
  const listeners = new Set<() => void>()
  const output = [{ sequence: 1, text: 'native\r\n' }]
  const owner = { state: { ownerId: randomUUID(), sessionId: randomUUID(), cwd: '/fixture', status: 'live', tasks: [] }, output,
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    answerNotice: vi.fn(async () => {}),
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

it('persists accepted reference identity after the submitting view detaches', async () => {
  const f = fixture(async text => ({ text, images: [] }))
  let finish!: (receipt: { sessionId: string; uuid: string; text: string }) => void
  vi.mocked(f.owner.submit).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const references = { files: [{ name: 'example.ts', path: '/project/example.ts', typeLabel: 'TypeScript', isImage: false }] }
  try {
    f.views.handle(mount, 'one', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, revision: 1, text: '', references }, 'one', f.send)
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
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, taskId: 'agent-a', revision: 1, operation: 'stop' } as const
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

it.each(['send', 'input'] as const)('admits only bounded %s task input through the current lease and exact native receipt', async operation => {
  const f = fixture(); f.owner.state.tasks.push({ id: 'agent-a', name: 'worker', status: 'running' })
  const input = { messageId: randomUUID(), mode: 'queued' as const }
  vi.mocked(f.owner.operateTask).mockResolvedValue(operation === 'input' ? { input } : { sent: true })
  const request = { ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, taskId: 'agent-a', revision: 1, operation, text: 'Keep working on this instruction' } as const
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
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_TASK', ownerId: f.owner.state.ownerId, taskId: 'agent', revision: 1, operation: 'foreground' }, 'window', f.send)
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('window', 'thread'))
    expect(f.owner.operateTask).not.toHaveBeenCalled()
    if (replacement) f.setCurrent(undefined)
    finish()
    if (replacement) { await new Promise(resolve => setTimeout(resolve, 0)); expect(f.owner.operateTask).not.toHaveBeenCalled() }
    else await vi.waitFor(() => expect(f.send.mock.calls.at(-1)?.[0].task).toMatchObject({ status: 'done', operation: 'foreground', view: { taskId: 'agent' } }))
  } finally { f.views.clear() }
})

it('returns the submitting window native command outcome without a fabricated human receipt', async () => {
  const command = vi.fn(async () => ({ kind: 'command_complete' as const, commandName: 'clear', messageId: randomUUID(), sessionId: randomUUID() }))
  const f = fixture(undefined, undefined, command)
  try {
    f.views.handle(mount, 'window', f.send)
    f.views.handle({ ...mount, type: 'CLAUDE_TERMINAL_SUBMIT', ownerId: f.owner.state.ownerId, revision: 1, text: '/clear' }, 'window', f.send)
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
