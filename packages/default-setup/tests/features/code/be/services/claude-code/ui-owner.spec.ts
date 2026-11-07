import { getClaudeUiOwner, snapshotClaudeBackgroundUiTarget } from '#features/code/be/services/claude-code/ui-owner.ts'
import * as store from '#features/code/be/services/claude-code/handle-store.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

const target = { ownerId: 'owner', sessionId: 'session', revision: 2, taskId: 'agent' }
function native() {
  const state: ClaudeNativeTerminalState = { ownerId: 'owner', sessionId: 'session', cwd: '/private/fixture', busy: false, tasks: [], status: 'live', view: { kind: 'agent', revision: 2, registryId: 'registry-agent', taskId: 'agent' } }
  const request = vi.fn(async (_value: Record<string, unknown>): Promise<unknown> => ({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }))
  const owner = { state, done: new Promise<void>(() => {}), uiTransport: { request, subscribe: vi.fn(), promptHosts: {} } } as unknown as ClaudeNativeTerminalOwner
  vi.mocked(store.getNativeTerminal).mockReturnValue(owner)
  return { state, owner, request }
}
beforeEach(() => { vi.spyOn(store, 'getNativeTerminal').mockReturnValue(undefined); vi.spyOn(store, 'getConversation').mockReturnValue(undefined) })
afterEach(() => vi.restoreAllMocks())
it('requires an explicit exact Agent target and exposes its attachment to the mounted view', () => {
  const { request } = native()
  expect(getClaudeUiOwner('thread')).toBeUndefined()
  const selected = getClaudeUiOwner('thread', target)
  expect(selected?.nativeView).toEqual({ session_id: 'session', revision: 2, agent_id: 'agent' })
  expect(getClaudeUiOwner('thread', { ...target })).toBe(selected)
  for (const foreign of [{ ...target, ownerId: 'other' }, { ...target, sessionId: 'other' }, { ...target, revision: 1 }, { ...target, taskId: 'registry-agent' }]) expect(getClaudeUiOwner('thread', foreign)).toBeUndefined()
  expect(request).not.toHaveBeenCalled()
})
it('retires main and Agent identities across return, reselection and session replacement', () => {
  const { state } = native(); const agent = getClaudeUiOwner('thread', target)
  state.view = { kind: 'main', revision: 3 }
  expect(getClaudeUiOwner('thread', target)).toBeUndefined()
  const main = getClaudeUiOwner('thread'); expect(main).toBeTruthy(); expect(main?.nativeView).toBeUndefined()
  state.view = { kind: 'agent', revision: 4, taskId: 'agent', registryId: 'registry-agent' }
  expect(getClaudeUiOwner('thread')).toBeUndefined(); expect(getClaudeUiOwner('thread', target)).toBeUndefined()
  expect(getClaudeUiOwner('thread', { ...target, revision: 4 })).not.toBe(agent)
  state.sessionId = 'replacement'; expect(getClaudeUiOwner('thread', { ...target, revision: 4 })).toBeUndefined()
})
it('refuses an old target on a replacement process with the same session and revision', () => {
  native(); const original = getClaudeUiOwner('thread', target)
  const replacement = native(); replacement.state.ownerId = 'replacement-owner'
  expect(getClaudeUiOwner('thread', target)).toBeUndefined()
  expect(getClaudeUiOwner('thread', { ...target, ownerId: 'replacement-owner' })).not.toBe(original)
})
it('waits for observed selection and refuses exited owners and retired Agent identities', () => {
  const { state } = native(); state.view = undefined; expect(getClaudeUiOwner('thread')).toBeUndefined()
  state.view = { kind: 'agent', revision: 2, registryId: 'registry-agent' }; expect(getClaudeUiOwner('thread', target)).toBeUndefined()
  state.view = { kind: 'main', revision: 3 }; state.status = 'exited'; expect(getClaudeUiOwner('thread')).toBeUndefined()
})
it('keeps ordinary print ownership but never redirects an Agent target to print', () => {
  const owner = {} as NonNullable<ReturnType<typeof store.getConversation>>['owner']
  vi.mocked(store.getConversation).mockReturnValue({ owner } as ReturnType<typeof store.getConversation>)
  expect(getClaudeUiOwner('thread')).toBe(owner); expect(getClaudeUiOwner('thread', target)).toBeUndefined()
})

it('does not attach conversation UI after the original owner has a durable background continuation', () => {
  const { state, request } = native()
  state.view = { kind: 'main', revision: 3 }
  state.continuation = { sessionId: state.sessionId, continuedInSessionId: 'child', timestamp: '2026-10-30T06:23:31.038Z' }
  expect(getClaudeUiOwner('thread')).toBeUndefined(); expect(request).not.toHaveBeenCalled()
})

