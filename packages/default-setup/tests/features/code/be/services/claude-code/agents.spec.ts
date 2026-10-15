import { describe, expect, it, vi } from 'vitest'
import * as subcommand from '../../../../../../src/features/code/be/services/claude-code/subcommand.ts'
import { list } from '../../../../../../src/features/code/be/services/claude-code/agents.ts'

describe('native agents JSON listing', () => {
  it('uses a noninteractive command and retains opaque session fields', async () => {
    const run = vi.spyOn(subcommand, 'runJson').mockResolvedValue([{ nativeField: 'fixture' }])
    await expect(list({ all: true, sessionCwd: '/fixture/project', settingSources: '' }))
      .resolves.toEqual([{ nativeField: 'fixture' }])
    expect(run).toHaveBeenCalledWith(['agents', '--json', '--all', '--cwd', '/fixture/project', '--setting-sources', ''],
      { all: true, sessionCwd: '/fixture/project', settingSources: '' })
  })
  it('rejects non-array or non-object CLI output', async () => {
    const run = vi.spyOn(subcommand, 'runJson').mockResolvedValue({ agents: [] })
    await expect(list()).rejects.toThrow()
    run.mockResolvedValue([null])
    await expect(list()).rejects.toThrow()
  })
})
