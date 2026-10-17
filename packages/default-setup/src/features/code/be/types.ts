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
  title: string
  customTitle?: string // User-defined custom name, takes precedence over default
  pid: number
  shell?: string
  cwd: string
  active: boolean
  cols: number
  rows: number
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

export type { ClaudeUiFocusEvent, ClaudeUiFocusReply, ClaudeUiNode, ClaudeUiMountState, ClaudeUiFieldEvent, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRow, ClaudePromptCompletionRequest, ClaudePromptCompletionReply } from './services/claude-code/ui-presentation.ts'
