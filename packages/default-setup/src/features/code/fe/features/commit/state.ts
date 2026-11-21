import { setup, assign, enqueueActions, raise, type ActorRefFrom } from 'xstate';
import type { ProgressEventOf } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import { freshKey, makes, type MadeEvent, type Making } from '@apackdev/sdk/fe';
import type { CommitStatus, Contract as CodeSystemContract, GitFailure } from '#features/code/be/contract.ts';
import { fromAsk, tell } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { diffTab, diffTabPath } from '../../utils/diff-tabs.ts';
import { withStaged, withUnstaged } from '@apackdev/git/staging';
import type { BlameLine, ChangedFile, MergePreview, CommitFailure, CommitTrailer, ConflictKind, LineCount, DiffHunk, GitProgress, OperationMove, ProgressDuring, RepositoryChange, RepositoryOperation, RewriteAction, SignInHelp, SlowStatus, StartableOperation } from '../../../be/types.ts';
import type { OpenFile } from '../../contract.ts';


/**
 * What the trailers a message ends with are read from: its last paragraph, when it has more than one. A message of
 * one paragraph has none, that being its subject (`trailersIn`), so typing one asks git nothing
 */
export function trailerParagraph(message: string): string | undefined {
  const paragraphs = message.split(/\r?\n\s*\r?\n/).filter(paragraph => paragraph.trim())
  return paragraphs.length > 1 ? paragraphs.at(-1) : undefined
}

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
  /** For a submodule's row, how it differs: on another commit, files it tracks changed, files it does not track */
  submodule?: { commit: boolean; modified: boolean; untracked: boolean }
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
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
  gitStatus: GitStatusFile[]
  gitBranch: string
  /** Whether git has a name and an email to commit with */
  hasIdentity: boolean
  /** What a pull would do, when there is something to pull */
  pullPreview: MergePreview | null
  /** A whole status that took longer than its budget, with which of git's speed-ups are off */
  slowStatus: SlowStatus | null
  /** What merging a branch in would do, for the branch last asked about */
  mergePreview: { target: string; preview: MergePreview } | null
  gitError: string | null
  selectedGitFile: GitStatusFile | null
  commitMessage: string
  /** The trailers git reads at the end of the message, as of the last paragraph it was asked about */
  trailers: CommitTrailer[]
  /** The last paragraph the trailers were last asked for, which an answer for another is not taken for */
  trailersAsked: string | undefined
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
  /** Whether fetching by itself has stopped: what is shown of the remote is as old as the last fetch that worked */
  isFetchSuspended: boolean
  /** What can be done about the sign-in the remote asked for when fetching stopped */
  fetchSignIn: SignInHelp | null
  /** What is known of the failure `gitError` words: the command to run again, and the sign-in a remote asked for */
  gitFailure: Pick<CommitFailure, 'code' | 'during' | 'signIn' | 'trust' | 'ownership' | 'hook' | 'missingBranch'> | null
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
  progress: ({ during: ProgressDuring } & GitProgress) | null
  /** The untracked folder rows that are open, each with the files it lists, by the folder's path */
  openFolders: Record<string, OpenFolder>
  /** Whether the push last run was stopped by the user rather than done, which the panel says instead of "Pushed" */
  pushStopped: boolean
  /** The tag being pushed or deleted, until that is answered */
  tagBusy: { name: string; action: 'push' | 'delete' } | null
  /** The tag last pushed, a new object each time, which the panel says it pushed */
  tagPushed: { name: string } | null
  /** The commit the branch is being reset to, until that is answered */
  resettingTo: string | null
  /** The submodule being brought to the commit the repository records for it, until that is answered */
  updatingSubmodule: string | null
  isGeneratingMessage: boolean
  stashList: StashEntry[]
  /** Whether the stash being pushed was named with the commit message typed, which it then takes */
  stashTakesMessage: boolean
  worktreeList: WorktreeEntry[]
  commitLog: CommitLogEntry[]
  /** Where the next page of the history goes on from; absent when the page shown ends it */
  logCursor: string | null
  /** The file whose history the log shows, followed across its renames; `null` for the whole history */
  logPath: string | null
  /** Whether the error shown is the status read's own, which the next status read clears */
  statusFailed: boolean
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


/** The progress shown, unless it is of the command named: that command's progress goes with it */
const progressUnless = (context: CodeCommitContext, during: ProgressDuring) =>
  context.progress?.during === during ? { progress: null } : {}

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

/**
 * The asks this panel makes of the code system, each under the name the machine makes it by: the commit ones, and
 * the code system's own picker and worktree switch.
 *
 * `one` is an ask of which one is under way at a time, and making it again gives up the one before. `each` is one
 * under way per key: a read by what it reads (a diff by its tab, a folder by its path, a stash by its index), and a
 * write by a key of its own (`freshKey`), so that every one asked for is done.
 */
const made = makes(({ one, each }) => ({
  /** The status read the user asked for, which the panel shows as loading */
  statusShown: one(fromAsk('code', 'commit.GET_GIT_STATUS')),
  /** A status read behind what is shown, which stays as it is until the answer */
  statusBehind: one(fromAsk('code', 'commit.GET_GIT_STATUS')),
  log: one(fromAsk('code', 'commit.LOG_LIST')),
  branches: one(fromAsk('code', 'commit.GET_ALL_BRANCHES')),
  stashes: one(fromAsk('code', 'commit.STASH_LIST')),
  worktrees: one(fromAsk('code', 'commit.WORKTREE_LIST')),
  repositories: one(fromAsk('code', 'commit.LIST_REPOSITORIES')),
  blame: one(fromAsk('code', 'commit.GET_BLAME')),
  /** The whole message of the commit being reworded */
  reword: one(fromAsk('code', 'commit.GET_COMMIT_MESSAGE')),
  trailers: one(fromAsk('code', 'commit.READ_TRAILERS')),
  discardPreview: one(fromAsk('code', 'commit.PREVIEW_DISCARD')),
  mergePreview: one(fromAsk('code', 'commit.PREVIEW_MERGE')),
  push: one(fromAsk('code', 'commit.PUBLISH_BRANCH')),
  pull: one(fromAsk('code', 'commit.PULL_BRANCH')),
  checkout: one(fromAsk('code', 'commit.CHECKOUT_BRANCH')),
  createBranch: one(fromAsk('code', 'commit.CREATE_BRANCH')),
  submodule: one(fromAsk('code', 'commit.UPDATE_SUBMODULE')),
  commit: one(fromAsk('code', 'commit.COMMIT')),
  amend: one(fromAsk('code', 'commit.AMEND')),
  stash: one(fromAsk('code', 'commit.STASH_PUSH')),
  worktreeAdd: one(fromAsk('code', 'commit.WORKTREE_ADD')),
  worktreeRemove: one(fromAsk('code', 'commit.WORKTREE_REMOVE')),
  worktreeSwitch: one(fromAsk('code', 'commit.WORKTREE_SWITCH')),
  speedUp: one(fromAsk('code', 'commit.SPEED_UP_STATUS')),
  signIn: one(fromAsk('code', 'commit.SET_UP_SIGN_IN')),
  hunk: one(fromAsk('code', 'commit.APPLY_HUNK')),
  moveOperation: one(fromAsk('code', 'commit.MOVE_OPERATION')),
  startOperation: one(fromAsk('code', 'commit.START_OPERATION')),
  tagPush: one(fromAsk('code', 'commit.PUSH_TAG')),
  tagDelete: one(fromAsk('code', 'commit.DELETE_TAG')),
  reset: one(fromAsk('code', 'commit.RESET_TO_COMMIT')),

  /** A diff read to open its tab, by the tab (`diffTabPath`) */
  diff: each(fromAsk('code', 'commit.GET_GIT_DIFF')),
  /** A diff read again for a tab that is open, by the tab: its answer brings the tab up to date and opens none */
  diffRefresh: each(fromAsk('code', 'commit.GET_GIT_DIFF')),
  /** What an open folder row holds, by the folder's path */
  untracked: each(fromAsk('code', 'commit.LIST_UNTRACKED')),
  /** The files of a stash opened in the list, by its index */
  stashFiles: each(fromAsk('code', 'commit.GET_STASH_CHANGES')),

  stage: each(fromAsk('code', 'commit.STAGE_FILES')),
  unstage: each(fromAsk('code', 'commit.UNSTAGE_FILES')),
  rewrite: each(fromAsk('code', 'commit.REWRITE_COMMIT')),
  removeTrailer: each(fromAsk('code', 'commit.REMOVE_TRAILER')),
  revertFile: each(fromAsk('code', 'commit.REVERT_FILE')),
  revertFiles: each(fromAsk('code', 'commit.REVERT_FILES')),
  restoreDiscarded: each(fromAsk('code', 'commit.RESTORE_DISCARDED')),
  undoLast: each(fromAsk('code', 'commit.UNDO_LAST')),
  trustRepository: each(fromAsk('code', 'commit.TRUST_REPOSITORY')),
  trustOwnership: each(fromAsk('code', 'commit.TRUST_OWNERSHIP')),
  resolveConflict: each(fromAsk('code', 'commit.RESOLVE_CONFLICT')),
  markResolved: each(fromAsk('code', 'commit.MARK_RESOLVED')),
  resolveAllConflicts: each(fromAsk('code', 'commit.RESOLVE_ALL_CONFLICTS')),
  generateMessage: each(fromAsk('code', 'commit.GENERATE_MESSAGE')),
  renameBranch: each(fromAsk('code', 'commit.RENAME_BRANCH')),
  createTag: each(fromAsk('code', 'commit.CREATE_TAG')),
  stashApply: each(fromAsk('code', 'commit.STASH_APPLY')),
  stashPop: each(fromAsk('code', 'commit.STASH_POP')),
  stashDrop: each(fromAsk('code', 'commit.STASH_DROP')),
  stashClear: each(fromAsk('code', 'commit.STASH_CLEAR')),
  revertCommit: each(fromAsk('code', 'commit.REVERT_COMMIT')),
}))

