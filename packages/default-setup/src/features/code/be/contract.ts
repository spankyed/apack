// The code system's contract: what it receives, what its own children send it, what it sends its surface,
// and its context. Its own module, not the feature's types barrel: `#generated/types` star-exports that,
// and one `Contract` per feature would collide there. Codegen reads this without running anything.
import type { ActionEntity, PromptEntity } from '@apackdev/sdk';
import type {
  CodeConnectedData, CodeSystemError, CommitFailure, CommitLogEntry, CodeSystemContext, DirectoryContent, DiscardKept, DiscardRestored, FileContent, FileInfo,
  GhPRComment, GhPullRequest, GhReviewThread, GitDiff, GitProgress, GitStatusFile, OperationMove, QuickOpenResult, RepositoryChange,
  RepositoryOperation, SearchProgress, SignInHelp,
  SearchResult, StashEntry, TerminalInfo, WorktreeEntry,
} from './types.ts';
import type { ActiveTokenInfo } from './services/gh-cli.ts';
import type { FileChangeInfo } from './services/open-file-watcher.ts';

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
  /** Which of what discarding these rows would remove cannot be brought back, for the window about to ask */
  | { type: 'commit.PREVIEW_DISCARD'; paths: string[] }
  /** Puts back what a discard kept, by the id its answer carried */
  | { type: 'commit.RESTORE_DISCARDED'; id: string }
  /** The user trusts the repository to have git run what its own configuration and hooks name */
  | { type: 'commit.TRUST_REPOSITORY'; repository: string }
  /** Stops the push running: git and what it started are ended, and the push is answered as stopped */
  | { type: 'commit.STOP_PUSH' }
  /** The user trusts the repository git refused for who owns it: added to their safe.directory */
  | { type: 'commit.TRUST_OWNERSHIP' }
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
  /** Carry on with what git is in the middle of, leave out the commit a rebase stopped at, or give it up */
  | { type: 'commit.MOVE_OPERATION'; move: OperationMove }
  /** The files in an untracked folder that is listed as one row */
  | { type: 'commit.LIST_UNTRACKED'; path: string }
  /** Stage one piece of a file's change, or with `staged` take one piece out of what is staged */
  | { type: 'commit.APPLY_HUNK'; path: string; staged: boolean; hunk: string }
  /** Have the GitHub CLI give git its sign-in for this host */
  | { type: 'commit.SET_UP_SIGN_IN'; host: string; during?: 'push' | 'pull' }
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }

