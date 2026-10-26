// The code system's contract: what it receives, what its own children send it, what it sends its surface,
// and its context. Its own module, not the feature's types barrel: `#generated/types` star-exports that,
// and one `Contract` per feature would collide there. Codegen reads this without running anything.
import type { ActionEntity, PromptEntity } from '@apackdev/sdk';
import type {
  CodeConnectedData, CodeSystemError, CommitLogEntry, CodeSystemContext, DirectoryContent, FileContent, FileInfo,
  GhPRComment, GhPullRequest, GhReviewThread, GitDiff, GitStatusFile, QuickOpenResult, SearchProgress,
  SearchResult, StashEntry, TerminalInfo, WorktreeEntry,
} from './types.ts';
import type { ActiveTokenInfo } from './services/gh-cli.ts';
import type { FileChangeInfo } from './services/gitwatcher.ts';

// ── The child actors' events ─────────────────────────────────────────────────────────────────────
// They live here rather than beside each child because this module is the contract leaf: codegen reads it as a
// declared type, and `#generated/events` imports it — so anything it reaches must not import `#generated/events`
// back, which every child does for `broadcastToSurface`. Each child imports its own two from here.
// ── explorer ─────────────────────────────────────────────────────────
export type IncomingExplorerEvents =
  | { type: 'explorer.LIST_FILES'; path: string }
  | { type: 'explorer.READ_FILE'; path: string }
  | { type: 'explorer.WRITE_FILE'; path: string; content: string }
  | { type: 'explorer.CREATE_FILE'; path: string; content?: string }
  | { type: 'explorer.DELETE_FILE'; path: string }
  | { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'explorer.CREATE_DIRECTORY'; path: string }
  | { type: 'explorer.GET_FILE_INFO'; path: string }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
  | { type: 'explorer.MOVE_FILES'; sourcePaths: string[]; targetDir: string }
  | { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }

export type OutgoingExplorerEvents =
  | { type: 'explorer.FILES_LISTED'; data: DirectoryContent }
  | { type: 'explorer.FILE_CREATED'; data: { path: string } }
  | { type: 'explorer.FILE_DELETED'; data: { path: string } }
  | { type: 'explorer.FILE_RENAMED'; data: { oldPath: string; newPath: string } }
  | { type: 'explorer.DIRECTORY_CREATED'; data: { path: string } }
  | { type: 'explorer.FILE_INFO'; data: FileInfo }
  | { type: 'explorer.FILE_CONTENT'; data: FileContent }
  | { type: 'explorer.FILE_SAVED'; data: { path: string } }
  | { type: 'explorer.CODE_ERROR'; data: CodeSystemError }
  | { type: 'explorer.FILE_CHANGED_EXTERNALLY'; data: FileChangeInfo }
  | { type: 'explorer.QUICK_OPEN_RESULTS'; data: QuickOpenResult[] }
  | { type: 'explorer.FILES_MOVED'; data: { sourcePaths: string[]; targetDir: string; movedPaths: string[] } }
  | { type: 'explorer.FILES_COPIED'; data: { targetDir: string; copiedPaths: string[] } }

// ── search ─────────────────────────────────────────────────────────
export type IncomingSearchEvents =
  | { type: 'search.SEARCH_FILES'; query: string; path: string; includePattern?: string; excludePattern?: string; caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; maxResults?: number }
  | { type: 'search.CANCEL_SEARCH' }

export type OutgoingSearchEvents =
  | { type: 'search.RESULT'; data: SearchResult }
  | { type: 'search.PROGRESS'; data: SearchProgress }
  | { type: 'search.COMPLETE'; data: { results: SearchResult[]; totalMatches: number } }
  | { type: 'search.ERROR'; data: { message: string } }

