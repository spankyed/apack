import { PassThrough } from 'node:stream'
import { runThreadTeardown } from '#features/threads/be/thread-teardown.ts'
import { storeHandle, clearHandle, openConversation, openNativeTerminal, getNativeTerminal, getConversation, isConversationBusy, killAllHandles } from '#features/code/be/services/claude-code/handle-store.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
const mocks = { prepare: vi.fn() }
const session = '11111111-1111-1111-1111-111111111111'
async function printOwner() {
  const events = new PassThrough({ objectMode: true })
  const handle = { events, close: vi.fn(async () => { events.end() }), kill: vi.fn(() => events.end()), getPermissionMode: vi.fn(async () => 'plan'), getSettings: vi.fn(async () => ({ effective: {}, sources: [] })) } as unknown as QueryHandle
  const owner = await openConversation('thread', JSON.stringify({ cwd: '/fixture', model: 'native-model' }), async () => handle, async () => {})
  events.write({ type: 'system', subtype: 'init', session_id: session, cwd: '/native-cwd' })
  await vi.waitFor(() => expect(owner.sessionId).toBe(session))
  return { handle, owner }
}
function terminal() {
  let resolve!: () => void
  const done = new Promise<void>(yes => { resolve = yes })
  return { uiTransport: { promptHosts: { register: () => () => {}, answers: () => [], detach() {} }, request: vi.fn(async () => { throw new Error('UI is not used in the handoff fixture') }), subscribe: () => () => {} }, state: { ownerId: 'terminal-owner', sessionId: session, cwd: '/native-cwd', status: 'live', busy: false, tasks: [] }, busy: false, output: [], records: [], readJournal: vi.fn(async () => ({ entries: [], pending: false, problems: [] })), beforeRelease: vi.fn(), done,
    getModels: vi.fn(async () => ({ models: [] })), setModel: vi.fn(async (model: string) => model), setPermissionMode: vi.fn(async (mode: Parameters<ClaudeNativeTerminalOwner['setPermissionMode']>[0]) => mode), kill: vi.fn(resolve), close: vi.fn(async () => resolve()), subscribe: vi.fn(() => () => {}), input: vi.fn(() => true), resize: vi.fn(() => true), submit: vi.fn(async () => ({ sessionId: '11111111-1111-1111-1111-111111111111', uuid: '22222222-2222-2222-2222-222222222222', text: 'Draft' })) } satisfies ClaudeNativeTerminalOwner
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
  const pending = openNativeTerminal('thread', {}, mocks.prepare), rejected = expect(pending).rejects.toThrow('changed')
  expect(isConversationBusy('thread')).toBe(true); expect(getConversation('thread')).toBeUndefined()
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
