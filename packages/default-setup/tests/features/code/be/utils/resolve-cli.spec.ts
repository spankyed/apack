// The code feature's CLI resolution: with no stored path and nothing at the known locations, a CLI resolves to its
// command name
import { describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('@apackdev/sdk/progress', () => ({
  execFileWhileWorking: execFileMock,
}))

vi.mock('fs', () => ({
  constants: { X_OK: 1 },
  accessSync: vi.fn(() => {
    throw new Error('not executable')
  }),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

describe('resolveCliPath', () => {
  it.each([
    ['copilot', 'copilot'],
    ['claude-code', 'claude'],
    ['codex', 'codex'],
    ['gh', 'gh'],
  ] as const)('falls back to the %s executable name', async (provider, executable) => {
    vi.resetModules()
    execFileMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))

    const { resolveCliPath } = await import('#features/code/be/utils/resolve-cli.ts')

    await expect(resolveCliPath(provider)).resolves.toBe(executable)
  })
})
