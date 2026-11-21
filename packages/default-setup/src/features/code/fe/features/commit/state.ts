import { setup, assign, enqueueActions, stateIn, type ActorRefFrom } from 'xstate';
import type { AnswerPayload, AskOutcome, ContractAsks, ProgressEventOf } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { CommitStatus, Contract as CodeSystemContract, GitFailure } from '#features/code/be/contract.ts';
import { fromAsk, sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { diffTab, diffTabPath } from '../../utils/diff-tabs.ts';
import { withStaged, withUnstaged } from 'apack-git/staging';
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
  /** The asks for a stash's files still unanswered, by the id each runs under, each with the index it asked about */
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
  /**
   * The asks in flight for a diff that is already open, by the id each runs under, each with its tab: the answer to
   * one brings its tab up to date and opens none. An ask made since for the same tab stops it
   */
  diffRefreshes: Record<string, string>
  /** Whether the error shown is the status read's own, which the next status read clears */
  statusFailed: boolean
  /** The stage and unstage writes still unanswered, by the id each runs under. The list shows them done, so no status is shown until they are answered */
  stagingWrites: string[]
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

/** The code system's asks, the commit child's among them */
type Asks = ContractAsks<CodeSystemContract>

/**
 * The asks this panel makes, each as logic a state invokes or the machine spawns: the commit ones, and the code
 * system's own picker and worktree switch
 */
const asks = {
  'commit.GET_GIT_STATUS': fromAsk('code', 'commit.GET_GIT_STATUS'),
  'commit.GET_GIT_DIFF': fromAsk('code', 'commit.GET_GIT_DIFF'),
  'commit.STAGE_FILES': fromAsk('code', 'commit.STAGE_FILES'),
  'commit.UNSTAGE_FILES': fromAsk('code', 'commit.UNSTAGE_FILES'),
  'commit.COMMIT': fromAsk('code', 'commit.COMMIT'),
  'commit.AMEND': fromAsk('code', 'commit.AMEND'),
  'commit.REWRITE_COMMIT': fromAsk('code', 'commit.REWRITE_COMMIT'),
  'commit.GET_COMMIT_MESSAGE': fromAsk('code', 'commit.GET_COMMIT_MESSAGE'),
  'commit.READ_TRAILERS': fromAsk('code', 'commit.READ_TRAILERS'),
  'commit.REMOVE_TRAILER': fromAsk('code', 'commit.REMOVE_TRAILER'),
  'commit.REVERT_FILE': fromAsk('code', 'commit.REVERT_FILE'),
  'commit.REVERT_FILES': fromAsk('code', 'commit.REVERT_FILES'),
  'commit.PREVIEW_DISCARD': fromAsk('code', 'commit.PREVIEW_DISCARD'),
  'commit.RESTORE_DISCARDED': fromAsk('code', 'commit.RESTORE_DISCARDED'),
  'commit.UNDO_LAST': fromAsk('code', 'commit.UNDO_LAST'),
  'commit.TRUST_REPOSITORY': fromAsk('code', 'commit.TRUST_REPOSITORY'),
  'commit.TRUST_OWNERSHIP': fromAsk('code', 'commit.TRUST_OWNERSHIP'),
  'commit.LIST_UNTRACKED': fromAsk('code', 'commit.LIST_UNTRACKED'),
  'commit.APPLY_HUNK': fromAsk('code', 'commit.APPLY_HUNK'),
  'commit.SET_UP_SIGN_IN': fromAsk('code', 'commit.SET_UP_SIGN_IN'),
  'commit.RESOLVE_CONFLICT': fromAsk('code', 'commit.RESOLVE_CONFLICT'),
  'commit.MARK_RESOLVED': fromAsk('code', 'commit.MARK_RESOLVED'),
  'commit.RESOLVE_ALL_CONFLICTS': fromAsk('code', 'commit.RESOLVE_ALL_CONFLICTS'),
  'commit.MOVE_OPERATION': fromAsk('code', 'commit.MOVE_OPERATION'),
  'commit.START_OPERATION': fromAsk('code', 'commit.START_OPERATION'),
  'commit.PREVIEW_MERGE': fromAsk('code', 'commit.PREVIEW_MERGE'),
  'commit.GENERATE_MESSAGE': fromAsk('code', 'commit.GENERATE_MESSAGE'),
  'commit.GET_ALL_BRANCHES': fromAsk('code', 'commit.GET_ALL_BRANCHES'),
  'commit.CHECKOUT_BRANCH': fromAsk('code', 'commit.CHECKOUT_BRANCH'),
  'commit.CREATE_BRANCH': fromAsk('code', 'commit.CREATE_BRANCH'),
  'commit.RENAME_BRANCH': fromAsk('code', 'commit.RENAME_BRANCH'),
  'commit.CREATE_TAG': fromAsk('code', 'commit.CREATE_TAG'),
  'commit.DELETE_TAG': fromAsk('code', 'commit.DELETE_TAG'),
  'commit.PUSH_TAG': fromAsk('code', 'commit.PUSH_TAG'),
  'commit.PUBLISH_BRANCH': fromAsk('code', 'commit.PUBLISH_BRANCH'),
  'commit.PULL_BRANCH': fromAsk('code', 'commit.PULL_BRANCH'),
  'commit.SPEED_UP_STATUS': fromAsk('code', 'commit.SPEED_UP_STATUS'),
  'commit.STASH_PUSH': fromAsk('code', 'commit.STASH_PUSH'),
  'commit.STASH_LIST': fromAsk('code', 'commit.STASH_LIST'),
  'commit.STASH_APPLY': fromAsk('code', 'commit.STASH_APPLY'),
  'commit.STASH_POP': fromAsk('code', 'commit.STASH_POP'),
  'commit.STASH_DROP': fromAsk('code', 'commit.STASH_DROP'),
  'commit.STASH_CLEAR': fromAsk('code', 'commit.STASH_CLEAR'),
  'commit.GET_STASH_CHANGES': fromAsk('code', 'commit.GET_STASH_CHANGES'),
  'commit.GET_BLAME': fromAsk('code', 'commit.GET_BLAME'),
  'commit.UPDATE_SUBMODULE': fromAsk('code', 'commit.UPDATE_SUBMODULE'),
  'commit.WORKTREE_LIST': fromAsk('code', 'commit.WORKTREE_LIST'),
  'commit.WORKTREE_ADD': fromAsk('code', 'commit.WORKTREE_ADD'),
  'commit.WORKTREE_REMOVE': fromAsk('code', 'commit.WORKTREE_REMOVE'),
  'commit.WORKTREE_SWITCH': fromAsk('code', 'commit.WORKTREE_SWITCH'),
  'commit.LOG_LIST': fromAsk('code', 'commit.LOG_LIST'),
  'commit.REVERT_COMMIT': fromAsk('code', 'commit.REVERT_COMMIT'),
  'commit.RESET_TO_COMMIT': fromAsk('code', 'commit.RESET_TO_COMMIT'),
  'commit.LIST_REPOSITORIES': fromAsk('code', 'commit.LIST_REPOSITORIES'),
}

/**
 * The asks the machine spawns, several of which may be under way at once, each under an id of its own (`askId`):
 * how one ended arrives as `xstate.done.actor.<id>`. Every other ask is invoked by the state that is busy with it
 */
const SPAWNED = [
  'commit.GET_GIT_DIFF', 'commit.STAGE_FILES', 'commit.UNSTAGE_FILES', 'commit.REWRITE_COMMIT', 'commit.READ_TRAILERS',
  'commit.REMOVE_TRAILER', 'commit.REVERT_FILE', 'commit.REVERT_FILES', 'commit.PREVIEW_DISCARD', 'commit.RESTORE_DISCARDED',
  'commit.UNDO_LAST', 'commit.TRUST_REPOSITORY', 'commit.TRUST_OWNERSHIP', 'commit.LIST_UNTRACKED', 'commit.RESOLVE_CONFLICT',
  'commit.MARK_RESOLVED', 'commit.RESOLVE_ALL_CONFLICTS', 'commit.PREVIEW_MERGE', 'commit.GENERATE_MESSAGE', 'commit.RENAME_BRANCH',
  'commit.CREATE_TAG', 'commit.STASH_APPLY', 'commit.STASH_POP', 'commit.STASH_DROP', 'commit.STASH_CLEAR',
  'commit.GET_STASH_CHANGES', 'commit.REVERT_COMMIT', 'commit.LIST_REPOSITORIES',
] as const
type Spawned = (typeof SPAWNED)[number]

/** How a spawned ask ended: the done event of the actor it ran as, whose id begins with the ask's name */
type AskDone = { [K in Spawned]: { type: `xstate.done.actor.${K}.${string}`; actorId: string; output: AskOutcome<Asks[K]> } }[Spawned]

let spawned = 0

/** An id for a spawned ask to run under: the ask's name, which its done event is taken by, and a number of its own */
const askId = (ask: Spawned): string => `${ask}.${++spawned}`

/** Whether a child of the machine is a spawned ask that is read of one folder, which goes when the folder does */
const ofOneFolder = (id: string): boolean => SPAWNED.some(ask => ask !== 'commit.GET_GIT_DIFF' && id.startsWith(`${ask}.`))

/**
 * An ask for a diff that is already open, to bring its tab up to date: the id it runs under, the asks before it for
 * the same tab, which are stopped, the diff as it is now being the one this reads, and the refreshes left under way
 */
function diffRefresh(refreshes: Record<string, string>, file: { path: string; staged: boolean }) {
  const tab = diffTabPath(file)
  const id = askId('commit.GET_GIT_DIFF')
  const before = Object.keys(refreshes).filter(asked => refreshes[asked] === tab)
  const others = Object.fromEntries(Object.entries(refreshes).filter(([, asked]) => asked !== tab))
  return { id, before, refreshes: { ...others, [id]: tab }, input: { path: file.path, staged: file.staged } }
}

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
  gitStatus: context.stagingWrites.length > 0 ? context.gitStatus : status.files,
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
  /** The code surface started over another folder: whatever the panel was busy asking the one before is left */
  | { type: 'commit.FOLDER_LEFT' }
  /** The flow writing a commit message for this window made none, and says why */
  | { type: 'commit.MESSAGE_NOT_GENERATED'; data: { message: string } }
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
  | { type: 'commit.SHOWN' }
  | { type: 'commit.HIDDEN' }
  // How far along the push, the pull, the checkout or the submodule update asked for is, as its ask says while it runs
  | ProgressEventOf<CodeSystemContract, 'commit.PUBLISH_BRANCH' | 'commit.PULL_BRANCH' | 'commit.CHECKOUT_BRANCH' | 'commit.UPDATE_SUBMODULE'>
  // How each spawned ask ended
  | AskDone;

const typeOf = safeEvents<Event>();

/** An amend of the last commit or a rewrite of one in the history, as the panel asks the backend for it */
type RewriteRequest =
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }

