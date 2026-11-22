import type { GitHubApiFailure, PRListState } from '#features/code/be/services/github-api.ts'
import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { PRDetails, PRFileDiffWhere } from '#features/code/be/contract.ts';
import { fromAsk } from '#generated/events.ts';
import type { GitStatusFile, GitDiff } from '../commit/state.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread, PRBranchCheckout } from '#generated/types.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { freshKey, makes, untypedOpenSurface, type MadeEvent, type Making } from '@apackdev/sdk/fe'
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
 * than checked. The key an answer writes is the one its ask was made under, never one read off the answer, so an
 * answer cannot name a slot nobody asked for.
 */
export const refKey = (base: string, head?: string): string => `${base}...${head ?? ''}`

/** The same, for one file within that comparison: what a file's diff is asked under */
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
 * A write the panel sent and GitHub has not answered, recorded under the key its ask is made under. A comment or
 * thread write carries the change it shows meanwhile, which is all its rollback needs: the list shown is the one GitHub
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
 * discussion and the file diffs asked for (`leaveDiscussion`).
 */
const selecting = (context: CodePullRequestContext, next: GhPullRequest | null): Partial<CodePullRequestContext> => {
  if (next?.number === context.selectedPR?.number) return { selectedPR: next }
  const writes = Object.fromEntries(Object.entries(context.writes).filter(([, w]) => !commentChangeOf(w) && !threadChangeOf(w)))
  return {
    selectedPR: next,
    ...withWrites(context, writes, { comments: [], threads: [] }),
    commentsFor: null,
    detailRefreshes: {},
    missingFileDiff: null,
  }
}

/** The pull request panel is the one the code surface shows */
const panelShown = (self: unknown): boolean => getParentContext(self)?.selectedPanel === 'pr'

