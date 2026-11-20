// GitHub's API for one repository, called with the app's own sign-in (`features/github.ts`): the pull requests the
// panel lists, opens, creates, merges and comments on, and their review threads. Reads go through GraphQL, whose
// field names are the shapes the panel takes (`GhPullRequest`, `GhPRComment`, `GhReviewThread`); writes go through
// REST where GitHub has one and GraphQL where only it does (draft state, resolving a thread).
//
// A failure is a `GitHubApiError` whose `reason` is what the panel can do something about: sign in, sign in again
// with the access it lacks, authorise the sign-in for an organisation's single sign-on, wait for the rate limit to
// reset, look again at a pull request whose head moved since it was shown, or nothing (not found).
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
 * (`sso`); a repository or pull request this sign-in cannot see (`not-found`); a sign-in that has used up what
 * GitHub lets it ask for a while (`rate-limited`); a merge of a head that is no longer the pull request's
 * (`head-moved`); GitHub could not be reached or said something else (`failed`)
 */
export type GitHubApiFailure = 'signed-out' | 'not-github' | 'missing-scope' | 'sso' | 'not-found' | 'rate-limited' | 'head-moved' | 'failed'

export class GitHubApiError extends Error {
  /** For `rate-limited`: when GitHub takes asks again, in milliseconds since the epoch, where it said */
  readonly resetsAt?: number
  constructor(readonly reason: GitHubApiFailure, message: string, { resetsAt }: { resetsAt?: number } = {}) {
    super(message)
    this.name = 'GitHubApiError'
    if (resetsAt !== undefined) this.resetsAt = resetsAt
  }
}

/**
 * How long one request to GitHub may take. A network wait, which nothing on this machine can show progress on:
 * the same bound `gh` was run with
 */
const REQUEST_MS = 30_000

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The hosts an address may name for the GitHub at `web`: its own, and for github.com the two others GitHub answers
 * as itself — `www.github.com`, and `ssh.github.com`, its SSH on port 443 for networks that close port 22
 */
const hostsOf = (web: string): string[] => {
  const host = new URL(web).hostname.toLowerCase()
  return host === 'github.com' ? [host, 'www.github.com', 'ssh.github.com'] : [host]
}

/**
 * The repository a remote's address names on the GitHub at `web` (github.com, or a stand-in for it), or nothing for
 * another host or a path. An owner may hold `_`, as an enterprise-managed user's does. An SSH host alias is not
 * resolved here, having to ask ssh (`ssh-host.ts`)
 */
export function repoOfRemote(remoteUrl: string, web = 'https://github.com'): GitHubRepo | undefined {
  const address = remoteUrl.trim()
  const host = `(?:${hostsOf(web).map(escaped).join('|')})`
  // https://github.com/owner/name(.git), ssh://git@github.com/owner/name(.git), git@github.com:owner/name(.git)
  const match = new RegExp(`^(?:[a-z][a-z0-9+.-]*://(?:[^@/]*@)?${host}(?::\\d+)?/|(?:[^@/]+@)?${host}:)([A-Za-z0-9_-]+)/([A-Za-z0-9._-]+?)(?:\\.git)?/?$`, 'i').exec(address)
  return match ? { owner: match[1]!, name: match[2]! } : undefined
}

/** Whether two names are of one repository: GitHub reads an owner and a name without regard to case */
export const sameRepo = (one: GitHubRepo | null | undefined, other: GitHubRepo | null | undefined): boolean =>
  !!one && !!other && one.owner.toLowerCase() === other.owner.toLowerCase() && one.name.toLowerCase() === other.name.toLowerCase()

/** Which pull requests a list shows */
export const PR_LIST_STATES = ['open', 'closed', 'merged', 'all'] as const
export type PRListState = (typeof PR_LIST_STATES)[number]

/** A page of a list of pull requests, newest first, and the cursor of the next where there is one */
export interface PRListPage {
  prs: GhPullRequest[]
  next: string | null
}

const PR_FIELDS = 'number title body headRefName headRefOid headRepository { name owner { login } } baseRefName isCrossRepository state url isDraft author { login } createdAt updatedAt'
const MERGE_FIELDS = 'mergeable mergeStateStatus reviewDecision'
/** The checks of the head commit, as the panel's merge button reads them: `gh` flattened them the same way */
const CHECK_FIELDS = `checks: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
  __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }`
