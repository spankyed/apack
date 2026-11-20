import type { GitHubApiFailure, PRListState } from '#features/code/be/services/github-api.ts'
import { setup, assign, enqueueActions , type ActorRefFrom } from 'xstate';
import { answerOf, answersCall, isAnswered, newCall, recordCall, settleCall, type AnswersOf, type CallOptions } from '@apackdev/sdk/events';
import type { Contract as CodeSystemContract, PRDetails, PullRequestAsks } from '#features/code/be/contract.ts';
import { sendToSystem } from '#generated/events.ts';
import type { GitStatusFile, GitDiff } from '../commit/state.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread, PRBranchCheckout } from '#generated/types.ts';
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
const ASKS = ['details', 'comments', 'threads', 'smartBase', 'branchPR', 'access', 'autofill'] as const
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
  | { write: 'checkout'; number: number }
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
    case 'edit': return comments.map(c => getCommentDatabaseId(c) === change.commentId ? { ...c, body: change.body, rawBody: change.body } : c)
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
    isCheckingOut: any('checkout'),
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

  prList: listStart(),
  lastCheckout: null,
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

/**
 * The pull request list the dropdown shows: what it is filtered and searched by, the pages read of it so far, and
 * the ask for the next. Read when the dropdown opens and whenever its filter or search changes; nobody sees it shut
 */
export interface PRList {
  state: PRListState
  query: string
  prs: GhPullRequest[]
  /** GitHub's cursor for the page after the last read, `null` once the last page is read */
  next: string | null
  /** The ask for a page, while it is unanswered: whether its page follows the ones read, or starts the list again */
  asked: { call: string; append: boolean } | null
  /** Whether a page has been read for the filter and search shown */
  read: boolean
}

const listStart = (): PRList => ({ state: 'open', query: '', prs: [], next: null, asked: null, read: false })

/** `more` after `prs`, each pull request once: one opened between two pages moves the second's down one */
const joined = (prs: GhPullRequest[], more: GhPullRequest[]): GhPullRequest[] => {
  const shown = new Set(prs.map(pr => pr.number))
  return [...prs, ...more.filter(pr => !shown.has(pr.number))]
}

/** Whether the app's GitHub sign-in can work with this repository's pull requests: `ok`, or why not */
export type GitHubAccess = 'ok' | GitHubApiFailure

/** GitHub's reasons a refusal is about the sign-in or the repository, not the ask: shown as the access is */
const ACCESS_FAILURES: readonly GitHubApiFailure[] = ['signed-out', 'not-github', 'missing-scope', 'sso']

/**
 * Whether the pull request's branch is one the panel offers to delete: a closed or merged one's, a branch of the
 * repository the checkout's remote names, that no other open pull request is from as the backend last read them.
 * Where it has not read them, the backend asks GitHub the same before it deletes, and says why it will not
 */
export const branchDeletable = (pr: GhPullRequest | null): boolean =>
  !!pr && pr.state !== 'OPEN' && pr.headInRemote === true && (pr.openFromSameHead ?? []).length === 0

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
  prList: PRList
  /** The last pull request checked out from the panel, as the branch it became and what that did to it */
  lastCheckout: { number: number; branch: string; checkout: PRBranchCheckout } | null
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
  isCheckingOut: boolean
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
  | { type: 'pr.OPEN_FILE'; file: GitStatusFile }
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }
  | { type: 'CODE_STARTED' }
  // The answers to the panel's asks of the code system
  | AnswersOf<CodeSystemContract, keyof PullRequestAsks>
  | { type: 'pr.CHECK_GITHUB_ACCESS' }
  | { type: 'pr.NAVIGATE_TO_HELP' }
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
  /** Checks out the pull request shown as a branch here */
  | { type: 'pr.CHECKOUT' }
  /** The list was opened: it is read for the filter and search it shows */
  | { type: 'pr.LIST_SHOWN' }
  | { type: 'pr.SET_LIST_STATE'; state: PRListState }
  | { type: 'pr.SET_LIST_QUERY'; query: string }
  | { type: 'pr.LOAD_MORE_PRS' }
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

/**
 * The details of a pull request an answer carries: the ones asked for, those a write read again once GitHub had
 * settled, or those a refused merge read so the panel shows what refused it
 */
