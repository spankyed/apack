import type { GitRepository } from './services/git.ts';
import type { GitWatcherService } from './services/gitwatcher.ts';
import type { GitErrorCode } from './services/git-errors.ts';
import type { SignInHelp } from './services/sign-in.ts';
import { EARS } from '#generated/ears.ts'

export interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: Date
  extension?: string
}

export interface DirectoryContent {
  path: string
  files: FileInfo[]
}

export interface FileContent {
  path: string
  content: string
  encoding: string
  size?: number
  isBinary?: boolean
  isVideo?: boolean
}

export interface FileOperation {
  type: 'create' | 'update' | 'delete' | 'rename'
  path: string
  newPath?: string
  content?: string
}

export interface CodeSystemError {
  code: 'NOT_FOUND' | 'PERMISSION_DENIED' | 'INVALID_PATH' | 'IO_ERROR' | 'FILE_TOO_LARGE' | 'SEARCH_ERROR'
  message: string
  path?: string
}

export interface SearchOptions {
  query: string
  path: string
  includePattern?: string
  excludePattern?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  maxResults?: number
}

export interface SearchMatch {
  line: number
  column: number
  lineText: string
  matchStart: number
  matchEnd: number
}

export interface SearchResult {
  path: string
  matches: SearchMatch[]
  fileSize?: number
}

export interface SearchProgress {
  filesSearched: number
  totalFiles: number
  currentFile?: string
}

// Git types
export interface GitStatusFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' | 'typechange' | 'unmerged'
  staged: boolean
  originalPath?: string // For renames and copies
  score?: number // Rename/copy similarity score (0-100)
  /** For an unmerged file: what each side did to it, which is what there is to settle */
  conflict?: ConflictKind
  /** An untracked folder, listed as one row: git tracks nothing in it. Its path ends with `/` */
  isDirectory?: boolean
}

/**
 * How the two sides being brought together disagree about a file. `us` is the side the checkout was on and
 * `them` the one coming in, as git names them.
 */
export const CONFLICT_KINDS = ['both-modified', 'both-added', 'both-deleted', 'added-by-us', 'added-by-them', 'deleted-by-us', 'deleted-by-them'] as const
export type ConflictKind = (typeof CONFLICT_KINDS)[number]

/** What git can be in the middle of in a checkout, each of which ends when it is carried on with or given up */
export const OPERATION_KINDS = ['merge', 'rebase', 'cherry-pick', 'revert'] as const
export type OperationKind = (typeof OPERATION_KINDS)[number]

/** What git is in the middle of in a checkout */
export interface RepositoryOperation {
  kind: OperationKind
  /** What is merged in, rebased onto, picked or reverted, as a person would name it: a branch where one is known, else a short commit */
  subject: string
  /** The branch a rebase is replaying, where it is replaying one */
  branch?: string
  /** A rebase's place among the commits it replays, counted from one */
  step?: number
  steps?: number
}

/** What can be done with what git is in the middle of: carry on once its conflicts are settled, leave out the commit a rebase stopped at, or give it up */
export const OPERATION_MOVES = ['continue', 'skip', 'abort'] as const
export type OperationMove = (typeof OPERATION_MOVES)[number]

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitCommitInfo {
  message: string
  author?: string
  date?: Date
}

/**
 * The parts of a repository a window shows, each read and refreshed on its own: its changed files with the branch
 * and its distance from upstream; the two sides of each changed file, which a diff of it shows; which branch is
 * checked out, the commit it is on and every branch and tag, which a log and a pull request are read from; its
 * stashes; its worktrees.
 */
export const REPOSITORY_PARTS = ['status', 'diffs', 'history', 'stashes', 'worktrees'] as const
export type RepositoryPart = (typeof REPOSITORY_PARTS)[number]

/** Which parts of a repository differ from when it was last checked */
export type RepositoryChange = Record<RepositoryPart, boolean> & {
  /** The changed files whose diff differs, when they are few enough to name: without it, any of them may */
  files?: string[]
}

/** The two sides of one file's change, which an editor shows side by side */
/** One piece of a file's change, as git cuts it */
export interface DiffHunk {
  /** Where it begins on the left side of the diff, and how many lines of that side it covers */
  oldStart: number
  oldLines: number
  /** The same on the right side */
  newStart: number
  newLines: number
  /** The patch that applies this piece alone */
  patch: string
}

export interface GitDiff {
  path: string
  staged: boolean
  originalContent?: string
  modifiedContent?: string
  isImage?: boolean
  /** The pieces of the change that can be staged, or unstaged, one at a time: none for a file that is not plainly modified */
  hunks?: DiffHunk[]
}

export interface StashEntry {
  index: number
  ref: string
  message: string
  date: string
}

export interface WorktreeEntry {
  path: string
  head: string
  branch: string
  isBare: boolean
  isCurrent: boolean
  isMain: boolean
  isLocked: boolean
  lockedReason?: string
}

export interface CommitLogEntry {
  hash: string
  shortHash: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  date: string
  refs: string
}

// GitHub PR types
export interface GhPullRequest {
  number: number
  title: string
  body: string
  headRefName: string
  baseRefName: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  isDraft: boolean
  author: { login: string }
  createdAt: string
  updatedAt: string
  commits?: { oid: string; messageHeadline: string; committedDate: string }[]
  // Mergeability — populated by detail / branch-PR fetches, not by the light list fetch.
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus?: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE'
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  statusCheckRollup?: Array<{
    name?: string
    status?: string     // QUEUED | IN_PROGRESS | COMPLETED | PENDING
    conclusion?: string // SUCCESS | FAILURE | NEUTRAL | CANCELLED | SKIPPED | TIMED_OUT | ACTION_REQUIRED | STALE
    // GitHub's commit-status API, which `gh` still returns beside the checks API: a check from a status-only
    // integration has `state` and no `status`/`conclusion`. Not our legacy — theirs, and live (MergeButtonTooltip)
    state?: string      // SUCCESS | PENDING | FAILURE | ERROR
  }>
}