/** Why a spawned ask was not done, where the event is one that ended that way */
const refusalIn = (event: Event): Refusal | undefined => ('output' in event && !event.output.ok ? event.output.failure : undefined)

/** The answer to a spawned ask, off the done event of one that was answered: throws for any other event */
function answerTo<K extends Spawned>(ask: K, event: Event): AnswerPayload<Asks[K]> {
  if (!('output' in event) || !event.type.startsWith(`xstate.done.actor.${ask}.`) || !event.output.ok) throw new Error(`Expected an answer to ${ask}, got ${event.type}`)
  return event.output.value as AnswerPayload<Asks[K]>
}

/** The id the spawned ask that ended ran under */
const askOf = (event: Event): string | undefined => ('actorId' in event ? event.actorId : undefined)

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
  | 'stagingWrites'
  | 'statusFailed'
  | 'stashFileAsks'
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
 * What it waits on goes with it: the asks made of the folder before are stopped, and every state that was busy
 * with one is left (`commit.FOLDER_LEFT`), so an answer from that folder is taken for none and nothing stays
 * busy. The open diffs' refreshes are not among them: they belong to tabs, and their answers only ever bring a tab
 * up to date.
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
  stagingWrites: [],
  statusFailed: false,
  stashFileAsks: {},
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

/**
 * The parts of the panel that wait on one ask at a time, each a region of the machine that is `idle` or in the
 * state that invokes the ask: a component reads whether one is busy off the state (`matches({ push: 'pushing' })`)
 */
const REGIONS = [
  'status', 'log', 'branches', 'stashes', 'worktrees', 'push', 'pull', 'checkout', 'submodule', 'committing', 'stash',
  'worktree', 'speedUp', 'signIn', 'hunk', 'moveOperation', 'startOperation', 'blame', 'reword', 'tag', 'reset',
] as const

/** Shows why a spawned ask was not done, in place of what its answer would have done */
const REFUSED = { guard: 'refused', actions: 'showFailure' } as const

