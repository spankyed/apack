import { PassThrough } from 'node:stream'
import { runThreadTeardown } from '#features/threads/be/thread-teardown.ts'
import { storeHandle, clearHandle, openConversation, getNativeLaunch, openNativeTerminal, getNativeTerminal, getConversation, isConversationBusy, killAllHandles } from '#features/code/be/services/claude-code/handle-store.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
const mocks = { prepare: vi.fn() }
const session = '11111111-1111-1111-1111-111111111111'
async function printOwner() {
  const events = new PassThrough({ objectMode: true })
  const handle = { events, close: vi.fn(async () => { events.end() }), kill: vi.fn(() => events.end()), getPermissionMode: vi.fn(async () => 'plan'), getSettings: vi.fn(async () => ({ effective: {}, sources: [] })) } as unknown as QueryHandle
  const owner = await openConversation('thread', JSON.stringify({ cwd: '/fixture', model: 'native-model', worktree: false }), async () => handle, async () => {})
  events.write({ type: 'system', subtype: 'init', session_id: session, cwd: '/native-cwd' })
  await vi.waitFor(() => expect(owner.sessionId).toBe(session))
  return { handle, owner }
}
function terminal() {
  let resolve!: () => void
  const done = new Promise<void>(yes => { resolve = yes })
  return { uiTransport: { promptHosts: { register: () => () => {}, answers: () => [], detach() {} }, request: vi.fn(async () => { throw new Error('UI is not used in the handoff fixture') }), subscribe: () => () => {} }, state: { ownerId: 'terminal-owner', sessionId: session, cwd: '/native-cwd', status: 'live', busy: false, tasks: [] }, busy: false, output: [], records: [], readJournal: vi.fn(async () => ({ entries: [], pending: false, problems: [] })), beforeRelease: vi.fn(), done,
    holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getPlanDialogs: vi.fn(async () => []), answerPlanDialog: vi.fn(async () => {}), getBashDialogs: vi.fn(async () => []), answerBashDialog: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getFileDialogs: vi.fn(async () => []), answerFileDialog: vi.fn(async () => {}), controlMcpServer: vi.fn(async () => ({mcpServers:[]})), operateTask: vi.fn(async () => ({ stopped: true })), getMcpStatus: vi.fn(async () => ({mcpServers:[]})), getModels: vi.fn(async () => ({ models: [] })), renameSession: vi.fn(async (title: string) => ({ title, message: 'Renamed' })), setModel: vi.fn(async (model: string) => model), setPermissionMode: vi.fn(async (mode: Parameters<ClaudeNativeTerminalOwner['setPermissionMode']>[0]) => mode), kill: vi.fn(resolve), close: vi.fn(async () => resolve()), subscribe: vi.fn(() => () => {}), input: vi.fn(() => true), resize: vi.fn(() => true), submit: vi.fn(async () => ({ sessionId: '11111111-1111-1111-1111-111111111111', uuid: '22222222-2222-2222-2222-222222222222', text: 'Draft' })) } satisfies ClaudeNativeTerminalOwner
}
afterEach(async () => { killAllHandles(); mocks.prepare.mockReset(); await Promise.resolve() })
it('prepares before close, starts after print exit, and refuses a second owner', async () => {
  const first = await printOwner(), native = terminal()
  const prepared = { start: vi.fn(async () => { await first.owner.done; expect(first.handle.close).toHaveBeenCalledOnce(); return native }), dispose: vi.fn(async () => {}) }
  mocks.prepare.mockImplementation(async () => { expect(first.handle.close).not.toHaveBeenCalled(); return prepared })
  expect(await openNativeTerminal('thread', { cliPath: '/native' }, mocks.prepare)).toBe(native)
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/native-cwd', sessionId: session, model: 'native-model', permissionMode: 'plan' }))
  expect(getConversation('thread')).toBeUndefined(); expect(getNativeTerminal('thread')).toBe(native)
  await expect(openConversation('thread', 'other', async () => first.handle, async () => {})).rejects.toThrow('already exists')
  expect(() => storeHandle('thread', first.handle)).toThrow('Native terminal owns')
  expect(first.handle.kill).toHaveBeenCalledOnce()
  clearHandle('thread'); expect(getNativeTerminal('thread')).toBe(native)
  runThreadTeardown('thread'); expect(native.kill).toHaveBeenCalledOnce(); expect(getNativeTerminal('thread')).toBeUndefined()
})
it('keeps the print process available when preparation fails', async () => {
  const first = await printOwner()
  mocks.prepare.mockRejectedValueOnce(new Error('Configuration cannot be wrapped'))
  await expect(openNativeTerminal('thread', {}, mocks.prepare)).rejects.toThrow('cannot be wrapped')
  expect(first.handle.close).not.toHaveBeenCalled(); expect(first.handle.kill).not.toHaveBeenCalled()
  expect(getConversation('thread')?.owner).toBe(first.owner); expect(isConversationBusy('thread')).toBe(false)
})
it('cancels a handoff waiting for native settings without starting a terminal', async () => {
  const first = await printOwner()
  let resolve!: (value: { effective: {}; sources: [] }) => void
  vi.mocked(first.handle.getSettings).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  const pending = openNativeTerminal('thread', {}, mocks.prepare), rejected = expect(pending).rejects.toThrow('cancelled')
  expect(isConversationBusy('thread')).toBe(true); expect(getConversation('thread')).toBeUndefined()
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  runThreadTeardown('thread'); resolve({ effective: {}, sources: [] }); await rejected
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(getNativeTerminal('thread')).toBeUndefined()
})
it('retires a late-created terminal when teardown wins during startup', async () => {
  await printOwner(); const native = terminal()
  let resolve!: (value: ClaudeNativeTerminalOwner) => void
  const prepared = { start: vi.fn(() => new Promise<ClaudeNativeTerminalOwner>(yes => { resolve = yes })), dispose: vi.fn(async () => {}) }
  mocks.prepare.mockResolvedValueOnce(prepared)
  const pending = openNativeTerminal('thread', {}, mocks.prepare), rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(prepared.start).toHaveBeenCalledOnce())
  runThreadTeardown('thread'); resolve(native); await rejected
  expect(native.kill).toHaveBeenCalledOnce(); expect(prepared.dispose).toHaveBeenCalledOnce(); expect(getNativeTerminal('thread')).toBeUndefined()
})

