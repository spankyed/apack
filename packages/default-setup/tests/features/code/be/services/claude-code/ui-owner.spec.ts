import { getClaudeUiOwner } from '#features/code/be/services/claude-code/ui-owner.ts'
import * as store from '#features/code/be/services/claude-code/handle-store.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

const target = { ownerId: 'owner', sessionId: 'session', revision: 2, taskId: 'agent' }
function native() {
  const state: ClaudeNativeTerminalState = { ownerId: 'owner', sessionId: 'session', cwd: '/private/fixture', busy: false, tasks: [], status: 'live', view: { kind: 'agent', revision: 2, registryId: 'registry-agent', taskId: 'agent' } }
  const request = vi.fn(async () => ({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }))
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
  expect(request).toHaveBeenCalledOnce()
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
