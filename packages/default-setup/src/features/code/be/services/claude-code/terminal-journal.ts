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
  const cursors = new Map<string, { identity: string; offset: number; pending: Buffer[]; bytes: number; dropping: boolean; problems: Set<string>; checkpoint: Buffer }>()
  return async (transcripts: readonly ClaudeNativeTranscript[], options: { final?: boolean } = {}): Promise<ClaudeNativeJournalBatch> => {
    const batch: ClaudeNativeJournalBatch = { entries: [], pending: false, problems: [] }
    for (const transcript of transcripts) {
      if (!isAbsolute(transcript.path) || basename(transcript.path) !== transcript.sessionId + '.jsonl' || !/^[a-f0-9-]{36}$/i.test(transcript.sessionId)) throw new Error('Native transcript identity is invalid')
      let file
      try { file = await open(transcript.path, 'r') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      try {
        const transcriptFile = file, stat = await file.stat(), identity = `${stat.dev}:${stat.ino}`
        const fresh = () => ({ identity, offset: 0, pending: [] as Buffer[], bytes: 0, dropping: false, problems: new Set<string>(), checkpoint: Buffer.alloc(0) })
        const matches = async (offset: number, expected: Buffer) => {
          if (!expected.length) return true
          const bytes = Buffer.allocUnsafe(expected.length)
          const result = await transcriptFile.read(bytes, 0, bytes.length, offset - bytes.length)
          return result.bytesRead === bytes.length && bytes.equals(expected)
        }
        let cursor = cursors.get(transcript.path)
        // Claude can rewrite the same inode and regrow it before our next poll. Size alone
        // cannot distinguish that from append, including when a UTF-8 row is pending.
        if (!cursor || cursor.identity !== identity || stat.size < cursor.offset || !await matches(cursor.offset, cursor.checkpoint)) {
          cursor = fresh(); cursors.set(transcript.path, cursor)
        }
        const startOffset = cursor.offset, startCheckpoint = cursor.checkpoint, entryStart = batch.entries.length
        let damaged = false
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
          cursor.checkpoint = Buffer.from(Buffer.concat([cursor.checkpoint, buffer.subarray(0, bytesRead)]).subarray(-1024))
          let start = 0
          for (let at = 0; at < bytesRead; at++) {
            if (buffer[at] !== 10) continue
            append(buffer.subarray(start, at))
            const line = cursor.dropping ? '' : Buffer.concat(cursor.pending, cursor.bytes).toString('utf8')
            cursor.pending = []; cursor.bytes = 0; cursor.dropping = false; start = at + 1
            if (!line.trim()) continue
            let row: unknown
            try { row = JSON.parse(line) } catch { damaged = true; cursor.problems.add('Native transcript contains invalid JSON'); continue }
            if (!row || typeof row !== 'object' || Array.isArray(row)) { damaged = true; cursor.problems.add('Native transcript row is not an object'); continue }
            const value = row as Record<string, unknown>
            if (value.sessionId === transcript.sessionId) batch.entries.push({ sessionId: transcript.sessionId, row: value })
          }
          if (start < bytesRead) append(buffer.subarray(start, bytesRead))
        }
        // Do not publish a mixed read if a rewrite crossed an awaited file read.
        // Stable malformed rows still retain the existing explicit damage warnings.
        if (cursor.offset !== startOffset && (!await matches(startOffset, startCheckpoint) || !await matches(cursor.offset, cursor.checkpoint) || damaged && (await transcriptFile.stat()).mtimeMs !== stat.mtimeMs)) {
          cursors.set(transcript.path, fresh()); batch.entries.length = entryStart; batch.pending = true; continue
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
