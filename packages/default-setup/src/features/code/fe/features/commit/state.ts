import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { answersCall, newCall, recordCall, settleCall } from '@apackdev/sdk/events';
import { viewWrites, writeAnswered, writeSent, writing, type ViewWrites } from '@apackdev/sdk/fe';
import { sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { diffTab, diffTabPath } from '../../utils/diff-tabs.ts';
import { withStaged, withUnstaged } from 'apack-git/staging';
import type { BlameLine, ChangedFile, MergePreview, CommitFailure, ConflictKind, LineCount, DiffHunk, DiscardKept, DiscardRestored, GitProgress, OperationMove, RepositoryChange, RepositoryOperation, RewriteAction, SignInHelp, SlowStatus, StartableOperation } from '../../../be/types.ts';
import type { OpenFile } from '../../contract.ts';


// Git types
export interface GitStatusFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' | 'typechange' | 'unmerged'
  staged: boolean
  originalPath?: string // For renames and copies
  score?: number // Rename/copy similarity score (0-100)
  /** For an unmerged file: what each side did to it */
  conflict?: ConflictKind
  /** An untracked folder, listed as one row: git tracks nothing in it. Its path ends with `/` */
  isDirectory?: boolean
  /** The file's name is not text, so git cannot be asked about it by name here */
  nameNotText?: true
}

/** What an open folder row lists: the files in it that git would list, each by its path from the top of the checkout */
export interface OpenFolder {
  files: string[]
  /** Whether the folder holds more files than are listed */
  truncated: boolean
}

export interface GitDiff {
  path: string
  staged: boolean
  originalContent?: string
  modifiedContent?: string
  isImage?: boolean
  /** The pieces of the change that can be staged, or unstaged, one at a time */
  hunks?: DiffHunk[]
  /** A conflicted file's three sides, shown in place of the diff: each `null` where that side has no such file */
  conflict?: { base: string | null; ours: string | null; theirs: string | null }
}

export interface CodeCommitContext {
  gitStatus: GitStatusFile[]
  gitBranch: string
  /** Whether git has a name and an email to commit with */
  hasIdentity: boolean
  /** What a pull would do, when there is something to pull */
  pullPreview: MergePreview | null
  /** A whole status that took longer than its budget, with which of git's speed-ups are off */
  slowStatus: SlowStatus | null
  /** Whether turning them on was asked for and has not answered */
  isSpeedingUpStatus: boolean
  /** What merging a branch in would do, for the branch last asked about */
  mergePreview: { target: string; preview: MergePreview } | null
  gitError: string | null
  isGitLoading: boolean
  selectedGitFile: GitStatusFile | null
  commitMessage: string
  revertDialogFile: GitStatusFile | null
  /**
   * Which of what a discard would remove cannot be brought back, as last asked: kept with the rows it was asked
   * of, so a dialog shows only the answer to its own question
   */
  discardPreview: { paths: string[]; notKept: string[] } | null
  /** The last discard that kept what it removed, which the panel offers to undo until it is dismissed or undone */
  lastDiscard: { id: string; paths: string[]; notKept: string[] } | null
  /** How many lines each changed file adds and removes, by `staged:path` */
  lineCounts: Record<string, LineCount>
  /** The files of the stashes opened in the list, by index, read without applying them: of the stash list as last received */
  stashFiles: Record<number, ChangedFile[]>
  /** The asks for a stash's files still unanswered, by call, each with the index it asked about */
  stashFileAsks: Record<string, number>
  /** Who last changed each line of the file the editor shows blame for, from the top of the folder */
  blame: { path: string; lines: BlameLine[] } | null
  /** The repositories under the folder the user opened, which the picker lists when there is more than one */
  repositories: { path: string; relative: string; kind: 'top' | 'nested' | 'submodule' | 'worktree' }[]
  /** The last write here that Undo takes back, as the repository's journal names it, until it is dismissed */
  lastUndoable: { id: string; summary: string } | null
  /** Why the last write is not taken back without asking: a commit already on a remote branch */
  undoConfirmation: string | null
  /** An amend or a rewrite a remote branch holds commits of, with why, until the user goes on with it or not */
  rewriteConfirmation: { message: string; request: RewriteRequest } | null
  /** The last amend or rewrite asked for, to go on with once the user says to */
  pendingRewrite: RewriteRequest | null
  /** The commit being reworded in the history and its whole message, once read */
  rewording: { hash: string; message: string | null } | null
  /** What undoing a discard left as it was, because it had changed or been made again since */
  discardLeft: string[]
  /** The folder what is held here was read from: the code surface's, as of the last time it started */
  directory: string
  availableBranches: string[]
  /** The repository's tags and the commit each is at */
  tags: { name: string; commit: string }[]
  /** How each local branch stands against what it follows, by name */
  branchStanding: Record<string, { upstream?: string; upstreamGone?: boolean; ahead: number; behind: number }>
  branchInput: string
  isCheckingOutBranch: boolean
  hasUpstream: boolean
  commitsAhead: number
  commitsBehind: number
  /** Whether the repository has more changed files than `gitStatus` lists */
  isStatusTruncated: boolean
  /** Whether the backend's file watches on this repository are open; without them the panel changes only when asked */
  isWatchingRepository: boolean
  /** Whether the watch is open and yet changes keep turning up that it never reported: live updates are not arriving */
  isWatchSilent: boolean
  /** What git is in the middle of in this repository: a merge, a rebase, a cherry-pick or a revert stopped part-way */
  operation: RepositoryOperation | null
  /** Whether git was asked to move that on and has not answered */
  isMovingOperation: boolean
  /** Whether a merge, a rebase or a cherry-pick was begun and has not answered */
  isStartingOperation: boolean
  /** Whether fetching by itself has stopped: what is shown of the remote is as old as the last fetch that worked */
  isFetchSuspended: boolean
  /** What can be done about the sign-in the remote asked for when fetching stopped */
  fetchSignIn: SignInHelp | null
  /** What is known of the failure `gitError` words: the command to run again, and the sign-in a remote asked for */
  gitFailure: Pick<CommitFailure, 'code' | 'during' | 'signIn' | 'trust' | 'ownership' | 'hook'> | null
  /** Whether the backend was told git can sign in now and has not answered */
  isSettingUpSignIn: boolean
  /** Whether git was asked to stage or unstage one piece of a file's change and has not answered */
  isApplyingHunk: boolean
  /**
   * Whether this window shows the code surface. A window that does not asks git nothing when the repository
   * changes: the backend takes no window asking to mean nobody is looking, and puts its own checks off
   */
  isShown: boolean
  /** What changed in the repository while the window did not show it, which it asks about when it next does */
  missedChange: RepositoryChange | null
  /**
   * The pieces staged or unstaged since each diff was last read, by its tab (`diffTabPath`, which names the file and
   * whether the diff is of what is staged): still in that tab's diff, and no longer there to act on
   */
  appliedHunks: Record<string, string[]>
  /** How far along the push, the pull or the checkout under way is, once git has said */
  progress: ({ during: 'push' | 'pull' | 'checkout' } & GitProgress) | null
  /** The untracked folder rows that are open, each with the files it lists, by the folder's path */
  openFolders: Record<string, OpenFolder>
  isPushing: boolean
  isPulling: boolean
  isGeneratingMessage: boolean
  stashList: StashEntry[]
  isStashing: boolean
  worktreeList: WorktreeEntry[]
  isWorktreeLoading: boolean
  commitLog: CommitLogEntry[]
  /** Where the next page of the history goes on from; absent when the page shown ends it */
  logCursor: string | null
  /** The file whose history the log shows, followed across its renames; `null` for the whole history */
  logPath: string | null
  /**
   * The asks in flight for a diff that is already open, by call, each with its tab: the answer to one brings its tab up
   * to date and opens none. An ask made since for the same tab supersedes it, and its answer is dropped
   */
  diffRefreshes: Record<string, { tab: string; superseded?: true }>
  /** The latest ask for the status, while it is unanswered: an answer to an earlier one is of the repository before it */
  statusAsk: string | null
  /** Whether the error shown is the status read's own, which the next status read clears */
  statusFailed: boolean
  /**
   * The asks that hold a busy flag while unanswered, by call, each with what it is busy with: an error clears the
   * flag of the ask it answers and no other. The latest ask of each kind replaces the one before it, so this holds
   * one per kind at most
   */
  busyAsks: Record<string, BusyAsk>
  /**
   * The latest ask for each list the panel shows beside the status, while it is unanswered. An answer to an
   * earlier one is of the repository as it was then, or of the folder that was open before this one
   */
  listAsks: Record<RepositoryList, string | null>
  /** The stage and unstage writes still unanswered. The list shows them done, so no status is shown until they are answered */
  stagingWrites: ViewWrites
}

/** The diffs of this repository's changed files that the window has open */
const openDiffs = (self: unknown): OpenFile[] =>
  ((getParentContext(self)?.openFiles ?? []) as OpenFile[]).filter(file => file.isDiff && file.gitFile && !file.isPrDiff)

/** Two pieces of news as one: every part either says changed, and the files named only if both name theirs */
const bothChanges = (one: RepositoryChange | null, other: RepositoryChange): RepositoryChange => {
  if (!one) return other
  const named = (change: RepositoryChange) => !change.diffs || change.files !== undefined
  const diffs = one.diffs || other.diffs
  return {
    status: one.status || other.status,
    diffs,
    history: one.history || other.history,
    stashes: one.stashes || other.stashes,
    refs: one.refs || other.refs,
    worktrees: one.worktrees || other.worktrees,
    ...(diffs && named(one) && named(other) ? { files: [...new Set([...(one.files ?? []), ...(other.files ?? [])])] } : {}),
  }
}

