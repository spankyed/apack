import { afterEach, expect, it, vi } from 'vitest'

const lease = { threadId: 'thread-one', mountId: '11111111-1111-4111-8111-111111111111', resumeKey: '22222222-2222-4222-8222-222222222222' }
const storageKey = 'default-setup/threads:claude-ui-leases'
const resetRenderer = () => {
  const scope = globalThis as unknown as Record<symbol, unknown>
  delete scope[Symbol.for('apack.default-setup.claude-ui-reload-leases')]
  delete scope[Symbol.for('apack.default-setup.claude-ui-retirements')]
  vi.resetModules()
}
afterEach(() => { sessionStorage.clear(); resetRenderer() })
const load = () => import('#features/threads/fe/chat/native-ui-retirement.ts')

it('retires a prior renderer lease once without retiring the current live view', async () => {
  sessionStorage.setItem('other/surface:claude-ui-leases', 'foreign lease')
  let api = await load()
  api.rememberClaudeUiLease(lease)
  expect(api.takeClaudeUiRetirements()).toEqual([])
  resetRenderer(); api = await load()
  expect(api.takeClaudeUiRetirements()).toEqual([lease])
  expect(api.takeClaudeUiRetirements()).toEqual([])
  expect(sessionStorage.getItem(storageKey)).toBeNull()
  const fresh = { ...lease, resumeKey: '33333333-3333-4333-8333-333333333333' }
  api.rememberClaudeUiLease(fresh)
  expect(api.takeClaudeUiRetirements()).toEqual([])
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([fresh])
  expect(localStorage.getItem(storageKey)).toBeNull()
  expect(sessionStorage.getItem('other/surface:claude-ui-leases')).toBe('foreign lease')
})

it('forgets a normally retired view without withdrawing a foreign thread lease', async () => {
  const api = await load(); api.rememberClaudeUiLease(lease)
  api.forgetClaudeUiLease({ ...lease, threadId: 'other-thread' })
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([lease])
  api.queueClaudeUiRetirement(lease)
  expect(sessionStorage.getItem(storageKey)).toBeNull()
  expect(api.takeClaudeUiRetirements()).toEqual([lease])
  resetRenderer(); expect((await load()).takeClaudeUiRetirements()).toEqual([])
})

it('discards malformed stored credentials instead of claiming another native view', async () => {
  sessionStorage.setItem(storageKey, JSON.stringify([null, {}, { ...lease, resumeKey: 'invalid' }, lease]))
  expect((await load()).takeClaudeUiRetirements()).toEqual([lease])
})
