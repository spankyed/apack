import { describe, expect, it, vi } from 'vitest'
import * as queries from '../../../../../../src/features/code/be/services/claude-code/query.ts'
import { renameSession } from '../../../../../../src/features/code/be/services/claude-code/session-controls.ts'

describe('native persisted session rename', () => {
  it('resumes without a prompt and always closes after a rejected rename', async () => {
    const rename = vi.fn().mockRejectedValue(new Error('foreign session'))
    const close = vi.fn().mockResolvedValue(undefined)
    const start = vi.spyOn(queries, 'query').mockResolvedValue({ renameSession: rename, close } as never)
    await expect(renameSession({ sessionId: 'fixture-id', title: 'Fixture', cwd: '/fixture' })).rejects.toThrow('foreign session')
    expect(start).toHaveBeenCalledWith({ cwd: '/fixture', env: undefined, cliPath: undefined, signal: undefined,
      resume: 'fixture-id', keepStdinOpen: true })
    expect(rename).toHaveBeenCalledWith('Fixture', 'fixture-id')
    expect(close).toHaveBeenCalledOnce()
  })
  it('rejects empty identity/title and prompt injection before launch', async () => {
    const start = vi.spyOn(queries, 'query')
    await expect(renameSession({ sessionId: '', title: 'Fixture', cwd: '/fixture' })).rejects.toThrow('required')
    await expect(renameSession({ sessionId: 'fixture', title: ' ', cwd: '/fixture' })).rejects.toThrow('required')
    await expect(renameSession({ sessionId: 'fixture', title: 'Title', cwd: '/fixture', prompt: 'never send' } as never))
      .rejects.toThrow('unsupported rename options')
    expect(start).not.toHaveBeenCalled()
  })
})
