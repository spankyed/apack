import { answering } from '../answer.ts'
import type { OutgoingPullRequestEvents } from '../contract.ts'
import { broadcastToSurface } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, assign, type AnyActorRef } from 'xstate'

import { createLogger } from '@apackdev/sdk/logger'
import { openGitRepository, type AppGitRepository } from '../services/app-git-repository.ts'
import { gitHubApiFor, gitHubOf, type GitHubOfCheckout } from './github.ts'
import { GitHubApiError, type GitHubApi } from '../services/github-api.ts'

const logger = createLogger('pr')

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodePullRequestSystemContext {
  gitRepository: AppGitRepository | null
  /** The code system, which routes a `commit.*` event to its commit child */
  code?: AnyActorRef
  /**
   * Each comparison as its branch diff last fetched and read it, by `comparisonKey`: what a file's diff in it reads,
   * so that opening a file fetches nothing. Emptied when the folder changes
   */
  comparisons: Map<string, Comparison>
}

/** A comparison's two sides, fetched: the commit a file's original side is read at, and the ref of its changes */
interface Comparison {
  /** Where the head left the base: the merge-base, which is what the comparison's files are listed from */
  original: string
  head: string
}

/** What a comparison is asked as */
interface ComparisonAsk { baseBranch: string; headBranch?: string; prNumber?: number }

const comparisonKey = ({ baseBranch, headBranch, prNumber }: ComparisonAsk): string => `${baseBranch}...${headBranch ?? ''}#${prNumber ?? ''}`

