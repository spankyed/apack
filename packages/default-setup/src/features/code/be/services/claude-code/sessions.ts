/**
 * Session management.
 *
 * The CLI does not expose a `claude session` subcommand — session data lives
 * on disk as JSONL files under `$CLAUDE_CONFIG_DIR` (default `~/.claude`),
 * organised per-project. This module reads those files directly for list /
 * view / get, and uses file operations for rm.
 *
 * Important: session JSONL files can be large (multi-MB). `view()` parses
 * them fully, so callers should paginate (`limit`/`offset`) on long sessions.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'


// ─── Directory discovery ─────────────────────────────────────────────────────

/** Root of the CLI's config, honouring $CLAUDE_CONFIG_DIR. */
export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/**
 * Project bucket path inside the CLI's config dir.
 *
 * The CLI stores each project's sessions under
 * `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<session-id>.jsonl`.
 */
function projectBucket(cwd: string): string {
  return path.join(configDir(), 'projects', encodeProjectPath(cwd))
}

/**
 * Mirror of the CLI's `sanitizePath` — see the leaked source at
 * `src/utils/sessionStoragePortable.ts:311`. Replaces every non-alphanumeric
 * byte with `-`; if the result exceeds `MAX_SANITIZED_LENGTH`, truncate and
 * append a hash suffix so long paths remain distinguishable.
 *
 * Exported for tests.
 */
export const MAX_SANITIZED_LENGTH = 200

export function encodeProjectPath(cwd: string): string {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${djb2(cwd).toString(36)}`
}

/**
 * djb2 string hash (Dan Bernstein). Matches the CLI's non-Bun fallback
 * (`simpleHash`) so long-cwd encodings align between the two processes.
 */
function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return h >>> 0
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string
  file: string
  cwd?: string
  title?: string
  tags?: string[]
  modifiedAt: Date
  size: number
  firstMessageAt?: Date
  lastMessageAt?: Date
}

export interface SessionTranscriptEntry {
  type?: string
  [key: string]: unknown
}

export interface SessionListOptions {
  /** Working directory whose sessions to list. Defaults to `process.cwd()`. */
  cwd?: string
  limit?: number
  offset?: number
}

export interface SessionViewOptions {
  cwd?: string
  limit?: number
  offset?: number
}

// ─── Internals ────────────────────────────────────────────────────────────────

/** Stream native metadata without retaining transcript rows or guessing from bucket names. */
async function readSessionMetadata(file: string, sessionId: string): Promise<{ cwd?: string; title?: string }> {
  const input = fs.createReadStream(file, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  let cwd: string | undefined
  let customTitle: string | undefined
  let aiTitle: string | undefined
  try {
    for await (const line of lines) {
      let row: SessionTranscriptEntry
      try { row = JSON.parse(line) } catch { continue }
      if (!row || typeof row !== 'object') continue
      if (!cwd && typeof row.cwd === 'string' && path.isAbsolute(row.cwd)) cwd = row.cwd
      if (row.sessionId !== sessionId) continue
      if (row.type === 'custom-title' && typeof row.customTitle === 'string') customTitle = row.customTitle
      if (row.type === 'ai-title' && typeof row.aiTitle === 'string') aiTitle = row.aiTitle
    }
    return { cwd, title: customTitle || aiTitle || undefined }
  } finally {
    lines.close()
    input.destroy()
  }
}

async function listBucket(bucketPath: string, cwd?: string): Promise<SessionInfo[]> {
  let files: string[]
  try {
    files = await fs.promises.readdir(bucketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const jsonl = files.filter(f => f.endsWith('.jsonl'))
  const infos: SessionInfo[] = []

  for (const name of jsonl) {
    const file = path.join(bucketPath, name)
    const stat = await fs.promises.stat(file).catch(() => null)
    if (!stat) continue
    const id = name.replace(/\.jsonl$/, '')
    let metadata: Awaited<ReturnType<typeof readSessionMetadata>>
    try { metadata = await readSessionMetadata(file, id) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    infos.push({
      id,
      file,
      cwd: cwd ?? metadata.cwd,
      title: metadata.title,
      modifiedAt: stat.mtime,
      size: stat.size,
    })
  }

  return infos
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** List sessions saved for the given working directory. */
export async function list(opts: SessionListOptions = {}): Promise<SessionInfo[]> {
  const cwd = opts.cwd ?? process.cwd()
  const infos = await listBucket(projectBucket(cwd), cwd)

  infos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? infos.length
  return infos.slice(offset, offset + limit)
}

/** List sessions across ALL project directories. */
export async function listAll(opts: { limit?: number } = {}): Promise<SessionInfo[]> {
  const projectsDir = path.join(configDir(), 'projects')
  let dirents: fs.Dirent[]
  try {
    dirents = await fs.promises.readdir(projectsDir, { withFileTypes: true })
  } catch { return [] }

  const results: SessionInfo[] = []
  for (const d of dirents) {
    if (!d.isDirectory()) continue
    const bucketPath = path.join(projectsDir, d.name)
    let sessions = await listBucket(bucketPath)
    if (opts.limit) {
      sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
      sessions = sessions.slice(0, opts.limit)
    }
    results.push(...sessions)
  }

  results.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  return results
}

/** Parse a JSONL file directly by path (bypasses cwd→bucket lookup). */
export async function viewByFile(
  filePath: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<SessionTranscriptEntry[]> {
  const entries: SessionTranscriptEntry[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let lineNum = 0
  const offset = opts.offset ?? 0
  const limit = opts.limit

  for await (const line of rl) {
    if (!line) continue
    if (lineNum < offset) { lineNum++; continue }
    if (limit && entries.length >= limit) { rl.close(); break }
    try {
      entries.push(JSON.parse(line))
    } catch {
      entries.push({ type: '__parse_error', raw: line })
    }
    lineNum++
  }
  return entries
}

/** Load basic metadata about a single session. */
export async function find(
  id: string,
  opts: { cwd?: string } = {},
): Promise<SessionInfo | null> {
  assertSafeId(id)
  const cwd = opts.cwd ?? process.cwd()
  const file = path.join(projectBucket(cwd), `${id}.jsonl`)
  const stat = await fs.promises.stat(file).catch(() => null)
  if (!stat) return null
  return { id, file, cwd, modifiedAt: stat.mtime, size: stat.size }
}

/** Parse a session's JSONL into an in-memory array of entries. */
export async function view(
  id: string,
  opts: SessionViewOptions = {},
): Promise<SessionTranscriptEntry[]> {
  assertSafeId(id)
  const cwd = opts.cwd ?? process.cwd()
  const file = path.join(projectBucket(cwd), `${id}.jsonl`)
  const raw = await fs.promises.readFile(file, 'utf8')
  const lines = raw.split('\n').filter(l => l.length > 0)
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? lines.length
  const slice = lines.slice(offset, offset + limit)

  const entries: SessionTranscriptEntry[] = []
  for (const line of slice) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      entries.push({ type: '__parse_error', raw: line })
    }
  }
  return entries
}

/** Delete a session's JSONL + any associated subdir. Idempotent. */
export async function remove(
  id: string,
  opts: { cwd?: string } = {},
): Promise<void> {
  assertSafeId(id)
  const cwd = opts.cwd ?? process.cwd()
  const bucket = projectBucket(cwd)
  const file = path.join(bucket, `${id}.jsonl`)
  const subdir = path.join(bucket, id)

  await fs.promises.rm(file, { force: true })
  await fs.promises.rm(subdir, { recursive: true, force: true })
}

/** Reject IDs that could escape the project bucket via path traversal. */
function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid session ID: ${JSON.stringify(id)}`)
  }
}
