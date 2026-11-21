import type { GitHubApiFailure, PRListState } from '#features/code/be/services/github-api.ts'
import { setup, assign, type ActorRefFrom, type DoneActorEvent } from 'xstate';
import type { AskOutcome } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { Contract as CodeSystemContract, PRDetails, PRFileDiffWhere, PullRequestAsks } from '#features/code/be/contract.ts';
import { fromAsk } from '#generated/events.ts';
import type { GitStatusFile, GitDiff } from '../commit/state.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread, PRBranchCheckout } from '#generated/types.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { askId, askUnderWay, enqueueAsks, noAsks, stopAsks, untypedOpenSurface, type AsksUnderWay } from '@apackdev/sdk/fe'
import { resolveName } from '@apackdev/sdk/ids'
import { getCommentDatabaseId } from './comment-id.ts';

const HOST_SETTINGS = resolveName('settings', 'host');

export type { GhPullRequest, GhPRComment }

let placeholderIdCounter = -1

/**
 * What a diff was asked for, as a key: GitHub's own `base...head` compare spelling, with the head absent
 * for a branch that has no PR.
 *
 * **A key, not a staleness check, and the difference is load-bearing.** A diff is a view fetching data, and
 * the rule for that job is a slot keyed by what was asked (`packages/default-setup/CLAUDE.md`): a late
 * answer writes its own key, the view reads the key it is showing, and correlation is structural rather
 * than checked. The key an answer writes is the one recorded for its ask (`diffAsks`), never one read off the
 * answer, so an answer cannot name a slot nobody asked for.
 */
export const refKey = (base: string, head?: string): string => `${base}...${head ?? ''}`

/** The same, for one file within that comparison — a file diff opens a tab, so it is tracked per request */
export const fileKey = (base: string, head: string | undefined, path: string): string =>
  `${refKey(base, head)}#${path}`

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
 * A write the panel sent and GitHub has not answered, recorded under the id its ask runs as. A comment or thread write
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
 * its discussion, its threads, the comment writes shown over them, and the file diffs asked of it — so
 * nothing of one pull request is shown, or written, on the next. Whoever calls stops waiting on the
 * discussion asked for (`leaveDiscussion`).
 */
const selecting = (context: CodePullRequestContext, next: GhPullRequest | null): Partial<CodePullRequestContext> => {
  if (next?.number === context.selectedPR?.number) return { selectedPR: next }
  const writes = Object.fromEntries(Object.entries(context.writes).filter(([, w]) => !commentChangeOf(w) && !threadChangeOf(w)))
  return {
    selectedPR: next,
    ...withWrites(context, writes, { comments: [], threads: [] }),
    commentsFor: null,
    detailRefreshes: {},
    fileDiffAsks: {},
    missingFileDiff: null,
  }
}

/** The pull request panel is the one the code surface shows */
const panelShown = (self: unknown): boolean => getParentContext(self)?.selectedPanel === 'pr'

/** Everything that belongs to the folder open, as it is before anything is known of it */
const folderStart = (): Omit<CodePullRequestContext, 'commentTab' | 'asking'> => ({
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
  diffStale: false,

  isManualPRSelection: false,
  detailRefreshes: {},
  latestPrDetailsFetchedAt: {},
})

/**
 * The pull request list the dropdown shows: what it is filtered and searched by, and the pages read of it so far.
 * Read when the dropdown opens and whenever its filter or search changes; nobody sees it shut. Whether a page is
 * being read is whether the machine holds the read of its first page (`LIST`) or of the page after (`LIST_MORE`)
 */
export interface PRList {
  state: PRListState
  query: string
  prs: GhPullRequest[]
  /** GitHub's cursor for the page after the last read, `null` once the last page is read */
  next: string | null
  /** Whether a page has been read for the filter and search shown */
  read: boolean
}

const listStart = (): PRList => ({ state: 'open', query: '', prs: [], next: null, read: false })

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
  /** The ids of the asks this machine spawned that are under way, kept by `enqueueAsks` and `stopAsks` */
  asking: AsksUnderWay
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
  /** The branch diffs asked for and unanswered, by the id each ask runs as: the comparison (`refKey`) its answer is written under */
  diffAsks: Record<string, string>
  /**
   * The file diffs asked for and unanswered, by the id each ask runs as: each one's `fileKey`.
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
  /** The writes sent and unanswered, by the id each one's ask runs as */
  writes: Record<string, PullRequestWrite>
  /** How the last write a form waits on was answered */
  lastWriteAnswer: WriteAnswer | null
  diffStale: boolean

  // PR selection tracking
  /** The user picked the pull request shown, so the branch's own does not replace it until they leave it */
  isManualPRSelection: boolean

  /**
   * The writes whose answer may bring the pull request's details read again after it, by id: the number
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

// The asks the panel has one of at a time, each a child of the machine under the id here for as long as it is under
// way (`askUnderWay`): asking a read again stops the one before, and stopping one stops waiting on its answer
export const DETAILS = 'details'
const COMMENTS = 'comments'
const THREADS = 'threads'
const BRANCH_PR = 'branchPR'
const SMART_BASE = 'smartBase'
const ACCESS = 'access'
const AUTOFILL = 'autofill'
/** The list's first page for the filter and search shown */
export const LIST = 'list'
/** The page after those read */
export const LIST_MORE = 'listMore'
/** The checkout of the base branch of the pull request shown */
const CHECKOUT_BASE = 'checkoutBase'

