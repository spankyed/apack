import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { sendToSystem } from '#generated/events.ts';
import type { GitStatusFile, GitDiff } from '../commit/state.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread } from '#generated/types.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { untypedOpenSurface } from '@apackdev/sdk/fe'
import { resolveName } from '@apackdev/sdk/ids'

const HOST_SETTINGS = resolveName('settings', 'host');
import { getCommentDatabaseId } from './comment-id.ts';

export type { GhPullRequest, GhPRComment }

let placeholderIdCounter = -1

/**
 * What a diff was asked for, as a key: GitHub's own `base...head` compare spelling, with the head absent
 * for a branch that has no PR.
 *
 * **A key, not a staleness check, and the difference is load-bearing.** A diff is a view fetching data, and
 * the rule for that job is a slot keyed by what was asked (`packages/default-setup/CLAUDE.md`): a late or
 * another window's answer writes its own key, the view reads the key it is showing, and correlation is
 * structural rather than checked. A check cannot do it here — the branch-only asker's answers carry no head,
 * since a branch with no PR compares against none, so any comparison of the answer's refs has to admit one
 * with the head missing. Two PRs onto one base, the ordinary case, then let a branch diff land as a PR's
 * files. A key either matches or it does not, and there is no permissive branch to leave open.
 */
export const refKey = (base: string, head?: string): string => `${base}...${head ?? ''}`

/** The same, for one file within that comparison — a file diff opens a tab, so it is tracked per request */
export const fileKey = (base: string, head: string | undefined, path: string): string =>
  `${refKey(base, head)}#${path}`

const defaultLoadingStates = {
  isPrLoading: false,
  isGhChecking: false,
  isCreating: false,
  isMerging: false,
  isClosing: false,
  isTogglingDraft: false,
  isDeletingBranch: false,
  isUpdatingPR: false,
  isLoadingDetails: false,
  isLoadingPRs: false,
  inflightMutations: 0,
}

export interface ActiveTokenInfo {
  source: 'GITHUB_TOKEN' | 'keyring' | 'unknown'
  kind: 'fine-grained-pat' | 'classic-pat' | 'oauth' | 'unknown'
  prefix: string
}

export interface CodePullRequestContext {
  // Branch comparison
  /**
   * The files each comparison holds, keyed by `refKey` — the answer's own slot rather than one shared
   * slot every answer overwrites. Reading it is `refKey(prBaseBranch, selectedPR?.headRefName)`, the
   * comparison the view is on, so an answer for any other lands without being seen.
   *
   * It doubles as a cache, as `explorer`'s `dirContents` does: `needsDiff` asks whether *these* files are
   * held rather than whether any are, which is the question a single slot could not ask.
   */
  diffsByRef: Record<string, GitStatusFile[]>
  /**
   * File diffs asked for and not yet handled, keyed by `fileKey`.
   *
   * A key alone is not enough for this one: its answer **opens a tab**, and a key decides which row to
   * write, not whether there should be one — the limit `packages/default-setup/CLAUDE.md` names for a
   * slot that is also a membership list or drives navigation. So the tab opens only for a diff this
   * machine asked for, once.
   */
  inFlightFileDiffs: Set<string>
  prBaseBranch: string
  prError: string | null
  isPrLoading: boolean
  selectedPrFile: GitStatusFile | null

  // GitHub PR state
  openPRs: GhPullRequest[]
  selectedPR: GhPullRequest | null
  branchPR: GhPullRequest | null
  prComments: GhPRComment[]
  reviewThreads: GhReviewThread[]
  commentTab: 'discussion' | 'reviews'
  viewMode: 'files' | 'pr'
  isGhAvailable: boolean
  prAccess: boolean
  activeToken: ActiveTokenInfo | null
  isGhChecking: boolean
  branchPRCheckFailed: boolean
  prCheckCompleted: boolean
  /**
   * True once we've ever received a pr.GH_AUTH_CHECKED response. Used to gate the
   * "GitHub CLI not available" banner so the default `isGhAvailable: false` initial
   * state doesn't flash before the first auth check resolves.
   */
  authCheckCompleted: boolean

  // Create form
  createTitle: string
  createBody: string
  createBaseBranch: string
  createDraft: boolean

  // Loading states
  isLoadingPRs: boolean
  isCreating: boolean
  isMerging: boolean
  isClosing: boolean
  isTogglingDraft: boolean
  isDeletingBranch: boolean
  isUpdatingPR: boolean
  /**
   * Number of in-flight optimistic comment / thread mutations. Increments when any
   * create/edit/delete/reply/resolve/unresolve is sent; decrements on each success.
   * A single boolean caused double-submit when ops of different types overlapped —
   * the first success would unlock the submit button for all in-flight ops.
   */
  inflightMutations: number
  isLoadingDetails: boolean
  diffStale: boolean

  // PR selection tracking
  isManualPRSelection: boolean
  /**
   * PR number the user just requested via the dropdown, cleared once we accept a
   * matching pr.PR_DETAILS_RECEIVED. Distinct from isManualPRSelection (which
   * controls branch-PR-checked pinning behavior) — this one ensures late details
   * responses for unrelated PRs can't sneak past the PR-number guard while a
   * manual selection is pending or has completed.
   */
  pendingManualPRNumber: number | null

  // Optimistic update rollback
  _commentSnapshot: GhPRComment[] | null
  _threadSnapshot: GhReviewThread[] | null

