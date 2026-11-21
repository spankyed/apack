// The code system's contract: what it receives, what its own children send it, what it sends its surface,
// and its context. Its own module, not the feature's types barrel: `#generated/types` star-exports that,
// and one `Contract` per feature would collide there. Codegen reads this without running anything.
import type { ActionEntity, PromptEntity } from '@apackdev/sdk';
import type {
  CodeConnectedData, RepositoryUnder, CodeSystemError, CommitFailure, CommitTrailer, CodeSystemContext, DirectoryContent, DiscardKept, DiscardRestored, FileContent,
  PRBranchCheckout, GhPRComment, GhPullRequest, GhReviewThread, GitDiff, GitProgress, GitStatusFile, ProgressDuring, OperationMove, QuickOpenResult, RepositoryChange,
  RepositoryOperation, SearchProgress, SignInHelp,
  SearchResult, StashEntry, BranchStandingOf, LineCount, ChangedFile, HistoryCommit, TerminalInfo, TerminalStatus, WorktreeEntry, BlameLine, MergePreview, StartableOperation, RewriteAction, SlowStatus,
} from './types.ts';
import type { GitHubApiFailure, PRListState } from './services/github-api.ts';
import type { FileChangeInfo } from './services/open-file-watcher.ts';
import type { GitHubAccount } from './services/github.ts';

// ── The child actors' events ─────────────────────────────────────────────────────────────────────
// They live here rather than beside each child because this module is the contract leaf: codegen reads it as a
// declared type, and `#generated/events` imports it — so anything it reaches must not import `#generated/events`
// back, which every child does for `broadcast`. Each child imports its own two from here.
// ── explorer ─────────────────────────────────────────────────────────
export type IncomingExplorerEvents =
  /** The editor stopped showing the file: a change to it on disk is no one's to hear of */
  | { type: 'explorer.CLOSE_FILE'; path: string }

export type OutgoingExplorerEvents =
  /** A file open in an editor changed on disk: news for every window, which each reads again if it shows the file */
  | { type: 'explorer.FILE_CHANGED_EXTERNALLY'; data: FileChangeInfo }

/** A file operation refused: `code` says why, and `path` where, as the filesystem service names them */
type FileFailure = { file: Omit<CodeSystemError, 'message'> }

/** What a window asks the explorer, answered by the code system's explorer child (`explorerSystem`) over its folder */
export type ExplorerAsks = {
  'explorer.LIST_FILES': { args: { path: string }; answer: DirectoryContent; refuses: FileFailure }
  /** A file's content for an editor, which is watched from then on until the editor closes it (`explorer.CLOSE_FILE`) */
  'explorer.READ_FILE': { args: { path: string }; answer: FileContent; refuses: FileFailure }
  'explorer.WRITE_FILE': { args: { path: string; content: string }; answer: { path: string }; refuses: FileFailure }
  'explorer.DELETE_FILE': { args: { path: string }; answer: { path: string }; refuses: FileFailure }
  'explorer.RENAME_FILE': { args: { oldPath: string; newPath: string }; answer: { oldPath: string; newPath: string }; refuses: FileFailure }
  'explorer.CREATE_DIRECTORY': { args: { path: string }; answer: { path: string }; refuses: FileFailure }
  /** Every file under a folder, for quick open */
  'explorer.QUICK_OPEN_SEARCH': { args: { baseDirectory: string }; answer: QuickOpenResult[]; refuses: FileFailure }
  'explorer.MOVE_FILES': { args: { sourcePaths: string[]; targetDir: string }; answer: { sourcePaths: string[]; targetDir: string; movedPaths: string[] }; refuses: FileFailure }
  'explorer.COPY_FILES': { args: { sourcePaths: string[]; targetDir: string }; answer: { targetDir: string; copiedPaths: string[] }; refuses: FileFailure }
}

// ── search ─────────────────────────────────────────────────────────
/** What a window asks the search, answered by the code system's search child (`searchSystem`) */
export type SearchAsks = {
  /**
   * Every match, once the search ends. As it goes it tells whoever asked how far it is and each file's matches as
   * they are found. Whoever asked stops it by no longer waiting: a search panel that starts another, or cancels
   */
  'search.SEARCH_FILES': {
    args: { query: string; path: string; includePattern?: string; excludePattern?: string; caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; maxResults?: number }
    progress: { progress: SearchProgress } | { result: SearchResult }
    answer: { results: SearchResult[]; totalMatches: number }
  }
}

