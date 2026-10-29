import { afterEach, describe, expect, it, vi } from 'vitest'
import * as agents from '../../../../../../src/features/code/be/services/claude-code/agents.ts'
import { backgroundSession } from '../../../../../../src/features/code/be/services/claude-code/background-sessions.ts'
const continuation = { sessionId: '24be904a-3c35-4981-9793-cbe7a6c19d46', continuedInSessionId: '05ff1d31-597d-4537-8737-4407191add6e', timestamp: '2026-10-29T12:13:13.909Z' }
const job = { kind: 'background' as const, id: '05ff1d31', sessionId: continuation.continuedInSessionId, cwd: '/owned/child-worktree', startedAt: 1, state: 'working' as const, status: 'idle' as const, pid: 119 }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('linked background session controls', () => {
  it('reads only the durable linked child, including a child in a distinct worktree', async () => {
    vi.spyOn(agents, 'list').mockResolvedValue([{ ...job, id: '12345678', sessionId: continuation.sessionId }, job])
    const result = await backgroundSession(continuation, { operation: 'refresh' })
    expect(result).toMatchObject({ id: job.id, sessionId: job.sessionId, cwd: job.cwd, pid: 119, state: 'working' })
    expect(result).not.toHaveProperty('startedAt')
  })
  it('waits through the observed persisted-record-before-registration gap', async () => {
    vi.useFakeTimers()
    const list = vi.spyOn(agents, 'list').mockResolvedValueOnce([{ ...job, pid: undefined, status: undefined }]).mockResolvedValue([job])
    const pending = backgroundSession(continuation, { operation: 'refresh' })
    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).resolves.toMatchObject({ pid: 119 })
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('returns absent rather than inventing completion when the job is not listed', async () => {
    vi.spyOn(agents, 'list').mockResolvedValue([])
    await expect(backgroundSession(continuation, { operation: 'refresh' })).resolves.toBeUndefined()
  })
  it('rechecks the worker and confirms original Stop from a second native listing', async () => {
    const list = vi.spyOn(agents, 'list').mockResolvedValueOnce([job]).mockResolvedValueOnce([{ ...job, state: 'stopped', pid: undefined, status: undefined }])
    const stop = vi.spyOn(agents, 'stop').mockResolvedValue('stopped 05ff1d31')
    const options = { cwd: '/owned/parent', timeoutMs: 15000 }
    await expect(backgroundSession(continuation, { operation: 'stop', id: job.id, pid: 119 }, options)).resolves.toMatchObject({ state: 'stopped', sessionId: job.sessionId })
    expect(stop).toHaveBeenCalledExactlyOnceWith(job.id, options)
    expect(list).toHaveBeenCalledTimes(2)
  })
  it.each([{ id: job.id, pid: 118 }, { id: '12345678', pid: 119 }, { id: job.id, pid: NaN }])('refuses stale worker or foreign job %#', async request => {
    vi.spyOn(agents, 'list').mockResolvedValue([job]); const stop = vi.spyOn(agents, 'stop')
    await expect(backgroundSession(continuation, { operation: 'stop', ...request })).rejects.toThrow('changed')
    expect(stop).not.toHaveBeenCalled()
  })
  it('does not treat successful command exit alone as Stop acknowledgement', async () => {
    vi.spyOn(agents, 'list').mockResolvedValue([job]); vi.spyOn(agents, 'stop').mockResolvedValue('ok')
    await expect(backgroundSession(continuation, { operation: 'stop', id: job.id, pid: 119 })).rejects.toThrow('not been confirmed')
  })
  it('rejects an invalid durable parent link before launching a native command', async () => {
    const list = vi.spyOn(agents, 'list')
    await expect(backgroundSession({ ...continuation, continuedInSessionId: continuation.sessionId }, { operation: 'refresh' })).rejects.toThrow('invalid')
    expect(list).not.toHaveBeenCalled()
  })
})