/** Which of the panel's asks are under way, as its context holds it */
export type CommitMaking = Making<typeof made>

/** The name an ask is made under */
type Name = (typeof made.names)[number]

/** How an ask the machine made ended */
type Made = MadeEvent<typeof made>

/** What the ask made as `N` is answered with */
type AnswerOf<N extends Name> = Extract<Made, { type: `made.${N}` }> extends { outcome: infer Outcome } ? (Outcome extends { ok: true; value: infer Answer } ? Answer : never) : never

/** The asks made of one folder, which go when the folder does. A diff's are of a tab, and go on bringing it up to date */
const OF_ONE_FOLDER = made.names.filter(name => name !== 'diff' && name !== 'diffRefresh')

/** Whether a commit or an amend is under way: another is not asked for until it is answered */
export const commitUnderWay = (making: CommitMaking): boolean => making.commit || making.amend

/** Whether a branch is being checked out or made */
export const checkoutUnderWay = (making: CommitMaking): boolean => making.checkout || making.createBranch

/** A worktree being added or removed, and the code surface being moved to one: one of the three at a time */
const WORKTREE_CHANGES = ['worktreeAdd', 'worktreeRemove', 'worktreeSwitch'] as const

/** Whether a worktree is being added or removed, or the code surface moved to one */
export const worktreeChangeUnderWay = (making: CommitMaking): boolean => WORKTREE_CHANGES.some(name => making[name])

/** Whether a stage or an unstage is still unanswered. The list shows them done, so no status is shown until they are answered */
const stagingUnderWay = (making: CommitMaking): boolean => Object.keys(making.stage).length + Object.keys(making.unstage).length > 0

/** Why an ask was not done, as the panel shows it: git's failure carries what can be done about it, any other only its message */
type Refusal = { message: string } & Partial<GitFailure>

/** What the panel shows of an ask that was not done, whichever ask it was */
const failureShown = ({ message, code, during, signIn, trust, ownership, hook, missingBranch }: Refusal): Pick<CodeCommitContext, 'gitError' | 'gitFailure' | 'statusFailed'> => ({
  gitError: message,
  gitFailure: { code, during, signIn, trust, ownership, hook, missingBranch },
  statusFailed: false,
})

/** What the panel shows of a status just read */
const statusShown = (context: CodeCommitContext, status: CommitStatus): Partial<CodeCommitContext> => ({
  // Each file's count as git gives it, by whether it is staged and its path; none past what the status counts
  lineCounts: Object.fromEntries((status.counts ?? []).map(count => [`${count.staged}:${count.path}`, count])),
  // Read before a write that the list already shows landed: git is asked again once that write is answered
  gitStatus: stagingUnderWay(context.making) ? context.gitStatus : status.files,
  hasIdentity: status.hasIdentity ?? true,
  pullPreview: status.pullPreview ?? null,
  slowStatus: status.slowStatus ?? null,
  gitBranch: status.branch,
  hasUpstream: status.hasUpstream,
  commitsAhead: status.commitsAhead,
  commitsBehind: status.commitsBehind,
  isStatusTruncated: status.truncated,
  isWatchingRepository: status.watching,
  operation: status.operation ?? null,
  isFetchSuspended: status.fetchSuspended === true,
  isWatchSilent: status.watchSilent === true,
  fetchSignIn: status.signIn ?? null,
  // A write's failure stays until it is dismissed: only what a status read reports is gone once one succeeds
  gitError: statusReadClears(context) ? null : context.gitError,
  gitFailure: statusReadClears(context) ? null : context.gitFailure,
  statusFailed: false,
})

/** A diff as it is now holds none of the pieces that were staged out of the one before it, in its own tab */
const withoutAppliedHunks = (context: CodeCommitContext, tab: string): Partial<Pick<CodeCommitContext, 'appliedHunks'>> => {
  if (!context.appliedHunks[tab]) return {}
  const { [tab]: _read, ...others } = context.appliedHunks
  return { appliedHunks: others }
}

/** What Undo would take back after a write just answered, where its answer could say */
const undoableAfter = (context: CodeCommitContext, answer: { undoable?: { id: string; summary: string } | null } | void): Pick<CodeCommitContext, 'lastUndoable'> =>
  ({ lastUndoable: answer && 'undoable' in answer ? answer.undoable ?? null : context.lastUndoable })