// ── commit ─────────────────────────────────────────────────────────
export type OutgoingCommitEvents =
  /**
   * The repository changed, on disk or by a write from any window: news for every window. It says which parts
   * changed and carries none of them, so a window asks again for what it shows of those and for nothing else —
   * an edited file is no reason to read the log again
   */
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
  /** The commit message a flow wrote for the window that asked for one (`commit.GENERATE_MESSAGE`) has begun */
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  /** The flow writing a commit message for the window that asked made none, and this says why */
  | { type: 'commit.MESSAGE_NOT_GENERATED'; data: { message: string } }

/**
 * Why a git command failed, beside the message: what git said of it and what the panel can do about it. Every commit
 * ask may be refused with one (`git`)
 */
export type GitFailure = Omit<CommitFailure, 'message'>

/** The ways every commit ask may be refused: git's failure, with what can be done about it */
type GitFails = { git: GitFailure }

/**
 * What Undo would take back after a write that can be taken back: nothing (`null`) when there is none, and absent
 * when it could not be read
 */
type UndoableAfter = { undoable?: { id: string; summary: string } | null }

/** What the commit panel shows of the checkout, as `commit.GET_GIT_STATUS` answers it */
export type CommitStatus = {
  files: GitStatusFile[]; counts?: LineCount[]; pullPreview?: MergePreview; hasIdentity?: boolean; slowStatus?: SlowStatus; truncated: boolean;
  branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; watchSilent?: boolean;
  operation?: RepositoryOperation; fetchSuspended?: boolean; signIn?: SignInHelp
}

/** How far along a push, a pull, a checkout or a submodule update is, as git says, told to whoever asked for it while it runs */
type GitProgressDuring = { during: ProgressDuring } & GitProgress