/** Every read: what a folder opening stops waiting on */
const READS = [DETAILS, COMMENTS, THREADS, BRANCH_PR, SMART_BASE, ACCESS, AUTOFILL, LIST, LIST_MORE] as const

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
  | { type: 'pr.CLEAR_ERROR' }
  // What the machine tells itself: a read to ask for, and reads no longer waited on
  | { type: 'pr.read.DETAILS'; number: number; unlessAsking?: true }
  | { type: 'pr.read.COMMENTS'; number: number }
  | { type: 'pr.read.THREADS'; number: number }
  | { type: 'pr.read.BRANCH_PR' }
  | { type: 'pr.read.SMART_BASE' }
  | { type: 'pr.read.AUTOFILL' }
  | { type: 'pr.ask.DIFF'; baseBranch: string; headBranch?: string; prNumber?: number }
  | ({ type: 'pr.ask.FILE_DIFF'; fetchMissing?: boolean } & PRFileDiffWhere)
  // How each read ended, and the checkout of the base
  | ReadDone<typeof DETAILS, 'pr.SELECT_PR'>
  | ReadDone<typeof COMMENTS, 'pr.GET_COMMENTS'>
  | ReadDone<typeof THREADS, 'pr.GET_REVIEW_THREADS'>
  | ReadDone<typeof BRANCH_PR, 'pr.CHECK_BRANCH_PR'>
  | ReadDone<typeof SMART_BASE, 'pr.GET_SMART_BASE_BRANCH'>
  | ReadDone<typeof ACCESS, 'pr.CHECK_GITHUB_ACCESS'>
  | ReadDone<typeof AUTOFILL, 'pr.GET_PR_AUTOFILL'>
  | ReadDone<typeof LIST, 'pr.LIST_PRS'>
  | ReadDone<typeof LIST_MORE, 'pr.LIST_PRS'>
  | DoneActorEvent<AskOutcome<CodeSystemContract['asks']['commit.CHECKOUT_BRANCH']>, typeof CHECKOUT_BASE>
  | { type: 'pr.DETAILS_LEFT' }
  | { type: 'pr.DISCUSSION_LEFT' }
  | { type: 'pr.READS_LEFT' }
  // How each ask spawned beside others of its kind ended, under the id it ran as
  | SpawnedAskDone<'diff', 'pr.GET_BRANCH_DIFF'>
  | SpawnedAskDone<'fileDiff', 'pr.GET_BRANCH_FILE_DIFF'>
  | SpawnedAskDone<'createPR', 'pr.CREATE_PR'>
  | SpawnedAskDone<'merge', 'pr.MERGE_PR'>
  | SpawnedAskDone<'close', 'pr.CLOSE_PR'>
  | SpawnedAskDone<'toggleDraft', 'pr.TOGGLE_DRAFT'>
  | SpawnedAskDone<'deleteBranch', 'pr.DELETE_BRANCH'>
  | SpawnedAskDone<'checkout', 'pr.CHECKOUT_PR'>
  | SpawnedAskDone<'updatePR', 'pr.UPDATE_PR'>
  | SpawnedAskDone<'comment', 'pr.CREATE_COMMENT' | 'pr.EDIT_COMMENT' | 'pr.DELETE_COMMENT'>
  | SpawnedAskDone<'thread', 'pr.REPLY_TO_THREAD' | 'pr.RESOLVE_THREAD' | 'pr.UNRESOLVE_THREAD' | 'pr.EDIT_REVIEW_COMMENT' | 'pr.DELETE_REVIEW_COMMENT'>;

/** The event the read spawned as `Id` ends with */
type ReadDone<Id extends string, K extends keyof PullRequestAsks> = DoneActorEvent<AskOutcome<PullRequestAsks[K]>, Id>

/** The event a spawned ask ends with: `actorId` is the id it ran as, `<prefix>.<n>`, and `output` how it ended */
type SpawnedAskDone<P extends string, K extends keyof PullRequestAsks> = {
  type: `xstate.done.actor.${P}.${string}`
  actorId: string
  output: { [A in K]: AskOutcome<PullRequestAsks[A]> }[K]
}


/** What an `enqueueActions` body is handed that the helpers below use */
interface Enqueue {
  assign: (values: Partial<CodePullRequestContext> | ((args: { context: CodePullRequestContext }) => Partial<CodePullRequestContext>)) => void
  raise: (event: Event) => void
}

const typeOf = safeEvents<Event>()

/** The done event of an ask spawned under `<prefix>.<n>`, for an action handed the machine's whole event union */
function doneOf<P extends string>(prefix: P, event: Event): Extract<Event, { type: `xstate.done.actor.${P}.${string}` }> {
  if (!event.type.startsWith(`xstate.done.actor.${prefix}.`)) throw new Error(`Expected the end of a ${prefix} ask, got ${event.type}`)
  return event as Extract<Event, { type: `xstate.done.actor.${P}.${string}` }>
}

/** `asks` without the one that ran as `id`, and what was recorded for it: nothing, for an ask this machine no longer waits on */
const settled = <T>(asks: Record<string, T>, id: string): { recorded: T | undefined; pending: Record<string, T> } => {
  const { [id]: recorded, ...pending } = asks
  return { recorded, pending }
}

/**
 * A failure as the panel shows it: as the GitHub access, where GitHub's reason is the sign-in or the repository, and
 * as the panel's error otherwise
 */
const failureShown = (failure: { kind: string; message: string; reason?: GitHubApiFailure }): Partial<CodePullRequestContext> => {
  const reason = failure.kind === 'github' ? failure.reason : undefined
  return reason && ACCESS_FAILURES.includes(reason)
    ? { githubAccess: reason, githubAccessMessage: failure.message }
    : { prError: failure.message }
}

/** Asks for the branch's own pull request */
const askStatus = (enqueue: Enqueue): void => enqueue.raise({ type: 'pr.read.BRANCH_PR' })

/** Asks for a branch diff, whose answer is written under the comparison asked for */
const askDiff = (enqueue: Enqueue, baseBranch: string, headBranch?: string, prNumber?: number): void =>
  enqueue.raise({ type: 'pr.ask.DIFF', baseBranch, ...(headBranch && { headBranch }), ...(prNumber && { prNumber }) })

/** Stops waiting on the discussion asked for where `next` is another pull request than the one shown: its answers are the other's */
const leaveDiscussion = (enqueue: Enqueue, context: CodePullRequestContext, next: GhPullRequest | null): void => {
  if (next?.number !== context.selectedPR?.number) enqueue.raise({ type: 'pr.DISCUSSION_LEFT' })
}

/**
 * Records a write as sent, shown at once where it carries a change; whoever calls spawns its ask under `id`.
 * `refreshes` names the pull request whose details its answer may bring read again.
 */