it('drains the detached native owner before a replacement print process can spawn', async () => {
  await printOwner(); const native = terminal()
  native.kill.mockImplementation(() => {})
  mocks.prepare.mockResolvedValueOnce({start:vi.fn(async()=>native),dispose:vi.fn(async()=>{})})
  await openNativeTerminal('thread',{},mocks.prepare)
  runThreadTeardown('thread')
  const events = new PassThrough({objectMode:true})
  const handle = {events,close:vi.fn(async()=>{events.end()}),kill:vi.fn(()=>events.end())} as unknown as QueryHandle
  const spawn = vi.fn(async()=>handle)
  const replacement = openConversation('thread','replacement',spawn,async()=>{})
  await Promise.resolve();expect(spawn).not.toHaveBeenCalled()
  await native.close();const owner = await replacement
  expect(spawn).toHaveBeenCalledOnce();await owner.close()
})


it('reopens a stopped native session only after fresh settings preflight finishes', async () => {
  await printOwner(); const first = terminal(), second = terminal()
  mocks.prepare.mockResolvedValueOnce({ start: async () => first, dispose: async () => {} })
  await openNativeTerminal('thread', {}, mocks.prepare); await first.close(); await first.done
  const fresh = { settings: { effective: { disableAllHooks: true }, sources: [] }, permissionMode: 'plan' as const }
  let finish!: (value: typeof fresh) => void
  const read = vi.fn((_options: unknown) => new Promise<typeof fresh>(resolve => { finish = resolve }))
  mocks.prepare.mockResolvedValueOnce({ start: async () => second, dispose: async () => {} })
  const pending = openNativeTerminal('thread', { cliPath: '/new-native' }, mocks.prepare, read)
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session, cwd: '/native-cwd', cliPath: '/new-native' }))
  expect(read.mock.calls[0]![0]).not.toHaveProperty('worktree')
  expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(isConversationBusy('thread')).toBe(true)
  await expect(openNativeTerminal('thread', {}, mocks.prepare, read)).rejects.toThrow('idle')
  finish(fresh); expect(await pending).toBe(second)
  expect(mocks.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ settings: fresh.settings, sessionId: session, permissionMode: 'plan' }))
})

