import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { answersCall, newCall, recordCall, settleCall } from '@apackdev/sdk/events';
import { viewWrites, writeAnswered, writeSent, writing, type ViewWrites } from '@apackdev/sdk/fe';
import { sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { diffTab, diffTabPath } from '../../utils/diff-tabs.ts';
import { withStaged, withUnstaged } from './staging.ts';
import type { ConflictKind, OperationMove, RepositoryChange, RepositoryOperation } from '../../../be/types.ts';
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
}

export interface GitDiff {
  path: string
  staged: boolean
  originalContent?: string
  modifiedContent?: string
  isImage?: boolean
}

export interface CodeCommitContext {
  gitStatus: GitStatusFile[]
  gitBranch: string
  gitError: string | null
  isGitLoading: boolean
  selectedGitFile: GitStatusFile | null
  commitMessage: string
  revertDialogFile: GitStatusFile | null
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
  isPushing: boolean
  isPulling: boolean
  isGeneratingMessage: boolean
  stashList: StashEntry[]
  isStashing: boolean
  worktreeList: WorktreeEntry[]
  isWorktreeLoading: boolean
  commitLog: CommitLogEntry[]
  /** The asks in flight for a diff that is already open, by call: the answer to one brings its tab up to date and opens none */
  diffRefreshes: Record<string, true>
  /** The latest ask for the status, while it is unanswered: an answer to an earlier one is of the repository before it */
  statusAsk: string | null
  /** The stage and unstage writes still unanswered. The list shows them done, so no status is shown until they are answered */
  stagingWrites: ViewWrites
}

/** The diffs of this repository's changed files that the window has open */
const openDiffs = (self: unknown): OpenFile[] =>
  ((getParentContext(self)?.openFiles ?? []) as OpenFile[]).filter(file => file.isDiff && file.gitFile && !file.isPrDiff)

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
  | { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
  | { type: 'commit.DIFF_RECEIVED'; data: GitDiff }
  | { type: 'commit.FILES_STAGED'; paths: string[] }
  | { type: 'commit.FILES_UNSTAGED'; paths: string[] }
  | { type: 'commit.COMMIT_SUCCESS'; message: string }
  | { type: 'commit.FILE_REVERTED'; path: string }
  | { type: 'commit.FILES_REVERTED'; paths: string[] }
  | { type: 'commit.ERROR_RECEIVED'; data: { message: string } }
  | { type: 'commit.BRANCHES_RECEIVED'; data: { branches: string[] } }
  | { type: 'commit.BRANCH_CHECKOUT_SUCCESS'; data: { branchName: string } }
  | { type: 'commit.BRANCH_PUSHED'; data: { branchName: string } }
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
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.LOG_LIST_RECEIVED'; data: { commits: CommitLogEntry[] } }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'commit.REVERT_COMMIT_SUCCESS'; data: { hash: string } }
  | { type: 'commit.RESET_COMMIT_SUCCESS'; data: { hash: string } }
  | { type: 'CODE_STARTED' }
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange };

