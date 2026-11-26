import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertReviewedClaudeNativeExecutable } from '#features/code/be/services/claude-code/native-executable-review.ts'

const mocks = vi.hoisted(() => {
  vi.resetModules()
  return { expected: vi.fn() }
})
vi.mock('#features/code/be/services/claude-code/native-platform-runtime.ts', () => ({
  reviewedClaudeNativeBinary: mocks.expected,
}))

it('accepts the reviewed direct binary and refuses a different binary before launch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apack-reviewed-cli-'))
  try {
    const path = join(directory, 'claude')
    const reviewed = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('reviewed')])
    mocks.expected.mockReturnValue(createHash('sha256').update(reviewed).digest('hex'))
    await writeFile(path, reviewed)
    await expect(assertReviewedClaudeNativeExecutable(path)).resolves.toBeUndefined()
    await writeFile(path, Buffer.concat([reviewed, Buffer.from('different')]))
    await expect(assertReviewedClaudeNativeExecutable(path)).rejects.toThrow('You can continue in the conversation.')
    await writeFile(path, '#!/bin/sh\nexec /owned/claude "$@"\n')
    await expect(assertReviewedClaudeNativeExecutable(path)).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('honors cancellation before inspecting the executable', async () => {
  await expect(assertReviewedClaudeNativeExecutable('/unopened', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
})
