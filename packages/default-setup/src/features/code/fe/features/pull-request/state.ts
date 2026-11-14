import type { GitHubApiFailure } from '#features/code/be/services/github-api.ts'
import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { answersCall, newCall, recordCall, settleCall, type CallOptions } from '@apackdev/sdk/events';
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
 * the rule for that job is a slot keyed by what was asked (`packages/default-setup/CLAUDE.md`): a late
 * answer writes its own key, the view reads the key it is showing, and correlation is structural rather
 * than checked. The key an answer writes is the one its ask recorded (`diffAsks`), never one read off the
 * answer, so an answer cannot name a slot nobody asked for.
 */
export const refKey = (base: string, head?: string): string => `${base}...${head ?? ''}`

/** The same, for one file within that comparison — a file diff opens a tab, so it is tracked per request */
export const fileKey = (base: string, head: string | undefined, path: string): string =>
  `${refKey(base, head)}#${path}`

/** One send to the code system, under the call it is handed */
type Send = (options: CallOptions) => void

/** The reads the panel holds one ask for at a time: the latest, and an answer to an earlier one is not taken */
const ASKS = ['details', 'comments', 'threads', 'smartBase', 'branchPR', 'openPRs', 'access', 'autofill'] as const
export type PullRequestAsk = (typeof ASKS)[number]

const noAsks = (): Record<PullRequestAsk, string | null> =>
  Object.fromEntries(ASKS.map((ask) => [ask, null])) as Record<PullRequestAsk, string | null>

/** A change to the discussion, shown before GitHub has answered it */
type CommentChange =
  | { change: 'create'; placeholder: GhPRComment }
  | { change: 'edit'; commentId: number; body: string }
  | { change: 'delete'; commentId: number }

/** A change to the review threads, shown before GitHub has answered it */
type ThreadChange =
  | { change: 'reply'; commentId: number; placeholder: GhReviewThread['comments'][number] }
  | { change: 'resolve'; threadId: string; resolved: boolean }
  | { change: 'edit'; commentId: number; body: string }
  | { change: 'delete'; commentId: number }

/**
 * A write the panel sent and GitHub has not answered, recorded under its call. A comment or thread write
 * carries the change it shows meanwhile, which is all its rollback needs: the list shown is the one GitHub
 * last gave with every unanswered change laid over it, so taking one change out leaves every other in place.
 */
export type PullRequestWrite =
  | { write: 'create-pr' }
  | { write: 'merge'; number: number }
  | { write: 'close'; number: number }
  | { write: 'toggle-draft'; number: number }
  | { write: 'delete-branch' }
  | { write: 'update-pr'; number: number }
  | { write: 'create-comment'; number: number; comment: CommentChange }
  | { write: 'edit-comment'; number: number; comment: CommentChange }
  | { write: 'delete-comment'; number: number; comment: CommentChange }
  | { write: 'reply'; number: number; thread: ThreadChange }
  | { write: 'resolve-thread'; number: number; thread: ThreadChange }
  | { write: 'edit-review-comment'; number: number; thread: ThreadChange }
  | { write: 'delete-review-comment'; number: number; thread: ThreadChange }

/**
 * How a write that keeps something the user typed was answered — the one a form waits on before it lets
 * go of the text. `target` is what the form names: the PR's number for a new comment or an edit of the PR,
 * the comment's id for an edit or a reply.
 */
export interface WriteAnswer {
  write: 'update-pr' | 'create-comment' | 'edit-comment' | 'reply' | 'edit-review-comment'
  target: number
  ok: boolean
}

/** The answer a form waits on for this write, or none for a write no form waits on */
const writeAnswer = (write: PullRequestWrite, ok: boolean): WriteAnswer | null => {
  switch (write.write) {
    case 'update-pr': return { write: 'update-pr', target: write.number, ok }
    case 'create-comment': return { write: 'create-comment', target: write.number, ok }
    case 'edit-comment': return write.comment.change === 'edit' ? { write: 'edit-comment', target: write.comment.commentId, ok } : null
    case 'reply': return write.thread.change === 'reply' ? { write: 'reply', target: write.thread.commentId, ok } : null
    case 'edit-review-comment': return write.thread.change === 'edit' ? { write: 'edit-review-comment', target: write.thread.commentId, ok } : null
    default: return null
  }
}

const applyComment = (comments: GhPRComment[], change: CommentChange): GhPRComment[] => {
  switch (change.change) {
    case 'create': return [...comments, change.placeholder]
    case 'edit': return comments.map(c => getCommentDatabaseId(c) === change.commentId ? { ...c, body: change.body } : c)
    case 'delete': return comments.filter(c => getCommentDatabaseId(c) !== change.commentId)
  }
}

const applyThread = (threads: GhReviewThread[], change: ThreadChange): GhReviewThread[] => {
  switch (change.change) {
    case 'reply': return threads.map(t => t.comments.some(c => c.databaseId === change.commentId)
      ? { ...t, comments: [...t.comments, change.placeholder] }
      : t)
    case 'resolve': return threads.map(t => t.id === change.threadId ? { ...t, isResolved: change.resolved } : t)
    case 'edit': return threads.map(t => ({ ...t, comments: t.comments.map(c => c.databaseId === change.commentId ? { ...c, body: change.body } : c) }))
    case 'delete': return threads.map(t => ({ ...t, comments: t.comments.filter(c => c.databaseId !== change.commentId) }))
  }
}

const commentChangeOf = (write: PullRequestWrite): CommentChange | undefined => 'comment' in write ? write.comment : undefined
const threadChangeOf = (write: PullRequestWrite): ThreadChange | undefined => 'thread' in write ? write.thread : undefined

