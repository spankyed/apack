import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { answersCall, newCall, recordCall, settleCall } from '@apackdev/sdk/events';
import { viewWrites, writeAnswered, writeSent, writing, type ViewWrites } from '@apackdev/sdk/fe';
import { sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { diffTab, diffTabPath } from '../../utils/diff-tabs.ts';
import { withStaged, withUnstaged } from 'apack-git/staging';
import type { ChangedFile, CommitFailure, ConflictKind, LineCount, DiffHunk, DiscardKept, DiscardRestored, GitProgress, OperationMove, RepositoryChange, RepositoryOperation, SignInHelp } from '../../../be/types.ts';
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
  /** The files of the stashes opened in the list, by index, read without applying them */
  stashFiles: Record<number, ChangedFile[]>
  /** The repositories under the folder the user opened, which the picker lists when there is more than one */
  repositories: { path: string; relative: string; kind: 'top' | 'nested' | 'submodule' | 'worktree' }[]
  /** The last write here that Undo takes back, as the repository's journal names it, until it is dismissed */
  lastUndoable: { id: string; summary: string } | null
  /** Why the last write is not taken back without asking: a commit already on a remote branch */
  undoConfirmation: string | null
  /** What undoing a discard left as it was, because it had changed or been made again since */
  discardLeft: string[]
  /** The folder what is held here was read from: the code surface's, as of the last time it started */
  directory: string
  availableBranches: string[]
  branchInput: string
  isCheckingOutBranch: boolean
  hasUpstream: boolean
  commitsAhead: number
  commitsBehind: number
  /** Whether the repository has more changed files than `gitStatus` lists */
  isStatusTruncated: boolean
  /** Whether the backend's file watches on this repository are open; without them the panel changes only when asked */
  isWatchingRepository: boolean
  /** What git is in the middle of in this repository: a merge, a rebase, a cherry-pick or a revert stopped part-way */
  operation: RepositoryOperation | null
  /** Whether git was asked to move that on and has not answered */
  isMovingOperation: boolean
  /** Whether fetching by itself has stopped: what is shown of the remote is as old as the last fetch that worked */
  isFetchSuspended: boolean
  /** What can be done about the sign-in the remote asked for when fetching stopped */
  fetchSignIn: SignInHelp | null
  /** What is known of the failure `gitError` words: the command to run again, and the sign-in a remote asked for */
  gitFailure: Pick<CommitFailure, 'code' | 'during' | 'signIn' | 'trust' | 'ownership'> | null
  /** Whether the GitHub CLI was asked to give git its sign-in and has not answered */
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
  /** The pieces staged or unstaged since a diff was last read: still in the open tab's diff, and no longer there to act on */
  appliedHunks: string[]
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
  /** The asks in flight for a diff that is already open, by call: the answer to one brings its tab up to date and opens none */
  diffRefreshes: Record<string, true>
  /** The latest ask for the status, while it is unanswered: an answer to an earlier one is of the repository before it */
  statusAsk: string | null
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

/** An ask for a diff that is already open */
const diffRefresh = (file: { path: string; staged: boolean }) => {
  const call = newCall()
  return {
    record: ({ context }: { context: CodeCommitContext }) => ({ diffRefreshes: recordCall(context.diffRefreshes, call, true as const) }),
    ask: () => { sendToSystem('code', { type: 'commit.GET_GIT_DIFF', path: file.path, staged: file.staged }, { call }) },
  }
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
  | { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; counts?: LineCount[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation; fetchSuspended?: boolean } }
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
  | { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[] } }
  | { type: 'commit.BRANCH_CHECKOUT_SUCCESS'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PUSHED'; data: { branchName: string } }
  | { type: 'commit.STOP_PUSH' }
  | { type: 'commit.PUSH_STOPPED' }
  | { type: 'commit.BRANCH_PULLED'; data: { branchName: string } }
  | { type: 'commit.DISMISS_ERROR' }
  | { type: 'commit.GENERATE_MESSAGE' }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  | { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }
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

/** The fields of the panel's state that are read from a repository */
type OfOneFolder =
  | 'gitStatus'
  | 'gitBranch'
  | 'gitError'
  | 'selectedGitFile'
  | 'revertDialogFile'
  | 'discardPreview'
  | 'lastDiscard'
  | 'lineCounts'
  | 'stashFiles'
  | 'repositories'
  | 'lastUndoable'
  | 'undoConfirmation'
  | 'discardLeft'
  | 'availableBranches'
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
 */
const ofNoFolder = (): Pick<CodeCommitContext, OfOneFolder> => ({
  gitStatus: [],
  gitBranch: '',
  gitError: null,
  selectedGitFile: null,
  revertDialogFile: null,
  discardPreview: null,
  lastDiscard: null,
  lineCounts: {},
  stashFiles: {},
  repositories: [],
  lastUndoable: null,
  undoConfirmation: null,
  discardLeft: [],
  availableBranches: [],
  branchInput: '',
  hasUpstream: true,
  commitsAhead: 0,
  commitsBehind: 0,
  isStatusTruncated: false,
  operation: null,
  isFetchSuspended: false,
  fetchSignIn: null,
  gitFailure: null,
  appliedHunks: [],
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
  log: (call: string) => { sendToSystem('code', { type: 'commit.LOG_LIST' }, { call }) },
}
type RepositoryList = keyof typeof LIST_ASKS

/**
 * An ask for each of these lists under a call of its own: what to hold as the latest ask of each, and the sends.
 * Only the answer to the latest ask of a list is shown. An answer to an earlier one is dropped: the folder may
 * have changed since it was asked, and the backend answers every ask.
 */
/** Asks for a page of the log as the ask of the log, so its answer is the one the log takes */
function askLogPage(
  context: CodeCommitContext,
  enqueue: { assign: (values: Partial<CodeCommitContext>) => void } & ((action: () => void) => void),
  ask: { cursor?: string; path?: string | null },
): void {
  const call = newCall()
  enqueue.assign({ listAsks: { ...context.listAsks, log: call } })
  enqueue(() => sendToSystem('code', { type: 'commit.LOG_LIST', ...(ask.cursor && { cursor: ask.cursor }), ...(ask.path && { path: ask.path }) }, { call }))
}

function listAsks(lists: readonly RepositoryList[]) {
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
      fetchSignIn: ({ event }) => (event as { data: { signIn?: SignInHelp } }).data.signIn ?? null,
      isGitLoading: false,
      gitError: null,
      gitFailure: null
    }),

    handleErrorReceived: assign({
      gitError: ({ event }) => {
        const ev = event as { type: 'commit.ERROR_RECEIVED'; data: CommitFailure }
        return ev.data.message
      },
      gitFailure: ({ event }) => {
        const { code, during, signIn, trust, ownership } = (event as { type: 'commit.ERROR_RECEIVED'; data: CommitFailure }).data
        return { code, during, signIn, trust, ownership }
      },
      isSettingUpSignIn: false,
      isApplyingHunk: false,
      progress: null,
      isGitLoading: false,
      isCheckingOutBranch: false,
      isPushing: false,
      isPulling: false,
      isGeneratingMessage: false,
      isMovingOperation: false
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
      enqueue.assign({ isApplyingHunk: true, gitError: null, gitFailure: null })
      enqueue(() => { sendToSystem('code', { type: 'commit.APPLY_HUNK', path, staged, hunk }) })
    }),

    /** Has the GitHub CLI give git its sign-in for the host that asked */
    setUpSignIn: enqueueActions(({ context, event, enqueue }) => {
      const { host } = event as { type: 'commit.SET_UP_SIGN_IN'; host: string }
      // The push or the pull that was refused goes with the ask and comes back with its answer: what is held
      // of it here is cleared by the next status, which can arrive while the sign-in is being set up
      const during = context.gitFailure?.during
      enqueue.assign({ isSettingUpSignIn: true })
      enqueue(() => { sendToSystem('code', { type: 'commit.SET_UP_SIGN_IN', host, ...(during ? { during } : {}) }) })
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
      enqueue.assign({ isMovingOperation: true, gitError: null })
      enqueue(() => { sendToSystem('code', { type: 'commit.MOVE_OPERATION', move }) })
    }),

    // Where that left the repository is in its status, which the backend announces as changed
    handleOperationMoved: assign({ isMovingOperation: false }),

    requestGenerateMessage: () => {
      sendToSystem('code', { type: 'commit.GENERATE_MESSAGE' })
    },

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
      // A diff as it is now holds none of the pieces that were staged out of the one before it
      if (context.appliedHunks.length > 0) enqueue.assign({ appliedHunks: [] })
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

    checkoutBranch: ({ context }) => {
      if (context.branchInput.trim()) {
        sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName: context.branchInput.trim() })
      }
    },

    setCheckingOutBranch: assign({ isCheckingOutBranch: true }),

    handleBranchesReceived: assign({
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

    pushBranch: () => {
      sendToSystem('code', { type: 'commit.PUBLISH_BRANCH' })
    },

    setPushing: assign({ isPushing: true }),

    handleBranchPushed: assign({
      isPushing: false,
      progress: null
    }),

    pullBranch: () => {
      sendToSystem('code', { type: 'commit.PULL_BRANCH' })
    },

    setPulling: assign({ isPulling: true }),

    handleBranchPulled: assign({
      isPulling: false,
      progress: null
    }),

    handleCodeStartup: enqueueActions(({ context, enqueue, self }) => {
      const directory: string = getParentContext(self)?.baseDirectory || ''
      // What the panel holds is one folder's (`ofNoFolder`), and says nothing about another: it goes when the
      // folder is another one
      if (directory !== context.directory) enqueue.assign({ directory, ...ofNoFolder() })
      if (directory) {
        // Refresh git status when directory is available
        self.send({ type: 'commit.REFRESH_STATUS' })
        // The repositories under the folder the user opened, for the picker
        enqueue(() => sendToSystem('code', { type: 'LIST_REPOSITORIES' }))
        const { asks, send } = listAsks(['stashes', 'worktrees', 'branches', 'log'])
        enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
        enqueue(send)
      }
    }),

    stashPush: ({ event }) => {
      const ev = event as { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }
      sendToSystem('code', { type: 'commit.STASH_PUSH', message: ev.message, stagedOnly: ev.stagedOnly })
    },

    setStashing: assign({ isStashing: true }),

    requestStashList: enqueueActions(({ context, enqueue }) => {
      const { asks, send } = listAsks(['stashes'])
      enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
      enqueue(send)
    }),

    handleStashListReceived: assign({
      stashList: ({ event }) => {
        const ev = event as { type: 'commit.STASH_LIST_RECEIVED'; data: { stashes: StashEntry[] } }
        return ev.data.stashes
      }
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

    worktreeAdd: ({ event }) => {
      const ev = event as { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
      sendToSystem('code', { type: 'commit.WORKTREE_ADD', path: ev.path, branch: ev.branch, createBranch: ev.createBranch })
    },

    worktreeRemove: ({ event }) => {
      const ev = event as { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
      sendToSystem('code', { type: 'commit.WORKTREE_REMOVE', path: ev.path, force: ev.force })
    },

    worktreeSwitch: ({ event }) => {
      const ev = event as { type: 'commit.WORKTREE_SWITCH'; path: string }
      sendToSystem('code', { type: 'commit.WORKTREE_SWITCH', path: ev.path })
    },

    setWorktreeLoading: assign({ isWorktreeLoading: true }),

    handleWorktreeAdded: assign({ isWorktreeLoading: false }),

    handleWorktreeRemoved: assign({ isWorktreeLoading: false }),

    requestLogList: enqueueActions(({ context, enqueue }) => {
      const { asks, send } = listAsks(['log'])
      enqueue.assign({ listAsks: { ...context.listAsks, ...asks } })
      enqueue(send)
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
    statusAsk: null,
    listAsks: { branches: null, stashes: null, worktrees: null, log: null },
    stagingWrites: viewWrites(),
    isGitLoading: false,
    commitMessage: '',
    directory: '',
    isCheckingOutBranch: false,
    isWatchingRepository: true,
    isMovingOperation: false,
    isSettingUpSignIn: false,
    isApplyingHunk: false,
    isShown: false,
    progress: null,
    isPushing: false,
    isPulling: false,
    isGeneratingMessage: false,
    isStashing: false,
    isWorktreeLoading: false,
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
          actions: assign(({ context, event }) => ({
            isApplyingHunk: false,
            appliedHunks: [...context.appliedHunks, (event as { data: { hunk: string } }).data.hunk],
          }))
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
              enqueue(() => sendToSystem('code', { type: 'commit.GET_STASH_CHANGES', index }))
            }
          }),
        },
        'commit.STASH_CHANGES_RECEIVED': {
          actions: assign({
            stashFiles: ({ context, event }) => {
              const { index, files } = (event as { type: 'commit.STASH_CHANGES_RECEIVED'; data: { index: number; files: ChangedFile[] } }).data
              return { ...context.stashFiles, [index]: files }
            },
          }),
        },
        'commit.LOAD_MORE_LOG': {
          actions: enqueueActions(({ context, enqueue }) => {
            if (context.logCursor) askLogPage(context, enqueue, { cursor: context.logCursor, path: context.logPath })
          }),
        },
        'commit.SHOW_FILE_HISTORY': {
          actions: enqueueActions(({ context, enqueue, event }) => {
            const { path } = event as { type: 'commit.SHOW_FILE_HISTORY'; path: string }
            enqueue.assign({ logPath: path, commitLog: [], logCursor: null })
            askLogPage(context, enqueue, { path })
          }),
        },
        'commit.CLEAR_FILE_HISTORY': {
          actions: enqueueActions(({ context, enqueue }) => {
            enqueue.assign({ logPath: null, commitLog: [], logCursor: null })
            askLogPage(context, enqueue, {})
          }),
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
          actions: ['setCheckingOutBranch', 'checkoutBranch']
        },
        'commit.BRANCHES_RECEIVED': {
          guard: 'answersTheBranchesAsked',
          actions: 'handleBranchesReceived'
        },
        'commit.BRANCH_CHECKOUT_SUCCESS': {
          actions: ['handleBranchCheckoutSuccess', 'getAllBranches']
        },
        'commit.PUSH_BRANCH': {
          actions: ['setPushing', 'pushBranch']
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
          actions: ['setPulling', 'pullBranch']
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
          actions: ['setStashing', 'stashPush']
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
          actions: ['setWorktreeLoading', 'worktreeAdd']
        },
        'commit.WORKTREE_REMOVE': {
          actions: ['setWorktreeLoading', 'worktreeRemove']
        },
        'commit.WORKTREE_SWITCH': {
          actions: ['setWorktreeLoading', 'worktreeSwitch']
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