const COMMIT_FIELDS = 'commitList: commits(first: 250) { nodes { commit { oid messageHeadline committedDate } } }'
/** How many of a list one ask reads: GitHub's most */
const PAGE = 100
/** How many pull requests a page of the panel's list holds */
const LIST_PAGE = 50
/** GraphQL's states, for each list */
const LIST_STATES: Record<PRListState, string> = { open: '[OPEN]', closed: '[CLOSED]', merged: '[MERGED]', all: '[OPEN, CLOSED, MERGED]' }
/** Search's qualifiers, for each list: a closed pull request is one closed unmerged, as GitHub's own tab counts it */
const SEARCH_STATES: Record<PRListState, string> = { open: 'is:open', closed: 'is:closed is:unmerged', merged: 'is:merged', all: '' }
/** A pull request's discussion, newest last, read back from the newest a page at a time (`before`) */
const COMMENT_NODES = 'pageInfo { hasPreviousPage startCursor } nodes { id body author { login } createdAt url viewerDidAuthor }'
const COMMENT_FIELDS = `comments(last: ${PAGE}) { ${COMMENT_NODES} }`
/** A review thread's own comments, newest last, read back from the newest a page at a time as the discussion is */
const THREAD_COMMENT_NODES = 'pageInfo { hasPreviousPage startCursor } nodes { id databaseId body author { login } createdAt viewerDidAuthor path line startLine originalLine originalStartLine diffHunk }'
const THREAD_NODES = `pageInfo { hasPreviousPage startCursor } nodes {
  id isResolved isOutdated path line startLine originalLine originalStartLine diffSide startDiffSide subjectType
  comments(last: ${PAGE}) { ${THREAD_COMMENT_NODES} } }`

type Json = Record<string, any>

/**
 * A pull request as GraphQL answers it, in the shape the panel takes, saying whether its head is a branch of `head`,
 * the repository the checkout's remote names
 */