/** What the panel shows: what GitHub last gave, with every write it has not answered laid over it in the order sent */
const shown = (confirmedComments: GhPRComment[], confirmedThreads: GhReviewThread[], writes: Record<string, PullRequestWrite>) => {
  let prComments = confirmedComments
  let reviewThreads = confirmedThreads
  for (const write of Object.values(writes)) {
    const comment = commentChangeOf(write)
    if (comment) prComments = applyComment(prComments, comment)
    const thread = threadChangeOf(write)
    if (thread) reviewThreads = applyThread(reviewThreads, thread)
  }
  return { prComments, reviewThreads }
}

/** The busy flags, each true while a write of its kind is unanswered */
const busy = (writes: Record<string, PullRequestWrite>) => {
  const all = Object.values(writes)
  const any = (kind: PullRequestWrite['write']) => all.some(w => w.write === kind)
  return {
    isCreating: any('create-pr'),
    isMerging: any('merge'),
    isClosing: any('close'),
    isTogglingDraft: any('toggle-draft'),
    isDeletingBranch: any('delete-branch'),
    isUpdatingPR: any('update-pr'),
    inflightMutations: all.filter(w => commentChangeOf(w) || threadChangeOf(w)).length,
  }
}

/** The writes in `writes` and everything shown from them, as one assignment */
const withWrites = (context: CodePullRequestContext, writes: Record<string, PullRequestWrite>, confirmed?: { comments?: GhPRComment[]; threads?: GhReviewThread[] }) => {
  const confirmedComments = confirmed?.comments ?? context.confirmedComments
  const confirmedThreads = confirmed?.threads ?? context.confirmedThreads
  return {
    writes,
    confirmedComments,
    confirmedThreads,
    ...shown(confirmedComments, confirmedThreads, writes),
    ...busy(writes),
  }
}

/**
 * `next` as the pull request on screen. Leaving one for another drops everything that was the other's —
 * its discussion, its threads, the comment writes shown over them and the asks for them, and the file
 * diffs asked of it — so nothing of one pull request is shown, or written, on the next.
 */
const selecting = (context: CodePullRequestContext, next: GhPullRequest | null): Partial<CodePullRequestContext> => {
  if (next?.number === context.selectedPR?.number) return { selectedPR: next }
  const writes = Object.fromEntries(Object.entries(context.writes).filter(([, w]) => !commentChangeOf(w) && !threadChangeOf(w)))
  return {
    selectedPR: next,
    ...withWrites(context, writes, { comments: [], threads: [] }),
    commentsFor: null,
    asks: { ...context.asks, comments: null, threads: null },
    detailRefreshes: {},
    fileDiffAsks: {},
    missingFileDiff: null,
  }
}

/** The pull request panel is the one the code surface shows */
const panelShown = (self: unknown): boolean => getParentContext(self)?.selectedPanel === 'pr'

/** Everything that belongs to the folder open, as it is before anything is known of it */
const folderStart = (): Omit<CodePullRequestContext, 'commentTab'> => ({
  diffsByRef: {},
  diffAsks: {},
  fileDiffAsks: {},
  prBaseBranch: '',
  prError: null,
  missingFileDiff: null,
  isPrLoading: false,
  selectedPrFile: null,

  openPRs: [],
  selectedPR: null,
  branchPR: null,
  prComments: [],
  reviewThreads: [],
  confirmedComments: [],
  confirmedThreads: [],
  commentsFor: null,
  viewMode: 'files',
  githubAccess: null,
  githubAccessMessage: null,
  isCheckingBranchPR: false,
  branchPRCheckFailed: false,
  prCheckCompleted: false,

  createTitle: '',
  createBody: '',
  createBaseBranch: '',
  createDraft: false,

  ...busy({}),
  writes: {},
  lastWriteAnswer: null,
  isLoadingDetails: false,
  diffStale: false,

  isManualPRSelection: false,
  asks: noAsks(),
  detailRefreshes: {},
  latestPrDetailsFetchedAt: {},
})