/** What a window asks of the repository, answered by the commit child over the repository it holds */
export type CommitAsks = {
  /**
   * What the commit panel shows of the checkout. `watching` is false when its file watches could not be opened or
   * have failed: the panel then changes only when it is asked again, and says so. `truncated` says there are more
   * changed files than `files` lists. `operation` is what git is in the middle of there, when it is in the middle
   * of anything. `fetchSuspended` says fetching by itself has stopped, the remote having asked for a sign-in
   * nobody was there to give: how far the branch is from its upstream is then as of the last fetch that worked
   */
  'commit.GET_GIT_STATUS': { answer: CommitStatus; refuses: GitFails }
  'commit.GET_GIT_DIFF': { args: { path?: string; staged?: boolean }; answer: GitDiff; refuses: GitFails }
  'commit.STAGE_FILES': { args: { paths: string[] }; answer: { paths: string[] }; refuses: GitFails }
  'commit.UNSTAGE_FILES': { args: { paths: string[] }; answer: { paths: string[] }; refuses: GitFails }
  /** Commits what is staged, answered with the message as committed */
  'commit.COMMIT': { args: { message: string }; answer: { message: string } & UndoableAfter; refuses: GitFails }
  'commit.REVERT_FILE': { args: { path: string }; answer: { path: string; kept: DiscardKept }; refuses: GitFails }
  'commit.REVERT_FILES': { args: { paths: string[] }; answer: { paths: string[]; kept: DiscardKept }; refuses: GitFails }
  /** Which of what discarding these rows would remove cannot be brought back, for the window about to ask */
  'commit.PREVIEW_DISCARD': { args: { paths: string[] }; answer: { paths: string[]; notKept: string[] }; refuses: GitFails }
  /** Puts back what a discard kept, by the id its answer carried */
  'commit.RESTORE_DISCARDED': { args: { id: string }; answer: { id: string } & DiscardRestored; refuses: GitFails }
  /** The user trusts the repository to have git run what its own configuration and hooks name */
  'commit.TRUST_REPOSITORY': { args: { repository: string }; answer: { repository: string }; refuses: GitFails }
  /** The user trusts the repository git refused for who owns it: added to their safe.directory */
  'commit.TRUST_OWNERSHIP': { answer: { directory: string }; refuses: GitFails }
  /** The branches, and how each local one stands against what it follows, by its name */
  'commit.GET_ALL_BRANCHES': { answer: { branches: string[]; standing?: Record<string, BranchStandingOf>; tags?: { name: string; commit: string }[] }; refuses: GitFails }
  /** Checks out a branch there is, and with `pull` pulls it from what it follows once it is checked out */
  'commit.CHECKOUT_BRANCH': { args: { branchName: string; pull?: boolean }; progress: GitProgressDuring; answer: { branchName: string }; refuses: GitFails }
  /** Makes a branch at what is checked out, and checks it out */
  'commit.CREATE_BRANCH': { args: { branchName: string }; answer: { branchName: string }; refuses: GitFails }
  /** Pushes what is checked out. Whoever asked stops it by no longer waiting, which ends git and what it started */
  'commit.PUBLISH_BRANCH': { progress: GitProgressDuring; answer: { branchName: string }; refuses: GitFails }
  'commit.PULL_BRANCH': { progress: GitProgressDuring; answer: { branchName: string }; refuses: GitFails }
  /**
   * Hands the changes to the flow that writes a commit message, answered once it has them: the flow tells the asking
   * window what it made (`commit.MESSAGE_GENERATED`) or why it made none
   */
  'commit.GENERATE_MESSAGE': { refuses: GitFails }
  /** Stash what is changed: only what is staged, or only `paths`, when asked. Answered with the stash's message */
  'commit.STASH_PUSH': { args: { message?: string; stagedOnly?: boolean; paths?: string[] }; answer: { message: string }; refuses: GitFails }
  /** Make a tag at `commit` (what is checked out when none), annotated when `message` is given */
  'commit.CREATE_TAG': { args: { name: string; commit?: string; message?: string }; answer: { name: string }; refuses: GitFails }
  'commit.DELETE_TAG': { args: { name: string }; answer: { name: string }; refuses: GitFails }
  /** Push a tag to the remote */
  'commit.PUSH_TAG': { args: { name: string }; answer: { name: string }; refuses: GitFails }
  'commit.RENAME_BRANCH': { args: { name: string; to: string }; answer: { name: string; to: string }; refuses: GitFails }
  /**
   * Turn on git's own file monitor and untracked cache here, which the user clicked for: it writes the repository's
   * config. Answered with which of the two were turned on: the file monitor only where git has one for this system
   */
  'commit.SPEED_UP_STATUS': { answer: { fileMonitor: boolean; untrackedCache: boolean }; refuses: GitFails }
  'commit.STASH_LIST': { answer: { stashes: StashEntry[] }; refuses: GitFails }
  /** A stash applied without a conflict; one that conflicts is refused, and the status shows the conflict */
  'commit.STASH_APPLY': { args: { index: number }; answer: { index: number; popped: boolean }; refuses: GitFails }
  /** A stash applied and dropped without a conflict; one that conflicts is refused and kept */
  'commit.STASH_POP': { args: { index: number }; answer: { index: number; popped: boolean }; refuses: GitFails }
  'commit.STASH_DROP': { args: { index: number }; answer: UndoableAfter; refuses: GitFails }
  'commit.STASH_CLEAR': { answer: UndoableAfter; refuses: GitFails }
  /** The files a stash holds, to look into before applying it */
  'commit.GET_STASH_CHANGES': { args: { index: number }; answer: { index: number; files: ChangedFile[] }; refuses: GitFails }
  /**
   * Who last changed each line of a file, from the top of the folder, for the editor's gutter. Whoever asked stops
   * the read by no longer waiting, as a panel does that asks for another file's
   */
  'commit.GET_BLAME': { args: { path: string }; answer: { path: string; lines: BlameLine[] }; refuses: GitFails }
  /** Bring a submodule to the commit the repository records for it, setting it up first if it is not */
  'commit.UPDATE_SUBMODULE': { args: { path: string }; progress: GitProgressDuring; answer: { path: string }; refuses: GitFails }
  /**
   * Takes back the last write the engine made here; `evenIfPublished` once the user said to for a commit already
   * pushed. Refused as `published` when the commit is already on a remote branch, undone only once the user says so
   */
  'commit.UNDO_LAST': { args: { evenIfPublished?: boolean }; answer: { id: string; summary: string } & UndoableAfter; refuses: GitFails & { published: {} } }
  'commit.WORKTREE_LIST': { answer: { worktrees: WorktreeEntry[] }; refuses: GitFails }
  'commit.WORKTREE_ADD': { args: { path: string; branch?: string; createBranch?: boolean }; answer: { path: string; branch: string }; refuses: GitFails }
  'commit.WORKTREE_REMOVE': { args: { path: string; force?: boolean }; answer: { path: string }; refuses: GitFails }
  'commit.RESOLVE_CONFLICT': { args: { path: string; strategy: 'ours' | 'theirs' }; answer: { path: string }; refuses: GitFails }
  'commit.MARK_RESOLVED': { args: { path: string }; answer: { path: string }; refuses: GitFails }
  'commit.RESOLVE_ALL_CONFLICTS': { args: { strategy: 'ours' | 'theirs' }; refuses: GitFails }
  /**
   * Carry on with what git is in the middle of, leave out the commit a rebase stopped at, or give it up. Where that
   * leaves the repository is in its status
   */
  'commit.MOVE_OPERATION': { args: { move: OperationMove }; answer: { move: OperationMove }; refuses: GitFails }
  /** Merge a branch in, rebase onto one, or pick a commit onto what is checked out: `stopped` on a conflict, which the status describes as in progress */
  'commit.START_OPERATION': { args: { kind: StartableOperation; target: string }; answer: { kind: StartableOperation; target: string; stopped: boolean } & UndoableAfter; refuses: GitFails }
  /**
   * Amend the last commit with what is staged, and `message` in place of its own when given. Refused as `published`
   * when a remote branch already holds it: done only once the user says to go on
   */
  'commit.AMEND': { args: { message?: string; evenIfPublished?: boolean }; answer: UndoableAfter; refuses: GitFails & { published: {} } }
  /** A commit's whole message, for rewording it */
  'commit.GET_COMMIT_MESSAGE': { args: { hash: string }; answer: { hash: string; message: string }; refuses: GitFails }
  /** The trailers git reads at the end of the message being written, with the message they were read of */
  'commit.READ_TRAILERS': { args: { message: string }; answer: { message: string; trailers: CommitTrailer[] }; refuses: GitFails }
  /** The message being written without one of its trailers, each line of it: `without` is `message` when it had no such trailer */
  'commit.REMOVE_TRAILER': { args: { message: string; trailer: CommitTrailer }; answer: { message: string; without: string }; refuses: GitFails }
  /**
   * Reword a commit of what is checked out, fold it into the one before it, or drop it, keeping those after it.
   * Refused as `published` when a remote branch already holds commits it would change
   */
  'commit.REWRITE_COMMIT': { args: { hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }; answer: { hash: string; action: RewriteAction } & UndoableAfter; refuses: GitFails & { published: {} } }
  /** What merging a branch in would do, before it is done */
  'commit.PREVIEW_MERGE': { args: { target: string }; answer: { target: string; preview: MergePreview }; refuses: GitFails }
  /** The files in an untracked folder that is listed as one row */
  'commit.LIST_UNTRACKED': { args: { path: string }; answer: { path: string; files: string[]; truncated: boolean }; refuses: GitFails }
  /** Stage one piece of a file's change, or with `staged` take one piece out of what is staged */
  'commit.APPLY_HUNK': { args: { path: string; staged: boolean; hunk: string }; answer: { path: string; staged: boolean; hunk: string }; refuses: GitFails }
  /** Git can sign in to this host now the app is signed in to GitHub: fetching starts again, and the window runs again what was refused */
  'commit.SET_UP_SIGN_IN': { args: { host: string; during?: 'push' | 'pull' }; answer: { host: string; during?: 'push' | 'pull' }; refuses: GitFails }
  /**
   * A page of history: from what is checked out, or from where `cursor` left off; with `path`, that file's history.
   * The answer says which file's it is and whether it goes on from a cursor; `cursor` for the next. Whoever asked
   * stops the read by no longer waiting, as a panel does that asks for the history again
   */
  'commit.LOG_LIST': { args: { cursor?: string; path?: string }; answer: { commits: HistoryCommit[]; cursor?: string; path?: string; continued?: boolean }; refuses: GitFails }
  'commit.REVERT_COMMIT': { args: { hash: string }; answer: { hash: string }; refuses: GitFails }
  'commit.RESET_TO_COMMIT': { args: { hash: string }; answer: { hash: string } & UndoableAfter; refuses: GitFails }
}