function detailsIn(event: Event): PRDetails | undefined {
  if (isAnswered(event, 'pr.SELECT_PR')) return answerOf(event, 'pr.SELECT_PR')
  if (isAnswered(event, 'pr.TOGGLE_DRAFT')) return answerOf(event, 'pr.TOGGLE_DRAFT').details
  if (isAnswered(event, 'pr.UPDATE_PR')) return answerOf(event, 'pr.UPDATE_PR').details
  if (event.type === 'ASK_FAILED' && event.asked === 'pr.MERGE_PR' && event.failure.kind === 'github') return event.failure.details
  return undefined
}

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

/** Asks for the branch's own pull request */
function askStatus(enqueue: Enqueue): void {
  ask(enqueue, 'branchPR', (o) => sendToSystem('code', { type: 'pr.CHECK_BRANCH_PR' }, o))
}

/**
 * Asks for a page of the list as `list` filters and searches it: the first, which starts it again, or the one
 * after those read. The ask replaces any unanswered, so only the page for what is shown is taken
 */
function askList(enqueue: Enqueue, list: Pick<PRList, 'state' | 'query' | 'next'>, append: boolean): void {
  const call = newCall()
  const after = append ? list.next ?? undefined : undefined
  enqueue.assign(({ context }) => ({ prList: { ...context.prList, state: list.state, query: list.query, asked: { call, append } } }))
  enqueue(() => {
    sendToSystem('code', { type: 'pr.LIST_PRS', state: list.state, ...(list.query.trim() && { query: list.query.trim() }), ...(after && { after }) }, { call })
  })
}

/**
 * Sends `event` as a write, shown at once where it carries a change. `refreshes` names the pull request
 * whose details its answer may bring read again.
 */
