import { answering } from '../answer.ts'
import type { OutgoingPullRequestEvents } from '../contract.ts'
import { broadcastToSurface } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, assign, type AnyActorRef } from 'xstate'

import { createLogger } from '@apackdev/sdk/logger'
import { openGitRepository, type AppGitRepository } from '../services/app-git-repository.ts'
import { gitHubApiFor } from './github.ts'
import { GitHubApiError, type GitHubApi } from '../services/github-api.ts'

const logger = createLogger('pr')

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodePullRequestSystemContext {
  gitRepository: AppGitRepository | null
  /** The code system, which routes a `commit.*` event to its commit child */
  code?: AnyActorRef
}

export type Event =
  | { type: 'pr.GET_BASE_BRANCH' }
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
  | { type: 'pr.DELETE_BRANCH'; branch: string }
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
 * Run async work against GitHub's API for the repository the checkout's remote names, with this app's sign-in.
 * Refused, through `onError`, where there is no repository, no remote on github.com or no sign-in
 */
function withGitHub<T>(
  context: CodePullRequestSystemContext,
  emit: Emit,
  work: (github: GitHubApi, repo: AppGitRepository) => Promise<T>,
  onSuccess: (result: T) => void,
  onError?: (error: any) => void
) {
  withRepo(context, emit, async repo => work(await gitHubApiFor(repo), repo), onSuccess, onError)
}

/** A pull request's details once GitHub has worked out whether it can merge, with the images in it loadable */
async function settledDetails(github: GitHubApi, number: number) {
  const { comments = [], ...pr } = await github.fetchPRDetailsSettled(number)
  pr.body = await github.resolveAssetUrls(pr.body)
  for (const comment of comments) comment.body = await github.resolveAssetUrls(comment.body)
  return { pr, comments }
}

/**
 * The ref a comparison's head is read from, fetched first: what GitHub keeps of a pull request where the asker
 * names one (`refs/pull/<n>/head`), which outlives its branch and covers a fork's, and the branch's own otherwise
 */
async function headOf(repo: AppGitRepository, headBranch?: string, prNumber?: number): Promise<string | undefined> {
  if (prNumber) return repo.fetchPullRequest(prNumber)
  if (!headBranch) return undefined
  await repo.fetchRemoteBranch(headBranch)
  return `origin/${headBranch}`
}

/** What to say of a comparison whose branch the remote no longer has, in place of git's words for a missing ref */
const headGone = (error: any, headBranch?: string): string | undefined =>
  error?.code === 'unknown-ref' && headBranch ? `${headBranch} is no longer on the remote, so its changes cannot be compared.` : undefined

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodePullRequestSystemContext, Event>();

export const pullRequestSystem = setup({
  types: {
    context: {} as CodePullRequestSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitRepository?: AppGitRepository | null; code?: AnyActorRef }
  },
  actions: handlers.actions({
    findBaseBranch: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => repo.findBaseBranch({ preferUpstream: false }),
        branch => emit({ type: 'pr.BASE_BRANCH_RECEIVED', data: { branch } })
      )
    },

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
          const base = ev.baseBranch ? Promise.resolve(ev.baseBranch) : repo.findBaseBranch({ preferUpstream: false })
          const head = await headOf(repo, ev.headBranch, ev.prNumber)
          const baseBranch = await base
          const files = await repo.readBranchDiff(baseBranch, head)
          return { files, baseBranch }
        },
        ({ files, baseBranch }) => emit({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files, baseBranch, headBranch: ev.headBranch } }),
        error => emitError(emit, headGone(error, ev.headBranch) ?? error?.message ?? String(error)),
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
          : emitError(emit, headGone(error, ev.headBranch) ?? error?.message ?? String(error)),
      )
      async function read(repo: AppGitRepository) {
        const target = await headOf(repo, ev.headBranch, ev.prNumber) ?? 'HEAD'
        const isImage = repo.isImageFile(ev.path)
        const getContent = isImage
          ? (p: string, b: string) => repo.getFileContentFromBranchAsDataUrl(p, b)
          : (p: string, b: string) => repo.readFileContentFromBranch(p, b)
        // A side that is missing reads as empty, which is right for a file one branch does not have and wrong
        // for a branch that is not there: that is an error, said as one
        if (!await repo.commitsExist(ev.baseBranch, target)) {
          throw new Error(`Failed to get file diff between branches: ${ev.baseBranch} or ${target} is not a commit here`)
        }
        // The editor draws the change from the file's two sides, so those are what is read: no patch is made
        const [originalContent, modifiedContent] = await Promise.all([
          getContent(ev.path, ev.baseBranch),
          getContent(ev.path, target),
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
        () => emit({ type: 'pr.OPEN_PRS_RECEIVED', data: { prs: [] } })
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
        async (github, repo) => {
          const head = await repo.readCurrentBranch()
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
          context.code?.send({ type: 'commit.GET_ALL_BRANCHES' })
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
          emitError(emit, err.message)
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
        async (github, repo) => {
          const pr = await github.findPRForBranch(await repo.readCurrentBranch())
          if (pr?.body) pr.body = await github.resolveAssetUrls(pr.body)
          return pr
        },
        pr => emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr } }),
        () => emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr: null } })
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
          for (const c of comments) c.body = await github.resolveAssetUrls(c.body)
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

    deleteBranch: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_BRANCH'; branch: string }
      withRepo(context, emit,
        repo => repo.deleteRemoteBranch(ev.branch),
        () => emit({ type: 'pr.BRANCH_DELETED', data: { branch: ev.branch } })
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
      }
    }),

  })
}).createMachine({
  id: 'pull-request',
  initial: 'idle',
  context: ({ input }) => ({
    gitRepository: input?.gitRepository || (input?.baseDirectory ? openGitRepository(input.baseDirectory) : null),
    code: input?.code
  }),
  states: {
    idle: {
      on: {
        'pr.GET_BASE_BRANCH': { actions: 'findBaseBranch' },
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