// ── pull-request ─────────────────────────────────────────────────────────
export type OutgoingPullRequestEvents =
  /** The repository's commits or branches moved, which is all of it a pull request is read from: news for every window */
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }

/**
 * A pull request's details once GitHub has worked out whether it can merge.
 *
 * `fetchedAt` is when these details were read from GitHub, and the viewer keeps the newest per PR so a slow retry
 * cannot overwrite fresher data from a concurrent fetch.
 *
 * **A clock rather than a counter, because the two sides do not share a lifetime.** What this is compared against
 * lives in the renderer, which outlives the backend: anything reset by an API restart or a pack reload would read as
 * older there forever after, and every later answer would be dropped.
 */
export type PRDetails = { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number }

/** Where a file's diff is asked of: the comparison it is in, and the file */
export type PRFileDiffWhere = { path: string; baseBranch: string; headBranch?: string; prNumber?: number }

/** A refusal of GitHub's, with the reason the panel acts on, as `pr.CHECK_GITHUB_ACCESS` answers it */
type GitHubRefused = { github: { reason: GitHubApiFailure } }

/** What a window asks of the pull requests, answered by the pull request child (`features/pull-request.ts`) */
export type PullRequestAsks = {
  /** `prNumber` reads the head from what GitHub keeps of that pull request, which outlives its branch */
  'pr.GET_BRANCH_DIFF': { args: { baseBranch?: string; headBranch?: string; prNumber?: number }; answer: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
  /**
   * `fetchMissing`: content a partial clone was not given is fetched for this diff, where it is otherwise refused as
   * `content-missing`, which is fetched only when the user asks
   */
  'pr.GET_BRANCH_FILE_DIFF': {
    args: PRFileDiffWhere & { fetchMissing?: boolean }
    answer: GitDiff & { baseBranch: string; headBranch?: string }
    refuses: { 'content-missing': PRFileDiffWhere }
  }
  /** A page of the pull requests in `state`, newest first, from `after` (the last page's `next`), by `query` where there is one; `next` is `null` on the last */
  'pr.LIST_PRS': { args: { state: PRListState; query?: string; after?: string }; answer: { prs: GhPullRequest[]; next: string | null }; refuses: GitHubRefused }
  /** Checks out the pull request's head as a branch here: the branch it became, and what that did to a branch already there */
  'pr.CHECKOUT_PR': { args: { number: number }; answer: { number: number; branch: string; checkout: PRBranchCheckout }; refuses: GitHubRefused }
  /** The pull request's details */
  'pr.SELECT_PR': { args: { number: number }; answer: PRDetails; refuses: GitHubRefused }
  'pr.CREATE_PR': { args: { title: string; body: string; base?: string; draft?: boolean }; answer: { pr: GhPullRequest }; refuses: GitHubRefused }
  /**
   * `sha` is the head shown: GitHub merges nothing where the head has moved since (`head-moved`). A refused merge
   * carries the pull request read again, where it could be, so the panel shows what refused it
   */
  'pr.MERGE_PR': { args: { number: number; method?: 'merge' | 'squash' | 'rebase'; sha?: string }; answer: { number: number }; refuses: { github: { reason: GitHubApiFailure; details?: PRDetails } } }
  'pr.CLOSE_PR': { args: { number: number }; answer: { number: number }; refuses: GitHubRefused }
  /** `isDraft` is what it is now. Marked ready, its details once GitHub has worked out whether it can merge */
  'pr.TOGGLE_DRAFT': { args: { number: number; isDraft: boolean }; answer: { number: number; isDraft: boolean; details?: PRDetails }; refuses: GitHubRefused }
  /** The current branch's own pull request, `null` where it has none */
  'pr.CHECK_BRANCH_PR': { answer: { pr: GhPullRequest | null }; refuses: GitHubRefused }
  /** Whether the app's GitHub sign-in can work with the pull requests of the repository the remote names: `ok`, or why not, with what to tell the user */
  'pr.CHECK_GITHUB_ACCESS': { answer: { access: 'ok' | GitHubApiFailure; message?: string } }
  /** A title and a body for a new pull request, from the branch's commits: empty where they cannot be read */
  'pr.GET_PR_AUTOFILL': { answer: { title: string; body: string } }
  /** The branch a new pull request is most likely against */
  'pr.GET_SMART_BASE_BRANCH': { answer: { branch: string } }
  /**
   * Deletes the pull request's branch on GitHub: refused for a fork's branch, and for one another open pull request
   * is from. Answered with the branch deleted, or one already gone
   */
  'pr.DELETE_BRANCH': { args: { number: number }; answer: { branch: string }; refuses: GitHubRefused }
  /** A base moved brings the details once GitHub has worked out whether it can merge */
  'pr.UPDATE_PR': { args: { number: number; title?: string; body?: string; base?: string }; answer: { number: number; title?: string; body?: string; base?: string; details?: PRDetails }; refuses: GitHubRefused }
  'pr.CREATE_COMMENT': { args: { number: number; body: string }; answer: { number: number }; refuses: GitHubRefused }
  'pr.EDIT_COMMENT': { args: { commentId: number; body: string }; answer: { commentId: number }; refuses: GitHubRefused }
  'pr.DELETE_COMMENT': { args: { commentId: number }; answer: { commentId: number }; refuses: GitHubRefused }
  'pr.GET_COMMENTS': { args: { number: number }; answer: { number: number; comments: GhPRComment[] }; refuses: GitHubRefused }
  'pr.GET_REVIEW_THREADS': { args: { number: number }; answer: { threads: GhReviewThread[] }; refuses: GitHubRefused }
  'pr.REPLY_TO_THREAD': { args: { prNumber: number; commentId: number; body: string }; answer: { prNumber: number }; refuses: GitHubRefused }
  'pr.RESOLVE_THREAD': { args: { threadId: string }; answer: { threadId: string }; refuses: GitHubRefused }
  'pr.UNRESOLVE_THREAD': { args: { threadId: string }; answer: { threadId: string }; refuses: GitHubRefused }
  'pr.EDIT_REVIEW_COMMENT': { args: { commentId: number; body: string }; answer: { commentId: number }; refuses: GitHubRefused }
  'pr.DELETE_REVIEW_COMMENT': { args: { commentId: number }; answer: { commentId: number }; refuses: GitHubRefused }
}

// ── terminal ─────────────────────────────────────────────────────────
export type IncomingTerminalEvents =
  /**
   * Keystrokes, sent as typed and answered by nothing: the hottest send there is, and a terminal not found is
   * reported to the user rather than answered
   */
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  /** This window has stopped showing that terminal, so its fit no longer holds the grid down */
  | { type: 'terminal.STOPPED_FITTING'; terminalId: string }
  /** The person is looking at that terminal: what its programs have said they finished or failed at is seen */
  | { type: 'terminal.STATUS_SEEN'; terminalId: string }
  | { type: 'terminal.REWIND_CLOSE'; session: string }
  /** The window looking back through a recording measured how many cells fit where it draws it */
  | { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }

export type OutgoingTerminalEvents =
  /**
   * A terminal exists — news for every window, each of which asks for the list again (`terminal.REFRESH_LIST`). It
   * names the terminal and carries no instruction: a window that did not ask for it must not open it, which is what
   * the answer to `terminal.CREATE_TERMINAL` is for.
   */
  | { type: 'terminal.CREATED'; data: { terminalId: string } }
  /**
   * **What a terminal's program did that is not on its screen**, for every window: the five below. The
   * screen itself is not an event at all — a window draws a terminal from the rows its session sends it
   * (`TerminalInfo.session`), so nothing a program prints crosses here.
   *
   * Each is a claim the program made. A window decides what to do about one where the person is: whether
   * text reaches their clipboard, whether a notification is worth their attention.
   */
  | { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
  // `bellId` names this one bell: every window receives it, and a notification for it is shown once across them
  | { type: 'terminal.BELL'; data: { terminalId: string; bellId: string } }
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
   * window showing the terminal needs it. A window whose own fit was refused is told by the answer to its
   * `terminal.RESIZE_TERMINAL`, that being news to nobody else.
   */
  | { type: 'terminal.RESIZED'; data: { terminalId: string; cols: number; rows: number } }
  /** A new shell is running under a terminal that was already there; `generation` says how many it has had */
  | { type: 'terminal.RESTARTED'; data: TerminalInfo }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  /** Whether a terminal's shell outlives the app changed: news for every window, which each draws on its tab */
  | { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
  /**
   * What a terminal's programs say they are doing changed, or what of it the person has seen did: news for
   * every window. **Every record, as it stands** — a window replaces what it held. Empty when there is none
   */
  | { type: 'terminal.STATUS'; data: { terminalId: string; statuses: TerminalStatus[] } }

/**
 * What a window asks of the terminals, answered by the code system's terminal child (`terminalSystem`). A terminal
 * that is not there, or a broker that refused, is a failure whoever asked is answered with and shows
 */
export type TerminalAsks = {
  /**
   * `target` is one of the code settings' `terminalTargets`, by id: somewhere other than this machine to run it.
   * Answered with the terminal *you* asked for: its id does not exist until it is created, so nothing the asker sent
   * could identify it. Every window hears `terminal.CREATED` as well, and none of them opens it
   */
  'terminal.CREATE_TERMINAL': { args: { title?: string; cwd?: string; shell?: string; cols?: number; rows?: number; target?: string }; answer: TerminalInfo }
  'terminal.CLOSE_TERMINAL': { args: { terminalId: string } }
  /** Start a new shell under a terminal that already exists, keeping its id and everything attached to it */
  'terminal.RESTART_TERMINAL': { args: { terminalId: string } }
  /**
   * This window's fit. Answered with the grid the pty runs at when that is not the one asked for — another window's
   * smaller fit holds it — and `null` when it took
   */
  'terminal.RESIZE_TERMINAL': { args: { terminalId: string; cols: number; rows: number; cellWidth?: number; cellHeight?: number }; answer: { terminalId: string; cols: number; rows: number } | null }
  'terminal.RENAME_TERMINAL': { args: { terminalId: string; customTitle: string } }
  /** The running terminals */
  'terminal.REFRESH_LIST': { answer: TerminalInfo[] }
  /** A running terminal, to open as a tab */
  'terminal.OPEN_TERMINAL_TAB': { args: { terminalId: string }; answer: TerminalInfo }
  /** Whether that terminal's shell goes on running when the app is not, to be taken up again at the next start */
  'terminal.KEEP_TERMINAL': { args: { terminalId: string; kept: boolean } }
  /**
   * Open that terminal's recording to look back through, drawn at this size, for the window that asked: `session` is
   * what its view is drawn from, and it runs between `first` and `last`, in milliseconds since the Unix epoch
   */
  'terminal.REWIND': { args: { terminalId: string; cols: number; rows: number }; answer: { terminalId: string; session: string; first: number; last: number } }
  /**
   * Show an open recording as it was at `at`, in milliseconds since the Unix epoch. Answered with the moment it
   * shows now, `null` where the recording is not open
   */
  'terminal.REWIND_SEEK': { args: { session: string; at: number }; answer: { session: string; at: number } | null }
}

// ── actions ─────────────────────────────────────────────────────────

/** What a window asks of an action's code, answered by the code system's actions child (`actionsSystem`) */
export type ActionsAsks = {
  /** The action, with its code to edit in a tab */
  'codeActions.OPEN_ACTION': { args: { actionId: string }; answer: ActionEntity & { actionFnContent?: string }; refuses: { 'not-found': {} } }
  /** Saves the tab's code into the action, answered with the action as it is now */
  'codeActions.SAVE_ACTION': { args: { actionId: string; actionFn: string }; answer: ActionEntity; refuses: { 'not-found': {} } }
}

// ── prompts ─────────────────────────────────────────────────────────

/** What a window asks of a prompt's template, answered by the code system's prompts child (`promptsSystem`) */
export type PromptsAsks = {
  /** The prompt, with its template to edit in a tab */
  'codePrompts.OPEN_PROMPT': { args: { promptId: string }; answer: PromptEntity & { templateFnContent?: string }; refuses: { 'not-found': {} } }
  /** Saves the tab's template into the prompt, answered with the prompt as it is now */
  'codePrompts.SAVE_PROMPT': { args: { promptId: string; templateFn: string }; answer: PromptEntity; refuses: { 'not-found': {} } }
}

// ── github ─────────────────────────────────────────────────────────
export type IncomingGitHubEvents =
  /** Forgets the token. It stays valid at GitHub until the user revokes it there, which Settings says */
  | { type: 'github.SIGN_OUT' }
  /** The app's stored secrets changed (no values): the sign-in held is read again on its next use */
  | { type: 'SECRETS_CHANGED' }

export type OutgoingGitHubEvents =
  /** News for every window: the account the app is signed in as changed, or it signed out (`null`) */
  | { type: 'github.ACCOUNT_CHANGED'; account: GitHubAccount | null }

/** What a window asks of the GitHub sign-in, answered by the github child (`features/github.ts`) */
export type GitHubAsks = {
  /** Who the app is signed in to GitHub as, from what it holds: GitHub is not asked */
  'github.GET_ACCOUNT': { answer: GitHubAccount | null }
  /**
   * Signs in. As it goes it tells whoever asked the code to type at `verificationUri`; it is answered with the
   * account once they approved it there, which every window hears too (`github.ACCOUNT_CHANGED`), or with why it
   * ended without one. Whoever asked ends it by no longer waiting
   */
  'github.SIGN_IN': {
    progress: { userCode: string; verificationUri: string; expiresAt: number }
    answer: GitHubAccount
    refuses: { unconfigured: {}; denied: {}; expired: {}; cancelled: {} }
  }
}

// ── The system's own ─────────────────────────────────────────────────────────────────────────────

export type IncomingCodeEvents =
  | IncomingExplorerEvents
  | IncomingTerminalEvents
  | IncomingGitHubEvents
  | { type: 'SET_BASE_DIRECTORY'; path: string; fromUserNavigation?: boolean; fromPicker?: boolean }
  /** Works in one of them: it becomes the base directory, and the folder the user opened is still what is listed */
  | { type: 'SELECT_REPOSITORY'; path: string }
  /** Settings → Providers: resolve a CLI and store where it was found, in this feature's own settings */
  | { type: 'TEST_CLI_PROVIDER'; provider: string }
  /**
   * Something may have changed on disk that no file event reported: a window gained focus, a terminal command
   * finished, an agent's turn ended. The repository and the open files are read again, and what differs is
   * announced as it would have been.
   */
  /** `by` a window that gained focus; without it, a terminal command or an agent's turn has just ended */
  | { type: 'CHECK_FOR_EXTERNAL_CHANGES'; by?: 'window' }
export type OutgoingCodeEvents =
  | OutgoingExplorerEvents
  | OutgoingCommitEvents
  | OutgoingPullRequestEvents
  | OutgoingTerminalEvents
  | OutgoingGitHubEvents
  /**
   * The code surface's directory moved, for every window, which all show the one directory: each asks again for what
   * it starts from and for what its panels show. News, with no listing on it.
   */
  | { type: 'BASE_DIRECTORY_CHANGED'; baseDirectory: string }
  /** What testing a CLI found, for the Settings view that asked (the host declares its surface takes it) */
  | { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string }

/** What a window asks the code system itself */
export type CodeSystemAsks = {
  /** What a window's code surface starts from: the directory and the settings. Its panels ask for what they show */
  GET_CODE_START: { answer: CodeConnectedData }
  /**
   * The repositories under the folder the user opened: its own, nested ones, submodules and linked worktrees, for
   * the commit panel's picker. `current` is the one the panels show
   */
  'commit.LIST_REPOSITORIES': { answer: { repositories: RepositoryUnder[]; truncated: boolean; current: string | null } }
  /**
   * Moves the code surface to one of the repository's worktrees, answered with the folder it is over now. A path the
   * repository does not list as a worktree is refused, and the folder stays where it is
   */
  'commit.WORKTREE_SWITCH': { args: { path: string }; answer: { path: string } }
}

/**
 * Every ask the code system answers. A child's asks are named for it (`commit.*`), which is the panel that takes
 * their answers; the system answers them all, each child's handlers beside that child's machine
 */
export type CodeAsks = CodeSystemAsks & ExplorerAsks & SearchAsks & CommitAsks & PullRequestAsks & TerminalAsks & ActionsAsks & PromptsAsks & GitHubAsks

export type Contract = {
  context: CodeSystemContext
  incoming: IncomingCodeEvents
  outgoing: OutgoingCodeEvents
  asks: CodeAsks
}