/** Whether the app's GitHub sign-in can work with this repository's pull requests: `ok`, or why not */
export type GitHubAccess = 'ok' | GitHubApiFailure

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
  /** The branch diffs asked for and unanswered, by call: the comparison (`refKey`) each answer is written under */
  diffAsks: Record<string, string>
  /**
   * The file diffs asked for and unanswered, by call: each one's `fileKey`.
   *
   * A key alone is not enough for this one: its answer **opens a tab**, and a key decides which row to
   * write, not whether there should be one. So the tab opens only for a diff this machine asked for, once.
   */
  fileDiffAsks: Record<string, string>
  prBaseBranch: string
  prError: string | null
  /**
   * The file whose diff needs content this partial clone was not given: shown with an offer to download it,
   * which is the one way a read fetches
   */
  missingFileDiff: { path: string; baseBranch: string; headBranch?: string; prNumber?: number } | null
  isPrLoading: boolean
  selectedPrFile: GitStatusFile | null

  // GitHub PR state
  openPRs: GhPullRequest[]
  selectedPR: GhPullRequest | null
  branchPR: GhPullRequest | null
  /** The discussion shown: `confirmedComments` with the unanswered comment writes laid over it */
  prComments: GhPRComment[]
  /** The review threads shown: `confirmedThreads` with the unanswered thread writes laid over it */
  reviewThreads: GhReviewThread[]
  /** The discussion as GitHub last gave it */
  confirmedComments: GhPRComment[]
  /** The review threads as GitHub last gave them */
  confirmedThreads: GhReviewThread[]
  /** The pull request the discussion held is of; `null` before any has been read */
  commentsFor: number | null
  commentTab: 'discussion' | 'reviews'
  viewMode: 'files' | 'pr'
  /** `null` until the backend has said */
  githubAccess: GitHubAccess | null
  /** What to tell the user about an access that is not `ok` */
  githubAccessMessage: string | null
  isCheckingBranchPR: boolean
  branchPRCheckFailed: boolean
  prCheckCompleted: boolean

  // Create form
  createTitle: string
  createBody: string
  createBaseBranch: string
  createDraft: boolean

  // Busy while a write of their kind is unanswered (`busy`)
  isCreating: boolean
  isMerging: boolean
  isClosing: boolean
  isTogglingDraft: boolean
  isDeletingBranch: boolean
  isUpdatingPR: boolean
  /** The comment and thread writes unanswered, which disables every comment form while any is */
  inflightMutations: number
  /** The writes sent and unanswered, by call */
  writes: Record<string, PullRequestWrite>
  /** How the last write a form waits on was answered */
  lastWriteAnswer: WriteAnswer | null
  isLoadingDetails: boolean
  diffStale: boolean

  // PR selection tracking
  /** The user picked the pull request shown, so the branch's own does not replace it until they leave it */
  isManualPRSelection: boolean

  /** The latest ask for each read, while it is unanswered */
  asks: Record<PullRequestAsk, string | null>
  /**
   * The writes whose answer may bring the pull request's details read again after it, by call: the number
   * of the pull request each wrote to. Their details are taken while that pull request is still shown.
   */
  detailRefreshes: Record<string, number>

  /**
   * The newest `fetchedAt` accepted per PR number, so a slow fetch cannot overwrite fresher data when two
   * overlap for the same PR (a base change's settled details arriving after a manual refresh).
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
  /** The user asked for the content the diff of `missingFileDiff` lacks to be downloaded */
  | { type: 'pr.FETCH_MISSING_DIFF' }
  | { type: 'pr.FILE_CONTENT_MISSING'; data: { path: string; baseBranch: string; headBranch?: string; prNumber?: number } }
  | { type: 'pr.ERROR'; message: string }
  | { type: 'pr.BRANCH_DIFF_RECEIVED'; data: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
  | { type: 'pr.FILE_DIFF_RECEIVED'; data: GitDiff & { baseBranch: string; headBranch?: string } }
  | { type: 'pr.OPEN_FILE'; file: GitStatusFile }
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }
  | { type: 'CODE_STARTED' }
  // GitHub PR events from backend
  | { type: 'pr.CHECK_GITHUB_ACCESS' }
  | { type: 'pr.GITHUB_ACCESS_CHECKED'; data: { access: GitHubAccess; message?: string } }
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
  | { type: 'pr.SELECT_PR_BY_NUMBER'; number: number }
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

/** What an `enqueueActions` body is handed that the helpers below use */
interface Enqueue {
  assign: (values: Partial<CodePullRequestContext> | ((args: { context: CodePullRequestContext }) => Partial<CodePullRequestContext>)) => void
  (action: () => void): void
}

/** Asks `event` as the latest ask of `which`, so only its answer is taken */
function ask(enqueue: Enqueue, which: PullRequestAsk, send: Send): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({ asks: { ...context.asks, [which]: call } }))
  enqueue(() => { send({ call }) })
}

/** Asks for a branch diff, recording the comparison its answer is written under */
function askDiff(enqueue: Enqueue, baseBranch: string, headBranch?: string, prNumber?: number): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({ diffAsks: recordCall(context.diffAsks, call, refKey(baseBranch, headBranch)) }))
  enqueue(() => {
    sendToSystem('code', { type: 'pr.GET_BRANCH_DIFF', baseBranch, ...(headBranch && { headBranch }), ...(prNumber && { prNumber }) }, { call })
  })
}

/** Asks for a file's diff, recording it so its answer opens one tab */
function askFileDiff(enqueue: Enqueue, which: { path: string; baseBranch: string; headBranch?: string; prNumber?: number }, fetchMissing?: boolean): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({ fileDiffAsks: recordCall(context.fileDiffAsks, call, fileKey(which.baseBranch, which.headBranch, which.path)) }))
  enqueue(() => { sendToSystem('code', { type: 'pr.GET_BRANCH_FILE_DIFF', ...which, ...(fetchMissing && { fetchMissing }) }, { call }) })
}

/** Asks for the open pull requests and the branch's own */
function askStatus(enqueue: Enqueue): void {
  ask(enqueue, 'openPRs', (o) => sendToSystem('code', { type: 'pr.LIST_OPEN_PRS' }, o))
  ask(enqueue, 'branchPR', (o) => sendToSystem('code', { type: 'pr.CHECK_BRANCH_PR' }, o))
}

/**
 * Sends `event` as a write, shown at once where it carries a change. `refreshes` names the pull request
 * whose details its answer may bring read again.
 */
function sendWrite(enqueue: Enqueue, write: PullRequestWrite, send: Send, refreshes?: number): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({
    ...withWrites(context, recordCall(context.writes, call, write)),
    ...(refreshes !== undefined && { detailRefreshes: recordCall(context.detailRefreshes, call, refreshes) }),
  }))
  enqueue(() => { send({ call }) })
}