export const commitState = setup({
  types: {
    context: {} as CodeCommitContext,
    events: {} as Event
  },
  actors: asks,
  guards: {
    refused: ({ event }) => refusalIn(event) !== undefined,
  },
  actions: {
    showFailure: assign(({ event }) => {
      const refusal = refusalIn(event)
      return refusal ? failureShown(refusal) : {}
    }),

    /** What Undo would take back after the write a spawned ask made, where its answer could say */
    takeUndoable: assign(({ context, event }) => {
      const answer = 'output' in event && event.output.ok ? event.output.value : undefined
      return undoableAfter(context, answer && typeof answer === 'object' && 'undoable' in answer ? { undoable: answer.undoable } : undefined)
    }),

    refreshGitStatus: enqueueActions(({ enqueue }) => { enqueue.raise({ type: 'commit.READ_STATUS' }) }),
    requestLogList: enqueueActions(({ enqueue }) => { enqueue.raise({ type: 'commit.LOG_LIST' }) }),
    requestStashList: enqueueActions(({ enqueue }) => { enqueue.raise({ type: 'commit.STASH_LIST' }) }),
    requestWorktreeList: enqueueActions(({ enqueue }) => { enqueue.raise({ type: 'commit.WORKTREE_LIST' }) }),
    getAllBranches: enqueueActions(({ enqueue }) => { enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' }) }),

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
          if (!changed.files || changed.files.includes(path)) enqueue.spawnChild('commit.LIST_UNTRACKED', { id: askId('commit.LIST_UNTRACKED'), input: { path } })
        }
      }
      let refreshes = context.diffRefreshes
      // A diff is read when its tab opens, so one left open is of the file as it was until it is read again
      for (const { gitFile } of openDiffs(self)) {
        // A file inside a folder git lists as one row is named by that folder, which is all git says of it
        if (changed.files && !changed.files.some(named => named === gitFile!.path || (named.endsWith('/') && gitFile!.path.startsWith(named)))) continue
        const refresh = diffRefresh(refreshes, gitFile!)
        for (const id of refresh.before) enqueue.stopChild(id)
        enqueue.spawnChild('commit.GET_GIT_DIFF', { id: refresh.id, input: refresh.input })
        refreshes = refresh.refreshes
      }
      enqueue.assign({ diffRefreshes: refreshes })
    }),

    selectGitFile: assign({ selectedGitFile: ({ event }) => typeOf('commit.SELECT_FILE', event).file }),

    /**
     * A staged file moves in the list at once, to where git will list it, and git is told. What git answers
     * replaces the guess. A status read before the write landed would put the file back, so none is shown until
     * every such write is answered.
     */
    stageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.STAGE_FILES', event)
      const id = askId('commit.STAGE_FILES')
      enqueue.assign(({ context }) => ({ gitStatus: withStaged(context.gitStatus, paths), stagingWrites: [...context.stagingWrites, id] }))
      enqueue.spawnChild('commit.STAGE_FILES', { id, input: { paths } })
    }),

    unstageFiles: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.UNSTAGE_FILES', event)
      const id = askId('commit.UNSTAGE_FILES')
      enqueue.assign(({ context }) => ({ gitStatus: withUnstaged(context.gitStatus, paths), stagingWrites: [...context.stagingWrites, id] }))
      enqueue.spawnChild('commit.UNSTAGE_FILES', { id, input: { paths } })
    }),

    /**
     * A stage or an unstage ended. Once none is left unanswered the list is read from git, which shows the write, or
     * puts the file back where it is when the write was refused
     */
    settleStaging: enqueueActions(({ context, event, enqueue }) => {
      const writes = context.stagingWrites.filter(id => id !== askOf(event))
      enqueue.assign({ stagingWrites: writes })
      if (writes.length === 0) enqueue.raise({ type: 'commit.READ_STATUS' })
    }),

    viewDiff: enqueueActions(({ context, event, self, enqueue }) => {
      const ev = typeOf('commit.VIEW_DIFF', event)
      const tabPath = diffTabPath(ev)
      if (!openDiffs(self).some(file => file.path === tabPath)) {
        enqueue.spawnChild('commit.GET_GIT_DIFF', { id: askId('commit.GET_GIT_DIFF'), input: { path: ev.path, staged: ev.staged } })
        return
      }
      // Already open: it is shown at once as it stands, with whatever was typed into it, and read again behind that
      enqueue(() => updateParentState(self, { activeFilePath: tabPath }))
      const refresh = diffRefresh(context.diffRefreshes, ev)
      for (const id of refresh.before) enqueue.stopChild(id)
      enqueue.assign({ diffRefreshes: refresh.refreshes })
      enqueue.spawnChild('commit.GET_GIT_DIFF', { id: refresh.id, input: refresh.input })
    }),

    /**
     * The diff names its own file, so the tab it opens or brings up to date is that file's: `GitDiff` carries
     * `path` and `staged` (`code/be/types.ts`), which is the tab's key, and the file selected now may be another.
     *
     * An answer to an ask made for a diff already open changes that tab where it is, and opens none: its tab may
     * have been closed since, and a diff the user is not looking at does not take the window. Nobody asked for a
     * diff that was read again, so its failing is said to nobody, and the tab stays as it was
     */
    handleDiffRead: enqueueActions(({ enqueue, self, event, context }) => {
      const id = askOf(event)
      const refreshed = id !== undefined && id in context.diffRefreshes
      if (refreshed) {
        const { [id]: _ended, ...pending } = context.diffRefreshes
        enqueue.assign({ diffRefreshes: pending })
      }
      const refusal = refusalIn(event)
      if (refusal) {
        if (!refreshed) enqueue.assign(failureShown(refusal))
        return
      }
      const diff = answerTo('commit.GET_GIT_DIFF', event)
      // A diff as it is now holds none of the pieces that were staged out of the one before it, in its own tab
      const tab = diffTabPath(diff)
      if (context.appliedHunks[tab]) {
        const { [tab]: _read, ...others } = context.appliedHunks
        enqueue.assign({ appliedHunks: others })
      }
      if (refreshed) enqueue(() => sendEventToParent(self, { type: 'REFRESH_DIFF_TAB', diff }))
      else enqueue(() => addTabToParent(self, diffTab(diff)))
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
      if (paragraph !== undefined) enqueue.spawnChild('commit.READ_TRAILERS', { id: askId('commit.READ_TRAILERS'), input: { message: context.commitMessage } })
    }),

    /** The trailers of the message as it is now: an answer about a paragraph since typed over is of another message */
    setTrailers: assign(({ context, event }) => {
      const { message, trailers } = answerTo('commit.READ_TRAILERS', event)
      return trailerParagraph(message) === trailerParagraph(context.commitMessage) ? { trailers } : {}
    }),

    removeTrailer: enqueueActions(({ context, event, enqueue }) => {
      const { trailer } = typeOf('commit.REMOVE_TRAILER', event)
      enqueue.spawnChild('commit.REMOVE_TRAILER', { id: askId('commit.REMOVE_TRAILER'), input: { message: context.commitMessage, trailer } })
    }),

    /** The message without the trailer, taken while the message is still the one it was removed from */
    takeMessageWithoutTrailer: assign(({ context, event }) => {
      const { message, without } = answerTo('commit.REMOVE_TRAILER', event)
      return message === context.commitMessage ? { commitMessage: without } : {}
    }),

    toggleRevertDialog: enqueueActions(({ event, enqueue }) => {
      // Discarding the dialog's file closes it, as toggling it with no file does
      const file = event.type === 'commit.TOGGLE_REVERT_DIALOG' ? event.file : undefined
      enqueue.assign({ revertDialogFile: file || null })
      // What of it cannot be brought back is asked for as the dialog opens, and said in it
      if (file) enqueue.spawnChild('commit.PREVIEW_DISCARD', { id: askId('commit.PREVIEW_DISCARD'), input: { paths: [file.path] } })
    }),

    previewDiscard: enqueueActions(({ event, enqueue }) => {
      const { paths } = typeOf('commit.PREVIEW_DISCARD', event)
      enqueue.spawnChild('commit.PREVIEW_DISCARD', { id: askId('commit.PREVIEW_DISCARD'), input: { paths } })
    }),

    setDiscardPreview: assign({ discardPreview: ({ event }) => answerTo('commit.PREVIEW_DISCARD', event) }),

    /** A discard that kept something is offered to be undone; one that kept nothing leaves the last offer as it was */
    setLastDiscard: assign(({ context, event }) => {
      const data = event.type.startsWith('xstate.done.actor.commit.REVERT_FILES.') ? answerTo('commit.REVERT_FILES', event) : answerTo('commit.REVERT_FILE', event)
      const paths = 'paths' in data ? data.paths : [data.path]
      return {
        lastDiscard: data.kept.id ? { id: data.kept.id, paths, notKept: data.kept.notKept } : context.lastDiscard,
        discardLeft: [],
        discardPreview: null,
      }
    }),

    undoDiscard: enqueueActions(({ context, enqueue }) => {
      if (context.lastDiscard) enqueue.spawnChild('commit.RESTORE_DISCARDED', { id: askId('commit.RESTORE_DISCARDED'), input: { id: context.lastDiscard.id } })
    }),

    dismissDiscard: assign({ lastDiscard: null, discardLeft: [] }),

    undoLast: enqueueActions(({ enqueue, event }) => {
      const { evenIfPublished } = typeOf('commit.UNDO_LAST', event)
      enqueue.assign({ undoConfirmation: null })
      enqueue.spawnChild('commit.UNDO_LAST', { id: askId('commit.UNDO_LAST'), input: { ...(evenIfPublished && { evenIfPublished }) } })
    }),

    /** Undone: the offer goes, and what was left alone is said until it is dismissed */
    handleDiscardRestored: assign(({ context, event }) => {
      const { id, left } = answerTo('commit.RESTORE_DISCARDED', event)
      return context.lastDiscard?.id === id ? { lastDiscard: null, discardLeft: left } : {}
    }),

    revertFile: enqueueActions(({ context, enqueue }) => {
      if (context.revertDialogFile) enqueue.spawnChild('commit.REVERT_FILE', { id: askId('commit.REVERT_FILE'), input: { path: context.revertDialogFile.path } })
    }),

    revertFiles: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.REVERT_FILES', { id: askId('commit.REVERT_FILES'), input: { paths: typeOf('commit.REVERT_FILES', event).paths } })
    }),

    resolveConflict: enqueueActions(({ event, enqueue }) => {
      const { path, strategy } = typeOf('commit.RESOLVE_CONFLICT', event)
      enqueue.spawnChild('commit.RESOLVE_CONFLICT', { id: askId('commit.RESOLVE_CONFLICT'), input: { path, strategy } })
    }),

    markResolved: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.MARK_RESOLVED', { id: askId('commit.MARK_RESOLVED'), input: { path: typeOf('commit.MARK_RESOLVED', event).path } })
    }),

    resolveAllConflicts: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.RESOLVE_ALL_CONFLICTS', { id: askId('commit.RESOLVE_ALL_CONFLICTS'), input: { strategy: typeOf('commit.RESOLVE_ALL_CONFLICTS', event).strategy } })
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
      if (repository) enqueue.spawnChild('commit.TRUST_REPOSITORY', { id: askId('commit.TRUST_REPOSITORY'), input: { repository } })
    }),

    /** The user trusts the repository git refused for who owns it: the backend asks git which path, and adds it */
    trustOwnership: enqueueActions(({ context, enqueue }) => {
      if (context.gitFailure?.ownership) enqueue.spawnChild('commit.TRUST_OWNERSHIP', { id: askId('commit.TRUST_OWNERSHIP'), input: {} })
    }),

    /** Trusted: the refusal goes, and the status that was never read is asked for */
    repositoryTrusted: assign({ gitError: null, gitFailure: null }),

    /** Opens an untracked folder's row, asking for what is in it, or closes it */
    toggleFolder: enqueueActions(({ context, event, enqueue }) => {
      const { path } = typeOf('commit.TOGGLE_FOLDER', event)
      const { [path]: open, ...others } = context.openFolders
      if (open) return enqueue.assign({ openFolders: others })
      enqueue.assign({ openFolders: { ...others, [path]: { files: [], truncated: false } } })
      enqueue.spawnChild('commit.LIST_UNTRACKED', { id: askId('commit.LIST_UNTRACKED'), input: { path } })
    }),

    /** What a folder holds, kept if its row is still open: the answer is the folder's, whichever ask it answers */
    folderListed: assign(({ context, event }) => {
      const { path, files, truncated } = answerTo('commit.LIST_UNTRACKED', event)
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
      for (const path of open) if (rows.has(path)) enqueue.spawnChild('commit.LIST_UNTRACKED', { id: askId('commit.LIST_UNTRACKED'), input: { path } })
    }),

    /** Asks for a rewrite of a commit in the history, kept until it is answered so the user can go on with it if a remote holds it */
    requestRewrite: enqueueActions(({ event, enqueue }) => {
      const { type: _type, ...rewrite } = typeOf('commit.REWRITE_COMMIT', event)
      enqueue.assign({ pendingRewrite: { type: 'commit.REWRITE_COMMIT', ...rewrite }, rewriteConfirmation: null, gitError: null })
      enqueue.spawnChild('commit.REWRITE_COMMIT', { id: askId('commit.REWRITE_COMMIT'), input: rewrite })
    }),

    /** Goes on with a rewrite a remote branch holds commits of, the user having said to */
    confirmRewrite: enqueueActions(({ context, enqueue }) => {
      const request = context.rewriteConfirmation?.request
      enqueue.assign({ rewriteConfirmation: null })
      if (request?.type !== 'commit.REWRITE_COMMIT') return
      const { type: _type, ...rewrite } = request
      enqueue.spawnChild('commit.REWRITE_COMMIT', { id: askId('commit.REWRITE_COMMIT'), input: { ...rewrite, evenIfPublished: true } })
    }),

    /** A remote branch already holds commits the amend or rewrite would change: done only once the user says to go on */
    askToRewritePublished: assign({
      rewriteConfirmation: ({ context, event }) => {
        const refusal = refusalIn(event)
        return context.pendingRewrite && refusal ? { message: refusal.message, request: context.pendingRewrite } : null
      },
    }),

    previewMerge: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.PREVIEW_MERGE', { id: askId('commit.PREVIEW_MERGE'), input: { target: typeOf('commit.PREVIEW_MERGE', event).target } })
    }),

    handleMergePreviewed: assign({ mergePreview: ({ event }) => answerTo('commit.PREVIEW_MERGE', event) }),

    // Busy from when the backend says it has begun
    requestGenerateMessage: enqueueActions(({ enqueue }) => {
      enqueue.spawnChild('commit.GENERATE_MESSAGE', { id: askId('commit.GENERATE_MESSAGE'), input: {} })
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
      enqueue.spawnChild('commit.CREATE_TAG', { id: askId('commit.CREATE_TAG'), input: { name, ...(commit && { commit }), ...(message && { message }) } })
    }),

    renameBranch: enqueueActions(({ event, enqueue }) => {
      const { name, to } = typeOf('commit.RENAME_BRANCH', event)
      enqueue.spawnChild('commit.RENAME_BRANCH', { id: askId('commit.RENAME_BRANCH'), input: { name, to } })
    }),

    /**
     * The code surface started. What the panel holds is one folder's (`ofNoFolder`), and says nothing about
     * another: it goes when the folder is another one, with the asks made of the folder before. Then what the
     * panel shows of the folder is asked for
     */
    handleCodeStartup: enqueueActions(({ context, enqueue, self }) => {
      const directory: string = getParentContext(self)?.baseDirectory || ''
      if (directory !== context.directory) {
        for (const id of Object.keys(self.getSnapshot().children)) if (ofOneFolder(id)) enqueue.stopChild(id)
        enqueue.assign({ directory, ...ofNoFolder() })
        enqueue.raise({ type: 'commit.FOLDER_LEFT' })
      }
      if (!directory) return
      enqueue.raise({ type: 'commit.REFRESH_STATUS' })
      // The repositories under the folder the user opened, for the picker
      enqueue.spawnChild('commit.LIST_REPOSITORIES', { id: askId('commit.LIST_REPOSITORIES'), input: {} })
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
      const id = askId('commit.GET_STASH_CHANGES')
      enqueue.assign({ stashFileAsks: { ...context.stashFileAsks, [id]: index } })
      enqueue.spawnChild('commit.GET_STASH_CHANGES', { id, input: { index } })
    }),

    /** A stash's files, for the index its ask was made about: the list has not moved since, or the ask was stopped */
    stashFilesRead: assign(({ context, event }) => {
      const id = askOf(event)
      if (id === undefined || !(id in context.stashFileAsks)) return {}
      const { [id]: index, ...pending } = context.stashFileAsks
      return { stashFileAsks: pending, ...(refusalIn(event) ? {} : { stashFiles: { ...context.stashFiles, [index!]: answerTo('commit.GET_STASH_CHANGES', event).files } }) }
    }),

    stashApply: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.STASH_APPLY', { id: askId('commit.STASH_APPLY'), input: { index: typeOf('commit.STASH_APPLY', event).index } })
    }),

    stashPop: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.STASH_POP', { id: askId('commit.STASH_POP'), input: { index: typeOf('commit.STASH_POP', event).index } })
    }),

    stashDrop: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.STASH_DROP', { id: askId('commit.STASH_DROP'), input: { index: typeOf('commit.STASH_DROP', event).index } })
    }),

    stashClear: enqueueActions(({ enqueue }) => {
      enqueue.spawnChild('commit.STASH_CLEAR', { id: askId('commit.STASH_CLEAR'), input: {} })
    }),

    revertCommit: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('commit.REVERT_COMMIT', { id: askId('commit.REVERT_COMMIT'), input: { hash: typeOf('commit.REVERT_COMMIT', event).hash } })
    }),
  }
}).createMachine({
  id: 'commit',
  type: 'parallel',
  context: {
    diffRefreshes: {},
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
  // What the panel takes whatever it is busy with. None of these has a target but
  // `commit.FOLDER_LEFT`: a transition of the whole machine to one of its states leaves every region, and so stops every
  // ask a state is busy with
  on: {
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
      actions: ({ event }) => { sendToSystem('code', { type: 'SELECT_REPOSITORY', path: event.path }) },
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
    'commit.CONFIRM_REWRITE': {
      guard: ({ context }) => context.rewriteConfirmation?.request.type === 'commit.REWRITE_COMMIT',
      actions: 'confirmRewrite',
    },
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
    // The one transition of the whole machine: every region is left for its `idle`, which stops what each was busy
    // asking the folder before
    'commit.FOLDER_LEFT': { target: REGIONS.map(region => `.${region}.idle`) },
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
    'xstate.done.actor.commit.GET_GIT_DIFF.*': { actions: 'handleDiffRead' },
    'xstate.done.actor.commit.STAGE_FILES.*': { actions: ['showFailure', 'settleStaging'] },
    'xstate.done.actor.commit.UNSTAGE_FILES.*': { actions: ['showFailure', 'settleStaging'] },
    'xstate.done.actor.commit.LIST_UNTRACKED.*': [REFUSED, { actions: 'folderListed' }],
    'xstate.done.actor.commit.READ_TRAILERS.*': [REFUSED, { actions: 'setTrailers' }],
    'xstate.done.actor.commit.REMOVE_TRAILER.*': [REFUSED, { actions: ['takeMessageWithoutTrailer', 'followTrailers'] }],
    'xstate.done.actor.commit.REVERT_FILE.*': [REFUSED, { actions: ['handleFileReverted', 'setLastDiscard', 'refreshGitStatus'] }],
    'xstate.done.actor.commit.REVERT_FILES.*': [REFUSED, { actions: ['setLastDiscard', 'refreshGitStatus'] }],
    'xstate.done.actor.commit.PREVIEW_DISCARD.*': [REFUSED, { actions: 'setDiscardPreview' }],
    'xstate.done.actor.commit.RESTORE_DISCARDED.*': [REFUSED, { actions: ['handleDiscardRestored', 'refreshGitStatus'] }],
    'xstate.done.actor.commit.UNDO_LAST.*': [
      // The commit to be undone is already on a remote branch: undone only once the user says so, and this says why
      {
        guard: ({ event }) => !event.output.ok && event.output.failure.kind === 'published',
        actions: assign({ undoConfirmation: ({ event }) => refusalIn(event)?.message ?? null }),
      },
      REFUSED,
      { actions: [assign({ undoConfirmation: null }), 'takeUndoable'] },
    ],
    'xstate.done.actor.commit.TRUST_REPOSITORY.*': [REFUSED, { actions: ['repositoryTrusted', 'refreshGitStatus'] }],
    'xstate.done.actor.commit.TRUST_OWNERSHIP.*': [REFUSED, { actions: ['repositoryTrusted', 'refreshGitStatus'] }],
    'xstate.done.actor.commit.RESOLVE_CONFLICT.*': [REFUSED, { actions: 'refreshGitStatus' }],
    'xstate.done.actor.commit.MARK_RESOLVED.*': [REFUSED, { actions: 'refreshGitStatus' }],
    'xstate.done.actor.commit.RESOLVE_ALL_CONFLICTS.*': [REFUSED, { actions: 'refreshGitStatus' }],
    'xstate.done.actor.commit.REWRITE_COMMIT.*': [
      { guard: ({ event }) => !event.output.ok && event.output.failure.kind === 'published', actions: 'askToRewritePublished' },
      REFUSED,
      { actions: [assign({ pendingRewrite: null, rewording: null }), 'requestLogList', 'takeUndoable'] },
    ],
    'xstate.done.actor.commit.PREVIEW_MERGE.*': [REFUSED, { actions: 'handleMergePreviewed' }],
    // Answered once the flow has the changes: what it makes of them arrives as `commit.MESSAGE_GENERATED`
    'xstate.done.actor.commit.GENERATE_MESSAGE.*': {
      guard: 'refused',
      actions: ['showFailure', assign({ isGeneratingMessage: false })],
    },
    'xstate.done.actor.commit.CREATE_TAG.*': [REFUSED, { actions: ['getAllBranches', 'requestLogList'] }],
    'xstate.done.actor.commit.RENAME_BRANCH.*': [REFUSED, { actions: ['getAllBranches', 'requestLogList'] }],
    // A stash applied leaves the message typed as it is; one popped is gone from the list
    'xstate.done.actor.commit.STASH_APPLY.*': [REFUSED, { actions: ['refreshGitStatus', 'requestStashList'] }],
    'xstate.done.actor.commit.STASH_POP.*': [REFUSED, { actions: ['refreshGitStatus', 'requestStashList'] }],
    'xstate.done.actor.commit.STASH_DROP.*': [REFUSED, { actions: 'takeUndoable' }],
    'xstate.done.actor.commit.STASH_CLEAR.*': [REFUSED, { actions: 'takeUndoable' }],
    'xstate.done.actor.commit.GET_STASH_CHANGES.*': { actions: ['showFailure', 'stashFilesRead'] },
    'xstate.done.actor.commit.REVERT_COMMIT.*': [REFUSED, { actions: ['refreshGitStatus', 'requestLogList'] }],
    'xstate.done.actor.commit.LIST_REPOSITORIES.*': [
      REFUSED,
      { actions: assign({ repositories: ({ event }) => answerTo('commit.LIST_REPOSITORIES', event).repositories }) },
    ],
  },
  states: {
    // The status the panel shows. A read asked for while one is under way replaces it: the one under way is of the
    // repository before whatever asked for this one
    status: {
      initial: 'idle',
      on: {
        'commit.REFRESH_STATUS': { target: '.reading.shown' },
        // A read behind one the user asked for is still the user's, which the panel shows as loading until it is answered
        'commit.READ_STATUS': [
          { guard: stateIn({ status: { reading: 'shown' } }), target: '.reading.shown' },
          { target: '.reading' },
        ],
      },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.GET_GIT_STATUS',
            input: {},
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign({ ...failureShown(event.output.failure), statusFailed: true })
                enqueue.assign(statusShown(context, event.output.value))
                enqueue('followOpenFolders')
              }),
            },
          },
          initial: 'behind',
          states: {
            // Read behind what is shown, which stays as it is until the answer
            behind: {},
            // The read the user asked for, which the panel shows as loading
            shown: {},
          },
        },
      },
    },
    // The history the log shows, a page at a time. A page asked for while one is being read replaces it, which stops
    // git walking the one nobody waits for
    log: {
      initial: 'idle',
      on: {
        'commit.LOG_LIST': { target: '.reading' },
        'commit.LOAD_MORE_LOG': { guard: ({ context }) => context.logCursor !== null, target: '.reading' },
        'commit.SHOW_FILE_HISTORY': {
          target: '.reading',
          actions: assign({ logPath: ({ event }) => event.path, commitLog: [], logCursor: null }),
        },
        'commit.CLEAR_FILE_HISTORY': { target: '.reading', actions: assign({ logPath: null, commitLog: [], logCursor: null }) },
      },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.LOG_LIST',
            // The history the log shows, a file's while it shows one: from its start, or on from the page shown
            input: ({ context, event }) => ({
              ...(event.type === 'commit.LOAD_MORE_LOG' && context.logCursor && { cursor: context.logCursor }),
              ...(context.logPath && { path: context.logPath }),
            }),
            onDone: {
              target: 'idle',
              // A page is added on to the log when it goes on from a cursor, and takes its place otherwise
              actions: assign(({ context, event }) => {
                if (!event.output.ok) return failureShown(event.output.failure)
                const page = event.output.value
                return { commitLog: page.continued ? [...context.commitLog, ...page.commits] : page.commits, logCursor: page.cursor ?? null }
              }),
            },
          },
        },
      },
    },
    // The branches and tags, the stashes and the worktrees: each list is read again when asked for, in place of a
    // read of it still under way
    branches: {
      initial: 'idle',
      on: { 'commit.GET_ALL_BRANCHES': { target: '.reading' } },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.GET_ALL_BRANCHES',
            input: {},
            onDone: {
              target: 'idle',
              actions: assign(({ event }) => {
                if (!event.output.ok) return failureShown(event.output.failure)
                const { tags, standing, branches } = event.output.value
                return { tags: tags ?? [], branchStanding: standing ?? {}, availableBranches: branches }
              }),
            },
          },
        },
      },
    },
    stashes: {
      initial: 'idle',
      on: { 'commit.STASH_LIST': { target: '.reading' } },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.STASH_LIST',
            input: {},
            onDone: {
              target: 'idle',
              // A stash's files are of the stash at its index when they were read: once the list moves, the stash at
              // that index is another, so the files open go and the asks for them are stopped
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                const { stashes } = event.output.value
                if (sameStashes(context.stashList, stashes)) return enqueue.assign({ stashList: stashes })
                for (const id of Object.keys(context.stashFileAsks)) enqueue.stopChild(id)
                enqueue.assign({ stashList: stashes, stashFiles: {}, stashFileAsks: {} })
              }),
            },
          },
        },
      },
    },
    worktrees: {
      initial: 'idle',
      on: { 'commit.WORKTREE_LIST': { target: '.reading' } },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.WORKTREE_LIST',
            input: {},
            onDone: {
              target: 'idle',
              actions: assign(({ event }) => (event.output.ok ? { worktreeList: event.output.value.worktrees } : failureShown(event.output.failure))),
            },
          },
        },
      },
    },
    // A push is under way for exactly as long as `pushing` is: stopping it leaves the state, which ends git and what
    // it started on the backend
    push: {
      initial: 'idle',
      states: {
        idle: {
          on: { 'commit.PUSH_BRANCH': { target: 'pushing', actions: assign({ pushStopped: false }) } },
        },
        pushing: {
          invoke: {
            src: 'commit.PUBLISH_BRANCH',
            input: {},
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? {} : failureShown(event.output.failure))) },
          },
          exit: assign(({ context }) => progressUnless(context, 'push')),
          on: {
            'commit.PUBLISH_BRANCH.progress': { actions: 'hearProgress' },
            // Stopped by the user rather than done, which the panel says instead of "Pushed"
            'commit.STOP_PUSH': { target: 'idle', actions: assign({ pushStopped: true }) },
          },
        },
      },
    },
    pull: {
      initial: 'idle',
      states: {
        idle: {
          on: { 'commit.PULL_BRANCH': { target: 'pulling' } },
        },
        pulling: {
          invoke: {
            src: 'commit.PULL_BRANCH',
            input: {},
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? {} : failureShown(event.output.failure))) },
          },
          exit: assign(({ context }) => progressUnless(context, 'pull')),
          on: { 'commit.PULL_BRANCH.progress': { actions: 'hearProgress' } },
        },
      },
    },
    // Checking out the branch typed, or making it: a checkout that found no branch offers to
    checkout: {
      initial: 'idle',
      on: {
        'commit.CHECKOUT_BRANCH': { guard: ({ context }) => context.branchInput.trim() !== '', target: '.checkingOut' },
        'commit.CREATE_BRANCH': {
          guard: ({ event }) => event.branchName.trim() !== '',
          target: '.creating',
          actions: assign({ gitError: null, gitFailure: null }),
        },
      },
      states: {
        idle: {},
        checkingOut: {
          invoke: {
            src: 'commit.CHECKOUT_BRANCH',
            input: ({ context }) => ({ branchName: context.branchInput.trim() }),
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign({ branchInput: '' })
                enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
              }),
            },
          },
          exit: assign(({ context }) => progressUnless(context, 'checkout')),
          on: { 'commit.CHECKOUT_BRANCH.progress': { actions: 'hearProgress' } },
        },
        creating: {
          invoke: {
            src: 'commit.CREATE_BRANCH',
            input: ({ event }) => ({ branchName: typeOf('commit.CREATE_BRANCH', event).branchName.trim() }),
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign({ branchInput: '' })
                enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
              }),
            },
          },
        },
      },
    },
    // Bringing a submodule to the commit the repository records for it, one at a time
    submodule: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            'commit.UPDATE_SUBMODULE': {
              target: 'updating',
              actions: assign({ updatingSubmodule: ({ event }) => event.path, gitError: null, gitFailure: null }),
            },
          },
        },
        updating: {
          invoke: {
            src: 'commit.UPDATE_SUBMODULE',
            input: ({ event }) => ({ path: typeOf('commit.UPDATE_SUBMODULE', event).path }),
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? {} : failureShown(event.output.failure))) },
          },
          exit: assign(({ context }) => ({ updatingSubmodule: null, ...progressUnless(context, 'submodule') })),
          on: { 'commit.UPDATE_SUBMODULE.progress': { actions: 'hearProgress' } },
        },
      },
    },
    // A commit or an amend, one at a time: another is not asked for until the one under way is answered
    committing: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            // Of the message as written: what the settings say to leave out of it (`trailersRemovedOnCommit`) is left
            // out by the system, which reads its trailers as git does
            'commit.COMMIT': { guard: ({ context }) => context.commitMessage.trim() !== '', target: 'committing' },
            // Kept until it is answered, so the user can go on with it if a remote branch holds the commit
            'commit.AMEND': {
              target: 'amending',
              actions: assign({ pendingRewrite: ({ event }) => event, rewriteConfirmation: null, gitError: null }),
            },
            // The user said to go on with an amend a remote branch holds the commit of
            'commit.CONFIRM_REWRITE': {
              guard: ({ context }) => context.rewriteConfirmation?.request.type === 'commit.AMEND',
              target: 'amending',
              actions: assign(({ context }) => ({
                pendingRewrite: context.rewriteConfirmation ? { ...context.rewriteConfirmation.request, evenIfPublished: true } : null,
                rewriteConfirmation: null,
              })),
            },
          },
        },
        committing: {
          invoke: {
            src: 'commit.COMMIT',
            input: ({ context }) => ({ message: context.commitMessage.trim() }),
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign({ commitMessage: '', selectedGitFile: null, ...undoableAfter(context, event.output.value) })
                enqueue('followTrailers')
                enqueue.raise({ type: 'commit.READ_STATUS' })
              }),
            },
          },
        },
        amending: {
          invoke: {
            src: 'commit.AMEND',
            input: ({ context }) => {
              const request = context.pendingRewrite
              return request?.type === 'commit.AMEND' ? { message: request.message, evenIfPublished: request.evenIfPublished } : {}
            },
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) {
                  const { failure } = event.output
                  // A remote branch already holds the commit: amended only once the user says to go on
                  if (failure.kind === 'published') return enqueue.assign({ rewriteConfirmation: context.pendingRewrite ? { message: failure.message, request: context.pendingRewrite } : null })
                  return enqueue.assign(failureShown(failure))
                }
                enqueue.assign({ pendingRewrite: null, commitMessage: '', ...undoableAfter(context, event.output.value) })
                enqueue('followTrailers')
                enqueue.raise({ type: 'commit.LOG_LIST' })
              }),
            },
          },
        },
      },
    },
    stash: {
      initial: 'idle',
      on: {
        'commit.STASH_PUSH': {
          target: '.stashing',
          // A stash named with the message typed for the commit takes it; one named otherwise leaves it
          actions: assign({ stashTakesMessage: ({ context, event }) => !!event.message && event.message === context.commitMessage }),
        },
      },
      states: {
        idle: {},
        stashing: {
          invoke: {
            src: 'commit.STASH_PUSH',
            input: ({ event }) => {
              const { message, stagedOnly, paths } = typeOf('commit.STASH_PUSH', event)
              return { message, stagedOnly, ...(paths && { paths }) }
            },
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign({ commitMessage: context.stashTakesMessage ? '' : context.commitMessage, stashTakesMessage: false })
                enqueue('followTrailers')
                enqueue.raise({ type: 'commit.READ_STATUS' })
              }),
            },
          },
        },
      },
    },
    // A worktree being added or removed, or the code surface being moved to one
    worktree: {
      initial: 'idle',
      on: {
        'commit.WORKTREE_ADD': { target: '.adding' },
        'commit.WORKTREE_REMOVE': { target: '.removing' },
        'commit.WORKTREE_SWITCH': { target: '.switching' },
      },
      states: {
        idle: {},
        adding: {
          invoke: {
            src: 'commit.WORKTREE_ADD',
            input: ({ event }) => {
              const { path, branch, createBranch } = typeOf('commit.WORKTREE_ADD', event)
              return { path, branch, createBranch }
            },
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.raise({ type: 'commit.WORKTREE_LIST' })
              }),
            },
          },
        },
        removing: {
          invoke: {
            src: 'commit.WORKTREE_REMOVE',
            input: ({ event }) => {
              const { path, force } = typeOf('commit.WORKTREE_REMOVE', event)
              return { path, force }
            },
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.raise({ type: 'commit.WORKTREE_LIST' })
              }),
            },
          },
        },
        // The folder the surface is over moves with the switch, which the surface hears of as its start
        switching: {
          invoke: {
            src: 'commit.WORKTREE_SWITCH',
            input: ({ event }) => ({ path: typeOf('commit.WORKTREE_SWITCH', event).path }),
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? {} : failureShown(event.output.failure))) },
          },
        },
      },
    },
    speedUp: {
      initial: 'idle',
      on: { 'commit.SPEED_UP_STATUS': { target: '.speedingUp' } },
      states: {
        idle: {},
        speedingUp: {
          invoke: {
            src: 'commit.SPEED_UP_STATUS',
            input: {},
            // The status that follows says whether it is still slow
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? { slowStatus: null } : failureShown(event.output.failure))) },
          },
        },
      },
    },
    // Telling the backend git can sign in to the host that asked, now the app is signed in to GitHub
    signIn: {
      initial: 'idle',
      on: { 'commit.SET_UP_SIGN_IN': { target: '.settingUp' } },
      states: {
        idle: {},
        settingUp: {
          invoke: {
            src: 'commit.SET_UP_SIGN_IN',
            // The push or the pull that was refused goes with the ask and comes back with its answer: what is held
            // of it here is cleared by the next status, which can arrive while the sign-in is being set up
            input: ({ context, event }) => {
              const during = context.gitFailure?.during
              return { host: typeOf('commit.SET_UP_SIGN_IN', event).host, ...(during ? { during } : {}) }
            },
            onDone: {
              target: 'idle',
              // Git can sign in now, so the push or the pull that was refused is run again: it is what the user was doing
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                const { during } = event.output.value
                enqueue.assign({ gitError: null, gitFailure: null })
                if (during === 'push') enqueue.raise({ type: 'commit.PUSH_BRANCH' })
                if (during === 'pull') enqueue.raise({ type: 'commit.PULL_BRANCH' })
              }),
            },
          },
        },
      },
    },
    // Git staging one piece of a file's change, or taking one back out of what is staged
    hunk: {
      initial: 'idle',
      on: { 'commit.APPLY_HUNK': { target: '.applying', actions: assign({ gitError: null, gitFailure: null }) } },
      states: {
        idle: {},
        applying: {
          invoke: {
            src: 'commit.APPLY_HUNK',
            input: ({ event }) => {
              const { path, staged, hunk } = typeOf('commit.APPLY_HUNK', event)
              return { path, staged, hunk }
            },
            onDone: {
              target: 'idle',
              // The tab still shows the piece until its diff is read again, and git no longer cuts it
              actions: assign(({ context, event }) => {
                if (!event.output.ok) return failureShown(event.output.failure)
                const applied = event.output.value
                const tab = diffTabPath(applied)
                return { appliedHunks: { ...context.appliedHunks, [tab]: [...(context.appliedHunks[tab] ?? []), applied.hunk] } }
              }),
            },
          },
        },
      },
    },
    // Git carrying on with what it is in the middle of, skipping the commit a rebase stopped at, or giving it up.
    // Where that leaves the repository is in its status, which the backend announces as changed
    moveOperation: {
      initial: 'idle',
      on: { 'commit.MOVE_OPERATION': { target: '.moving', actions: assign({ gitError: null }) } },
      states: {
        idle: {},
        moving: {
          invoke: {
            src: 'commit.MOVE_OPERATION',
            input: ({ event }) => ({ move: typeOf('commit.MOVE_OPERATION', event).move }),
            onDone: { target: 'idle', actions: assign(({ event }) => (event.output.ok ? {} : failureShown(event.output.failure))) },
          },
        },
      },
    },
    // Git merging a branch in, rebasing onto one or picking a commit: one that stops on a conflict shows as in progress
    startOperation: {
      initial: 'idle',
      on: { 'commit.START_OPERATION': { target: '.starting', actions: assign({ gitError: null }) } },
      states: {
        idle: {},
        starting: {
          invoke: {
            src: 'commit.START_OPERATION',
            input: ({ event }) => {
              const { kind, target } = typeOf('commit.START_OPERATION', event)
              return { kind, target }
            },
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign(undoableAfter(context, event.output.value))
                enqueue.raise({ type: 'commit.LOG_LIST' })
              }),
            },
          },
        },
      },
    },
    // Who last changed each line of the file the editor shows blame for. Asking for another file's, or clearing it,
    // leaves the read under way, which stops git reading it
    blame: {
      initial: 'idle',
      on: {
        'commit.SHOW_BLAME': { target: '.reading', actions: assign({ blame: ({ event }) => ({ path: event.path, lines: [] }) }) },
        'commit.CLEAR_BLAME': { target: '.idle', actions: assign({ blame: null }) },
      },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.GET_BLAME',
            input: ({ event }) => ({ path: typeOf('commit.SHOW_BLAME', event).path }),
            onDone: {
              target: 'idle',
              actions: assign(({ event }) => (event.output.ok ? { blame: event.output.value } : { blame: null, ...failureShown(event.output.failure) })),
            },
          },
        },
      },
    },
    // The whole message of the commit being reworded in the history, read as the rewording starts
    reword: {
      initial: 'idle',
      on: {
        'commit.START_REWORD': { target: '.reading', actions: assign({ rewording: ({ event }) => ({ hash: event.hash, message: null }) }) },
        'commit.CANCEL_REWORD': { target: '.idle', actions: assign({ rewording: null }) },
      },
      states: {
        idle: {},
        reading: {
          invoke: {
            src: 'commit.GET_COMMIT_MESSAGE',
            input: ({ event }) => ({ hash: typeOf('commit.START_REWORD', event).hash }),
            onDone: {
              target: 'idle',
              actions: assign(({ event }) => (event.output.ok ? { rewording: event.output.value } : { rewording: null, ...failureShown(event.output.failure) })),
            },
          },
        },
      },
    },
    // The tag being pushed or deleted, which `tagBusy` names until that is answered
    tag: {
      initial: 'idle',
      on: {
        'commit.PUSH_TAG': { target: '.pushing', actions: assign({ tagBusy: ({ event }) => ({ name: event.name, action: 'push' as const }) }) },
        'commit.DELETE_TAG': { target: '.deleting', actions: assign({ tagBusy: ({ event }) => ({ name: event.name, action: 'delete' as const }) }) },
      },
      states: {
        idle: {},
        pushing: {
          invoke: {
            src: 'commit.PUSH_TAG',
            input: ({ event }) => ({ name: typeOf('commit.PUSH_TAG', event).name }),
            onDone: {
              target: 'idle',
              // The tag last pushed, a new object each time, which the panel says it pushed
              actions: assign(({ event }) => (event.output.ok ? { tagPushed: { name: event.output.value.name } } : failureShown(event.output.failure))),
            },
          },
          exit: assign({ tagBusy: null }),
        },
        deleting: {
          invoke: {
            src: 'commit.DELETE_TAG',
            input: ({ event }) => ({ name: typeOf('commit.DELETE_TAG', event).name }),
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.raise({ type: 'commit.GET_ALL_BRANCHES' })
                enqueue.raise({ type: 'commit.LOG_LIST' })
              }),
            },
          },
          exit: assign({ tagBusy: null }),
        },
      },
    },
    // The branch being reset to a commit, which `resettingTo` names until that is answered
    reset: {
      initial: 'idle',
      on: { 'commit.RESET_TO_COMMIT': { target: '.resetting', actions: assign({ resettingTo: ({ event }) => event.hash }) } },
      states: {
        idle: {},
        resetting: {
          invoke: {
            src: 'commit.RESET_TO_COMMIT',
            input: ({ event }) => ({ hash: typeOf('commit.RESET_TO_COMMIT', event).hash }),
            onDone: {
              target: 'idle',
              actions: enqueueActions(({ context, event, enqueue }) => {
                if (!event.output.ok) return enqueue.assign(failureShown(event.output.failure))
                enqueue.assign(undoableAfter(context, event.output.value))
                enqueue.raise({ type: 'commit.READ_STATUS' })
                enqueue.raise({ type: 'commit.LOG_LIST' })
              }),
            },
          },
          exit: assign({ resettingTo: null }),
        },
      },
    },
  },
});

/** The commit child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CommitActor = ActorRefFrom<typeof commitState>;
