// GitHub's API for one repository, called with the app's own sign-in (`features/github.ts`): the pull requests the
// panel lists, opens, creates, merges and comments on, and their review threads. Reads go through GraphQL, whose
// field names are the shapes the panel takes (`GhPullRequest`, `GhPRComment`, `GhReviewThread`); writes go through
// REST where GitHub has one and GraphQL where only it does (draft state, resolving a thread).
//
// A failure is a `GitHubApiError` whose `reason` is what the panel can do something about: sign in, sign in again
// with the access it lacks, authorise the sign-in for an organisation's single sign-on, or nothing (not found).
import type { GhPullRequest, GhPRComment, GhReviewThread } from '../types.ts'
import type { GitHubEndpoints } from './github.ts'

/** A repository on GitHub, as its address names it */
export interface GitHubRepo {
  owner: string
  name: string
}

/**
 * What GitHub refused, as the panel acts on it: no sign-in, or one GitHub no longer takes (`signed-out`); a
 * repository whose remote is not on github.com (`not-github`); one
 * without the access the call needs (`missing-scope`); one an organisation's single sign-on has not authorised
 * (`sso`); a repository or pull request this sign-in cannot see (`not-found`); GitHub could not be reached or said
 * something else (`failed`)
 */
export type GitHubApiFailure = 'signed-out' | 'not-github' | 'missing-scope' | 'sso' | 'not-found' | 'failed'