it('keeps child desktop controls on the exact original incarnation, separate from parent and Agent UI', () => {
  const request = vi.fn(async () => ({capabilities: ['ui_surface_v1']}))
  const desktop = {id: 'child-owner', parentSessionId: 'parent', identity: {sessionId:'child',activeSessionId:'child',jobId:'11111111',pid:119,start:'start',hostPid:100,hostStart:'host-start',cwd:'/owned'},
    controls: {value: undefined, subscribe: vi.fn(() => () => {}), settled: vi.fn()}, registration:1, done:new Promise<void>(() => {}), transport:{request, subscribe:vi.fn(), promptHosts:{}}} as unknown as NonNullable<ReturnType<typeof store.getNativeBackgroundDesktopOwner>>
  const read = vi.spyOn(store, 'getNativeBackgroundDesktopOwner').mockReturnValue(desktop)
  const child = snapshotClaudeBackgroundUiTarget(desktop)
  const owner = getClaudeUiOwner('thread', undefined, child)
  expect(owner?.sessionId).toBe('child');expect(owner?.done).toBe(desktop.done);expect(owner?.nativeView).toBeUndefined()
  expect(getClaudeUiOwner('thread',undefined,{...child})).toBe(owner)
  for (const foreign of [{ownerId:'other'},{parentSessionId:'other'},{sessionId:'other'},{jobSessionId:'other'},{jobId:'other'},{pid:120},{processStart:'reused-pid'}]) {
    expect(getClaudeUiOwner('thread',undefined,{...child,...foreign})).toBeUndefined()
  }
  expect(getClaudeUiOwner('thread',target,child)).toBeUndefined()
  expect(getClaudeUiOwner('thread')).toBeUndefined()
  expect(request).not.toHaveBeenCalled()
  read.mockReturnValue({...desktop,id:'replacement'})
  expect(getClaudeUiOwner('thread',undefined,child)).toBeUndefined()
  const replacement = getClaudeUiOwner('thread',undefined,{...child,ownerId:'replacement'})
  expect(replacement).toBeTruthy();expect(replacement).not.toBe(owner)
  read.mockReturnValue(undefined);expect(getClaudeUiOwner('thread',undefined,{...child,ownerId:'replacement'})).toBeUndefined()
})


it('allows a fresh attachment after failed capability discovery without replacing its native owner', async () => {
  const { owner: nativeOwner, request } = native()
  Object.assign(nativeOwner.uiTransport.promptHosts, { answers: () => [] })
  request.mockRejectedValueOnce(new Error('Native UI request timed out'))
  const owner = getClaudeUiOwner('thread', target)!
  const attach = (id: string) => owner.handle.ui.attach({ client_id: id, surface: 'desktop', native_view: owner.nativeView })
  await expect(attach('first')).rejects.toThrow('Native UI request timed out')
  expect(request).toHaveBeenCalledTimes(1)
  expect(getClaudeUiOwner('thread', target)).toBe(owner)
  request.mockImplementation(async value => value.subtype === 'apack_ui_capabilities'
    ? { capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }
    : { surfaces: ['desktop'] })
  await expect(attach('second')).resolves.toEqual({ surfaces: ['desktop'] })
  await expect(attach('third')).resolves.toEqual({ surfaces: ['desktop'] })
  expect(request.mock.calls.filter(([value]) => value.subtype === 'apack_ui_capabilities')).toHaveLength(2)
  expect(getClaudeUiOwner('thread', target)).toBe(owner)
})


it('shares in-flight capability discovery and preserves native capability refusal', async () => {
  const { state, owner: nativeOwner, request } = native()
  state.view = { kind: 'main', revision: 3 }
  Object.assign(nativeOwner.uiTransport.promptHosts, { answers: () => [] })
  let finish!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const owner = getClaudeUiOwner('thread')!
  const first = owner.handle.ui.attach({ client_id: 'first', surface: 'desktop' })
  const second = owner.handle.ui.attach({ client_id: 'second', surface: 'desktop' })
  expect(request).toHaveBeenCalledOnce()
  finish({ capabilities: [] })
  await expect(first).rejects.toThrow('native UI surface capability is unavailable')
  await expect(second).rejects.toThrow('native UI surface capability is unavailable')
  await expect(owner.handle.ui.attach({ client_id: 'third', surface: 'desktop' })).rejects.toThrow('native UI surface capability is unavailable')
  expect(request).toHaveBeenCalledOnce()
})
