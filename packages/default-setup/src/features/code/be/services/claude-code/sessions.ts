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

const CHUNK_SIZE = 4096

/**
 * Extract a session title from a JSONL file by reading head + tail chunks.
 * Mirrors the CLI's `parseSessionInfoFromLite()` pattern — checks for
 * `customTitle` first, falls back to `aiTitle`.
 */
async function extractTitle(filePath: string, fileSize: number): Promise<string | undefined> {
  let fh: fs.promises.FileHandle | undefined
  try {
    fh = await fs.promises.open(filePath, 'r')
    const headBuf = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize))
    await fh.read(headBuf, 0, headBuf.length, 0)
    const head = headBuf.toString('utf8')

    let tail = head
    if (fileSize > CHUNK_SIZE) {
      const tailBuf = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize))
      await fh.read(tailBuf, 0, tailBuf.length, fileSize - tailBuf.length)
      tail = tailBuf.toString('utf8')
    }

    // Check tail first (titles are appended), then head
    return extractJsonField(tail, 'customTitle')
      ?? extractJsonField(head, 'customTitle')
      ?? extractJsonField(tail, 'aiTitle')
      ?? extractJsonField(head, 'aiTitle')
  } catch {
    return undefined
  } finally {
    await fh?.close()
  }
}

/** Extract a JSON string field value by simple string search (no full parse). */
function extractJsonField(text: string, key: string): string | undefined {
  for (const pattern of [`"${key}":"`, `"${key}": "`]) {
    const idx = text.lastIndexOf(pattern)
    if (idx < 0) continue
    const start = idx + pattern.length
    let i = start
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') return text.slice(start, i)
      i++
    }
  }
  return undefined
}

/** Read all sessions from a bucket directory. `cwd` is stored on each SessionInfo for context. */
/** Bucket names are lossy; the journal is the authority for the project path. */
async function readSessionCwd(file: string): Promise<string | undefined> {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (typeof row?.cwd === 'string' && path.isAbsolute(row.cwd)) return row.cwd;
      } catch { /* A damaged row does not hide later native project metadata. */ }
    }
  } finally { lines.close(); input.destroy(); }
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
    const title = await extractTitle(file, stat.size)
    infos.push({
      id,
      file,
      cwd: cwd ?? await readSessionCwd(file),
      title,
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
