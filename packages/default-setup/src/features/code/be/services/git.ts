import * as path from 'path'
import * as fs from 'fs/promises'
import { watch } from 'fs'
import { REPOSITORY_PARTS } from '../types.ts'
import type { ConflictKind, DiffHunk, GitStatusFile, StashEntry, CommitLogEntry, OperationMove, RepositoryChange, RepositoryOperation, RepositoryPart } from '../types.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { agentChildEnvironment } from './shell-environment.ts'
import { GitError, LOCKED, classifyGitError, type GitErrorCode } from './git-errors.ts'
import { signInHelpFor, type SignInHelp } from './sign-in.ts'
import { GitObjectReader } from './git-objects.ts'
import { hunksOf } from './git-hunks.ts'

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

/**
 * The records of a listing whose fields are separated by NUL and whose records, under `-z`, end with one: every
 * `fields` values are one record. NUL is the one byte a commit message, a ref or a path cannot hold, so no
 * subject or body can be mistaken for a separator.
 */
function recordsOf(output: string, fields: number): string[][] {
  const values = output.split('\0')
  const records: string[][] = []
  for (let i = 0; i + fields <= values.length; i += fields) records.push(values.slice(i, i + fields))
  return records
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
 * What every git child runs with. No credential prompt, since nobody is at a terminal to answer one; no editor
 * for the same reason, so where git would open one for a message it takes the message it proposes; and no
 * optional locks, so a read made in the background (a status after a file changed) never holds `index.lock`
 * against a git the user or an agent runs in the same repository.
 */
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...agentChildEnvironment(process.env),
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_OPTIONAL_LOCKS: '0',
  // Git translates its messages, and what a failure means is read from them here: in English, whatever the
  // user's locale is
  LANGUAGE: 'en',
  LC_ALL: 'en_US.UTF-8',
  LANG: 'en_US.UTF-8',
})

/** What a caller is told when there is no git to run */
const GIT_NOT_INSTALLED = 'Git is not installed. Please install Git to use version control features.'

/**
 * How long a command waits for another git to let go of a lock before it is given up on.
 *
 * It is a clock because the other git is a process this one cannot read: there is no work of its to watch,
 * only the lock, which is there until it is not. A git in a terminal or an agent's holds one for moments. One
 * held for longer than this is a commit in a very large repository, or what a git that stopped part-way left
 * behind, and either is said to whoever asked.
 */
const LOCK_PATIENCE_MS = 10_000

/**
 * Whether another git let go of this lock: `true` once the lock is gone, `false` when it is still there after
 * `patienceMs`, counted from when it was taken. A lock already older than that is not about to be let go of,
 * and is answered at once.
 *
 * **The lock file itself is watched, and looked for again once the event loop has been round.** A watch is not
 * in place when `watch` returns. A file's is put in place the next time the loop waits; a directory's, on macOS,
 * by a stream that starts on another thread some time later. A lock let go of before its watch is in place is
 * reported by nobody, and most are let go of within moments, so a command waited out its whole patience for a
 * lock that was gone. Looking again after the loop has waited once finds that one, and the watch reports any
 * later.
 */
function lockReleased(lock: string, patienceMs: number): Promise<boolean> {
  const takenAt = () => fs.stat(lock).then(stat => stat.mtimeMs, () => undefined)
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let watcher: ReturnType<typeof watch> | undefined
    const settle = (released: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher?.close()
      resolve(released)
    }
    /** Gone, the lock was let go of. Still there after it was renamed or deleted, another git took it at once */
    const look = (retaken: 'follow' | 'leave') => {
      void takenAt().then((taken) => {
        if (taken === undefined) settle(true)
        else if (retaken === 'follow' && !settled) follow()
      })
    }
    const follow = () => {
      watcher?.close()
      try {
        // Written to, it is still held: only its being renamed or deleted says anything
        watcher = watch(lock, { persistent: false }, (change) => { if (change === 'rename') look('follow') })
        watcher.on('error', () => settle(false))
      } catch {
        // Nothing there to watch: it was let go of already
        return settle(true)
      }
      // Two turns, since the first of these runs before the loop next waits and the second after
      setImmediate(() => setImmediate(() => look('leave')))
    }
    follow()
    void takenAt().then((taken) => {
      if (taken === undefined) return settle(true)
      // No longer than the patience itself, whatever a clock that disagrees with this one stamped the lock with
      const left = Math.min(patienceMs, patienceMs - (Date.now() - taken))
      if (left <= 0) return settle(false)
      timer = setTimeout(() => settle(false), left)
    })
  })
}

/** What is said of a lock another git did not let go of, in place of git's own half page */
const heldLockMessage = (lock: string) =>
  `Another git process is using this repository and has not let go of it: ${lock} is still there. `
  + 'Try again once it has finished. If no git is running, one that stopped part-way left that file behind, and deleting it lets git carry on.'

/**
 * How long git's output may stay silent after git itself has exited before its pipes are given up on. A hook
 * that leaves a process running in the background leaves it holding those pipes, and they would otherwise stay
 * open, and the command unanswered, for as long as that process lives.
 */
const EXIT_GRACE_MS = 250

/** The most changed files a snapshot lists; past it the list is cut and says so */
export const STATUS_LIMIT = 10_000

/** Subcommands that only read, which wait for nothing: no lock is taken, as `GIT_OPTIONAL_LOCKS` says */
const READS = new Set(['status', 'rev-parse', 'for-each-ref', 'ls-files', 'check-attr', 'diff', 'show', 'cat-file', 'rev-list', 'symbolic-ref', 'log', 'branch'])
/** Subcommands that talk to a remote and touch no index, which wait only for each other */
const NETWORK = new Set(['fetch', 'push'])

/** Which commands a command waits behind: none for a read, the other remote commands, or the other writes */
function laneOf(args: string[]): 'read' | 'network' | 'write' {
  const [command, verb] = args
  if (READS.has(command!) || (command === 'config' && (verb === '--get' || verb === '--get-regexp'))) return 'read'
  if ((command === 'stash' || command === 'worktree') && verb === 'list') return 'read'
  // The address a remote is configured with, which is read from the config and asks the remote nothing
  if (command === 'ls-remote' && verb === '--get-url') return 'read'
  return NETWORK.has(command!) ? 'network' : 'write'
}

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
  /** Git printed more than is read, so `output` is its beginning */
  truncated?: boolean
  /** There is no git to run */
  missing?: boolean
  /** Why it failed, where what git printed says */
  code?: GitErrorCode
}