/** An ask for a diff that is already open: the asks before it for the same tab are superseded, and their answers dropped */
const diffRefresh = (file: { path: string; staged: boolean }) => {
  const call = newCall()
  const tab = diffTabPath(file)
  return {
    record: ({ context }: { context: CodeCommitContext }) => ({
      diffRefreshes: recordCall(
        Object.fromEntries(Object.entries(context.diffRefreshes).map(([asked, ask]) => [asked, ask.tab === tab ? { tab, superseded: true as const } : ask])),
        call,
        { tab },
      ),
    }),
    ask: () => { sendToSystem('code', { type: 'commit.GET_GIT_DIFF', path: file.path, staged: file.staged }, { call }) },
  }
}

/** What an ask that holds a busy flag is busy with */
type BusyAsk =
  | 'push' | 'pull' | 'checkout' | 'stash' | 'worktree' | 'speedUp' | 'signIn' | 'hunk' | 'generate'
  | 'moveOperation' | 'startOperation' | 'blame' | 'reword'

/** The progress shown, unless it is of the command named: that command's progress goes with it */
const progressUnless = (context: CodeCommitContext, during: 'push' | 'pull' | 'checkout') =>
  context.progress?.during === during ? { progress: null } : {}

/** What an ask that failed leaves: its own busy flag cleared, and what it was waiting to show let go of */
const FAILED: Record<BusyAsk, (context: CodeCommitContext) => Partial<CodeCommitContext>> = {
  push: context => ({ isPushing: false, ...progressUnless(context, 'push') }),
  pull: context => ({ isPulling: false, ...progressUnless(context, 'pull') }),
  checkout: context => ({ isCheckingOutBranch: false, ...progressUnless(context, 'checkout') }),
  stash: () => ({ isStashing: false }),
  worktree: () => ({ isWorktreeLoading: false }),
  speedUp: () => ({ isSpeedingUpStatus: false }),
  signIn: () => ({ isSettingUpSignIn: false }),
  hunk: () => ({ isApplyingHunk: false }),
  generate: () => ({ isGeneratingMessage: false }),
  moveOperation: () => ({ isMovingOperation: false }),
  startOperation: () => ({ isStartingOperation: false }),
  blame: () => ({ blame: null }),
  reword: () => ({ rewording: null }),
}

/** What `enqueueActions` hands a body, as far as an ask made from one uses it */
type Enqueue = {
  assign: (values: Partial<CodeCommitContext> | ((args: { context: CodeCommitContext }) => Partial<CodeCommitContext>)) => void
} & ((action: () => void) => void)

/**
 * Sends an ask that holds a busy flag under a call of its own: `busy` is what the panel shows while it is
 * unanswered, and the call is recorded as the latest ask of its kind, whose failure clears it
 */
function askBusy(enqueue: Enqueue, kind: BusyAsk, busy: Partial<CodeCommitContext>, send: (call: string) => void): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({
    ...busy,
    busyAsks: recordCall(Object.fromEntries(Object.entries(context.busyAsks).filter(([, asked]) => asked !== kind)), call, kind),
  }))
  enqueue(() => send(call))
}

/** Failures a status read reports itself, which a status read that succeeds shows are gone */
const STATUS_READ_FAILURES: readonly (CommitFailure['code'])[] = [
  'not-a-repository', 'untrusted', 'unsafe-ownership', 'git-not-found', 'developer-tools-missing', 'git-too-old',
]

/** Whether a status read that succeeds clears the error shown: the status read's own, or a failure of the kind it reports */
const statusReadClears = (context: CodeCommitContext): boolean =>
  context.statusFailed || STATUS_READ_FAILURES.includes(context.gitFailure?.code)

/** Whether two stash lists name the same stashes at the same indexes */
const sameStashes = (one: StashEntry[], other: StashEntry[]) =>
  one.length === other.length && one.every((stash, i) => stash.ref === other[i]!.ref && stash.date === other[i]!.date && stash.message === other[i]!.message)

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

/** A commit as the panel's history draws it: with every parent, and the refs that point at it */
export interface CommitLogEntry {
  hash: string
  parents: string[]
  subject: string
  authorName: string
  authorEmail: string
  date: string
  refs: string[]
}

