import { z } from 'zod'
import { ClaudeProtocolError } from './errors.ts'
import { execOnce } from './runner.ts'

const ClaudeAutoMemoryWriteSchema = z.object({
  ok: z.literal(true),
  written: z.object({ autoMemoryEnabled: z.boolean() }),
})

/** Native persistence and effective availability have separate receipts. */
export async function setClaudeAutoMemory(enabled: boolean, options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const result = await execOnce(['edit-memory-settings', '--json'], {
    ...options, input: JSON.stringify({ autoMemoryEnabled: enabled }) + '\n', timeoutMs: 15_000,
  })
  const receipt = ClaudeAutoMemoryWriteSchema.parse(JSON.parse(result.stdout))
  if (receipt.written.autoMemoryEnabled !== enabled) {
    throw new ClaudeProtocolError('Native Auto-memory acknowledgement does not match the request')
  }
}