// ── commit ─────────────────────────────────────────────────────────
export type IncomingCommitEvents =
  | { type: 'commit.GET_GIT_STATUS' }
  | { type: 'commit.GET_GIT_DIFF'; path?: string; staged?: boolean }
  | { type: 'commit.STAGE_FILES'; paths: string[] }
  | { type: 'commit.UNSTAGE_FILES'; paths: string[] }
  | { type: 'commit.COMMIT'; message: string }
  | { type: 'commit.GET_CURRENT_BRANCH' }
  | { type: 'commit.REVERT_FILE'; path: string }
  | { type: 'commit.REVERT_FILES'; paths: string[] }
  | { type: 'commit.GET_ALL_BRANCHES' }
  | { type: 'commit.CHECKOUT_BRANCH'; branchName: string }
  | { type: 'commit.PUBLISH_BRANCH' }
  | { type: 'commit.PULL_BRANCH' }
  | { type: 'commit.GENERATE_MESSAGE' }
  | { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }
  | { type: 'commit.STASH_LIST' }
  | { type: 'commit.STASH_APPLY'; index: number }
  | { type: 'commit.STASH_POP'; index: number }
  | { type: 'commit.STASH_DROP'; index: number }
  | { type: 'commit.STASH_CLEAR' }
  | { type: 'commit.WORKTREE_LIST' }
  | { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'commit.WORKTREE_SWITCH'; path: string }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }

export type OutgoingCommitEvents =
  | { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number } }
  | { type: 'commit.DIFF_RECEIVED'; data: GitDiff }
  | { type: 'commit.FILES_STAGED'; data: { paths: string[] } }
  | { type: 'commit.FILES_UNSTAGED'; data: { paths: string[] } }
  | { type: 'commit.COMMIT_SUCCESS'; data: { message: string } }
  | { type: 'commit.FILE_REVERTED'; data: { path: string } }
  | { type: 'commit.FILES_REVERTED'; data: { paths: string[] } }
  | { type: 'commit.ERROR_RECEIVED'; data: { message: string } }
  | { type: 'commit.BRANCH_RETRIEVED'; data: { branch: string } }
  | { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[] } }
  | { type: 'commit.BRANCH_CHECKOUT_SUCCESS'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PUSHED'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PULLED'; data: { branchName: string } }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  /** The repository changed, on disk or by a write from any window: news for every window, each of which asks again for what it shows of it */
  | { type: 'commit.REPOSITORY_CHANGED' }
  | { type: 'commit.STASH_LIST_RECEIVED'; data: { stashes: StashEntry[] } }
  | { type: 'commit.STASH_SUCCESS'; data: { message: string } }
  | { type: 'commit.WORKTREE_LIST_RECEIVED'; data: { worktrees: WorktreeEntry[] } }
  | { type: 'commit.WORKTREE_ADDED'; data: { path: string; branch: string } }
  | { type: 'commit.WORKTREE_REMOVED'; data: { path: string } }
  | { type: 'commit.CONFLICT_RESOLVED'; data: { path: string } }
  | { type: 'commit.ALL_CONFLICTS_RESOLVED' }
  | { type: 'commit.LOG_LIST_RECEIVED'; data: { commits: CommitLogEntry[] } }
  | { type: 'commit.REVERT_COMMIT_SUCCESS'; data: { hash: string } }
  | { type: 'commit.RESET_COMMIT_SUCCESS'; data: { hash: string } }