function pullRequestOf(node: Json, head: GitHubRepo): GhPullRequest {
  const { checks, commitList, comments: _comments, headRepository, repository: _repository, ...pr } = node
  const contexts: Json[] = checks?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return {
    ...pr,
    // A head whose repository was deleted is GitHub's `null`, and no branch of anything here
    headInRemote: sameRepo(headRepository && { owner: headRepository.owner?.login, name: headRepository.name }, head),
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
  /** The repository the pull requests are on */
  readonly repo: GitHubRepo
  /** The repository the checkout's remote names, whose branches its pull requests are from: `repo`, or a fork of it */
  readonly head: GitHubRepo
  /** Whether this sign-in can read the repository's pull requests; throws a `GitHubApiError` saying why not */
  checkAccess(): Promise<void>
  /** The repository `repo` is a fork of, or `null` for one that is no fork */
  readParent(): Promise<GitHubRepo | null>
  /**
   * A page of the pull requests in `state`, newest first, from the cursor `after`. A `query` is GitHub's search over
   * them, its qualifiers included, and a query that is a number (`12`, `#12`) is that pull request too, first, where
   * it is in `state`
   */
  listPRs(options: { state: PRListState; query?: string; after?: string }): Promise<PRListPage>
  getPRDetails(number: number): Promise<GhPullRequest & { comments: GhPRComment[] }>
  /**
   * The pull request's details, asked again while GitHub is still working out whether it can merge, with the other
   * open pull requests from its head where that is a branch of `head` (`openFromSameHead`)
   */
  fetchPRDetailsSettled(number: number): Promise<GhPullRequest & { comments: GhPRComment[] }>
  getPRComments(number: number): Promise<GhPRComment[]>
  /**
   * The pull request from `branch` of `head`, an open one first, with the other open ones from it
   * (`openFromSameHead`); `null` when there is none. A pull request from a branch of the same name in another
   * repository is another branch's, and is not it
   */
  findPRForBranch(branch: string): Promise<GhPullRequest | null>
  /** A pull request's head: its branch's name, and whether that is a branch of `head` */
  readHead(number: number): Promise<{ branch: string; headInRemote: boolean }>
  /** The open pull requests whose head is `branch` of `head` */
  openPRsFromBranch(branch: string): Promise<number[]>
  /** Deletes `branch` of `head`; one GitHub no longer has is deleted already */
  deleteBranch(branch: string): Promise<void>
  /** Opens a pull request from `head`'s branch `head`, into `base` or the repository's default branch */
  createPR(options: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<GhPullRequest & { comments: GhPRComment[] }>
  /**
   * Merges the pull request, where its head is still `sha` when one is named: one whose head moved since is refused
   * as `head-moved`, and nothing is merged
   */
  mergePR(number: number, method?: 'merge' | 'squash' | 'rebase', sha?: string): Promise<void>
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

/** The API for the pull requests on `repo` from branches of `head` (`repo` itself by default), signed in with `token` */
export function createGitHubApi({ endpoints, token, repo, head = repo, pause = pauseFor }: {
  endpoints: GitHubEndpoints
  token: string
  repo: GitHubRepo
  head?: GitHubRepo
  pause?: Pause
}): GitHubApi {
  const pathOf = ({ owner, name }: GitHubRepo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const of = (node: Json) => pullRequestOf(node, head)
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }

  /** Why GitHub refused, from its status, its single sign-on and rate limit headers and what it said */
  const refusal = (status: number, response: Response, said: string): GitHubApiError => {
    if (status === 401) return new GitHubApiError('signed-out', 'GitHub no longer takes this sign-in. Sign in to GitHub again in Settings → Code.')
    if ((status === 403 || status === 429) && (response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(said))) return rateLimited(response)
    if (response.headers.get('x-github-sso')) {
      return new GitHubApiError('sso', `${repo.owner} requires single sign-on: authorise apack for it at github.com, under Settings → Applications.`)
    }
    if (status === 403 && /not accessible by integration|scope|permission/i.test(said)) {
      return new GitHubApiError('missing-scope', `The GitHub sign-in lacks the access this needs (${said}). Sign out and sign in again in Settings → Code.`)
    }
    if (status === 404) return new GitHubApiError('not-found', `GitHub has no ${repo.owner}/${repo.name} this sign-in can see, or no such pull request.`)
    // What a merge naming a head says when the pull request's head is another commit now (REST's `sha`)
    if (status === 409 && /head branch was modified|sha/i.test(said)) {
      return new GitHubApiError('head-moved', 'The pull request has new commits since it was shown, so nothing was merged: look at them, then merge again.')
    }
    return new GitHubApiError('failed', `GitHub refused it (${status}): ${said}`)
  }

  /**
   * The rate limit used up, with when it resets: GitHub's `retry-after` (seconds from now) for a secondary limit,
   * and `x-ratelimit-reset` (seconds since the epoch) for the primary one
   */
  const rateLimited = (response: Response): GitHubApiError => {
    const retryAfter = Number(response.headers.get('retry-after'))
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const resetsAt = retryAfter > 0 ? Date.now() + retryAfter * 1000 : reset > 0 ? reset * 1000 : undefined
    const when = resetsAt === undefined ? 'in a while' : `at ${new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    return new GitHubApiError('rate-limited', `GitHub has had as many asks from this sign-in as it takes for now; it takes more ${when}.`, { ...(resetsAt !== undefined && { resetsAt }) })
  }

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(REQUEST_MS) })
    } catch (error) {
      throw new GitHubApiError('failed', `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** A REST call on `repo`, or the repository `on` names, answering what it answered as JSON, or nothing where it answered no content */
  const rest = async (method: string, route: string, body?: Json, on = repo): Promise<Json | undefined> => {
    const response = await request(`${endpoints.api}${pathOf(on)}${route}`, {
      method,
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const text = await response.text()
    const parsed = text ? (() => { try { return JSON.parse(text) as Json } catch { return { message: text } } })() : undefined
    if (!response.ok) throw refusal(response.status, response, saidIn(parsed, response.statusText))
    return parsed
  }

  /**
   * What GitHub said of a refused REST call: its message, and the reasons it gave for a validation failure
   * (`errors`), which are what say a pull request already exists or has no commits
   */
  const saidIn = (parsed: Json | undefined, fallback: string): string => {
    const message = String(parsed?.message ?? fallback)
    const reasons = (Array.isArray(parsed?.errors) ? parsed.errors as Json[] : [])
      .map(error => typeof error === 'string' ? error : error.message ?? [error.resource, error.field, error.code].filter(Boolean).join(' '))
      .filter(Boolean)
    return reasons.length > 0 ? `${message}: ${reasons.join('; ')}` : message
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
      if (errors.some(error => error.type === 'RATE_LIMITED')) throw rateLimited(response)
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

  /**
   * Every node of a list a pull request holds, oldest first: `page` as the first ask answered it (the newest), and
   * the pages before it, asked for back to the first
   */
  const backTo = async (number: number, list: 'comments' | 'reviewThreads', nodes: string, page: Json | undefined): Promise<Json[]> => {
    const all: Json[] = [...(page?.nodes as Json[] ?? [])]
    let info: Json | undefined = page?.pageInfo
    while (info?.hasPreviousPage && info.startCursor) {
      const data = await graphql(`query($owner: String!, $name: String!, $number: Int!, $before: String!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${list}(last: ${PAGE}, before: $before) { ${nodes} } } } }`, { number, before: info.startCursor })
      const earlier = data?.repository?.pullRequest?.[list]
      all.unshift(...(earlier?.nodes as Json[] ?? []))
      info = earlier?.pageInfo
    }
    return all
  }

  /** Every comment of a review thread, oldest first: `page` as the thread's own ask answered it, and the pages before it */
  const threadCommentsBackTo = async (thread: string, page: Json | undefined): Promise<Json[]> => {
    const all: Json[] = [...(page?.nodes as Json[] ?? [])]
    let info: Json | undefined = page?.pageInfo
    while (info?.hasPreviousPage && info.startCursor) {
      const data = await graphql(`query($id: ID!, $before: String!) {
        node(id: $id) { ... on PullRequestReviewThread { comments(last: ${PAGE}, before: $before) { ${THREAD_COMMENT_NODES} } } } }`, { id: thread, before: info.startCursor })
      const earlier = data?.node?.comments
      all.unshift(...(earlier?.nodes as Json[] ?? []))
      info = earlier?.pageInfo
    }
    return all
  }

  const getPRDetails = async (number: number) => {
    const node = await pullRequest(number, `${PR_FIELDS} ${MERGE_FIELDS} ${CHECK_FIELDS} ${COMMIT_FIELDS} ${COMMENT_FIELDS}`)
    const { id: _id, ...rest } = node
    return { ...of(rest), comments: (await backTo(number, 'comments', COMMENT_NODES, node.comments)).map(commentOf) }
  }

  const fetchPRDetailsSettled = async (number: number) => {
    let details = await getPRDetails(number)
    // GitHub works out whether an open pull request can merge after it is created or its base moves, answering
    // UNKNOWN until then; a draft, or one closed or merged, is never worked out. Two more looks, two and four
    // seconds on, keeping the last good one
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (details.isDraft || details.state !== 'OPEN' || (details.mergeable && details.mergeable !== 'UNKNOWN' && details.mergeStateStatus && details.mergeStateStatus !== 'UNKNOWN')) break
      await pause(2_000 * attempt)
      try { details = await getPRDetails(number) } catch { break }
    }
    // What keeps the branch from being offered for deletion, and only that: the backend asks GitHub again before it
    // deletes, so details that could not be told it are still the details
    if (details.headInRemote) {
      const others = await openPRsFromBranch(details.headRefName).catch(() => undefined)
      if (others) details.openFromSameHead = others.filter(other => other !== number)
    }
    return details
  }

  const openPRsFromBranch = async (branch: string): Promise<number[]> => {
    const data = await graphql(`query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) {
      pullRequests(headRefName: $branch, states: OPEN, first: ${PAGE}) { nodes { number headRepository { name owner { login } } } } } }`, { branch })
    return (data?.repository?.pullRequests?.nodes as Json[] ?? [])
      .filter(pr => sameRepo(pr.headRepository && { owner: pr.headRepository.owner?.login, name: pr.headRepository.name }, head))
      .map(pr => pr.number as number)
  }

  /** The page of the pull requests in `state` after `after`, newest first, by `query` where there is one */
  const listPRs = async ({ state, query, after }: { state: PRListState; query?: string; after?: string }): Promise<PRListPage> => {
    const text = query?.trim()
    const page = text
      ? (await graphql(`query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: ${LIST_PAGE}, after: $after) {
          pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${PR_FIELDS} repository { name owner { login } } } } } }`,
        { q: `repo:${repo.owner}/${repo.name} is:pr ${SEARCH_STATES[state]} sort:created-desc ${text}`, after: after ?? null }))?.search
      : (await graphql(`query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
          pullRequests(states: ${LIST_STATES[state]}, first: ${LIST_PAGE}, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor } nodes { ${PR_FIELDS} } } } }`, { after: after ?? null }))?.repository?.pullRequests
    // A search's own qualifiers can name another repository, whose pull requests are not this one's to show
    const nodes = (page?.nodes as Json[] ?? []).filter(node => node && node.number !== undefined
      && (!node.repository || sameRepo({ owner: node.repository.owner?.login, name: node.repository.name }, repo)))
    let prs = nodes.map(of)
    const asNumber = text && !after ? /^#?(\d+)$/.exec(text)?.[1] : undefined
    if (asNumber) {
      const numbered = await pullRequest(Number(asNumber), PR_FIELDS).then(of, (error: unknown) => {
        if (error instanceof GitHubApiError && error.reason === 'not-found') return undefined
        throw error
      })
      if (numbered && (state === 'all' || numbered.state === state.toUpperCase())) prs = [numbered, ...prs.filter(pr => pr.number !== numbered.number)]
    }
    return { prs, next: page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? null : null }
  }

  /** An image a user attached on GitHub, which GitHub serves only to a signed-in look */
  const attachments = new RegExp(`${endpoints.web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/user-attachments/assets/[a-f0-9-]+`, 'g')

  const nodeIdOf = async (number: number): Promise<string> => (await pullRequest(number, 'number')).id as string

  return {
    repo,
    head,

    async checkAccess() {
      await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 0) { totalCount } } }`, {})
    },

    async readParent() {
      const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { isFork parent { name owner { login } } } }`, {})
      const parent = data?.repository?.isFork ? data.repository.parent : null
      return parent?.owner?.login && parent.name ? { owner: parent.owner.login as string, name: parent.name as string } : null
    },

    listPRs,

    getPRDetails,
    fetchPRDetailsSettled,

    async getPRComments(number) {
      return (await backTo(number, 'comments', COMMENT_NODES, (await pullRequest(number, COMMENT_FIELDS)).comments)).map(commentOf)
    },

    async findPRForBranch(branch) {
      const data = await graphql(`query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) {
        pullRequests(headRefName: $branch, first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { ${PR_FIELDS} ${MERGE_FIELDS} ${CHECK_FIELDS} } } } }`, { branch })
      const prs = (data?.repository?.pullRequests?.nodes as Json[] ?? []).map(of).filter(pr => pr.headInRemote)
      const found = prs.find(pr => pr.state === 'OPEN') ?? prs[0]
      if (!found) return null
      return { ...found, openFromSameHead: prs.filter(pr => pr.state === 'OPEN' && pr.number !== found.number).map(pr => pr.number) }
    },

    async readHead(number) {
      const node = await pullRequest(number, 'headRefName headRepository { name owner { login } }')
      return { branch: node.headRefName as string, headInRemote: sameRepo(node.headRepository && { owner: node.headRepository.owner?.login, name: node.headRepository.name }, head) }
    },

    openPRsFromBranch,

    async deleteBranch(branch) {
      try {
        await rest('DELETE', `/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, undefined, head)
      } catch (error) {
        // GitHub says a branch it no longer has, deleted on merge say, "does not exist" (422), or is not found
        if (error instanceof GitHubApiError && (error.reason === 'not-found' || /reference does not exist/i.test(error.message))) return
        throw error
      }
    },

    async createPR({ title, body, head: branch, base, draft }) {
      const into = base ?? (await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } } }`, {}))
        ?.repository?.defaultBranchRef?.name
      // A head in another repository, a fork, is named as GitHub takes it: `owner:branch`
      const from = sameRepo(repo, head) ? branch : `${head.owner}:${branch}`
      const created = await rest('POST', '/pulls', { title, body, head: from, base: into, draft: draft ?? false })
      return fetchPRDetailsSettled(Number(created?.number))
    },

    async mergePR(number, method = 'merge', sha) {
      await rest('PUT', `/pulls/${number}/merge`, { merge_method: method, ...(sha && { sha }) })
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
      const node = await pullRequest(number, `reviewThreads(last: ${PAGE}) { ${THREAD_NODES} }`)
      const threads = await backTo(number, 'reviewThreads', THREAD_NODES, node.reviewThreads)
      return Promise.all(threads.map(async thread => {
        const comments = (await threadCommentsBackTo(thread.id, thread.comments)).map(comment => ({
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
      }))
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
