import type { GitRepository } from './services/git.ts';
import type { GitWatcherService } from './services/gitwatcher.ts';
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
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitCommitInfo {
  message: string
  author?: string
  date?: Date
}

export interface GitDiff {
  path: string
  diff: string
  staged: boolean
  originalContent?: string
  modifiedContent?: string
  isImage?: boolean
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
  /**
   * The session a window draws this terminal from, by the name the terminal broker knows it by. Absent
   * while the terminal has no shell — one that ended and was kept.
   *
   * **Not the terminal's own id, because a terminal is not its shell.** A restart puts a new session under
   * the same terminal, and a window that went on drawing the old one would be drawing a shell that is gone.
   */
  session?: string
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
  /**
   * Whether what it prints is kept in a recording, which is what it can be looked back through from and
   * what lets its shell be kept running and found again. A terminal on a target is not, and nor is one
   * started while restoring terminals is off.
   */
  recorded?: boolean
  /** Whether its shell goes on running when the app is not, which a window asks for with `terminal.KEEP_TERMINAL` */
  kept?: boolean
  /**
   * Where it runs when that is not this machine: the setting's id and label, and the `key` a window
   * draws its session from (`terminalViews`), which is there once a session on the target has been
   * reached. Absent for a terminal on this machine.
   */
  target?: { id: string; label: string; key?: string }
  /**
   * The terminal has no shell and was kept. Absent while one is running.
   *
   * `unreached` is a terminal on a target this run has not connected to: there may be a shell there still,
   * and starting the terminal again is what finds out.
   */
  exited?: { code: number | null; unreached?: true }
  /**
   * The session's size **when this was published**, which is a starting point and not a live reading.
   *
   * **A pty has one size and it is whatever a window last fitted**, so the live value lives where the
   * session does: the service keeps it current and `restart` re-opens the shell at it. What a window holds
   * is the snapshot it was last listed or opened with.
   *
   * It is spelled out because it reads as live and is not: a drive scenario waited on it for the size a
   * window had just fitted and timed out at the creation size, with every resize having landed correctly
   * (F18). A window that wants the size it fitted computed it, and the pty's own is the broker's to answer.
   */
  cols: number
  /** The session's rows when this was published; see `cols` */
  rows: number
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
  /** One of the code settings' `terminalTargets`, by id: where to run it instead of on this machine */
  target?: string
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