/** What a push or a pull that failed is said to have failed on, for the reasons that have plainer words than git's */
function saidOfRemote(result: GitCommandResult): string | undefined {
  switch (result.code) {
    case 'authentication': return 'The remote asked for a sign-in that git does not have.'
    case 'permission': return 'Permission denied. Check your repository access rights.'
    case 'remote-unreachable': return 'Cannot connect to remote repository. Check your network connection and the remote\'s address.'
    case 'non-fast-forward': return 'Remote branch has diverged. Pull changes first.'
    case 'diverged': return 'This branch and the remote branch have both moved on, and git is not set to merge or rebase them on a pull. Merge or rebase from a terminal, or set `pull.rebase` or `pull.ff` in git\'s config.'
    case 'conflict': return 'Merge conflicts detected. Resolve conflicts and commit.'
    case 'local-changes': return 'You have uncommitted changes. Commit or stash them first.'
    default: return undefined
  }
}

/** A failed command as an error, carrying why it failed for whoever shows it */
const failure = (result: GitCommandResult, otherwise: string): GitError => new GitError(result.error || otherwise, result.code)

interface GitCommandError extends Error {
  code?: number | string
  stdout?: string
  stderr?: string
}

interface CachedResult<T> {
  data: T
  timestamp: number
}

/**
 * What each part of a repository looked like when it was read, to tell which of them a later read finds changed.
 * `files` is the same for each changed file on its own, to say which of them it was: a reading that failed has none.
 */
type SnapshotIdentity = Record<RepositoryPart, string> & { files?: Map<string, string> }

/**
 * More changed files than this are not named in the news of a change. A window then reads again every diff it has
 * open, which is at most its tabs, so the bound is on what is sent to every window and not on what any of them does.
 */
const NAMED_FILES_LIMIT = 100

/** The files whose entry differs between two readings: nothing when a reading has none, or there are too many to name */
function differingFiles(before: Map<string, string> | undefined, now: Map<string, string> | undefined): { files?: string[] } {
  if (!before || !now) return {}
  const files = [...now].filter(([file, entry]) => before.get(file) !== entry).map(([file]) => file)
  for (const file of before.keys()) if (!now.has(file)) files.push(file)
  return files.length > NAMED_FILES_LIMIT ? {} : { files }
}

const partsAll = <T>(value: T) => Object.fromEntries(REPOSITORY_PARTS.map(part => [part, value])) as Record<RepositoryPart, T>

export const NOTHING_CHANGED: RepositoryChange = partsAll(false)
export const changedAnything = (change: RepositoryChange): boolean => REPOSITORY_PARTS.some(part => change[part])

/** What the commit panel shows of a checkout, read in one pass */
export interface RepositorySnapshot {
  files: GitStatusFile[]
  /** Whether there are more changed files than `files` lists */
  truncated: boolean
  /** The branch checked out, or `HEAD` when none is */
  branch: string
  /** Whether the branch tracks a remote branch that exists */
  hasUpstream: boolean
  ahead: number
  behind: number
  /** What git is in the middle of here, when it is in the middle of anything */
  operation?: RepositoryOperation
}

/** What each pair of columns git gives an unmerged path says the two sides did to it */
const CONFLICTS: Record<string, ConflictKind> = {
  UU: 'both-modified', AA: 'both-added', DD: 'both-deleted',
  AU: 'added-by-us', UA: 'added-by-them', DU: 'deleted-by-us', UD: 'deleted-by-them',
}

/** A commit as a person would name it: a branch or a tag that is at it, where there is one, else the start of its name */
function nameOfCommit(refs: string[], commit: string): string {
  for (const kind of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
    const ref = refs.find(line => line.startsWith(`${commit} ${kind}`))
    if (ref) return ref.slice(commit.length + 1 + kind.length)
  }
  return commit.slice(0, 7)
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

/** Where a checkout's git state lives, and where the working directory is in it */
interface GitDirectories {
  gitDir: string
  commonDir: string
  /** The working directory's path from the top of the checkout, ending in `/`: empty when it is the top */
  prefix: string
}

/** One changed path as `git status --porcelain=v2 -z` printed it */
interface StatusEntry {
  path: string
  /** Where a renamed or copied path came from */
  originalPath?: string
  /** A tracked path's index and worktree columns, `.` where that side is unchanged; a conflict and an untracked path have none */
  columns?: string
  /** An unmerged path's two columns: what each side did to it */
  conflict?: string
  /** The record as printed, which names what the path holds in HEAD and in the index */
  record: string
}

/**
 * A snapshot as it was read: what a window is shown of it, what tells a later change from none, and the status it
 * was made from, which a later read of a few paths is put into
 */
interface LoadedSnapshot {
  value: RepositorySnapshot
  identity: SnapshotIdentity
  headers: string[]
  entries: StatusEntry[]
  /** Whether git lists untracked files, which the user may have told it not to */
  untracked: 'all' | 'no'
  /** Whether git takes two spellings of a name that differ by case for one file, as a file system that does has it do */
  ignoreCase: boolean
  /** What git is in the middle of, which it says in its own directory and so changes only when that does */
  operation?: RepositoryOperation
}

/**
 * The most paths read on their own after a watcher names them. Git matches each against every file it tracks,
 * so the saving over a whole status shrinks as they grow, and past this many the whole status is read.
 */
const NOTED_PATHS_LIMIT = 32

/** Files whose change can move the standing of any other: what is ignored, how content is compared, where a submodule is */
const WHOLE_TREE_FILES = new Set(['.gitignore', '.gitattributes', '.gitmodules'])

/** The order git prints a status in: changed paths, then conflicts, then untracked ones, each by the bytes of its path */
function inStatusOrder(entries: StatusEntry[]): StatusEntry[] {
  const rank = (entry: StatusEntry) => entry.record.startsWith('? ') ? 2 : entry.columns ? 0 : 1
  return entries
    .map(entry => ({ entry, rank: rank(entry), bytes: Buffer.from(entry.path) }))
    .sort((a, b) => a.rank - b.rank || Buffer.compare(a.bytes, b.bytes))
    .map(({ entry }) => entry)
}

/**
 * Two spellings of one path made the same, as far as the file system and git make them: letters composed on
 * macOS, whose file system does not tell the composed from the decomposed, and the letters A to Z in one case
 * where git ignores case, which are the only ones it folds
 */
const pathFolding = (ignoreCase: boolean) => (filePath: string): string => {
  const composed = process.platform === 'darwin' ? filePath.normalize('NFC') : filePath
  return ignoreCase ? composed.replace(/[A-Z]+/g, upper => upper.toLowerCase()) : composed
}

/** The headers of `git status --porcelain=v2 -z` and its record for each changed path, in the order printed */
function splitStatus(output: string): { headers: string[]; entries: StatusEntry[] } {
  const headers: string[] = []
  const entries: StatusEntry[] = []
  const records = output.split('\0')
  /** A record's path is everything after its fixed fields, since a path may hold spaces */
  const pathAfter = (record: string, fields: number): string => record.split(' ').slice(fields).join(' ')

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.startsWith('# ')) headers.push(record)
    else if (record.startsWith('? ')) entries.push({ path: record.slice(2), record })
    else if (record.startsWith('u ')) entries.push({ path: pathAfter(record, 10), conflict: record.slice(2, 4), record })
    else if (record.startsWith('1 ')) entries.push({ path: pathAfter(record, 8), columns: record.slice(2, 4), record })
    else if (record.startsWith('2 ')) {
      // A rename or copy is followed by the path it came from, as a record of its own
      const originalPath = records[++i]
      entries.push({ path: pathAfter(record, 9), originalPath, columns: record.slice(2, 4), record: `${record}\0${originalPath}` })
    }
  }
  return { headers, entries }
}