export type Event =
  | { type: 'commit.REFRESH_STATUS' }
  | { type: 'commit.SELECT_FILE'; file: GitStatusFile }
  | { type: 'commit.STAGE_FILES'; paths: string[] }
  | { type: 'commit.UNSTAGE_FILES'; paths: string[] }
  | { type: 'commit.UPDATE_MESSAGE'; message: string }
  | { type: 'commit.COMMIT' }
  | { type: 'commit.VIEW_DIFF'; path: string; staged: boolean }
  | { type: 'commit.CLEAR_DIFF' }
  | { type: 'commit.REVERT_FILE'; path: string }
  | { type: 'commit.REVERT_FILES'; paths: string[] }
  | { type: 'commit.TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
  | { type: 'commit.OPEN_FILE'; file: GitStatusFile }
  | { type: 'commit.GET_ALL_BRANCHES' }
  | { type: 'commit.UPDATE_BRANCH_INPUT'; input: string }
  | { type: 'commit.CHECKOUT_BRANCH' }
  | { type: 'commit.PUSH_BRANCH' }
  | { type: 'commit.PULL_BRANCH' }
  | { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; counts?: LineCount[]; pullPreview?: MergePreview; hasIdentity?: boolean; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
  | { type: 'commit.DIFF_RECEIVED'; data: GitDiff }
  | { type: 'commit.FILES_STAGED'; paths: string[] }
  | { type: 'commit.FILES_UNSTAGED'; paths: string[] }
  | { type: 'commit.COMMIT_SUCCESS'; message: string }
  | { type: 'commit.FILE_REVERTED'; data: { path: string; kept: DiscardKept } }
  | { type: 'commit.FILES_REVERTED'; data: { paths: string[]; kept: DiscardKept } }
  | { type: 'commit.PREVIEW_DISCARD'; paths: string[] }
  | { type: 'commit.DISCARD_PREVIEWED'; data: { paths: string[]; notKept: string[] } }
  | { type: 'commit.UNDO_DISCARD' }
  /** Opens a stash in the list to show its files, or closes it */
  | { type: 'commit.TOGGLE_STASH_FILES'; index: number }
  | { type: 'commit.STASH_CHANGES_RECEIVED'; data: { index: number; files: ChangedFile[] } }
  /** Shows who last changed each line of a file in the editor, or stops */
  | { type: 'commit.SHOW_BLAME'; path: string }
  | { type: 'commit.CLEAR_BLAME' }
  | { type: 'commit.BLAME_RECEIVED'; data: { path: string; lines: BlameLine[] } }
  | { type: 'commit.REPOSITORIES_RECEIVED'; data: { repositories: CodeCommitContext['repositories']; truncated: boolean; current: string | null } }
  /** The picker chose another repository under the folder the user opened */
  | { type: 'commit.SELECT_REPOSITORY'; path: string }
  /** Undo the last write; `evenIfPublished` once the user said to for a commit already pushed */
  | { type: 'commit.UNDO_LAST'; evenIfPublished?: boolean }
  | { type: 'commit.DISMISS_UNDO' }
  | { type: 'commit.UNDOABLE_RECEIVED'; data: { id: string; summary: string } | null }
  | { type: 'commit.UNDONE'; data: { id: string; summary: string } }
  | { type: 'commit.UNDO_NEEDS_CONFIRMATION'; data: { message: string } }
  | { type: 'commit.DISMISS_DISCARD' }
  | { type: 'commit.DISCARD_RESTORED'; data: { id: string } & DiscardRestored }
  | { type: 'commit.TRUST_REPOSITORY' }
  | { type: 'commit.REPOSITORY_TRUSTED'; data: { repository: string } }
  | { type: 'commit.TRUST_OWNERSHIP' }
  | { type: 'commit.OWNERSHIP_TRUSTED'; data: { directory: string } }
  | { type: 'commit.ERROR_RECEIVED'; data: CommitFailure }
  | { type: 'commit.SET_UP_SIGN_IN'; host: string }
  | { type: 'commit.APPLY_HUNK'; path: string; staged: boolean; hunk: string }
  | { type: 'commit.HUNK_APPLIED'; data: { path: string; staged: boolean; hunk: string } }
  | { type: 'commit.PROGRESS'; data: { during: 'push' | 'pull' | 'checkout' } & GitProgress }
  | { type: 'commit.TOGGLE_FOLDER'; path: string }
  | { type: 'commit.UNTRACKED_LISTED'; data: { path: string } & OpenFolder }
  | { type: 'commit.SIGN_IN_SET_UP'; data: { host: string; during?: 'push' | 'pull' } }
  | { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[]; standing?: CodeCommitContext['branchStanding']; tags?: { name: string; commit: string }[] } }
  | { type: 'commit.CREATE_TAG'; name: string; commit?: string; message?: string }
  | { type: 'commit.DELETE_TAG'; name: string }
  | { type: 'commit.PUSH_TAG'; name: string }
  | { type: 'commit.RENAME_BRANCH'; name: string; to: string }
  | { type: 'commit.SPEED_UP_STATUS' }
  | { type: 'commit.STATUS_SPED_UP'; data: { fileMonitor: boolean; untrackedCache: boolean } }
  | { type: 'commit.TAG_CREATED'; data: { name: string } }
  | { type: 'commit.TAG_DELETED'; data: { name: string } }
  | { type: 'commit.TAG_PUSHED'; data: { name: string } }
  | { type: 'commit.BRANCH_RENAMED'; data: { name: string; to: string } }
  | { type: 'commit.BRANCH_CHECKOUT_SUCCESS'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PUSHED'; data: { branchName: string } }
  | { type: 'commit.STOP_PUSH' }
  | { type: 'commit.PUSH_STOPPED' }
  | { type: 'commit.BRANCH_PULLED'; data: { branchName: string } }
  | { type: 'commit.DISMISS_ERROR' }
  | { type: 'commit.GENERATE_MESSAGE' }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  | { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean; paths?: string[] }
  | { type: 'commit.STASH_LIST' }
  | { type: 'commit.STASH_APPLY'; index: number }
  | { type: 'commit.STASH_POP'; index: number }
  | { type: 'commit.STASH_DROP'; index: number }
  | { type: 'commit.STASH_CLEAR' }
  | { type: 'commit.STASH_LIST_RECEIVED'; data: { stashes: StashEntry[] } }
  | { type: 'commit.STASH_SUCCESS'; data: { message: string } }
  | { type: 'commit.WORKTREE_LIST' }
  | { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'commit.WORKTREE_SWITCH'; path: string }
  /** The switch was made: the code surface is over the worktree now */
  | { type: 'commit.WORKTREE_SWITCHED'; data: { path: string } }
  | { type: 'commit.WORKTREE_LIST_RECEIVED'; data: { worktrees: WorktreeEntry[] } }
  | { type: 'commit.WORKTREE_ADDED'; data: { path: string; branch: string } }
  | { type: 'commit.WORKTREE_REMOVED'; data: { path: string } }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.CONFLICT_RESOLVED'; path: string }
  | { type: 'commit.ALL_CONFLICTS_RESOLVED' }
  | { type: 'commit.MOVE_OPERATION'; move: OperationMove }
  | { type: 'commit.OPERATION_MOVED'; data: { move: OperationMove } }
  | { type: 'commit.START_OPERATION'; kind: StartableOperation; target: string }
  | RewriteRequest
  | { type: 'commit.AMENDED' }
  | { type: 'commit.START_REWORD'; hash: string }
  | { type: 'commit.CANCEL_REWORD' }
  | { type: 'commit.COMMIT_MESSAGE_RECEIVED'; data: { hash: string; message: string } }
  | { type: 'commit.COMMIT_REWRITTEN'; data: { hash: string; action: RewriteAction } }
  | { type: 'commit.REWRITE_NEEDS_CONFIRMATION'; data: { message: string } }
  | { type: 'commit.CONFIRM_REWRITE' }
  | { type: 'commit.DISMISS_REWRITE' }
  | { type: 'commit.OPERATION_STARTED'; data: { kind: StartableOperation; target: string; stopped: boolean } }
  | { type: 'commit.PREVIEW_MERGE'; target: string }
  | { type: 'commit.MERGE_PREVIEWED'; data: { target: string; preview: MergePreview } }
  | { type: 'commit.LOG_LIST'; cursor?: string; path?: string }
  | { type: 'commit.LOG_LIST_RECEIVED'; data: { commits: CommitLogEntry[]; cursor?: string; path?: string; continued?: boolean } }
  /** The next page of the history the log shows */
  | { type: 'commit.LOAD_MORE_LOG' }
  /** A file's history in the log, followed across its renames, until it is cleared */
  | { type: 'commit.SHOW_FILE_HISTORY'; path: string }
  | { type: 'commit.CLEAR_FILE_HISTORY' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'commit.REVERT_COMMIT_SUCCESS'; data: { hash: string } }
  | { type: 'commit.RESET_COMMIT_SUCCESS'; data: { hash: string } }
  | { type: 'CODE_STARTED' }
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
  | { type: 'commit.SHOWN' }
  | { type: 'commit.HIDDEN' };

/** An amend of the last commit or a rewrite of one in the history, as the panel asks the backend for it */
type RewriteRequest =
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }

/** Asks the backend for an amend or a rewrite, as each one's own event */
function sendRewrite(request: RewriteRequest): void {
  if (request.type === 'commit.AMEND') sendToSystem('code', request)
  else sendToSystem('code', request)
}

/** The fields of the panel's state that are read from a repository, or wait on an answer from one */
type OfOneFolder =
  | 'gitStatus'
  | 'isGitLoading'
  | 'isCheckingOutBranch'
  | 'isPushing'
  | 'isPulling'
  | 'isStashing'
  | 'isWorktreeLoading'
  | 'isMovingOperation'
  | 'isStartingOperation'
  | 'isSettingUpSignIn'
  | 'isApplyingHunk'
  | 'progress'
  | 'stagingWrites'
  | 'busyAsks'
  | 'statusAsk'
  | 'statusFailed'
  | 'listAsks'
  | 'stashFileAsks'
  | 'gitBranch'
  | 'hasIdentity'
  | 'pullPreview'
  | 'slowStatus'
  | 'isSpeedingUpStatus'
  | 'mergePreview'
  | 'gitError'
  | 'selectedGitFile'
  | 'revertDialogFile'
  | 'discardPreview'
  | 'lastDiscard'
  | 'lineCounts'
  | 'stashFiles'
  | 'blame'
  | 'repositories'
  | 'lastUndoable'
  | 'undoConfirmation'
  | 'rewriteConfirmation'
  | 'pendingRewrite'
  | 'rewording'
  | 'discardLeft'
  | 'availableBranches'
  | 'tags'
  | 'branchStanding'
  | 'branchInput'
  | 'hasUpstream'
  | 'commitsAhead'
  | 'commitsBehind'
  | 'isStatusTruncated'
  | 'operation'
  | 'isFetchSuspended'
  | 'fetchSignIn'
  | 'gitFailure'
  | 'appliedHunks'
  | 'missedChange'
  | 'openFolders'
  | 'stashList'
  | 'worktreeList'
  | 'commitLog'
  | 'logCursor'
  | 'logPath'

/**
 * What the panel holds of a repository, as it is before any has been read: its rows, its branch and whether that
 * has an upstream, its commits, stashes and worktrees, what git last refused, and what a discard offers to undo.
 * The panel starts with this, and goes back to it when the code surface starts over another folder. A
 * repository git is not run in, because it is not trusted, reads nothing, and would otherwise sit under the
 * branch and the commits of the folder open before it.
 *
 * What it waits on goes with it: the asks made of the folder before, the writes the list shows done, and the
 * busy flags they hold, so an answer from that folder is taken for none and nothing stays busy. The open diffs'
 * refreshes are not among them: they belong to tabs, and their answers only ever bring a tab up to date.
 */
const ofNoFolder = (): Pick<CodeCommitContext, OfOneFolder> => ({
  gitStatus: [],
  isGitLoading: false,
  isCheckingOutBranch: false,
  isPushing: false,
  isPulling: false,
  isStashing: false,
  isWorktreeLoading: false,
  isMovingOperation: false,
  isStartingOperation: false,
  isSettingUpSignIn: false,
  isApplyingHunk: false,
  progress: null,
  stagingWrites: viewWrites(),
  busyAsks: {},
  statusAsk: null,
  statusFailed: false,
  listAsks: { branches: null, stashes: null, worktrees: null, log: null },
  stashFileAsks: {},
  gitBranch: '',
  hasIdentity: true,
  pullPreview: null,
  slowStatus: null,
  isSpeedingUpStatus: false,
  mergePreview: null,
  gitError: null,
  selectedGitFile: null,
  revertDialogFile: null,
  discardPreview: null,
  lastDiscard: null,
  lineCounts: {},
  stashFiles: {},
  blame: null,
  repositories: [],
  lastUndoable: null,
  undoConfirmation: null,
  rewriteConfirmation: null,
  pendingRewrite: null,
  rewording: null,
  discardLeft: [],
  availableBranches: [],
  tags: [],
  branchStanding: {},
  branchInput: '',
  hasUpstream: true,
  commitsAhead: 0,
  commitsBehind: 0,
  isStatusTruncated: false,
  operation: null,
  isFetchSuspended: false,
  fetchSignIn: null,
  gitFailure: null,
  appliedHunks: {},
  missedChange: null,
  openFolders: {},
  stashList: [],
  worktreeList: [],
  commitLog: [],
  logCursor: null,
  logPath: null,
})

/** The lists the panel shows beside the status, each asked for by an event of its own, sent under a call */
const LIST_ASKS = {
  branches: (call: string) => { sendToSystem('code', { type: 'commit.GET_ALL_BRANCHES' }, { call }) },
  stashes: (call: string) => { sendToSystem('code', { type: 'commit.STASH_LIST' }, { call }) },
  worktrees: (call: string) => { sendToSystem('code', { type: 'commit.WORKTREE_LIST' }, { call }) },
}
/** Those lists and the log, which is asked for a page at a time (`askLogPage`) */
type RepositoryList = keyof typeof LIST_ASKS | 'log'

/**
 * Asks for a page of the log as the ask of the log, so its answer is the one the log takes. A page of a file's
 * history names the file, which the log takes it by
 */
function askLogPage(enqueue: Enqueue, ask: { cursor?: string; path?: string | null }): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({ listAsks: { ...context.listAsks, log: call } }))
  enqueue(() => sendToSystem('code', { type: 'commit.LOG_LIST', ...(ask.cursor && { cursor: ask.cursor }), ...(ask.path && { path: ask.path }) }, { call }))
}

/**
 * An ask for each of these lists under a call of its own: what to hold as the latest ask of each, and the sends.
 * Only the answer to the latest ask of a list is shown. An answer to an earlier one is dropped: the folder may
 * have changed since it was asked, and the backend answers every ask.
 */
function listAsks(lists: readonly (keyof typeof LIST_ASKS)[]) {
  const calls = lists.map((list) => [list, newCall()] as const)
  return {
    asks: Object.fromEntries(calls) as Partial<Record<RepositoryList, string>>,
    send: () => { for (const [list, call] of calls) LIST_ASKS[list](call) },
  }
}