function recordWrite(enqueue: Enqueue, id: string, write: PullRequestWrite, refreshes?: number): void {
  enqueue.assign(({ context }) => ({
    // A write is the user acting on what the panel said, so what it said goes: a merge retried after "nothing
    // was merged" must not leave that beside the pull request it merged. The write brings its own answer
    prError: null,
    ...withWrites(context, { ...context.writes, [id]: write }),
    ...(refreshes !== undefined && { detailRefreshes: { ...context.detailRefreshes, [id]: refreshes } }),
  }))
}

/**
 * Takes a pull request's details — the ones asked for, or a write's re-read of the pull request still shown — unless
 * an answer accepted for that number was fetched later. Then asks for its diff and its review threads.
 *
 * **It sets `prBaseBranch`, and that is load-bearing.** The base the view is on is half the key its
 * files are read under; every asker names the base it is asking about, and no answer does.
 */
function takeDetails(enqueue: Enqueue, context: CodePullRequestContext, details: PRDetails): void {
  const prNumber = details.pr.number
  if (details.fetchedAt < (context.latestPrDetailsFetchedAt[prNumber] ?? 0)) return
  leaveDiscussion(enqueue, context, details.pr)
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
  enqueue.raise({ type: 'pr.read.THREADS', number: prNumber })
}

/**
 * Ends the write that ran as `id`: off the writes shown as unanswered, with the form waiting on it told how it went.
 * A write that was done leaves its change shown as GitHub's until the list is read again, which is then asked for;
 * one that was not takes its change back and says why. Answers with the write, or nothing for one no longer waited on
 */
function endWrite(enqueue: Enqueue, context: CodePullRequestContext, id: string, outcome: { ok: true } | { ok: false; failure: { kind: string; message: string; reason?: GitHubApiFailure } }): PullRequestWrite | undefined {
  const { recorded } = settled(context.writes, id)
  enqueue.assign(({ context }) => ({ detailRefreshes: settled(context.detailRefreshes, id).pending }))
  if (!outcome.ok) enqueue.assign(failureShown(outcome.failure))
  if (recorded === undefined) return undefined
  const answer = writeAnswer(recorded, outcome.ok)
  const comment = outcome.ok ? commentChangeOf(recorded) : undefined
  const thread = outcome.ok ? threadChangeOf(recorded) : undefined
  // Read as it is when this runs: details taken before it in the same step are not written over
  enqueue.assign(({ context }) => ({
    ...withWrites(context, settled(context.writes, id).pending, {
      ...(comment && { comments: applyComment(context.confirmedComments, comment) }),
      ...(thread && { threads: applyThread(context.confirmedThreads, thread) }),
    }),
    ...(answer && { lastWriteAnswer: answer }),
  }))
  const number = context.selectedPR?.number
  if (comment && number !== undefined) enqueue.raise({ type: 'pr.read.COMMENTS', number })
  if (thread && number !== undefined) enqueue.raise({ type: 'pr.read.THREADS', number })
  return recorded
}

/** Whether the details a write read again are of the pull request it wrote to, still shown */
const refreshes = (context: CodePullRequestContext, id: string, details: PRDetails | undefined): details is PRDetails =>
  !!details && context.detailRefreshes[id] === details.pr.number && context.selectedPR?.number === details.pr.number

const machine = setup({
  types: {
    context: {} as CodePullRequestContext,
    events: {} as Event
  },
  actors: {
    // The reads, each spawned under its own id: the latest ask of one is the one waited on
    readDetails: fromAsk('code', 'pr.SELECT_PR'),
    readComments: fromAsk('code', 'pr.GET_COMMENTS'),
    readThreads: fromAsk('code', 'pr.GET_REVIEW_THREADS'),
    readSmartBase: fromAsk('code', 'pr.GET_SMART_BASE_BRANCH'),
    readBranchPR: fromAsk('code', 'pr.CHECK_BRANCH_PR'),
    readAccess: fromAsk('code', 'pr.CHECK_GITHUB_ACCESS'),
    readAutofill: fromAsk('code', 'pr.GET_PR_AUTOFILL'),
    readList: fromAsk('code', 'pr.LIST_PRS'),
    checkoutBranch: fromAsk('code', 'commit.CHECKOUT_BRANCH'),
    // The asks spawned beside others of their kind: a diff per comparison, a diff per file, and each write
    readDiff: fromAsk('code', 'pr.GET_BRANCH_DIFF'),
    readFileDiff: fromAsk('code', 'pr.GET_BRANCH_FILE_DIFF'),
    createPR: fromAsk('code', 'pr.CREATE_PR'),
    mergePR: fromAsk('code', 'pr.MERGE_PR'),
    closePR: fromAsk('code', 'pr.CLOSE_PR'),
    toggleDraft: fromAsk('code', 'pr.TOGGLE_DRAFT'),
    deleteBranch: fromAsk('code', 'pr.DELETE_BRANCH'),
    checkoutPR: fromAsk('code', 'pr.CHECKOUT_PR'),
    updatePR: fromAsk('code', 'pr.UPDATE_PR'),
    createComment: fromAsk('code', 'pr.CREATE_COMMENT'),
    editComment: fromAsk('code', 'pr.EDIT_COMMENT'),
    deleteComment: fromAsk('code', 'pr.DELETE_COMMENT'),
    replyToThread: fromAsk('code', 'pr.REPLY_TO_THREAD'),
    resolveThread: fromAsk('code', 'pr.RESOLVE_THREAD'),
    unresolveThread: fromAsk('code', 'pr.UNRESOLVE_THREAD'),
    editReviewComment: fromAsk('code', 'pr.EDIT_REVIEW_COMMENT'),
    deleteReviewComment: fromAsk('code', 'pr.DELETE_REVIEW_COMMENT'),
  },
})