export const commitState = setup({
  types: {
    context: {} as CodeCommitContext,
    events: {} as Event
  },
  guards: {
    answersADiffRefresh: ({ context, event }) => settleCall(context.diffRefreshes, event).recorded !== undefined,
    answersTheStatusAsked: ({ context, event }) => answersCall(event, context.statusAsk),
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
    followRepositoryChange: enqueueActions(({ event, self, enqueue }) => {
      const { changed } = event as { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
      if (changed.status) enqueue('refreshGitStatus')
      if (changed.history) enqueue('requestLogList')
      if (changed.stashes) enqueue('requestStashList')
      if (changed.worktrees) enqueue('requestWorktreeList')
      if (!changed.diffs) return
      // A diff is read when its tab opens, so one left open is of the file as it was until it is read again
      for (const { gitFile } of openDiffs(self)) {
        if (changed.files && !changed.files.includes(gitFile!.path)) continue
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

    toggleRevertDialog: assign({
      revertDialogFile: ({ event }) => {
        const ev = event as { type: 'commit.TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
        return ev.file || null
      }
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
      gitStatus: ({ context, event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        // Read before a write that the list already shows landed: git is asked again once that write is answered
        return writing(context.stagingWrites) ? context.gitStatus : ev.data.files
      },
      gitBranch: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.branch
      },
      hasUpstream: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.hasUpstream
      },
      commitsAhead: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.commitsAhead
      },
      commitsBehind: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.commitsBehind
      },
      isStatusTruncated: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.truncated
      },
      isWatchingRepository: ({ event }) => {
        const ev = event as { type: 'commit.STATUS_RECEIVED'; data: { files: GitStatusFile[]; truncated: boolean; branch: string; hasUpstream: boolean; commitsAhead: number; commitsBehind: number; watching: boolean; operation?: RepositoryOperation } }
        return ev.data.watching
      },
      operation: ({ event }) => (event as { data: { operation?: RepositoryOperation } }).data.operation ?? null,
      isGitLoading: false,
      gitError: null
    }),

    handleErrorReceived: assign({
      gitError: ({ event }) => {
        const ev = event as { type: 'commit.ERROR_RECEIVED'; data: { message: string } }
        return ev.data.message
      },
      isGitLoading: false,
      isCheckingOutBranch: false,
      isPushing: false,
      isPulling: false,
      isGeneratingMessage: false,
      isMovingOperation: false
    }),

    dismissError: assign({ gitError: null }),

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
      if (!recorded) {
        enqueue(() => addTabToParent(self, diffTab(ev.data)))
        return
      }
      enqueue.assign({ diffRefreshes: pending })
      enqueue(() => sendEventToParent(self, { type: 'REFRESH_DIFF_TAB', diff: ev.data }))
    }),

    getAllBranches: () => {
      sendToSystem('code', { type: 'commit.GET_ALL_BRANCHES' })
    },

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
      isCheckingOutBranch: false
    }),

    pushBranch: () => {
      sendToSystem('code', { type: 'commit.PUBLISH_BRANCH' })
    },

    setPushing: assign({ isPushing: true }),

    handleBranchPushed: assign({
      isPushing: false
    }),

    pullBranch: () => {
      sendToSystem('code', { type: 'commit.PULL_BRANCH' })
    },

    setPulling: assign({ isPulling: true }),

    handleBranchPulled: assign({
      isPulling: false
    }),

    handleCodeStartup: ({ self }) => {
      // Check if we have a directory from parent context
      const parentContext = getParentContext(self)
      if (parentContext?.baseDirectory) {
        // Refresh git status when directory is available
        self.send({ type: 'commit.REFRESH_STATUS' })
        sendToSystem('code', { type: 'commit.STASH_LIST' })
        sendToSystem('code', { type: 'commit.WORKTREE_LIST' })
        sendToSystem('code', { type: 'commit.GET_ALL_BRANCHES' })
        sendToSystem('code', { type: 'commit.LOG_LIST' })
      }
    },

    stashPush: ({ event }) => {
      const ev = event as { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }
      sendToSystem('code', { type: 'commit.STASH_PUSH', message: ev.message, stagedOnly: ev.stagedOnly })
    },

    setStashing: assign({ isStashing: true }),

    requestStashList: () => {
      sendToSystem('code', { type: 'commit.STASH_LIST' })
    },

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

    requestWorktreeList: () => {
      sendToSystem('code', { type: 'commit.WORKTREE_LIST' })
    },

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

    requestLogList: () => {
      sendToSystem('code', { type: 'commit.LOG_LIST' })
    },

    handleLogListReceived: assign({
      commitLog: ({ event }) => {
        const ev = event as { type: 'commit.LOG_LIST_RECEIVED'; data: { commits: CommitLogEntry[] } }
        return ev.data.commits
      }
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
    stagingWrites: viewWrites(),
    gitStatus: [],
    gitBranch: '',
    gitError: null,
    isGitLoading: false,
    selectedGitFile: null,
    commitMessage: '',
    revertDialogFile: null,
    availableBranches: [],
    branchInput: '',
    isCheckingOutBranch: false,
    hasUpstream: true,
    commitsAhead: 0,
    commitsBehind: 0,
    isStatusTruncated: false,
    isWatchingRepository: true,
    operation: null,
    isMovingOperation: false,
    isPushing: false,
    isPulling: false,
    isGeneratingMessage: false,
    stashList: [],
    isStashing: false,
    worktreeList: [],
    isWorktreeLoading: false,
    commitLog: []
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
          actions: 'handleStatusReceived'
        },
        'commit.ERROR_RECEIVED': [
          // Nobody asked for a diff that was read again, so its failing is said to nobody: the tab stays as it was
          { guard: 'answersADiffRefresh', actions: 'forgetDiffRefresh' },
          { actions: ['handleErrorReceived', 'settleRefusedStaging'] },
        ],
        'commit.DISMISS_ERROR': {
          actions: 'dismissError'
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
          actions: ['handleFileReverted', 'refreshGitStatus']
        },
        'commit.FILES_REVERTED': {
          actions: 'refreshGitStatus'
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
        }
      }
    }
  }
});

/** The commit child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CommitActor = ActorRefFrom<typeof commitState>;
