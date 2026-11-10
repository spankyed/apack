import * as path from 'path'
import * as fs from 'fs/promises'
import type { GitStatusFile, StashEntry, CommitLogEntry } from '../types.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { agentChildEnvironment } from './shell-environment.ts'

const logger = createLogger('git')

/**
 * A branch, tag or other ref a caller named, as an argument git will read as a ref.
 *
 * **A name that begins with a dash is an option to git, whatever the caller meant by it**: `--hard` given as a
 * commit resets the working tree, and `--upload-pack=…` given as a branch names a program to run. Names reach
 * here from events and from a pull request's data, so the refusal is here, where the argument is built.
 */
function refArgument(name: string, what = 'ref'): string {
  // eslint-disable-next-line no-control-regex
  if (!name || name.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(name)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(name)}`)
  }
  return name
}

/** A stash a caller named by its position in the list */
function stashArgument(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid stash index: ${JSON.stringify(index)}`)
  return `stash@{${index}}`
}

/** A commit a caller named by its hash, whole or abbreviated */
function commitArgument(hash: string): string {
  if (!/^[0-9a-fA-F]{4,64}$/.test(hash)) throw new Error(`Invalid commit hash: ${JSON.stringify(hash)}`)
  return hash
}

/**
 * What every git child runs with. No credential prompt, since nobody is at a terminal to answer one; and no
 * optional locks, so a read made in the background (a status after a file changed) never holds `index.lock`
 * against a git the user or an agent runs in the same repository.
 */
const gitEnvironment = (): NodeJS.ProcessEnv =>
  ({ ...agentChildEnvironment(process.env), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' })

/** Thrown when a stash apply/pop succeeds partially but leaves conflicts. */
export class StashConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StashConflictError'
  }
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
}

function getImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return IMAGE_MIME_TYPES[ext] || null
}

interface GitCommandResult {
  success: boolean
  output?: string
  error?: string
}

interface GitCommandError extends Error {
  code?: number | string
  stdout?: string
  stderr?: string
}

interface CachedResult<T> {
  data: T
  timestamp: number
}

/** What the commit panel shows of a checkout, read in one pass */
export interface RepositorySnapshot {
  files: GitStatusFile[]
  /** The branch checked out, or `HEAD` when none is */
  branch: string
  /** Whether the branch tracks a remote branch that exists */
  hasUpstream: boolean
  ahead: number
  behind: number
}

function statusOf(code: string): GitStatusFile['status'] {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case '?': return 'untracked'
    case 'T': return 'typechange'
    case 'U': return 'unmerged'
    default: return 'modified'
  }
}

/** Reads `git status --porcelain=v2 --branch -z`: the branch headers and one record per changed path */
export function parseStatus(output: string): RepositorySnapshot {
  const snapshot: RepositorySnapshot = { files: [], branch: 'HEAD', hasUpstream: false, ahead: 0, behind: 0 }
  const records = output.split('\0')
  /** A record's path is everything after its fixed fields, since a path may hold spaces */
  const pathAfter = (record: string, fields: number): string => record.split(' ').slice(fields).join(' ')

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length)
      snapshot.branch = head === '(detached)' ? 'HEAD' : head
    } else if (record.startsWith('# branch.ab ')) {
      const [ahead, behind] = record.slice('# branch.ab '.length).split(' ')
      snapshot.hasUpstream = true
      snapshot.ahead = Math.abs(parseInt(ahead ?? '0', 10)) || 0
      snapshot.behind = Math.abs(parseInt(behind ?? '0', 10)) || 0
    } else if (record.startsWith('? ')) {
      snapshot.files.push({ path: record.slice(2), status: 'untracked', staged: false })
    } else if (record.startsWith('u ')) {
      // A conflict fills both the index and the worktree column: one row, not committable until resolved
      snapshot.files.push({ path: pathAfter(record, 10), status: 'unmerged', staged: false })
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const renamed = record.startsWith('2 ')
      const [index, worktree] = [record[2]!, record[3]!]
      const filePath = pathAfter(record, renamed ? 9 : 8)
      // A rename or copy is followed by the path it came from, as a record of its own
      const originalPath = renamed ? records[++i] : undefined
      if (index !== '.') {
        snapshot.files.push({
          path: filePath, status: statusOf(index), staged: true,
          originalPath: index === 'R' || index === 'C' ? originalPath : undefined,
        })
      }
      if (worktree !== '.') snapshot.files.push({ path: filePath, status: statusOf(worktree), staged: false, originalPath: undefined })
    }
  }
  return snapshot
}

export class GitRepository {
  private cache = new Map<string, CachedResult<any>>()
  private readonly CACHE_TTL = 5000 // 5 seconds
  private readonly PARENT_BRANCH_SEARCH_DEPTH = 25
  /** Serializes all git process invocations to prevent index.lock races. */
  private commandQueue: Promise<void> = Promise.resolve()
  private _writeInProgress = 0
  private _writeCompleteCallbacks: (() => void)[] = []
  private _lastFetchTimestamp = 0
  private _autoFetchEnabled = false
  private _fetchThrottleMs = 180_000
  /** The last snapshot read, with what it and the refs looked like, to tell a change from none */
  private snapshot?: { value: RepositorySnapshot; identity: string }
  /** Whether nothing has said the repository may have changed since `snapshot` was read */
  private snapshotFresh = false
  /** Counts every notice that the repository may have changed, so a read that one overtook is not kept as fresh */
  private snapshotVersion = 0
  private snapshotRead?: { version: number; promise: Promise<{ value: RepositorySnapshot; identity: string }> }
  /** What the last read looked like, `unreadable` when it failed */
  private lastIdentity?: string
  /** What the last `refreshSnapshot` saw, which is what its next one is compared with */
  private checkedIdentity?: string
  /** Whether a watcher reports this checkout's changes; without one a snapshot is read every time it is asked for */
  private watched = false
  private watchFailed = false

  constructor(private workingDirectory: string) {
    this.validateWorkingDirectory(workingDirectory)
  }

  getWorkingDir(): string {
    return this.workingDirectory
  }

  setFetchConfig(enabled: boolean, intervalSeconds: number): void {
    this._autoFetchEnabled = enabled
    this._fetchThrottleMs = intervalSeconds * 1000
  }

  get isWriteInProgress(): boolean {
    return this._writeInProgress > 0
  }

  /** Register a one-shot callback that fires when all pending writes finish. */
  onWriteComplete(callback: () => void): void {
    if (!this.isWriteInProgress) {
      callback()
    } else {
      this._writeCompleteCallbacks.push(callback)
    }
  }

  /** Run fn serially on the command queue (used by executeGitCommand). */
  private enqueueCommand<T>(fn: () => Promise<T>): Promise<T> {
    const op = this.commandQueue.then(fn, fn)
    this.commandQueue = op.then(() => {}, () => {})
    return op
  }

