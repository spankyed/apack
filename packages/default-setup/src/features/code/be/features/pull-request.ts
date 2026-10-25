import { answering } from '../answer.ts'
import type { OutgoingPullRequestEvents } from '../contract.ts'
import { broadcastToSurface } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, assign, type AnyActorRef } from 'xstate'

import { createLogger } from '@apackdev/sdk/logger'
import { GitRepository } from '../services/git.ts'
import * as ghCli from '../services/gh-cli.ts'

const logger = createLogger('pr')

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodePullRequestSystemContext {
  gitRepository: GitRepository | null
  /** The code system, which routes a `commit.*` event to its commit child */
  code?: AnyActorRef
}

export type Event =
  | { type: 'pr.GET_BASE_BRANCH' }
  | { type: 'pr.GET_BRANCH_DIFF'; baseBranch?: string; headBranch?: string }
  | { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string }
  | { type: 'pr.LIST_OPEN_PRS' }
  | { type: 'pr.SELECT_PR'; number: number }
  | { type: 'pr.CREATE_PR'; title: string; body: string; base?: string; draft?: boolean }
  | { type: 'pr.MERGE_PR'; number: number; method?: 'merge' | 'squash' | 'rebase' }
  | { type: 'pr.CLOSE_PR'; number: number }
  | { type: 'pr.TOGGLE_DRAFT'; number: number; isDraft: boolean }
  | { type: 'pr.CHECK_BRANCH_PR' }
  | { type: 'pr.CHECK_GH_AUTH' }
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
  | { type: 'pr.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository };

function humanizeBranchName(branch: string): string {
  const stripped = branch.replace(/^(feature|fix|bugfix|hotfix|chore|refactor|docs|test|ci|build|perf|style|revert|release|AS|as)[/_]/i, '')
  return stripped
    .replace(/[-_/]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim()
}

/** How a handler answers: to the window that asked, or every window when nobody did (\`answering\`) */
type Emit = (event: OutgoingPullRequestEvents) => void

function emitError(emit: Emit, message: string) {
  emit({ type: 'pr.ERROR', message })
}

/** Run async work that requires a git repository, answering through \`emit\`. Guards null repo, handles errors. */
function withRepo<T>(
  context: CodePullRequestSystemContext,
  emit: Emit,
  work: (repo: GitRepository) => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (error: any) => void = (e) => emitError(emit, e.message)
) {
  if (!context.gitRepository) { emitError(emit, 'No git repository available'); return }
  work(context.gitRepository).then(onSuccess).catch(onError)
}

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodePullRequestSystemContext, Event>();

export const pullRequestSystem = setup({
  types: {
    context: {} as CodePullRequestSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitRepository?: GitRepository | null; code?: AnyActorRef }
  },
  actions: handlers.actions({
    getBaseBranch: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => repo.getBaseBranch({ preferUpstream: false }),
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

    getBranchDiff: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_BRANCH_DIFF'; baseBranch?: string; headBranch?: string }
      withRepo(context, emit,
        async repo => {
          const base = ev.baseBranch ? Promise.resolve(ev.baseBranch) : repo.getBaseBranch({ preferUpstream: false })
          const head = ev.headBranch ? `origin/${ev.headBranch}` : undefined
          if (ev.headBranch) {
            await repo.fetchRemoteBranch(ev.headBranch)
          }
          const baseBranch = await base
          const files = await repo.getBranchDiff(baseBranch, head)
          return { files, baseBranch }
        },
        ({ files, baseBranch }) => emit({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files, baseBranch, headBranch: ev.headBranch } })
      )
    },

    getBranchFileDiff: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_BRANCH_FILE_DIFF'; path: string; baseBranch: string; headBranch?: string }
      const target = ev.headBranch ? `origin/${ev.headBranch}` : 'HEAD'
      withRepo(context, emit,
        async repo => {
          if (ev.headBranch) {
            await repo.fetchRemoteBranch(ev.headBranch)
          }
          const isImage = repo.isImageFile(ev.path)
          const getContent = isImage
            ? (p: string, b: string) => repo.getFileContentFromBranchAsDataUrl(p, b)
            : (p: string, b: string) => repo.getFileContentFromBranch(p, b)
          const [diff, originalContent, modifiedContent] = await Promise.all([
            repo.getFileDiffBetweenBranches(ev.path, ev.baseBranch, target),
            getContent(ev.path, ev.baseBranch),
            getContent(ev.path, target),
          ])
          return { diff, originalContent, modifiedContent, isImage }
        },
        ({ diff, originalContent, modifiedContent, isImage }) => emit({
          type: 'pr.FILE_DIFF_RECEIVED',
          data: { path: ev.path, diff, staged: false, originalContent, modifiedContent, isImage, baseBranch: ev.baseBranch, headBranch: ev.headBranch }
        })
      )
    },

    // --- GitHub CLI actions ---

    checkGhAuth: ({ context, reply }) => {
      const emit = answering(reply)
      if (!context.gitRepository) {
        emit({ type: 'pr.GH_AUTH_CHECKED', data: { available: false, prAccess: false, activeToken: null } })
        return
      }
      withRepo(context, emit,
        repo => ghCli.checkAuth(repo.getWorkingDir()),
        result => emit({ type: 'pr.GH_AUTH_CHECKED', data: result }),
        () => emit({ type: 'pr.GH_AUTH_CHECKED', data: { available: false, prAccess: false, activeToken: null } })
      )
    },

    listOpenPRs: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => ghCli.listOpenPRs(repo.getWorkingDir()),
        prs => emit({ type: 'pr.OPEN_PRS_RECEIVED', data: { prs } }),
        () => emit({ type: 'pr.OPEN_PRS_RECEIVED', data: { prs: [] } })
      )
    },

    selectPR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.SELECT_PR'; number: number }
      withRepo(context, emit,
        async repo => {
          const cwd = repo.getWorkingDir()
          const details = await ghCli.fetchPRDetailsSettled(cwd, ev.number)
          const { comments = [], ...pr } = details
          // Resolve GitHub asset URLs to signed S3 URLs so images load in Electron
          pr.body = await ghCli.resolveGitHubAssetUrls(pr.body, cwd)
          for (const comment of comments) {
            comment.body = await ghCli.resolveGitHubAssetUrls(comment.body, cwd)
          }
          return { pr, comments }
        },
        ({ pr, comments }) => {
          emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { pr, comments, fetchedAt: Date.now() } })
        }
      )
    },

    createPR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.CREATE_PR'; title: string; body: string; base?: string; draft?: boolean }
      withRepo(context, emit,
        repo => repo.getCurrentBranch().then(head =>
          ghCli.createPR(repo.getWorkingDir(), { title: ev.title, body: ev.body, base: ev.base, head, draft: ev.draft })
        ),
        pr => emit({ type: 'pr.PR_CREATED', data: { pr } })
      )
    },

    mergePR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.MERGE_PR'; number: number; method?: 'merge' | 'squash' | 'rebase' }
      withRepo(context, emit,
        repo => ghCli.mergePR(repo.getWorkingDir(), ev.number, ev.method),
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
              const cwd = context.gitRepository.getWorkingDir()
              const details = await ghCli.fetchPRDetailsSettled(cwd, ev.number)
              const { comments = [], ...pr } = details
              pr.body = await ghCli.resolveGitHubAssetUrls(pr.body, cwd)
              for (const c of comments) c.body = await ghCli.resolveGitHubAssetUrls(c.body, cwd)
              emit({ type: 'pr.PR_DETAILS_RECEIVED', data: { pr, comments, fetchedAt: Date.now() } })
            }
          } catch { /* swallow — we still want to surface the merge error below */ }
          emitError(emit, err.message)
        }
      )
    },

    closePR: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.CLOSE_PR'; number: number }
      withRepo(context, emit,
        repo => ghCli.closePR(repo.getWorkingDir(), ev.number),
        () => emit({ type: 'pr.PR_CLOSED', data: { number: ev.number } })
      )
    },

    toggleDraft: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.TOGGLE_DRAFT'; number: number; isDraft: boolean }
      // ev.isDraft is the CURRENT state, so true = draft → ready, false = ready → draft.
      const goingReady = ev.isDraft
      withRepo(context, emit,
        async repo => {
          const cwd = repo.getWorkingDir()
          if (goingReady) {
            await ghCli.markReady(cwd, ev.number)
            // Marking a draft ready is GitHub's trigger to start computing
            // mergeability. Same async-settle race as create / update-base — refetch
            // with retry so the Merge button lands on the real state instead of stuck
            // on UNKNOWN. Tolerate refetch failures (toggle already succeeded).
            try {
              const details = await ghCli.fetchPRDetailsSettled(cwd, ev.number)
              const { comments = [], ...pr } = details
              pr.body = await ghCli.resolveGitHubAssetUrls(pr.body, cwd)
              for (const c of comments) c.body = await ghCli.resolveGitHubAssetUrls(c.body, cwd)
              return { pr, comments }
            } catch {
              return null
            }
          }
          await ghCli.markDraft(cwd, ev.number)
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
      withRepo(context, emit,
        async repo => {
          const cwd = repo.getWorkingDir()
          const branch = await repo.getCurrentBranch()
          const pr = await ghCli.findPRForBranch(cwd, branch)
          if (pr?.body) {
            pr.body = await ghCli.resolveGitHubAssetUrls(pr.body, cwd)
          }
          return pr
        },
        pr => emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr } }),
        () => emit({ type: 'pr.BRANCH_PR_CHECKED', data: { pr: null } })
      )
    },

    getPRAutofill: ({ context, reply }) => {
      const emit = answering(reply)
      withRepo(context, emit,
        repo => Promise.all([repo.getPRBaseBranch(), repo.getCurrentBranch()])
          .then(([baseBranch, currentBranch]) =>
            repo.getCommitsBetweenBranches(baseBranch).then(commits => ({ currentBranch, commits }))
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
      withRepo(context, emit,
        async repo => {
          const cwd = repo.getWorkingDir()
          await ghCli.updatePR(cwd, ev.number, { title: ev.title, body: ev.body, base: ev.base })
          // Base changes cause GitHub to recompute mergeability asynchronously —
          // fetch fresh details with retry so the Merge button settles correctly.
          // Title / body edits don't affect mergeability, so skip the extra round-trip.
          if (!ev.base) return null
          // Tolerate refetch failures — the gh pr edit above already succeeded, so we
          // must still emit PR_UPDATED. PR_DETAILS_RECEIVED only fires when we actually
          // have fresh data; otherwise the UI keeps the old mergeability until the next
          // refresh, which is strictly better than a misleading error banner.
          try {
            const details = await ghCli.fetchPRDetailsSettled(cwd, ev.number)
            const { comments = [], ...pr } = details
            pr.body = await ghCli.resolveGitHubAssetUrls(pr.body, cwd)
            for (const c of comments) c.body = await ghCli.resolveGitHubAssetUrls(c.body, cwd)
            return { pr, comments }
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
      withRepo(context, emit,
        repo => ghCli.createPRComment(repo.getWorkingDir(), ev.number, ev.body),
        () => emit({ type: 'pr.COMMENT_CREATED', data: { number: ev.number } })
      )
    },

    editComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
      withRepo(context, emit,
        repo => ghCli.editPRComment(repo.getWorkingDir(), ev.commentId, ev.body),
        () => emit({ type: 'pr.COMMENT_EDITED', data: { commentId: ev.commentId } })
      )
    },

    deleteComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_COMMENT'; commentId: number }
      withRepo(context, emit,
        repo => ghCli.deletePRComment(repo.getWorkingDir(), ev.commentId),
        () => emit({ type: 'pr.COMMENT_DELETED', data: { commentId: ev.commentId } })
      )
    },

    getComments: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.GET_COMMENTS'; number: number }
      withRepo(context, emit,
        async repo => {
          const cwd = repo.getWorkingDir()
          const comments = await ghCli.getPRComments(cwd, ev.number)
          for (const c of comments) c.body = await ghCli.resolveGitHubAssetUrls(c.body, cwd)
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
      withRepo(context, emit,
        repo => ghCli.getReviewThreads(repo.getWorkingDir(), ev.number),
        threads => emit({ type: 'pr.REVIEW_THREADS_RECEIVED', data: { threads } })
      )
    },

    replyToThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
      withRepo(context, emit,
        repo => ghCli.replyToReviewThread(repo.getWorkingDir(), ev.prNumber, ev.commentId, ev.body),
        () => emit({ type: 'pr.THREAD_REPLIED', data: { prNumber: ev.prNumber } })
      )
    },

    resolveThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.RESOLVE_THREAD'; threadId: string }
      withRepo(context, emit,
        _repo => ghCli.resolveReviewThread(_repo.getWorkingDir(), ev.threadId),
        () => emit({ type: 'pr.THREAD_RESOLVED', data: { threadId: ev.threadId } })
      )
    },

    unresolveThread: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
      withRepo(context, emit,
        _repo => ghCli.unresolveReviewThread(_repo.getWorkingDir(), ev.threadId),
        () => emit({ type: 'pr.THREAD_UNRESOLVED', data: { threadId: ev.threadId } })
      )
    },

    editReviewComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
      withRepo(context, emit,
        repo => ghCli.editReviewComment(repo.getWorkingDir(), ev.commentId, ev.body),
        () => emit({ type: 'pr.REVIEW_COMMENT_EDITED', data: { commentId: ev.commentId } })
      )
    },

    deleteReviewComment: ({ event, context, reply }) => {
      const emit = answering(reply)
      const ev = event as { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
      withRepo(context, emit,
        repo => ghCli.deleteReviewComment(repo.getWorkingDir(), ev.commentId),
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

    // News for every window: the repository changed under them
    handleGitStatusChanged: () => {
      broadcastToSurface(surfaceId, { type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } })
    },

    updateBaseDirectory: assign({
      gitRepository: ({ event }) => {
        const ev = event as { type: 'pr.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository }
        return ev.gitRepository
      }
    }),

  })
}).createMachine({
  id: 'pull-request',
  initial: 'idle',
  context: ({ input }) => ({
    gitRepository: input?.gitRepository || (input?.baseDirectory ? new GitRepository(input.baseDirectory) : null),
    code: input?.code
  }),
  states: {
    idle: {
      on: {
        'pr.GET_BASE_BRANCH': { actions: 'getBaseBranch' },
        'pr.GET_BRANCH_DIFF': { actions: 'getBranchDiff' },
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
        'pr.CHECK_GH_AUTH': { actions: 'checkGhAuth' },
        'pr.GET_PR_AUTOFILL': { actions: 'getPRAutofill' },
        'pr.GIT_STATUS_CHANGED': { actions: 'handleGitStatusChanged' },
        'pr.UPDATE_BASE_DIRECTORY': { actions: ['updateBaseDirectory'] }
      }
    }
  }
})
