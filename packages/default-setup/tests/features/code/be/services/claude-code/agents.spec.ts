import { afterEach, describe, expect, it, vi } from 'vitest'
import * as subcommand from '../../../../../../src/features/code/be/services/claude-code/subcommand.ts'
import { list, stop } from '../../../../../../src/features/code/be/services/claude-code/agents.ts'

const base = { cwd: '/fixture/project', startedAt: 1793275300306, sessionId: 'f28d70af-441e-417d-8362-cff80533ac03' }
const working = { ...base, kind: 'background', id: 'f28d70af', pid: 119, status: 'busy', state: 'working' }
const stopped = { ...base, startedAt: 1793275299591, kind: 'background', id: 'f28d70af', state: 'stopped' }

afterEach(() => vi.restoreAllMocks())

describe('native agents JSON listing', () => {
  it('accepts observed working and persisted stopped rows without inventing live process fields', async () => {
    const run = vi.spyOn(subcommand, 'runJson').mockResolvedValue([working, stopped])
    const rows = await list({ all: true, sessionCwd: base.cwd, settingSources: '' })
    expect(rows).toEqual([working, stopped])
    expect(rows[1]).not.toHaveProperty('pid')
    expect(rows[1]).not.toHaveProperty('status')
    expect(run).toHaveBeenCalledWith(['agents', '--json', '--all', '--cwd', base.cwd, '--setting-sources', ''],
      { all: true, sessionCwd: base.cwd, settingSources: '' })
  })
  it('accepts source-defined interactive and unregistered background processes', async () => {
    const rows = ['interactive', 'background'].map(kind => ({ ...base, kind, pid: 119, status: 'waiting', waitingFor: 'approval' }))
    vi.spyOn(subcommand, 'runJson').mockResolvedValue(rows)
    await expect(list()).resolves.toEqual(rows)
  })
  it.each([
    { agents: [] }, [null], [{ nativeField: 'fixture' }],
    [{ ...working, id: '../other' }], [{ ...working, state: 'idle' }],
    [{ ...working, pid: -1 }], [{ ...working, waitingFor: {} }], [{ ...stopped, id: undefined }],
  ])('rejects malformed session output %#', async output => {
    vi.spyOn(subcommand, 'runJson').mockResolvedValue(output)
    await expect(list()).rejects.toThrow()
  })
  it('stops only an explicit native job identity and preserves execution ownership options', async () => {
    const run = vi.spyOn(subcommand, 'run').mockResolvedValue('stopped f28d70af')
    const controller = new AbortController()
    const opts = { cwd: base.cwd, signal: controller.signal, timeoutMs: 25000 }
    await expect(stop('f28d70af', opts)).resolves.toBe('stopped f28d70af')
    expect(run).toHaveBeenCalledWith(['stop', 'f28d70af'], opts)
  })
  it.each(['', '--all', '../f28d70af', 'f28d70af-441e-417d-8362-cff80533ac03'])('refuses invalid stop identity %s before spawning', async id => {
    const run = vi.spyOn(subcommand, 'run')
    await expect(stop(id)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
})