export interface GhPRComment {
  id: string
  body: string
  author: { login: string }
  createdAt: string
  url: string
  viewerDidAuthor: boolean
}

export interface GhReviewThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  startLine?: number | null
  originalLine?: number | null
  originalStartLine?: number | null
  diffSide?: 'LEFT' | 'RIGHT' | null
  startDiffSide?: 'LEFT' | 'RIGHT' | null
  subjectType?: 'LINE' | 'FILE' | null
  diffHunk?: string | null
  comments: GhReviewComment[]
}

export interface GhReviewComment {
  id: string
  databaseId: number
  body: string
  author: { login: string }
  createdAt: string
  viewerDidAuthor: boolean
  path?: string | null
  line?: number | null
  startLine?: number | null
  originalLine?: number | null
  originalStartLine?: number | null
  diffHunk?: string | null
}

// Terminal types
export interface TerminalInfo {
  id: EARS.EntityId
  title: string
  customTitle?: string // User-defined custom name, takes precedence over default
  /**
   * The shell's process id, for a diagnostic — **`null` when it is not known**.
   *
   * A window tells one generation from the next by it, which is what draws the seam between a dead shell's
   * output and its replacement's. It is unknown for a session the service took up again rather than started
   * (the broker answers a pid only for a spawn), and that case is precisely the one where there is no
   * boundary to draw: the shell is the one the window was already watching.
   */
  pid: number | null
  shell?: string
  cwd: string
  active: boolean
  /**
   * How many shells this terminal has had, counting from one.
   *
   * **A terminal is not its shell.** Its id, its tab and its place in that tab outlive the process behind
   * it, so a shell that crashed and one the user restarted both leave the terminal where it was and start
   * a new generation under it. The window tells one generation from the next by the pid and writes the
   * seam; this is what says how many there have been, for a window that was not watching.
   */
  generation: number
  /** The shell ended and the terminal was kept. Absent while one is running */
  exited?: { code: number | null }
  /**
   * The session's size **when this was published**, which is a starting point and not a live reading.
   *
   * **A pty has one size and it is whatever a window last fitted**, so the live value lives where the
   * session does: the service keeps it current and `restart` re-opens the shell at it. What a window holds
   * is the snapshot it was last listed or opened with, and its one consumer wants exactly that — the pool
   * builds the emulator at this size, so it is the width a replayed screen is first drawn at.
   *
   * It is spelled out because it reads as live and is not: a drive scenario waited on it for the size a
   * window had just fitted and timed out at the creation size, with every resize having landed correctly
   * (F18). A window that wants the size it fitted computed it, and the pty's own is the broker's to answer.
   */
  cols: number
  /** The session's rows when this was published; see `cols` */
  rows: number
  /**
   * How far back this session can be scrolled: the host's number, from the broker's handshake.
   *
   * The window derives its emulator's bound from this and never pins its own. Exceeding it would draw lines
   * no reattach could reproduce — the broker is what answers a screen read when no window holds the bytes —
   * and 10,000 pinned in the pool against the broker's 1,000 is exactly what that looked like.
   */
  scrollback: number
  /**
   * What ends a typed line for *this* shell — X6.
   *
   * A window running a command has to end it the way the shell it is running in expects, and only the
   * backend knows which shell that is. Typed into a Windows console, `\n` is echoed and never runs: the
   * command sits on screen looking typed, and nothing happens. Measured on Windows rather than assumed.
   */
  submit: string
}

export interface TerminalOutput {
  terminalId: EARS.EntityId
  data: string
}

export interface TerminalInput {
  terminalId: EARS.EntityId
  data: string
}

export interface TerminalResize {
  terminalId: EARS.EntityId
  cols: number
  rows: number
}

export interface TerminalCreate {
  id?: EARS.EntityId
  title?: string
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
}

export interface TerminalClose {
  terminalId: string
}

// Quick Open types
export interface QuickOpenOptions {
  query: string
  baseDirectory: string
  excludePatterns?: string[]
  maxResults?: number
}

export interface QuickOpenResult {
  path: string
  relativePath: string
  name: string
  type: 'file' | 'directory'
  extension?: string
  score?: number
}

export interface TerminalScript {
  id: string
  label: string
  command: string
}

// Settings types
export type CodeSettings = import('#generated/settings.ts').SettingsOf<'code'>;

export type CodeConnectedData = {
  baseDirectory: string | null;
  settings?: CodeSettings;
};

export interface CodeSystemContext {
  baseDirectory: string | null
  /**
   * The default directory the settings named when this system last heard them. The settings arrive whenever any of
   * the code settings change, the browsed `baseDirectory` included, so only a new default moves the explorer.
   */
  defaultBaseDirectory: string | null
  gitRepository: GitRepository | null
  gitWatcher: GitWatcherService | null
}

export type { GitErrorCode, SignInHelp }

/** What the commit panel is told of a command that failed */
export interface CommitFailure {
  message: string
  /** Why git failed, where it said */
  code?: GitErrorCode
  /** The command the failure was of, where the panel can run it again */
  during?: 'push' | 'pull'
  /** What can be done about a sign-in the remote asked for */
  signIn?: SignInHelp
}