  /** Wrap a write operation to track write-in-progress for watcher suppression. */
  private async withWriteFlag<T>(fn: () => Promise<T>): Promise<T> {
    this._writeInProgress++
    try {
      return await fn()
    } finally {
      this.markSnapshotStale()
      this._writeInProgress--
      if (this._writeInProgress === 0 && this._writeCompleteCallbacks.length > 0) {
        const callbacks = this._writeCompleteCallbacks.splice(0)
        for (const cb of callbacks) {
          try { cb() } catch { /* ignore */ }
        }
      }
    }
  }

  private validateWorkingDirectory(dir: string): void {
    if (!path.isAbsolute(dir)) {
      throw new Error('Working directory must be an absolute path')
    }
    // We'll validate .git existence asynchronously on first command
  }
  
  
  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    
    const now = Date.now()
    if (now - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key)
      return null
    }
    
    return cached.data
  }
  
  private setCached<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }
  
  clearCache(): void {
    this.cache.clear()
    this.markSnapshotStale()
  }

  /** The repository may have changed: the next snapshot asked for is read from git */
  markSnapshotStale(): void {
    this.snapshotVersion++
    this.snapshotFresh = false
  }

  /**
   * Says whether a watcher reports this checkout's changes, which is what lets a snapshot be reused. `failed`
   * says its watches could not be opened or have stopped, as opposed to not being open yet or not being wanted.
   */
  setWatched(watched: boolean, failed = false): void {
    this.watched = watched
    this.watchFailed = failed
    this.markSnapshotStale()
  }

  get isWatched(): boolean {
    return this.watched
  }

  /** Whether this checkout's watches failed: a panel showing it then changes only when it is asked again */
  get hasWatchFailed(): boolean {
    return this.watchFailed
  }

  private async isDirectory(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.workingDirectory, filePath)
      const stats = await fs.stat(fullPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  // Invalidate specific cache entries when files change
  invalidateCache(paths?: string[]): void {
    if (!paths || paths.length === 0) {
      // Clear everything if no specific paths
      this.clearCache()
      return
    }
    
    // Always invalidate status when any file changes
    this.markSnapshotStale()
    
    // If .git files changed, invalidate branch-related caches
    if (paths.some(p => p.includes('.git'))) {
      this.cache.delete('baseBranch')
      this.cache.delete('prBaseBranch')
      this.cache.delete('gitRepoValidated')
    }
    
    // Invalidate binary file cache for changed files
    paths.forEach(path => {
      this.cache.delete(`binary:${path}`)
    })
  }

  private executeGitCommand(args: string[]): Promise<GitCommandResult> {
    return this.enqueueCommand(async () => {
      // Always add --color=never to prevent ANSI codes
      const colorlessArgs = ['-c', 'color.ui=never', ...args]

      try {
        // Ended when it stops working, not when a clock runs out: a fetch stalled on the network would
        // otherwise hold this repository's queue, and every later command with it, until the app restarts
        const { stdout } = await execFileWhileWorking('git', colorlessArgs, {
          cwd: this.workingDirectory,
          env: gitEnvironment(),
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer limit
          encoding: 'utf8'
        })

        return { success: true, output: stdout }
      } catch (error) {
        const gitError = error as GitCommandError

        // Special cases where non-zero exit codes are expected
        if (gitError.code === 1 && args[0] === 'diff') {
          return { success: true, output: gitError.stdout || '' }
        }
        if (gitError.code === 128 && args[0] === 'show') {
          return { success: true, output: '' }
        }

        return {
          success: false,
          error: gitError.stderr || gitError.message,
          output: gitError.stdout
        }
      }
    })
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result.success && result.output) {
      return result.output.trim()
    }
    throw new Error(result.error || 'Failed to get current branch')
  }

  async getStatus(): Promise<GitStatusFile[]> {
    return (await this.readSnapshot()).files
  }

  /**
   * The checkout's changed files, branch and distance from its upstream.
   *
   * A snapshot is reused until something says the repository may have changed: a watcher's event, a write made
   * here, a reconcile. With `fetch`, the remote is fetched first when the fetch settings say it is due.
   */
  async readSnapshot(options: { fetch?: boolean } = {}): Promise<RepositorySnapshot> {
    let current = await this.currentSnapshot()
    if (options.fetch && current.value.hasUpstream && await this.fetchIfStale()) {
      this.markSnapshotStale()
      current = await this.currentSnapshot()
    }
    return current.value
  }

  /**
   * Reads the snapshot from git and says whether it or any ref differs from the last one read. A watcher's
   * event is a hint that something changed; this is what decides whether anything did.
   */
  async refreshSnapshot(): Promise<boolean> {
    // Compared with what the last check saw, not with what was last read: one window's ask can read a change
    // before this runs, and this is what tells the others
    // Whether its watches failed is part of what a window shows of the checkout, so it is part of what changed
    const seen = (identity: string) => `${this.watchFailed ? 'unwatched' : 'watched'}\n${identity}`
    const before = this.checkedIdentity ?? (this.lastIdentity === undefined ? undefined : seen(this.lastIdentity))
    this.markSnapshotStale()
    let now: string
    try {
      now = seen((await this.currentSnapshot()).identity)
    } catch {
      now = seen(this.lastIdentity = 'unreadable')
    }
    this.checkedIdentity = now
    return now !== before
  }

  private currentSnapshot(): Promise<{ value: RepositorySnapshot; identity: string }> {
    if (this.snapshot && this.snapshotFresh && this.watched) return Promise.resolve(this.snapshot)
    if (this.snapshotRead?.version === this.snapshotVersion) return this.snapshotRead.promise

    const version = this.snapshotVersion
    const promise = this.loadSnapshot().then((loaded) => {
      this.snapshot = loaded
      this.lastIdentity = loaded.identity
      // A notice that arrived while git was running may be about a change this read did not see
      this.snapshotFresh = version === this.snapshotVersion
      return loaded
    }).finally(() => {
      if (this.snapshotRead?.promise === promise) this.snapshotRead = undefined
    })
    this.snapshotRead = { version, promise }
    return promise
  }

  private async loadSnapshot(): Promise<{ value: RepositorySnapshot; identity: string }> {
    // Every untracked file by name, which is what the panel lists — unless the user has told git to show
    // none, which is theirs to decide and is usually said of a repository too large to walk
    const shown = await this.executeGitCommand(['config', '--get', 'status.showUntrackedFiles'])
    const untracked = shown.success && shown.output?.trim() === 'no' ? 'no' : 'all'
    const status = await this.executeGitCommand(['status', '--porcelain=v2', '--branch', `--untracked-files=${untracked}`, '-z'])
    if (!status.success) {
      throw new Error(status.error || 'Failed to get git status')
    }
    // Refs move without the status moving: a fetch, a branch made or deleted, a stash
    const refs = await this.executeGitCommand(['for-each-ref', '--format=%(objectname) %(refname)'])
    return { value: parseStatus(status.output || ''), identity: `${status.output}\n${refs.output ?? ''}` }
  }

  /**
   * The directories git ignores under the working directory, relative to it: what a watcher of the working
   * tree need not report from.
   */
  async listIgnoredDirectories(): Promise<string[]> {
    const result = await this.executeGitCommand(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
    if (!result.success || !result.output) return []
    return result.output.split('\0').filter(entry => entry.endsWith('/')).map(entry => entry.slice(0, -1))
  }

  private async isBinaryFile(filePath: string): Promise<boolean> {
    // Check cache first
    const cacheKey = `binary:${filePath}`
    const cached = this.getCached<boolean>(cacheKey)
    if (cached !== null) return cached
    
    // First, try git's built-in binary detection
    const gitResult = await this.executeGitCommand(['check-attr', 'diff', '--', filePath])
    if (gitResult.success && gitResult.output) {
      // Git attributes format: "path: diff: value"
      const isBinary = gitResult.output.includes(': diff: binary') || 
                      gitResult.output.includes(': diff: -diff')
      if (isBinary) {
        this.setCached(cacheKey, true)
        return true
      }
    }
    
    // If git doesn't say it's binary, check if it's text according to git
    const diffStatResult = await this.executeGitCommand(['diff', '--numstat', '/dev/null', filePath])
    if (diffStatResult.success && diffStatResult.output) {
      // Binary files show as "-\t-\tfilename" in numstat
      if (diffStatResult.output.startsWith('-\t-\t')) {
        this.setCached(cacheKey, true)
        return true
      }
    }
    
    // Fallback to quick heuristic for untracked files
    try {
      const stats = await fs.stat(filePath)
      // Large files are likely binary
      if (stats.size > 1024 * 1024) {
        this.setCached(cacheKey, true)
        return true // > 1MB
      }
      
      // Only read first 512 bytes for performance
      const buffer = Buffer.alloc(512)
      const fd = await fs.open(filePath, 'r')
      try {
        const { bytesRead } = await fd.read(buffer, 0, 512, 0)
        if (bytesRead === 0) {
          this.setCached(cacheKey, false)
          return false
        }
        
        // Check for BOM (Byte Order Mark) for UTF-16/UTF-32
        if (bytesRead >= 2) {
          const bom16LE = buffer[0] === 0xFF && buffer[1] === 0xFE
          const bom16BE = buffer[0] === 0xFE && buffer[1] === 0xFF
          if (bom16LE || bom16BE) {
            this.setCached(cacheKey, false)
            return false // UTF-16 text file
          }
        }
        
        if (bytesRead >= 4) {
          const bom32LE = buffer[0] === 0xFF && buffer[1] === 0xFE && buffer[2] === 0x00 && buffer[3] === 0x00
          const bom32BE = buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xFE && buffer[3] === 0xFF
          if (bom32LE || bom32BE) {
            this.setCached(cacheKey, false)
            return false // UTF-32 text file
          }
        }
        
        // Check for null bytes (but skip if it might be UTF-16/32)
        let nullCount = 0
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 0) nullCount++
        }
        
        // If many nulls but not in UTF-16/32 pattern, it's binary
        if (nullCount > bytesRead * 0.3) {
          this.setCached(cacheKey, true)
          return true
        }
        
        // Check for high ratio of non-printable characters
        let nonPrintable = 0
        for (let i = 0; i < bytesRead; i++) {
          const byte = buffer[i]
          if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
            nonPrintable++
          }
        }
        
        const isBinary = nonPrintable / bytesRead > 0.3
        this.setCached(cacheKey, isBinary)
        return isBinary
      } finally {
        await fd.close()
      }
    } catch {
      this.setCached(cacheKey, false)
      return false
    }
  }

  async getDiff(filePath?: string, staged: boolean = false): Promise<string> {
    // For untracked files, we need to show the file content as an addition
    if (filePath) {
      const status = await this.getStatus()
      const fileStatus = status.find(f => f.path === filePath && f.staged === staged)

      if (fileStatus?.status === 'untracked') {
        return this.buildSyntheticDiff(filePath)
      }
    }

    const args = ['diff', '--binary', '-M']
    if (staged) {
      args.push('--cached')
    }
    if (filePath) {
      args.push('--', filePath)
    }

    const result = await this.executeGitCommand(args)
    if (!result.success) {
      throw new Error(result.error || 'Failed to get diff')
    }

    return result.output || ''
  }

  /**
   * Efficient multi-path diff: issues a single `git diff -- path1 path2 …`
   * for tracked files and builds synthetic diffs for untracked ones, avoiding
   * one git subprocess per file.
   */
  async getDiffMulti(paths: string[]): Promise<string> {
    const unique = [...new Set(paths)]
    const status = await this.getStatus()
    const untrackedSet = new Set(
      status.filter(f => f.status === 'untracked').map(f => f.path),
    )

    const tracked: string[] = []
    const untracked: string[] = []
    const external: string[] = []
    for (const p of unique) {
      if (path.isAbsolute(p) && !p.startsWith(this.workingDirectory + '/')) {
        external.push(p)
      } else if (untrackedSet.has(p)) {
        untracked.push(p)
      } else {
        tracked.push(p)
      }
    }

    const chunks: string[] = []

    // Single git command for all tracked files
    if (tracked.length > 0) {
      const args = ['diff', 'HEAD', '--binary', '-M', '--', ...tracked]
      const result = await this.executeGitCommand(args)
      if (!result.success) {
        throw new Error(result.error || 'Failed to get diff')
      }
      if (result.output) chunks.push(result.output)
    }

    // Synthetic diffs for untracked files (no git subprocess needed)
    for (const p of untracked) {
      chunks.push(await this.buildSyntheticDiff(p))
    }

    // Synthetic diffs for external (out-of-repo) files
    for (const p of external) {
      chunks.push(await this.buildSyntheticDiffAbsolute(p))
    }

    return chunks.filter(Boolean).join('\n')
  }

  /** Build a synthetic diff for an untracked file (new file / directory / binary). */
  private async buildSyntheticDiff(filePath: string): Promise<string> {
    const fullPath = path.join(this.workingDirectory, filePath)

    // Directory
    if (await this.isDirectory(filePath)) {
      return (
        `diff --git a/${filePath} b/${filePath}\n` +
        `new directory\n` +
        `Unable to show diff for directory\n`
      )
    }

    // Binary
    if (await this.isBinaryFile(fullPath)) {
      const relativePath = path.relative(this.workingDirectory, fullPath)
      return (
        `diff --git a/${relativePath} b/${relativePath}\n` +
        `new file mode 100644\n` +
        `index 0000000..0000000\n` +
        `Binary files /dev/null and b/${relativePath} differ\n`
      )
    }

    // Text file
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      const lines = content.split(/\r?\n/)
      const relativePath = path.relative(this.workingDirectory, fullPath)
      return (
        `diff --git a/${relativePath} b/${relativePath}\n` +
        `new file mode 100644\n` +
        `index 0000000..0000000\n` +
        `--- /dev/null\n` +
        `+++ b/${relativePath}\n` +
        `@@ -0,0 +1,${lines.length} @@\n` +
        lines.map(line => `+${line}`).join('\n')
      )
    } catch (error) {
      throw new Error(`Failed to read untracked file: ${error}`)
    }
  }

  /** Build a synthetic diff for a file outside the repository. */
  private async buildSyntheticDiffAbsolute(absPath: string): Promise<string> {
    try {
      const stat = await fs.stat(absPath)
      if (stat.isDirectory()) {
        return (
          `diff --git a/${absPath} b/${absPath}\n` +
          `new directory\n` +
          `Unable to show diff for directory\n`
        )
      }
    } catch {
      return ''
    }

    if (await this.isBinaryFile(absPath)) {
      return (
        `diff --git a/${absPath} b/${absPath}\n` +
        `new file mode 100644\n` +
        `index 0000000..0000000\n` +
        `Binary files /dev/null and b/${absPath} differ\n`
      )
    }

    try {
      const content = await fs.readFile(absPath, 'utf8')
      const lines = content.split(/\r?\n/)
      return (
        `diff --git a/${absPath} b/${absPath}\n` +
        `new file mode 100644\n` +
        `index 0000000..0000000\n` +
        `--- /dev/null\n` +
        `+++ b/${absPath}\n` +
        `@@ -0,0 +1,${lines.length} @@\n` +
        lines.map(line => `+${line}`).join('\n')
      )
    } catch {
      return ''
    }
  }

  async getFileContent(filePath: string, version: 'HEAD' | 'working' | 'index' = 'working'): Promise<string> {
    if (version === 'working') {
      // Working-tree reads don't touch the git index — no queue needed
      try {
        const relativePath = filePath.startsWith(this.workingDirectory)
          ? filePath.slice(this.workingDirectory.length + 1)
          : filePath

        if (await this.isDirectory(relativePath)) {
          return ''
        }

        const fullPath = path.join(this.workingDirectory, relativePath)
        return await fs.readFile(fullPath, 'utf8')
      } catch (error) {
        throw new Error(`Failed to read file: ${error}`)
      }
    } else {
      const relativePath = filePath.startsWith(this.workingDirectory)
        ? filePath.slice(this.workingDirectory.length + 1)
        : filePath
      const ref = version === 'HEAD' ? `HEAD:${relativePath}` : `:${relativePath}`
      const result = await this.executeGitCommand(['show', ref])
      if (!result.success) {
        return ''
      }
      return result.output || ''
    }
  }

  /**
   * Read a file as a base64 data URL if it's an image, otherwise return text content.
   * For git refs (HEAD/index), reads binary output from `git show`.
   */
  async getFileContentAsDataUrl(filePath: string, version: 'HEAD' | 'working' | 'index' = 'working'): Promise<string> {
    const mimeType = getImageMimeType(filePath)
    if (!mimeType) {
      return this.getFileContent(filePath, version)
    }

    const relativePath = filePath.startsWith(this.workingDirectory)
      ? filePath.slice(this.workingDirectory.length + 1)
      : filePath

    if (version === 'working') {
      try {
        const fullPath = path.join(this.workingDirectory, relativePath)
        const buffer = await fs.readFile(fullPath)
        return `data:${mimeType};base64,${buffer.toString('base64')}`
      } catch {
        return ''
      }
    }

    // For HEAD/index, use git show with binary-safe output
    const ref = version === 'HEAD' ? `HEAD:${relativePath}` : `:${relativePath}`
    try {
      const buffer = await this.executeGitCommandBinary(['show', ref])
      if (!buffer || buffer.length === 0) return ''
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch {
      return ''
    }
  }

  /**
   * Read a file from a branch as a base64 data URL if it's an image.
   */
  async getFileContentFromBranchAsDataUrl(filePath: string, branch: string): Promise<string> {
    const mimeType = getImageMimeType(filePath)
    if (!mimeType) {
      return this.getFileContentFromBranch(filePath, branch)
    }

    try {
      refArgument(branch, 'branch')
      const ref = filePath.includes(':') || filePath.startsWith('-')
        ? `${branch}:./${filePath}`
        : `${branch}:${filePath}`
      const buffer = await this.executeGitCommandBinary(['show', ref])
      if (!buffer || buffer.length === 0) return ''
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch {
      return ''
    }
  }

  /** Check if a file path is an image based on extension. */
  isImageFile(filePath: string): boolean {
    return getImageMimeType(filePath) !== null
  }

  /** Execute a git command and return raw binary buffer output. */
  private executeGitCommandBinary(args: string[]): Promise<Buffer> {
    return this.enqueueCommand(async () => {
      const colorlessArgs = ['-c', 'color.ui=never', ...args]
      // Read as latin1, which maps each byte to one character and back, so the bytes survive a text channel
      const { stdout } = await execFileWhileWorking('git', colorlessArgs, {
        cwd: this.workingDirectory,
        env: gitEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'latin1'
      })
      return Buffer.from(stdout, 'latin1')
    })
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['add', '--', ...filePaths])
      if (!result.success) {
        throw new Error(result.error || 'Failed to stage files')
      }
      this.markSnapshotStale()
    })
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['reset', 'HEAD', '--', ...filePaths])
      if (!result.success) {
        throw new Error(result.error || 'Failed to unstage files')
      }
      this.markSnapshotStale()
    })
  }

  async revertFile(filePath: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const status = await this.getStatus()
      const fileStatus = status.find(f => f.path === filePath)

      if (fileStatus?.status === 'untracked') {
        const fullPath = path.join(this.workingDirectory, filePath)
        await fs.unlink(fullPath)
      } else if (fileStatus?.status === 'unmerged') {
        // `git checkout --` refuses unmerged paths; explicit HEAD ref works
        // and clears the conflict state in both the index and worktree.
        const existsInHead = await this.fileExistsInHead(filePath)
        if (existsInHead) {
          const result = await this.executeGitCommand(['checkout', 'HEAD', '--', filePath])
          if (!result.success) {
            throw new Error(result.error || `Failed to revert file: ${filePath}`)
          }
        } else {
          // File was added by stash/merge — delete it and clean the index entry
          const fullPath = path.join(this.workingDirectory, filePath)
          await fs.unlink(fullPath)
          await this.executeGitCommand(['rm', '--cached', '--force', '--', filePath])
        }
      } else {
        const result = await this.executeGitCommand(['checkout', '--', filePath])
        if (!result.success) {
          throw new Error(result.error || `Failed to revert file: ${filePath}`)
        }
      }
      this.markSnapshotStale()
    })
  }

  async revertFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    return this.withWriteFlag(async () => {
      const status = await this.getStatus()
      const statusMap = new Map(status.map(f => [f.path, f.status]))

      const untrackedPaths = filePaths.filter(p => statusMap.get(p) === 'untracked')
      const unmergedPaths = filePaths.filter(p => statusMap.get(p) === 'unmerged')
      const trackedPaths = filePaths.filter(p => {
        const s = statusMap.get(p)
        return s !== 'untracked' && s !== 'unmerged'
      })

      // Delete untracked files
      for (const filePath of untrackedPaths) {
        const fullPath = path.join(this.workingDirectory, filePath)
        await fs.unlink(fullPath)
      }

      // Revert unmerged files — split by whether they exist in HEAD
      if (unmergedPaths.length > 0) {
        const existsInHead: string[] = []
        const newFiles: string[] = []
        for (const p of unmergedPaths) {
          if (await this.fileExistsInHead(p)) {
            existsInHead.push(p)
          } else {
            newFiles.push(p)
          }
        }
        if (existsInHead.length > 0) {
          const result = await this.executeGitCommand(['checkout', 'HEAD', '--', ...existsInHead])
          if (!result.success) {
            throw new Error(result.error || 'Failed to revert unmerged files')
          }
        }
        for (const p of newFiles) {
          const fullPath = path.join(this.workingDirectory, p)
          await fs.unlink(fullPath)
          await this.executeGitCommand(['rm', '--cached', '--force', '--', p])
        }
      }

      // Revert tracked files
      if (trackedPaths.length > 0) {
        const result = await this.executeGitCommand(['checkout', '--', ...trackedPaths])
        if (!result.success) {
          throw new Error(result.error || 'Failed to revert files')
        }
      }

      this.markSnapshotStale()
    })
  }

  async fileExistsInHead(filePath: string): Promise<boolean> {
    const result = await this.executeGitCommand(['cat-file', '-e', `HEAD:${filePath}`])
    return result.success
  }

  async resolveConflict(filePath: string, strategy: 'ours' | 'theirs'): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['checkout', `--${strategy}`, '--', filePath])
      if (!result.success) {
        throw new Error(result.error || `Failed to resolve conflict with ${strategy}`)
      }
      await this.executeGitCommand(['add', '--', filePath])
      this.markSnapshotStale()
    })
  }

  async commit(message: string): Promise<void> {
    if (!message.trim()) {
      throw new Error('Commit message cannot be empty')
    }
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['commit', '-m', message])
      if (!result.success) {
        throw new Error(result.error || 'Failed to commit')
      }
    })
  }

  /**
   * Where this checkout's git state lives: its own git directory (index, HEAD) and the common one holding refs.
   * The two differ in a linked worktree. Null when the working directory is in no repository.
   */
  async resolveGitDirectories(): Promise<{ gitDir: string; commonDir: string } | null> {
    const result = await this.executeGitCommand(['rev-parse', '--git-dir', '--git-common-dir'])
    const [gitDir, commonDir] = (result.success ? result.output ?? '' : '').split('\n').map(line => line.trim())
    if (!gitDir || !commonDir) return null
    return {
      gitDir: path.resolve(this.workingDirectory, gitDir),
      commonDir: path.resolve(this.workingDirectory, commonDir),
    }
  }

  async isGitRepository(): Promise<boolean> {
    const result = await this.executeGitCommand(['rev-parse', '--git-dir'])
    return result.success
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.getStatus()
    return status.length > 0
  }

  async getStagedFiles(): Promise<GitStatusFile[]> {
    const status = await this.getStatus()
    return status.filter(file => file.staged)
  }

  async getUpstreamBranch(): Promise<string | null> {
    const result = await this.executeGitCommand(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])

    if (!result.success) {
      return null
    }

    if (result.output) {
      const upstream = result.output.trim()
      const parts = upstream.split('/')
      if (parts.length >= 2) {
        return parts.slice(1).join('/')
      }
    }
    return null
  }

  async getBaseBranch(options?: { preferUpstream?: boolean }): Promise<string> {
    const preferUpstream = options?.preferUpstream !== false

    const cacheKey = preferUpstream ? 'baseBranch:preferUpstream' : 'baseBranch'
    const cached = this.getCached<string>(cacheKey)
    if (cached) return cached

    if (preferUpstream) {
      try {
        const upstream = await this.getUpstreamBranch()
        if (upstream) {
          this.setCached(cacheKey, upstream)
          return upstream
        }
      } catch (error) {
        logger.warn('Failed to get upstream branch', { error })
      }
    }

    const originHeadResult = await this.executeGitCommand(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if (originHeadResult.success && originHeadResult.output) {
      const branch = originHeadResult.output.trim().replace(/^origin\//, '')
      if (branch) {
        this.setCached(cacheKey, branch)
        return branch
      }
    }

    for (const branch of ['main', 'master', 'develop', 'development']) {
      const result = await this.executeGitCommand(['rev-parse', '--verify', branch])
      if (result.success) {
        this.setCached(cacheKey, branch)
        return branch
      }
    }

    throw new Error('Could not determine base branch')
  }

  async getPRBaseBranch(): Promise<string> {
    const cached = this.getCached<string>('prBaseBranch')
    if (cached) return cached

    const defaultBase = await this.getBaseBranch({ preferUpstream: false })

    // Try to find a closer parent branch via merge-base distance
    try {
      const closestParent = await this.findClosestParentBranch(defaultBase)
      if (closestParent) {
        this.setCached('prBaseBranch', closestParent)
        return closestParent
      }
    } catch {
      // Fall through to default
    }

    this.setCached('prBaseBranch', defaultBase)
    return defaultBase
  }

  /**
   * Find the closest parent branch by comparing merge-base distances.
   * When branching feature-B from feature-A, feature-A will have a much
   * smaller commit distance than main/master.
   */
  private async findClosestParentBranch(defaultBase: string): Promise<string | null> {
    const currentBranch = await this.getCurrentBranch()

    // Only check branches whose tip is within recent commits AND merged into HEAD
    const candidates = await this.getNearbyMergedBranches(this.PARENT_BRANCH_SEARCH_DEPTH)
    const filtered = candidates.filter(b =>
      b !== currentBranch && b !== defaultBase && b !== 'HEAD'
    )
    if (filtered.length === 0) return null

    // For merged branches, tip = merge-base, so rev-list --count <branch>..HEAD gives distance directly
    const [defaultDistance, ...distances] = await Promise.all([
      this.getCommitDistance(defaultBase),
      ...filtered.map(b => this.getCommitDistance(b)),
    ])

    if (defaultDistance <= 0) return null

    let closestBranch: string | null = null
    let closestDistance = defaultDistance

    for (let i = 0; i < filtered.length; i++) {
      const distance = distances[i]
      if (distance > 0 && distance < closestDistance) {
        closestDistance = distance
        closestBranch = filtered[i]
      }
    }

    return closestBranch
  }

  private async getCommitDistance(branch: string): Promise<number> {
    const result = await this.executeGitCommand(['rev-list', '--count', `${branch}..HEAD`])
    if (!result.success || !result.output) return Infinity
    return parseInt(result.output.trim(), 10)
  }

  private async getNearbyMergedBranches(depth: number): Promise<string[]> {
    const result = await this.executeGitCommand([
      'branch', '--merged', 'HEAD', '--contains', `HEAD~${depth}`, '--format=%(refname:short)',
    ])
    if (!result.success || !result.output) {
      // Falls back to all merged branches if HEAD~N is invalid (e.g., repo has < N commits)
      const fallback = await this.executeGitCommand([
        'branch', '--merged', 'HEAD', '--format=%(refname:short)',
      ])
      if (!fallback.success || !fallback.output) return []
      return fallback.output.trim().split('\n').filter(Boolean)
    }
    return result.output.trim().split('\n').filter(Boolean)
  }

  async getBranchDiff(baseBranch: string, targetBranch?: string): Promise<GitStatusFile[]> {
    const target = targetBranch || 'HEAD'
    
    // Get the list of changed files between branches with NUL termination and rename detection
    const result = await this.executeGitCommand(['diff', '--name-status', '-z', '-M', '-C', `${refArgument(baseBranch, 'base branch')}...${refArgument(target, 'branch')}`])
    if (!result.success) {
      throw new Error(result.error || 'Failed to get branch diff')
    }
    
    const files: GitStatusFile[] = []
    const parts = (result.output || '').split('\0').filter(Boolean)
    
    for (let i = 0; i < parts.length; ) {
      const statusPart = parts[i++]
      if (!statusPart || i >= parts.length) break
      
      // Status is just a letter (M, A, D, R, C, T, U)
      const status = statusOf(statusPart.charAt(0))
      const path = parts[i++]
      
      if (!path) continue
      
      // For renames and copies, there's a second path
      if ((statusPart.startsWith('R') || statusPart.startsWith('C')) && i < parts.length && parts[i]) {
        const originalPath = path
        const newPath = parts[i++]
        files.push({
          path: newPath,
          status,
          staged: false,
          originalPath
        })
      } else {
        files.push({
          path,
          status,
          staged: false
        })
      }
    }
    
    return files
  }

  async getFileDiffBetweenBranches(filePath: string, baseBranch: string, targetBranch?: string): Promise<string> {
    const target = targetBranch || 'HEAD'
    
    // Validate branch names to prevent injection
    if (!/^[a-zA-Z0-9._/-]+$/.test(baseBranch) || !/^[a-zA-Z0-9._/-]+$/.test(target)) {
      throw new Error('Invalid branch name')
    }
    refArgument(baseBranch, 'base branch')
    refArgument(target, 'branch')
    
    const result = await this.executeGitCommand(['diff', '--binary', '-M', `${baseBranch}...${target}`, '--', filePath])
    if (!result.success) {
      throw new Error(result.error || 'Failed to get file diff between branches')
    }
    
    return result.output || ''
  }

  async getFileContentFromBranch(filePath: string, branch: string): Promise<string> {
    // For files with special characters, we need to be careful
    // If the path contains colons or starts with -, we need special handling
    let result: GitCommandResult
    
    if (filePath.includes(':') || filePath.startsWith('-')) {
      // Use the rev:./path syntax which is safer for special characters
      result = await this.executeGitCommand(['show', `${refArgument(branch, 'branch')}:./${filePath}`])
    } else {
      // Standard format for normal paths
      result = await this.executeGitCommand(['show', `${refArgument(branch, 'branch')}:${filePath}`])
    }
    
    if (!result.success) {
      // File might not exist in that branch - this is not an error
      return ''
    }
    return result.output || ''
  }

  async fetchRemoteBranch(branch: string): Promise<void> {
    return this.withWriteFlag(async () => {
      await this.executeGitCommand(['fetch', 'origin', refArgument(branch, 'branch')])
    })
  }

  async deleteRemoteBranch(branch: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['push', 'origin', '--delete', refArgument(branch, 'branch')])
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete remote branch')
      }
    })
  }

  async getAllBranches(): Promise<string[]> {
    // Get all local and remote branches
    const result = await this.executeGitCommand(['branch', '-a', '--no-color', '--sort=-committerdate'])
    if (!result.success) {
      throw new Error(result.error || 'Failed to get branches')
    }
    
    // Parse the output to extract branch names
    const branches = (result.output || '')
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Remove the current branch marker (*) and any leading/trailing whitespace
        line = line.trim().replace(/^\*\s*/, '')
        
        // Handle remote branches - remove "remotes/origin/" prefix
        if (line.startsWith('remotes/origin/')) {
          // Skip HEAD pointer
          if (line.includes('HEAD ->')) return null
          return line.replace('remotes/origin/', '')
        }
        
        return line
      })
      .filter((branch): branch is string => branch !== null)
      
    // Case-insensitive dedup — prefer remote names (correct case from server) over local names
    // Since git branch -a lists local first then remote, a remote duplicate overwrites a wrong-case local entry
    const seen = new Map<string, string>()
    for (const branch of branches) {
      seen.set(branch.toLowerCase(), branch)
    }
    return [...seen.values()]
  }

  async checkoutBranch(branchName: string): Promise<void> {
    if (!branchName.trim()) {
      throw new Error('Branch name cannot be empty')
    }
    
    // Validate branch name to prevent command injection
    if (branchName.startsWith('-') || !/^[a-zA-Z0-9._/-]+$/.test(branchName)) {
      throw new Error('Invalid branch name. Branch names can only contain letters, numbers, dots, underscores, hyphens, and forward slashes.')
    }
    
    return this.withWriteFlag(async () => {
      // Try to checkout the branch
      const result = await this.executeGitCommand(['checkout', branchName])

      if (!result.success) {
        // Check if it's because the branch doesn't exist locally or can't be resolved
        if (
          (result.error?.includes('pathspec') && result.error?.includes('did not match')) ||
          result.error?.includes('cannot be resolved')
        ) {
          // Try to create a new branch tracking the remote
          const remoteResult = await this.executeGitCommand(['checkout', '-b', branchName, `origin/${branchName}`])
          if (!remoteResult.success) {
            // If that fails too, just create a new local branch
            const newBranchResult = await this.executeGitCommand(['checkout', '-b', branchName])
            if (!newBranchResult.success) {
              throw new Error(newBranchResult.error || `Failed to create branch: ${branchName}`)
            }
          }
        } else if (result.error?.includes('Your local changes to the following files would be overwritten')) {
          // Git is preventing checkout due to conflicts
          throw new Error('Cannot switch branches: Your uncommitted changes conflict with files in the target branch. Please commit, stash, or discard your changes first.')
        } else {
          throw new Error(result.error || `Failed to checkout branch: ${branchName}`)
        }
      }

      // After successful checkout, pull latest (best-effort)
      try {
        const hasUpstream = await this.isCurrentBranchPublished()
        if (hasUpstream) {
          await this.executeGitCommand(['pull'])
        }
      } catch {
        // Pull failed (network issue, etc.) — checkout still succeeded, so ignore
      }

      // Clear cache after branch switch
      this.clearCache()
    })
  }

  async isCurrentBranchPublished(): Promise<boolean> {
    try {
      const upstream = await this.getUpstreamBranch()
      return upstream !== null
    } catch {
      // If there's an error checking upstream, assume unpublished
      return false
    }
  }

  private _forceFetchNext = false

  /**
   * Force a fetch on the next getCommitsAheadBehind() call,
   * regardless of the auto-fetch toggle or throttle timer.
   */
  forceFetchOnce(): void {
    this._forceFetchNext = true
  }

  /** Fetches when a fetch was forced or the fetch settings say one is due, and says whether it did */
  private async fetchIfStale(): Promise<boolean> {
    if (this._forceFetchNext) {
      this._forceFetchNext = false
      this._lastFetchTimestamp = Date.now()
      await this.executeGitCommand(['fetch', '--quiet'])
      return true
    }
    if (!this._autoFetchEnabled) return false
    const now = Date.now()
    if (now - this._lastFetchTimestamp < this._fetchThrottleMs) return false
    this._lastFetchTimestamp = now
    await this.executeGitCommand(['fetch', '--quiet'])
    return true
  }

  async getCommitsAheadBehind(): Promise<{ ahead: number; behind: number }> {
    try {
      // Check if we have an upstream branch
      const upstream = await this.getUpstreamBranch()
      if (!upstream) {
        return { ahead: 0, behind: 0 }
      }

      // Fetch remote refs at most once per minute so @{u} stays reasonably fresh
      await this.fetchIfStale()

      // Count commits ahead
      const aheadResult = await this.executeGitCommand(['rev-list', '--count', '@{u}..HEAD'])
      const ahead = aheadResult.success ? parseInt(aheadResult.output?.trim() || '0', 10) : 0
      
      // Count commits behind
      const behindResult = await this.executeGitCommand(['rev-list', '--count', 'HEAD..@{u}'])
      const behind = behindResult.success ? parseInt(behindResult.output?.trim() || '0', 10) : 0
      
      return { ahead, behind }
    } catch (error) {
      // Log the error for debugging
      logger.error('getCommitsAheadBehind failed', { error })
      // If there's an error, return zeros
      return { ahead: 0, behind: 0 }
    }
  }

  async pushBranch(): Promise<void> {
    return this.withWriteFlag(async () => {
      // Check if branch is published
      const isPublished = await this.isCurrentBranchPublished()

      // Use appropriate push command
      // Use HEAD instead of branch name for unpublished branches to avoid
      // case-sensitivity issues on macOS (git push -u origin <name> fails
      // when the ref case doesn't match the filesystem case)
      const args = isPublished
        ? ['push']
        : ['push', '-u', 'origin', 'HEAD']

      const result = await this.executeGitCommand(args)

      if (!result.success) {
        // Check for common errors
        if (result.error?.includes('Could not read from remote repository')) {
          throw new Error('Failed to push: Cannot connect to remote repository. Check your network connection and repository access.')
        } else if (result.error?.includes('remote: Permission')) {
          throw new Error('Failed to push: Permission denied. Check your repository access rights.')
        } else if (result.error?.includes('non-fast-forward')) {
          throw new Error('Failed to push: Remote branch has diverged. Pull changes first.')
        } else if (result.error?.includes('Everything up-to-date')) {
          throw new Error('Everything up-to-date. No commits to push.')
        } else {
          throw new Error(result.error || 'Failed to push changes')
        }
      }

      // Clear cache and reset fetch timer (push updates remote refs)
      this.clearCache()
      this._lastFetchTimestamp = Date.now()
    })
  }

  async pullBranch(): Promise<void> {
    return this.withWriteFlag(async () => {
      // Check if we have an upstream branch
      const hasUpstream = await this.isCurrentBranchPublished()
      if (!hasUpstream) {
        throw new Error('No upstream branch to pull from. Push your branch first.')
      }

      // Execute git pull
      const result = await this.executeGitCommand(['pull'])

      if (!result.success) {
        // Handle common pull errors
        if (result.error?.includes('Automatic merge failed')) {
          throw new Error('Failed to pull: Merge conflicts detected. Resolve conflicts and commit.')
        } else if (result.error?.includes('Your local changes')) {
          throw new Error('Failed to pull: You have uncommitted changes. Commit or stash them first.')
        } else if (result.error?.includes('Could not read from remote repository')) {
          throw new Error('Failed to pull: Cannot connect to remote repository. Check your network connection.')
        } else if (result.error?.includes('Permission denied')) {
          throw new Error('Failed to pull: Permission denied. Check your repository access rights.')
        } else if (result.error?.includes('Already up to date')) {
          // This is actually okay - no changes to pull
          return
        } else {
          throw new Error(result.error || 'Failed to pull changes')
        }
      }

      // Clear cache and reset fetch timer (pull already fetched remote refs)
      this.clearCache()
      this._lastFetchTimestamp = Date.now()
    })
  }

  // --- Stash operations ---

  async stashPush(message?: string, stagedOnly?: boolean): Promise<string> {
    return this.withWriteFlag(async () => {
      const args = ['stash', 'push']
      if (message) {
        args.push('-m', message)
      }
      if (stagedOnly) {
        args.push('--staged')
      } else {
        args.push('--include-untracked')
      }
      const result = await this.executeGitCommand(args)
      if (!result.success) {
        throw new Error(result.error || 'Failed to stash changes')
      }
      this.clearCache()
      return result.output || 'Changes stashed'
    })
  }

  async stashList(): Promise<StashEntry[]> {
    const result = await this.executeGitCommand(['stash', 'list', '--format=%gd|||%s|||%ai'])
    if (!result.success) {
      // Empty stash list is not an error
      if (result.error?.includes('unknown revision')) return []
      throw new Error(result.error || 'Failed to list stashes')
    }
    if (!result.output?.trim()) return []

    return result.output.trim().split('\n').map((line, i) => {
      const parts = line.split('|||')
      return {
        index: i,
        ref: parts[0] || `stash@{${i}}`,
        message: parts[1] || '',
        date: parts[2] || ''
      }
    })
  }

  async stashApply(index: number): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'apply', stashArgument(index)])
      if (!result.success) {
        if (this.isStashConflict(result)) {
          // Stash was applied — unmerged files now exist. Refresh cache so
          // the UI picks them up, then signal the conflict upward.
          this.clearCache()
          throw new StashConflictError(result.error || 'Stash applied with conflicts')
        }
        throw new Error(result.error || 'Failed to apply stash')
      }
      this.clearCache()
    })
  }

  async stashPop(index: number): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'pop', stashArgument(index)])
      if (!result.success) {
        if (this.isStashConflict(result)) {
          // `git stash pop` with conflicts leaves the stash in place and
          // still applies unmerged files — refresh cache and signal conflict.
          this.clearCache()
          throw new StashConflictError(result.error || 'Stash popped with conflicts — stash retained')
        }
        throw new Error(result.error || 'Failed to pop stash')
      }
      this.clearCache()
    })
  }

  private isStashConflict(result: { success: boolean; error?: string; output?: string }): boolean {
    if (result.success) return false
    const text = `${result.error || ''}\n${result.output || ''}`
    return /CONFLICT|Merge conflict/i.test(text)
  }

  async stashDrop(index: number): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'drop', stashArgument(index)])
      if (!result.success) {
        throw new Error(result.error || 'Failed to drop stash')
      }
    })
  }

  async stashClear(): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'clear'])
      if (!result.success) {
        throw new Error(result.error || 'Failed to clear stashes')
      }
    })
  }

  // ── Worktree operations ──────────────────────────────────────────

  async worktreeList(): Promise<import('../types.ts').WorktreeEntry[]> {
    const result = await this.executeGitCommand(['worktree', 'list', '--porcelain'])
    if (!result.success || !result.output?.trim()) return []

    const entries: import('../types.ts').WorktreeEntry[] = []
    const blocks = result.output.trim().split('\n\n')

    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].trim().split('\n')
      let wtPath = ''
      let head = ''
      let branch = ''
      let isBare = false
      let isLocked = false
      let lockedReason: string | undefined

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice('worktree '.length)
        } else if (line.startsWith('HEAD ')) {
          head = line.slice('HEAD '.length).substring(0, 7)
        } else if (line.startsWith('branch ')) {
          // branch refs/heads/main → main
          branch = line.slice('branch '.length).replace('refs/heads/', '')
        } else if (line === 'bare') {
          isBare = true
        } else if (line === 'detached') {
          branch = ''
        } else if (line.startsWith('locked')) {
          isLocked = true
          const reason = line.slice('locked'.length).trim()
          if (reason) lockedReason = reason
        }
      }

      if (wtPath) {
        entries.push({
          path: wtPath,
          head,
          branch,
          isBare,
          isCurrent: path.resolve(wtPath) === path.resolve(this.workingDirectory),
          isMain: i === 0,
          isLocked,
          lockedReason
        })
      }
    }

    return entries
  }

  async worktreeAdd(wtPath: string, branch?: string, createBranch?: boolean): Promise<string> {
    return this.withWriteFlag(async () => {
      const args = ['worktree', 'add']
      if (createBranch && branch) {
        args.push('-b', refArgument(branch, 'branch'), '--', wtPath)
      } else if (branch) {
        args.push('--', wtPath, refArgument(branch, 'branch'))
      } else {
        args.push('--', wtPath)
      }

      const result = await this.executeGitCommand(args)
      if (!result.success) {
        throw new Error(result.error || 'Failed to add worktree')
      }
      return wtPath
    })
  }

  async worktreeRemove(wtPath: string, force?: boolean): Promise<void> {
    return this.withWriteFlag(async () => {
      const args = ['worktree', 'remove']
      if (force) args.push('--force')
      args.push('--', wtPath)

      const result = await this.executeGitCommand(args)
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove worktree')
      }
    })
  }

  async getCommitsBetweenBranches(baseBranch: string, targetBranch = 'HEAD'): Promise<{ subject: string; body: string }[]> {
    const separator = '---COMMIT_SEP---'
    const result = await this.executeGitCommand([
      'log', `${refArgument(baseBranch, 'base branch')}..${refArgument(targetBranch, 'branch')}`,
      `--format=%s${separator}%b${separator}`,
      '--reverse'
    ])
    if (!result.success || !result.output?.trim()) return []

    return result.output
      .split(separator + '\n')
      .filter(chunk => chunk.trim())
      .map(chunk => {
        const parts = chunk.split(separator)
        return {
          subject: (parts[0] || '').trim(),
          body: (parts[1] || '').trim()
        }
      })
      .filter(c => c.subject)
  }

  // --- Commit log operations ---

  async gitLog(count = 50): Promise<CommitLogEntry[]> {
    const separator = '|||'
    const recordSep = '---RECORD_SEP---'
    const format = [
      '%H', '%h', '%s', '%b', '%an', '%ae', '%aI', '%D'
    ].join(separator)
    const result = await this.executeGitCommand([
      'log', `-n${count}`,
      `--format=${format}${recordSep}`,
    ])
    if (!result.success || !result.output?.trim()) return []

    return result.output
      .split(recordSep)
      .filter(chunk => chunk.trim())
      .map(chunk => {
        const parts = chunk.trim().split(separator)
        return {
          hash: (parts[0] || '').trim(),
          shortHash: (parts[1] || '').trim(),
          subject: (parts[2] || '').trim(),
          body: (parts[3] || '').trim(),
          authorName: (parts[4] || '').trim(),
          authorEmail: (parts[5] || '').trim(),
          date: (parts[6] || '').trim(),
          refs: (parts[7] || '').trim(),
        }
      })
      .filter(c => c.hash)
  }

  async revertCommit(hash: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['revert', '--no-edit', commitArgument(hash)])
      if (!result.success) {
        throw new Error(result.error || `Failed to revert commit ${hash}`)
      }
      this.clearCache()
    })
  }

  async resetToCommit(hash: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['reset', commitArgument(hash)])
      if (!result.success) {
        throw new Error(result.error || `Failed to reset to commit ${hash}`)
      }
      this.clearCache()
    })
  }
}