// ── pull-request ─────────────────────────────────────────────────────────
export type IncomingPullRequestEvents =
  | { type: 'pr.GET_BASE_BRANCH' }
  | { type: 'pr.GET_BRANCH_DIFF'; baseBranch?: string; headBranch?: string }
  | { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string }
  | { type: 'pr.LIST_OPEN_PRS' }
  | { type: 'pr.SELECT_PR'; number: number }
  | { type: 'pr.CREATE_PR'; title: string; body: string; base?: string; draft?: boolean }
  | { type: 'pr.MERGE_PR'; number: number; method?: 'merge' | 'squash' | 'rebase' }
  | { type: 'pr.CLOSE_PR'; number: number }
  | { type: 'pr.TOGGLE_DRAFT'; number: number; isDraft: boolean }
  | { type: 'pr.CHECK_BRANCH_PR' }
  | { type: 'pr.CHECK_GH_AUTH' }
  | { type: 'pr.GET_PR_AUTOFILL' }
  | { type: 'pr.GET_SMART_BASE_BRANCH' }
  | { type: 'pr.DELETE_BRANCH'; branch: string }
  | { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
  | { type: 'pr.CREATE_COMMENT'; number: number; body: string }
  | { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_COMMENT'; commentId: number }
  | { type: 'pr.GET_COMMENTS'; number: number }
  | { type: 'pr.GET_REVIEW_THREADS'; number: number }
  | { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
  | { type: 'pr.RESOLVE_THREAD'; threadId: string }
  | { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
  | { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }

export type OutgoingPullRequestEvents =
  | { type: 'pr.BASE_BRANCH_RECEIVED'; data: { branch: string } }
  | { type: 'pr.BRANCH_DIFF_RECEIVED'; data: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
  | { type: 'pr.FILE_DIFF_RECEIVED'; data: GitDiff & { baseBranch: string; headBranch?: string } }
  | { type: 'pr.ERROR'; message: string }
  | { type: 'pr.STATUS_CHANGED'; data: { timestamp: Date } }
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }
  | { type: 'pr.OPEN_PRS_RECEIVED'; data: { prs: GhPullRequest[] } }
  /**
   * `fetchedAt` is when these details were read from GitHub, and the viewer keeps the newest per PR so a
   * slow retry cannot overwrite fresher data from a concurrent fetch.
   *
   * **A clock rather than a counter, because the two sides do not share a lifetime.** What this is
   * compared against lives in the renderer, which outlives the backend: anything reset by an API restart
   * or a pack reload reads as older there forever after, and every later answer is dropped.
   */
  | { type: 'pr.PR_DETAILS_RECEIVED'; data: { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number } }
  | { type: 'pr.PR_CREATED'; data: { pr: GhPullRequest } }
  | { type: 'pr.PR_MERGED'; data: { number: number } }
  | { type: 'pr.PR_CLOSED'; data: { number: number } }
  | { type: 'pr.PR_DRAFT_TOGGLED'; data: { number: number; isDraft: boolean } }
  | { type: 'pr.BRANCH_PR_CHECKED'; data: { pr: GhPullRequest | null } }
  | { type: 'pr.GH_AUTH_CHECKED'; data: { available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null } }
  | { type: 'pr.AUTOFILL_RECEIVED'; data: { title: string; body: string } }
  | { type: 'pr.SMART_BASE_BRANCH_RECEIVED'; data: { branch: string } }
  | { type: 'pr.BRANCH_DELETED'; data: { branch: string } }
  | { type: 'pr.PR_UPDATED'; data: { number: number; title?: string; body?: string; base?: string } }
  | { type: 'pr.COMMENT_CREATED'; data: { number: number } }
  | { type: 'pr.COMMENT_EDITED'; data: { commentId: number } }
  | { type: 'pr.COMMENT_DELETED'; data: { commentId: number } }
  | { type: 'pr.COMMENTS_RECEIVED'; data: { number: number; comments: GhPRComment[] } }
  | { type: 'pr.REVIEW_THREADS_RECEIVED'; data: { threads: GhReviewThread[] } }
  | { type: 'pr.THREAD_REPLIED'; data: { prNumber: number } }
  | { type: 'pr.THREAD_RESOLVED'; data: { threadId: string } }
  | { type: 'pr.THREAD_UNRESOLVED'; data: { threadId: string } }
  | { type: 'pr.REVIEW_COMMENT_EDITED'; data: { commentId: number } }
  | { type: 'pr.REVIEW_COMMENT_DELETED'; data: { commentId: number } }

// ── terminal ─────────────────────────────────────────────────────────
export type IncomingTerminalEvents =
  | { type: 'terminal.CREATE_TERMINAL'; title?: string; cwd?: string; shell?: string; cols?: number; rows?: number }
  | { type: 'terminal.CLOSE_TERMINAL'; terminalId: string }
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.RENAME_TERMINAL'; terminalId: string; customTitle: string }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TERMINAL_TAB'; terminalId: string }

export type OutgoingTerminalEvents =
  /**
   * A terminal exists — news for every window, each of which asks for the list again (\`terminal.REFRESH_LIST\`, answered
   * with \`terminal.TERMINALS_LISTED\`). It names the terminal and carries no instruction: a window that did not ask for
   * it must not open it, which is what \`terminal.OPENED\` is for.
   */
  | { type: 'terminal.CREATED'; data: { terminalId: string } }
  /**
   * The terminal *you* asked for, answered to the window that asked.
   *
   * Its id does not exist until it is created, so nothing the asker sent could identify it — which is why
   * this is addressed rather than keyed. Before it existed, `terminal.CREATED` carried both jobs and every
   * window routed a new terminal into its own panel.
   */
  | { type: 'terminal.OPENED'; data: TerminalInfo }
  | { type: 'terminal.OUTPUT'; data: { terminalId: string; data: string } }
  | { type: 'terminal.INITIAL_OUTPUT'; data: { terminalId: string; data: string } }
  | { type: 'terminal.CLOSED'; data: { terminalId: string } }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  | { type: 'terminal.ERROR'; data: { message: string; terminalId?: string } }
  | { type: 'terminal.TERMINALS_LISTED'; data: TerminalInfo[] }
  | { type: 'terminal.TERMINAL_TAB_OPENED'; data: TerminalInfo }

// ── actions ─────────────────────────────────────────────────────────
export type IncomingActionsEvents =
  | { type: 'codeActions.OPEN_ACTION'; actionId: string }
  | { type: 'codeActions.SAVE_ACTION'; actionId: string; actionFn: string }

export type OutgoingActionsEvents =
  | { type: 'codeActions.ACTION_SELECTED'; actionId: string; data: ActionEntity & { actionFnContent?: string } }
  | { type: 'codeActions.ACTION_UPDATED'; action: ActionEntity; actionId: string }
  | { type: 'codeActions.CODE_ERROR'; data: { message: string } }

// ── prompts ─────────────────────────────────────────────────────────
export type IncomingPromptsEvents =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; templateFn: string }

export type OutgoingPromptsEvents =
  | { type: 'codePrompts.PROMPT_SELECTED'; promptId: string; data: PromptEntity & { templateFnContent?: string } }
  | { type: 'codePrompts.PROMPT_UPDATED'; prompt: PromptEntity; promptId: string }
  | { type: 'codePrompts.CODE_ERROR'; data: { message: string } }

// ── The system's own ─────────────────────────────────────────────────────────────────────────────

export type IncomingCodeEvents =
  | IncomingExplorerEvents
  | IncomingSearchEvents
  | IncomingCommitEvents
  | IncomingPullRequestEvents
  | IncomingTerminalEvents
  | IncomingActionsEvents
  | IncomingPromptsEvents
  | { type: 'SET_BASE_DIRECTORY'; path: string; fromUserNavigation?: boolean }
  /** Settings → Providers: resolve a CLI and store where it was found, in this feature's own settings */
  | { type: 'TEST_CLI_PROVIDER'; provider: string }
  /**
   * What a window's code surface starts from, asked as the shell starts it: answered with \`CODE_STARTED\`, and by the
   * explorer and the terminals, to which the system hands this same ask, with the files and the running terminals
   */
  | { type: 'GET_CODE_START' }
export type OutgoingCodeEvents =
  | OutgoingExplorerEvents
  | OutgoingSearchEvents
  | OutgoingCommitEvents
  | OutgoingPullRequestEvents
  | OutgoingTerminalEvents
  | OutgoingActionsEvents
  | OutgoingPromptsEvents
  // Broadcast events (sent to all child systems)
  | { type: 'CODE_STARTED'; data: CodeConnectedData }
  /**
   * The code surface's directory moved, for every window, which all show the one directory: each asks again for what
   * it starts from and for what its panels show. News, with no listing on it.
   */
  | { type: 'BASE_DIRECTORY_CHANGED'; baseDirectory: string }
  /** What testing a CLI found, for the Settings view that asked (the host declares its surface takes it) */
  | { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string }

export type Contract = {
  context: CodeSystemContext
  incoming: IncomingCodeEvents
  outgoing: OutgoingCodeEvents
}