export const commitState = setup({
  types: {
    context: {} as CodeCommitContext,
    events: {} as Event
  },
  guards: {
    answersADiffRefresh: ({ context, event }) => settleCall(context.diffRefreshes, event).recorded !== undefined,
    answersTheStatusAsked: ({ context, event }) => answersCall(event, context.statusAsk),
    answersTheBranchesAsked: ({ context, event }) => answersCall(event, context.listAsks.branches),
    answersTheStashesAsked: ({ context, event }) => answersCall(event, context.listAsks.stashes),
    answersTheWorktreesAsked: ({ context, event }) => answersCall(event, context.listAsks.worktrees),
    answersTheLogAsked: ({ context, event }) => answersCall(event, context.listAsks.log),
  },
  actions: {
    refreshGitStatus: enqueueActions(({ enqueue }) => {
      const call = newCall()
      enqueue.assign({ statusAsk: call })
      enqueue(() => { sendToSystem('code', { type: 'commit.GET_GIT_STATUS' }, { call }) })
    }),

    forgetDiffRefresh: assign(({ context, event }) => ({ diffRefreshes: settleCall(context.diffRefreshes, event).pending })),

    /**
     * Asks again for each thing the window shows whose part of the repository changed, and for no other: the news
     * says which, so an edited file reads the status and leaves the log, the stashes and the worktrees alone
     */
    followRepositoryChange: enqueueActions(({ context, event, self, enqueue }) => {
      const { changed } = event as { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
      // Not shown, nothing is asked: what changed is kept, and asked about when the window shows the surface
      if (!context.isShown) {
        enqueue.assign({ missedChange: bothChanges(context.missedChange, changed) })
        return
      }
      if (changed.status) enqueue('refreshGitStatus')
      // The log names the branches at each commit, a remote's among them, which a fetch moves without any history
      if (changed.history || changed.refs) enqueue('requestLogList')
      if (changed.stashes) enqueue('requestStashList')
      if (changed.worktrees) enqueue('requestWorktreeList')
      if (!changed.diffs) return
      // A change under an open folder's row moves no status: the folder is named, and is listed again. A status
      // that changed is asked for above, and lists the open folders again when it is answered
      if (!changed.status) {
        for (const path of Object.keys(context.openFolders)) {
          if (!changed.files || changed.files.includes(path)) enqueue(() => { sendToSystem('code', { type: 'commit.LIST_UNTRACKED', path }) })
        }
      }
      // A diff is read when its tab opens, so one left open is of the file as it was until it is read again
      for (const { gitFile } of openDiffs(self)) {
        // A file inside a folder git lists as one row is named by that folder, which is all git says of it
        if (changed.files && !changed.files.some(named => named === gitFile!.path || (named.endsWith('/') && gitFile!.path.startsWith(named)))) continue
        const refresh = diffRefresh(gitFile!)
        enqueue.assign(refresh.record)
        enqueue(refresh.ask)
      }
    }),



    selectGitFile: assign({
      selectedGitFile: ({ event }) => {
        const ev = event as { type: 'commit.SELECT_FILE'; file: GitStatusFile }
        return ev.file
      }
    }),

    /**
     * A staged file moves in the list at once, to where git will list it, and git is told. What git answers
     * replaces the guess. A status read before the write landed would put the file back, so none is shown until
     * every such write is answered.
     */
    stageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = event as { type: 'commit.STAGE_FILES'; paths: string[] }
      const call = newCall()
      enqueue.assign(({ context }) => ({ gitStatus: withStaged(context.gitStatus, paths), stagingWrites: writeSent(context.stagingWrites, call) }))
      enqueue(() => { sendToSystem('code', { type: 'commit.STAGE_FILES', paths }, { call }) })
    }),

    unstageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = event as { type: 'commit.UNSTAGE_FILES'; paths: string[] }
      const call = newCall()
      enqueue.assign(({ context }) => ({ gitStatus: withUnstaged(context.gitStatus, paths), stagingWrites: writeSent(context.stagingWrites, call) }))
      enqueue(() => { sendToSystem('code', { type: 'commit.UNSTAGE_FILES', paths }, { call }) })
    }),

    /** A stage or an unstage was answered: once none is left unanswered, the list is read from git */
    settleStaging: enqueueActions(({ context, event, enqueue }) => {
      const writes = writeAnswered(context.stagingWrites, event)
      enqueue.assign({ stagingWrites: writes })
      if (!writing(writes)) enqueue('refreshGitStatus')
    }),

    /** A stage or an unstage was refused: reading the list from git puts the file back where it is */
    settleRefusedStaging: enqueueActions(({ context, event, enqueue }) => {
      const writes = writeAnswered(context.stagingWrites, event, true)
      // An error that answers none of these writes is some other ask's
      if (writes === context.stagingWrites) return
      enqueue.assign({ stagingWrites: writes })
      if (!writing(writes)) enqueue('refreshGitStatus')
    }),


    viewDiff: enqueueActions(({ event, self, enqueue }) => {
      const ev = event as { type: 'commit.VIEW_DIFF'; path: string; staged: boolean }
      const tabPath = diffTabPath(ev)
      if (!openDiffs(self).some(file => file.path === tabPath)) {
        enqueue(() => { sendToSystem('code', { type: 'commit.GET_GIT_DIFF', path: ev.path, staged: ev.staged }) })
        return
      }
      // Already open: it is shown at once as it stands, with whatever was typed into it, and read again behind that
      const refresh = diffRefresh(ev)
      enqueue(() => updateParentState(self, { activeFilePath: tabPath }))
      enqueue.assign(refresh.record)
      enqueue(refresh.ask)
    }),

    updateCommitMessage: assign({
      commitMessage: ({ event }) => {
        const ev = event as { type: 'commit.UPDATE_MESSAGE'; message: string }
        return ev.message
      }
    }),

    commit: ({ context }) => {
      const message = context.commitMessage.replace(/\n*Co-Authored-By:.*$/gim, '').trim()
      if (message) {
        sendToSystem('code', { type: 'commit.COMMIT', message })
      }
    },

    handleCommitSuccess: assign({
      commitMessage: '',
      selectedGitFile: null,
    }),

    toggleRevertDialog: enqueueActions(({ event, enqueue }) => {
      const { file } = event as { type: 'commit.TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
      enqueue.assign({ revertDialogFile: file || null })
      // What of it cannot be brought back is asked for as the dialog opens, and said in it
      if (file) enqueue(() => { sendToSystem('code', { type: 'commit.PREVIEW_DISCARD', paths: [file.path] }) })
    }),

    previewDiscard: ({ event }) => {
      const { paths } = event as { type: 'commit.PREVIEW_DISCARD'; paths: string[] }
      sendToSystem('code', { type: 'commit.PREVIEW_DISCARD', paths })
    },

    setDiscardPreview: assign({
      discardPreview: ({ event }) => (event as { type: 'commit.DISCARD_PREVIEWED'; data: { paths: string[]; notKept: string[] } }).data,
    }),

    /** A discard that kept something is offered to be undone; one that kept nothing leaves the last offer as it was */
    setLastDiscard: assign(({ context, event }) => {
      const { data } = event as { type: 'commit.FILE_REVERTED'; data: { path: string; kept: DiscardKept } } | { type: 'commit.FILES_REVERTED'; data: { paths: string[]; kept: DiscardKept } }
      const paths = 'paths' in data ? data.paths : [data.path]
      return {
        lastDiscard: data.kept.id ? { id: data.kept.id, paths, notKept: data.kept.notKept } : context.lastDiscard,
        discardLeft: [],
        discardPreview: null,
      }
    }),

    undoDiscard: ({ context }) => {
      if (context.lastDiscard) sendToSystem('code', { type: 'commit.RESTORE_DISCARDED', id: context.lastDiscard.id })
    },

    dismissDiscard: assign({ lastDiscard: null, discardLeft: [] }),

    undoLast: enqueueActions(({ enqueue, event }) => {
      const { evenIfPublished } = event as { type: 'commit.UNDO_LAST'; evenIfPublished?: boolean }
      enqueue.assign({ undoConfirmation: null })
      enqueue(() => sendToSystem('code', { type: 'commit.UNDO_LAST', ...(evenIfPublished && { evenIfPublished }) }))
    }),

    /** Undone: the offer goes, and what was left alone is said until it is dismissed */
    handleDiscardRestored: assign(({ context, event }) => {
      const { id, left } = (event as { type: 'commit.DISCARD_RESTORED'; data: { id: string } & DiscardRestored }).data
      return context.lastDiscard?.id === id ? { lastDiscard: null, discardLeft: left } : {}
    }),

    revertFile: ({ context }) => {
      if (context.revertDialogFile) {
        sendToSystem('code', { type: 'commit.REVERT_FILE', path: context.revertDialogFile.path })
      }
    },

    revertFiles: ({ event }) => {
      const ev = event as { type: 'commit.REVERT_FILES'; paths: string[] }
      sendToSystem('code', { type: 'commit.REVERT_FILES', paths: ev.paths })
    },

    resolveConflict: ({ event }) => {
      const ev = event as { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
      sendToSystem('code', { type: 'commit.RESOLVE_CONFLICT', path: ev.path, strategy: ev.strategy })
    },

    markResolved: ({ event }) => {
      const ev = event as { type: 'commit.MARK_RESOLVED'; path: string }
      sendToSystem('code', { type: 'commit.MARK_RESOLVED', path: ev.path })
    },

    resolveAllConflicts: ({ event }) => {
      const ev = event as { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
      sendToSystem('code', { type: 'commit.RESOLVE_ALL_CONFLICTS', strategy: ev.strategy })
    },

    handleFileReverted: assign({
      revertDialogFile: null
    }),

    setGitLoading: assign({ isGitLoading: true }),

    clearGitDiff: assign({
      selectedGitFile: null,
    }),

    openFile: ({ event, self }) => {
      const ev = event as { type: 'commit.OPEN_FILE'; file: GitStatusFile }
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''

      // For deleted files, show a deleted file view instead of trying to open
      if (ev.file.status === 'deleted') {
        const deletedTab = {
          path: `deleted:${ev.file.path}`,
          content: '',
          modified: false,
          isDeleted: true,
          deletedFilePath: ev.file.path,
        }
        addTabToParent(self, deletedTab)
        return
      }

      // Git paths are relative to the repository root
      // We need to construct the absolute path correctly
      let fullPath: string
      if (ev.file.path.startsWith('/')) {
        fullPath = ev.file.path
      } else {
        fullPath = baseDirectory.endsWith('/')
          ? baseDirectory + ev.file.path
          : baseDirectory + '/' + ev.file.path
      }

      // Send events to parent to switch to explorer panel and open file
      updateParentState(self, { selectedPanel: 'explorer' })

      sendEventToParent(self, {
        type: 'explorer.OPEN_FILE',
        path: fullPath
      })
    },

    handleStatusReceived: assign({
      statusAsk: null,
      // Each file's count as git gives it, by whether it is staged and its path; none past what the status counts
      lineCounts: ({ event }) => Object.fromEntries(((event as { type: 'commit.STATUS_RECEIVED'; data: { counts?: LineCount[] } }).data.counts ?? [])
        .map(count => [`${count.staged}:${count.path}`, count])),
      gitStatus: ({ context, event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        // Read before a write that the list already shows landed: git is asked again once that write is answered
        return writing(context.stagingWrites) ? context.gitStatus : ev.data.files
      },
      hasIdentity: ({ event }) => (event as { type: 'commit.STATUS_RECEIVED'; data: { hasIdentity?: boolean } }).data.hasIdentity ?? true,
      pullPreview: ({ event }) => (event as { type: 'commit.STATUS_RECEIVED'; data: { pullPreview?: MergePreview } }).data.pullPreview ?? null,
      slowStatus: ({ event }) => (event as { type: 'commit.STATUS_RECEIVED'; data: { slowStatus?: SlowStatus } }).data.slowStatus ?? null,
      gitBranch: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.branch
      },
      hasUpstream: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.hasUpstream
      },
      commitsAhead: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.commitsAhead
      },
      commitsBehind: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.commitsBehind
      },
      isStatusTruncated: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.truncated
      },
      isWatchingRepository: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
        return ev.data.watching
      },
      operation: ({ event }) => (event as { data: { operation?: RepositoryOperation } }).data.operation ?? null,
      isFetchSuspended: ({ event }) => (event as { data: { fetchSuspended?: boolean } }).data.fetchSuspended === true,
      isWatchSilent: ({ event }) => (event as { data: { watchSilent?: boolean } }).data.watchSilent === true,
      fetchSignIn: ({ event }) => (event as { data: { signIn?: SignInHelp } }).data.signIn ?? null,
      isGitLoading: false,
      // A write's failure stays until it is dismissed: only what a status read reports is gone once one succeeds
      gitError: ({ context }) => statusReadClears(context) ? null : context.gitError,
      gitFailure: ({ context }) => statusReadClears(context) ? null : context.gitFailure,
      statusFailed: false,
    }),

    /**
     * Shows what failed, whichever ask it answers. Only the ask it answers stops being busy: a failed blame says
     * nothing about a push still running, and an error answering no ask held here clears nothing
     */
    handleErrorReceived: assign(({ context, event }) => {
      const { message, code, during, signIn, trust, ownership, hook } = (event as { type: 'commit.ERROR_RECEIVED'; data: CommitFailure }).data
      const ofStatus = answersCall(event, context.statusAsk)
      const { recorded, pending } = settleCall(context.busyAsks, event)
      return {
        gitError: message,
        gitFailure: { code, during, signIn, trust, ownership, hook },
        statusFailed: ofStatus,
        ...(ofStatus && { statusAsk: null, isGitLoading: false }),
        ...(recorded && { busyAsks: pending, ...FAILED[recorded](context) }),
      }
    }),

    dismissError: assign({ gitError: null, gitFailure: null }),

    /** The user trusts the repository the panel was refused in: said to the backend, which remembers it */
    trustRepository: ({ context }) => {
      const repository = context.gitFailure?.trust?.repository
      if (repository) sendToSystem('code', { type: 'commit.TRUST_REPOSITORY', repository })
    },

    /** The user trusts the repository git refused for who owns it: the backend asks git which path, and adds it */
    trustOwnership: ({ context }) => {
      if (context.gitFailure?.ownership) sendToSystem('code', { type: 'commit.TRUST_OWNERSHIP' })
    },

    /** Trusted: the refusal goes, and the status that was never read is asked for */
    repositoryTrusted: assign({ gitError: null, gitFailure: null }),

    /** Opens an untracked folder's row, asking for what is in it, or closes it */
    toggleFolder: enqueueActions(({ context, event, enqueue }) => {
      const { path } = event as { type: 'commit.TOGGLE_FOLDER'; path: string }
      const { [path]: open, ...others } = context.openFolders
      if (open) return enqueue.assign({ openFolders: others })
      enqueue.assign({ openFolders: { ...others, [path]: { files: [], truncated: false } } })
      enqueue(() => { sendToSystem('code', { type: 'commit.LIST_UNTRACKED', path }) })
    }),

    /** What a folder holds, kept if its row is still open: the answer is the folder's, whichever ask it answers */
    folderListed: assign(({ context, event }) => {
      const { path, files, truncated } = (event as { type: 'commit.UNTRACKED_LISTED'; data: { path: string } & OpenFolder }).data
      return path in context.openFolders ? { openFolders: { ...context.openFolders, [path]: { files, truncated } } } : {}
    }),

    /**
     * Brings the open folders in line with a status just received: one whose row is gone is closed, and the rest
     * are listed again, since a status that moved may be a file made or deleted in one of them
     */
    followOpenFolders: enqueueActions(({ context, enqueue }) => {
      const rows = new Set(context.gitStatus.filter(file => file.isDirectory).map(file => file.path))
      const open = Object.keys(context.openFolders)
      if (open.some(path => !rows.has(path))) {
        enqueue.assign({ openFolders: Object.fromEntries(Object.entries(context.openFolders).filter(([path]) => rows.has(path))) })
      }
      for (const path of open) if (rows.has(path)) enqueue(() => { sendToSystem('code', { type: 'commit.LIST_UNTRACKED', path }) })
    }),

    /** Has git stage one piece of a file's change, or take one back out of what is staged */
    applyHunk: enqueueActions(({ event, enqueue }) => {
      const { path, staged, hunk } = event as { type: 'commit.APPLY_HUNK'; path: string; staged: boolean; hunk: string }
      askBusy(enqueue, 'hunk', { isApplyingHunk: true, gitError: null, gitFailure: null }, call => {
        sendToSystem('code', { type: 'commit.APPLY_HUNK', path, staged, hunk }, { call })
      })
    }),

    /** Tells the backend git can sign in to the host that asked, now the app is signed in to GitHub */
    setUpSignIn: enqueueActions(({ context, event, enqueue }) => {
      const { host } = event as { type: 'commit.SET_UP_SIGN_IN'; host: string }
      // The push or the pull that was refused goes with the ask and comes back with its answer: what is held
      // of it here is cleared by the next status, which can arrive while the sign-in is being set up
      const during = context.gitFailure?.during
      askBusy(enqueue, 'signIn', { isSettingUpSignIn: true }, call => {
        sendToSystem('code', { type: 'commit.SET_UP_SIGN_IN', host, ...(during ? { during } : {}) }, { call })
      })
    }),

    /** Git can sign in now, so the push or the pull that was refused is run again: it is what the user was doing */
    signInSetUp: enqueueActions(({ event, enqueue }) => {
      const { during } = (event as { type: 'commit.SIGN_IN_SET_UP'; data: { during?: 'push' | 'pull' } }).data
      enqueue.assign({ gitError: null, gitFailure: null, isSettingUpSignIn: false })
      if (during === 'push') enqueue.raise({ type: 'commit.PUSH_BRANCH' })
      if (during === 'pull') enqueue.raise({ type: 'commit.PULL_BRANCH' })
    }),

    /** Has git carry on with what it is in the middle of, skip the commit a rebase stopped at, or give it up */
    moveOperation: enqueueActions(({ event, enqueue }) => {
      const { move } = event as { type: 'commit.MOVE_OPERATION'; move: OperationMove }
      askBusy(enqueue, 'moveOperation', { isMovingOperation: true, gitError: null }, call => {
        sendToSystem('code', { type: 'commit.MOVE_OPERATION', move }, { call })
      })
    }),

    // Where that left the repository is in its status, which the backend announces as changed
    handleOperationMoved: assign({ isMovingOperation: false }),

    /** Has git merge a branch in, rebase onto one or pick a commit: one that stops on a conflict shows as in progress */
    startOperation: enqueueActions(({ event, enqueue }) => {
      const { kind, target } = event as { type: 'commit.START_OPERATION'; kind: StartableOperation; target: string }
      askBusy(enqueue, 'startOperation', { isStartingOperation: true, gitError: null }, call => {
        sendToSystem('code', { type: 'commit.START_OPERATION', kind, target }, { call })
      })
    }),

    handleOperationStarted: assign({ isStartingOperation: false }),

    /** Asks for an amend or a rewrite, kept until it is answered so the user can go on with it if a remote holds it */
    requestRewrite: enqueueActions(({ event, enqueue }) => {
      const request = event as RewriteRequest
      enqueue.assign({ pendingRewrite: request, rewriteConfirmation: null, gitError: null })
      enqueue(() => { sendRewrite(request) })
    }),

    confirmRewrite: enqueueActions(({ context, enqueue }) => {
      const request = context.rewriteConfirmation?.request
      enqueue.assign({ rewriteConfirmation: null })
      if (request) enqueue(() => { sendRewrite({ ...request, evenIfPublished: true }) })
    }),

    previewMerge: ({ event }) => {
      const { target } = event as { type: 'commit.PREVIEW_MERGE'; target: string }
      sendToSystem('code', { type: 'commit.PREVIEW_MERGE', target })
    },

    handleMergePreviewed: assign({ mergePreview: ({ event }) => (event as { type: 'commit.MERGE_PREVIEWED'; data: { target: string; preview: MergePreview } }).data }),

    // Busy from when the backend says it has begun
    requestGenerateMessage: enqueueActions(({ enqueue }) => {
      askBusy(enqueue, 'generate', {}, call => { sendToSystem('code', { type: 'commit.GENERATE_MESSAGE' }, { call }) })
    }),

    setGeneratingMessage: assign({ isGeneratingMessage: true }),

    handleMessageGenerated: assign({
      commitMessage: ({ event }) => {
        const ev = event as { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
        return ev.data.message
      },
      isGeneratingMessage: false
    }),


    /**
     * The diff names its own file, so the tab it opens or brings up to date is that file's: `GitDiff` carries
     * `path` and `staged` (`code/be/types.ts`), which is the tab's key, and the file selected now may be another.
     *
     * An answer to an ask made for a diff already open changes that tab where it is, and opens none: its tab may
     * have been closed since, and a diff the user is not looking at does not take the window.
     */
    handleDiffReceived: enqueueActions(({ enqueue, self, event, context }) => {
      const ev = event as { type: 'commit.DIFF_RECEIVED'; data: GitDiff }
      const { recorded, pending } = settleCall(context.diffRefreshes, event)
      // An ask made since for the same tab has the diff as it is now: this one is of the file before it
      if (recorded?.superseded) return enqueue.assign({ diffRefreshes: pending })
      // A diff as it is now holds none of the pieces that were staged out of the one before it, in its own tab
      const tab = diffTabPath(ev.data)
      if (context.appliedHunks[tab]) {
        const { [tab]: _read, ...others } = context.appliedHunks
        enqueue.assign({ appliedHunks: others })
      }
      if (!recorded) {
        enqueue(() => addTabToParent(self, diffTab(ev.data)))
        return
      }
      enqueue.assign({ diffRefreshes: pending })
      enqueue(() => sendEventToParent(self, { type: 'REFRESH_DIFF_TAB', diff: ev.data }))
    }),

    getAllBranches: enqueueActions(({ context, enqueue }) => {
      const { asks, send } = listAsks(['branches'])
      enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
      enqueue(send)
    }),

    updateBranchInput: assign({
      branchInput: ({ event }) => {
        const ev = event as { type: 'commit.UPDATE_BRANCH_INPUT'; input: string }
        return ev.input
      }
    }),

    checkoutBranch: enqueueActions(({ context, enqueue }) => {
      const branchName = context.branchInput.trim()
      if (!branchName) return
      askBusy(enqueue, 'checkout', { isCheckingOutBranch: true }, call => {
        sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName }, { call })
      })
    }),

    createTag: ({ event }) => {
      const { name, commit, message } = event as { type: 'commit.CREATE_TAG'; name: string; commit?: string; message?: string }
      sendToSystem('code', { type: 'commit.CREATE_TAG', name, ...(commit && { commit }), ...(message && { message }) })
    },
    deleteTag: ({ event }) => {
      const { name } = event as { type: 'commit.DELETE_TAG'; name: string }
      sendToSystem('code', { type: 'commit.DELETE_TAG', name })
    },
    pushTag: ({ event }) => {
      const { name } = event as { type: 'commit.PUSH_TAG'; name: string }
      sendToSystem('code', { type: 'commit.PUSH_TAG', name })
    },
    renameBranch: ({ event }) => {
      const { name, to } = event as { type: 'commit.RENAME_BRANCH'; name: string; to: string }
      sendToSystem('code', { type: 'commit.RENAME_BRANCH', name, to })
    },

    handleBranchesReceived: assign({
      tags: ({ event }) => (event as { type: 'commit.BRANCHES_RECEIVED'; data: { tags?: { name: string; commit: string }[] } }).data.tags ?? [],
      branchStanding: ({ event }) => (event as { type: 'commit.BRANCHES_RECEIVED'; data: { standing?: CodeCommitContext['branchStanding'] } }).data.standing ?? {},
      availableBranches: ({ event }) => {
        const ev = event as { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[] } }
        return ev.data.branches
      }
    }),

    handleBranchCheckoutSuccess: assign({
      branchInput: '',
      isCheckingOutBranch: false,
      progress: null
    }),

    pushBranch: enqueueActions(({ enqueue }) => {
      askBusy(enqueue, 'push', { isPushing: true }, call => { sendToSystem('code', { type: 'commit.PUBLISH_BRANCH' }, { call }) })
    }),

    handleBranchPushed: assign({
      isPushing: false,
      progress: null
    }),

    pullBranch: enqueueActions(({ enqueue }) => {
      askBusy(enqueue, 'pull', { isPulling: true }, call => { sendToSystem('code', { type: 'commit.PULL_BRANCH' }, { call }) })
    }),

    handleBranchPulled: assign({
      isPulling: false,
      progress: null
    }),

    handleCodeStartup: enqueueActions(({ context, enqueue, self }) => {
      const directory: string = getParentContext(self)?.baseDirectory || ''
      // What the panel holds is one folder's (`ofNoFolder`), and says nothing about another: it goes when the
      // folder is another one
      const another = directory !== context.directory
      if (another) enqueue.assign({ directory, ...ofNoFolder() })
      if (directory) {
        // Refresh git status when directory is available
        self.send({ type: 'commit.REFRESH_STATUS' })
        // The repositories under the folder the user opened, for the picker
        enqueue(() => sendToSystem('code', { type: 'LIST_REPOSITORIES' }))
        const { asks, send } = listAsks(['stashes', 'worktrees', 'branches'])
        enqueue.assign(({ context }) => ({ listAsks: { ...context.listAsks, ...asks } }))
        enqueue(send)
        askLogPage(enqueue, { path: another ? null : context.logPath })
      }
    }),

    stashPush: enqueueActions(({ event, enqueue }) => {
      const ev = event as { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean; paths?: string[] }
      askBusy(enqueue, 'stash', { isStashing: true }, call => {
        sendToSystem('code', { type: 'commit.STASH_PUSH', message: ev.message, stagedOnly: ev.stagedOnly, ...(ev.paths && { paths: ev.paths }) }, { call })
      })
    }),

    requestStashList: enqueueActions(({ context, enqueue }) => {
      const { asks, send } = listAsks(['stashes'])
      enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
      enqueue(send)
    }),

    /**
     * A stash's files are of the stash at its index when they were read: once the list moves, the stash at that
     * index is another, so the files open and the asks for them go
     */
    handleStashListReceived: assign(({ context, event }) => {
      const { stashes } = (event as { type: 'commit.STASH_LIST_RECEIVED'; data: { stashes: StashEntry[] } }).data
      return sameStashes(context.stashList, stashes) ? { stashList: stashes } : { stashList: stashes, stashFiles: {}, stashFileAsks: {} }
    }),

    handleStashSuccess: assign({
      isStashing: false,
      commitMessage: ''
    }),

    stashApply: ({ event }) => {
      const ev = event as { type: 'commit.STASH_APPLY'; index: number }
      sendToSystem('code', { type: 'commit.STASH_APPLY', index: ev.index })
    },

    stashPop: ({ event }) => {
      const ev = event as { type: 'commit.STASH_POP'; index: number }
      sendToSystem('code', { type: 'commit.STASH_POP', index: ev.index })
    },

    stashDrop: ({ event }) => {
      const ev = event as { type: 'commit.STASH_DROP'; index: number }
      sendToSystem('code', { type: 'commit.STASH_DROP', index: ev.index })
    },

    stashClear: () => {
      sendToSystem('code', { type: 'commit.STASH_CLEAR' })
    },

    requestWorktreeList: enqueueActions(({ context, enqueue }) => {
      const { asks, send } = listAsks(['worktrees'])
      enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
      enqueue(send)
    }),

    handleWorktreeListReceived: assign({
      worktreeList: ({ event }) => {
        const ev = event as { type: 'commit.WORKTREE_LIST_RECEIVED'; data: { worktrees: WorktreeEntry[] } }
        return ev.data.worktrees
      },
      isWorktreeLoading: false
    }),

    worktreeAdd: enqueueActions(({ event, enqueue }) => {
      const ev = event as { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
      askBusy(enqueue, 'worktree', { isWorktreeLoading: true }, call => {
        sendToSystem('code', { type: 'commit.WORKTREE_ADD', path: ev.path, branch: ev.branch, createBranch: ev.createBranch }, { call })
      })
    }),

    worktreeRemove: enqueueActions(({ event, enqueue }) => {
      const ev = event as { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
      askBusy(enqueue, 'worktree', { isWorktreeLoading: true }, call => {
        sendToSystem('code', { type: 'commit.WORKTREE_REMOVE', path: ev.path, force: ev.force }, { call })
      })
    }),

    worktreeSwitch: enqueueActions(({ event, enqueue }) => {
      const ev = event as { type: 'commit.WORKTREE_SWITCH'; path: string }
      askBusy(enqueue, 'worktree', { isWorktreeLoading: true }, call => {
        sendToSystem('code', { type: 'commit.WORKTREE_SWITCH', path: ev.path }, { call })
      })
    }),

    /** The switch this window asked for was made: the list is no longer busy with it */
    handleWorktreeSwitched: assign(({ context, event }) => {
      const { recorded, pending } = settleCall(context.busyAsks, event)
      return recorded === 'worktree' ? { busyAsks: pending, isWorktreeLoading: false } : {}
    }),

    handleWorktreeAdded: assign({ isWorktreeLoading: false }),

    handleWorktreeRemoved: assign({ isWorktreeLoading: false }),

    /** Asks again for the history the log shows: a file's, while it shows one */
    requestLogList: enqueueActions(({ context, enqueue }) => {
      askLogPage(enqueue, { path: context.logPath })
    }),

    /**
     * A page of history: added on to the log when it goes on from a cursor, and in its place otherwise. While the log
     * shows a file's history, a page of another history (one asked again because the repository moved) is not it
     */
    handleLogListReceived: enqueueActions(({ context, event, enqueue }) => {
      const { data } = event as { type: 'commit.LOG_LIST_RECEIVED'; data: { commits: CommitLogEntry[]; cursor?: string; path?: string; continued?: boolean } }
      if ((data.path ?? null) !== context.logPath) return
      enqueue.assign({
        commitLog: data.continued ? [...context.commitLog, ...data.commits] : data.commits,
        logCursor: data.cursor ?? null,
      })
    }),

    revertCommit: ({ event }) => {
      const ev = event as { type: 'commit.REVERT_COMMIT'; hash: string }
      sendToSystem('code', { type: 'commit.REVERT_COMMIT', hash: ev.hash })
    },

    resetToCommit: ({ event }) => {
      const ev = event as { type: 'commit.RESET_TO_COMMIT'; hash: string }
      sendToSystem('code', { type: 'commit.RESET_TO_COMMIT', hash: ev.hash })
    }
  }
}).createMachine({
  id: 'commit',
  initial: 'idle',
  context: {
    diffRefreshes: {},
    commitMessage: '',
    directory: '',
    isWatchingRepository: true,
    isWatchSilent: false,
    isShown: false,
    isGeneratingMessage: false,
    ...ofNoFolder(),
  },
  states: {
    idle: {
      on: {
        'commit.REFRESH_STATUS': {
          actions: ['setGitLoading', 'refreshGitStatus']
        },
        // An answer to an ask made before the latest is of the repository as it was before it
        'commit.STATUS_RECEIVED': {
          guard: 'answersTheStatusAsked',
          actions: ['handleStatusReceived', 'followOpenFolders']
        },
        'commit.PROGRESS': {
          actions: assign({ progress: ({ event }) => (event as { data: { during: 'push' | 'pull' | 'checkout' } & GitProgress }).data })
        },
        'commit.TOGGLE_FOLDER': {
          actions: 'toggleFolder'
        },
        'commit.UNTRACKED_LISTED': {
          actions: 'folderListed'
        },
        'commit.ERROR_RECEIVED': [
          // Nobody asked for a diff that was read again, so its failing is said to nobody: the tab stays as it was
          { guard: 'answersADiffRefresh', actions: 'forgetDiffRefresh' },
          { actions: ['handleErrorReceived', 'settleRefusedStaging'] },
        ],
        'commit.DISMISS_ERROR': {
          actions: 'dismissError'
        },
        'commit.SET_UP_SIGN_IN': {
          actions: 'setUpSignIn'
        },
        'commit.SIGN_IN_SET_UP': {
          actions: 'signInSetUp'
        },
        'commit.APPLY_HUNK': {
          actions: 'applyHunk'
        },
        'commit.HUNK_APPLIED': {
          // The tab still shows the piece until its diff is read again, and git no longer cuts it
          actions: assign(({ context, event }) => {
            const { data } = event as { type: 'commit.HUNK_APPLIED'; data: { path: string; staged: boolean; hunk: string } }
            const tab = diffTabPath(data)
            return { isApplyingHunk: false, appliedHunks: { ...context.appliedHunks, [tab]: [...(context.appliedHunks[tab] ?? []), data.hunk] } }
          })
        },
        'commit.SELECT_FILE': {
          actions: 'selectGitFile'
        },
        'commit.STAGE_FILES': {
          actions: 'stageFiles'
        },
        'commit.UNSTAGE_FILES': {
          actions: 'unstageFiles'
        },
        'commit.FILES_STAGED': {
          actions: 'settleStaging'
        },
        'commit.FILES_UNSTAGED': {
          actions: 'settleStaging'
        },
        'commit.VIEW_DIFF': {
          actions: 'viewDiff'
        },
        'commit.DIFF_RECEIVED': {
          actions: 'handleDiffReceived'
        },
        'commit.UPDATE_MESSAGE': {
          actions: 'updateCommitMessage'
        },
        'commit.COMMIT': {
          actions: 'commit'
        },
        'commit.COMMIT_SUCCESS': {
          actions: ['handleCommitSuccess', 'refreshGitStatus']
        },
        'commit.TOGGLE_REVERT_DIALOG': {
          actions: 'toggleRevertDialog'
        },
        'commit.REVERT_FILE': {
          actions: ['revertFile', 'toggleRevertDialog']
        },
        'commit.REVERT_FILES': {
          actions: 'revertFiles'
        },
        'commit.FILE_REVERTED': {
          actions: ['handleFileReverted', 'setLastDiscard', 'refreshGitStatus']
        },
        'commit.FILES_REVERTED': {
          actions: ['setLastDiscard', 'refreshGitStatus']
        },
        'commit.PREVIEW_DISCARD': {
          actions: 'previewDiscard'
        },
        'commit.DISCARD_PREVIEWED': {
          actions: 'setDiscardPreview'
        },
        'commit.UNDO_LAST': { actions: 'undoLast' },
        'commit.DISMISS_UNDO': { actions: assign({ lastUndoable: null, undoConfirmation: null }) },
        'commit.UNDOABLE_RECEIVED': {
          actions: assign({ lastUndoable: ({ event }) => (event as { type: 'commit.UNDOABLE_RECEIVED'; data: { id: string; summary: string } | null }).data }),
        },
        'commit.UNDONE': { actions: assign({ undoConfirmation: null }) },
        'commit.UNDO_NEEDS_CONFIRMATION': {
          actions: assign({ undoConfirmation: ({ event }) => (event as { type: 'commit.UNDO_NEEDS_CONFIRMATION'; data: { message: string } }).data.message }),
        },
        'commit.REPOSITORIES_RECEIVED': {
          actions: assign({ repositories: ({ event }) => (event as { type: 'commit.REPOSITORIES_RECEIVED'; data: { repositories: CodeCommitContext['repositories'] } }).data.repositories }),
        },
        'commit.SELECT_REPOSITORY': {
          actions: ({ event }) => sendToSystem('code', { type: 'SELECT_REPOSITORY', path: (event as { type: 'commit.SELECT_REPOSITORY'; path: string }).path }),
        },
        'commit.TOGGLE_STASH_FILES': {
          actions: enqueueActions(({ context, enqueue, event }) => {
            const { index } = event as { type: 'commit.TOGGLE_STASH_FILES'; index: number }
            if (context.stashFiles[index]) {
              const { [index]: _closed, ...open } = context.stashFiles
              enqueue.assign({ stashFiles: open })
            } else {
              const call = newCall()
              enqueue.assign({ stashFileAsks: recordCall(context.stashFileAsks, call, index) })
              enqueue(() => sendToSystem('code', { type: 'commit.GET_STASH_CHANGES', index }, { call }))
            }
          }),
        },
        // Only an answer to an ask made of the stash list as it stands: the index of one asked before names another stash now
        'commit.STASH_CHANGES_RECEIVED': {
          actions: assign(({ context, event }) => {
            const { recorded, pending } = settleCall(context.stashFileAsks, event)
            if (recorded === undefined) return {}
            const { files } = (event as { type: 'commit.STASH_CHANGES_RECEIVED'; data: { index: number; files: ChangedFile[] } }).data
            return { stashFileAsks: pending, stashFiles: { ...context.stashFiles, [recorded]: files } }
          }),
        },
        'commit.LOAD_MORE_LOG': {
          actions: enqueueActions(({ context, enqueue }) => {
            if (context.logCursor) askLogPage(enqueue, { cursor: context.logCursor, path: context.logPath })
          }),
        },
        'commit.SHOW_FILE_HISTORY': {
          actions: enqueueActions(({ enqueue, event }) => {
            const { path } = event as { type: 'commit.SHOW_FILE_HISTORY'; path: string }
            enqueue.assign({ logPath: path, commitLog: [], logCursor: null })
            askLogPage(enqueue, { path })
          }),
        },
        'commit.CLEAR_FILE_HISTORY': {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.assign({ logPath: null, commitLog: [], logCursor: null })
            askLogPage(enqueue, {})
          }),
        },
        'commit.SHOW_BLAME': {
          actions: enqueueActions(({ enqueue, event }) => {
            const { path } = event as { type: 'commit.SHOW_BLAME'; path: string }
            askBusy(enqueue, 'blame', { blame: { path, lines: [] } }, call => { sendToSystem('code', { type: 'commit.GET_BLAME', path }, { call }) })
          }),
        },
        'commit.CLEAR_BLAME': { actions: assign({ blame: null }) },
        // Only for the file blame was last asked of: an answer for one since left is no answer
        'commit.BLAME_RECEIVED': {
          guard: ({ context, event }) => context.blame?.path === (event as { type: 'commit.BLAME_RECEIVED'; data: { path: string } }).data.path,
          actions: assign({ blame: ({ event }) => (event as { type: 'commit.BLAME_RECEIVED'; data: { path: string; lines: BlameLine[] } }).data }),
        },
        'commit.UNDO_DISCARD': {
          actions: 'undoDiscard'
        },
        'commit.DISMISS_DISCARD': {
          actions: 'dismissDiscard'
        },
        'commit.DISCARD_RESTORED': {
          actions: ['handleDiscardRestored', 'refreshGitStatus']
        },
        'commit.TRUST_REPOSITORY': {
          actions: 'trustRepository'
        },
        'commit.REPOSITORY_TRUSTED': {
          actions: ['repositoryTrusted', 'refreshGitStatus']
        },
        'commit.TRUST_OWNERSHIP': {
          actions: 'trustOwnership'
        },
        'commit.OWNERSHIP_TRUSTED': {
          actions: ['repositoryTrusted', 'refreshGitStatus']
        },
        'commit.RESOLVE_CONFLICT': {
          actions: 'resolveConflict'
        },
        'commit.MARK_RESOLVED': {
          actions: 'markResolved'
        },
        'commit.RESOLVE_ALL_CONFLICTS': {
          actions: 'resolveAllConflicts'
        },
        'commit.CONFLICT_RESOLVED': {
          actions: 'refreshGitStatus'
        },
        'commit.ALL_CONFLICTS_RESOLVED': {
          actions: 'refreshGitStatus'
        },
        'commit.MOVE_OPERATION': {
          actions: 'moveOperation'
        },
        'commit.OPERATION_MOVED': {
          actions: 'handleOperationMoved'
        },
        'commit.START_OPERATION': {
          actions: 'startOperation'
        },
        'commit.AMEND': { actions: 'requestRewrite' },
        'commit.REWRITE_COMMIT': { actions: 'requestRewrite' },
        'commit.AMENDED': { actions: [assign({ pendingRewrite: null, commitMessage: '' }), 'requestLogList'] },
        'commit.COMMIT_REWRITTEN': { actions: [assign({ pendingRewrite: null, rewording: null }), 'requestLogList'] },
        'commit.REWRITE_NEEDS_CONFIRMATION': {
          actions: assign({
            rewriteConfirmation: ({ context, event }) => context.pendingRewrite
              ? { message: (event as { type: 'commit.REWRITE_NEEDS_CONFIRMATION'; data: { message: string } }).data.message, request: context.pendingRewrite }
              : null,
          }),
        },
        'commit.CONFIRM_REWRITE': { actions: 'confirmRewrite' },
        'commit.START_REWORD': {
          actions: enqueueActions(({ event, enqueue }) => {
            const { hash } = event as { type: 'commit.START_REWORD'; hash: string }
            askBusy(enqueue, 'reword', { rewording: { hash, message: null } }, call => { sendToSystem('code', { type: 'commit.GET_COMMIT_MESSAGE', hash }, { call }) })
          }),
        },
        'commit.CANCEL_REWORD': { actions: assign({ rewording: null }) },
        'commit.COMMIT_MESSAGE_RECEIVED': {
          actions: assign({
            rewording: ({ context, event }) => {
              const { hash, message } = (event as { type: 'commit.COMMIT_MESSAGE_RECEIVED'; data: { hash: string; message: string } }).data
              return context.rewording?.hash === hash ? { hash, message } : context.rewording
            },
          }),
        },
        'commit.DISMISS_REWRITE': { actions: assign({ rewriteConfirmation: null, pendingRewrite: null }) },
        'commit.OPERATION_STARTED': {
          actions: ['handleOperationStarted', 'requestLogList']
        },
        'commit.PREVIEW_MERGE': {
          actions: 'previewMerge'
        },
        'commit.MERGE_PREVIEWED': {
          actions: 'handleMergePreviewed'
        },
        'commit.CLEAR_DIFF': {
          actions: 'clearGitDiff'
        },
        'commit.OPEN_FILE': {
          actions: 'openFile'
        },
        'commit.GET_ALL_BRANCHES': {
          actions: 'getAllBranches'
        },
        'commit.UPDATE_BRANCH_INPUT': {
          actions: 'updateBranchInput'
        },
        'commit.CHECKOUT_BRANCH': {
          actions: 'checkoutBranch'
        },
        'commit.BRANCHES_RECEIVED': {
          guard: 'answersTheBranchesAsked',
          actions: 'handleBranchesReceived'
        },
        'commit.CREATE_TAG': { actions: 'createTag' },
        'commit.DELETE_TAG': { actions: 'deleteTag' },
        'commit.PUSH_TAG': { actions: 'pushTag' },
        'commit.RENAME_BRANCH': { actions: 'renameBranch' },
        'commit.SPEED_UP_STATUS': {
          actions: enqueueActions(({ enqueue }) => {
            askBusy(enqueue, 'speedUp', { isSpeedingUpStatus: true }, call => { sendToSystem('code', { type: 'commit.SPEED_UP_STATUS' }, { call }) })
          }),
        },
        // The status that follows says whether it is still slow
        'commit.STATUS_SPED_UP': { actions: assign({ isSpeedingUpStatus: false, slowStatus: null }) },
        'commit.TAG_CREATED': { actions: ['getAllBranches', 'requestLogList'] },
        'commit.TAG_DELETED': { actions: ['getAllBranches', 'requestLogList'] },
        'commit.BRANCH_RENAMED': { actions: ['getAllBranches', 'requestLogList'] },
        'commit.BRANCH_CHECKOUT_SUCCESS': {
          actions: ['handleBranchCheckoutSuccess', 'getAllBranches']
        },
        'commit.PUSH_BRANCH': {
          actions: 'pushBranch'
        },
        'commit.BRANCH_PUSHED': {
          actions: 'handleBranchPushed'
        },
        // Only while a push runs: the backend has nothing to stop otherwise
        'commit.STOP_PUSH': {
          guard: ({ context }) => context.isPushing,
          actions: () => { sendToSystem('code', { type: 'commit.STOP_PUSH' }) }
        },
        'commit.PUSH_STOPPED': {
          actions: 'handleBranchPushed'
        },
        'commit.PULL_BRANCH': {
          actions: 'pullBranch'
        },
        'commit.BRANCH_PULLED': {
          actions: 'handleBranchPulled'
        },
        'commit.GENERATE_MESSAGE': {
          actions: 'requestGenerateMessage'
        },
        'commit.GENERATING_MESSAGE': {
          actions: 'setGeneratingMessage'
        },
        'commit.MESSAGE_GENERATED': {
          actions: 'handleMessageGenerated'
        },
        'commit.STASH_PUSH': {
          actions: 'stashPush'
        },
        'commit.STASH_LIST': {
          actions: 'requestStashList'
        },
        'commit.STASH_LIST_RECEIVED': {
          guard: 'answersTheStashesAsked',
          actions: 'handleStashListReceived'
        },
        'commit.STASH_SUCCESS': {
          actions: ['handleStashSuccess', 'refreshGitStatus']
        },
        'commit.STASH_APPLY': {
          actions: 'stashApply'
        },
        'commit.STASH_POP': {
          actions: 'stashPop'
        },
        'commit.STASH_DROP': {
          actions: 'stashDrop'
        },
        'commit.STASH_CLEAR': {
          actions: 'stashClear'
        },
        'commit.WORKTREE_LIST': {
          actions: 'requestWorktreeList'
        },
        'commit.WORKTREE_LIST_RECEIVED': {
          guard: 'answersTheWorktreesAsked',
          actions: 'handleWorktreeListReceived'
        },
        'commit.WORKTREE_ADD': {
          actions: 'worktreeAdd'
        },
        'commit.WORKTREE_REMOVE': {
          actions: 'worktreeRemove'
        },
        'commit.WORKTREE_SWITCH': {
          actions: 'worktreeSwitch'
        },
        'commit.WORKTREE_SWITCHED': {
          actions: 'handleWorktreeSwitched'
        },
        'commit.WORKTREE_ADDED': {
          actions: ['handleWorktreeAdded', 'requestWorktreeList']
        },
        'commit.WORKTREE_REMOVED': {
          actions: ['handleWorktreeRemoved', 'requestWorktreeList']
        },
        'commit.LOG_LIST': {
          actions: 'requestLogList'
        },
        'commit.LOG_LIST_RECEIVED': {
          guard: 'answersTheLogAsked',
          actions: 'handleLogListReceived'
        },
        'commit.REVERT_COMMIT': {
          actions: 'revertCommit'
        },
        'commit.RESET_TO_COMMIT': {
          actions: 'resetToCommit'
        },
        'commit.REVERT_COMMIT_SUCCESS': {
          actions: ['refreshGitStatus', 'requestLogList']
        },
        'commit.RESET_COMMIT_SUCCESS': {
          actions: ['refreshGitStatus', 'requestLogList']
        },
        'CODE_STARTED': {
          actions: 'handleCodeStartup'
        },
        // The repository changed, on disk or by a write from any window: ask again for the parts of it that did
        'commit.REPOSITORY_CHANGED': {
          actions: 'followRepositoryChange'
        },
        'commit.SHOWN': {
          actions: enqueueActions(({ context, enqueue }) => {
            const missed = context.missedChange
            enqueue.assign({ isShown: true, missedChange: null })
            if (missed) enqueue.raise({ type: 'commit.REPOSITORY_CHANGED', changed: missed })
          })
        },
        'commit.HIDDEN': {
          actions: assign({ isShown: false })
        }
      }
    }
  }
});

/** The commit child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CommitActor = ActorRefFrom<typeof commitState>;