export const pullRequestState = setup({
  types: {
    context: {} as CodePullRequestContext,
    events: {} as Event
  },
  guards: {
    answersTheOpenPRsAsked: ({ context, event }) => answersCall(event, context.asks.openPRs),
    answersTheAccessAsked: ({ context, event }) => answersCall(event, context.asks.access),
    answersTheAutofillAsked: ({ context, event }) => answersCall(event, context.asks.autofill),
    answersTheBranchPRAsked: ({ context, event }) => answersCall(event, context.asks.branchPR),
    answersTheSmartBaseAsked: ({ context, event }) => answersCall(event, context.asks.smartBase),
    answersTheCommentsAsked: ({ context, event }) => answersCall(event, context.asks.comments),
    answersTheThreadsAsked: ({ context, event }) => answersCall(event, context.asks.threads),
  },
  actions: {
    /** Asks GitHub for what the top row shows, where a folder is open */
    refreshStatus: enqueueActions(({ enqueue, context, self }) => {
      if (!getParentContext(self)?.baseDirectory) return
      enqueue.assign({
        isPrLoading: !context.diffsByRef[refKey(context.prBaseBranch, context.selectedPR?.headRefName)],
        isCheckingBranchPR: !context.prCheckCompleted,
        branchPRCheckFailed: false,
        prError: null,
      })
      askStatus(enqueue)
    }),

    /**
     * The repository moved: what was read of it is stale. GitHub is asked again only while the panel is
     * shown; a hidden panel is asked when it is shown again (`pr.REFRESH_STATUS`, sent on selecting it).
     */
    followRepositoryChange: enqueueActions(({ enqueue, self }) => {
      enqueue.assign({ diffStale: true, prCheckCompleted: false })
      if (!panelShown(self) || !getParentContext(self)?.baseDirectory) return
      enqueue.assign({ isCheckingBranchPR: true })
      askStatus(enqueue)
    }),

    selectPrFile: assign({
      selectedPrFile: ({ event }) => {
        const ev = event as { type: 'pr.SELECT_FILE'; file: GitStatusFile }
        return ev.file
      }
    }),

    viewPrDiff: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.VIEW_DIFF'; path: string }
      askFileDiff(enqueue, {
        path: ev.path,
        baseBranch: context.prBaseBranch,
        headBranch: context.selectedPR?.headRefName,
        ...(context.selectedPR && { prNumber: context.selectedPR.number }),
      })
    }),

    /** Answers a diff this machine asked for that needs content the clone lacks: the request is over, and the offer shown */
    handleFileContentMissing: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.FILE_CONTENT_MISSING'; data: { path: string; baseBranch: string; headBranch?: string; prNumber?: number } }
      const { recorded, pending } = settleCall(context.fileDiffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({ fileDiffAsks: pending, missingFileDiff: ev.data })
    }),

    /** Asks for the same diff again, allowed to download what it lacks */
    fetchMissingDiff: enqueueActions(({ enqueue, context }) => {
      const missing = context.missingFileDiff
      if (!missing) return
      enqueue.assign({ missingFileDiff: null })
      askFileDiff(enqueue, missing, true)
    }),

    /**
     * An error ends the ask or write it answers and nothing else: that ask's busy flag clears, that write's
     * change comes off what is shown. Its message is shown whatever it answers, an earlier ask's included.
     */
    takeError: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.ERROR'; message: string }
      const updates: Partial<CodePullRequestContext> = { prError: ev.message }
      const asks = { ...context.asks }
      for (const which of ASKS) {
        if (!answersCall(event, asks[which])) continue
        asks[which] = null
        if (which === 'details') Object.assign(updates, { isLoadingDetails: false, isPrLoading: false })
        if (which === 'smartBase') updates.isPrLoading = false
        if (which === 'branchPR') Object.assign(updates, { isCheckingBranchPR: false, branchPRCheckFailed: !context.selectedPR, isPrLoading: false })
      }
      updates.asks = asks

      const diff = settleCall(context.diffAsks, event)
      if (diff.recorded !== undefined) Object.assign(updates, { diffAsks: diff.pending, isPrLoading: false })
      const fileDiff = settleCall(context.fileDiffAsks, event)
      if (fileDiff.recorded !== undefined) updates.fileDiffAsks = fileDiff.pending
      updates.detailRefreshes = settleCall(context.detailRefreshes, event).pending

      const write = settleCall(context.writes, event)
      if (write.recorded !== undefined) {
        Object.assign(updates, withWrites(context, write.pending))
        const answer = writeAnswer(write.recorded, false)
        if (answer) updates.lastWriteAnswer = answer
      }
      enqueue.assign(updates)
    }),

    handleSmartBaseBranchReceived: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.SMART_BASE_BRANCH_RECEIVED'; data: { branch: string } }
      const newBase = ev.data.branch
      enqueue.assign({ prBaseBranch: newBase, asks: { ...context.asks, smartBase: null } })
      // A branch with no PR compares against no head
      if (!context.diffsByRef[refKey(newBase)] || context.diffStale) askDiff(enqueue, newBase)
    }),

    /**
     * Writes the answer into the comparison its ask recorded, and nowhere else.
     *
     * **It does not set `prBaseBranch`**, which is what keeps the key honest: that field is the base the
     * user is on, written by the askers, and an answer that moved it would move the view onto itself.
     *
     * `isPrLoading` and `diffStale` are the view's, not the comparison's, so a late answer still clears
     * them; there is nothing stale about "no longer loading".
     */
    handleBranchDiffReceived: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.BRANCH_DIFF_RECEIVED'; data: { files: GitStatusFile[]; baseBranch: string; headBranch?: string } }
      const { recorded, pending } = settleCall(context.diffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({
        diffAsks: pending,
        diffsByRef: { ...context.diffsByRef, [recorded]: ev.data.files },
        isPrLoading: false,
        diffStale: false,
      })
    }),

    /**
     * Opens a tab for a diff this machine asked for and still wants. The ask leaves the record as it is
     * answered, so a duplicate answer opens nothing; and `selectedPrFile` is what the tab is built from, so
     * an answer for a file the user has since moved off opens nothing either.
     */
    handleFileDiffReceived: enqueueActions(({ enqueue, self, context, event }) => {
      const ev = event as { type: 'pr.FILE_DIFF_RECEIVED'; data: GitDiff & { baseBranch: string; headBranch?: string } }
      const { recorded, pending } = settleCall(context.fileDiffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({ fileDiffAsks: pending })
      const selected = context.selectedPrFile
      if (selected?.path !== ev.data.path) return
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

    /** A folder opened: nothing of the one before is kept, and GitHub is asked about this one while the panel is shown */
    startFolder: enqueueActions(({ enqueue, self }) => {
      enqueue.assign(folderStart())
      if (!getParentContext(self)?.baseDirectory) return
      ask(enqueue, 'access', (o) => sendToSystem('code', { type: 'pr.CHECK_GITHUB_ACCESS' }, o))
      if (panelShown(self)) enqueue(() => { self.send({ type: 'pr.REFRESH_STATUS' }) })
    }),

    // --- GitHub PR actions ---

    checkGitHubAccess: enqueueActions(({ enqueue }) => {
      ask(enqueue, 'access', (o) => sendToSystem('code', { type: 'pr.CHECK_GITHUB_ACCESS' }, o))
    }),

    handleGitHubAccessChecked: assign({
      githubAccess: ({ event }) => (event as { type: 'pr.GITHUB_ACCESS_CHECKED'; data: { access: GitHubAccess } }).data.access,
      githubAccessMessage: ({ event }) => (event as { type: 'pr.GITHUB_ACCESS_CHECKED'; data: { message?: string } }).data.message ?? null,
      asks: ({ context }) => ({ ...context.asks, access: null }),
    }),

    navigateToHelp: () => {
      untypedOpenSurface(HOST_SETTINGS, [{ type: 'TAB.SELECT', tab: 'help' }]);
    },

    handleOpenPRsReceived: assign({
      openPRs: ({ event }) => {
        const ev = event as { type: 'pr.OPEN_PRS_RECEIVED'; data: { prs: GhPullRequest[] } }
        return ev.data.prs
      },
      asks: ({ context }) => ({ ...context.asks, openPRs: null }),
    }),

    /**
     * Takes a pull request's details when they answer the latest ask for them, or a write's re-read of the
     * pull request still shown — and not when an answer accepted for that number was fetched later. Then
     * asks for its diff and its review threads.
     *
     * **It sets `prBaseBranch`, and that is load-bearing.** The base the view is on is half the key its
     * files are read under; every asker names the base it is asking about, and no answer does.
     */
    takeDetails: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.PR_DETAILS_RECEIVED'; data: { pr: GhPullRequest; comments: GhPRComment[]; fetchedAt: number } }
      const prNumber = ev.data.pr.number
      const asked = answersCall(event, context.asks.details)
      const refresh = settleCall(context.detailRefreshes, event)
      const refreshed = refresh.recorded === prNumber && context.selectedPR?.number === prNumber
      enqueue.assign({
        detailRefreshes: refresh.pending,
        ...(asked && { asks: { ...context.asks, details: null }, isLoadingDetails: false }),
      })
      if (!asked && !refreshed) return
      if (ev.data.fetchedAt < (context.latestPrDetailsFetchedAt[prNumber] ?? 0)) return
      enqueue.assign(({ context }) => {
        const left = selecting(context, ev.data.pr)
        const held = { ...context, ...left }
        return {
          ...left,
          ...withWrites(held, held.writes, { comments: ev.data.comments }),
          commentsFor: prNumber,
          latestPrDetailsFetchedAt: { ...context.latestPrDetailsFetchedAt, [prNumber]: ev.data.fetchedAt },
          prBaseBranch: ev.data.pr.baseRefName,
        }
      })
      askDiff(enqueue, ev.data.pr.baseRefName, ev.data.pr.headRefName, prNumber)
      ask(enqueue, 'threads', (o) => sendToSystem('code', { type: 'pr.GET_REVIEW_THREADS', number: prNumber }, o))
    }),

    handleBranchPRChecked: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.BRANCH_PR_CHECKED'; data: { pr: GhPullRequest | null } }
      const incoming = ev.data.pr
      const unchanged = incoming?.number === context.selectedPR?.number
        && incoming?.updatedAt === context.selectedPR?.updatedAt

      enqueue.assign({
        branchPR: incoming,
        // A picked PR stays until the user leaves it
        ...(context.isManualPRSelection || unchanged ? {} : selecting(context, incoming ?? null)),
        isCheckingBranchPR: false,
        branchPRCheckFailed: false,
        prCheckCompleted: true,
        asks: { ...context.asks, branchPR: null },
      })

      if (context.isManualPRSelection) return
      if (incoming) {
        // Keyed, so this asks whether *this* comparison is held rather than whether any files are
        const needsDiff = !context.diffsByRef[refKey(incoming.baseRefName, incoming.headRefName)]
          || context.diffStale
        if (needsDiff) {
          enqueue.assign({ prBaseBranch: incoming.baseRefName })
          askDiff(enqueue, incoming.baseRefName, incoming.headRefName, incoming.number)
        }
      } else {
        ask(enqueue, 'smartBase', (o) => sendToSystem('code', { type: 'pr.GET_SMART_BASE_BRANCH' }, o))
      }
    }),

    /** Settles the write this answers and runs `then` with it; an answer to no write outstanding changes nothing */
    takeWriteAnswer: enqueueActions(({ enqueue, context, event, self }) => {
      const { recorded, pending } = settleCall(context.writes, event)
      if (recorded === undefined) return
      const comment = commentChangeOf(recorded)
      const thread = threadChangeOf(recorded)
      const answer = writeAnswer(recorded, true)
      // The answered change is GitHub's now: it stays shown until the list is read again
      enqueue.assign({
        ...withWrites(context, pending, {
          ...(comment && { comments: applyComment(context.confirmedComments, comment) }),
          ...(thread && { threads: applyThread(context.confirmedThreads, thread) }),
        }),
        ...(answer && { lastWriteAnswer: answer }),
      })
      const number = context.selectedPR?.number
      if (comment && number !== undefined) ask(enqueue, 'comments', (o) => sendToSystem('code', { type: 'pr.GET_COMMENTS', number }, o))
      if (thread && number !== undefined) ask(enqueue, 'threads', (o) => sendToSystem('code', { type: 'pr.GET_REVIEW_THREADS', number }, o))

      const ev = event as Event
      switch (ev.type) {
        case 'pr.PR_CREATED':
          enqueue.assign(({ context }) => ({
            ...selecting(context, ev.data.pr),
            createTitle: '',
            createBody: '',
            createBaseBranch: '',
            createDraft: false,
            // The newly-created PR is the branch PR, so it is not pinned
            isManualPRSelection: false,
          }))
          askStatus(enqueue)
          break
        case 'pr.PR_MERGED':
        case 'pr.PR_CLOSED': {
          const state = ev.type === 'pr.PR_MERGED' ? 'MERGED' as const : 'CLOSED' as const
          const done = (pr: GhPullRequest | null) => pr?.number === ev.data.number ? { ...pr, state } : pr
          // A picked PR stays picked, so its Delete Branch is there to press
          enqueue.assign(({ context }) => ({ selectedPR: done(context.selectedPR), branchPR: done(context.branchPR) }))
          askStatus(enqueue)
          break
        }
        case 'pr.PR_DRAFT_TOGGLED':
          enqueue.assign(({ context }) => ({
            selectedPR: context.selectedPR?.number === ev.data.number ? { ...context.selectedPR, isDraft: ev.data.isDraft } : context.selectedPR,
          }))
          break
        case 'pr.BRANCH_DELETED':
          enqueue.assign(({ context }) => ({ ...selecting(context, null), branchPR: null, isManualPRSelection: false }))
          break
        case 'pr.PR_UPDATED':
          enqueue.assign(({ context }) => ({
            selectedPR: context.selectedPR?.number === ev.data.number
              ? {
                  ...context.selectedPR,
                  ...(ev.data.title && { title: ev.data.title }),
                  ...(ev.data.body !== undefined && { body: ev.data.body }),
                  ...(ev.data.base && { baseRefName: ev.data.base }),
                }
              : context.selectedPR,
            diffStale: ev.data.base ? true : context.diffStale,
          }))
          if (getParentContext(self)?.baseDirectory) askStatus(enqueue)
          break
      }
    }),

    requestDeleteBranch: enqueueActions(({ enqueue, context }) => {
      const branch = context.selectedPR?.headRefName
      if (!branch) return
      sendWrite(enqueue, { write: 'delete-branch' }, (o) => sendToSystem('code', { type: 'pr.DELETE_BRANCH', branch }, o))
    }),

    checkoutBase: ({ context, self }) => {
      if (!context.selectedPR?.baseRefName) return
      updateParentState(self, { selectedPanel: 'commit' })
      sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName: context.selectedPR.baseRefName })
    },

    /** Shows the files or the pull request; the pull request's discussion is read when the one held is another's */
    setViewMode: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.SET_VIEW_MODE'; mode: 'files' | 'pr' }
      enqueue.assign({ viewMode: ev.mode, prError: null })
      const pr = context.selectedPR
      if (ev.mode !== 'pr' || !pr || context.commentsFor === pr.number || context.asks.details) return
      enqueue.assign({ isLoadingDetails: true })
      ask(enqueue, 'details', (o) => sendToSystem('code', { type: 'pr.SELECT_PR', number: pr.number }, o))
    }),

    newPR: enqueueActions(({ enqueue, context }) => {
      enqueue.assign({
        ...selecting(context, null),
        viewMode: 'pr' as const,
        prError: null,
        createTitle: '',
        createBody: '',
        createDraft: false,
        isManualPRSelection: false,
      })
      ask(enqueue, 'autofill', (o) => sendToSystem('code', { type: 'pr.GET_PR_AUTOFILL' }, o))
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
      asks: ({ context }) => ({ ...context.asks, autofill: null }),
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

    submitCreate: enqueueActions(({ enqueue, event, context }) => {
      sendWrite(enqueue, { write: 'create-pr' }, (o) => sendToSystem('code', {
        type: 'pr.CREATE_PR',
        title: context.createTitle,
        body: context.createBody,
        base: context.createBaseBranch || context.prBaseBranch || undefined,
        draft: event.type === 'pr.SUBMIT_CREATE_DRAFT' ? true : context.createDraft,
      }, o))
    }),

    requestMerge: enqueueActions(({ enqueue, event, context }) => {
      if (!context.selectedPR) return
      const ev = event as { type: 'pr.MERGE'; method?: 'merge' | 'squash' | 'rebase' }
      const number = context.selectedPR.number
      // A refused merge answers with the PR read again, then the refusal
      sendWrite(enqueue, { write: 'merge', number }, (o) => sendToSystem('code', { type: 'pr.MERGE_PR', number, method: ev.method || 'merge' }, o), number)
    }),

    requestClose: enqueueActions(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const number = context.selectedPR.number
      sendWrite(enqueue, { write: 'close', number }, (o) => sendToSystem('code', { type: 'pr.CLOSE_PR', number }, o))
    }),

    requestToggleDraft: enqueueActions(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const { number, isDraft } = context.selectedPR
      sendWrite(enqueue, { write: 'toggle-draft', number }, (o) => sendToSystem('code', { type: 'pr.TOGGLE_DRAFT', number, isDraft }, o), number)
    }),

    requestUpdatePR: enqueueActions(({ enqueue, event }) => {
      const ev = event as { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
      sendWrite(enqueue, { write: 'update-pr', number: ev.number },
        (o) => sendToSystem('code', { type: 'pr.UPDATE_PR', number: ev.number, title: ev.title, body: ev.body, base: ev.base }, o), ev.number)
    }),

    refreshPRDetails: enqueueActions(({ enqueue, event }) => {
      const ev = event as { type: 'pr.REFRESH_PR'; number: number }
      enqueue.assign({ isLoadingDetails: true })
      ask(enqueue, 'details', (o) => sendToSystem('code', { type: 'pr.SELECT_PR', number: ev.number }, o))
    }),

    selectPRAndLoadDiff: enqueueActions(({ enqueue, event }) => {
      const ev = event as { type: 'pr.SELECT_PR_BY_NUMBER'; number: number }
      enqueue.assign({
        isLoadingDetails: true,
        isPrLoading: true,
        viewMode: 'files' as const,
        isManualPRSelection: true,
      })
      ask(enqueue, 'details', (o) => sendToSystem('code', { type: 'pr.SELECT_PR', number: ev.number }, o))
    }),

    backToBranch: enqueueActions(({ enqueue, context }) => {
      enqueue.assign({
        ...selecting(context, null),
        isManualPRSelection: false,
        diffsByRef: {},
        diffStale: true,
        prCheckCompleted: false,
        isCheckingBranchPR: true,
        asks: { ...context.asks, details: null, comments: null, threads: null },
      })
      askStatus(enqueue)
    }),

    // --- Comment and thread writes, shown before they are answered ---

    createComment: enqueueActions(({ enqueue, event }) => {
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
      sendWrite(enqueue, { write: 'create-comment', number: ev.number, comment: { change: 'create', placeholder } },
        (o) => sendToSystem('code', { type: 'pr.CREATE_COMMENT', number: ev.number, body: ev.body }, o))
    }),

    editComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
      const number = context.selectedPR?.number ?? 0
      sendWrite(enqueue, { write: 'edit-comment', number, comment: { change: 'edit', commentId: ev.commentId, body: ev.body } },
        (o) => sendToSystem('code', { type: 'pr.EDIT_COMMENT', commentId: ev.commentId, body: ev.body }, o))
    }),

    deleteComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.DELETE_COMMENT'; commentId: number }
      const number = context.selectedPR?.number ?? 0
      sendWrite(enqueue, { write: 'delete-comment', number, comment: { change: 'delete', commentId: ev.commentId } },
        (o) => sendToSystem('code', { type: 'pr.DELETE_COMMENT', commentId: ev.commentId }, o))
    }),

    replyToThread: enqueueActions(({ enqueue, event }) => {
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
      sendWrite(enqueue, { write: 'reply', number: ev.prNumber, thread: { change: 'reply', commentId: ev.commentId, placeholder } },
        (o) => sendToSystem('code', { type: 'pr.REPLY_TO_THREAD', prNumber: ev.prNumber, commentId: ev.commentId, body: ev.body }, o))
    }),

    resolveThread: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.RESOLVE_THREAD' | 'pr.UNRESOLVE_THREAD'; threadId: string }
      const resolved = ev.type === 'pr.RESOLVE_THREAD'
      sendWrite(enqueue, { write: 'resolve-thread', number: context.selectedPR?.number ?? 0, thread: { change: 'resolve', threadId: ev.threadId, resolved } },
        (o) => resolved
          ? sendToSystem('code', { type: 'pr.RESOLVE_THREAD', threadId: ev.threadId }, o)
          : sendToSystem('code', { type: 'pr.UNRESOLVE_THREAD', threadId: ev.threadId }, o))
    }),

    editReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
      sendWrite(enqueue, { write: 'edit-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'edit', commentId: ev.commentId, body: ev.body } },
        (o) => sendToSystem('code', { type: 'pr.EDIT_REVIEW_COMMENT', commentId: ev.commentId, body: ev.body }, o))
    }),

    deleteReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const ev = event as { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
      sendWrite(enqueue, { write: 'delete-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'delete', commentId: ev.commentId } },
        (o) => sendToSystem('code', { type: 'pr.DELETE_REVIEW_COMMENT', commentId: ev.commentId }, o))
    }),

    /** The discussion read again: shown with the comment writes still unanswered laid over it */
    handleCommentsReceived: assign(({ context, event }) => {
      const ev = event as { type: 'pr.COMMENTS_RECEIVED'; data: { number: number; comments: GhPRComment[] } }
      return {
        ...withWrites(context, context.writes, { comments: ev.data.comments }),
        commentsFor: ev.data.number,
        asks: { ...context.asks, comments: null },
      }
    }),

    /** The review threads read again: shown with the thread writes still unanswered laid over them */
    handleReviewThreadsReceived: assign(({ context, event }) => {
      const ev = event as { type: 'pr.REVIEW_THREADS_RECEIVED'; data: { threads: GhReviewThread[] } }
      return {
        ...withWrites(context, context.writes, { threads: ev.data.threads }),
        asks: { ...context.asks, threads: null },
      }
    }),
  }
}).createMachine({
  id: 'pr',
  initial: 'idle',
  context: { ...folderStart(), commentTab: 'discussion' },
  states: {
    idle: {
      on: {
        'pr.REFRESH_STATUS': { actions: 'refreshStatus' },
        'pr.SELECT_FILE': { actions: ['selectPrFile', assign({ missingFileDiff: null })] },
        'pr.VIEW_DIFF': { actions: 'viewPrDiff' },
        'pr.FILE_CONTENT_MISSING': { actions: 'handleFileContentMissing' },
        'pr.FETCH_MISSING_DIFF': { actions: 'fetchMissingDiff' },
        'pr.OPEN_FILE': { actions: 'openFile' },
        'pr.ERROR': { actions: 'takeError' },
        'pr.BRANCH_DIFF_RECEIVED': { actions: 'handleBranchDiffReceived' },
        'pr.FILE_DIFF_RECEIVED': { actions: 'handleFileDiffReceived' },
        // News: the repository's commits or branches moved
        'pr.GIT_STATUS_REFRESHED': { actions: 'followRepositoryChange' },
        'CODE_STARTED': { actions: 'startFolder' },

        // GitHub PR events from backend
        'pr.CHECK_GITHUB_ACCESS': { actions: 'checkGitHubAccess' },
        'pr.GITHUB_ACCESS_CHECKED': { guard: 'answersTheAccessAsked', actions: 'handleGitHubAccessChecked' },
        'pr.NAVIGATE_TO_HELP': { actions: 'navigateToHelp' },
        'pr.OPEN_PRS_RECEIVED': { guard: 'answersTheOpenPRsAsked', actions: 'handleOpenPRsReceived' },
        'pr.PR_DETAILS_RECEIVED': { actions: 'takeDetails' },
        'pr.BRANCH_PR_CHECKED': { guard: 'answersTheBranchPRAsked', actions: 'handleBranchPRChecked' },
        'pr.SMART_BASE_BRANCH_RECEIVED': { guard: 'answersTheSmartBaseAsked', actions: 'handleSmartBaseBranchReceived' },
        'pr.AUTOFILL_RECEIVED': { guard: 'answersTheAutofillAsked', actions: 'handleAutofillReceived' },
        'pr.COMMENTS_RECEIVED': { guard: 'answersTheCommentsAsked', actions: 'handleCommentsReceived' },
        'pr.REVIEW_THREADS_RECEIVED': { guard: 'answersTheThreadsAsked', actions: 'handleReviewThreadsReceived' },
        'pr.PR_CREATED': { actions: 'takeWriteAnswer' },
        'pr.PR_MERGED': { actions: 'takeWriteAnswer' },
        'pr.PR_CLOSED': { actions: 'takeWriteAnswer' },
        'pr.PR_DRAFT_TOGGLED': { actions: 'takeWriteAnswer' },
        'pr.BRANCH_DELETED': { actions: 'takeWriteAnswer' },
        'pr.PR_UPDATED': { actions: 'takeWriteAnswer' },
        'pr.COMMENT_CREATED': { actions: 'takeWriteAnswer' },
        'pr.COMMENT_EDITED': { actions: 'takeWriteAnswer' },
        'pr.COMMENT_DELETED': { actions: 'takeWriteAnswer' },
        'pr.THREAD_REPLIED': { actions: 'takeWriteAnswer' },
        'pr.THREAD_RESOLVED': { actions: 'takeWriteAnswer' },
        'pr.THREAD_UNRESOLVED': { actions: 'takeWriteAnswer' },
        'pr.REVIEW_COMMENT_EDITED': { actions: 'takeWriteAnswer' },
        'pr.REVIEW_COMMENT_DELETED': { actions: 'takeWriteAnswer' },

        // User actions
        'pr.SELECT_PR_BY_NUMBER': { actions: 'selectPRAndLoadDiff' },
        'pr.SET_VIEW_MODE': { actions: 'setViewMode' },
        'pr.NEW_PR': { actions: 'newPR' },
        'pr.UPDATE_CREATE_FIELD': { actions: 'updateCreateField' },
        'pr.SUBMIT_CREATE': { actions: 'submitCreate' },
        'pr.SUBMIT_CREATE_DRAFT': { actions: 'submitCreate' },
        'pr.MERGE': { actions: 'requestMerge' },
        'pr.CLOSE': { actions: 'requestClose' },
        'pr.TOGGLE_DRAFT': { actions: 'requestToggleDraft' },
        'pr.DELETE_BRANCH': { actions: 'requestDeleteBranch' },
        'pr.CHECKOUT_BASE': { actions: 'checkoutBase' },
        'pr.UPDATE_PR': { actions: 'requestUpdatePR' },
        'pr.CREATE_COMMENT': { actions: 'createComment' },
        'pr.EDIT_COMMENT': { actions: 'editComment' },
        'pr.DELETE_COMMENT': { actions: 'deleteComment' },
        'pr.REPLY_TO_THREAD': { actions: 'replyToThread' },
        'pr.RESOLVE_THREAD': { actions: 'resolveThread' },
        'pr.UNRESOLVE_THREAD': { actions: 'resolveThread' },
        'pr.EDIT_REVIEW_COMMENT': { actions: 'editReviewComment' },
        'pr.DELETE_REVIEW_COMMENT': { actions: 'deleteReviewComment' },
        'pr.SET_COMMENT_TAB': { actions: assign({ commentTab: ({ event }) => (event as { type: 'pr.SET_COMMENT_TAB'; tab: 'discussion' | 'reviews' }).tab }) },
        'pr.REFRESH_PR': { actions: 'refreshPRDetails' },
        'pr.BACK_TO_BRANCH': { actions: 'backToBranch' },
        'pr.CLEAR_ERROR': { actions: assign({ prError: null }) },
      }
    }
  }
});

/** The pull-request child's actor, named by whoever reads its context (`codeChild(…)`) */
export type PullRequestActor = ActorRefFrom<typeof pullRequestState>;