export type OutgoingCommitEvents =
  /**
   * What the commit panel shows of the checkout. `watching` is false when its file watches could not be opened or
   * have failed: the panel then changes only when it is asked again, and says so. `truncated` says there are more
   * changed files than `files` lists. `operation` is what git is in the middle of there, when it is in the middle
   * of anything. `fetchSuspended` says fetching by itself has stopped, the remote having asked for a sign-in
   * nobody was there to give: how far the branch is from its upstream is then as of the last fetch that worked
   */
  | { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean; signIn?: SignInHelp } }
  /** What git was in the middle of was moved on as asked. Where that leaves the repository is in its status */
  | { type: 'commit.OPERATION_MOVED'; data: { move: OperationMove } }
  | { type: 'commit.DIFF_RECEIVED'; data: GitDiff }
  | { type: 'commit.FILES_STAGED'; data: { paths: string[] } }
  | { type: 'commit.FILES_UNSTAGED'; data: { paths: string[] } }
  | { type: 'commit.COMMIT_SUCCESS'; data: { message: string } }
  | { type: 'commit.FILE_REVERTED'; data: { path: string; kept: DiscardKept } }
  | { type: 'commit.FILES_REVERTED'; data: { paths: string[]; kept: DiscardKept } }
  | { type: 'commit.DISCARD_PREVIEWED'; data: { paths: string[]; notKept: string[] } }
  | { type: 'commit.DISCARD_RESTORED'; data: { id: string } & DiscardRestored }
  | { type: 'commit.REPOSITORY_TRUSTED'; data: { repository: string } }
  | { type: 'commit.OWNERSHIP_TRUSTED'; data: { directory: string } }
  /** A push the user stopped, answered to the window that pushed: nothing failed */
  | { type: 'commit.PUSH_STOPPED' }
  | { type: 'commit.ERROR_RECEIVED'; data: CommitFailure }
  | { type: 'commit.HUNK_APPLIED'; data: { path: string; staged: boolean; hunk: string } }
  /** How far along a push, a pull or a checkout is, for the window that asked for it */
  | { type: 'commit.PROGRESS'; data: { during: 'push' | 'pull' | 'checkout' } & GitProgress }
  | { type: 'commit.UNTRACKED_LISTED'; data: { path: string; files: string[]; truncated: boolean } }
  /** Git signs in to this host through the GitHub CLI now */
  | { type: 'commit.SIGN_IN_SET_UP'; data: { host: string; during?: 'push' | 'pull' } }
  | { type: 'commit.BRANCH_RETRIEVED'; data: { branch: string } }
  | { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[] } }
  | { type: 'commit.BRANCH_CHECKOUT_SUCCESS'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PUSHED'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PULLED'; data: { branchName: string } }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  /**
   * The repository changed, on disk or by a write from any window: news for every window. It says which parts
   * changed and carries none of them, so a window asks again for what it shows of those and for nothing else —
   * an edited file is no reason to read the log again
   */
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
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
  /** `fetchMissing`: content a partial clone was not given is fetched for this diff, where it is otherwise answered as missing */
  | { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string; fetchMissing?: boolean }
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
  /** A file's diff needs content this partial clone was not given, which is fetched only when the user asks */
  | { type: 'pr.FILE_CONTENT_MISSING'; data: { path: string; baseBranch: string; headBranch?: string } }
  | { type: 'pr.ERROR'; message: string }
  | { type: 'pr.STATUS_CHANGED'; data: { timestamp: Date } }
  /** The repository's commits or branches moved, which is all of it a pull request is read from: news for every window */
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
  /** `target` is one of the code settings' `terminalTargets`, by id: somewhere other than this machine to run it */
  | { type: 'terminal.CREATE_TERMINAL'; title?: string; cwd?: string; shell?: string; cols?: number; rows?: number; target?: string }
  | { type: 'terminal.CLOSE_TERMINAL'; terminalId: string }
  /** Start a new shell under a terminal that already exists, keeping its id and everything attached to it */
  | { type: 'terminal.RESTART_TERMINAL'; terminalId: string }
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number; cellWidth?: number; cellHeight?: number }
  /** This window has stopped showing that terminal, so its fit no longer holds the grid down */
  | { type: 'terminal.STOPPED_FITTING'; terminalId: string }
  | { type: 'terminal.RENAME_TERMINAL'; terminalId: string; customTitle: string }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TERMINAL_TAB'; terminalId: string }
  /** Whether that terminal's shell goes on running when the app is not, to be taken up again at the next start */
  | { type: 'terminal.KEEP_TERMINAL'; terminalId: string; kept: boolean }
  /** Open that terminal's recording to look back through, drawn at this size. Answered with `terminal.REWOUND` */
  | { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
  /** Show an open recording as it was at `at`, in milliseconds since the Unix epoch */
  | { type: 'terminal.REWIND_SEEK'; session: string; at: number }
  | { type: 'terminal.REWIND_CLOSE'; session: string }
  /** The window looking back through a recording measured how many cells fit where it draws it */
  | { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }

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
  /**
   * **What a terminal's program did that is not on its screen**, for every window: the five below. The
   * screen itself is not an event at all — a window draws a terminal from the rows its session sends it
   * (`TerminalInfo.session`), so nothing a program prints crosses here.
   *
   * Each is a claim the program made. A window decides what to do about one where the person is: whether
   * text reaches their clipboard, whether a notification is worth their attention.
   */
  | { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
  | { type: 'terminal.BELL'; data: { terminalId: string } }
  | { type: 'terminal.NOTIFIED'; data: { terminalId: string; title: string; body: string } }
  /** How far along the program says it is; `percent` is `null` where it gave none, and `none` clears it */
  | { type: 'terminal.PROGRESS'; data: { terminalId: string; state: 'none' | 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null } }
  /** The name the program gave its terminal, which is empty when it took the name back */
  | { type: 'terminal.TITLED'; data: { terminalId: string; title: string } }
  | { type: 'terminal.CLOSED'; data: { terminalId: string } }
  /**
   * The shell ended badly and **the terminal was kept**, so the user can read what it said and start it
   * again where it was. A shell that exits 0 is a user closing their terminal and sends `CLOSED` instead.
   */
  | { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
  /**
   * The grid the pty is actually running at, which is **not** necessarily the one a window asked for.
   *
   * A pty has one `(cols, rows)` and the window that opened it owns them (M2), so a second window's fit is
   * refused — and a window that is never told renders at a grid nothing agreed to. This carries the accepted
   * one, so no window has to assume its own request took effect: broadcast when the grid moved, since every
   * window showing the terminal needs it, and replied to the asker when its request was refused, which is
   * news to nobody else.
   */
  | { type: 'terminal.RESIZED'; data: { terminalId: string; cols: number; rows: number } }
  /** A new shell is running under a terminal that was already there; `generation` says how many it has had */
  | { type: 'terminal.RESTARTED'; data: TerminalInfo }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  | { type: 'terminal.ERROR'; data: { message: string; terminalId?: string } }
  | { type: 'terminal.TERMINALS_LISTED'; data: TerminalInfo[] }
  | { type: 'terminal.TERMINAL_TAB_OPENED'; data: TerminalInfo }
  /** Whether a terminal's shell outlives the app changed: news for every window, which each draws on its tab */
  | { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
  /**
   * A recording is open, for the window that asked: `session` is what its view is drawn from, and it runs
   * between `first` and `last`, in milliseconds since the Unix epoch.
   */
  | { type: 'terminal.REWOUND'; data: { terminalId: string; session: string; first: number; last: number } }
  /** The moment an open recording now shows, for the window that asked */
  | { type: 'terminal.REWIND_SOUGHT'; data: { session: string; at: number } }

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
  /**
   * Something may have changed on disk that no file event reported: a window gained focus, a terminal command
   * finished, an agent's turn ended. The repository and the open files are read again, and what differs is
   * announced as it would have been.
   */
  /** `by` a window that gained focus; without it, a terminal command or an agent's turn has just ended */
  | { type: 'CHECK_FOR_EXTERNAL_CHANGES'; by?: 'window' }
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