export type Event =
  | { type: 'pr.GET_BRANCH_DIFF'; baseBranch?: string; headBranch?: string; prNumber?: number }
  | { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string; prNumber?: number; fetchMissing?: boolean }
  | { type: 'pr.LIST_OPEN_PRS' }
  | { type: 'pr.SELECT_PR'; number: number }
  | { type: 'pr.CREATE_PR'; title: string; body: string; base?: string; draft?: boolean }
  | { type: 'pr.MERGE_PR'; number: number; method?: 'merge' | 'squash' | 'rebase' }
  | { type: 'pr.CLOSE_PR'; number: number }
  | { type: 'pr.TOGGLE_DRAFT'; number: number; isDraft: boolean }
  | { type: 'pr.CHECK_BRANCH_PR' }
  | { type: 'pr.CHECK_GITHUB_ACCESS' }
  | { type: 'pr.GET_PR_AUTOFILL' }
  | { type: 'pr.GET_SMART_BASE_BRANCH' }
  | { type: 'pr.DELETE_BRANCH'; number: number }
  | { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
  | { type: 'pr.CREATE_COMMENT'; number: number; body: string }
  | { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_COMMENT'; commentId: number }
  | { type: 'pr.GET_COMMENTS'; number: number }
  | { type: 'pr.GET_REVIEW_THREADS'; number: number }
  | { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
  | { type: 'pr.RESOLVE_THREAD'; threadId: string }
  | { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
  | { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
  | { type: 'pr.GIT_STATUS_CHANGED' }
  | { type: 'pr.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: AppGitRepository };

function humanizeBranchName(branch: string): string {
  const stripped = branch.replace(/^(feature|fix|bugfix|hotfix|chore|refactor|docs|test|ci|build|perf|style|revert|release|AS|as)[/_]/i, '')
  return stripped
    .replace(/[-_/]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim()
}

/** How a handler answers: to the window that asked, and nowhere when nobody did (`answering`) */
type Emit = (event: OutgoingPullRequestEvents) => void

function emitError(emit: Emit, message: string) {
  emit({ type: 'pr.ERROR', message })
}

/** A failure as the panel is told it: what to say, and for GitHub's, the reason it acts on */
function emitFailure(emit: Emit, error: any) {
  emit({ type: 'pr.ERROR', message: error?.message ?? String(error), ...(error instanceof GitHubApiError && { reason: error.reason }) })
}

/** Run async work that requires a git repository, answering through \`emit\`. Guards null repo, handles errors. */
function withRepo<T>(
  context: CodePullRequestSystemContext,
  emit: Emit,
  work: (repo: AppGitRepository) => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (error: any) => void = (e) => emitError(emit, e.message)
) {
  if (!context.gitRepository) { emitError(emit, 'No git repository available'); return }
  work(context.gitRepository).then(onSuccess).catch(onError)
}

/**
 * Run async work against GitHub's API for the repository the checkout's remote names, with this app's sign-in, and
 * that remote, which every fetch and delete of the work uses. Refused, through `onError` — by default the asker is
 * told why, with GitHub's reason — where there is no repository, no remote on GitHub or no sign-in
 */
function withGitHub<T>(
  context: CodePullRequestSystemContext,
  emit: Emit,
  work: (github: GitHubApi, repo: AppGitRepository, remote: GitHubOfCheckout['remote']) => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (error: any) => void = error => emitFailure(emit, error)
) {
  withRepo(context, emit, async repo => {
    const { github, remote } = await gitHubOf(repo)
    return work(github, repo, remote)
  }, onSuccess, onError)
}

/** A pull request's text as shown, with the images in it loadable, beside the text as written, which an edit starts from */
async function shown<T extends { body: string; rawBody?: string }>(github: GitHubApi, item: T): Promise<T> {
  item.rawBody = item.body
  item.body = await github.resolveAssetUrls(item.body)
  return item
}

/** A pull request's details once GitHub has worked out whether it can merge, with the images in it loadable */
async function settledDetails(github: GitHubApi, number: number) {
  const { comments = [], ...pr } = await github.fetchPRDetailsSettled(number)
  await shown(github, pr)
  for (const comment of comments) await shown(github, comment)
  return { pr, comments }
}

/** The remote a comparison fetches from: the one the current branch follows, else `origin`, else the only one */
async function remoteOf(repo: AppGitRepository): Promise<string> {
  const remote = await repo.readRemote()
  if (!remote) throw new Error('This repository has no remote, so a pull request\'s branches cannot be fetched.')
  return remote.name
}

/** Git's words for a fetch of a branch the remote does not have */
const notOnRemote = (error: any): boolean => /couldn't find remote ref/i.test(error?.message ?? '')

/** Fetches `branch` from `remote`, saying of a branch the remote does not have which side it is */
async function fetchSide(repo: AppGitRepository, branch: string, remote: string, side: 'base' | 'head'): Promise<string> {
  try {
    return await repo.fetchRemoteBranch(branch, remote)
  } catch (error) {
    if (!notOnRemote(error)) throw new Error(`${branch} could not be fetched from ${remote}: ${(error as Error)?.message ?? String(error)}`)
    throw new Error(side === 'head'
      ? `${branch} is no longer on the remote, so its changes cannot be compared.`
      : `${branch}, the branch this is compared with, is not on the remote.`)
  }
}

/**
 * Fetches a comparison's two sides, once, and works out where its files are read from. The head is what GitHub
 * keeps of a pull request where the asker names one (`refs/pull/<n>/head`), which outlives its branch and covers a
 * fork's, the branch's own fetched where only it is named, and the checkout's `HEAD` otherwise. A comparison with
 * a remote head is against the base as the remote has it, which is what GitHub compares with; one of the checkout
 * against its local base, or the remote's where there is no local one. Either side missing is said, by name
 */
async function compare(repo: AppGitRepository, ask: ComparisonAsk): Promise<Comparison & { base: string }> {
  const { baseBranch, headBranch, prNumber } = ask
  let head = 'HEAD'
  let base = baseBranch
  if (prNumber || headBranch) {
    const remote = await remoteOf(repo)
    head = prNumber ? await repo.fetchPullRequest(prNumber, remote) : await fetchSide(repo, headBranch!, remote, 'head')
    base = await fetchSide(repo, baseBranch, remote, 'base')
  } else if (!await repo.commitsExist(baseBranch)) {
    const remote = await repo.readRemote()
    base = remote && await repo.commitsExist(`${remote.name}/${baseBranch}`) ? `${remote.name}/${baseBranch}` : ''
    if (!base) throw new Error(`${baseBranch}, the branch this is compared with, is not a branch here or on the remote.`)
  }
  const original = await repo.mergeBase(base, head)
  if (!original) throw new Error(`${headBranch ?? 'This branch'} and ${baseBranch} share no commit, so there is nothing to compare.`)
  return { base, head, original }
}

/**
 * The branch checked out, as the remote names it: the name of the branch it follows there, where it follows one,
 * and its own otherwise. A detached HEAD is no branch, and is refused in words
 */
async function headBranchOf(repo: AppGitRepository, remote: string): Promise<string> {
  const current = await repo.readCurrentBranch()
  if (current === 'HEAD') throw new Error('The checkout is on a detached HEAD, not a branch. Check out a branch to open a pull request from it.')
  const upstream = (await repo.refsModel()).branches.find(branch => branch.current && !branch.remote)?.upstream
  return upstream?.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : current
}

/**
 * Brings a change GitHub made — a merge, a deleted branch — here: the repository fetches from the remote its branch
 * follows, then the commit child reads it whole, and whatever moved is announced to every window. A fetch that
 * fails leaves the repository as it was, which the read finds
 */
async function fetchAndAnnounce(context: CodePullRequestSystemContext): Promise<void> {
  await context.gitRepository?.fetch().catch(() => undefined)
  context.code?.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true })
}

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodePullRequestSystemContext, Event>();

export const pullRequestSystem = setup({
  types: {
    context: {} as CodePullRequestSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitRepository?: AppGitRepository | null; code?: AnyActorRef }
  },
  actions: handlers.actions({
    getSmartBaseBranch: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => repo.getPRBaseBranch(),
        branch => emit({ type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch } })
      )
    },

    readBranchDiff: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_BRANCH_DIFF'; baseBranch?: string; headBranch?: string; prNumber?: number }
      withRepo(context, emit,
        async repo => {
          const baseBranch = ev.baseBranch ?? await repo.findBaseBranch({ preferUpstream: false })
          const ask = { baseBranch, headBranch: ev.headBranch, prNumber: ev.prNumber }
          const comparison = await compare(repo, ask)
          const files = await repo.readBranchDiff(comparison.original, comparison.head)
          context.comparisons.set(comparisonKey(ask), comparison)
          return { files, baseBranch }
        },
        ({ files, baseBranch }) => emit({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files, baseBranch, headBranch: ev.headBranch } }),
      )
    },

    getBranchFileDiff: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string; prNumber?: number; fetchMissing?: boolean }
      const where = { path: ev.path, baseBranch: ev.baseBranch, headBranch: ev.headBranch, ...(ev.prNumber && { prNumber: ev.prNumber }) }
      withRepo(context, emit,
        repo => ev.fetchMissing ? repo.fetchingMissing(() => read(repo)) : read(repo),
        ({ originalContent, modifiedContent, isImage }) => emit({
          type: 'pr.FILE_DIFF_RECEIVED',
          data: { path: ev.path, staged: false, originalContent, modifiedContent, isImage, baseBranch: ev.baseBranch, headBranch: ev.headBranch }
        }),
        error => error?.code === 'content-missing'
          ? emit({ type: 'pr.FILE_CONTENT_MISSING', data: where })
          : emitError(emit, error?.message ?? String(error)),
      )
      async function read(repo: AppGitRepository) {
        // The comparison its file list was read from, which is fetched again only when that list is asked for
        const key = comparisonKey(ev)
        const comparison = context.comparisons.get(key) ?? await compare(repo, ev)
        context.comparisons.set(key, comparison)
        const isImage = repo.isImageFile(ev.path)
        const getContent = isImage
          ? (p: string, b: string) => repo.getFileContentFromBranchAsDataUrl(p, b)
          : (p: string, b: string) => repo.readFileContentFromBranch(p, b)
        // A side that is missing reads as empty, which is right for a file one branch does not have and wrong
        // for a branch that is not there: that is an error, said as one
        if (!await repo.commitsExist(comparison.original, comparison.head)) {
          throw new Error(`Failed to get file diff between branches: ${ev.baseBranch} or ${ev.headBranch ?? 'HEAD'} is not a commit here`)
        }
        // The editor draws the change from the file's two sides, so those are what is read: no patch is made. The
        // original is the file where the head left the base, so what the base changed since is not shown as undone
        const [originalContent, modifiedContent] = await Promise.all([
          getContent(ev.path, comparison.original),
          getContent(ev.path, comparison.head),
        ])
        return { originalContent, modifiedContent, isImage }
      }
    },

    // --- GitHub ---

    /** Whether this app's sign-in can work with the pull requests of the repository the checkout's remote names */
    checkGitHubAccess: ({ context, reply }) => {
      const emit = answering(reply)
      if (!context.gitRepository) {
        emit({ type: 'pr.GITHUB_ACCESS_CHECKED', data: { access: 'not-github', message: 'No git repository is open.' } })
        return
      }
      withGitHub(context, emit,
        github => github.checkAccess(),
        () => emit({ type: 'pr.GITHUB_ACCESS_CHECKED', data: { access: 'ok' } }),
        error => emit({ type: 'pr.GITHUB_ACCESS_CHECKED', data: { access: error instanceof GitHubApiError ? error.reason : 'failed', message: error?.message ?? String(error) } })
      )
    },

    listOpenPRs: ({ context, reply }) => {
      const emit = answering(reply)
      withGitHub(context, emit,
        github => github.listOpenPRs(),
        prs => emit({ type: 'pr.OPEN_PRS_RECEIVED', data: { prs } }),
      )
    },

    selectPR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.SELECT_PR'; number: number }
      withGitHub(context, emit,
        github => settledDetails(github, ev.number),
        ({ pr, comments }) => {
          emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { pr, comments, fetchedAt: Date.now() } })
        }
      )
    },

    createPR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.CREATE_PR'; title: string; body: string; base?: string; draft?: boolean }
      withGitHub(context, emit,
        async (github, repo, remote) => {
          const head = await headBranchOf(repo, remote)
          const { comments: _comments, ...pr } = await github.createPR({ title: ev.title, body: ev.body, base: ev.base, head, draft: ev.draft })
          return pr
        },
        pr => emit({ type: 'pr.PR_CREATED', data: { pr } })
      )
    },

    mergePR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.MERGE_PR'; number: number; method?: 'merge' | 'squash' | 'rebase' }
      withGitHub(context, emit,
        github => github.mergePR(ev.number, ev.method),
        () => {
          emit({ type: 'pr.PR_MERGED', data: { number: ev.number } })
          // GitHub moved the base: it is fetched, and every window shown what moved
          void fetchAndAnnounce(context)
        },
        async err => {
          // Merge was rejected server-side — refresh PR data so the UI reflects the
          // current check / review / mergeability state the user is actually facing,
          // not whatever stale data triggered the click.
          try {
            if (context.gitRepository) {
              const result = await settledDetails(await gitHubApiFor(context.gitRepository), ev.number)
              emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { ...result, fetchedAt: Date.now() } })
            }
          } catch { /* swallow — we still want to surface the merge error below */ }
          emitFailure(emit, err)
        }
      )
    },

    closePR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.CLOSE_PR'; number: number }
      withGitHub(context, emit,
        github => github.closePR(ev.number),
        () => emit({ type: 'pr.PR_CLOSED', data: { number: ev.number } })
      )
    },

    toggleDraft: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.TOGGLE_DRAFT'; number: number; isDraft: boolean }
      // ev.isDraft is the CURRENT state, so true = draft → ready, false = ready → draft.
      const goingReady = ev.isDraft
      withGitHub(context, emit,
        async github => {
          if (goingReady) {
            await github.markReady(ev.number)
            // Marking a draft ready is GitHub's trigger to start computing
            // mergeability. Same async-settle race as create / update-base — refetch
            // with retry so the Merge button lands on the real state instead of stuck
            // on UNKNOWN. Tolerate refetch failures (toggle already succeeded).
            try {
              return await settledDetails(github, ev.number)
            } catch {
              return null
            }
          }
          await github.markDraft(ev.number)
          return null
        },
        result => {
          emit({ type: 'pr.PR_DRAFT_TOGGLED', data: { number: ev.number, isDraft: !ev.isDraft } })
          if (result) emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { ...result, fetchedAt: Date.now() } })
        }
      )
    },

    checkBranchPR: ({ context, reply }) => {
      const emit = answering(reply)
      if (!context.gitRepository) {
        emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr: null } })
        return
      }
      withGitHub(context, emit,
        async (github, repo, remote) => {
          // A detached HEAD is no branch, and so has no pull request of its own
          if (await repo.readCurrentBranch() === 'HEAD') return null
          const pr = await github.findPRForBranch(await headBranchOf(repo, remote))
          return pr && shown(github, pr)
        },
        pr => emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr } }),
      )
    },

    getPRAutofill: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => Promise.all([repo.getPRBaseBranch(), repo.readCurrentBranch()])
          .then(([baseBranch, currentBranch]) =>
            repo.readCommitsBetween(baseBranch).then(commits => ({ currentBranch, commits }))
          ),
        ({ currentBranch, commits }) => {
          let title = ''
          let body = ''
          if (commits.length === 1) {
            title = commits[0].subject
            body = commits[0].body
          } else if (commits.length > 1) {
            title = humanizeBranchName(currentBranch)
            body = commits.map(c => `- ${c.subject}`).join('\n')
          }
          emit({ type: 'pr.AUTOFILL_RECEIVED', data: { title, body } })
        },
        () => emit({ type: 'pr.AUTOFILL_RECEIVED', data: { title: '', body: '' } })
      )
    },

    updatePR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
      withGitHub(context, emit,
        async github => {
          await github.updatePR(ev.number, { title: ev.title, body: ev.body, base: ev.base })
          // Base changes cause GitHub to recompute mergeability asynchronously —
          // fetch fresh details with retry so the Merge button settles correctly.
          // Title / body edits don't affect mergeability, so skip the extra round-trip.
          if (!ev.base) return null
          // Tolerate refetch failures — the edit above already succeeded, so we
          // must still emit PR_UPDATED. PR_DETAILS_RECEIVED only fires when we actually
          // have fresh data; otherwise the UI keeps the old mergeability until the next
          // refresh, which is strictly better than a misleading error banner.
          try {
            return await settledDetails(github, ev.number)
          } catch {
            return null
          }
        },
        result => {
          emit({ type: 'pr.PR_UPDATED', data: { number: ev.number, title: ev.title, body: ev.body, base: ev.base } })
          if (result) emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { ...result, fetchedAt: Date.now() } })
        }
      )
    },

    // --- Comment actions ---

    createComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.CREATE_COMMENT'; number: number; body: string }
      withGitHub(context, emit,
        github => github.createPRComment(ev.number, ev.body),
        () => emit({ type: 'pr.COMMENT_CREATED', data: { number: ev.number } })
      )
    },

    editComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
      withGitHub(context, emit,
        github => github.editPRComment(ev.commentId, ev.body),
        () => emit({ type: 'pr.COMMENT_EDITED', data: { commentId: ev.commentId } })
      )
    },

    deleteComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_COMMENT'; commentId: number }
      withGitHub(context, emit,
        github => github.deletePRComment(ev.commentId),
        () => emit({ type: 'pr.COMMENT_DELETED', data: { commentId: ev.commentId } })
      )
    },

    getComments: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_COMMENTS'; number: number }
      withGitHub(context, emit,
        async github => {
          const comments = await github.getPRComments(ev.number)
          for (const comment of comments) await shown(github, comment)
          return comments
        },
        comments => emit({ type: 'pr.COMMENTS_RECEIVED', data: { number: ev.number, comments } }),
        // Swallow errors — this is the post-mutation refresh. The mutation itself
        // already succeeded; a transient refetch failure shouldn't surface as a red
        // error banner for the user. Next mutation or manual refresh re-populates.
        err => logger.warn('GET_COMMENTS refetch failed', { prNumber: ev.number, error: err?.message }),
      )
    },

    getReviewThreads: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_REVIEW_THREADS'; number: number }
      withGitHub(context, emit,
        github => github.getReviewThreads(ev.number),
        threads => emit({ type: 'pr.REVIEW_THREADS_RECEIVED', data: { threads } })
      )
    },

    replyToThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
      withGitHub(context, emit,
        github => github.replyToReviewThread(ev.prNumber, ev.commentId, ev.body),
        () => emit({ type: 'pr.THREAD_REPLIED', data: { prNumber: ev.prNumber } })
      )
    },

    resolveThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.RESOLVE_THREAD'; threadId: string }
      withGitHub(context, emit,
        github => github.resolveReviewThread(ev.threadId),
        () => emit({ type: 'pr.THREAD_RESOLVED', data: { threadId: ev.threadId } })
      )
    },

    unresolveThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
      withGitHub(context, emit,
        github => github.unresolveReviewThread(ev.threadId),
        () => emit({ type: 'pr.THREAD_UNRESOLVED', data: { threadId: ev.threadId } })
      )
    },

    editReviewComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
      withGitHub(context, emit,
        github => github.editReviewComment(ev.commentId, ev.body),
        () => emit({ type: 'pr.REVIEW_COMMENT_EDITED', data: { commentId: ev.commentId } })
      )
    },

    deleteReviewComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
      withGitHub(context, emit,
        github => github.deleteReviewComment(ev.commentId),
        () => emit({ type: 'pr.REVIEW_COMMENT_DELETED', data: { commentId: ev.commentId } })
      )
    },

    /**
     * Deletes a pull request's branch through GitHub, only where it is a branch of this repository — a fork's is
     * not this repository's to delete — that no other open pull request is from. One GitHub already deleted, on
     * merge say, is deleted
     */
    deleteBranch: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_BRANCH'; number: number }
      withGitHub(context, emit,
        async github => {
          const { branch, isCrossRepository } = await github.readHead(ev.number)
          if (isCrossRepository) throw new Error(`#${ev.number} is from a branch of another repository, a fork, which is not this repository's to delete.`)
          const others = (await github.openPRsFromBranch(branch)).filter(number => number !== ev.number)
          if (others.length > 0) throw new Error(`${branch} is kept: open pull request${others.length > 1 ? 's' : ''} ${others.map(number => `#${number}`).join(', ')} ${others.length > 1 ? 'are' : 'is'} from it too.`)
          await github.deleteBranch(branch)
          return branch
        },
        branch => {
          emit({ type: 'pr.BRANCH_DELETED', data: { branch } })
          void fetchAndAnnounce(context)
        },
      )
    },

    // News for every window: the repository's commits or branches moved under them
    handleGitStatusChanged: () => {
      broadcastToSurface(surfaceId, { type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } })
    },

    updateBaseDirectory: assign({
      gitRepository: ({ event }) => {
        const ev = event as { type: 'pr.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: AppGitRepository }
        return ev.gitRepository
      },
      comparisons: () => new Map(),
    }),

  })
}).createMachine({
  id: 'pull-request',
  initial: 'idle',
  context: ({ input }) => ({
    gitRepository: input?.gitRepository || (input?.baseDirectory ? openGitRepository(input.baseDirectory) : null),
    code: input?.code,
    comparisons: new Map(),
  }),
  states: {
    idle: {
      on: {
        'pr.GET_BRANCH_DIFF': { actions: 'readBranchDiff' },
        'pr.GET_BRANCH_FILE_DIFF': { actions: 'getBranchFileDiff' },
        'pr.LIST_OPEN_PRS': { actions: 'listOpenPRs' },
        'pr.SELECT_PR': { actions: 'selectPR' },
        'pr.CREATE_PR': { actions: 'createPR' },
        'pr.MERGE_PR': { actions: 'mergePR' },
        'pr.CLOSE_PR': { actions: 'closePR' },
        'pr.TOGGLE_DRAFT': { actions: 'toggleDraft' },
        'pr.CHECK_BRANCH_PR': { actions: 'checkBranchPR' },
        'pr.GET_SMART_BASE_BRANCH': { actions: 'getSmartBaseBranch' },
        'pr.DELETE_BRANCH': { actions: 'deleteBranch' },
        'pr.UPDATE_PR': { actions: 'updatePR' },
        'pr.CREATE_COMMENT': { actions: 'createComment' },
        'pr.EDIT_COMMENT': { actions: 'editComment' },
        'pr.DELETE_COMMENT': { actions: 'deleteComment' },
        'pr.GET_COMMENTS': { actions: 'getComments' },
        'pr.GET_REVIEW_THREADS': { actions: 'getReviewThreads' },
        'pr.REPLY_TO_THREAD': { actions: 'replyToThread' },
        'pr.RESOLVE_THREAD': { actions: 'resolveThread' },
        'pr.UNRESOLVE_THREAD': { actions: 'unresolveThread' },
        'pr.EDIT_REVIEW_COMMENT': { actions: 'editReviewComment' },
        'pr.DELETE_REVIEW_COMMENT': { actions: 'deleteReviewComment' },
        'pr.CHECK_GITHUB_ACCESS': { actions: 'checkGitHubAccess' },
        'pr.GET_PR_AUTOFILL': { actions: 'getPRAutofill' },
        'pr.GIT_STATUS_CHANGED': { actions: 'handleGitStatusChanged' },
        'pr.UPDATE_BASE_DIRECTORY': { actions: ['updateBaseDirectory'] }
      }
    }
  }
})