export type Event =
  | { type: 'commit.REFRESH_STATUS' }
  /** Reads the status again behind what is shown, as a write or a change in the repository asks for */
  | { type: 'commit.READ_STATUS' }
  | { type: 'commit.SELECT_FILE'; file: GitStatusFile }
  | { type: 'commit.STAGE_FILES'; paths: string[] }
  | { type: 'commit.UNSTAGE_FILES'; paths: string[] }
  | { type: 'commit.UPDATE_MESSAGE'; message: string }
  /** Takes one of the trailers listed under the message out of it */
  | { type: 'commit.REMOVE_TRAILER'; trailer: CommitTrailer }
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
  | { type: 'commit.PREVIEW_DISCARD'; paths: string[] }
  | { type: 'commit.UNDO_DISCARD' }
  /** Opens a stash in the list to show its files, or closes it */
  | { type: 'commit.TOGGLE_STASH_FILES'; index: number }
  /** Shows who last changed each line of a file in the editor, or stops */
  | { type: 'commit.SHOW_BLAME'; path: string }
  | { type: 'commit.UPDATE_SUBMODULE'; path: string }
  | { type: 'commit.CLEAR_BLAME' }
  /** The picker chose another repository under the folder the user opened */
  | { type: 'commit.SELECT_REPOSITORY'; path: string }
  /** Undo the last write; `evenIfPublished` once the user said to for a commit already pushed */
  | { type: 'commit.UNDO_LAST'; evenIfPublished?: boolean }
  | { type: 'commit.DISMISS_UNDO' }
  | { type: 'commit.DISMISS_DISCARD' }
  | { type: 'commit.TRUST_REPOSITORY' }
  | { type: 'commit.TRUST_OWNERSHIP' }
  | { type: 'commit.SET_UP_SIGN_IN'; host: string }
  | { type: 'commit.APPLY_HUNK'; path: string; staged: boolean; hunk: string }
  | { type: 'commit.TOGGLE_FOLDER'; path: string }
  | { type: 'commit.CREATE_TAG'; name: string; commit?: string; message?: string }
  | { type: 'commit.DELETE_TAG'; name: string }
  | { type: 'commit.PUSH_TAG'; name: string }
  | { type: 'commit.RENAME_BRANCH'; name: string; to: string }
  | { type: 'commit.SPEED_UP_STATUS' }
  | { type: 'commit.STOP_PUSH' }
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
  | { type: 'commit.CREATE_BRANCH'; branchName: string }
  | { type: 'commit.WORKTREE_LIST' }
  | { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'commit.WORKTREE_SWITCH'; path: string }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MOVE_OPERATION'; move: OperationMove }
  | { type: 'commit.START_OPERATION'; kind: StartableOperation; target: string }
  | RewriteRequest
  | { type: 'commit.START_REWORD'; hash: string }
  | { type: 'commit.CANCEL_REWORD' }
  | { type: 'commit.CONFIRM_REWRITE' }
  | { type: 'commit.DISMISS_REWRITE' }
  | { type: 'commit.PREVIEW_MERGE'; target: string }
  /** Reads the history the log shows again: a file's, while it shows one */
  | { type: 'commit.LOG_LIST' }
  /** The next page of the history the log shows */
  | { type: 'commit.LOAD_MORE_LOG' }
  /** A file's history in the log, followed across its renames, until it is cleared */
  | { type: 'commit.SHOW_FILE_HISTORY'; path: string }
  | { type: 'commit.CLEAR_FILE_HISTORY' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'CODE_STARTED' }
  /** The flow writing a commit message for this window made none, and says why */
  | { type: 'commit.MESSAGE_NOT_GENERATED'; data: { message: string } }
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
  | { type: 'commit.SHOWN' }
  | { type: 'commit.HIDDEN' }
  // How far along the push, the pull, the checkout or the submodule update asked for is, as its ask says while it runs
  | ProgressEventOf<CodeSystemContract, 'commit.PUBLISH_BRANCH' | 'commit.PULL_BRANCH' | 'commit.CHECKOUT_BRANCH' | 'commit.UPDATE_SUBMODULE'>
  // How each ask ended
  | Made;

const typeOf = safeEvents<Event>();

/** An amend of the last commit or a rewrite of one in the history, as the panel asks the backend for it */
type RewriteRequest =
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }

/** Why an ask was not done, where the event is one that ended that way */
const refusalIn = (event: Event): Refusal | undefined => ('outcome' in event && !event.outcome.ok ? event.outcome.failure : undefined)

/** The answer to the ask made as `name`, off the event of one that was answered: throws for any other event */
function answerTo<N extends Name>(name: N, event: Event): AnswerOf<N> {
  if (event.type !== `made.${name}` || !('outcome' in event) || !event.outcome.ok) throw new Error(`Expected an answer to ${name}, got ${event.type}`)
  return event.outcome.value as AnswerOf<N>
}

/** The fields of the panel's state that are read from a repository, or wait on an answer from one */
type OfOneFolder =
  | 'gitStatus'
  | 'pushStopped'
  | 'tagBusy'
  | 'tagPushed'
  | 'resettingTo'
  | 'updatingSubmodule'
  | 'stashTakesMessage'
  | 'progress'
  | 'statusFailed'
  | 'gitBranch'
  | 'hasIdentity'
  | 'pullPreview'
  | 'slowStatus'
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
 * What it waits on goes with it: the asks made of the folder before are stopped, so an answer from that folder is
 * taken for none and nothing stays busy. The open diffs' refreshes are not among them: they belong to tabs, and
 * their answers only ever bring a tab up to date.
 */