function snapshotOf({ headers, entries }: { headers: string[]; entries: StatusEntry[] }): RepositorySnapshot {
  const snapshot: RepositorySnapshot = { files: [], truncated: false, branch: 'HEAD', hasUpstream: false, ahead: 0, behind: 0 }
  for (const header of headers) {
    if (header.startsWith('# branch.head ')) {
      const head = header.slice('# branch.head '.length)
      snapshot.branch = head === '(detached)' ? 'HEAD' : head
    } else if (header.startsWith('# branch.ab ')) {
      const [ahead, behind] = header.slice('# branch.ab '.length).split(' ')
      snapshot.hasUpstream = true
      snapshot.ahead = Math.abs(parseInt(ahead ?? '0', 10)) || 0
      snapshot.behind = Math.abs(parseInt(behind ?? '0', 10)) || 0
    }
  }
  for (const { path: filePath, originalPath, columns, conflict, record } of entries) {
    if (record.startsWith('? ')) {
      snapshot.files.push({ path: filePath, status: 'untracked', staged: false })
    } else if (!columns) {
      // A conflict fills both the index and the worktree column: one row, not committable until resolved
      snapshot.files.push({ path: filePath, status: 'unmerged', staged: false, conflict: CONFLICTS[conflict ?? ''] })
    } else {
      const [index, worktree] = [columns[0]!, columns[1]!]
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

/** Reads `git status --porcelain=v2 --branch -z`: the branch headers and one record per changed path */
export function parseStatus(output: string): RepositorySnapshot {
  return snapshotOf(splitStatus(output))
}

export class GitRepository {
  private cache = new Map<string, CachedResult<any>>()
  private readonly CACHE_TTL = 5000 // 5 seconds
  private readonly PARENT_BRANCH_SEARCH_DEPTH = 25
  /** The commands that wait for each other: writes to the index in one line, remote commands in another */
  private lanes = { write: Promise.resolve(), network: Promise.resolve() }
  private _writeInProgress = 0
  private _writeCompleteCallbacks: (() => void)[] = []
  private _lastFetchTimestamp = 0
  private _autoFetchEnabled = false
  private _fetchThrottleMs = 180_000
  /** The last snapshot read, with what it and the refs looked like, to tell a change from none */
  private snapshot?: LoadedSnapshot
  /**
   * What may have changed since `snapshot` was read: paths in the working tree that a watcher named, relative to
   * the working directory, or anything. Nothing in it is what lets the snapshot be reused.
   */
  private unread: Set<string> | 'anything' = 'anything'
  /**
   * Whether the index may hold stale facts about the files: something changed many of them, or git's own state,
   * since a status was last let write it. Not known to be fresh until one has been
   */
  private indexMayBeStale = true
  /** Whether the next whole status is the one let write the index */
  private refreshIndexOnRead = false
  /** Counts every notice that the repository may have changed, so a read begun before one is not taken for one after it */
  private snapshotVersion = 0
  private snapshotRead?: { version: number; promise: Promise<LoadedSnapshot> }
  /** What the last read looked like, `unreadable` when it failed */
  private lastIdentity?: SnapshotIdentity
  /** What the last `refreshSnapshot` saw, which is what its next one is compared with */
  private checkedIdentity?: SnapshotIdentity
  /** Where this checkout's git state lives, as git last said: it is asked again whenever the watches are checked */
  private gitDirectories?: GitDirectories
  /** Whether a fetch is running, so a second is not started beside it */
  private fetching = false
  /** Whether fetching by itself has stopped because the remote wanted credentials nobody was there to give */
  private autoFetchSuspended = false
  private suspendedSignIn: SignInHelp | undefined
  /** How long a command waits for another git to let go of a lock it needs */
  private lockPatienceMs = LOCK_PATIENCE_MS
  /** Whether a watcher reports this checkout's changes; without one a snapshot is read every time it is asked for */
  private watched = false
  private watchFailed = false

  /** Reads files as commits have them, through one git kept open while they are being read */
  private readonly objects: GitObjectReader

  constructor(private workingDirectory: string) {
    this.validateWorkingDirectory(workingDirectory)
    this.objects = new GitObjectReader(workingDirectory, gitEnvironment)
  }

  /**
   * The file a commit has under a name like `HEAD:src/a.ts`, or nothing when it has none. Through the git kept
   * open for it, and by a process of its own when that one cannot be asked: a name it cannot carry, or a git
   * that ended. Never for the index (`:src/a.ts`), which that git would go on answering from as it first read it.
   */
  private async fileInCommit(name: string): Promise<Buffer | undefined> {
    try {
      return await this.objects.read(name)
    } catch {
      try {
        return await this.executeGitCommandBinary(['show', name])
      } catch {
        return undefined
      }
    }
  }

  getWorkingDir(): string {
    return this.workingDirectory
  }

  setFetchConfig(enabled: boolean, intervalSeconds: number): void {
    this._autoFetchEnabled = enabled
    this._fetchThrottleMs = intervalSeconds * 1000
    // The settings were changed, which is the user saying to try again
    this.autoFetchSuspended = false
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

  /**
   * Runs a command in its lane. A read runs at once: it takes no lock, so it has nothing to wait for, and a
   * status asked during a slow commit or a fetch is answered while that runs. Writes run one at a time, since
   * each takes the index lock, and remote commands one at a time beside them.
   */
  private enqueueCommand<T>(lane: 'read' | 'network' | 'write', fn: () => Promise<T>): Promise<T> {
    if (lane === 'read') return fn()
    const op = this.lanes[lane].then(fn, fn)
    this.lanes[lane] = op.then(() => {}, () => {})
    return op
  }

  /**
   * Runs git, answering once it has exited and its output has gone quiet, without waiting for its pipes to
   * close: a process a hook left behind holds them open for as long as it lives.
   */
  private runGit(args: string[], encoding: BufferEncoding, refreshesIndex = false, input?: string): Promise<{ stdout: string; stderr: string }> {
    const running = execFileWhileWorking('git', ['-c', 'color.ui=never', ...args], {
      cwd: this.workingDirectory,
      // The one read that may write: it lets git take its optional lock and keep what it learns of the files
      env: refreshesIndex ? { ...gitEnvironment(), GIT_OPTIONAL_LOCKS: '1' } : gitEnvironment(),
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer limit
      encoding,
    })
    const { child } = running
    if (input !== undefined) child.stdin?.end(input)
    let grace: NodeJS.Timeout | undefined
    const giveUpOnPipes = () => { child.stdout?.destroy(); child.stderr?.destroy() }
    const quiet = () => { clearTimeout(grace); grace = setTimeout(giveUpOnPipes, EXIT_GRACE_MS) }
    child.once('exit', () => {
      child.stdout?.on('data', quiet)
      child.stderr?.on('data', quiet)
      quiet()
    })
    return running.finally(() => clearTimeout(grace))
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

  /** The repository may have changed in any way: the next snapshot asked for is read from git, all of it */
  markSnapshotStale(): void {
    this.snapshotVersion++
    this.unread = 'anything'
  }

  /**
   * Notes what a watcher saw change, which is what the next snapshot asked for reads: these paths in the working
   * tree, relative to the working directory with `/` between their parts, or everything when it could not name them
   */
  noteChanged(paths: string[] | null): void {
    this.cache.clear()
    // A change too wide to name, or to git's own state: a checkout, a formatter over the tree, a commit elsewhere
    if (paths === null) this.indexMayBeStale = true
    if (paths === null || this.unread === 'anything' || this.unread.size + paths.length > NOTED_PATHS_LIMIT) return this.markSnapshotStale()
    this.snapshotVersion++
    for (const changed of paths) this.unread.add(changed)
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

  /**
   * Whether fetching by itself has stopped because the remote asked for credentials. What the checkout knows of
   * its remote is then as old as the last fetch that worked, which a panel showing it says
   */
  get isAutoFetchSuspended(): boolean {
    return this.autoFetchSuspended
  }

  /** What can be done about the sign-in the remote asked for when fetching by itself stopped */
  get autoFetchSignIn(): SignInHelp | undefined {
    return this.autoFetchSuspended ? this.suspendedSignIn : undefined
  }

  /**
   * What can be done about a sign-in the remote this branch follows asked for, from that remote's address as
   * git would use it (its `insteadOf` rewrites applied). Nothing where there is no remote, or it is a path here.
   */
  async signInHelp(): Promise<SignInHelp | undefined> {
    const result = await this.executeGitCommand(['ls-remote', '--get-url'])
    return result.success && result.output ? signInHelpFor(result.output) : undefined
  }

  /** Fetching by itself starts again, at once: the user signed in, which is them saying to try */
  resumeAutoFetch(): void {
    this.autoFetchSuspended = false
    this._forceFetchNext = true
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

  /**
   * Runs a git command in its lane. One that another git's lock refuses is run again once that lock is let go
   * of: a git in a terminal, or an agent's, holds the index for moments, and the user who staged a file in
   * those moments meant it. The lane waits with it, since what is queued behind needs the same lock.
   */
  private executeGitCommand(args: string[], { refreshesIndex = false, input }: { refreshesIndex?: boolean; input?: string } = {}): Promise<GitCommandResult> {
    // A read allowed to write the index waits its turn among the writes made here, which need the same lock
    return this.enqueueCommand(refreshesIndex ? 'write' : laneOf(args), async () => {
      let refusedAt: number | undefined
      for (;;) {
        const result = await this.runGitOnce(args, refreshesIndex, input)
        const lock = result.code === 'locked' ? LOCKED.exec(result.error ?? '')?.[1] : undefined
        if (!lock) return result
        // A stash is several steps to git, and one refused part-way has done the steps before it: run again, it
        // would stash, or apply, a second time. It is said to be refused, and whoever asked decides
        if (args[0] === 'stash') return { ...result, error: heldLockMessage(lock) }
        refusedAt ??= Date.now()
        // Counted here as well as against the lock: a lock git names and nothing can see is "let go of" every
        // time it is looked for, and the command would be run again for ever
        const left = this.lockPatienceMs - (Date.now() - refusedAt)
        if (left <= 0 || !await lockReleased(lock, left)) return { ...result, error: heldLockMessage(lock) }
      }
    })
  }

  private async runGitOnce(args: string[], refreshesIndex = false, input?: string): Promise<GitCommandResult> {
    try {
      // Ended when it stops working, not when a clock runs out: a fetch stalled on the network would
      // otherwise hold its lane, and every later remote command with it, until the app restarts
      const { stdout } = await this.runGit(args, 'utf8', refreshesIndex, input)

      return { success: true, output: stdout }
    } catch (error) {
      const gitError = error as GitCommandError

      if (gitError.code === 'ENOENT') {
        return { success: false, error: GIT_NOT_INSTALLED, missing: true }
      }
      if (gitError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return { success: false, error: gitError.message, output: gitError.stdout, truncated: true }
      }

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
        output: gitError.stdout,
        // Read from both streams: a merge that stops on a conflict says so on its output and nothing on its error
        code: classifyGitError(`${gitError.stderr ?? ''}\n${gitError.stdout ?? ''}`),
      }
    }
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result.success && result.output) {
      return result.output.trim()
    }
    throw failure(result, 'Failed to get current branch')
  }

  async getStatus(): Promise<GitStatusFile[]> {
    return (await this.readSnapshot()).files
  }

  /**
   * The checkout's changed files, branch and distance from its upstream.
   *
   * A snapshot is reused until something says the repository may have changed: a watcher's event, a write made
   * here, a reconcile. It never waits on the remote: `fetchIfDue` is what fetches.
   */
  async readSnapshot(): Promise<RepositorySnapshot> {
    return (await this.currentSnapshot()).value
  }

  /**
   * Reads the repository from git and says which parts of it differ from the last check. A watcher's event is a
   * hint that something changed; this is what decides whether anything did, and what.
   *
   * A check a watcher's event started reads `noted`: what the watcher said changed (`noteChanged`), and nothing
   * when it said nothing since the last read. Any other check has no event to go by, and reads everything.
   *
   * **`refreshIndex` lets this one status write git's index**, which no other read here may
   * (`GIT_OPTIONAL_LOCKS`). Git keeps in the index what it last saw of each file, and a status that may not write
   * it re-reads every file whose time moved, on every run: after a checkout or a formatter over the tree, that is
   * every file, every time. Writing it holds git's lock for as long as the status takes, in which a git run from
   * a terminal would be refused, so it is the caller's to say when: at a moment nothing else is likely to be
   * running git, and only when something says the index may be stale.
   */
  async refreshSnapshot(reading: 'everything' | 'noted' = 'everything', { refreshIndex = false } = {}): Promise<RepositoryChange> {
    // Whether its watches failed, and whether fetching by itself has stopped, are part of what a window shows of
    // the checkout's status, so they are part of it here
    const seen = (identity: SnapshotIdentity): SnapshotIdentity =>
      ({ ...identity, status: `${this.watchFailed ? 'unwatched' : 'watched'} ${this.autoFetchSuspended ? 'not fetching' : 'fetching'}\n${identity.status}` })
    // Compared with what the last check saw, not with what was last read: one window's ask can read a change
    // before this runs, and this is what tells the others
    const before = this.checkedIdentity ?? (this.lastIdentity && seen(this.lastIdentity))
    if (reading === 'everything') {
      this.markSnapshotStale()
      if (refreshIndex && this.indexMayBeStale) this.refreshIndexOnRead = true
    }
    let now: SnapshotIdentity
    try {
      now = seen((await this.currentSnapshot()).identity)
    } catch {
      now = seen(this.lastIdentity = partsAll('unreadable'))
    }
    this.checkedIdentity = now
    // A first check has nothing to compare with, so everything it reads is new to whoever hears of it
    if (!before) return partsAll(true)

    const history = now.history !== before.history
    const diffs = now.diffs !== before.diffs
    return {
      status: now.status !== before.status,
      diffs,
      history,
      stashes: now.stashes !== before.stashes,
      // A worktree is listed with the commit it is on, which moves with its branch
      worktrees: history || now.worktrees !== before.worktrees,
      ...(diffs && differingFiles(before.files, now.files)),
    }
  }

  private currentSnapshot(): Promise<LoadedSnapshot> {
    if (this.snapshot && this.watched && this.unread !== 'anything' && this.unread.size === 0) return Promise.resolve(this.snapshot)
    if (this.snapshotRead?.version === this.snapshotVersion) return this.snapshotRead.promise

    // One read at a time, each starting from what the one before it left: a read of a few paths is put into the
    // snapshot it starts from, which a read still running has not written yet
    const version = this.snapshotVersion
    const earlier = this.snapshotRead?.promise.then(() => {}, () => {}) ?? Promise.resolve()
    const promise = earlier.then(() => this.readSnapshotOnce()).finally(() => {
      if (this.snapshotRead?.promise === promise) this.snapshotRead = undefined
    })
    this.snapshotRead = { version, promise }
    return promise
  }

  private async readSnapshotOnce(): Promise<LoadedSnapshot> {
    const held = this.watched ? this.snapshot : undefined
    // Whatever is noted from here on may be a change this read does not see, so it stays unread
    const noted = this.unread
    this.unread = new Set()
    if (held && noted !== 'anything' && noted.size === 0) return held
    try {
      const loaded = (held && noted !== 'anything' ? await this.loadNoted(held, [...noted]) : undefined) ?? await this.loadSnapshot()
      this.snapshot = loaded
      this.lastIdentity = loaded.identity
      return loaded
    } catch (error) {
      this.unread = 'anything'
      throw error
    }
  }

  private async loadSnapshot(): Promise<LoadedSnapshot> {
    // Two things git was told that decide what a status lists. Every untracked file is listed by name, which is
    // what the panel shows, unless the user has told git to show none: theirs to decide, and usually said of a
    // repository too large to walk. And whether two spellings of a name that differ by case are one file
    const config = await this.executeGitCommand(['config', '--get-regexp', '^(status\\.showuntrackedfiles|core\\.ignorecase)$'])
    const told = new Map((config.success ? config.output ?? '' : '').split('\n').filter(Boolean).map((line): [string, string] => {
      const space = line.indexOf(' ')
      return [line.slice(0, space), line.slice(space + 1).trim()]
    }))
    const untracked = told.get('status.showuntrackedfiles') === 'no' ? 'no' : 'all'
    const ignoreCase = /^(true|yes|on|1)$/i.test(told.get('core.ignorecase') ?? '')
    const refreshesIndex = this.refreshIndexOnRead
    this.refreshIndexOnRead = false
    // Another git holding the index is why git would skip the write, silently: the index is as suspect after
    const gitDir = refreshesIndex ? (this.gitDirectories ?? await this.resolveGitDirectories())?.gitDir : undefined
    const heldElsewhere = gitDir !== undefined && await fs.stat(path.join(gitDir, 'index.lock')).then(() => true, () => false)
    const status = await this.executeGitCommand(['status', '--porcelain=v2', '--branch', '--show-stash', `--untracked-files=${untracked}`, '-z'], { refreshesIndex })
    if (!status.success && !status.truncated) {
      throw failure(status, 'Failed to get git status')
    }
    if (refreshesIndex && !heldElsewhere) this.indexMayBeStale = false
    // Git printed more than is read: what was read ends inside a record, which is dropped with the rest
    const output = status.truncated ? (status.output ?? '').slice(0, (status.output ?? '').lastIndexOf('\0') + 1) : status.output ?? ''
    const { headers, entries } = splitStatus(output)

    // Status's headers say more than status. The branch checked out, the commit it is on and what it follows
    // are history, and all but the commit are shown with the status too; the stash count is stashes
    const isBranch = (header: string) => header.startsWith('# branch.')
    const isStashCount = (header: string) => header.startsWith('# stash ')
    // Refs move without the status moving: a fetch, a branch made or deleted, a stash
    const refs = ((await this.executeGitCommand(['for-each-ref', '--format=%(objectname) %(refname)'])).output ?? '').split('\n')
    const isStash = (ref: string) => ref.endsWith(' refs/stash')
    const directories = this.gitDirectories ?? await this.resolveGitDirectories()

    return this.snapshotOver({ headers, entries, untracked, ignoreCase, operation: await this.readOperation(directories, refs) }, {
      history: [...headers.filter(isBranch), ...refs.filter(ref => !isStash(ref))].join('\n'),
      // The count as well as the ref: dropping a stash below the newest moves only the count
      stashes: [...headers.filter(isStashCount), ...refs.filter(isStash)].join('\n'),
      worktrees: await this.readWorktreesIdentity(directories),
    }, { directories, truncated: status.truncated === true })
  }

  /**
   * The held snapshot with these paths of the working tree read again, or nothing when a status of them alone
   * would not say all that changed, and the whole status is to be read.
   *
   * Git is asked about the paths and about nothing else. That is the whole truth of a change to the working tree
   * as long as no file's standing depends on another's, and the checks here are the ways it can.
   */
  private async loadNoted(held: LoadedSnapshot, noted: string[]): Promise<LoadedSnapshot | undefined> {
    if (held.value.truncated) return undefined
    if (noted.some(changed => WHOLE_TREE_FILES.has(changed.slice(changed.lastIndexOf('/') + 1)))) return undefined
    // A rename, a copy and a file added without its content are each read from two paths at once: asked for alone,
    // one of the two comes back as an addition or a deletion
    if (held.entries.some(entry => entry.originalPath !== undefined || entry.columns?.[1] === 'A')) return undefined
    const directories = this.gitDirectories ?? await this.resolveGitDirectories()
    if (!directories) return undefined

    const asked = [...new Set(await Promise.all(noted.map(changed => this.outermostRepositoryOver(changed))))]
    // Each path is taken as it is spelled: a `*` or a `[` in a name is that character, and where git ignores case
    // it does for these too
    const magic = `:(literal${held.ignoreCase ? ',icase' : ''})`
    const status = await this.executeGitCommand(['status', '--porcelain=v2', `--untracked-files=${held.untracked}`, '-z', '--', ...asked.map(spec => magic + spec)])
    if (!status.success || status.truncated) return undefined
    const found = splitStatus(status.output ?? '').entries
    if (found.some(entry => entry.originalPath !== undefined)) return undefined

    // What git answered replaces what was held of the same paths and of everything under them
    const fold = pathFolding(held.ignoreCase)
    const under = asked.map(spec => fold(directories.prefix + spec))
    const answered = new Set(found.map(entry => fold(entry.path)))
    const kept = held.entries.filter((entry) => {
      const folded = fold(entry.path)
      return !answered.has(folded) && !under.some(spec => folded === spec || folded.startsWith(`${spec}/`))
    })
    const entries = inStatusOrder([...kept, ...found])
    if (entries.length > STATUS_LIMIT) return undefined
    return this.snapshotOver({ ...held, entries }, held.identity, { directories, truncated: false, held: { files: held.identity.files, kept: new Set(kept) } })
  }

  /**
   * The path git answers for when asked about this one: the outermost directory over it that is a repository of
   * its own, or the path itself. Git does not look inside another repository — a nested one and a submodule are
   * each one entry, at the directory — so asked about a file inside one it answers nothing.
   */
  private async outermostRepositoryOver(relativePath: string): Promise<string> {
    const parts = relativePath.split('/')
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join('/')
      if (await fs.access(path.join(this.workingDirectory, directory, '.git')).then(() => true, () => false)) return directory
    }
    return relativePath
  }

  /**
   * A snapshot of a status as it was read, beside the parts of the repository a status does not hold. `held` is
   * the snapshot this one was made from by reading some paths again: how its other files looked is kept, not read.
   */
  private async snapshotOver(
    read: Pick<LoadedSnapshot, 'headers' | 'entries' | 'untracked' | 'ignoreCase' | 'operation'>,
    rest: Pick<SnapshotIdentity, 'history' | 'stashes' | 'worktrees'>,
    { directories, truncated, held }: { directories: GitDirectories | null; truncated: boolean; held?: { files?: Map<string, string>; kept: Set<StatusEntry> } },
  ): Promise<LoadedSnapshot> {
    const { headers, entries } = read
    const value = snapshotOf({ headers, entries })
    if (read.operation) value.operation = read.operation
    if (truncated || value.files.length > STATUS_LIMIT) {
      value.files = value.files.slice(0, STATUS_LIMIT)
      value.truncated = true
    }
    // Status names its paths from the top of the checkout, which the working directory may be under
    const top = path.resolve(this.workingDirectory, ...(directories?.prefix ?? '').split('/').filter(Boolean).map(() => '..'))
    // A file's record names what it holds in HEAD and in the index, and nothing of what it holds in the working
    // tree: a second edit to a file already changed leaves the record as it was. How the file looks says that,
    // for the files a window can have a diff of open, which are the ones the snapshot lists
    const files = new Map(await Promise.all(entries.slice(0, STATUS_LIMIT).map(async (entry): Promise<[string, string]> => {
      const known = held?.kept.has(entry) ? held.files?.get(entry.path) : undefined
      if (known !== undefined) return [entry.path, known]
      const inWorkingTree = !entry.columns || entry.columns[1] !== '.'
      return [entry.path, `${entry.record}\0${inWorkingTree ? await this.fileSignature(path.join(top, entry.path)) : ''}`]
    })))
    const isCommit = (header: string) => header.startsWith('# branch.oid ')
    const isStashCount = (header: string) => header.startsWith('# stash ')

    return {
      ...read,
      value,
      identity: {
        // What git is in the middle of is shown with the status, so it is part of it
        status: [JSON.stringify(read.operation ?? null), ...headers.filter(header => !isCommit(header) && !isStashCount(header)), ...entries.map(entry => entry.record)].join('\0'),
        diffs: [...files.values()].join('\0'),
        history: rest.history,
        stashes: rest.stashes,
        worktrees: rest.worktrees,
        files,
      },
    }
  }

  /**
   * What git is in the middle of here, read from what it keeps in its directory while it is: no git is run. A
   * rebase is looked for first, since the commit it stops at can leave what a cherry-pick leaves too.
   */
  private async readOperation(directories: GitDirectories | null, refs: string[]): Promise<RepositoryOperation | undefined> {
    if (!directories) return undefined
    const read = (file: string) => fs.readFile(path.join(directories.gitDir, file), 'utf8').then(text => text.trim(), () => undefined)
    for (const [directory, at, of] of [['rebase-merge', 'msgnum', 'end'], ['rebase-apply', 'next', 'last']] as const) {
      const onto = await read(`${directory}/onto`)
      if (!onto) continue
      const [branch, step, steps] = await Promise.all([read(`${directory}/head-name`), read(`${directory}/${at}`), read(`${directory}/${of}`)])
      return {
        kind: 'rebase',
        subject: nameOfCommit(refs, onto),
        ...(branch?.startsWith('refs/heads/') && { branch: branch.slice('refs/heads/'.length) }),
        ...(Number(step) > 0 && Number(steps) > 0 && { step: Number(step), steps: Number(steps) }),
      }
    }
    const merged = await read('MERGE_HEAD')
    if (merged) {
      // Git wrote what it is merging into the message it proposes, where it was given a name for it
      const named = /^Merge (?:remote-tracking )?(?:branch|tag) '([^']+)'/.exec(await read('MERGE_MSG') ?? '')
      return { kind: 'merge', subject: named?.[1] ?? nameOfCommit(refs, merged.split('\n')[0]!) }
    }
    const picked = await read('CHERRY_PICK_HEAD')
    if (picked) return { kind: 'cherry-pick', subject: picked.slice(0, 7) }
    const reverted = await read('REVERT_HEAD')
    if (reverted) return { kind: 'revert', subject: reverted.slice(0, 7) }
    return undefined
  }

  /** How a file in the working tree looks without reading it, which tells a later edit from none */
  private fileSignature(file: string): Promise<string> {
    return fs.stat(file).then(stat => `${stat.mtimeMs}:${stat.size}`, () => 'gone')
  }

  /**
   * What says the worktrees changed, read from the files git keeps for them and without running it: which there
   * are, where each is, what each has checked out, and which are locked.
   */
  private async readWorktreesIdentity(directories: GitDirectories | null): Promise<string> {
    if (!directories) return ''
    const { commonDir } = directories
    const read = (file: string) => fs.readFile(file, 'utf8').then(text => text.trim(), () => '')
    const names = await fs.readdir(path.join(commonDir, 'worktrees')).then(found => found.sort(), () => [] as string[])
    const linked = await Promise.all(names.map(async (name) => {
      const directory = path.join(commonDir, 'worktrees', name)
      const locked = await fs.access(path.join(directory, 'locked')).then(() => ' locked', () => '')
      return `${name} ${await read(path.join(directory, 'gitdir'))} ${await read(path.join(directory, 'HEAD'))}${locked}`
    }))
    return [`main ${await read(path.join(commonDir, 'HEAD'))}`, ...linked].join('\n')
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
      throw failure(result, 'Failed to get diff')
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
        throw failure(result, 'Failed to get diff')
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
      if (version === 'HEAD') return (await this.fileInCommit(`HEAD:${relativePath}`))?.toString('utf8') ?? ''
      const result = await this.executeGitCommand(['show', `:${relativePath}`])
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
    try {
      const buffer = version === 'HEAD' ? await this.fileInCommit(`HEAD:${relativePath}`) : await this.executeGitCommandBinary(['show', `:${relativePath}`])
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
      const buffer = await this.fileInCommit(ref)
      if (!buffer || buffer.length === 0) return ''
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch {
      return ''
    }
  }

  /**
   * The pieces of a file's change that can be staged one at a time, or unstaged when `staged`: of the working
   * tree against the index, or of the index against the last commit. None for a file that is not plainly modified.
   */
  async getHunks(filePath: string, staged: boolean): Promise<DiffHunk[]> {
    const result = await this.executeGitCommand(['diff', '--no-ext-diff', '--no-color', '--no-textconv', ...(staged ? ['--cached'] : []), '--', filePath])
    return result.success ? hunksOf(result.output ?? '') : []
  }

  /**
   * Stages one piece of a file's change, or with `staged` takes one piece out of what is staged. The piece is
   * one this repository cut from the file as it is now: one read before the file changed again is refused,
   * rather than applied to lines it was not made from.
   */
  async applyHunk(filePath: string, staged: boolean, patch: string): Promise<void> {
    return this.withWriteFlag(async () => {
      if (!(await this.getHunks(filePath, staged)).some(hunk => hunk.patch === patch)) {
        throw new GitError('The file has changed since this change was read. It is shown as it is now: try again.')
      }
      const result = await this.executeGitCommand(['apply', '--cached', ...(staged ? ['--reverse'] : []), '--whitespace=nowarn', '-'], { input: patch })
      if (!result.success) throw failure(result, staged ? 'Failed to unstage the change' : 'Failed to stage the change')
    })
  }

  /** Check if a file path is an image based on extension. */
  isImageFile(filePath: string): boolean {
    return getImageMimeType(filePath) !== null
  }

  /** Execute a git command and return raw binary buffer output. */
  private executeGitCommandBinary(args: string[]): Promise<Buffer> {
    return this.enqueueCommand(laneOf(args), async () => {
      // Read as latin1, which maps each byte to one character and back, so the bytes survive a text channel
      const { stdout } = await this.runGit(args, 'latin1')
      return Buffer.from(stdout, 'latin1')
    })
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['add', '--', ...filePaths])
      if (!result.success) {
        throw failure(result, 'Failed to stage files')
      }
      this.markSnapshotStale()
    })
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['reset', 'HEAD', '--', ...filePaths])
      if (!result.success) {
        throw failure(result, 'Failed to unstage files')
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
            throw failure(result, `Failed to revert file: ${filePath}`)
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
          throw failure(result, `Failed to revert file: ${filePath}`)
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
            throw failure(result, 'Failed to revert unmerged files')
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
          throw failure(result, 'Failed to revert files')
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
        throw failure(result, `Failed to resolve conflict with ${strategy}`)
      }
      await this.executeGitCommand(['add', '--', filePath])
      this.markSnapshotStale()
    })
  }

  /**
   * Carries on with what git is in the middle of, leaves out the commit a rebase stopped at, or gives it up.
   * Carrying on takes the message git proposes, there being no editor for it to open (`gitEnvironment`).
   */
  async moveOperation(move: OperationMove): Promise<void> {
    const operation = (await this.currentSnapshot()).operation
    if (!operation) throw new Error('Git is not in the middle of anything in this repository')
    if (move === 'skip' && operation.kind !== 'rebase') throw new Error(`Only a rebase has a commit to skip, and this is a ${operation.kind}`)
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand([operation.kind, `--${move}`])
      this.markSnapshotStale()
      if (result.success) return
      // A rebase that went on to its next commit and stopped there, at a conflict, did what was asked
      const now = (await this.currentSnapshot()).operation
      if (now?.kind === 'rebase' && (now.step ?? 0) > (operation.step ?? 0)) return
      throw failure(result, `Could not ${move} the ${operation.kind}`)
    })
  }

  async commit(message: string): Promise<void> {
    if (!message.trim()) {
      throw new Error('Commit message cannot be empty')
    }
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['commit', '-m', message])
      if (!result.success) {
        throw failure(result, 'Failed to commit')
      }
    })
  }

  /**
   * Where this checkout's git state lives: its own git directory (index, HEAD) and the common one holding refs.
   * The two differ in a linked worktree. Null when the working directory is in no repository.
   */
  async resolveGitDirectories(): Promise<GitDirectories | null> {
    const result = await this.executeGitCommand(['rev-parse', '--git-dir', '--git-common-dir', '--show-prefix'])
    const [gitDir, commonDir, prefix] = (result.success ? result.output ?? '' : '').split('\n').map(line => line.trim())
    this.gitDirectories = gitDir && commonDir
      ? { gitDir: path.resolve(this.workingDirectory, gitDir), commonDir: path.resolve(this.workingDirectory, commonDir), prefix: prefix ?? '' }
      : undefined
    return this.gitDirectories ?? null
  }

  /** Whether the working directory is in a repository. Rejects when there is no git to ask. */
  async isGitRepository(): Promise<boolean> {
    const result = await this.executeGitCommand(['rev-parse', '--git-dir'])
    if (result.missing) throw new Error(GIT_NOT_INSTALLED)
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
      throw failure(result, 'Failed to get branch diff')
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

  /** Whether each of these names a commit in this repository */
  async commitsExist(...refs: string[]): Promise<boolean> {
    const result = await this.executeGitCommand(['rev-parse', '--quiet', ...refs.map(ref => `${refArgument(ref)}^{commit}`)])
    return result.success
  }

  async getFileContentFromBranch(filePath: string, branch: string): Promise<string> {
    // A path with a colon in it, or one that starts like an option, is named from the top of the tree
    const special = filePath.includes(':') || filePath.startsWith('-')
    // A file the branch does not have is not an error
    return (await this.fileInCommit(`${refArgument(branch, 'branch')}:${special ? './' : ''}${filePath}`))?.toString('utf8') ?? ''
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
        throw failure(result, 'Failed to delete remote branch')
      }
    })
  }

  /**
   * Every local branch, then every remote one, each most recently committed first. A branch of `origin` is
   * named as the local branch it would be checked out as; one of another remote keeps `remotes/<remote>/`.
   */
  async getAllBranches(): Promise<string[]> {
    // Read from the refs themselves, one per record: `git branch` decorates its lines for a person, marking the
    // current branch, one checked out in another worktree and a detached HEAD
    const result = await this.executeGitCommand([
      'for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes',
    ])
    if (!result.success) {
      throw failure(result, 'Failed to get branches')
    }

    const refs = (result.output || '').split('\n').filter(Boolean)
    const local = refs.filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice('refs/heads/'.length))
    const remote = refs
      .filter(ref => ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD'))
      .map(ref => ref.startsWith('refs/remotes/origin/') ? ref.slice('refs/remotes/origin/'.length) : ref.slice('refs/'.length))

    // Case-insensitive dedup — prefer remote names (correct case from server) over local names: a remote
    // duplicate overwrites a wrong-case local entry, in the local entry's place
    const seen = new Map<string, string>()
    for (const branch of [...local, ...remote]) {
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
        if (result.code === 'unknown-ref') {
          // Try to create a new branch tracking the remote
          const remoteResult = await this.executeGitCommand(['checkout', '-b', branchName, `origin/${branchName}`])
          if (!remoteResult.success) {
            // If that fails too, just create a new local branch
            const newBranchResult = await this.executeGitCommand(['checkout', '-b', branchName])
            if (!newBranchResult.success) {
              throw failure(newBranchResult, `Failed to create branch: ${branchName}`)
            }
          }
        } else if (result.code === 'local-changes') {
          // Git is preventing checkout due to conflicts
          throw new GitError('Cannot switch branches: Your uncommitted changes conflict with files in the target branch. Please commit, stash, or discard your changes first.', result.code)
        } else {
          throw failure(result, `Failed to checkout branch: ${branchName}`)
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

  /** Fetches the next time one is considered, whatever the fetch settings and the time since the last say */
  forceFetchOnce(): void {
    this._forceFetchNext = true
  }

  /**
   * Fetches from the remote when one is due — it was forced, or the fetch settings ask for it and their interval
   * has passed — and says whether it did. **Never part of a read**: whoever asked for the repository has its
   * answer already, and what the fetch brings is found by the check that follows it.
   *
   * It stops fetching by itself once the remote wants credentials nobody is there to give, since every later try
   * would fail the same way; changing the fetch settings, or a push or pull that works, starts it again.
   */
  async fetchIfDue(): Promise<boolean> {
    if (this.fetching) return false
    if (!this._forceFetchNext) {
      if (!this._autoFetchEnabled || this.autoFetchSuspended) return false
      if (Date.now() - this._lastFetchTimestamp < this._fetchThrottleMs) return false
    }
    this.fetching = true
    try {
      // Nothing to fetch for a branch that follows no remote one, and not a reason to forget a forced fetch
      if (!(await this.readSnapshot()).hasUpstream) return false
      this._forceFetchNext = false
      this._lastFetchTimestamp = Date.now()
      const result = await this.executeGitCommand(['fetch', '--quiet'])
      if (result.code === 'authentication') {
        this.suspendedSignIn = await this.signInHelp()
        this.autoFetchSuspended = true
        logger.warn('Fetching by itself has stopped for this repository: the remote asked for credentials', { error: result.error })
      }
      this.markSnapshotStale()
      return result.success
    } catch {
      return false
    } finally {
      this.fetching = false
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
        throw new GitError(`Failed to push: ${saidOfRemote(result) ?? (result.error || 'git gave no reason')}`, result.code)
      }

      // Clear cache and reset fetch timer (push updates remote refs)
      this.clearCache()
      this._lastFetchTimestamp = Date.now()
      this.autoFetchSuspended = false
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
        throw new GitError(`Failed to pull: ${saidOfRemote(result) ?? (result.error || 'git gave no reason')}`, result.code)
      }

      // Clear cache and reset fetch timer (pull already fetched remote refs)
      this.clearCache()
      this._lastFetchTimestamp = Date.now()
      this.autoFetchSuspended = false
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
        throw failure(result, 'Failed to stash changes')
      }
      this.clearCache()
      return result.output || 'Changes stashed'
    })
  }

  async stashList(): Promise<StashEntry[]> {
    const result = await this.executeGitCommand(['stash', 'list', '-z', '--format=%gd%x00%s%x00%ai'])
    if (!result.success) {
      // Empty stash list is not an error
      if (result.code === 'unknown-ref') return []
      throw failure(result, 'Failed to list stashes')
    }
    if (!result.output?.trim()) return []

    return recordsOf(result.output, 3).map((parts, i) => ({
      index: i,
      ref: parts[0] || `stash@{${i}}`,
      message: parts[1] || '',
      date: parts[2] || ''
    }))
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
        throw failure(result, 'Failed to apply stash')
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
        throw failure(result, 'Failed to pop stash')
      }
      this.clearCache()
    })
  }

  private isStashConflict(result: GitCommandResult): boolean {
    return result.code === 'conflict'
  }

  async stashDrop(index: number): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'drop', stashArgument(index)])
      if (!result.success) {
        throw failure(result, 'Failed to drop stash')
      }
    })
  }

  async stashClear(): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['stash', 'clear'])
      if (!result.success) {
        throw failure(result, 'Failed to clear stashes')
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
        throw failure(result, 'Failed to add worktree')
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
        throw failure(result, 'Failed to remove worktree')
      }
    })
  }

  async getCommitsBetweenBranches(baseBranch: string, targetBranch = 'HEAD'): Promise<{ subject: string; body: string }[]> {
    const result = await this.executeGitCommand([
      'log', '-z', `${refArgument(baseBranch, 'base branch')}..${refArgument(targetBranch, 'branch')}`,
      '--format=%s%x00%b',
      '--reverse'
    ])
    if (!result.success || !result.output) return []

    return recordsOf(result.output, 2)
      .map(([subject, body]) => ({ subject: (subject || '').trim(), body: (body || '').trim() }))
      .filter(c => c.subject)
  }

  // --- Commit log operations ---

  async gitLog(count = 50): Promise<CommitLogEntry[]> {
    const result = await this.executeGitCommand([
      'log', '-z', `-n${count}`,
      '--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%D',
    ])
    if (!result.success || !result.output) return []

    return recordsOf(result.output, 8)
      .map(parts => ({
        hash: (parts[0] || '').trim(),
        shortHash: (parts[1] || '').trim(),
        subject: (parts[2] || '').trim(),
        body: (parts[3] || '').trim(),
        authorName: (parts[4] || '').trim(),
        authorEmail: (parts[5] || '').trim(),
        date: (parts[6] || '').trim(),
        refs: (parts[7] || '').trim(),
      }))
      .filter(c => c.hash)
  }

  async revertCommit(hash: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['revert', '--no-edit', commitArgument(hash)])
      if (!result.success) {
        throw failure(result, `Failed to revert commit ${hash}`)
      }
      this.clearCache()
    })
  }

  async resetToCommit(hash: string): Promise<void> {
    return this.withWriteFlag(async () => {
      const result = await this.executeGitCommand(['reset', commitArgument(hash)])
      if (!result.success) {
        throw failure(result, `Failed to reset to commit ${hash}`)
      }
      this.clearCache()
    })
  }
}