export class GitHubApiError extends Error {
  constructor(readonly reason: GitHubApiFailure, message: string) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

/**
 * How long one request to GitHub may take. A network wait, which nothing on this machine can show progress on:
 * the same bound `gh` was run with
 */
const REQUEST_MS = 30_000

/** The repository a remote's address names on github.com, or nothing for another host or a path */
export function repoOfRemote(remoteUrl: string): GitHubRepo | undefined {
  const address = remoteUrl.trim()
  // https://github.com/owner/name(.git), ssh://git@github.com/owner/name(.git), git@github.com:owner/name(.git)
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(address)
  return match ? { owner: match[1]!, name: match[2]! } : undefined
}

const PR_FIELDS = 'number title body headRefName baseRefName state url isDraft author { login } createdAt updatedAt'
const MERGE_FIELDS = 'mergeable mergeStateStatus reviewDecision'
/** The checks of the head commit, as the panel's merge button reads them: `gh` flattened them the same way */
const CHECK_FIELDS = `checks: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
  __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }`
const COMMIT_FIELDS = 'commitList: commits(first: 250) { nodes { commit { oid messageHeadline committedDate } } }'
const COMMENT_FIELDS = 'comments(first: 100) { nodes { id body author { login } createdAt url viewerDidAuthor } }'

type Json = Record<string, any>

/** A pull request as GraphQL answers it, in the shape the panel takes */
function pullRequestOf(node: Json): GhPullRequest {
  const { checks, commitList, comments: _comments, ...pr } = node
  const contexts: Json[] = checks?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return {
    ...pr,
    author: pr.author ?? { login: 'ghost' },
    ...(checks && {
      statusCheckRollup: contexts.map(context => context.__typename === 'StatusContext'
        ? { name: context.context, state: context.state }
        : { name: context.name, status: context.status, conclusion: context.conclusion ?? undefined }),
    }),
    ...(commitList && { commits: (commitList.nodes as Json[]).map(({ commit }) => commit) }),
  } as GhPullRequest
}

/** A comment as GraphQL answers it. Editing and deleting take its REST id, which a window reads from its `url` */
const commentOf = (node: Json): GhPRComment => ({
  id: node.id,
  body: node.body,
  author: node.author ?? { login: 'ghost' },
  createdAt: node.createdAt,
  url: node.url,
  viewerDidAuthor: node.viewerDidAuthor ?? false,
})

/** Waits `ms` before the next look at a pull request GitHub is still working out */
export type Pause = (ms: number) => Promise<void>
const pauseFor: Pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export interface GitHubApi {
  readonly repo: GitHubRepo
  /** Whether this sign-in can read the repository's pull requests; throws a `GitHubApiError` saying why not */
  checkAccess(): Promise<void>
  listOpenPRs(): Promise<GhPullRequest[]>
  getPRDetails(number: number): Promise<GhPullRequest & { comments: GhPRComment[] }>
  /** The pull request's details, asked again while GitHub is still working out whether it can merge */
  fetchPRDetailsSettled(number: number): Promise<GhPullRequest & { comments: GhPRComment[] }>
  getPRComments(number: number): Promise<GhPRComment[]>
  /** The pull request from `branch`, an open one first; `null` when there is none */
  findPRForBranch(branch: string): Promise<GhPullRequest | null>
  createPR(options: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<GhPullRequest & { comments: GhPRComment[] }>
  mergePR(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<void>
  closePR(number: number): Promise<void>
  markDraft(number: number): Promise<void>
  markReady(number: number): Promise<void>
  updatePR(number: number, options: { title?: string; body?: string; base?: string }): Promise<void>
  createPRComment(number: number, body: string): Promise<void>
  editPRComment(commentId: number, body: string): Promise<void>
  deletePRComment(commentId: number): Promise<void>
  getReviewThreads(number: number): Promise<GhReviewThread[]>
  replyToReviewThread(prNumber: number, commentId: number, body: string): Promise<void>
  editReviewComment(commentId: number, body: string): Promise<void>
  deleteReviewComment(commentId: number): Promise<void>
  resolveReviewThread(threadId: string): Promise<void>
  unresolveReviewThread(threadId: string): Promise<void>
  /** `text` with each image GitHub hosts for its users replaced by the signed address it redirects to, which a window can load */
  resolveAssetUrls(text: string): Promise<string>
}

/** The API for `repo`, signed in with `token` */
export function createGitHubApi({ endpoints, token, repo, pause = pauseFor }: {
  endpoints: GitHubEndpoints
  token: string
  repo: GitHubRepo
  pause?: Pause
}): GitHubApi {
  const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }

  /** Why GitHub refused, from its status, its single sign-on header and what it said */
  const refusal = (status: number, response: Response, said: string): GitHubApiError => {
    if (status === 401) return new GitHubApiError('signed-out', 'GitHub no longer takes this sign-in. Sign in to GitHub again in Settings → Code.')
    if (response.headers.get('x-github-sso')) {
      return new GitHubApiError('sso', `${repo.owner} requires single sign-on: authorise apack for it at github.com, under Settings → Applications.`)
    }
    if (status === 403 && /not accessible by integration|scope|permission/i.test(said)) {
      return new GitHubApiError('missing-scope', `The GitHub sign-in lacks the access this needs (${said}). Sign out and sign in again in Settings → Code.`)
    }
    if (status === 404) return new GitHubApiError('not-found', `GitHub has no ${repo.owner}/${repo.name} this sign-in can see, or no such pull request.`)
    return new GitHubApiError('failed', `GitHub refused it (${status}): ${said}`)
  }

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(REQUEST_MS) })
    } catch (error) {
      throw new GitHubApiError('failed', `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** A REST call, answering what it answered as JSON, or nothing where it answered no content */
  const rest = async (method: string, route: string, body?: Json): Promise<Json | undefined> => {
    const response = await request(`${endpoints.api}${path}${route}`, {
      method,
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const text = await response.text()
    const parsed = text ? (() => { try { return JSON.parse(text) as Json } catch { return { message: text } } })() : undefined
    if (!response.ok) throw refusal(response.status, response, String(parsed?.message ?? response.statusText))
    return parsed
  }

  const graphql = async (query: string, variables: Json): Promise<Json> => {
    const response = await request(`${endpoints.api}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner: repo.owner, name: repo.name, ...variables } }),
    })
    const parsed = await response.json().catch(() => ({})) as Json
    if (!response.ok) throw refusal(response.status, response, String(parsed?.message ?? response.statusText))
    const errors: Json[] = parsed.errors ?? []
    if (errors.length > 0) {
      const said = errors.map(error => error.message).join('; ')
      if (errors.some(error => error.type === 'NOT_FOUND')) throw new GitHubApiError('not-found', `GitHub has nothing this sign-in can see there: ${said}`)
      if (errors.some(error => error.type === 'FORBIDDEN' || error.type === 'INSUFFICIENT_SCOPES')) throw refusal(403, response, said)
      throw new GitHubApiError('failed', `GitHub refused it: ${said}`)
    }
    return parsed.data
  }

  const pullRequest = async (number: number, fields: string): Promise<Json> => {
    const data = await graphql(`query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) { id ${fields} } } }`, { number })
    const node = data?.repository?.pullRequest
    if (!node) throw new GitHubApiError('not-found', `${repo.owner}/${repo.name} has no pull request #${number}.`)
    return node
  }

  const getPRDetails = async (number: number) => {
    const node = await pullRequest(number, `${PR_FIELDS} ${MERGE_FIELDS} ${CHECK_FIELDS} ${COMMIT_FIELDS} ${COMMENT_FIELDS}`)
    const { id: _id, ...rest } = node
    return { ...pullRequestOf(rest), comments: (node.comments?.nodes as Json[] ?? []).map(commentOf) }
  }

  const fetchPRDetailsSettled = async (number: number) => {
    let details = await getPRDetails(number)
    // GitHub works out whether a pull request can merge after it is created or its base moves, answering UNKNOWN
    // until then; a draft is never worked out. Two more looks, two and four seconds on, keeping the last good one
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (details.isDraft || (details.mergeable && details.mergeable !== 'UNKNOWN' && details.mergeStateStatus && details.mergeStateStatus !== 'UNKNOWN')) break
      await pause(2_000 * attempt)
      try { details = await getPRDetails(number) } catch { break }
    }
    return details
  }

  /** An image a user attached on GitHub, which GitHub serves only to a signed-in look */
  const attachments = new RegExp(`${endpoints.web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/user-attachments/assets/[a-f0-9-]+`, 'g')

  const nodeIdOf = async (number: number): Promise<string> => (await pullRequest(number, 'number')).id as string

  return {
    repo,

    async checkAccess() {
      await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 0) { totalCount } } }`, {})
    },

    async listOpenPRs() {
      const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
        pullRequests(states: OPEN, first: 50, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } } }`, {})
      return (data?.repository?.pullRequests?.nodes as Json[] ?? []).map(pullRequestOf)
    },

    getPRDetails,
    fetchPRDetailsSettled,

    async getPRComments(number) {
      return ((await pullRequest(number, COMMENT_FIELDS)).comments?.nodes as Json[] ?? []).map(commentOf)
    },

    async findPRForBranch(branch) {
      const data = await graphql(`query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) {
        pullRequests(headRefName: $branch, first: 3, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { ${PR_FIELDS} ${MERGE_FIELDS} ${CHECK_FIELDS} } } } }`, { branch })
      const prs = (data?.repository?.pullRequests?.nodes as Json[] ?? []).map(pullRequestOf)
      return prs.find(pr => pr.state === 'OPEN') ?? prs[0] ?? null
    },

    async createPR({ title, body, head, base, draft }) {
      const into = base ?? (await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } } }`, {}))
        ?.repository?.defaultBranchRef?.name
      const created = await rest('POST', '/pulls', { title, body, head, base: into, draft: draft ?? false })
      return fetchPRDetailsSettled(Number(created?.number))
    },

    async mergePR(number, method = 'merge') {
      await rest('PUT', `/pulls/${number}/merge`, { merge_method: method })
    },

    async closePR(number) {
      await rest('PATCH', `/pulls/${number}`, { state: 'closed' })
    },

    async markDraft(number) {
      await graphql(`mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }`, { id: await nodeIdOf(number) })
    },

    async markReady(number) {
      await graphql(`mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`, { id: await nodeIdOf(number) })
    },

    async updatePR(number, { title, body, base }) {
      await rest('PATCH', `/pulls/${number}`, { ...(title && { title }), ...(body !== undefined && { body }), ...(base && { base }) })
    },

    async createPRComment(number, body) {
      await rest('POST', `/issues/${number}/comments`, { body })
    },

    async editPRComment(commentId, body) {
      await rest('PATCH', `/issues/comments/${commentId}`, { body })
    },

    async deletePRComment(commentId) {
      await rest('DELETE', `/issues/comments/${commentId}`)
    },

    async getReviewThreads(number) {
      const node = await pullRequest(number, `reviewThreads(first: 100) { nodes {
        id isResolved isOutdated path line startLine originalLine originalStartLine diffSide startDiffSide subjectType
        comments(first: 50) { nodes { id databaseId body author { login } createdAt viewerDidAuthor path line startLine originalLine originalStartLine diffHunk } } } }`)
      return (node.reviewThreads?.nodes as Json[] ?? []).map(thread => {
        const comments = (thread.comments?.nodes as Json[] ?? []).map(comment => ({
          id: comment.id,
          databaseId: comment.databaseId,
          body: comment.body,
          author: comment.author ?? { login: 'ghost' },
          createdAt: comment.createdAt,
          viewerDidAuthor: comment.viewerDidAuthor ?? false,
          path: comment.path ?? null,
          line: comment.line ?? null,
          startLine: comment.startLine ?? null,
          originalLine: comment.originalLine ?? null,
          originalStartLine: comment.originalStartLine ?? null,
          diffHunk: comment.diffHunk ?? null,
        }))
        return {
          id: thread.id,
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          path: thread.path,
          line: thread.line,
          startLine: thread.startLine ?? null,
          originalLine: thread.originalLine ?? null,
          originalStartLine: thread.originalStartLine ?? null,
          diffSide: thread.diffSide ?? null,
          startDiffSide: thread.startDiffSide ?? null,
          subjectType: thread.subjectType ?? null,
          diffHunk: comments.find(comment => comment.diffHunk)?.diffHunk ?? null,
          comments,
        }
      })
    },

    async replyToReviewThread(prNumber, commentId, body) {
      await rest('POST', `/pulls/${prNumber}/comments/${commentId}/replies`, { body })
    },

    async editReviewComment(commentId, body) {
      await rest('PATCH', `/pulls/comments/${commentId}`, { body })
    },

    async deleteReviewComment(commentId) {
      await rest('DELETE', `/pulls/comments/${commentId}`)
    },

    async resolveReviewThread(threadId) {
      await graphql(`mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { clientMutationId } }`, { id: threadId })
    },

    async unresolveReviewThread(threadId) {
      await graphql(`mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { clientMutationId } }`, { id: threadId })
    },

    async resolveAssetUrls(text) {
      const assets = [...new Set(text?.match(attachments) ?? [])]
      if (assets.length === 0) return text
      // GitHub answers a signed-in look at an attachment with a redirect to where it is kept, which loads without one
      const signed = await Promise.all(assets.map(async asset => {
        try {
          const response = await fetch(asset, { method: 'HEAD', redirect: 'manual', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_MS) })
          return response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
        } catch {
          return null
        }
      }))
      return assets.reduce((resolved, asset, index) => signed[index] ? resolved.split(asset).join(signed[index]!) : resolved, text)
    },
  }
}
