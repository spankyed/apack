import type { PRDetails, PullRequestAsks } from '../contract.ts'
import { broadcast } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework'
import type { AsksEvents } from '@apackdev/sdk/events'
import { safeEvents } from '@apackdev/sdk/helpers'
import { setup, assign, type AnyActorRef } from 'xstate'

import { createLogger } from '@apackdev/sdk/logger'
import { services } from '#generated/services.ts'
import type { AppGitRepository } from '../services/app-git-repository.ts'
import { gitHubOf, type GitHubOfCheckout } from './github.ts'
import { GitHubApiError, type GitHubApi, type GitHubApiFailure } from '../services/github-api.ts'
import type { PRBranchCheckout } from '../types.ts'

const logger = createLogger('pr')

const surfaceId = 'code' as const

/** What the pull request child answers its asks over */
export interface CodePullRequestSystemContext {
  /** The repository of the folder the code system is over, `null` where it is over none */
  gitRepository: AppGitRepository | null
  /** The code system, which routes what this child tells the commit child */
  code?: AnyActorRef
  /**
   * Each comparison as its branch diff last fetched and read it, by `comparisonKey`, so that opening a file fetches
   * nothing. Emptied when the folder changes
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
  | { type: 'pr.GIT_STATUS_CHANGED' }
  | { type: 'pr.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: AppGitRepository | null }
  // The pull request asks, which the code system forwards here to be answered
  | AsksEvents<PullRequestAsks>;

/** The repository the code surface is over, for an ask that runs git: an ask made with none is refused */
function gitRepositoryOf(context: CodePullRequestSystemContext): AppGitRepository {
  if (!context.gitRepository) throw new Error('No directory selected. Please select a directory first.')
  return context.gitRepository
}

function humanizeBranchName(branch: string): string {
  const stripped = branch.replace(/^(feature|fix|bugfix|hotfix|chore|refactor|docs|test|ci|build|perf|style|revert|release|AS|as)[/_]/i, '')
  return stripped
    .replace(/[-_/]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim()
}

/** How an answer refuses for a reason of GitHub's: the `failure` its handler is handed */
type GitHubRefusal = (kind: 'github', message: string, data: { reason: GitHubApiFailure }) => Error

/** A refusal of GitHub's as the asker is told it, with the reason the panel acts on; any other error as it is */
const refusedBy = (failure: GitHubRefusal) => (error: unknown): never => {
  throw error instanceof GitHubApiError ? failure('github', error.message, { reason: error.reason }) : error
}

/**
 * Runs `work` against GitHub's API for the repository the checkout's remote names, with this app's sign-in, and that
 * remote, which every fetch and delete of the work uses. Refused — with GitHub's reason, where it gave one — where
 * there is no repository, no remote on GitHub or no sign-in
 */
async function onGitHub<T>(
  context: CodePullRequestSystemContext,
  failure: GitHubRefusal,
  work: (github: GitHubApi, repo: AppGitRepository, remotes: Omit<GitHubOfCheckout, 'github'>) => Promise<T>,
  /** Asked of the repository first, and GitHub is asked nothing where it answers */
  before?: (repo: AppGitRepository) => Promise<{ answer: T } | undefined>,
): Promise<T> {
  const repo = gitRepositoryOf(context)
  const early = await before?.(repo)
  if (early) return early.answer
  return gitHubOf(repo).then(({ github, ...remotes }) => work(github, repo, remotes)).catch(refusedBy(failure))
}

/** The words for a detached HEAD, which is no branch to open a pull request from */
const DETACHED = 'The checkout is on a detached HEAD, not a branch. Check out a branch to open a pull request from it.'
const onNoBranch = async (repo: AppGitRepository) => await repo.readCurrentBranch() === 'HEAD'

/** A pull request's text as shown, with the images in it loadable, beside the text as written, which an edit starts from */
async function shown<T extends { body: string; rawBody?: string }>(github: GitHubApi, item: T): Promise<T> {
  item.rawBody = item.body
  item.body = await github.resolveAssetUrls(item.body)
  return item
}

/** A pull request's details once GitHub has worked out whether it can merge, with the images in it loadable */
async function settledDetails(github: GitHubApi, number: number): Promise<PRDetails> {
  const { comments = [], ...pr } = await github.fetchPRDetailsSettled(number)
  await shown(github, pr)
  for (const comment of comments) await shown(github, comment)
  return { pr, comments, fetchedAt: Date.now() }
}

/** Those details where GitHub gives them: a write that succeeded is not refused for a read after it that did not */
const detailsIfRead = (github: GitHubApi, number: number): Promise<PRDetails | undefined> =>
  settledDetails(github, number).catch(() => undefined)

/**
 * The remotes a comparison fetches from: the head's, and the base's, which is where GitHub keeps a pull request's
 * ref. They are one remote but for a fork, whose base is its parent's (`gitHubOf`). Where GitHub cannot be asked —
 * no sign-in, or a remote elsewhere — both are the one the current branch follows, else `origin`, else the only one
 */
async function remotesOf(repo: AppGitRepository): Promise<{ remote: string; baseRemote?: string }> {
  const known = await gitHubOf(repo).then(({ remote, baseRemote }) => ({ remote, baseRemote }), () => undefined)
  if (known) return known
  const remote = await repo.readRemote()
  if (!remote) throw new Error('This repository has no remote, so a pull request\'s branches cannot be fetched.')
  return { remote: remote.name, baseRemote: remote.name }
}

/** The remote naming the repository a fork's pull requests are on, which nothing can be fetched from without */
async function baseRemoteOf(repo: AppGitRepository, remotes: { baseRemote?: string }): Promise<string> {
  if (remotes.baseRemote) return remotes.baseRemote
  const { github } = await gitHubOf(repo)
  const parent = `${github.repo.owner}/${github.repo.name}`
  throw new Error(`This checkout is of a fork of ${parent}, and no remote here names ${parent}: add one (git remote add upstream ${services.github.endpoints.web}/${parent}.git) to read its pull requests' changes.`)
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
 * fork's, the branch's own fetched where only it is named, and the checkout's `HEAD` otherwise; the pull request's
 * ref and the base come from the remote naming the repository the pull request is on (`remotesOf`). A comparison with
 * a remote head is against the base as the remote has it, which is what GitHub compares with; one of the checkout
 * against its local base, or the remote's where there is no local one. Either side missing is said, by name
 */
async function compare(repo: AppGitRepository, ask: ComparisonAsk): Promise<Comparison & { base: string }> {
  const { baseBranch, headBranch, prNumber } = ask
  let head = 'HEAD'
  let base = baseBranch
  if (prNumber || headBranch) {
    const remotes = await remotesOf(repo)
    const baseRemote = await baseRemoteOf(repo, remotes)
    head = prNumber ? await repo.fetchPullRequest(prNumber, baseRemote) : await fetchSide(repo, headBranch!, remotes.remote, 'head')
    base = await fetchSide(repo, baseBranch, baseRemote, 'base')
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
async function headBranchOf(repo: AppGitRepository, { remote }: { remote: string }): Promise<string> {
  const current = await repo.readCurrentBranch()
  if (current === 'HEAD') throw new Error(DETACHED)
  const upstream = (await repo.refsModel()).branches.find(branch => branch.current && !branch.remote)?.upstream
  return upstream?.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : current
}

/**
 * Brings a change GitHub made — a merge, a deleted branch — here: the repository fetches from the remote its branch
 * follows, and the fetch is announced to every window as this app's other writes are (`commit.GIT_STATUS_CHANGED`).
 * A write is announced whether or not a window has asked since the last news, where a hint is put off until one
 * does: the pull request panel, which is what follows a merge, asks for no status. A fetch that fails leaves the
 * repository as it was, which the read finds
 */
async function fetchAndAnnounce(repo: AppGitRepository, code: AnyActorRef | undefined): Promise<void> {
  await repo.fetch().catch(() => undefined)
  announceWrite(code)
}

/** Has the commit child check the repository after a write here, and announce what it changed: the code system routes it there */
const announceWrite = (code: AnyActorRef | undefined): void => {
  code?.send({ type: 'commit.GIT_STATUS_CHANGED' })
}

/** Reads the branch's commits for a new pull request's title and body: one commit's own, or the branch's name and a list */
function autofillOf(currentBranch: string, commits: { subject: string; body: string }[]): { title: string; body: string } {
  if (commits.length === 1) return { title: commits[0]!.subject, body: commits[0]!.body }
  if (commits.length > 1) return { title: humanizeBranchName(currentBranch), body: commits.map(c => `- ${c.subject}`).join('\n') }
  return { title: '', body: '' }
}

const handlers = defineHandlers<CodePullRequestSystemContext, Event>()
const typeOf = safeEvents<Event>()

/** The pull request asks, answered here over the repository and the comparisons this machine holds */
const answers = handlers.answers<PullRequestAsks>({
  'pr.GET_SMART_BASE_BRANCH': async ({ context }) => ({ branch: await gitRepositoryOf(context).getPRBaseBranch() }),

  'pr.GET_BRANCH_DIFF': async ({ args: { baseBranch: asked, headBranch, prNumber }, context }) => {
    const repo = gitRepositoryOf(context)
    const baseBranch = asked ?? await repo.findBaseBranch({ preferUpstream: false })
    const comparisonAsk = { baseBranch, headBranch, prNumber }
    const comparison = await compare(repo, comparisonAsk)
    const files = await repo.readBranchDiff(comparison.original, comparison.head)
    context.comparisons.set(comparisonKey(comparisonAsk), comparison)
    return { files, baseBranch, headBranch }
  },

  'pr.GET_BRANCH_FILE_DIFF': async ({ args, context, refuse }) => {
    const repo = gitRepositoryOf(context)
    const where = { path: args.path, baseBranch: args.baseBranch, headBranch: args.headBranch, ...(args.prNumber && { prNumber: args.prNumber }) }
    const read = async () => {
      // The comparison its file list was read from, which is fetched again only when that list is asked for
      const { comparisons } = context
      const key = comparisonKey(args)
      const comparison = comparisons.get(key) ?? await compare(repo, args)
      comparisons.set(key, comparison)
      const isImage = repo.isImageFile(args.path)
      const getContent = isImage
        ? (p: string, b: string) => repo.getFileContentFromBranchAsDataUrl(p, b)
        : (p: string, b: string) => repo.readFileContentFromBranch(p, b)
      // A side that is missing reads as empty, which is right for a file one branch does not have and wrong
      // for a branch that is not there: that is an error, said as one
      if (!await repo.commitsExist(comparison.original, comparison.head)) {
        throw new Error(`Failed to get file diff between branches: ${args.baseBranch} or ${args.headBranch ?? 'HEAD'} is not a commit here`)
      }
      // The editor draws the change from the file's two sides, so those are what is read: no patch is made. The
      // original is the file where the head left the base, so what the base changed since is not shown as undone
      const [originalContent, modifiedContent] = await Promise.all([
        getContent(args.path, comparison.original),
        getContent(args.path, comparison.head),
      ])
      return { originalContent, modifiedContent, isImage }
    }
    try {
      const { originalContent, modifiedContent, isImage } = await (args.fetchMissing ? repo.fetchingMissing(read) : read())
      return { path: args.path, staged: false, originalContent, modifiedContent, isImage, baseBranch: args.baseBranch, headBranch: args.headBranch }
    } catch (error) {
      throw (error as { code?: string } | null)?.code === 'content-missing'
        ? refuse('content-missing', `${args.path} needs content this clone was not given`, where)
        : error
    }
  },

  // --- GitHub ---

  /** Whether this app's sign-in can work with the pull requests of the repository the checkout's remote names */
  'pr.CHECK_GITHUB_ACCESS': async ({ context }) => {
    if (!context.gitRepository) return { access: 'not-github', message: 'No git repository is open.' }
    try {
      const { github } = await gitHubOf(gitRepositoryOf(context))
      await github.checkAccess()
      return { access: 'ok' }
    } catch (error) {
      return { access: error instanceof GitHubApiError ? error.reason : 'failed', message: (error as Error)?.message ?? String(error) }
    }
  },

  'pr.LIST_PRS': ({ args, context, refuse }) => onGitHub(context, refuse,
    github => github.listPRs({ state: args.state, ...(args.query && { query: args.query }), ...(args.after && { after: args.after }) })),

  /**
   * Checks out the pull request's head as a branch here. A head on the checkout's own remote is that remote's
   * branch, fetched and checked out under its name, following it; any other — a fork's — is GitHub's ref of the
   * pull request, fetched from the remote naming the repository it is on and checked out as `pr/<number>`,
   * following nothing, since nothing here can push to it. A branch already here is moved only forward
   * (`checkoutBranchAt`). Every window is shown the checkout, as after any write here
   */
  'pr.CHECKOUT_PR': async ({ args: { number }, context, refuse }) => {
    const { branch, checkout } = await onGitHub(context, refuse, async (github, repo, remotes): Promise<{ branch: string; checkout: PRBranchCheckout }> => {
      const { branch, headInRemote } = await github.readHead(number)
      if (headInRemote) {
        const ref = await fetchSide(repo, branch, remotes.remote, 'head')
        return { branch, checkout: await repo.checkoutBranchAt(branch, ref, { track: true }) }
      }
      const ref = await repo.fetchPullRequest(number, await baseRemoteOf(repo, remotes))
      const local = `pr/${number}`
      return { branch: local, checkout: await repo.checkoutBranchAt(local, ref) }
    })
    announceWrite(context.code)
    return { number, branch, checkout }
  },

  'pr.SELECT_PR': ({ args: { number }, context, refuse }) => onGitHub(context, refuse, github => settledDetails(github, number)),

  'pr.CREATE_PR': ({ args, context, refuse }) => onGitHub(context, refuse,
    async (github, repo, remotes) => {
      const head = await headBranchOf(repo, remotes)
      const { comments: _comments, ...pr } = await github.createPR({ title: args.title, body: args.body, base: args.base, head, draft: args.draft })
      return { pr }
    },
    async repo => { if (await onNoBranch(repo)) throw new Error(DETACHED); return undefined },
  ),

  /**
   * A refused merge carries the pull request read again, so the panel reflects the check, review and mergeability
   * state the user is actually facing rather than whatever stale data led to the click
   */
  'pr.MERGE_PR': async ({ args: { number, method, sha }, context, refuse }) => {
    const repo = gitRepositoryOf(context)
    const { github } = await gitHubOf(repo).catch(refusedBy(refuse))
    try {
      await github.mergePR(number, method, sha)
    } catch (error) {
      if (!(error instanceof GitHubApiError)) throw error
      const details = await detailsIfRead(github, number)
      throw refuse('github', error.message, { reason: error.reason, ...(details && { details }) })
    }
    // GitHub moved the base: it is fetched, and every window shown what moved
    void fetchAndAnnounce(repo, context.code)
    return { number }
  },

  'pr.CLOSE_PR': async ({ args: { number }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.closePR(number))
    return { number }
  },

  'pr.TOGGLE_DRAFT': ({ args: { number, isDraft }, context, refuse }) => onGitHub(context, refuse, async github => {
    // `isDraft` is what it is now, so true = draft → ready, false = ready → draft.
    if (!isDraft) {
      await github.markDraft(number)
      return { number, isDraft: true }
    }
    await github.markReady(number)
    // Marking a draft ready is GitHub's trigger to start computing mergeability: its details are read once
    // settled, so the Merge button lands on the real state instead of stuck on UNKNOWN
    const details = await detailsIfRead(github, number)
    return { number, isDraft: false, ...(details && { details }) }
  }),

  'pr.CHECK_BRANCH_PR': async ({ context, refuse }) => {
    if (!context.gitRepository) return { pr: null }
    const pr = await onGitHub(context, refuse,
      async (github, repo, remotes) => {
        const pr = await github.findPRForBranch(await headBranchOf(repo, remotes))
        return pr && shown(github, pr)
      },
      // A detached HEAD is no branch, and so has no pull request of its own: GitHub is not asked
      async repo => await onNoBranch(repo) ? { answer: null } : undefined,
    )
    return { pr }
  },

  'pr.GET_PR_AUTOFILL': async ({ context }) => {
    const repo = gitRepositoryOf(context)
    try {
      const [baseBranch, currentBranch] = await Promise.all([repo.getPRBaseBranch(), repo.readCurrentBranch()])
      return autofillOf(currentBranch, await repo.readCommitsBetween(baseBranch))
    } catch {
      return { title: '', body: '' }
    }
  },

  'pr.UPDATE_PR': ({ args: { number, title, body, base }, context, refuse }) => onGitHub(context, refuse, async github => {
    await github.updatePR(number, { title, body, base })
    // Base changes cause GitHub to recompute mergeability asynchronously — its details are read once settled so the
    // Merge button settles correctly. Title / body edits don't affect mergeability, so skip the extra round-trip
    const details = base ? await detailsIfRead(github, number) : undefined
    return { number, title, body, base, ...(details && { details }) }
  }),

  // --- Comments ---

  'pr.CREATE_COMMENT': async ({ args: { number, body }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.createPRComment(number, body))
    return { number }
  },

  'pr.EDIT_COMMENT': async ({ args: { commentId, body }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.editPRComment(commentId, body))
    return { commentId }
  },

  'pr.DELETE_COMMENT': async ({ args: { commentId }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.deletePRComment(commentId))
    return { commentId }
  },

  /** The discussion read again after a write: the panel shows no error for it, the write itself having landed */
  'pr.GET_COMMENTS': async ({ args: { number }, context, refuse }) => {
    const comments = await onGitHub(context, refuse, async github => {
      const comments = await github.getPRComments(number)
      for (const comment of comments) await shown(github, comment)
      return comments
    }).catch((error: unknown) => {
      logger.warn('GET_COMMENTS refetch failed', { prNumber: number, error: (error as Error)?.message })
      throw error
    })
    return { number, comments }
  },

  'pr.GET_REVIEW_THREADS': async ({ args: { number }, context, refuse }) =>
    ({ threads: await onGitHub(context, refuse, github => github.getReviewThreads(number)) }),

  'pr.REPLY_TO_THREAD': async ({ args: { prNumber, commentId, body }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.replyToReviewThread(prNumber, commentId, body))
    return { prNumber }
  },

  'pr.RESOLVE_THREAD': async ({ args: { threadId }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.resolveReviewThread(threadId))
    return { threadId }
  },

  'pr.UNRESOLVE_THREAD': async ({ args: { threadId }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.unresolveReviewThread(threadId))
    return { threadId }
  },

  'pr.EDIT_REVIEW_COMMENT': async ({ args: { commentId, body }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.editReviewComment(commentId, body))
    return { commentId }
  },

  'pr.DELETE_REVIEW_COMMENT': async ({ args: { commentId }, context, refuse }) => {
    await onGitHub(context, refuse, github => github.deleteReviewComment(commentId))
    return { commentId }
  },

  /**
   * Deletes a pull request's branch through GitHub, only where it is a branch of the repository the checkout's
   * remote names — another repository's is not this checkout's to delete — that no other open pull request is
   * from. One GitHub already deleted, on merge say, is deleted
   */
  'pr.DELETE_BRANCH': async ({ args: { number }, context, refuse }) => {
    const branch = await onGitHub(context, refuse, async (github, repo, { remote }) => {
      const { branch, headInRemote } = await github.readHead(number)
      if (!headInRemote) throw new Error(`#${number} is from a branch of another repository, a fork, which is not this checkout's to delete.`)
      const others = (await github.openPRsFromBranch(branch)).filter(other => other !== number)
      if (others.length > 0) throw new Error(`${branch} is kept: open pull request${others.length > 1 ? 's' : ''} ${others.map(other => `#${other}`).join(', ')} ${others.length > 1 ? 'are' : 'is'} from it too.`)
      await github.deleteBranch(branch)
      // Deleted through GitHub, so git's record of it here goes too, as a fetch that prunes would take it
      await repo.deleteRemoteTrackingBranch(branch, remote)
      return branch
    })
    void fetchAndAnnounce(gitRepositoryOf(context), context.code)
    return { branch }
  },
})

/** What the pull request child keeps between asks, and the news it broadcasts when the repository moves */
export const pullRequestSystem = setup({
  types: {
    context: {} as CodePullRequestSystemContext,
    events: {} as Event,
    input: {} as { gitRepository: AppGitRepository | null; code?: AnyActorRef },
  },
  actions: {
    ...answers.actions,
    // News for every window: the repository's commits or branches moved under them
    handleGitStatusChanged: () => {
      broadcast(surfaceId, { type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } })
    },
    // The folder moved: its repository is the one asked from here on, and nothing compared in the last one is kept
    takeRepository: assign(({ event }) => ({ gitRepository: typeOf('pr.UPDATE_BASE_DIRECTORY', event).gitRepository, comparisons: new Map() })),
  },
}).createMachine({
  id: 'pull-request',
  initial: 'idle',
  context: ({ input }) => ({ gitRepository: input.gitRepository, code: input.code, comparisons: new Map() }),
  states: {
    idle: {
      on: {
        ...answers.on,
        'pr.GIT_STATUS_CHANGED': { actions: 'handleGitStatusChanged' },
        'pr.UPDATE_BASE_DIRECTORY': { actions: 'takeRepository' },
      }
    }
  }
})