function sendWrite(enqueue: Enqueue, write: PullRequestWrite, send: Send, refreshes?: number): void {
  const call = newCall()
  enqueue.assign(({ context }) => ({
    // A write is the user acting on what the panel said, so what it said goes: a merge retried after "nothing
    // was merged" must not leave that beside the pull request it merged. The write brings its own answer
    prError: null,
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
      if (event.type !== 'ASK_FAILED' || event.asked !== 'pr.GET_BRANCH_FILE_DIFF' || event.failure.kind !== 'content-missing') return
      const { kind: _kind, message: _message, ...where } = event.failure
      const { recorded, pending } = settleCall(context.fileDiffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({ fileDiffAsks: pending, missingFileDiff: where })
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
     * change comes off what is shown. Its message is shown whatever it answers, an earlier ask's included: as the
     * GitHub access, where GitHub's reason is the sign-in or the repository, and as the panel's error otherwise.
     */
    takeError: enqueueActions(({ enqueue, context, event }) => {
      if (event.type !== 'ASK_FAILED') return
      const { failure } = event
      const reason = failure.kind === 'github' ? (failure as { reason: GitHubApiFailure }).reason : undefined
      const updates: Partial<CodePullRequestContext> = reason && ACCESS_FAILURES.includes(reason)
        ? { githubAccess: reason, githubAccessMessage: failure.message }
        : { prError: failure.message }
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

      if (answersCall(event, context.prList.asked?.call ?? null)) updates.prList = { ...context.prList, asked: null }

      const write = settleCall(context.writes, event)
      if (write.recorded !== undefined) {
        Object.assign(updates, withWrites(context, write.pending))
        const answer = writeAnswer(write.recorded, false)
        if (answer) updates.lastWriteAnswer = answer
      }
      enqueue.assign(updates)
    }),

    handleSmartBaseBranchReceived: enqueueActions(({ enqueue, event, context }) => {
      const newBase = answerOf(event, 'pr.GET_SMART_BASE_BRANCH').branch
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
      const { files } = answerOf(event, 'pr.GET_BRANCH_DIFF')
      const { recorded, pending } = settleCall(context.diffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({
        diffAsks: pending,
        diffsByRef: { ...context.diffsByRef, [recorded]: files },
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
      const diff: GitDiff = answerOf(event, 'pr.GET_BRANCH_FILE_DIFF')
      const { recorded, pending } = settleCall(context.fileDiffAsks, event)
      if (recorded === undefined) return
      enqueue.assign({ fileDiffAsks: pending })
      const selected = context.selectedPrFile
      if (selected?.path !== diff.path) return
      enqueue(() => {
        const diffTab = {
          path: `pr-diff:${selected.path}`,
          content: '',
          modified: false,
          isDiff: true,
          isPrDiff: true,
          gitDiff: diff,
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

    handleGitHubAccessChecked: assign(({ context, event }) => {
      const { access, message } = answerOf(event, 'pr.CHECK_GITHUB_ACCESS')
      return { githubAccess: access, githubAccessMessage: message ?? null, asks: { ...context.asks, access: null } }
    }),

    navigateToHelp: () => {
      untypedOpenSurface(HOST_SETTINGS, [{ type: 'TAB.SELECT', tab: 'help' }]);
    },

    /** A page of the list, after the ones read where it was asked as the next, and as the list otherwise */
    takeListPage: assign(({ context, event }) => {
      const page = answerOf(event, 'pr.LIST_PRS')
      const list = context.prList
      return { prList: { ...list, prs: list.asked?.append ? joined(list.prs, page.prs) : page.prs, next: page.next, asked: null, read: true } }
    }),

    showList: enqueueActions(({ enqueue, context }) => {
      askList(enqueue, context.prList, false)
    }),

    setListState: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.SET_LIST_STATE'; state: PRListState }
      if (ev.state === context.prList.state) return
      enqueue.assign({ prList: { ...context.prList, state: ev.state, prs: [], next: null, read: false } })
      askList(enqueue, { ...context.prList, state: ev.state }, false)
    }),

    setListQuery: enqueueActions(({ enqueue, context, event }) => {
      const ev = event as { type: 'pr.SET_LIST_QUERY'; query: string }
      if (ev.query.trim() === context.prList.query.trim()) return
      enqueue.assign({ prList: { ...context.prList, query: ev.query, prs: [], next: null, read: false } })
      askList(enqueue, { ...context.prList, query: ev.query }, false)
    }),

    /** The page after those read, where there is one and no page is being asked for */
    loadMorePRs: enqueueActions(({ enqueue, context }) => {
      const list = context.prList
      if (!list.next || list.asked) return
      askList(enqueue, list, true)
    }),

    /**
     * Takes a pull request's details when they answer the latest ask for them, or a write's re-read of the
     * pull request still shown (`detailsIn`) — and not when an answer accepted for that number was fetched later.
     * Then asks for its diff and its review threads.
     *
     * **It sets `prBaseBranch`, and that is load-bearing.** The base the view is on is half the key its
     * files are read under; every asker names the base it is asking about, and no answer does.
     */
    takeDetails: enqueueActions(({ enqueue, event, context }) => {
      const asked = answersCall(event, context.asks.details)
      const refresh = settleCall(context.detailRefreshes, event)
      enqueue.assign({
        detailRefreshes: refresh.pending,
        ...(asked && { asks: { ...context.asks, details: null }, isLoadingDetails: false }),
      })
      const details = detailsIn(event)
      if (!details) return
      const prNumber = details.pr.number
      const refreshed = refresh.recorded === prNumber && context.selectedPR?.number === prNumber
      if (!asked && !refreshed) return
      if (details.fetchedAt < (context.latestPrDetailsFetchedAt[prNumber] ?? 0)) return
      enqueue.assign(({ context }) => {
        const left = selecting(context, details.pr)
        const held = { ...context, ...left }
        return {
          ...left,
          ...withWrites(held, held.writes, { comments: details.comments }),
          commentsFor: prNumber,
          latestPrDetailsFetchedAt: { ...context.latestPrDetailsFetchedAt, [prNumber]: details.fetchedAt },
          prBaseBranch: details.pr.baseRefName,
        }
      })
      askDiff(enqueue, details.pr.baseRefName, details.pr.headRefName, prNumber)
      ask(enqueue, 'threads', (o) => sendToSystem('code', { type: 'pr.GET_REVIEW_THREADS', number: prNumber }, o))
    }),

    handleBranchPRChecked: enqueueActions(({ enqueue, event, context }) => {
      const incoming = answerOf(event, 'pr.CHECK_BRANCH_PR').pr
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

      if (isAnswered(event, 'pr.CREATE_PR')) {
        const { pr } = answerOf(event, 'pr.CREATE_PR')
        enqueue.assign(({ context }) => ({
          ...selecting(context, pr),
          createTitle: '',
          createBody: '',
          createBaseBranch: '',
          createDraft: false,
          // The newly-created PR is the branch PR, so it is not pinned
          isManualPRSelection: false,
        }))
        askStatus(enqueue)
      } else if (isAnswered(event, 'pr.MERGE_PR') || isAnswered(event, 'pr.CLOSE_PR')) {
        const state = event.asked === 'pr.MERGE_PR' ? 'MERGED' as const : 'CLOSED' as const
        const { number } = event.answer
        const done = (pr: GhPullRequest | null) => pr?.number === number ? { ...pr, state } : pr
        // A picked PR stays picked, so its Delete Branch is there to press
        enqueue.assign(({ context }) => ({ selectedPR: done(context.selectedPR), branchPR: done(context.branchPR) }))
        askStatus(enqueue)
      } else if (isAnswered(event, 'pr.TOGGLE_DRAFT')) {
        const { number, isDraft } = answerOf(event, 'pr.TOGGLE_DRAFT')
        enqueue.assign(({ context }) => ({
          selectedPR: context.selectedPR?.number === number ? { ...context.selectedPR, isDraft } : context.selectedPR,
        }))
      } else if (isAnswered(event, 'pr.DELETE_BRANCH')) {
        enqueue.assign(({ context }) => ({ ...selecting(context, null), branchPR: null, isManualPRSelection: false }))
      } else if (isAnswered(event, 'pr.CHECKOUT_PR')) {
        // The pull request stays shown, picked or not: a fork's is checked out as `pr/<n>`, which is no branch
        // GitHub has a pull request from, and the checkout's announcement asks for the branch's own
        enqueue.assign({ lastCheckout: answerOf(event, 'pr.CHECKOUT_PR') })
      } else if (isAnswered(event, 'pr.UPDATE_PR')) {
        const { number, title, body, base } = answerOf(event, 'pr.UPDATE_PR')
        enqueue.assign(({ context }) => ({
          selectedPR: context.selectedPR?.number === number
            ? {
                ...context.selectedPR,
                ...(title && { title }),
                ...(body !== undefined && { body, rawBody: body }),
                ...(base && { baseRefName: base }),
              }
            : context.selectedPR,
          diffStale: base ? true : context.diffStale,
        }))
        if (getParentContext(self)?.baseDirectory) askStatus(enqueue)
      }
    }),

    /** Deletes the pull request's branch, where the panel offers it (`branchDeletable`); the view has asked first */
    requestDeleteBranch: enqueueActions(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || !branchDeletable(pr)) return
      sendWrite(enqueue, { write: 'delete-branch' }, (o) => sendToSystem('code', { type: 'pr.DELETE_BRANCH', number: pr.number }, o))
    }),

    /** Checks out the open pull request shown as a branch here, once at a time */
    requestCheckout: enqueueActions(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || pr.state !== 'OPEN' || context.isCheckingOut) return
      enqueue.assign({ lastCheckout: null })
      sendWrite(enqueue, { write: 'checkout', number: pr.number }, (o) => sendToSystem('code', { type: 'pr.CHECKOUT_PR', number: pr.number }, o))
    }),

    checkoutBase: ({ context, self }) => {
      if (!context.selectedPR?.baseRefName) return
      updateParentState(self, { selectedPanel: 'commit' })
      // "Checkout & Pull Base": the pull is asked for, a checkout pulling nothing by itself
      sendToSystem('code', { type: 'commit.CHECKOUT_BRANCH', branchName: context.selectedPR.baseRefName, pull: true })
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

    handleAutofillReceived: assign(({ context, event }) => {
      const { title, body } = answerOf(event, 'pr.GET_PR_AUTOFILL')
      return { createTitle: context.createTitle || title, createBody: context.createBody || body, asks: { ...context.asks, autofill: null } }
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
      const { number, headRefOid: sha } = context.selectedPR
      // The head shown is the one merged: GitHub refuses where it has moved since. A refused merge answers with the
      // PR read again, then the refusal
      sendWrite(enqueue, { write: 'merge', number }, (o) => sendToSystem('code', { type: 'pr.MERGE_PR', number, method: ev.method || 'merge', ...(sha && { sha }) }, o), number)
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
      const { number, comments } = answerOf(event, 'pr.GET_COMMENTS')
      return {
        ...withWrites(context, context.writes, { comments }),
        commentsFor: number,
        asks: { ...context.asks, comments: null },
      }
    }),

    /** The review threads read again: shown with the thread writes still unanswered laid over them */
    handleReviewThreadsReceived: assign(({ context, event }) => {
      const { threads } = answerOf(event, 'pr.GET_REVIEW_THREADS')
      return {
        ...withWrites(context, context.writes, { threads }),
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
        'pr.FETCH_MISSING_DIFF': { actions: 'fetchMissingDiff' },
        'pr.OPEN_FILE': { actions: 'openFile' },
        // News: the repository's commits or branches moved
        'pr.GIT_STATUS_REFRESHED': { actions: 'followRepositoryChange' },
        'CODE_STARTED': { actions: 'startFolder' },

        // The answers to the panel's asks. A read is taken when it answers the latest ask of it; a write's answer
        // settles that write, and a write that read the pull request again brings its details
        ASK_ANSWERED: [
          { guard: ({ event }) => isAnswered(event, 'pr.GET_BRANCH_DIFF'), actions: 'handleBranchDiffReceived' },
          { guard: ({ event }) => isAnswered(event, 'pr.GET_BRANCH_FILE_DIFF'), actions: 'handleFileDiffReceived' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.CHECK_GITHUB_ACCESS') && answersCall(event, context.asks.access), actions: 'handleGitHubAccessChecked' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.LIST_PRS') && answersCall(event, context.prList.asked?.call ?? null), actions: 'takeListPage' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.CHECK_BRANCH_PR') && answersCall(event, context.asks.branchPR), actions: 'handleBranchPRChecked' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.GET_SMART_BASE_BRANCH') && answersCall(event, context.asks.smartBase), actions: 'handleSmartBaseBranchReceived' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.GET_PR_AUTOFILL') && answersCall(event, context.asks.autofill), actions: 'handleAutofillReceived' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.GET_COMMENTS') && answersCall(event, context.asks.comments), actions: 'handleCommentsReceived' },
          { guard: ({ context, event }) => isAnswered(event, 'pr.GET_REVIEW_THREADS') && answersCall(event, context.asks.threads), actions: 'handleReviewThreadsReceived' },
          { guard: ({ event }) => isAnswered(event, 'pr.SELECT_PR'), actions: 'takeDetails' },
          // The write is the pull request's before the details it read again are taken over it
          { guard: ({ event }) => isAnswered(event, 'pr.TOGGLE_DRAFT') || isAnswered(event, 'pr.UPDATE_PR'), actions: ['takeWriteAnswer', 'takeDetails'] },
          { actions: 'takeWriteAnswer' },
        ],
        ASK_FAILED: [
          {
            guard: ({ event }) => event.asked === 'pr.GET_BRANCH_FILE_DIFF' && event.failure.kind === 'content-missing',
            actions: 'handleFileContentMissing',
          },
          // A read of the discussion after a write that landed: its failure is no error of the write's to show
          {
            guard: ({ event }) => event.asked === 'pr.GET_COMMENTS',
            actions: assign(({ context, event }) => answersCall(event, context.asks.comments) ? { asks: { ...context.asks, comments: null } } : {}),
          },
          // A refused merge brings the pull request read again, shown with the refusal
          { guard: ({ event }) => event.asked === 'pr.MERGE_PR', actions: ['takeDetails', 'takeError'] },
          { actions: 'takeError' },
        ],
        'pr.CHECK_GITHUB_ACCESS': { actions: 'checkGitHubAccess' },
        'pr.NAVIGATE_TO_HELP': { actions: 'navigateToHelp' },

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
        'pr.CHECKOUT': { actions: 'requestCheckout' },
        'pr.LIST_SHOWN': { actions: 'showList' },
        'pr.SET_LIST_STATE': { actions: 'setListState' },
        'pr.SET_LIST_QUERY': { actions: 'setListQuery' },
        'pr.LOAD_MORE_PRS': { actions: 'loadMorePRs' },
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