  /**
   * The newest `fetchedAt` accepted per PR number, so a slow fetch cannot overwrite fresher data when two
   * overlap for the same PR (a 6s base-change retry colliding with a manual refresh mid-flight).
   *
   * It is compared against a clock rather than a sequence for a reason this side makes plain: this context
   * outlives the backend, so anything reset by an API restart or a pack reload would read as older here
   * forever after.
   */
  latestPrDetailsFetchedAt: Record<number, number>
}

export type Event =
  // Branch comparison
  | { type: 'pr.REFRESH_STATUS' }
  | { type: 'pr.SELECT_FILE'; file: GitStatusFile }
  | { type: 'pr.VIEW_DIFF'; path: string }
  | { type: 'pr.ERROR'; message: string }
  | { type: 'pr.BASE_BRANCH_RECEIVED'; data: { branch: string } }
  | { type: 'pr.BRANCH_DIFF_RECEIVED'; data: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
  | { type: 'pr.FILE_DIFF_RECEIVED'; data: GitDiff & { baseBranch: string; headBranch?: string } }
  | { type: 'pr.OPEN_FILE'; file: GitStatusFile }
  | { type: 'pr.STATUS_CHANGED'; data: { timestamp: Date } }
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }
  | { type: 'CODE_STARTED' }
  // GitHub PR events from backend
  | { type: 'pr.GH_AUTH_CHECKED'; data: { available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null } }
  | { type: 'pr.NAVIGATE_TO_HELP' }
  | { type: 'pr.OPEN_PRS_RECEIVED'; data: { prs: GhPullRequest[] } }
  | { type: 'pr.PR_DETAILS_RECEIVED'; data: { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number } }
  | { type: 'pr.PR_CREATED'; data: { pr: GhPullRequest } }
  | { type: 'pr.PR_MERGED'; data: { number: number } }
  | { type: 'pr.PR_CLOSED'; data: { number: number } }
  | { type: 'pr.PR_DRAFT_TOGGLED'; data: { number: number; isDraft: boolean } }
  | { type: 'pr.BRANCH_PR_CHECKED'; data: { pr: GhPullRequest | null } }
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
  | { type: 'pr.AUTOFILL_RECEIVED'; data: { title: string; body: string } }
  // User actions
  | { type: 'pr.LIST_PRS' }
  | { type: 'pr.SELECT_PR_BY_NUMBER'; number: number }
  | { type: 'pr.SWITCH_TO_PR_BRANCH'; branchName: string }
  | { type: 'pr.SET_VIEW_MODE'; mode: 'files' | 'pr' }
  | { type: 'pr.NEW_PR' }
  | { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
  | { type: 'pr.SUBMIT_CREATE' }
  | { type: 'pr.SUBMIT_CREATE_DRAFT' }
  | { type: 'pr.MERGE'; method?: 'merge' | 'squash' | 'rebase' }
  | { type: 'pr.CLOSE' }
  | { type: 'pr.TOGGLE_DRAFT' }
  | { type: 'pr.DELETE_BRANCH' }
  | { type: 'pr.CHECKOUT_BASE' }
  | { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
  | { type: 'pr.CREATE_COMMENT'; number: number; body: string }
  | { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_COMMENT'; commentId: number }
  | { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
  | { type: 'pr.RESOLVE_THREAD'; threadId: string }
  | { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
  | { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
  | { type: 'pr.SET_COMMENT_TAB'; tab: 'discussion' | 'reviews' }
  | { type: 'pr.REFRESH_PR'; number: number }
  | { type: 'pr.BACK_TO_BRANCH' }
  | { type: 'pr.CLEAR_ERROR' };

export const pullRequestState = setup({
  types: {
    context: {} as CodePullRequestContext,
    events: {} as Event
  },
  actions: {
    refreshPrStatus: ({ self }) => {
      const parentContext = getParentContext(self)
      if (!parentContext?.baseDirectory) {
        return
      }
      sendToSystem('code', { type: 'pr.LIST_OPEN_PRS' })
      sendToSystem('code', { type: 'pr.CHECK_BRANCH_PR' })
    },

    selectPrFile: assign({
      selectedPrFile: ({ event }) => {
        const ev = event as { type: 'pr.SELECT_FILE'; file: GitStatusFile }
        return ev.file
      }
    }),

    /** Arms the key before sending, so an answer that arrives at once is not one nothing asked for */
    viewPrDiff: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.VIEW_DIFF'; path: string }
      const head = context.selectedPR?.headRefName
      enqueue.assign({
        inFlightFileDiffs: new Set(context.inFlightFileDiffs).add(fileKey(context.prBaseBranch, head, ev.path)),
      })
      enqueue(() => sendToSystem('code', {
        type: 'pr.GET_BRANCH_FILE_DIFF',
        path: ev.path,
        baseBranch: context.prBaseBranch,
        headBranch: head,
      }))
    }),

    assignPrError: assign({
      prError: ({ event }) => {
        const ev = event as { type: 'pr.ERROR'; message: string }
        return ev.message
      },
      ...defaultLoadingStates,
      // Only mark branch PR check as failed if we don't already have a selected PR
      // (otherwise a comment/mutation error would hide the PR selector)
      branchPRCheckFailed: ({ context }) => !context.selectedPR,
      // Rollback optimistic updates
      prComments: ({ context }) => context._commentSnapshot ?? context.prComments,
      reviewThreads: ({ context }) => context._threadSnapshot ?? context.reviewThreads,
      _commentSnapshot: null,
      _threadSnapshot: null,
    }),

    handleBaseBranchReceived: assign({
      prBaseBranch: ({ event }) => {
        const ev = event as { type: 'pr.BASE_BRANCH_RECEIVED'; data: { branch: string } }
        return ev.data.branch
      },
      prError: null
    }),

    handleSmartBaseBranchReceived: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.SMART_BASE_BRANCH_RECEIVED'; data: { branch: string } }
      const newBase = ev.data.branch
      enqueue.assign({ prBaseBranch: newBase })
      // A branch with no PR compares against no head, which is what makes this asker's answers headless —
      // the case the old staleness guard waved through
      if (!context.diffsByRef[refKey(newBase)] || context.diffStale) {
        sendToSystem('code', { type: 'pr.GET_BRANCH_DIFF', baseBranch: newBase })
      }
    }),

    /**
     * Writes the answer into the comparison it answers, and checks nothing.
     *
     * **It does not set `prBaseBranch`**, which is what keeps the key honest: that field is the base the
     * user is on, written by the askers, and an answer that moved it would move the view onto itself —
     * a stale answer would redirect the view to its own slot and be read after all.
     *
     * `isPrLoading` and `diffStale` are the view's, not the comparison's, so a late answer still clears
     * them; there is nothing stale about "no longer loading".
     */
    handleBranchDiffReceived: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.BRANCH_DIFF_RECEIVED'; data: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
      enqueue.assign({
        diffsByRef: { ...context.diffsByRef, [refKey(ev.data.baseBranch, ev.data.headBranch)]: ev.data.files },
        isPrLoading: false,
        diffStale: false,
      })
    }),

    /**
     * Opens a tab for a diff this machine asked for and still wants — the one handler a key could not
     * answer on its own, because opening a tab *creates* a row rather than filling one.
     *
     * Two clauses, and each is a different question. `inFlightFileDiffs` says this machine asked: a slow
     * diff for a PR the user has left, or another window's answer, is in nobody's set here. And
     * `selectedPrFile` says it is still wanted and is what the tab is built from, so an answer for a file
     * the user has since moved off would otherwise put that file's diff in a tab named for another.
     *
     * The key leaves the set as it is consumed, which is what makes a duplicate answer open one tab.
     *
     * There is no `prDiff` any more: it was written here and read nowhere, the tab being the only
     * consumer, so keying it would have keyed something nothing looks at.
     */
    handleFileDiffReceived: enqueueActions(({ enqueue, self, context, event }) => {
      const ev = event as { type: 'pr.FILE_DIFF_RECEIVED'; data: GitDiff & { baseBranch: string; headBranch?: string } }
      const key = fileKey(ev.data.baseBranch, ev.data.headBranch, ev.data.path)
      if (!context.inFlightFileDiffs.has(key)) return
      const selected = context.selectedPrFile
      if (selected?.path !== ev.data.path) return
      const remaining = new Set(context.inFlightFileDiffs)
      remaining.delete(key)
      enqueue.assign({ inFlightFileDiffs: remaining })
      enqueue(() => {
        const diffTab = {
          path: `pr-diff:${selected.path}`,
          content: '',
          modified: false,
          isDiff: true,
          isPrDiff: true,
          gitDiff: ev.data,
          gitFile: selected
        }
        addTabToParent(self, diffTab)
      })
    }),

    openFile: ({ event, self }) => {
      const ev = event as { type: 'pr.OPEN_FILE'; file: GitStatusFile }
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''
      const fullPath = ev.file.path.startsWith('/')
        ? ev.file.path
        : baseDirectory.endsWith('/')
          ? baseDirectory + ev.file.path
          : baseDirectory + '/' + ev.file.path
      updateParentState(self, { selectedPanel: 'explorer' })
      sendEventToParent(self, {
        type: 'explorer.OPEN_FILE',
        path: fullPath
      })
    },

    handleCodeStartup: ({ self }) => {
      const parentContext = getParentContext(self)
      if (parentContext?.baseDirectory) {
        sendToSystem('code', { type: 'pr.CHECK_GH_AUTH' })
        self.send({ type: 'pr.REFRESH_STATUS' })
      } else {
        self.send({ type: 'pr.ERROR', message: 'No directory selected. Please select a directory first.' })
      }
    },

    // --- GitHub PR actions ---

    handleGhAuthChecked: assign({
      isGhAvailable: ({ event }) => {
        const ev = event as { type: 'pr.GH_AUTH_CHECKED'; data: { available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null } }
        return ev.data.available
      },
      authCheckCompleted: true,
      prAccess: ({ event }) => {
        const ev = event as { type: 'pr.GH_AUTH_CHECKED'; data: { available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null } }
        return ev.data.prAccess
      },
      activeToken: ({ event }) => {
        const ev = event as { type: 'pr.GH_AUTH_CHECKED'; data: { available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null } }
        return ev.data.activeToken ?? null
      },
    }),

    navigateToHelp: () => {
      untypedOpenSurface(HOST_SETTINGS, [{ type: 'TAB.SELECT', tab: 'help' }]);
    },

    handleOpenPRsReceived: assign({
      openPRs: ({ event }) => {
        const ev = event as { type: 'pr.OPEN_PRS_RECEIVED'; data: { prs: GhPullRequest[] } }
        return ev.data.prs
      },
      isLoadingPRs: false
    }),

    // Accept incoming PR details. Two stale-response guards:
    //   1. PR number doesn't match what we're expecting (background refresh for a PR
    //      the user already moved on from, OR a late response for an unrelated PR
    //      arriving after a manual selection). Expected = the PR the user explicitly
    //      requested via the dropdown (pendingManualPRNumber), or the currently-
    //      selected PR when no manual selection is pending.
    //   2. Older than the newest fetch we've already accepted for this PR number — happens
    //      when a long-running fetchPRDetailsSettled retry's final emit arrives after
    //      a newer concurrent fetch (e.g. a manual refresh fired mid-retry).
    handlePRDetailsReceived: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.PR_DETAILS_RECEIVED'; data: { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number } }
      const prNumber = ev.data.pr.number
      const lastAccepted = context.latestPrDetailsFetchedAt[prNumber] ?? 0
      if (ev.data.fetchedAt < lastAccepted) return
      const expected = context.pendingManualPRNumber ?? context.selectedPR?.number
      if (expected !== undefined && expected !== prNumber) return
      enqueue.assign({
        selectedPR: ev.data.pr,
        prComments: ev.data.comments,
        isLoadingDetails: false,
        latestPrDetailsFetchedAt: { ...context.latestPrDetailsFetchedAt, [prNumber]: ev.data.fetchedAt },
        // Manual selection landed — clear pending so a later background fetch for a
        // different PR number can't sneak past the guard.
        pendingManualPRNumber: context.pendingManualPRNumber === prNumber ? null : context.pendingManualPRNumber,
      })
    }),

    handleBranchPRChecked: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.BRANCH_PR_CHECKED'; data: { pr: GhPullRequest | null } }
      const incoming = ev.data.pr
      const unchanged = incoming?.number === context.selectedPR?.number
        && incoming?.updatedAt === context.selectedPR?.updatedAt

      enqueue.assign({
        branchPR: incoming,
        // Don't overwrite a manually selected PR
        selectedPR: context.isManualPRSelection
          ? context.selectedPR
          : (unchanged ? context.selectedPR : incoming ?? null),
        isGhChecking: false,
        branchPRCheckFailed: false,
        prCheckCompleted: true,
      })

      // Only auto-load diff for the current branch PR if no manual selection is active
      if (!context.isManualPRSelection) {
        if (incoming) {
          // Keyed, so this asks whether *this* comparison is held rather than whether any files are —
          // the question a single slot could not ask when two PRs share a base
          const needsDiff = !context.diffsByRef[refKey(incoming.baseRefName, incoming.headRefName)]
            || context.diffStale
          if (needsDiff) {
            enqueue.assign({ prBaseBranch: incoming.baseRefName })
            sendToSystem('code', {
              type: 'pr.GET_BRANCH_DIFF',
              baseBranch: incoming.baseRefName,
              headBranch: incoming.headRefName,
            })
          }
        } else {
          sendToSystem('code', { type: 'pr.GET_SMART_BASE_BRANCH' })
        }
      }
    }),

    handlePRCreated: assign({
      selectedPR: ({ event }) => {
        const ev = event as { type: 'pr.PR_CREATED'; data: { pr: GhPullRequest } }
        return ev.data.pr
      },
      isCreating: false,
      createTitle: '',
      createBody: '',
      createBaseBranch: '',
      createDraft: false,
      // The newly-created PR is by definition the branch PR — never pin it. Leaving
      // a stale true value here would block background BRANCH_PR_CHECKED updates.
      isManualPRSelection: false,
      pendingManualPRNumber: null,
    }),

    handlePRMerged: assign({
      selectedPR: ({ context }) => context.selectedPR
        ? { ...context.selectedPR, state: 'MERGED' as const }
        : null,
      branchPR: null,
      isMerging: false,
      isManualPRSelection: false,
      pendingManualPRNumber: null,
    }),

    handlePRClosed: assign({
      selectedPR: ({ context }) => context.selectedPR
        ? { ...context.selectedPR, state: 'CLOSED' as const }
        : null,
      branchPR: null,
      isClosing: false,
      isManualPRSelection: false,
      pendingManualPRNumber: null,
    }),

    handlePRDraftToggled: assign({
      selectedPR: ({ event, context }) => {
        const ev = event as { type: 'pr.PR_DRAFT_TOGGLED'; data: { number: number; isDraft: boolean } }
        if (context.selectedPR?.number === ev.data.number) {
          return { ...context.selectedPR, isDraft: ev.data.isDraft }
        }
        return context.selectedPR
      },
      isTogglingDraft: false,
    }),

    requestUpdatePR: ({ event }) => {
      const ev = event as { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
      sendToSystem('code', { type: 'pr.UPDATE_PR', number: ev.number, title: ev.title, body: ev.body, base: ev.base })
    },

    handlePRUpdated: assign({
      selectedPR: ({ event, context }) => {
        const ev = event as { type: 'pr.PR_UPDATED'; data: { number: number; title?: string; body?: string; base?: string } }
        if (!context.selectedPR || context.selectedPR.number !== ev.data.number) return context.selectedPR
        return {
          ...context.selectedPR,
          ...(ev.data.title && { title: ev.data.title }),
          ...(ev.data.body !== undefined && { body: ev.data.body }),
          ...(ev.data.base && { baseRefName: ev.data.base }),
        }
      },
      isUpdatingPR: false,
      diffStale: ({ event, context }) => {
        const ev = event as { type: 'pr.PR_UPDATED'; data: { number: number; base?: string } }
        return ev.data.base ? true : context.diffStale
      },
    }),

    requestDeleteBranch: ({ context }) => {
      if (context.selectedPR?.headRefName) {
        sendToSystem('code', { type: 'pr.DELETE_BRANCH', branch: context.selectedPR.headRefName })
      }
    },

    checkoutBase: ({ context, self }) => {
      if (!context.selectedPR?.baseRefName) return
      updateParentState(self, { selectedPanel: 'commit' })
      sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName: context.selectedPR.baseRefName })
    },

    handleBranchDeleted: assign({
      selectedPR: null,
      branchPR: null,
      isDeletingBranch: false,
    }),

    // User-initiated actions
    requestListPRs: () => {
      sendToSystem('code', { type: 'pr.LIST_OPEN_PRS' })
    },

    switchToPRBranch: ({ event }) => {
      const ev = event as { type: 'pr.SWITCH_TO_PR_BRANCH'; branchName: string }
      sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName: ev.branchName })
    },

    setViewMode: assign({
      viewMode: ({ event }) => {
        const ev = event as { type: 'pr.SET_VIEW_MODE'; mode: 'files' | 'pr' }
        return ev.mode
      },
      prError: null,
    }),

    newPR: enqueueActions(({ enqueue }) => {
      enqueue.assign({
        selectedPR: null,
        viewMode: 'pr' as const,
        prError: null,
        prComments: [],
        reviewThreads: [],
        createTitle: '',
        createBody: '',
        createDraft: false,
        isManualPRSelection: false,
        pendingManualPRNumber: null,
      })
      enqueue(() => {
        sendToSystem('code', { type: 'pr.GET_PR_AUTOFILL' })
      })
    }),

    handleAutofillReceived: assign({
      createTitle: ({ event, context }) => {
        const ev = event as { type: 'pr.AUTOFILL_RECEIVED'; data: { title: string; body: string } }
        return context.createTitle || ev.data.title
      },
      createBody: ({ event, context }) => {
        const ev = event as { type: 'pr.AUTOFILL_RECEIVED'; data: { title: string; body: string } }
        return context.createBody || ev.data.body
      },
    }),

    updateCreateField: assign({
      createTitle: ({ event, context }) => {
        const ev = event as { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
        return ev.field === 'title' ? ev.value : context.createTitle
      },
      createBody: ({ event, context }) => {
        const ev = event as { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
        return ev.field === 'body' ? ev.value : context.createBody
      },
      createBaseBranch: ({ event, context }) => {
        const ev = event as { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
        return ev.field === 'baseBranch' ? ev.value : context.createBaseBranch
      },
      createDraft: ({ event, context }) => {
        const ev = event as { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
        return ev.field === 'draft' ? ev.value : context.createDraft
      },
    }),

    submitCreate: ({ context }) => {
      sendToSystem('code', {
        type: 'pr.CREATE_PR',
        title: context.createTitle,
        body: context.createBody,
        base: context.createBaseBranch || context.prBaseBranch || undefined,
        draft: context.createDraft,
      })
    },

    submitCreateDraft: ({ context }) => {
      sendToSystem('code', {
        type: 'pr.CREATE_PR',
        title: context.createTitle,
        body: context.createBody,
        base: context.createBaseBranch || context.prBaseBranch || undefined,
        draft: true,
      })
    },

    requestMerge: ({ event, context }) => {
      if (!context.selectedPR) return
      const ev = event as { type: 'pr.MERGE'; method?: 'merge' | 'squash' | 'rebase' }
      sendToSystem('code', {
        type: 'pr.MERGE_PR',
        number: context.selectedPR.number,
        method: ev.method || 'merge',
      })
    },

    requestClose: ({ context }) => {
      if (!context.selectedPR) return
      sendToSystem('code', { type: 'pr.CLOSE_PR', number: context.selectedPR.number })
    },

    requestToggleDraft: ({ context }) => {
      if (!context.selectedPR) return
      sendToSystem('code', {
        type: 'pr.TOGGLE_DRAFT',
        number: context.selectedPR.number,
        isDraft: context.selectedPR.isDraft,
      })
    },

    refreshPRList: () => {
      sendToSystem('code', { type: 'pr.LIST_OPEN_PRS' })
      sendToSystem('code', { type: 'pr.CHECK_BRANCH_PR' })
    },

    refreshPRDetails: ({ event }) => {
      const ev = event as { type: 'pr.REFRESH_PR'; number: number }
      sendToSystem('code', { type: 'pr.SELECT_PR', number: ev.number })
    },

    selectPRAndLoadDiff: enqueueActions(({ enqueue, event }) => {
      const ev = event as { type: 'pr.SELECT_PR_BY_NUMBER'; number: number }
      enqueue.assign({
        isLoadingDetails: true,
        isPrLoading: true,
        viewMode: 'files' as const,
        prComments: [],
        isManualPRSelection: true,
        pendingManualPRNumber: ev.number,
      })
      enqueue(() => {
        sendToSystem('code', { type: 'pr.SELECT_PR', number: ev.number })
      })
    }),

    // Load diff for the PR whose details just arrived. Same stale-response guards as
    /**
     * Asks for the selected PR's diff — skipping a background refresh for a different PR unless it was
     * manually selected, and skipping an answer older than the newest accepted so it does not start a
     * fetch for a PR the viewer has moved past.
     *
     * **It sets `prBaseBranch`, and that is load-bearing.** The base the view is on is half the key its
     * files are read under, and it used to be written by `handleBranchDiffReceived` from whatever answer
     * arrived — which with keyed slots would let a stale answer point the view at its own slot. Every
     * asker names the base it is asking about; no answer does.
     */
    loadDiffForSelectedPR: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.PR_DETAILS_RECEIVED'; data: { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number } }
      const prNumber = ev.data.pr.number
      if (ev.data.fetchedAt < (context.latestPrDetailsFetchedAt[prNumber] ?? 0)) return
      const expected = context.pendingManualPRNumber ?? context.selectedPR?.number
      if (expected !== undefined && expected !== prNumber) return
      enqueue.assign({ prBaseBranch: ev.data.pr.baseRefName })
      enqueue(() => sendToSystem('code', {
        type: 'pr.GET_BRANCH_DIFF',
        baseBranch: ev.data.pr.baseRefName,
        headBranch: ev.data.pr.headRefName,
      }))
    }),

    // --- Comment actions (optimistic) ---

    optimisticCreateComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.CREATE_COMMENT'; number: number; body: string }
      const pid = placeholderIdCounter--
      const placeholder: GhPRComment = {
        id: `pending-${pid}`,
        body: ev.body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        url: `pending-${pid}`,
        viewerDidAuthor: true,
      }
      enqueue.assign({
        _commentSnapshot: context._commentSnapshot ?? context.prComments,
        prComments: [...context.prComments, placeholder],
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.CREATE_COMMENT', number: ev.number, body: ev.body }))
    }),

    optimisticEditComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
      enqueue.assign({
        _commentSnapshot: context._commentSnapshot ?? context.prComments,
        prComments: context.prComments.map(c =>
          getCommentDatabaseId(c) === ev.commentId ? { ...c, body: ev.body } : c
        ),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.EDIT_COMMENT', commentId: ev.commentId, body: ev.body }))
    }),

    optimisticDeleteComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.DELETE_COMMENT'; commentId: number }
      enqueue.assign({
        _commentSnapshot: context._commentSnapshot ?? context.prComments,
        prComments: context.prComments.filter(c => getCommentDatabaseId(c) !== ev.commentId),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.DELETE_COMMENT', commentId: ev.commentId }))
    }),

    handleCommentMutated: enqueueActions(({ enqueue, context }) => {
      enqueue.assign({ _commentSnapshot: null })
      if (context.selectedPR) {
        // Narrow refresh — just the comments. pr.SELECT_PR would re-fetch the full
        // PR details, diff and threads and run every asset-URL resolver on each
        // click; pr.GET_COMMENTS keeps the UI snappy and leaves unrelated panels
        // alone on each mutation.
        enqueue(() => sendToSystem('code', { type: 'pr.GET_COMMENTS', number: context.selectedPR!.number }))
      }
    }),

    handleCommentsReceived: assign({
      // Only apply when it matches the currently-selected PR — otherwise a stale
      // response from a PR the user already left would clobber the new PR's list.
      prComments: ({ event, context }) => {
        const ev = event as { type: 'pr.COMMENTS_RECEIVED'; data: { number: number; comments: GhPRComment[] } }
        if (context.selectedPR?.number !== ev.data.number) return context.prComments
        return ev.data.comments
      },
    }),

    // --- Review thread actions (optimistic) ---

    optimisticReplyToThread: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
      const pid = placeholderIdCounter--
      const placeholder = {
        id: `pending-${pid}`,
        databaseId: pid,
        body: ev.body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        viewerDidAuthor: true,
      }
      enqueue.assign({
        _threadSnapshot: context._threadSnapshot ?? context.reviewThreads,
        reviewThreads: context.reviewThreads.map(t => {
          const hasComment = t.comments.some(c => c.databaseId === ev.commentId)
          if (!hasComment) return t
          return { ...t, comments: [...t.comments, placeholder] }
        }),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.REPLY_TO_THREAD', prNumber: ev.prNumber, commentId: ev.commentId, body: ev.body }))
    }),

    optimisticResolveThread: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.RESOLVE_THREAD'; threadId: string }
      enqueue.assign({
        _threadSnapshot: context._threadSnapshot ?? context.reviewThreads,
        reviewThreads: context.reviewThreads.map(t =>
          t.id === ev.threadId ? { ...t, isResolved: true } : t
        ),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.RESOLVE_THREAD', threadId: ev.threadId }))
    }),

    optimisticUnresolveThread: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
      enqueue.assign({
        _threadSnapshot: context._threadSnapshot ?? context.reviewThreads,
        reviewThreads: context.reviewThreads.map(t =>
          t.id === ev.threadId ? { ...t, isResolved: false } : t
        ),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.UNRESOLVE_THREAD', threadId: ev.threadId }))
    }),

    optimisticEditReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
      enqueue.assign({
        _threadSnapshot: context._threadSnapshot ?? context.reviewThreads,
        reviewThreads: context.reviewThreads.map(t => ({
          ...t,
          comments: t.comments.map(c =>
            c.databaseId === ev.commentId ? { ...c, body: ev.body } : c
          ),
        })),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.EDIT_REVIEW_COMMENT', commentId: ev.commentId, body: ev.body }))
    }),

    optimisticDeleteReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
      enqueue.assign({
        _threadSnapshot: context._threadSnapshot ?? context.reviewThreads,
        reviewThreads: context.reviewThreads.map(t => ({
          ...t,
          comments: t.comments.filter(c => c.databaseId !== ev.commentId),
        })),
        inflightMutations: context.inflightMutations + 1,
      })
      enqueue(() => sendToSystem('code', { type: 'pr.DELETE_REVIEW_COMMENT', commentId: ev.commentId }))
    }),

    handleReviewThreadsReceived: assign({
      reviewThreads: ({ event }) => {
        const ev = event as { type: 'pr.REVIEW_THREADS_RECEIVED'; data: { threads: GhReviewThread[] } }
        return ev.data.threads
      },
    }),

    handleThreadMutated: enqueueActions(({ enqueue, context }) => {
      enqueue.assign({ _threadSnapshot: null })
      if (context.selectedPR) {
        enqueue(() => sendToSystem('code', { type: 'pr.GET_REVIEW_THREADS', number: context.selectedPR!.number }))
      }
    }),

    fetchReviewThreads: ({ context }) => {
      if (context.selectedPR) {
        sendToSystem('code', { type: 'pr.GET_REVIEW_THREADS', number: context.selectedPR.number })
      }
    },
  }
}).createMachine({
  id: 'pr',
  initial: 'idle',
  context: {
    diffsByRef: {},
    inFlightFileDiffs: new Set<string>(),
    prBaseBranch: '',
    prError: null,
    isPrLoading: false,
    selectedPrFile: null,

    openPRs: [],
    selectedPR: null,
    branchPR: null,
    prComments: [],
    reviewThreads: [],
    commentTab: 'discussion',
    viewMode: 'files',
    isGhAvailable: false,
    prAccess: true,
    activeToken: null,
    isGhChecking: false,
    branchPRCheckFailed: false,
    prCheckCompleted: false,
    authCheckCompleted: false,

    createTitle: '',
    createBody: '',
    createBaseBranch: '',
    createDraft: false,

    isLoadingPRs: false,
    isCreating: false,
    isMerging: false,
    isClosing: false,
    isTogglingDraft: false,
    isDeletingBranch: false,
    isUpdatingPR: false,
    inflightMutations: 0,
    isLoadingDetails: false,
    diffStale: false,

    isManualPRSelection: false,
    pendingManualPRNumber: null,

    _commentSnapshot: null,
    _threadSnapshot: null,

    latestPrDetailsFetchedAt: {},
  },
  states: {
    idle: {
      on: {
        'pr.REFRESH_STATUS': {
          actions: [
            assign({
              isPrLoading: ({ context }) =>
                !context.diffsByRef[refKey(context.prBaseBranch, context.selectedPR?.headRefName)],
              isGhChecking: ({ context }) => !context.prCheckCompleted,
              branchPRCheckFailed: false,
            }),
            'refreshPrStatus',
          ]
        },
        'pr.SELECT_FILE': { actions: 'selectPrFile' },
        'pr.VIEW_DIFF': { actions: 'viewPrDiff' },
        'pr.OPEN_FILE': { actions: 'openFile' },
        'pr.ERROR': { actions: 'assignPrError' },
        'pr.BASE_BRANCH_RECEIVED': { actions: 'handleBaseBranchReceived' },
        'pr.BRANCH_DIFF_RECEIVED': { actions: 'handleBranchDiffReceived' },
        'pr.FILE_DIFF_RECEIVED': { actions: 'handleFileDiffReceived' },
        // Full reset for directory switches — clears view, selection, and PR state
        'pr.STATUS_CHANGED': { actions: [assign({ diffStale: true, isManualPRSelection: false, pendingManualPRNumber: null, prCheckCompleted: false, isGhChecking: true, viewMode: 'files' as const, prError: null }), 'refreshPrStatus'] },
        // Lightweight refresh for git changes — re-checks PR status without resetting viewMode or manual selection
        'pr.GIT_STATUS_REFRESHED': { actions: [assign({ diffStale: true, prCheckCompleted: false, isGhChecking: true, prError: null }), 'refreshPrStatus'] },
        'CODE_STARTED': {
          actions: [
            assign({
              prCheckCompleted: false,
              selectedPR: null,
              branchPR: null,
              diffsByRef: {},
              inFlightFileDiffs: new Set<string>(),
              prBaseBranch: '',
              diffStale: false,
              // Clear any dangling optimistic rollback snapshots — no selectedPR
              // means nothing can consume them, and stale refs would leak memory.
              _commentSnapshot: null,
              _threadSnapshot: null,
              // Different directory means potentially a different repo; PR numbers
              // from the old repo shouldn't gate responses for the new one.
              latestPrDetailsFetchedAt: {},
              // A mutation in flight from the old directory shouldn't keep submit
              // buttons disabled here — if the old op never responds, the counter
              // would otherwise stay positive forever.
              inflightMutations: 0,
              pendingManualPRNumber: null,
            }),
            'handleCodeStartup',
          ]
        },

        // GitHub PR events from backend
        'pr.GH_AUTH_CHECKED': { actions: 'handleGhAuthChecked' },
        'pr.NAVIGATE_TO_HELP': { actions: 'navigateToHelp' },
        'pr.OPEN_PRS_RECEIVED': { actions: 'handleOpenPRsReceived' },
        'pr.PR_DETAILS_RECEIVED': { actions: ['handlePRDetailsReceived', 'loadDiffForSelectedPR', 'fetchReviewThreads'] },
        'pr.BRANCH_PR_CHECKED': { actions: 'handleBranchPRChecked' },
        'pr.SMART_BASE_BRANCH_RECEIVED': { actions: 'handleSmartBaseBranchReceived' },
        'pr.AUTOFILL_RECEIVED': { actions: 'handleAutofillReceived' },
        'pr.PR_CREATED': { actions: ['handlePRCreated', 'refreshPRList'] },
        'pr.PR_MERGED': { actions: ['handlePRMerged', 'refreshPRList'] },
        'pr.PR_CLOSED': { actions: ['handlePRClosed', 'refreshPRList'] },
        'pr.PR_DRAFT_TOGGLED': { actions: 'handlePRDraftToggled' },
        'pr.BRANCH_DELETED': { actions: 'handleBranchDeleted' },
        'pr.PR_UPDATED': { actions: ['handlePRUpdated', 'refreshPrStatus'] },
        'pr.COMMENT_CREATED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleCommentMutated'] },
        'pr.COMMENT_EDITED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleCommentMutated'] },
        'pr.COMMENT_DELETED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleCommentMutated'] },
        'pr.COMMENTS_RECEIVED': { actions: 'handleCommentsReceived' },
        'pr.REVIEW_THREADS_RECEIVED': { actions: 'handleReviewThreadsReceived' },
        'pr.THREAD_REPLIED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleThreadMutated'] },
        'pr.THREAD_RESOLVED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleThreadMutated'] },
        'pr.THREAD_UNRESOLVED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleThreadMutated'] },
        'pr.REVIEW_COMMENT_EDITED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleThreadMutated'] },
        'pr.REVIEW_COMMENT_DELETED': { actions: [assign({ inflightMutations: ({ context }) => Math.max(0, context.inflightMutations - 1) }), 'handleThreadMutated'] },

        // User actions
        'pr.LIST_PRS': { actions: ['requestListPRs', assign({ isLoadingPRs: true })] },
        'pr.SELECT_PR_BY_NUMBER': { actions: 'selectPRAndLoadDiff' },
        'pr.SWITCH_TO_PR_BRANCH': { actions: 'switchToPRBranch' },
        'pr.SET_VIEW_MODE': { actions: 'setViewMode' },
        'pr.NEW_PR': { actions: 'newPR' },
        'pr.UPDATE_CREATE_FIELD': { actions: 'updateCreateField' },
        'pr.SUBMIT_CREATE': { actions: ['submitCreate', assign({ isCreating: true })] },
        'pr.SUBMIT_CREATE_DRAFT': { actions: ['submitCreateDraft', assign({ isCreating: true })] },
        'pr.MERGE': { actions: ['requestMerge', assign({ isMerging: true })] },
        'pr.CLOSE': { actions: ['requestClose', assign({ isClosing: true })] },
        'pr.TOGGLE_DRAFT': { actions: ['requestToggleDraft', assign({ isTogglingDraft: true })] },
        'pr.DELETE_BRANCH': { actions: ['requestDeleteBranch', assign({ isDeletingBranch: true })] },
        'pr.CHECKOUT_BASE': { actions: 'checkoutBase' },
        'pr.UPDATE_PR': { actions: ['requestUpdatePR', assign({ isUpdatingPR: true })] },
        'pr.CREATE_COMMENT': { actions: 'optimisticCreateComment' },
        'pr.EDIT_COMMENT': { actions: 'optimisticEditComment' },
        'pr.DELETE_COMMENT': { actions: 'optimisticDeleteComment' },
        'pr.REPLY_TO_THREAD': { actions: 'optimisticReplyToThread' },
        'pr.RESOLVE_THREAD': { actions: 'optimisticResolveThread' },
        'pr.UNRESOLVE_THREAD': { actions: 'optimisticUnresolveThread' },
        'pr.EDIT_REVIEW_COMMENT': { actions: 'optimisticEditReviewComment' },
        'pr.DELETE_REVIEW_COMMENT': { actions: 'optimisticDeleteReviewComment' },
        'pr.SET_COMMENT_TAB': { actions: assign({ commentTab: ({ event }) => (event as { type: 'pr.SET_COMMENT_TAB'; tab: 'discussion' | 'reviews' }).tab }) },
        'pr.REFRESH_PR': { actions: ['refreshPRDetails', assign({ isLoadingDetails: true })] },
        'pr.BACK_TO_BRANCH': {
          actions: [
            assign({ selectedPR: null, isManualPRSelection: false, pendingManualPRNumber: null, diffsByRef: {}, inFlightFileDiffs: new Set<string>(), diffStale: true, prCheckCompleted: false, isGhChecking: true }),
            'refreshPrStatus',
          ]
        },
        'pr.CLEAR_ERROR': { actions: assign({ prError: null }) },
      }
    }
  }
});

/** The pull-request child's actor, named by whoever reads its context (`codeChild(…)`) */
export type PullRequestActor = ActorRefFrom<typeof pullRequestState>;