const ofNoFolder = (): Pick<CodeCommitContext, OfOneFolder> => ({
  gitStatus: [],
  pushStopped: false,
  tagBusy: null,
  tagPushed: null,
  resettingTo: null,
  updatingSubmodule: null,
  stashTakesMessage: false,
  progress: null,
  statusFailed: false,
  gitBranch: '',
  hasIdentity: true,
  pullPreview: null,
  slowStatus: null,
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

/** An ask that was not done shows why, in place of what its answer would have done */
const REFUSED = { guard: 'refused', actions: 'showFailure' } as const

/** How an ask's end is taken: one that was not done shows why, and one that was does `answered` */
const ended = <Action extends string>(...answered: Action[]) => [REFUSED, { actions: answered }]

/** How a status read's end is taken: a failure is the status read's own, which the next one that succeeds clears */
const STATUS_ENDED = [
  { guard: 'refused', actions: ['showFailure', 'markStatusFailed'] },
  { actions: ['takeStatus', 'followOpenFolders'] },
] as const

export const commitState = setup({
  types: {
    context: {} as CodeCommitContext,
    events: {} as Event
  },
  actors: made.actors,
  guards: {
    refused: ({ event }) => refusalIn(event) !== undefined,
  },
  actions: {
    showFailure: assign(({ event }) => {
      const refusal = refusalIn(event)
      return refusal ? failureShown(refusal) : {}
    }),

    /** What Undo would take back after the write an ask made, where its answer could say */
    takeUndoable: assign(({ context, event }) => {
      const answer = 'outcome' in event && event.outcome.ok ? event.outcome.value : undefined
      return undoableAfter(context, answer && typeof answer === 'object' && 'undoable' in answer ? { undoable: answer.undoable } : undefined)
    }),

    refreshGitStatus: raise({ type: 'commit.READ_STATUS' }),
    requestLogList: raise({ type: 'commit.LOG_LIST' }),
    requestStashList: raise({ type: 'commit.STASH_LIST' }),
    requestWorktreeList: raise({ type: 'commit.WORKTREE_LIST' }),
    getAllBranches: raise({ type: 'commit.GET_ALL_BRANCHES' }),

    takeStatus: assign(({ context, event }) => {
      const { outcome } = typeOf(['made.statusShown', 'made.statusBehind'], event)
      return outcome.ok ? statusShown(context, outcome.value) : {}
    }),

    markStatusFailed: assign({ statusFailed: true }),

    /** How far along the command under way is, as its ask says */
    hearProgress: assign({ progress: ({ context, event }) => ('update' in event ? event.update : context.progress) }),

    /**
     * Asks again for each thing the window shows whose part of the repository changed, and for no other: the news
     * says which, so an edited file reads the status and leaves the log, the stashes and the worktrees alone
     */
    followRepositoryChange: enqueueActions(({ context, event, self, enqueue }) => {
      const { changed } = typeOf('commit.REPOSITORY_CHANGED', event)
      // Not shown, nothing is asked: what changed is kept, and asked about when the window shows the surface
      if (!context.isShown) {
        enqueue.assign({ missedChange: bothChanges(context.missedChange, changed) })
        return
      }
      if (changed.status) enqueue.raise({ type: 'commit.READ_STATUS' })
      // The log names the branches at each commit, a remote's among them, which a fetch moves without any history
      if (changed.history || changed.refs) enqueue.raise({ type: 'commit.LOG_LIST' })
      if (changed.stashes) enqueue.raise({ type: 'commit.STASH_LIST' })
      if (changed.worktrees) enqueue.raise({ type: 'commit.WORKTREE_LIST' })
      if (!changed.diffs) return
      // A change under an open folder's row moves no status: the folder is named, and is listed again. A status
      // that changed is asked for above, and lists the open folders again when it is answered
      if (!changed.status) {
        for (const path of Object.keys(context.openFolders)) {
          if (!changed.files || changed.files.includes(path)) made.make(enqueue, 'untracked', path, { path })
        }
      }
      // A diff is read when its tab opens, so one left open is of the file as it was until it is read again
      for (const { gitFile } of openDiffs(self)) {
        // A file inside a folder git lists as one row is named by that folder, which is all git says of it
        if (changed.files && !changed.files.some(named => named === gitFile!.path || (named.endsWith('/') && gitFile!.path.startsWith(named)))) continue
        made.make(enqueue, 'diffRefresh', diffTabPath(gitFile!), { path: gitFile!.path, staged: gitFile!.staged })
      }
    }),

    selectGitFile: assign({ selectedGitFile: ({ event }) => typeOf('commit.SELECT_FILE', event).file }),

    /**
     * A staged file moves in the list at once, to where git will list it, and git is told. What git answers
     * replaces the guess. A status read before the write landed would put the file back, so none is shown until
     * every such write is answered.
     */
    stageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.STAGE_FILES', event)
      enqueue.assign(({ context }) => ({ gitStatus: withStaged(context.gitStatus, paths) }))
      made.make(enqueue, 'stage', freshKey(), { paths })
    }),

    unstageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.UNSTAGE_FILES', event)
      enqueue.assign(({ context }) => ({ gitStatus: withUnstaged(context.gitStatus, paths) }))
      made.make(enqueue, 'unstage', freshKey(), { paths })
    }),

    /**
     * A stage or an unstage ended. Once none is left unanswered the list is read from git, which shows the write, or
     * puts the file back where it is when the write was refused
     */
    settleStaging: enqueueActions(({ context, enqueue }) => {
      if (!stagingUnderWay(context.making)) enqueue.raise({ type: 'commit.READ_STATUS' })
    }),

    viewDiff: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('commit.VIEW_DIFF', event)
      const tab = diffTabPath(ev)
      const input = { path: ev.path, staged: ev.staged }
      if (!openDiffs(self).some(file => file.path === tab)) return made.make(enqueue, 'diff', tab, input)
      // Already open: it is shown at once as it stands, with whatever was typed into it, and read again behind that
      enqueue(() => updateParentState(self, { activeFilePath: tab }))
      made.make(enqueue, 'diffRefresh', tab, input)
    }),

    /**
     * The diff names its own file, so the tab it opens is that file's: `GitDiff` carries `path` and `staged`
     * (`code/be/types.ts`), which is the tab's key, and the file selected now may be another
     */
    openDiff: enqueueActions(({ enqueue, self, event, context }) => {
      const refusal = refusalIn(event)
      if (refusal) return enqueue.assign(failureShown(refusal))
      const diff = answerTo('diff', event)
      enqueue.assign(withoutAppliedHunks(context, diffTabPath(diff)))
      enqueue(() => addTabToParent(self, diffTab(diff)))
    }),

    /**
     * A diff read again for a tab already open changes that tab where it is, and opens none: its tab may have been
     * closed since, and a diff the user is not looking at does not take the window. Nobody asked for a diff that was
     * read again, so its failing is said to nobody, and the tab stays as it was
     */
    refreshDiff: enqueueActions(({ enqueue, self, event, context }) => {
      if (refusalIn(event)) return
      const diff = answerTo('diffRefresh', event)
      enqueue.assign(withoutAppliedHunks(context, diffTabPath(diff)))
      enqueue(() => sendEventToParent(self, { type: 'REFRESH_DIFF_TAB', diff }))
    }),

    updateCommitMessage: assign({ commitMessage: ({ event }) => typeOf('commit.UPDATE_MESSAGE', event).message }),

    /**
     * Asks which trailers the message ends with, once its last paragraph is not the one last asked about: a message
     * of one paragraph has none, and is not asked about
     */
    followTrailers: enqueueActions(({ context, enqueue }) => {
      const paragraph = trailerParagraph(context.commitMessage)
      if (paragraph === context.trailersAsked) return
      enqueue.assign({ trailersAsked: paragraph, ...(paragraph === undefined && { trailers: [] }) })
      if (paragraph !== undefined) made.make(enqueue, 'trailers', { message: context.commitMessage })
    }),

    /** The trailers of the message as it is now: an answer about a paragraph since typed over is of another message */
    setTrailers: assign(({ context, event }) => {
      const { message, trailers } = answerTo('trailers', event)
      return trailerParagraph(message) === trailerParagraph(context.commitMessage) ? { trailers } : {}
    }),

    removeTrailer: enqueueActions(({ context, event, enqueue }) => {
      const { trailer } = typeOf('commit.REMOVE_TRAILER', event)
      made.make(enqueue, 'removeTrailer', freshKey(), { message: context.commitMessage, trailer })
    }),

    /** The message without the trailer, taken while the message is still the one it was removed from */
    takeMessageWithoutTrailer: assign(({ context, event }) => {
      const { message, without } = answerTo('removeTrailer', event)
      return message === context.commitMessage ? { commitMessage: without } : {}
    }),

    toggleRevertDialog: enqueueActions(({ event, enqueue }) => {
      // Discarding the dialog's file closes it, as toggling it with no file does
      const file = event.type === 'commit.TOGGLE_REVERT_DIALOG' ? event.file : undefined
      enqueue.assign({ revertDialogFile: file || null })
      // What of it cannot be brought back is asked for as the dialog opens, and said in it
      if (file) made.make(enqueue, 'discardPreview', { paths: [file.path] })
    }),

    previewDiscard: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.PREVIEW_DISCARD', event)
      made.make(enqueue, 'discardPreview', { paths })
    }),

    setDiscardPreview: assign({ discardPreview: ({ event }) => answerTo('discardPreview', event) }),

    /** A discard that kept something is offered to be undone; one that kept nothing leaves the last offer as it was */
    setLastDiscard: assign(({ context, event }) => {
      const data = event.type === 'made.revertFiles' ? answerTo('revertFiles', event) : answerTo('revertFile', event)
      const paths = 'paths' in data ? data.paths : [data.path]
      return {
        lastDiscard: data.kept.id ? { id: data.kept.id, paths, notKept: data.kept.notKept } : context.lastDiscard,
        discardLeft: [],
        discardPreview: null,
      }
    }),

    undoDiscard: enqueueActions(({ context, enqueue }) => {
      if (context.lastDiscard) made.make(enqueue, 'restoreDiscarded', freshKey(), { id: context.lastDiscard.id })
    }),

    dismissDiscard: assign({ lastDiscard: null, discardLeft: [] }),

    undoLast: enqueueActions(({ enqueue, event }) => {
      const { evenIfPublished } = typeOf('commit.UNDO_LAST', event)
      enqueue.assign({ undoConfirmation: null })
      made.make(enqueue, 'undoLast', freshKey(), { ...(evenIfPublished && { evenIfPublished }) })
    }),

    /** Undone: the offer goes, and what was left alone is said until it is dismissed */
    handleDiscardRestored: assign(({ context, event }) => {
      const { id, left } = answerTo('restoreDiscarded', event)
      return context.lastDiscard?.id === id ? { lastDiscard: null, discardLeft: left } : {}
    }),

    revertFile: enqueueActions(({ context, enqueue }) => {
      if (context.revertDialogFile) made.make(enqueue, 'revertFile', freshKey(), { path: context.revertDialogFile.path })
    }),

    revertFiles: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'revertFiles', freshKey(), { paths: typeOf('commit.REVERT_FILES', event).paths })
    }),

    resolveConflict: enqueueActions(({ event, enqueue }) => {
      const { path, strategy } = typeOf('commit.RESOLVE_CONFLICT', event)
      made.make(enqueue, 'resolveConflict', freshKey(), { path, strategy })
    }),

    markResolved: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'markResolved', freshKey(), { path: typeOf('commit.MARK_RESOLVED', event).path })
    }),

    resolveAllConflicts: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'resolveAllConflicts', freshKey(), { strategy: typeOf('commit.RESOLVE_ALL_CONFLICTS', event).strategy })
    }),

    handleFileReverted: assign({
      revertDialogFile: null
    }),

    clearGitDiff: assign({
      selectedGitFile: null,
    }),

    openFile: ({ event, self }) => {
      const ev = typeOf('commit.OPEN_FILE', event)
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

    dismissError: assign({ gitError: null, gitFailure: null }),

    /** The user trusts the repository the panel was refused in: said to the backend, which remembers it */
    trustRepository: enqueueActions(({ context, enqueue }) => {
      const repository = context.gitFailure?.trust?.repository
      if (repository) made.make(enqueue, 'trustRepository', freshKey(), { repository })
    }),

    /** The user trusts the repository git refused for who owns it: the backend asks git which path, and adds it */
    trustOwnership: enqueueActions(({ context, enqueue }) => {
      if (context.gitFailure?.ownership) made.make(enqueue, 'trustOwnership', freshKey(), {})
    }),

    /** Trusted: the refusal goes, and the status that was never read is asked for */
    repositoryTrusted: assign({ gitError: null, gitFailure: null }),

    /** Opens an untracked folder's row, asking for what is in it, or closes it */
    toggleFolder: enqueueActions(({ context, event, enqueue }) => {
      const { path } = typeOf('commit.TOGGLE_FOLDER', event)
      const { [path]: open, ...others } = context.openFolders
      if (open) return enqueue.assign({ openFolders: others })
      enqueue.assign({ openFolders: { ...others, [path]: { files: [], truncated: false } } })
      made.make(enqueue, 'untracked', path, { path })
    }),

    /** What a folder holds, kept if its row is still open: the answer is the folder's, whichever ask it answers */
    folderListed: assign(({ context, event }) => {
      const { path, files, truncated } = answerTo('untracked', event)
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
      for (const path of open) if (rows.has(path)) made.make(enqueue, 'untracked', path, { path })
    }),

    /** Asks for a rewrite of a commit in the history, kept until it is answered so the user can go on with it if a remote holds it */
    requestRewrite: enqueueActions(({ event, enqueue }) => {
      const { type: _type, ...rewrite } = typeOf('commit.REWRITE_COMMIT', event)
      enqueue.assign({ pendingRewrite: { type: 'commit.REWRITE_COMMIT', ...rewrite }, rewriteConfirmation: null, gitError: null })
      made.make(enqueue, 'rewrite', freshKey(), rewrite)
    }),

    /** Goes on with a rewrite a remote branch holds commits of, the user having said to */
    confirmRewrite: enqueueActions(({ context, enqueue }) => {
      const request = context.rewriteConfirmation?.request
      enqueue.assign({ rewriteConfirmation: null })
      if (request?.type !== 'commit.REWRITE_COMMIT') return
      const { type: _type, ...rewrite } = request
      made.make(enqueue, 'rewrite', freshKey(), { ...rewrite, evenIfPublished: true })
    }),

    /** A remote branch already holds commits the amend or rewrite would change: done only once the user says to go on */
    askToRewritePublished: assign({
      rewriteConfirmation: ({ context, event }) => {
        const refusal = refusalIn(event)
        return context.pendingRewrite && refusal ? { message: refusal.message, request: context.pendingRewrite } : null
      },
    }),

    previewMerge: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'mergePreview', { target: typeOf('commit.PREVIEW_MERGE', event).target })
    }),

    handleMergePreviewed: assign({ mergePreview: ({ event }) => answerTo('mergePreview', event) }),

    // Busy from when the backend says it has begun
    requestGenerateMessage: enqueueActions(({ enqueue }) => {
      made.make(enqueue, 'generateMessage', freshKey(), {})
    }),

    setGeneratingMessage: assign({ isGeneratingMessage: true }),

    /** The flow made no message: why is shown, as a failed command is */
    handleMessageNotGenerated: assign(({ event }) => ({
      gitError: typeOf('commit.MESSAGE_NOT_GENERATED', event).data.message,
      gitFailure: {},
      isGeneratingMessage: false,
    })),

    handleMessageGenerated: assign({
      commitMessage: ({ event }) => typeOf('commit.MESSAGE_GENERATED', event).data.message,
      isGeneratingMessage: false
    }),

    updateBranchInput: assign({ branchInput: ({ event }) => typeOf('commit.UPDATE_BRANCH_INPUT', event).input }),

    createTag: enqueueActions(({ event, enqueue }) => {
      const { name, commit, message } = typeOf('commit.CREATE_TAG', event)
      made.make(enqueue, 'createTag', freshKey(), { name, ...(commit && { commit }), ...(message && { message }) })
    }),

    renameBranch: enqueueActions(({ event, enqueue }) => {
      const { name, to } = typeOf('commit.RENAME_BRANCH', event)
      made.make(enqueue, 'renameBranch', freshKey(), { name, to })
    }),

    /**
     * The code surface started. What the panel holds is one folder's (`ofNoFolder`), and says nothing about
     * another: it goes when the folder is another one, with the asks made of the folder before. Then what the
     * panel shows of the folder is asked for
     */
    handleCodeStartup: enqueueActions(({ context, enqueue, self }) => {
      const directory: string = getParentContext(self)?.baseDirectory || ''
      if (directory !== context.directory) {
        for (const name of OF_ONE_FOLDER) made.drop(enqueue, context, name)
        enqueue.assign({ directory, ...ofNoFolder() })
      }
      if (!directory) return
      enqueue.raise({ type: 'commit.REFRESH_STATUS' })
      // The repositories under the folder the user opened, for the picker
      made.make(enqueue, 'repositories', {})
      enqueue.raise({ type: 'commit.STASH_LIST' })
      enqueue.raise({ type: 'commit.WORKTREE_LIST' })
      enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
      enqueue.raise({ type: 'commit.LOG_LIST' })
    }),

    /** Opens a stash in the list, asking for the files it holds, or closes it */
    toggleStashFiles: enqueueActions(({ context, enqueue, event }) => {
      const { index } = typeOf('commit.TOGGLE_STASH_FILES', event)
      if (context.stashFiles[index]) {
        const { [index]: _closed, ...open } = context.stashFiles
        enqueue.assign({ stashFiles: open })
        return
      }
      made.make(enqueue, 'stashFiles', String(index), { index })
    }),

    /** A stash's files, for the index its ask was made about: the list has not moved since, or the ask was given up */
    stashFilesRead: assign(({ context, event }) => {
      const { key, outcome } = typeOf('made.stashFiles', event)
      return outcome.ok ? { stashFiles: { ...context.stashFiles, [Number(key)]: outcome.value.files } } : {}
    }),

    stashApply: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'stashApply', freshKey(), { index: typeOf('commit.STASH_APPLY', event).index })
    }),

    stashPop: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'stashPop', freshKey(), { index: typeOf('commit.STASH_POP', event).index })
    }),

    stashDrop: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'stashDrop', freshKey(), { index: typeOf('commit.STASH_DROP', event).index })
    }),

    stashClear: enqueueActions(({ enqueue }) => {
      made.make(enqueue, 'stashClear', freshKey(), {})
    }),

    revertCommit: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'revertCommit', freshKey(), { hash: typeOf('commit.REVERT_COMMIT', event).hash })
    }),
  }
}).createMachine({
  id: 'commit',
  context: {
    making: made.none(),
    commitMessage: '',
    trailers: [],
    trailersAsked: undefined,
    directory: '',
    isWatchingRepository: true,
    isWatchSilent: false,
    isShown: false,
    isGeneratingMessage: false,
    ...ofNoFolder(),
  },
  // The machine has no states: what the panel is busy with is the asks it is making, and every event is taken
  // whatever those are
  on: {
    [made.done]: { actions: made.settle() },
    'commit.TOGGLE_FOLDER': { actions: 'toggleFolder' },
    'commit.DISMISS_ERROR': { actions: 'dismissError' },
    'commit.SELECT_FILE': { actions: 'selectGitFile' },
    'commit.STAGE_FILES': { actions: 'stageFiles' },
    'commit.UNSTAGE_FILES': { actions: 'unstageFiles' },
    'commit.VIEW_DIFF': { actions: 'viewDiff' },
    'commit.UPDATE_MESSAGE': { actions: ['updateCommitMessage', 'followTrailers'] },
    'commit.REMOVE_TRAILER': { actions: 'removeTrailer' },
    'commit.TOGGLE_REVERT_DIALOG': { actions: 'toggleRevertDialog' },
    'commit.REVERT_FILE': { actions: ['revertFile', 'toggleRevertDialog'] },
    'commit.REVERT_FILES': { actions: 'revertFiles' },
    'commit.PREVIEW_DISCARD': { actions: 'previewDiscard' },
    'commit.UNDO_LAST': { actions: 'undoLast' },
    'commit.DISMISS_UNDO': { actions: assign({ lastUndoable: null, undoConfirmation: null }) },
    'commit.SELECT_REPOSITORY': {
      actions: ({ event }) => { tell('code', { type: 'SELECT_REPOSITORY', path: event.path }) },
    },
    'commit.TOGGLE_STASH_FILES': { actions: 'toggleStashFiles' },
    'commit.UNDO_DISCARD': { actions: 'undoDiscard' },
    'commit.DISMISS_DISCARD': { actions: 'dismissDiscard' },
    'commit.TRUST_REPOSITORY': { actions: 'trustRepository' },
    'commit.TRUST_OWNERSHIP': { actions: 'trustOwnership' },
    'commit.RESOLVE_CONFLICT': { actions: 'resolveConflict' },
    'commit.MARK_RESOLVED': { actions: 'markResolved' },
    'commit.RESOLVE_ALL_CONFLICTS': { actions: 'resolveAllConflicts' },
    'commit.REWRITE_COMMIT': { actions: 'requestRewrite' },
    'commit.CONFIRM_REWRITE': [
      { guard: ({ context }) => context.rewriteConfirmation?.request.type === 'commit.REWRITE_COMMIT', actions: 'confirmRewrite' },
      // The user said to go on with an amend a remote branch holds the commit of
      {
        guard: ({ context }) => context.rewriteConfirmation?.request.type === 'commit.AMEND',
        actions: enqueueActions(({ context, enqueue }) => {
          const request = context.rewriteConfirmation?.request
          if (request?.type !== 'commit.AMEND' || commitUnderWay(context.making)) return
          enqueue.assign({ pendingRewrite: { ...request, evenIfPublished: true }, rewriteConfirmation: null })
          made.make(enqueue, 'amend', { message: request.message, evenIfPublished: true })
        }),
      },
    ],
    'commit.DISMISS_REWRITE': { actions: assign({ rewriteConfirmation: null, pendingRewrite: null }) },
    'commit.PREVIEW_MERGE': { actions: 'previewMerge' },
    'commit.CLEAR_DIFF': { actions: 'clearGitDiff' },
    'commit.OPEN_FILE': { actions: 'openFile' },
    'commit.UPDATE_BRANCH_INPUT': { actions: 'updateBranchInput' },
    'commit.CREATE_TAG': { actions: 'createTag' },
    'commit.RENAME_BRANCH': { actions: 'renameBranch' },
    'commit.GENERATE_MESSAGE': { actions: 'requestGenerateMessage' },
    'commit.GENERATING_MESSAGE': { actions: 'setGeneratingMessage' },
    'commit.MESSAGE_GENERATED': { actions: ['handleMessageGenerated', 'followTrailers'] },
    'commit.MESSAGE_NOT_GENERATED': { actions: 'handleMessageNotGenerated' },
    'commit.STASH_APPLY': { actions: 'stashApply' },
    'commit.STASH_POP': { actions: 'stashPop' },
    'commit.STASH_DROP': { actions: 'stashDrop' },
    'commit.STASH_CLEAR': { actions: 'stashClear' },
    'commit.REVERT_COMMIT': { actions: 'revertCommit' },
    'CODE_STARTED': { actions: 'handleCodeStartup' },
    // The repository changed, on disk or by a write from any window: ask again for the parts of it that did
    'commit.REPOSITORY_CHANGED': { actions: 'followRepositoryChange' },
    'commit.SHOWN': {
      actions: enqueueActions(({ context, enqueue }) => {
        const missed = context.missedChange
        enqueue.assign({ isShown: true, missedChange: null })
        if (missed) enqueue.raise({ type: 'commit.REPOSITORY_CHANGED', changed: missed })
      })
    },
    'commit.HIDDEN': { actions: assign({ isShown: false }) },

    // How each spawned ask ended, by the ask: one that was not done shows why, and one that was does what its answer is for
    'made.diff': { actions: 'openDiff' },
    'made.diffRefresh': { actions: 'refreshDiff' },
    'made.stage': { actions: ['showFailure', 'settleStaging'] },
    'made.unstage': { actions: ['showFailure', 'settleStaging'] },
    'made.untracked': ended('folderListed'),
    'made.trailers': ended('setTrailers'),
    'made.removeTrailer': ended('takeMessageWithoutTrailer', 'followTrailers'),
    'made.revertFile': ended('handleFileReverted', 'setLastDiscard', 'refreshGitStatus'),
    'made.revertFiles': ended('setLastDiscard', 'refreshGitStatus'),
    'made.discardPreview': ended('setDiscardPreview'),
    'made.restoreDiscarded': ended('handleDiscardRestored', 'refreshGitStatus'),
    'made.undoLast': [
      // The commit to be undone is already on a remote branch: undone only once the user says so, and this says why
      {
        guard: ({ event }) => !event.outcome.ok && event.outcome.failure.kind === 'published',
        actions: [assign({ undoConfirmation: ({ event }) => refusalIn(event)?.message ?? null })],
      },
      REFUSED,
      { actions: [assign({ undoConfirmation: null }), 'takeUndoable'] },
    ],
    'made.trustRepository': ended('repositoryTrusted', 'refreshGitStatus'),
    'made.trustOwnership': ended('repositoryTrusted', 'refreshGitStatus'),
    'made.resolveConflict': ended('refreshGitStatus'),
    'made.markResolved': ended('refreshGitStatus'),
    'made.resolveAllConflicts': ended('refreshGitStatus'),
    'made.rewrite': [
      { guard: ({ event }) => !event.outcome.ok && event.outcome.failure.kind === 'published', actions: ['askToRewritePublished'] },
      REFUSED,
      { actions: [assign({ pendingRewrite: null, rewording: null }), 'requestLogList', 'takeUndoable'] },
    ],
    'made.mergePreview': ended('handleMergePreviewed'),
    // Answered once the flow has the changes: what it makes of them arrives as `commit.MESSAGE_GENERATED`
    'made.generateMessage': [
      { guard: 'refused', actions: ['showFailure', assign({ isGeneratingMessage: false })] },
    ],
    'made.createTag': ended('getAllBranches', 'requestLogList'),
    'made.renameBranch': ended('getAllBranches', 'requestLogList'),
    // A stash applied leaves the message typed as it is; one popped is gone from the list
    'made.stashApply': ended('refreshGitStatus', 'requestStashList'),
    'made.stashPop': ended('refreshGitStatus', 'requestStashList'),
    'made.stashDrop': ended('takeUndoable'),
    'made.stashClear': ended('takeUndoable'),
    'made.stashFiles': { actions: ['showFailure', 'stashFilesRead'] },
    'made.revertCommit': ended('refreshGitStatus', 'requestLogList'),
    'made.repositories': [
      REFUSED,
      { actions: [assign({ repositories: ({ event }) => answerTo('repositories', event).repositories })] },
    ],

    // The status the panel shows. A read asked for while one is under way replaces it: the one under way is of the
    // repository before whatever asked for this one
    'commit.REFRESH_STATUS': {
      actions: enqueueActions(({ enqueue, context }) => {
        made.drop(enqueue, context, 'statusBehind')
        made.make(enqueue, 'statusShown', {})
      }),
    },
    // A read behind one the user asked for is still the user's, which the panel shows as loading until it is answered
    'commit.READ_STATUS': {
      actions: enqueueActions(({ enqueue, context }) => {
        const shown = context.making.statusShown
        made.drop(enqueue, context, shown ? 'statusBehind' : 'statusShown')
        made.make(enqueue, shown ? 'statusShown' : 'statusBehind', {})
      }),
    },
    'made.statusShown': STATUS_ENDED,
    'made.statusBehind': STATUS_ENDED,

    // The history the log shows, a page at a time: a file's while it shows one, from its start or on from the page
    // shown. A page asked for while one is being read replaces it, which stops git walking the one nobody waits for
    'commit.LOG_LIST': {
      actions: enqueueActions(({ context, enqueue }) => {
        made.make(enqueue, 'log', { ...(context.logPath && { path: context.logPath }) })
      }),
    },
    'commit.LOAD_MORE_LOG': {
      guard: ({ context }) => context.logCursor !== null,
      actions: enqueueActions(({ context, enqueue }) => {
        made.make(enqueue, 'log', { ...(context.logCursor && { cursor: context.logCursor }), ...(context.logPath && { path: context.logPath }) })
      }),
    },
    'commit.SHOW_FILE_HISTORY': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ logPath: event.path, commitLog: [], logCursor: null })
        made.make(enqueue, 'log', { ...(event.path && { path: event.path }) })
      }),
    },
    'commit.CLEAR_FILE_HISTORY': {
      actions: enqueueActions(({ enqueue }) => {
        enqueue.assign({ logPath: null, commitLog: [], logCursor: null })
        made.make(enqueue, 'log', {})
      }),
    },
    'made.log': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        // A page is added on to the log when it goes on from a cursor, and takes its place otherwise
        const page = event.outcome.value
        enqueue.assign({ commitLog: page.continued ? [...context.commitLog, ...page.commits] : page.commits, logCursor: page.cursor ?? null })
      }),
    },

    // The branches and tags, the stashes and the worktrees: each list is read again when asked for, in place of a
    // read of it still under way
    'commit.GET_ALL_BRANCHES': {
      actions: enqueueActions(({ enqueue }) => {
        made.make(enqueue, 'branches', {})
      }),
    },
    'made.branches': {
      actions: enqueueActions(({ event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        const { tags, standing, branches } = event.outcome.value
        enqueue.assign({ tags: tags ?? [], branchStanding: standing ?? {}, availableBranches: branches })
      }),
    },
    'commit.STASH_LIST': {
      actions: enqueueActions(({ enqueue }) => {
        made.make(enqueue, 'stashes', {})
      }),
    },
    'made.stashes': {
      // A stash's files are of the stash at its index when they were read: once the list moves, the stash at that
      // index is another, so the files open go and the asks for them are stopped
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        const { stashes } = event.outcome.value
        if (sameStashes(context.stashList, stashes)) return enqueue.assign({ stashList: stashes })
        made.drop(enqueue, context, 'stashFiles')
        enqueue.assign({ stashList: stashes, stashFiles: {} })
      }),
    },
    'commit.WORKTREE_LIST': {
      actions: enqueueActions(({ enqueue }) => {
        made.make(enqueue, 'worktrees', {})
      }),
    },
    'made.worktrees': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign(event.outcome.ok ? { worktreeList: event.outcome.value.worktrees } : failureShown(event.outcome.failure))
      }),
    },

    // A push is under way for exactly as long as the machine holds its ask: one asked for meanwhile is not made, and
    // stopping it stops the ask, which ends git and what it started on the backend
    'commit.PUSH_BRANCH': {
      actions: enqueueActions(({ enqueue, context }) => {
        if (context.making.push) return
        enqueue.assign({ pushStopped: false })
        made.make(enqueue, 'push', {})
      }),
    },
    'commit.PUBLISH_BRANCH.progress': { actions: 'hearProgress' },
    // Stopped by the user rather than done, which the panel says instead of "Pushed"
    'commit.STOP_PUSH': {
      actions: enqueueActions(({ context, enqueue }) => {
        if (!context.making.push) return
        made.drop(enqueue, context, 'push')
        enqueue.assign({ pushStopped: true, ...progressUnless(context, 'push') })
      }),
    },
    'made.push': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign({ ...progressUnless(context, 'push'), ...(event.outcome.ok ? {} : failureShown(event.outcome.failure)) })
      }),
    },
    'commit.PULL_BRANCH': {
      actions: enqueueActions(({ enqueue, context }) => {
        if (!context.making.pull) made.make(enqueue, 'pull', {})
      }),
    },
    'commit.PULL_BRANCH.progress': { actions: 'hearProgress' },
    'made.pull': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign({ ...progressUnless(context, 'pull'), ...(event.outcome.ok ? {} : failureShown(event.outcome.failure)) })
      }),
    },

    // Checking out the branch typed, or making it, in place of either still under way: a checkout that found no
    // branch offers to make it
    'commit.CHECKOUT_BRANCH': {
      guard: ({ context }) => context.branchInput.trim() !== '',
      actions: enqueueActions(({ context, enqueue }) => {
        made.drop(enqueue, context, 'createBranch')
        enqueue.assign(progressUnless(context, 'checkout'))
        made.make(enqueue, 'checkout', { branchName: context.branchInput.trim() })
      }),
    },
    'commit.CHECKOUT_BRANCH.progress': { actions: 'hearProgress' },
    'commit.CREATE_BRANCH': {
      guard: ({ event }) => event.branchName.trim() !== '',
      actions: enqueueActions(({ context, event, enqueue }) => {
        made.drop(enqueue, context, 'checkout')
        enqueue.assign({ gitError: null, gitFailure: null, ...progressUnless(context, 'checkout') })
        made.make(enqueue, 'createBranch', { branchName: event.branchName.trim() })
      }),
    },
    'made.checkout': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign(progressUnless(context, 'checkout'))
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.assign({ branchInput: '' })
        enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
      }),
    },
    'made.createBranch': {
      actions: enqueueActions(({ event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.assign({ branchInput: '' })
        enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
      }),
    },

    // Bringing a submodule to the commit the repository records for it, one at a time: `updatingSubmodule` names it
    // until that is answered
    'commit.UPDATE_SUBMODULE': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        if (context.making.submodule) return
        enqueue.assign({ updatingSubmodule: event.path, gitError: null, gitFailure: null })
        made.make(enqueue, 'submodule', { path: event.path })
      }),
    },
    'commit.UPDATE_SUBMODULE.progress': { actions: 'hearProgress' },
    'made.submodule': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign({ updatingSubmodule: null, ...progressUnless(context, 'submodule'), ...(event.outcome.ok ? {} : failureShown(event.outcome.failure)) })
      }),
    },

    // A commit or an amend, one at a time: another is not asked for until the one under way is answered. The commit
    // is of the message as written: what the settings say to leave out of it (`trailersRemovedOnCommit`) is left out
    // by the system, which reads its trailers as git does
    'commit.COMMIT': {
      guard: ({ context }) => context.commitMessage.trim() !== '',
      actions: enqueueActions(({ context, enqueue }) => {
        if (!commitUnderWay(context.making)) made.make(enqueue, 'commit', { message: context.commitMessage.trim() })
      }),
    },
    // Kept until it is answered, so the user can go on with it if a remote branch holds the commit
    'commit.AMEND': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        if (commitUnderWay(context.making)) return
        enqueue.assign({ pendingRewrite: event, rewriteConfirmation: null, gitError: null })
        made.make(enqueue, 'amend', { message: event.message, evenIfPublished: event.evenIfPublished })
      }),
    },
    'made.commit': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.assign({ commitMessage: '', selectedGitFile: null, ...undoableAfter(context, event.outcome.value) })
        enqueue('followTrailers')
        enqueue.raise({ type: 'commit.READ_STATUS' })
      }),
    },
    'made.amend': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) {
          const { failure } = event.outcome
          // A remote branch already holds the commit: amended only once the user says to go on
          if (failure.kind === 'published') return enqueue.assign({ rewriteConfirmation: context.pendingRewrite ? { message: failure.message, request: context.pendingRewrite } : null })
          return enqueue.assign(failureShown(failure))
        }
        enqueue.assign({ pendingRewrite: null, commitMessage: '', ...undoableAfter(context, event.outcome.value) })
        enqueue('followTrailers')
        enqueue.raise({ type: 'commit.LOG_LIST' })
      }),
    },

    // A stash named with the message typed for the commit takes it; one named otherwise leaves it
    'commit.STASH_PUSH': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const { message, stagedOnly, paths } = event
        enqueue.assign({ stashTakesMessage: !!message && message === context.commitMessage })
        made.make(enqueue, 'stash', { message, stagedOnly, ...(paths && { paths }) })
      }),
    },
    'made.stash': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.assign({ commitMessage: context.stashTakesMessage ? '' : context.commitMessage, stashTakesMessage: false })
        enqueue('followTrailers')
        enqueue.raise({ type: 'commit.READ_STATUS' })
      }),
    },

    // A worktree being added or removed, or the code surface being moved to one: each in place of whichever of the
    // three is still under way
    'commit.WORKTREE_ADD': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        const { path, branch, createBranch } = event
        for (const name of WORKTREE_CHANGES) made.drop(enqueue, context, name)
        made.make(enqueue, 'worktreeAdd', { path, branch, createBranch })
      }),
    },
    'commit.WORKTREE_REMOVE': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        const { path, force } = event
        for (const name of WORKTREE_CHANGES) made.drop(enqueue, context, name)
        made.make(enqueue, 'worktreeRemove', { path, force })
      }),
    },
    // The folder the surface is over moves with the switch, which the surface hears of as its start
    'commit.WORKTREE_SWITCH': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        for (const name of WORKTREE_CHANGES) made.drop(enqueue, context, name)
        made.make(enqueue, 'worktreeSwitch', { path: event.path })
      }),
    },
    'made.worktreeAdd': ended('requestWorktreeList'),
    'made.worktreeRemove': ended('requestWorktreeList'),
    'made.worktreeSwitch': REFUSED,

    'commit.SPEED_UP_STATUS': {
      actions: enqueueActions(({ enqueue }) => {
        made.make(enqueue, 'speedUp', {})
      }),
    },
    'made.speedUp': {
      // The status that follows says whether it is still slow
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign(event.outcome.ok ? { slowStatus: null } : failureShown(event.outcome.failure))
      }),
    },

    // Telling the backend git can sign in to the host that asked, with the app signed in to GitHub. The push or the
    // pull that was refused goes with the ask and comes back with its answer: what is held of it here is cleared by
    // the next status, which can arrive while the sign-in is being set up
    'commit.SET_UP_SIGN_IN': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const during = context.gitFailure?.during
        made.make(enqueue, 'signIn', { host: event.host, ...(during ? { during } : {}) })
      }),
    },
    'made.signIn': {
      // Git can sign in, so the push or the pull that was refused is run again: it is what the user was doing
      actions: enqueueActions(({ event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        const { during } = event.outcome.value
        enqueue.assign({ gitError: null, gitFailure: null })
        if (during === 'push') enqueue.raise({ type: 'commit.PUSH_BRANCH' })
        if (during === 'pull') enqueue.raise({ type: 'commit.PULL_BRANCH' })
      }),
    },

    // Git staging one piece of a file's change, or taking one back out of what is staged
    'commit.APPLY_HUNK': {
      actions: enqueueActions(({ event, enqueue }) => {
        const { path, staged, hunk } = event
        enqueue.assign({ gitError: null, gitFailure: null })
        made.make(enqueue, 'hunk', { path, staged, hunk })
      }),
    },
    'made.hunk': {
      // The tab still shows the piece until its diff is read again, and git cuts it no more
      actions: enqueueActions(({ context, event, enqueue }) => {
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        const applied = event.outcome.value
        const tab = diffTabPath(applied)
        enqueue.assign({ appliedHunks: { ...context.appliedHunks, [tab]: [...(context.appliedHunks[tab] ?? []), applied.hunk] } })
      }),
    },

    // Git carrying on with what it is in the middle of, skipping the commit a rebase stopped at, or giving it up.
    // Where that leaves the repository is in its status, which the backend announces as changed
    'commit.MOVE_OPERATION': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ gitError: null })
        made.make(enqueue, 'moveOperation', { move: event.move })
      }),
    },
    'made.moveOperation': REFUSED,
    // Git merging a branch in, rebasing onto one or picking a commit: one that stops on a conflict shows as in progress
    'commit.START_OPERATION': {
      actions: enqueueActions(({ event, enqueue }) => {
        const { kind, target } = event
        enqueue.assign({ gitError: null })
        made.make(enqueue, 'startOperation', { kind, target })
      }),
    },
    'made.startOperation': ended('takeUndoable', 'requestLogList'),

    // Who last changed each line of the file the editor shows blame for. Asking for another file's, or clearing it,
    // stops the read under way, which stops git reading it
    'commit.SHOW_BLAME': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ blame: { path: event.path, lines: [] } })
        made.make(enqueue, 'blame', { path: event.path })
      }),
    },
    'commit.CLEAR_BLAME': {
      actions: enqueueActions(({ enqueue, context }) => {
        made.drop(enqueue, context, 'blame')
        enqueue.assign({ blame: null })
      }),
    },
    'made.blame': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign(event.outcome.ok ? { blame: event.outcome.value } : { blame: null, ...failureShown(event.outcome.failure) })
      }),
    },

    // The whole message of the commit being reworded in the history, read as the rewording starts
    'commit.START_REWORD': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ rewording: { hash: event.hash, message: null } })
        made.make(enqueue, 'reword', { hash: event.hash })
      }),
    },
    'commit.CANCEL_REWORD': {
      actions: enqueueActions(({ enqueue, context }) => {
        made.drop(enqueue, context, 'reword')
        enqueue.assign({ rewording: null })
      }),
    },
    'made.reword': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign(event.outcome.ok ? { rewording: event.outcome.value } : { rewording: null, ...failureShown(event.outcome.failure) })
      }),
    },

    // The tag being pushed or deleted, which `tagBusy` names until that is answered: each in place of either still
    // under way
    'commit.PUSH_TAG': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        made.drop(enqueue, context, 'tagDelete')
        enqueue.assign({ tagBusy: { name: event.name, action: 'push' } })
        made.make(enqueue, 'tagPush', { name: event.name })
      }),
    },
    'commit.DELETE_TAG': {
      actions: enqueueActions(({ event, enqueue, context }) => {
        made.drop(enqueue, context, 'tagPush')
        enqueue.assign({ tagBusy: { name: event.name, action: 'delete' } })
        made.make(enqueue, 'tagDelete', { name: event.name })
      }),
    },
    'made.tagPush': {
      // The tag last pushed, a new object each time, which the panel says it pushed
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ tagBusy: null, ...(event.outcome.ok ? { tagPushed: { name: event.outcome.value.name } } : failureShown(event.outcome.failure)) })
      }),
    },
    'made.tagDelete': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ tagBusy: null })
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
        enqueue.raise({ type: 'commit.LOG_LIST' })
      }),
    },

    // The branch being reset to a commit, which `resettingTo` names until that is answered
    'commit.RESET_TO_COMMIT': {
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ resettingTo: event.hash })
        made.make(enqueue, 'reset', { hash: event.hash })
      }),
    },
    'made.reset': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign({ resettingTo: null })
        if (!event.outcome.ok) return enqueue.assign(failureShown(event.outcome.failure))
        enqueue.assign(undoableAfter(context, event.outcome.value))
        enqueue.raise({ type: 'commit.READ_STATUS' })
        enqueue.raise({ type: 'commit.LOG_LIST' })
      }),
    },
  },
});

/** The commit child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CommitActor = ActorRefFrom<typeof commitState>;
