import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { reviewedClaudeNativeBinary } from './native-platform-runtime.ts'

const machO = new Set([0xcffaedfe, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca])

/** Refuse a known direct binary mismatch before the print writer is retired. */
export async function assertReviewedClaudeNativeExecutable(executable: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const expected = reviewedClaudeNativeBinary(process.platform)
  if (!expected) return
  const file = await open(executable, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    // Shell and package launchers can resolve to a reviewed executable. The CLI still checks its own
    // running bytes after launch, including when the selected path is replaced after this preflight.
    if (bytesRead < header.length) return
    const magic = header.readUInt32BE()
    if (magic !== 0x7f454c46 && !machO.has(magic)) return
    const digest = createHash('sha256')
    for await (const chunk of file.createReadStream({ start: 0, autoClose: false, signal })) digest.update(chunk)
    if (digest.digest('hex') !== expected) {
      throw new Error('The native interface requires the reviewed Claude Code 2.1.302 binary. You can continue in the conversation.')
    }
  } finally {
    await file.close()
  }
}
