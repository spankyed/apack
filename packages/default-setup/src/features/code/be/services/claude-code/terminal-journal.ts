import { open } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
export interface ClaudeNativeTranscript { sessionId: string; path: string }
export interface ClaudeNativeJournalEntry { sessionId: string; row: Record<string, unknown> }
export interface ClaudeNativeJournalBatch {
  entries: ClaudeNativeJournalEntry[]
  pending: boolean
  problems: string[]
}
/** Bounded batches retain complete rows around damaged data and expose unread bytes for final draining. */
export function createClaudeNativeJournalReader() {
  const cursors = new Map<string, { identity: string; offset: number; pending: Buffer[]; bytes: number; dropping: boolean; problems: Set<string> }>()
  return async (transcripts: readonly ClaudeNativeTranscript[], options: { final?: boolean } = {}): Promise<ClaudeNativeJournalBatch> => {
    const batch: ClaudeNativeJournalBatch = { entries: [], pending: false, problems: [] }
    for (const transcript of transcripts) {
      if (!isAbsolute(transcript.path) || basename(transcript.path) !== transcript.sessionId + '.jsonl' || !/^[a-f0-9-]{36}$/i.test(transcript.sessionId)) throw new Error('Native transcript identity is invalid')
      let file
      try { file = await open(transcript.path, 'r') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      try {
        const stat = await file.stat(), identity = `${stat.dev}:${stat.ino}`
        let cursor = cursors.get(transcript.path)
        if (!cursor || cursor.identity !== identity || stat.size < cursor.offset) {
          cursor = { identity, offset: 0, pending: [], bytes: 0, dropping: false, problems: new Set() }; cursors.set(transcript.path, cursor)
        }
        const append = (part: Buffer) => {
          if (cursor.dropping) return
          cursor.bytes += part.length
          if (cursor.bytes > 32 * 1024 * 1024) {
            cursor.problems.add('Native transcript row exceeds the mirror limit')
            cursor.pending = []; cursor.bytes = 0; cursor.dropping = true
          } else cursor.pending.push(part)
        }
        let remaining = 2 * 1024 * 1024
        while (remaining > 0 && cursor.offset < stat.size) {
          const buffer = Buffer.allocUnsafe(Math.min(65536, remaining, stat.size - cursor.offset))
          const { bytesRead } = await file.read(buffer, 0, buffer.length, cursor.offset)
          if (!bytesRead) break
          cursor.offset += bytesRead; remaining -= bytesRead
          let start = 0
          for (let at = 0; at < bytesRead; at++) {
            if (buffer[at] !== 10) continue
            append(buffer.subarray(start, at))
            const line = cursor.dropping ? '' : Buffer.concat(cursor.pending, cursor.bytes).toString('utf8')
            cursor.pending = []; cursor.bytes = 0; cursor.dropping = false; start = at + 1
            if (!line.trim()) continue
            let row: unknown
            try { row = JSON.parse(line) } catch { cursor.problems.add('Native transcript contains invalid JSON'); continue }
            if (!row || typeof row !== 'object' || Array.isArray(row)) { cursor.problems.add('Native transcript row is not an object'); continue }
            const value = row as Record<string, unknown>
            if (value.sessionId === transcript.sessionId) batch.entries.push({ sessionId: transcript.sessionId, row: value })
          }
          if (start < bytesRead) append(buffer.subarray(start, bytesRead))
        }
        const unread = cursor.offset < stat.size
        batch.pending ||= unread
        if (options.final && !unread && cursor.bytes) cursor.problems.add('Native transcript ended with an incomplete row')
        batch.problems.push(...cursor.problems)
      } finally { await file.close() }
    }
    batch.problems = [...new Set(batch.problems)]
    return batch
  }
}