/** Everything that belongs to the folder open, as it is before anything is known of it */
const folderStart = (): Omit<CodePullRequestContext, 'commentTab' | 'making'> => ({
  diffsByRef: {},
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
 * being read is whether the read of its first page (`making.list`) or of the page after (`making.listMore`) is under way
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
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
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
  /** The writes sent and unanswered, by the key each one's ask is made under */
  writes: Record<string, PullRequestWrite>
  /** How the last write a form waits on was answered */
  lastWriteAnswer: WriteAnswer | null
  diffStale: boolean

  // PR selection tracking
  /** The user picked the pull request shown, so the branch's own does not replace it until they leave it */
  isManualPRSelection: boolean

  /**
   * The writes whose answer may bring the pull request's details read again after it, by key: the number
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

/**
 * The asks the panel makes of the code system, each under the name the machine makes it by.
 *
 * `one` is an ask of which one is under way at a time, and making it again gives up the one before: each read of what
 * the panel shows, and the checkout of the base. `each` is one under way per key: a branch diff by the comparison it
 * reads (`refKey`), a file's diff by the file within it (`fileKey`), and a write by a key of its own (`freshKey`), so
 * that every one sent is done.
 */
const made = makes(({ one, each }) => ({
  details: one(fromAsk('code', 'pr.SELECT_PR')),
  comments: one(fromAsk('code', 'pr.GET_COMMENTS')),
  threads: one(fromAsk('code', 'pr.GET_REVIEW_THREADS')),
  branchPR: one(fromAsk('code', 'pr.CHECK_BRANCH_PR')),
  smartBase: one(fromAsk('code', 'pr.GET_SMART_BASE_BRANCH')),
  access: one(fromAsk('code', 'pr.CHECK_GITHUB_ACCESS')),
  autofill: one(fromAsk('code', 'pr.GET_PR_AUTOFILL')),
  /** The list's first page for the filter and search shown */
  list: one(fromAsk('code', 'pr.LIST_PRS')),
  /** The page after those read */
  listMore: one(fromAsk('code', 'pr.LIST_PRS')),
  /** The checkout of the base branch of the pull request shown */
  checkoutBase: one(fromAsk('code', 'commit.CHECKOUT_BRANCH')),

  /** A branch diff, by the comparison (`refKey`) its answer is written under */
  diff: each(fromAsk('code', 'pr.GET_BRANCH_DIFF')),
  /** A file's diff, by its `fileKey`: its answer opens a tab, once, while it is still wanted */
  fileDiff: each(fromAsk('code', 'pr.GET_BRANCH_FILE_DIFF')),

  createPR: each(fromAsk('code', 'pr.CREATE_PR')),
  merge: each(fromAsk('code', 'pr.MERGE_PR')),
  close: each(fromAsk('code', 'pr.CLOSE_PR')),
  toggleDraft: each(fromAsk('code', 'pr.TOGGLE_DRAFT')),
  deleteBranch: each(fromAsk('code', 'pr.DELETE_BRANCH')),
  checkout: each(fromAsk('code', 'pr.CHECKOUT_PR')),
  updatePR: each(fromAsk('code', 'pr.UPDATE_PR')),
  createComment: each(fromAsk('code', 'pr.CREATE_COMMENT')),
  editComment: each(fromAsk('code', 'pr.EDIT_COMMENT')),
  deleteComment: each(fromAsk('code', 'pr.DELETE_COMMENT')),
  replyToThread: each(fromAsk('code', 'pr.REPLY_TO_THREAD')),
  resolveThread: each(fromAsk('code', 'pr.RESOLVE_THREAD')),
  unresolveThread: each(fromAsk('code', 'pr.UNRESOLVE_THREAD')),
  editReviewComment: each(fromAsk('code', 'pr.EDIT_REVIEW_COMMENT')),
  deleteReviewComment: each(fromAsk('code', 'pr.DELETE_REVIEW_COMMENT')),
}))

/** What a folder opening stops waiting on: every read, the diffs, and the checkout asked of the folder before */
const OF_ONE_FOLDER = ['details', 'comments', 'threads', 'branchPR', 'smartBase', 'access', 'autofill', 'list', 'listMore', 'diff', 'fileDiff', 'checkoutBase'] as const

/** How a comment or thread write ended, by the name each is made under */
const DISCUSSION_WRITTEN = [
  'made.createComment', 'made.editComment', 'made.deleteComment', 'made.replyToThread', 'made.resolveThread',
  'made.unresolveThread', 'made.editReviewComment', 'made.deleteReviewComment',
] as const

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
  | { type: 'pr.DETAILS_LEFT' }
  | { type: 'pr.DISCUSSION_LEFT' }
  | { type: 'pr.FILE_DIFFS_LEFT' }
  | { type: 'pr.READS_LEFT' }
  // How each ask ended
  | MadeEvent<typeof made>;

/** What an `enqueueActions` body is handed that the helpers below use */
interface Enqueue {
  assign: (values: Partial<CodePullRequestContext> | ((args: { context: CodePullRequestContext }) => Partial<CodePullRequestContext>)) => void
  raise: (event: Event) => void
}

const typeOf = safeEvents<Event>()

/** `asks` without the one made under `key`, and what was recorded for it: nothing, for an ask this machine no longer waits on */
const settled = <T>(asks: Record<string, T>, key: string): { recorded: T | undefined; pending: Record<string, T> } => {
  const { [key]: recorded, ...pending } = asks
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

/** Stops waiting on the discussion and the file diffs asked for where `next` is another pull request than the one shown: their answers are the other's */
const leaveDiscussion = (enqueue: Enqueue, context: CodePullRequestContext, next: GhPullRequest | null): void => {
  if (next?.number === context.selectedPR?.number) return
  enqueue.raise({ type: 'pr.DISCUSSION_LEFT' })
  enqueue.raise({ type: 'pr.FILE_DIFFS_LEFT' })
}

/**
 * Records a write as sent, shown at once where it carries a change; whoever calls makes its ask under `key`.
 * `refreshes` names the pull request whose details its answer may bring read again.
 */
function recordWrite(enqueue: Enqueue, key: string, write: PullRequestWrite, refreshes?: number): void {
  enqueue.assign(({ context }) => ({
    // A write is the user acting on what the panel said, so what it said goes: a merge retried after "nothing
    // was merged" must not leave that beside the pull request it merged. The write brings its own answer
    prError: null,
    ...withWrites(context, { ...context.writes, [key]: write }),
    ...(refreshes !== undefined && { detailRefreshes: { ...context.detailRefreshes, [key]: refreshes } }),
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
 * Ends the write made under `key`: off the writes shown as unanswered, with the form waiting on it told how it went.
 * A write that was done leaves its change shown as GitHub's until the list is read again, which is then asked for;
 * one that was not takes its change back and says why. Answers with the write, or nothing for one no longer waited on
 */
function endWrite(enqueue: Enqueue, context: CodePullRequestContext, key: string, outcome: { ok: true } | { ok: false; failure: { kind: string; message: string; reason?: GitHubApiFailure } }): PullRequestWrite | undefined {
  const { recorded } = settled(context.writes, key)
  enqueue.assign(({ context }) => ({ detailRefreshes: settled(context.detailRefreshes, key).pending }))
  if (!outcome.ok) enqueue.assign(failureShown(outcome.failure))
  if (recorded === undefined) return undefined
  const answer = writeAnswer(recorded, outcome.ok)
  const comment = outcome.ok ? commentChangeOf(recorded) : undefined
  const thread = outcome.ok ? threadChangeOf(recorded) : undefined
  // Read as it is when this runs: details taken before it in the same step are not written over
  enqueue.assign(({ context }) => ({
    ...withWrites(context, settled(context.writes, key).pending, {
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
const refreshes = (context: CodePullRequestContext, key: string, details: PRDetails | undefined): details is PRDetails =>
  !!details && context.detailRefreshes[key] === details.pr.number && context.selectedPR?.number === details.pr.number

const machine = setup({
  types: {
    context: {} as CodePullRequestContext,
    events: {} as Event
  },
  actors: made.actors,
})

export const pullRequestState = machine.extend({
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

    selectPrFile: machine.assign({
      selectedPrFile: ({ event }) => typeOf('pr.SELECT_FILE', event).file,
      missingFileDiff: null,
    }),

    /** Asks for a branch diff, under the comparison its answer is written under */
    askDiff: enqueueActions(({ enqueue, event }) => {
      const { baseBranch, headBranch, prNumber } = typeOf('pr.ask.DIFF', event)
      made.make(enqueue, 'diff', refKey(baseBranch, headBranch), { baseBranch, ...(headBranch && { headBranch }), ...(prNumber && { prNumber }) })
    }),

    viewPrDiff: enqueueActions(({ enqueue, event, context }) => {
      enqueue.raise({
        type: 'pr.ask.FILE_DIFF',
        path: typeOf('pr.VIEW_DIFF', event).path,
        baseBranch: context.prBaseBranch,
        headBranch: context.selectedPR?.headRefName,
        ...(context.selectedPR && { prNumber: context.selectedPR.number }),
      })
    }),

    /** Asks for the same diff again, allowed to download what it lacks */
    fetchMissingDiff: enqueueActions(({ enqueue, context }) => {
      const missing = context.missingFileDiff
      if (!missing) return
      enqueue.assign({ missingFileDiff: null })
      enqueue.raise({ type: 'pr.ask.FILE_DIFF', ...missing, fetchMissing: true })
    }),

    /** Asks for a file's diff, under the file asked for, so its answer opens one tab */
    askFileDiff: enqueueActions(({ enqueue, event }) => {
      const { type: _type, ...which } = typeOf('pr.ask.FILE_DIFF', event)
      made.make(enqueue, 'fileDiff', fileKey(which.baseBranch, which.headBranch, which.path), which)
    }),

    /**
     * Writes the answer into the comparison its ask was made under, and nowhere else.
     *
     * **It does not set `prBaseBranch`**, which is what keeps the key honest: that field is the base the
     * user is on, written by the askers, and an answer that moved it would move the view onto itself.
     *
     * `isPrLoading` and `diffStale` are the view's, not the comparison's, so a late answer still clears
     * them; there is nothing stale about "no longer loading".
     */
    takeDiff: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf('made.diff', event)
      if (!outcome.ok) {
        enqueue.assign({ ...failureShown(outcome.failure), isPrLoading: false })
        return
      }
      enqueue.assign({
        diffsByRef: { ...context.diffsByRef, [key]: outcome.value.files },
        isPrLoading: false,
        diffStale: false,
      })
    }),

    /**
     * Opens a tab for a diff this machine asked for and still wants: one given up since ends nowhere.
     * `selectedPrFile` is what the tab is built from, so an answer for a file the user has since moved off opens
     * nothing. One that needs content the clone lacks is shown as the offer to download it
     */
    takeFileDiff: enqueueActions(({ enqueue, self, context, event }) => {
      const { outcome } = typeOf('made.fileDiff', event)
      if (!outcome.ok) {
        if (outcome.failure.kind !== 'content-missing') enqueue.assign(failureShown(outcome.failure))
        else {
          const { kind: _kind, message: _message, ...where } = outcome.failure
          enqueue.assign({ missingFileDiff: where })
        }
        return
      }
      const diff: GitDiff = outcome.value
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
    startFolder: enqueueActions(({ enqueue, self }) => {
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
    askDetails: enqueueActions(({ enqueue, event, context }) => {
      const ask = typeOf(['pr.read.DETAILS', 'pr.REFRESH_PR'], event)
      if (ask.type === 'pr.read.DETAILS' && ask.unlessAsking && context.making.details) return
      made.make(enqueue, 'details', { number: ask.number })
    }),

    /** Reads a pull request's discussion in place of the read under way */
    askComments: enqueueActions(({ enqueue, event }) => {
      made.make(enqueue, 'comments', { number: typeOf('pr.read.COMMENTS', event).number })
    }),

    /** Reads a pull request's review threads in place of the read under way */
    askThreads: enqueueActions(({ enqueue, event }) => {
      made.make(enqueue, 'threads', { number: typeOf('pr.read.THREADS', event).number })
    }),

    /** Reads the list's first page for the filter and search shown, in place of any page being read */
    askList: enqueueActions(({ enqueue, context }) => {
      const { prList } = context
      made.drop(enqueue, context, 'listMore')
      made.make(enqueue, 'list', { state: prList.state, ...(prList.query.trim() && { query: prList.query.trim() }) })
    }),

    /** Reads the page after those read, where there is one and no page is being read */
    askListMore: enqueueActions(({ enqueue, context: { prList, making } }) => {
      if (prList.next === null || making.list || making.listMore) return
      made.make(enqueue, 'listMore', { state: prList.state, ...(prList.query.trim() && { query: prList.query.trim() }), after: prList.next })
    }),

    /** The details asked for, shown; or why they could not be read */
    takeDetailsRead: enqueueActions(({ enqueue, context, event }) => {
      const outcome = typeOf('made.details', event).outcome
      if (outcome.ok) takeDetails(enqueue, context, outcome.value)
      else enqueue.assign({ ...failureShown(outcome.failure), isPrLoading: false })
    }),

    takeBranchPR: enqueueActions(({ enqueue, context, event }) => {
      const outcome = typeOf('made.branchPR', event).outcome
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

    takeSmartBase: enqueueActions(({ enqueue, context, event }) => {
      const outcome = typeOf('made.smartBase', event).outcome
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
      const { type, outcome } = typeOf(['made.list', 'made.listMore'], event)
      const append = type === 'made.listMore'
      if (!outcome.ok) return failureShown(outcome.failure)
      const list = context.prList
      const page = outcome.value
      return { prList: { ...list, prs: append ? joined(list.prs, page.prs) : page.prs, next: page.next, read: true } }
    }),

    // --- The writes: each is shown as unanswered until its ask ends ---

    takeCreated: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf('made.createPR', event)
      if (!endWrite(enqueue, context, key, outcome) || !outcome.ok) return
      const { pr } = outcome.value
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
    takeMergedOrClosed: enqueueActions(({ enqueue, context, event }) => {
      const { type, key, outcome } = typeOf(['made.merge', 'made.close'], event)
      const merge = type === 'made.merge'
      if (!outcome.ok) {
        const details = outcome.failure.kind === 'github' && 'details' in outcome.failure ? outcome.failure.details : undefined
        if (refreshes(context, key, details)) takeDetails(enqueue, context, details)
        endWrite(enqueue, context, key, outcome)
        return
      }
      if (!endWrite(enqueue, context, key, outcome)) return
      const state = merge ? 'MERGED' as const : 'CLOSED' as const
      const { number } = outcome.value
      const done = (pr: GhPullRequest | null) => pr?.number === number ? { ...pr, state } : pr
      // A picked PR stays picked, so its Delete Branch is there to press
      enqueue.assign(({ context }) => ({ selectedPR: done(context.selectedPR), branchPR: done(context.branchPR) }))
      askStatus(enqueue)
    }),

    /** The write is the pull request's before the details it read again are taken over it */
    takeDraftToggled: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf('made.toggleDraft', event)
      const refreshed = outcome.ok && refreshes(context, key, outcome.value.details)
      if (!endWrite(enqueue, context, key, outcome) || !outcome.ok) return
      const { number, isDraft, details } = outcome.value
      enqueue.assign(({ context }) => ({
        selectedPR: context.selectedPR?.number === number ? { ...context.selectedPR, isDraft } : context.selectedPR,
      }))
      if (refreshed && details) takeDetails(enqueue, context, details)
    }),

    takeBranchDeleted: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf('made.deleteBranch', event)
      if (!endWrite(enqueue, context, key, outcome) || !outcome.ok) return
      leaveDiscussion(enqueue, context, null)
      enqueue.assign(({ context }) => ({ ...selecting(context, null), branchPR: null, isManualPRSelection: false }))
    }),

    /**
     * The pull request stays shown, picked or not: a fork's is checked out as `pr/<n>`, which is no branch
     * GitHub has a pull request from, and the checkout's announcement asks for the branch's own
     */
    takeCheckedOut: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf('made.checkout', event)
      if (!endWrite(enqueue, context, key, outcome) || !outcome.ok) return
      enqueue.assign({ lastCheckout: outcome.value })
    }),

    /** The write is the pull request's before the details it read again are taken over it */
    takeUpdated: enqueueActions(({ enqueue, context, event, self }) => {
      const { key, outcome } = typeOf('made.updatePR', event)
      const refreshed = outcome.ok && refreshes(context, key, outcome.value.details)
      if (!endWrite(enqueue, context, key, outcome) || !outcome.ok) return
      const { number, title, body, base, details } = outcome.value
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
    takeDiscussionWritten: enqueueActions(({ enqueue, context, event }) => {
      const { key, outcome } = typeOf(DISCUSSION_WRITTEN, event)
      endWrite(enqueue, context, key, outcome)
    }),

    /** Deletes the pull request's branch, where the panel offers it (`branchDeletable`); the view has asked first */
    requestDeleteBranch: enqueueActions(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || !branchDeletable(pr)) return
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'delete-branch' })
      made.make(enqueue, 'deleteBranch', key, { number: pr.number })
    }),

    /** Checks out the open pull request shown as a branch here, once at a time */
    requestCheckout: enqueueActions(({ enqueue, context }) => {
      const pr = context.selectedPR
      if (!pr || pr.state !== 'OPEN' || context.isCheckingOut) return
      enqueue.assign({ lastCheckout: null })
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'checkout', number: pr.number })
      made.make(enqueue, 'checkout', key, { number: pr.number })
    }),

    /** "Checkout & Pull Base", once at a time: the pull is asked for, a checkout pulling nothing by itself */
    checkoutBase: enqueueActions(({ enqueue, context }) => {
      const branchName = context.selectedPR?.baseRefName
      if (!branchName || context.making.checkoutBase) return
      enqueue.assign({ prError: null })
      made.make(enqueue, 'checkoutBase', { branchName, pull: true })
    }),

    /** The base checked out is shown in the commit panel; a refusal is shown here, where it was asked for */
    takeBaseCheckedOut: enqueueActions(({ enqueue, event, self }) => {
      const { outcome } = typeOf('made.checkoutBase', event)
      if (outcome.ok) enqueue(() => updateParentState(self, { selectedPanel: 'commit' }))
      else enqueue.assign(failureShown(outcome.failure))
    }),

    /** Shows the files or the pull request; the pull request's discussion is read when the one held is another's */
    setViewMode: enqueueActions(({ enqueue, event, context }) => {
      const { mode } = typeOf('pr.SET_VIEW_MODE', event)
      enqueue.assign({ viewMode: mode, prError: null })
      const pr = context.selectedPR
      if (mode !== 'pr' || !pr || context.commentsFor === pr.number) return
      enqueue.raise({ type: 'pr.read.DETAILS', number: pr.number, unlessAsking: true })
    }),

    newPR: enqueueActions(({ enqueue, context }) => {
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

    submitCreate: enqueueActions(({ enqueue, event, context }) => {
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'create-pr' })
      made.make(enqueue, 'createPR', key, {
        title: context.createTitle,
        body: context.createBody,
        base: context.createBaseBranch || context.prBaseBranch || undefined,
        draft: event.type === 'pr.SUBMIT_CREATE_DRAFT' ? true : context.createDraft,
      })
    }),

    requestMerge: enqueueActions(({ enqueue, event, context }) => {
      if (!context.selectedPR) return
      const { method } = typeOf('pr.MERGE', event)
      const { number, headRefOid: sha } = context.selectedPR
      // The head shown is the one merged: GitHub refuses where it has moved since. A refused merge answers with the
      // PR read again, then the refusal
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'merge', number }, number)
      made.make(enqueue, 'merge', key, { number, method: method || 'merge', ...(sha && { sha }) })
    }),

    requestClose: enqueueActions(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const number = context.selectedPR.number
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'close', number })
      made.make(enqueue, 'close', key, { number })
    }),

    requestToggleDraft: enqueueActions(({ enqueue, context }) => {
      if (!context.selectedPR) return
      const { number, isDraft } = context.selectedPR
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'toggle-draft', number }, number)
      made.make(enqueue, 'toggleDraft', key, { number, isDraft })
    }),

    requestUpdatePR: enqueueActions(({ enqueue, event }) => {
      const { number, title, body, base } = typeOf('pr.UPDATE_PR', event)
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'update-pr', number }, number)
      made.make(enqueue, 'updatePR', key, { number, title, body, base })
    }),

    selectPRAndLoadDiff: enqueueActions(({ enqueue, event }) => {
      enqueue.assign({
        isPrLoading: true,
        viewMode: 'files' as const,
        isManualPRSelection: true,
      })
      enqueue.raise({ type: 'pr.read.DETAILS', number: typeOf('pr.SELECT_PR_BY_NUMBER', event).number })
    }),

    backToBranch: enqueueActions(({ enqueue, context }) => {
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
      if (context.selectedPR) enqueue.raise({ type: 'pr.FILE_DIFFS_LEFT' })
      askStatus(enqueue)
    }),

    // --- Comment and thread writes, shown before they are answered ---

    createComment: enqueueActions(({ enqueue, event }) => {
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
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'create-comment', number, comment: { change: 'create', placeholder } })
      made.make(enqueue, 'createComment', key, { number, body })
    }),

    editComment: enqueueActions(({ enqueue, event, context }) => {
      const { commentId, body } = typeOf('pr.EDIT_COMMENT', event)
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'edit-comment', number: context.selectedPR?.number ?? 0, comment: { change: 'edit', commentId, body } })
      made.make(enqueue, 'editComment', key, { commentId, body })
    }),

    deleteComment: enqueueActions(({ enqueue, event, context }) => {
      const { commentId } = typeOf('pr.DELETE_COMMENT', event)
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'delete-comment', number: context.selectedPR?.number ?? 0, comment: { change: 'delete', commentId } })
      made.make(enqueue, 'deleteComment', key, { commentId })
    }),

    replyToThread: enqueueActions(({ enqueue, event }) => {
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
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'reply', number: prNumber, thread: { change: 'reply', commentId, placeholder } })
      made.make(enqueue, 'replyToThread', key, { prNumber, commentId, body })
    }),

    resolveThread: enqueueActions(({ enqueue, event, context }) => {
      const { type, threadId } = typeOf(['pr.RESOLVE_THREAD', 'pr.UNRESOLVE_THREAD'], event)
      const resolved = type === 'pr.RESOLVE_THREAD'
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'resolve-thread', number: context.selectedPR?.number ?? 0, thread: { change: 'resolve', threadId, resolved } })
      made.make(enqueue, resolved ? 'resolveThread' : 'unresolveThread', key, { threadId })
    }),

    editReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const { commentId, body } = typeOf('pr.EDIT_REVIEW_COMMENT', event)
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'edit-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'edit', commentId, body } })
      made.make(enqueue, 'editReviewComment', key, { commentId, body })
    }),

    deleteReviewComment: enqueueActions(({ enqueue, event, context }) => {
      const { commentId } = typeOf('pr.DELETE_REVIEW_COMMENT', event)
      const key = freshKey()
      recordWrite(enqueue, key, { write: 'delete-review-comment', number: context.selectedPR?.number ?? 0, thread: { change: 'delete', commentId } })
      made.make(enqueue, 'deleteReviewComment', key, { commentId })
    }),
  }
}).createMachine({
  id: 'pr',
  context: { ...folderStart(), commentTab: 'discussion', making: made.none() },
  on: {
    [made.done]: { actions: made.settle() },

    'pr.REFRESH_STATUS': { actions: 'refreshStatus' },
    'pr.SELECT_FILE': { actions: 'selectPrFile' },
    'pr.VIEW_DIFF': { actions: 'viewPrDiff' },
    'pr.FETCH_MISSING_DIFF': { actions: 'fetchMissingDiff' },
    'pr.OPEN_FILE': { actions: 'openFile' },
    // News: the repository's commits or branches moved
    'pr.GIT_STATUS_REFRESHED': { actions: 'followRepositoryChange' },
    'CODE_STARTED': { actions: 'startFolder' },
    'pr.NAVIGATE_TO_HELP': { actions: 'navigateToHelp' },

    // The asks made beside others of their name, and how each ended
    'pr.ask.DIFF': { actions: 'askDiff' },
    'pr.ask.FILE_DIFF': { actions: 'askFileDiff' },
    'made.diff': { actions: 'takeDiff' },
    'made.fileDiff': { actions: 'takeFileDiff' },
    'made.createPR': { actions: 'takeCreated' },
    'made.merge': { actions: 'takeMergedOrClosed' },
    'made.close': { actions: 'takeMergedOrClosed' },
    'made.toggleDraft': { actions: 'takeDraftToggled' },
    'made.deleteBranch': { actions: 'takeBranchDeleted' },
    'made.checkout': { actions: 'takeCheckedOut' },
    'made.updatePR': { actions: 'takeUpdated' },
    'made.createComment': { actions: 'takeDiscussionWritten' },
    'made.editComment': { actions: 'takeDiscussionWritten' },
    'made.deleteComment': { actions: 'takeDiscussionWritten' },
    'made.replyToThread': { actions: 'takeDiscussionWritten' },
    'made.resolveThread': { actions: 'takeDiscussionWritten' },
    'made.unresolveThread': { actions: 'takeDiscussionWritten' },
    'made.editReviewComment': { actions: 'takeDiscussionWritten' },
    'made.deleteReviewComment': { actions: 'takeDiscussionWritten' },

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
    'made.checkoutBase': { actions: 'takeBaseCheckedOut' },

    // The reads, one of each at a time: asking one again gives up the one before, and its end is taken here
    'pr.read.DETAILS': { actions: 'askDetails' },
    'pr.REFRESH_PR': { actions: 'askDetails' },
    'made.details': { actions: 'takeDetailsRead' },
    'pr.read.COMMENTS': { actions: 'askComments' },
    'made.comments': {
      // The discussion read again after a write that landed: shown with the comment writes still unanswered
      // laid over it. A read that failed is no error of the write's to show
      actions: assign(({ context, event }) => event.outcome.ok
        ? { ...withWrites(context, context.writes, { comments: event.outcome.value.comments }), commentsFor: event.outcome.value.number }
        : {}),
    },
    'pr.read.THREADS': { actions: 'askThreads' },
    'made.threads': {
      // The review threads read again: shown with the thread writes still unanswered laid over them
      actions: assign(({ context, event }) => event.outcome.ok
        ? withWrites(context, context.writes, { threads: event.outcome.value.threads })
        : failureShown(event.outcome.failure)),
    },
    'pr.read.BRANCH_PR': { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'branchPR', {})) },
    'made.branchPR': { actions: 'takeBranchPR' },
    'pr.read.SMART_BASE': { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'smartBase', {})) },
    'made.smartBase': { actions: 'takeSmartBase' },
    'pr.CHECK_GITHUB_ACCESS': { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'access', {})) },
    'made.access': {
      actions: assign(({ event }) => event.outcome.ok
        ? { githubAccess: event.outcome.value.access, githubAccessMessage: event.outcome.value.message ?? null }
        : failureShown(event.outcome.failure)),
    },
    'pr.read.AUTOFILL': { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'autofill', {})) },
    'made.autofill': {
      // What the user has typed meanwhile is kept
      actions: assign(({ context, event }) => event.outcome.ok
        ? { createTitle: context.createTitle || event.outcome.value.title, createBody: context.createBody || event.outcome.value.body }
        : failureShown(event.outcome.failure)),
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
    'made.list': { actions: 'takeListPage' },
    'made.listMore': { actions: 'takeListPage' },

    // Asks given up: their answers are no longer waited on
    'pr.DETAILS_LEFT': { actions: enqueueActions(({ enqueue, context }) => made.drop(enqueue, context, 'details')) },
    'pr.DISCUSSION_LEFT': { actions: enqueueActions(({ enqueue, context }) => { made.drop(enqueue, context, 'comments'); made.drop(enqueue, context, 'threads') }) },
    'pr.FILE_DIFFS_LEFT': { actions: enqueueActions(({ enqueue, context }) => made.drop(enqueue, context, 'fileDiff')) },
    // A folder opening leaves everything asked of the folder before but its writes
    'pr.READS_LEFT': { actions: enqueueActions(({ enqueue, context }) => { for (const name of OF_ONE_FOLDER) made.drop(enqueue, context, name) }) },
  },
});

/** The pull-request child's actor, named by whoever reads its context (`codeChild(…)`) */
export type PullRequestActor = ActorRefFrom<typeof pullRequestState>;
