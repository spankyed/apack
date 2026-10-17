import { open } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
export interface ClaudeNativeTranscript { sessionId: string; path: string }
export interface ClaudeNativeJournalEntry { sessionId: string; row: Record<string, unknown> }
/** Read completed JSONL rows incrementally. Native storage retains flags absent from session.append. */
export function createClaudeNativeJournalReader() {
  const cursors = new Map<string, { identity: string; offset: number; pending: Buffer[]; bytes: number }>()
  return async (transcripts: readonly ClaudeNativeTranscript[]): Promise<ClaudeNativeJournalEntry[]> => {
    const entries: ClaudeNativeJournalEntry[] = []
    for (const transcript of transcripts) {
      if (!isAbsolute(transcript.path) || basename(transcript.path) !== transcript.sessionId + '.jsonl' || !/^[a-f0-9-]{36}$/i.test(transcript.sessionId)) throw new Error('Native transcript identity is invalid')
      let file
      try { file = await open(transcript.path, 'r') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      try {
        const stat = await file.stat(), identity = `${stat.dev}:${stat.ino}`
        let cursor = cursors.get(transcript.path)
        if (!cursor || cursor.identity !== identity || stat.size < cursor.offset) {
          cursor = { identity, offset: 0, pending: [], bytes: 0 }; cursors.set(transcript.path, cursor)
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
            cursor.pending.push(buffer.subarray(start, at)); cursor.bytes += at - start
            if (cursor.bytes > 32 * 1024 * 1024) throw new Error('Native transcript row exceeds the mirror limit')
            const line = Buffer.concat(cursor.pending, cursor.bytes).toString('utf8'); cursor.pending = []; cursor.bytes = 0; start = at + 1
            if (!line.trim()) continue
            const row: unknown = JSON.parse(line)
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Native transcript row is not an object')
            const value = row as Record<string, unknown>
            if (value.sessionId === transcript.sessionId) entries.push({ sessionId: transcript.sessionId, row: value })
          }
          if (start < bytesRead) { cursor.pending.push(buffer.subarray(start, bytesRead)); cursor.bytes += bytesRead - start }
          if (cursor.bytes > 32 * 1024 * 1024) throw new Error('Native transcript row exceeds the mirror limit')
        }
      } finally { await file.close() }
    }
    return entries
  }
}