it('cancels a stopped-session preflight on teardown and cannot resurrect its launch', async () => {
  await printOwner(); const first = terminal()
  mocks.prepare.mockResolvedValueOnce({ start: async () => first, dispose: async () => {} })
  await openNativeTerminal('thread', {}, mocks.prepare); await first.close(); await first.done
  let finish!: (value: { settings: { effective: {}; sources: [] }; permissionMode: 'plan' }) => void
  const read = vi.fn(() => new Promise<{ settings: { effective: {}; sources: [] }; permissionMode: 'plan' }>(resolve => { finish = resolve }))
  const pending = openNativeTerminal('thread', {}, mocks.prepare, read), rejected = expect(pending).rejects.toThrow('changed')
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce()); runThreadTeardown('thread')
  finish({ settings: { effective: {}, sources: [] }, permissionMode: 'plan' }); await rejected
  expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(getNativeTerminal('thread')).toBeUndefined()
  await expect(openNativeTerminal('thread', {}, mocks.prepare, read)).rejects.toThrow('idle')
})

it('retains a stopped-session retry after a failed settings read without starting another owner', async () => {
  await printOwner(); const first = terminal(), next = terminal()
  mocks.prepare.mockResolvedValueOnce({ start: async () => first, dispose: async () => {} })
  await openNativeTerminal('thread', {}, mocks.prepare); await first.close(); await first.done
  await expect(openNativeTerminal('thread', {}, mocks.prepare, async () => { throw Error('Settings unavailable') })).rejects.toThrow('Settings unavailable')
  expect(isConversationBusy('thread')).toBe(false); expect(mocks.prepare).toHaveBeenCalledTimes(1)
  mocks.prepare.mockResolvedValueOnce({ start: async () => next, dispose: async () => {} })
  expect(await openNativeTerminal('thread', {}, mocks.prepare, async () => ({ settings: { effective: {}, sources: [] }, permissionMode: 'plan' }))).toBe(next)
})


it('reopens validated persisted launch intent without any in-memory prior owner', async () => {
  const native = terminal(), prepare = vi.fn(async () => ({ start: async () => native, dispose: async () => {} }))
  const read = vi.fn(async () => ({ settings: { effective: {}, sources: [] }, permissionMode: 'plan' as const }))
  const resume = {sessionId:session,cwd:'/saved',allowedTools:['Read'],disallowedTools:['Bash'],appendSystemPrompt:'Saved review instructions',addDir:['/reference']}
  expect(await openNativeTerminal('cold', {resume}, prepare, read)).toBe(native)
  expect(read).toHaveBeenCalledWith(expect.objectContaining(resume))
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({...resume,permissionMode:'plan'}))
  expect(await getNativeLaunch('cold')).not.toHaveProperty('settings')
  await expect(openNativeTerminal('invalid', {resume:{...resume,env:{TOKEN:'not persisted'}} as typeof resume}, prepare, read)).rejects.toThrow()
  expect(prepare).toHaveBeenCalledTimes(1)
})


it('honors newly staged launch choices instead of the retained stopped-owner snapshot', async () => {
  await printOwner(); const first = terminal(), next = terminal()
  mocks.prepare.mockResolvedValueOnce({start:async()=>first,dispose:async()=>{}})
  await openNativeTerminal('thread',{},mocks.prepare);await first.close();await first.done
  const read = vi.fn(async()=>({settings:{effective:{},sources:[]},permissionMode:'plan' as const}))
  mocks.prepare.mockResolvedValueOnce({start:async()=>next,dispose:async()=>{}})
  await openNativeTerminal('thread',{resume:{sessionId:session,cwd:'/native-cwd',model:'haiku',permissionMode:'plan'}},mocks.prepare,read)
  expect(read).toHaveBeenCalledWith(expect.objectContaining({model:'haiku',permissionMode:'plan'}))
})

it('aborts a pending read-only handoff without closing the print owner or admitting a late settings reply', async () => {
 const first=await printOwner(),abort=new AbortController();let resolve!:(value:{effective:{};sources:[]})=>void;
 vi.mocked(first.handle.getSettings).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes}));
 const pending=openNativeTerminal('thread',{signal:abort.signal},mocks.prepare);const rejected=expect(pending).rejects.toThrow('cancelled');
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));abort.abort();await rejected;
 expect(first.handle.close).not.toHaveBeenCalled();expect(first.handle.kill).not.toHaveBeenCalled();expect(getConversation('thread')?.owner).toBe(first.owner);expect(isConversationBusy('thread')).toBe(false);
 resolve({effective:{},sources:[]});await Promise.resolve();expect(mocks.prepare).not.toHaveBeenCalled();
 const native=terminal();mocks.prepare.mockResolvedValueOnce({start:async()=>native,dispose:vi.fn(async()=>{})});
 expect(await openNativeTerminal('thread',{},mocks.prepare)).toBe(native);expect(mocks.prepare.mock.calls[0][0].signal.aborted).toBe(false);
});