export const pullRequestState = machine.extend({
  actions: {
    /** Asks GitHub for what the top row shows, where a folder is open */
    refreshStatus: enqueueAsks(({ enqueue, context, self }) => {
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
    followRepositoryChange: enqueueAsks(({ enqueue, self }) => {
      enqueue.assign({ diffStale: true, prCheckCompleted: false })
      if (!panelShown(self) || !getParentContext(self)?.baseDirectory) return
      enqueue.assign({ isCheckingBranchPR: true })
      askStatus(enqueue)
    }),

    selectPrFile: machine.assign({
      selectedPrFile: ({ event }) => typeOf('pr.SELECT_FILE', event).file,
      missingFileDiff: null,
    }),

    /** Asks for a branch diff, recording the comparison its answer is written under */
    askDiff: enqueueAsks(({ enqueue, event }) => {
      const { baseBranch, headBranch, prNumber } = typeOf('pr.ask.DIFF', event)
      const id = askId('diff')
      enqueue.assign(({ context }) => ({ diffAsks: { ...context.diffAsks, [id]: refKey(baseBranch, headBranch) } }))
      enqueue.spawnChild('readDiff', { id, input: { baseBranch, ...(headBranch && { headBranch }), ...(prNumber && { prNumber }) } })
    }),

    viewPrDiff: enqueueAsks(({ enqueue, event, context }) => {
      enqueue.raise({
        type: 'pr.ask.FILE_DIFF',
        path: typeOf('pr.VIEW_DIFF', event).path,
        baseBranch: context.prBaseBranch,
        headBranch: context.selectedPR?.headRefName,
        ...(context.selectedPR && { prNumber: context.selectedPR.number }),
      })
    }),

    /** Asks for the same diff again, allowed to download what it lacks */
    fetchMissingDiff: enqueueAsks(({ enqueue, context }) => {
      const missing = context.missingFileDiff
      if (!missing) return
      enqueue.assign({ missingFileDiff: null })
      enqueue.raise({ type: 'pr.ask.FILE_DIFF', ...missing, fetchMissing: true })
    }),

    /** Asks for a file's diff, recording it so its answer opens one tab */
    askFileDiff: enqueueAsks(({ enqueue, event }) => {
      const { type: _type, ...which } = typeOf('pr.ask.FILE_DIFF', event)
      const id = askId('fileDiff')
      enqueue.assign(({ context }) => ({ fileDiffAsks: { ...context.fileDiffAsks, [id]: fileKey(which.baseBranch, which.headBranch, which.path) } }))
      enqueue.spawnChild('readFileDiff', { id, input: which })
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
    takeDiff: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = doneOf('diff', event)
      enqueue.stopChild(actorId)
      const { recorded, pending } = settled(context.diffAsks, actorId)
      if (!output.ok) {
        enqueue.assign({ ...failureShown(output.failure), ...(recorded !== undefined && { diffAsks: pending, isPrLoading: false }) })
        return
      }
      if (recorded === undefined) return
      enqueue.assign({
        diffAsks: pending,
        diffsByRef: { ...context.diffsByRef, [recorded]: output.value.files },
        isPrLoading: false,
        diffStale: false,
      })
    }),

    /**
     * Opens a tab for a diff this machine asked for and still wants. The ask leaves the record as it ends, and
     * `selectedPrFile` is what the tab is built from, so an answer for a file the user has since moved off opens
     * nothing. One that needs content the clone lacks is shown as the offer to download it
     */
    takeFileDiff: enqueueAsks(({ enqueue, self, context, event }) => {
      const { actorId, output } = doneOf('fileDiff', event)
      enqueue.stopChild(actorId)
      const { recorded, pending } = settled(context.fileDiffAsks, actorId)
      if (recorded !== undefined) enqueue.assign({ fileDiffAsks: pending })
      if (!output.ok) {
        if (output.failure.kind !== 'content-missing') enqueue.assign(failureShown(output.failure))
        else if (recorded !== undefined) {
          const { kind: _kind, message: _message, ...where } = output.failure
          enqueue.assign({ missingFileDiff: where })
        }
        return
      }
      if (recorded === undefined) return
      const diff: GitDiff = output.value
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
      const { file } = typeOf('pr.OPEN_FILE', event)
      const parentContext = getParentContext(self)
      const baseDirectory = parentContext?.baseDirectory || ''
      const fullPath = file.path.startsWith('/')
        ? file.path
        : baseDirectory.endsWith('/')
          ? baseDirectory + file.path
          : baseDirectory + '/' + file.path
      updateParentState(self, { selectedPanel: 'explorer' })
      sendEventToParent(self, {
        type: 'explorer.OPEN_FILE',
        path: fullPath
      })
    },

    /** A folder opened: nothing of the one before is kept or waited on, and GitHub is asked about this one while the panel is shown */
    startFolder: enqueueAsks(({ enqueue, self }) => {
      enqueue.assign(folderStart())
      enqueue.raise({ type: 'pr.READS_LEFT' })
      if (!getParentContext(self)?.baseDirectory) return
      enqueue.raise({ type: 'pr.CHECK_GITHUB_ACCESS' })
      if (panelShown(self)) enqueue.raise({ type: 'pr.REFRESH_STATUS' })
    }),

    navigateToHelp: () => {
      untypedOpenSurface(HOST_SETTINGS, [{ type: 'TAB.SELECT', tab: 'help' }]);
    },

    /** Reads a pull request's details in place of the read under way; the pull request's page asks only where none is */
    askDetails: enqueueAsks(({ enqueue, event, context }) => {
      const ask = typeOf(['pr.read.DETAILS', 'pr.REFRESH_PR'], event)
      if (ask.type === 'pr.read.DETAILS' && ask.unlessAsking && askUnderWay(context.asking, DETAILS)) return
      enqueue.stopChild(DETAILS)
      enqueue.spawnChild('readDetails', { id: DETAILS, input: { number: ask.number } })
    }),

    /** Reads a pull request's discussion in place of the read under way */
    askComments: enqueueAsks(({ enqueue, event }) => {
      enqueue.stopChild(COMMENTS)
      enqueue.spawnChild('readComments', { id: COMMENTS, input: { number: typeOf('pr.read.COMMENTS', event).number } })
    }),

    /** Reads a pull request's review threads in place of the read under way */
    askThreads: enqueueAsks(({ enqueue, event }) => {
      enqueue.stopChild(THREADS)
      enqueue.spawnChild('readThreads', { id: THREADS, input: { number: typeOf('pr.read.THREADS', event).number } })
    }),

    /** Reads the list's first page for the filter and search shown, in place of any page being read */
    askList: enqueueAsks(({ enqueue, context: { prList } }) => {
      enqueue.stopChild(LIST)
      enqueue.stopChild(LIST_MORE)
      enqueue.spawnChild('readList', { id: LIST, input: { state: prList.state, ...(prList.query.trim() && { query: prList.query.trim() }) } })
    }),

    /** Reads the page after those read, where there is one and no page is being read */
    askListMore: enqueueAsks(({ enqueue, context: { prList, asking } }) => {
      if (prList.next === null || askUnderWay(asking, LIST, LIST_MORE)) return
      enqueue.spawnChild('readList', { id: LIST_MORE, input: { state: prList.state, ...(prList.query.trim() && { query: prList.query.trim() }), after: prList.next } })
    }),

    /** The details asked for, shown; or why they could not be read */
    takeDetailsRead: enqueueAsks(({ enqueue, context, event }) => {
      const outcome = typeOf('xstate.done.actor.details', event).output
      if (outcome.ok) takeDetails(enqueue, context, outcome.value)
      else enqueue.assign({ ...failureShown(outcome.failure), isPrLoading: false })
    }),

    takeBranchPR: enqueueAsks(({ enqueue, context, event }) => {
      const outcome = typeOf('xstate.done.actor.branchPR', event).output
      if (!outcome.ok) {
        enqueue.assign({ ...failureShown(outcome.failure), isCheckingBranchPR: false, branchPRCheckFailed: !context.selectedPR, isPrLoading: false })
        return
      }
      const incoming = outcome.value.pr
      const unchanged = incoming?.number === context.selectedPR?.number
        && incoming?.updatedAt === context.selectedPR?.updatedAt
      // A picked PR stays until the user leaves it
      const kept = context.isManualPRSelection || unchanged
      if (!kept) leaveDiscussion(enqueue, context, incoming)
      enqueue.assign({
        branchPR: incoming,
        ...(kept ? {} : selecting(context, incoming)),
        isCheckingBranchPR: false,
        branchPRCheckFailed: false,
        prCheckCompleted: true,
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
        enqueue.raise({ type: 'pr.read.SMART_BASE' })
      }
    }),

    takeSmartBase: enqueueAsks(({ enqueue, context, event }) => {
      const outcome = typeOf('xstate.done.actor.smartBase', event).output
      if (!outcome.ok) {
        enqueue.assign({ ...failureShown(outcome.failure), isPrLoading: false })
        return
      }
      const newBase = outcome.value.branch
      enqueue.assign({ prBaseBranch: newBase })
      // A branch with no PR compares against no head
      if (!context.diffsByRef[refKey(newBase)] || context.diffStale) askDiff(enqueue, newBase)
    }),

    /** A page of the list, after the ones read where it was asked as the next, and as the list otherwise */
    takeListPage: machine.assign(({ context, event }) => {
      const { type, output: outcome } = typeOf(['xstate.done.actor.list', 'xstate.done.actor.listMore'], event)
      const append = type === 'xstate.done.actor.listMore'
      if (!outcome.ok) return failureShown(outcome.failure)
      const list = context.prList
      const page = outcome.value
      return { prList: { ...list, prs: append ? joined(list.prs, page.prs) : page.prs, next: page.next, read: true } }
    }),

    // --- The writes: each is shown as unanswered until its ask ends ---

    takeCreated: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = doneOf('createPR', event)
      enqueue.stopChild(actorId)
      if (!endWrite(enqueue, context, actorId, output) || !output.ok) return
      const { pr } = output.value
      leaveDiscussion(enqueue, context, pr)
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
    }),

    /** A merge or a close that was done; a refused merge brings the pull request read again, shown with the refusal */
    takeMergedOrClosed: enqueueAsks(({ enqueue, context, event }) => {
      const merge = event.type.startsWith('xstate.done.actor.merge.')
      const { actorId, output } = merge ? doneOf('merge', event) : doneOf('close', event)
      enqueue.stopChild(actorId)
      if (!output.ok) {
        const details = output.failure.kind === 'github' && 'details' in output.failure ? output.failure.details : undefined
        if (refreshes(context, actorId, details)) takeDetails(enqueue, context, details)
        endWrite(enqueue, context, actorId, output)
        return
      }
      if (!endWrite(enqueue, context, actorId, output)) return
      const state = merge ? 'MERGED' as const : 'CLOSED' as const
      const { number } = output.value
      const done = (pr: GhPullRequest | null) => pr?.number === number ? { ...pr, state } : pr
      // A picked PR stays picked, so its Delete Branch is there to press
      enqueue.assign(({ context }) => ({ selectedPR: done(context.selectedPR), branchPR: done(context.branchPR) }))
      askStatus(enqueue)
    }),

    /** The write is the pull request's before the details it read again are taken over it */
    takeDraftToggled: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = doneOf('toggleDraft', event)
      enqueue.stopChild(actorId)
      const refreshed = output.ok && refreshes(context, actorId, output.value.details)
      if (!endWrite(enqueue, context, actorId, output) || !output.ok) return
      const { number, isDraft, details } = output.value
      enqueue.assign(({ context }) => ({
        selectedPR: context.selectedPR?.number === number ? { ...context.selectedPR, isDraft } : context.selectedPR,
      }))
      if (refreshed && details) takeDetails(enqueue, context, details)
    }),

    takeBranchDeleted: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = doneOf('deleteBranch', event)
      enqueue.stopChild(actorId)
      if (!endWrite(enqueue, context, actorId, output) || !output.ok) return
      leaveDiscussion(enqueue, context, null)
      enqueue.assign(({ context }) => ({ ...selecting(context, null), branchPR: null, isManualPRSelection: false }))
    }),

    /**
     * The pull request stays shown, picked or not: a fork's is checked out as `pr/<n>`, which is no branch
     * GitHub has a pull request from, and the checkout's announcement asks for the branch's own
     */
    takeCheckedOut: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = doneOf('checkout', event)
      enqueue.stopChild(actorId)
      if (!endWrite(enqueue, context, actorId, output) || !output.ok) return
      enqueue.assign({ lastCheckout: output.value })
    }),

    /** The write is the pull request's before the details it read again are taken over it */
    takeUpdated: enqueueAsks(({ enqueue, context, event, self }) => {
      const { actorId, output } = doneOf('updatePR', event)
      enqueue.stopChild(actorId)
      const refreshed = output.ok && refreshes(context, actorId, output.value.details)
      if (!endWrite(enqueue, context, actorId, output) || !output.ok) return
      const { number, title, body, base, details } = output.value
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
      if (refreshed && details) takeDetails(enqueue, context, details)
    }),

    /** A comment or thread write ended: its change is GitHub's, or is taken back with why */
    takeDiscussionWritten: enqueueAsks(({ enqueue, context, event }) => {
      const { actorId, output } = event.type.startsWith('xstate.done.actor.comment.') ? doneOf('comment', event) : doneOf('thread', event)
      enqueue.stopChild(actorId)
      endWrite(enqueue, context, actorId, output)
    }),

    /** Deletes the pull request's branch, where the panel offers it (`branchDeletable`); the view has asked first */
    requestDeleteBranch: enqueueAsks(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || !branchDeletable(pr)) return
      const id = askId('deleteBranch')
      recordWrite(enqueue, id, { write: 'delete-branch' })
      enqueue.spawnChild('deleteBranch', { id, input: { number: pr.number } })
    }),

    /** Checks out the open pull request shown as a branch here, once at a time */
    requestCheckout: enqueueAsks(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || pr.state !== 'OPEN' || context.isCheckingOut) return
      enqueue.assign({ lastCheckout: null })
      const id = askId('checkout')
      recordWrite(enqueue, id, { write: 'checkout', number: pr.number })
      enqueue.spawnChild('checkoutPR', { id, input: { number: pr.number } })
    }),

    /** "Checkout & Pull Base", once at a time: the pull is asked for, a checkout pulling nothing by itself */
    checkoutBase: enqueueAsks(({ enqueue, context }) => {
      const branchName = context.selectedPR?.baseRefName
      if (!branchName || askUnderWay(context.asking, CHECKOUT_BASE)) return
      enqueue.assign({ prError: null })
      enqueue.spawnChild('checkoutBranch', { id: CHECKOUT_BASE, input: { branchName, pull: true } })
    }),

    /** The base checked out is shown in the commit panel; a refusal is shown here, where it was asked for */
    takeBaseCheckedOut: enqueueAsks(({ enqueue, event, self }) => {
      const { output } = typeOf('xstate.done.actor.checkoutBase', event)
      enqueue.stopChild(CHECKOUT_BASE)
      if (output.ok) enqueue(() => updateParentState(self, { selectedPanel: 'commit' }))
      else enqueue.assign(failureShown(output.failure))
    }),

    /** Shows the files or the pull request; the pull request's discussion is read when the one held is another's */
    setViewMode: enqueueAsks(({ enqueue, event, context }) => {
      const { mode } = typeOf('pr.SET_VIEW_MODE', event)
      enqueue.assign({ viewMode: mode, prError: null })
      const pr = context.selectedPR
      if (mode !== 'pr' || !pr || context.commentsFor === pr.number) return
      enqueue.raise({ type: 'pr.read.DETAILS', number: pr.number, unlessAsking: true })
    }),

    newPR: enqueueAsks(({ enqueue, context }) => {
      leaveDiscussion(enqueue, context, null)
      enqueue.assign({
        ...selecting(context, null),
        viewMode: 'pr' as const,
        prError: null,
        createTitle: '',
        createBody: '',
        createDraft: false,
        isManualPRSelection: false,
      })
      enqueue.raise({ type: 'pr.read.AUTOFILL' })
    }),

    updateCreateField: machine.assign(({ event, context }) => {
      const { field, value } = typeOf('pr.UPDATE_CREATE_FIELD', event)
      return {
        createTitle: field === 'title' ? value : context.createTitle,
        createBody: field === 'body' ? value : context.createBody,
        createBaseBranch: field === 'baseBranch' ? value : context.createBaseBranch,
        createDraft: field === 'draft' ? value : context.createDraft,
      }
    }),

    submitCreate: enqueueAsks(({ enqueue, event, context }) => {
      const id = askId('createPR')
      recordWrite(enqueue, id, { write: 'create-pr' })
      enqueue.spawnChild('createPR', { id, input: {
        title: context.createTitle,
        body: context.createBody,
        base: context.createBaseBranch || context.prBaseBranch || undefined,
        draft: event.type === 'pr.SUBMIT_CREATE_DRAFT' ? true : context.createDraft,
      } })
    }),

    requestMerge: enqueueAsks(({ enqueue, event, context }) => {
      if (!context.selectedPR) return
      const { method } = typeOf('pr.MERGE', event)
      const { number, headRefOid: sha } = context.selectedPR
      // The head shown is the one merged: GitHub refuses where it has moved since. A refused merge answers with the
      // PR read again, then the refusal
      const id = askId('merge')
      recordWrite(enqueue, id, { write: 'merge', number }, number)
      enqueue.spawnChild('mergePR', { id, input: { number, method: method || 'merge', ...(sha && { sha }) } })
    }),

    requestClose: enqueueAsks(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const number = context.selectedPR.number
      const id = askId('close')
      recordWrite(enqueue, id, { write: 'close', number })
      enqueue.spawnChild('closePR', { id, input: { number } })
    }),

    requestToggleDraft: enqueueAsks(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const { number, isDraft } = context.selectedPR
      const id = askId('toggleDraft')
      recordWrite(enqueue, id, { write: 'toggle-draft', number }, number)
      enqueue.spawnChild('toggleDraft', { id, input: { number, isDraft } })
    }),

    requestUpdatePR: enqueueAsks(({ enqueue, event }) => {
      const { number, title, body, base } = typeOf('pr.UPDATE_PR', event)
      const id = askId('updatePR')
      recordWrite(enqueue, id, { write: 'update-pr', number }, number)
      enqueue.spawnChild('updatePR', { id, input: { number, title, body, base } })
    }),

    selectPRAndLoadDiff: enqueueAsks(({ enqueue, event }) => {
      enqueue.assign({
        isPrLoading: true,
        viewMode: 'files' as const,
        isManualPRSelection: true,
      })
      enqueue.raise({ type: 'pr.read.DETAILS', number: typeOf('pr.SELECT_PR_BY_NUMBER', event).number })
    }),

    backToBranch: enqueueAsks(({ enqueue, context }) => {
      enqueue.assign({
        ...selecting(context, null),
        isManualPRSelection: false,
        diffsByRef: {},
        diffStale: true,
        prCheckCompleted: false,
        isCheckingBranchPR: true,
      })
      enqueue.raise({ type: 'pr.DETAILS_LEFT' })
      enqueue.raise({ type: 'pr.DISCUSSION_LEFT' })
      askStatus(enqueue)
    }),

    // --- Comment and thread writes, shown before they are answered ---

    createComment: enqueueAsks(({ enqueue, event }) => {
      const { number, body } = typeOf('pr.CREATE_COMMENT', event)
      const pid = placeholderIdCounter--
      const placeholder: GhPRComment = {
        id: `pending-${pid}`,
        body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        url: `pending-${pid}`,
        viewerDidAuthor: true,
      }
      const id = askId('comment')
      recordWrite(enqueue, id, { write: 'create-comment', number, comment: { change: 'create', placeholder } })
      enqueue.spawnChild('createComment', { id, input: { number, body } })
    }),

    editComment: enqueueAsks(({ enqueue, event, context }) => {
      const { commentId, body } = typeOf('pr.EDIT_COMMENT', event)
      const id = askId('comment')
      recordWrite(enqueue, id, { write: 'edit-comment', number: context.selectedPR?.number ?? 0, comment: { change: 'edit', commentId, body } })
      enqueue.spawnChild('editComment', { id, input: { commentId, body } })
    }),

    deleteComment: enqueueAsks(({ enqueue, event, context }) => {
      const { commentId } = typeOf('pr.DELETE_COMMENT', event)
      const id = askId('comment')
      recordWrite(enqueue, id, { write: 'delete-comment', number: context.selectedPR?.number ?? 0, comment: { change: 'delete', commentId } })
      enqueue.spawnChild('deleteComment', { id, input: { commentId } })
    }),

    replyToThread: enqueueAsks(({ enqueue, event }) => {
      const { prNumber, commentId, body } = typeOf('pr.REPLY_TO_THREAD', event)
      const pid = placeholderIdCounter--
      const placeholder = {
        id: `pending-${pid}`,
        databaseId: pid,
        body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        viewerDidAuthor: true,
      }
      const id = askId('thread')
      recordWrite(enqueue, id, { write: 'reply', number: prNumber, thread: { change: 'reply', commentId, placeholder } })
      enqueue.spawnChild('replyToThread', { id, input: { prNumber, commentId, body } })
    }),

    resolveThread: enqueueAsks(({ enqueue, event, context }) => {
      const { type, threadId } = typeOf(['pr.RESOLVE_THREAD', 'pr.UNRESOLVE_THREAD'], event)
      const resolved = type === 'pr.RESOLVE_THREAD'
      const id = askId('thread')
      recordWrite(enqueue, id, { write: 'resolve-thread', number: context.selectedPR?.number ?? 0, thread: { change: 'resolve', threadId, resolved } })
      enqueue.spawnChild(resolved ? 'resolveThread' : 'unresolveThread', { id, input: { threadId } })
    }),

    editReviewComment: enqueueAsks(({ enqueue, event, context }) => {
      const { commentId, body } = typeOf('pr.EDIT_REVIEW_COMMENT', event)
      const id = askId('thread')
      recordWrite(enqueue, id, { write: 'edit-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'edit', commentId, body } })
      enqueue.spawnChild('editReviewComment', { id, input: { commentId, body } })
    }),

    deleteReviewComment: enqueueAsks(({ enqueue, event, context }) => {
      const { commentId } = typeOf('pr.DELETE_REVIEW_COMMENT', event)
      const id = askId('thread')
      recordWrite(enqueue, id, { write: 'delete-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'delete', commentId } })
      enqueue.spawnChild('deleteReviewComment', { id, input: { commentId } })
    }),
  }
}).createMachine({
  id: 'pr',
  context: { ...folderStart(), commentTab: 'discussion', asking: noAsks() },
  on: {
    'pr.REFRESH_STATUS': { actions: 'refreshStatus' },
    'pr.SELECT_FILE': { actions: 'selectPrFile' },
    'pr.VIEW_DIFF': { actions: 'viewPrDiff' },
    'pr.FETCH_MISSING_DIFF': { actions: 'fetchMissingDiff' },
    'pr.OPEN_FILE': { actions: 'openFile' },
    // News: the repository's commits or branches moved
    'pr.GIT_STATUS_REFRESHED': { actions: 'followRepositoryChange' },
    'CODE_STARTED': { actions: 'startFolder' },
    'pr.NAVIGATE_TO_HELP': { actions: 'navigateToHelp' },

    // The asks spawned beside others of their kind, each ending under the id it ran as
    'pr.ask.DIFF': { actions: 'askDiff' },
    'pr.ask.FILE_DIFF': { actions: 'askFileDiff' },
    'xstate.done.actor.diff.*': { actions: 'takeDiff' },
    'xstate.done.actor.fileDiff.*': { actions: 'takeFileDiff' },
    'xstate.done.actor.createPR.*': { actions: 'takeCreated' },
    'xstate.done.actor.merge.*': { actions: 'takeMergedOrClosed' },
    'xstate.done.actor.close.*': { actions: 'takeMergedOrClosed' },
    'xstate.done.actor.toggleDraft.*': { actions: 'takeDraftToggled' },
    'xstate.done.actor.deleteBranch.*': { actions: 'takeBranchDeleted' },
    'xstate.done.actor.checkout.*': { actions: 'takeCheckedOut' },
    'xstate.done.actor.updatePR.*': { actions: 'takeUpdated' },
    'xstate.done.actor.comment.*': { actions: 'takeDiscussionWritten' },
    'xstate.done.actor.thread.*': { actions: 'takeDiscussionWritten' },

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
    'pr.UPDATE_PR': { actions: 'requestUpdatePR' },
    'pr.CREATE_COMMENT': { actions: 'createComment' },
    'pr.EDIT_COMMENT': { actions: 'editComment' },
    'pr.DELETE_COMMENT': { actions: 'deleteComment' },
    'pr.REPLY_TO_THREAD': { actions: 'replyToThread' },
    'pr.RESOLVE_THREAD': { actions: 'resolveThread' },
    'pr.UNRESOLVE_THREAD': { actions: 'resolveThread' },
    'pr.EDIT_REVIEW_COMMENT': { actions: 'editReviewComment' },
    'pr.DELETE_REVIEW_COMMENT': { actions: 'deleteReviewComment' },
    'pr.SET_COMMENT_TAB': { actions: assign({ commentTab: ({ event }) => event.tab }) },
    'pr.BACK_TO_BRANCH': { actions: 'backToBranch' },
    'pr.CLEAR_ERROR': { actions: assign({ prError: null }) },
    [`xstate.done.actor.${CHECKOUT_BASE}`]: { actions: 'takeBaseCheckedOut' },

    // The reads, one of each at a time: asking one again stops the one before, and its end is taken here
    'pr.read.DETAILS': { actions: 'askDetails' },
    'pr.REFRESH_PR': { actions: 'askDetails' },
    [`xstate.done.actor.${DETAILS}`]: { actions: [stopAsks(DETAILS), 'takeDetailsRead'] },
    'pr.read.COMMENTS': { actions: 'askComments' },
    [`xstate.done.actor.${COMMENTS}`]: {
      actions: [
        stopAsks(COMMENTS),
        // The discussion read again after a write that landed: shown with the comment writes still unanswered
        // laid over it. A read that failed is no error of the write's to show
        assign(({ context, event }) => event.output.ok
          ? { ...withWrites(context, context.writes, { comments: event.output.value.comments }), commentsFor: event.output.value.number }
          : {}),
      ],
    },
    'pr.read.THREADS': { actions: 'askThreads' },
    [`xstate.done.actor.${THREADS}`]: {
      actions: [
        stopAsks(THREADS),
        // The review threads read again: shown with the thread writes still unanswered laid over them
        assign(({ context, event }) => event.output.ok
          ? withWrites(context, context.writes, { threads: event.output.value.threads })
          : failureShown(event.output.failure)),
      ],
    },
    'pr.read.BRANCH_PR': { actions: enqueueAsks(({ enqueue }) => { enqueue.stopChild(BRANCH_PR); enqueue.spawnChild('readBranchPR', { id: BRANCH_PR, input: {} }) }) },
    [`xstate.done.actor.${BRANCH_PR}`]: { actions: [stopAsks(BRANCH_PR), 'takeBranchPR'] },
    'pr.read.SMART_BASE': { actions: enqueueAsks(({ enqueue }) => { enqueue.stopChild(SMART_BASE); enqueue.spawnChild('readSmartBase', { id: SMART_BASE, input: {} }) }) },
    [`xstate.done.actor.${SMART_BASE}`]: { actions: [stopAsks(SMART_BASE), 'takeSmartBase'] },
    'pr.CHECK_GITHUB_ACCESS': { actions: enqueueAsks(({ enqueue }) => { enqueue.stopChild(ACCESS); enqueue.spawnChild('readAccess', { id: ACCESS, input: {} }) }) },
    [`xstate.done.actor.${ACCESS}`]: {
      actions: [
        stopAsks(ACCESS),
        assign(({ event }) => event.output.ok
          ? { githubAccess: event.output.value.access, githubAccessMessage: event.output.value.message ?? null }
          : failureShown(event.output.failure)),
      ],
    },
    'pr.read.AUTOFILL': { actions: enqueueAsks(({ enqueue }) => { enqueue.stopChild(AUTOFILL); enqueue.spawnChild('readAutofill', { id: AUTOFILL, input: {} }) }) },
    [`xstate.done.actor.${AUTOFILL}`]: {
      actions: [
        stopAsks(AUTOFILL),
        // What the user has typed meanwhile is kept
        assign(({ context, event }) => event.output.ok
          ? { createTitle: context.createTitle || event.output.value.title, createBody: context.createBody || event.output.value.body }
          : failureShown(event.output.failure)),
      ],
    },

    // The list the dropdown shows: its first page is read for the filter and search shown, which a change to either
    // starts again, and the page after those read is read where no page is being read
    'pr.LIST_SHOWN': { actions: 'askList' },
    'pr.SET_LIST_STATE': {
      guard: ({ context, event }) => event.state !== context.prList.state,
      actions: [
        assign({ prList: ({ context, event }) => ({ ...context.prList, state: event.state, prs: [], next: null, read: false }) }),
        'askList',
      ],
    },
    'pr.SET_LIST_QUERY': {
      guard: ({ context, event }) => event.query.trim() !== context.prList.query.trim(),
      actions: [
        assign({ prList: ({ context, event }) => ({ ...context.prList, query: event.query, prs: [], next: null, read: false }) }),
        'askList',
      ],
    },
    'pr.LOAD_MORE_PRS': { actions: 'askListMore' },
    [`xstate.done.actor.${LIST}`]: { actions: [stopAsks(LIST), 'takeListPage'] },
    [`xstate.done.actor.${LIST_MORE}`]: { actions: [stopAsks(LIST_MORE), 'takeListPage'] },

    // Reads stopped: their answers are no longer waited on
    'pr.DETAILS_LEFT': { actions: stopAsks(DETAILS) },
    'pr.DISCUSSION_LEFT': { actions: stopAsks(COMMENTS, THREADS) },
    // A folder opening leaves every read, and the checkout asked of the folder before
    'pr.READS_LEFT': { actions: stopAsks(...READS, CHECKOUT_BASE) },
  },
});

/** The pull-request child's actor, named by whoever reads its context (`codeChild(…)`) */
export type PullRequestActor = ActorRefFrom<typeof pullRequestState>;
