import { execFile } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import { resolveForService } from '../utils/resolve-cli.ts'
import { createLogger } from '@apackdev/sdk/logger'
import type { GhPullRequest, GhPRComment, GhReviewThread } from '../types.ts'
import { agentChildEnvironment } from './shell-environment.ts'

const logger = createLogger('gh-cli')

const execFileAsync = promisify(execFile)

/**
 * Build env for gh CLI calls.
 *
 * Two strips, for two reasons. `GITHUB_TOKEN`/`GH_TOKEN` go so that `gh` uses its own keyring auth rather
 * than whatever the app inherited. The app's own variables go because `gh` runs aliases and hooks, so this
 * is a process that reaches arbitrary code on the user's behalf — and `APACK_API_TOKEN` is app-level access
 * to their data. Derived from the declaration (`agentChildEnvironment`), so a variable added to what the
 * app sets is stripped without anyone remembering.
 */
function ghEnv(): NodeJS.ProcessEnv {
  const env = agentChildEnvironment(process.env)
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  return env
}

async function runGh(args: string[], cwd: string, timeout = 30_000): Promise<string> {
  const ghPath = await resolveForService('gh')
  try {
    const { stdout } = await execFileAsync(ghPath, args, {
      cwd,
      timeout,
      env: ghEnv(),
    })
    return stdout.trim()
  } catch (error: any) {
    if (error.message?.includes('ENOENT')) {
      throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/ or configure the path in Settings > Providers.')
    }
    if (error.killed || error.message?.includes('TIMEOUT') || error.message?.includes('timed out')) {
      throw new Error(`GitHub CLI request timed out after ${timeout / 1000} seconds.`)
    }
    // gh outputs errors to stderr
    if (error.stderr) {
      const msg = error.stderr.trim()
      if (msg.includes('Resource not accessible by personal access token')) {
        throw new Error('GitHub token missing required permissions. Run `gh auth status` to check which token is active, then update its permissions or switch accounts with `gh auth switch`.')
      }
      throw new Error(msg)
    }
    throw error
  }
}

// --- Token detection ---

type TokenSource = 'GITHUB_TOKEN' | 'keyring' | 'unknown'
type TokenKind = 'fine-grained-pat' | 'classic-pat' | 'oauth' | 'unknown'

export interface ActiveTokenInfo {
  source: TokenSource
  kind: TokenKind
  prefix: string
}

function detectTokenKind(prefix: string): TokenKind {
  if (prefix.startsWith('github_pat_')) return 'fine-grained-pat'
  if (prefix.startsWith('ghp_')) return 'classic-pat'
  if (prefix.startsWith('gho_')) return 'oauth'
  return 'unknown'
}

function parseActiveToken(output: string): ActiveTokenInfo | null {
  const blocks = output.split(/\n\n+/)
  const activeBlock = blocks.find(b => b.includes('Active account: true'))
  if (!activeBlock) return null

  const sourceMatch = activeBlock.match(/Logged in to .+ account .+ \((.+)\)/)
  const source: TokenSource = sourceMatch?.[1] === 'GITHUB_TOKEN' ? 'GITHUB_TOKEN'
    : sourceMatch?.[1] === 'keyring' ? 'keyring' : 'unknown'

  const tokenMatch = activeBlock.match(/Token:\s+(\S+)/)
  const prefix = tokenMatch?.[1] ?? ''

  return { source, kind: detectTokenKind(prefix), prefix }
}

const PR_JSON_FIELDS = 'number,title,headRefName,baseRefName,state,body,url,isDraft,author,createdAt,updatedAt'
// Mergeability fields — slower for GitHub to compute, so excluded from the dropdown list query
// but included whenever we fetch a single PR (details view or branch auto-load).
const PR_MERGE_FIELDS = 'mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'
const PR_DETAIL_FIELDS = `${PR_JSON_FIELDS},commits,${PR_MERGE_FIELDS}`
const PR_BRANCH_FIELDS = `${PR_JSON_FIELDS},${PR_MERGE_FIELDS}`

export async function checkAuth(cwd: string): Promise<{ available: boolean; prAccess: boolean; activeToken: ActiveTokenInfo | null }> {
  let activeToken: ActiveTokenInfo | null = null
  try {
    const statusOutput = await runGh(['auth', 'status'], cwd, 10_000)
    activeToken = parseActiveToken(statusOutput)
  } catch {
    return { available: false, prAccess: false, activeToken: null }
  }
  // Probe actual PR access with a lightweight GraphQL query
  try {
    const { owner, name } = await getRepoInfo(cwd)
    await runGh([
      'api', 'graphql',
      '-f', 'query=query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ pullRequests(first:0){ totalCount } } }',
      '-F', `owner=${owner}`,
      '-F', `name=${name}`,
    ], cwd, 10_000)
    return { available: true, prAccess: true, activeToken }
  } catch (error: any) {
    const msg = error?.message ?? ''
    // Not in a git repo — gh can't determine remote; skip silently
    if (msg.includes('not a git repository')) {
      return { available: true, prAccess: true, activeToken }
    }
    logger.warn('PR access probe failed', { error: msg, tokenSource: activeToken?.source, tokenKind: activeToken?.kind })
    if (msg.includes('missing required permissions') || msg.includes('Resource not accessible')) {
      return { available: true, prAccess: false, activeToken }
    }
    // Non-permission errors (network, timeout, no remote, etc.) — don't show misleading banner
    return { available: true, prAccess: true, activeToken }
  }
}

function parseJson<T>(output: string, context: string): T {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`Failed to parse GitHub CLI response for ${context}. Output: ${output.slice(0, 200)}`)
  }
}

export async function listOpenPRs(cwd: string): Promise<GhPullRequest[]> {
  const output = await runGh([
    'pr', 'list',
    '--json', PR_JSON_FIELDS,
    '--state', 'open',
    '--limit', '50',
  ], cwd)
  if (!output) return []
  return parseJson<GhPullRequest[]>(output, 'listing PRs')
}

export async function getPRDetails(cwd: string, number: number, repo?: { owner: string; name: string }): Promise<GhPullRequest & { comments: GhPRComment[] }> {
  const args = ['pr', 'view', String(number), '--json', `${PR_DETAIL_FIELDS},comments`]
  if (repo) args.push('--repo', `${repo.owner}/${repo.name}`)
  const output = await runGh(args, cwd)
  return parseJson<GhPullRequest & { comments: GhPRComment[] }>(output, `PR #${number}`)
}

/** Fetch just the comments for a PR — used by post-mutation refreshes to avoid
 * re-pulling the full PR (mergeability, diff, threads) when only comments changed. */
export async function getPRComments(cwd: string, number: number): Promise<GhPRComment[]> {
  const output = await runGh(['pr', 'view', String(number), '--json', 'comments'], cwd)
  const parsed = parseJson<{ comments: GhPRComment[] }>(output, `PR #${number} comments`)
  return parsed.comments ?? []
}

export async function findPRForBranch(cwd: string, branch: string): Promise<GhPullRequest | null> {
  try {
    const output = await runGh([
      'pr', 'list',
      '--head', branch,
      '--json', PR_BRANCH_FIELDS,
      '--state', 'all',
      '--limit', '3',
    ], cwd)
    if (!output) return null
    const prs = parseJson<GhPullRequest[]>(output, `PR for branch ${branch}`)
    if (prs.length === 0) return null
    // Prefer open PR if multiple exist
    return prs.find(pr => pr.state === 'OPEN') || prs[0]
  } catch {
    return null
  }
}

/**
 * Fetch PR details, retrying until GitHub finishes computing mergeability.
 * GitHub recomputes `mergeable` / `mergeStateStatus` asynchronously after
 * create / base-edit, so the first read often returns UNKNOWN. Retries with
 * 2s → 4s backoff (~6s max). Draft PRs short-circuit because GitHub doesn't
 * compute mergeability for them. Retry fetch errors are swallowed so we keep
 * the last good snapshot — the initial fetch is unguarded so a totally broken
 * state still surfaces.
 */
export async function fetchPRDetailsSettled(
  cwd: string,
  prNumber: number,
): Promise<GhPullRequest & { comments: GhPRComment[] }> {
  let details = await getPRDetails(cwd, prNumber)
  for (let i = 1; i <= 2; i++) {
    if (details.isDraft
        || (details.mergeable && details.mergeable !== 'UNKNOWN'
            && details.mergeStateStatus && details.mergeStateStatus !== 'UNKNOWN')) break
    await new Promise(r => setTimeout(r, 2_000 * i))
    try { details = await getPRDetails(cwd, prNumber) } catch { break }
  }
  return details
}

export async function createPR(
  cwd: string,
  opts: { title: string; body: string; base?: string; head?: string; draft?: boolean }
): Promise<GhPullRequest> {
  const args = ['pr', 'create', '--title', opts.title, '--body', opts.body]
  if (opts.base) args.push('--base', opts.base)
  if (opts.head) args.push('--head', opts.head)
  if (opts.draft) args.push('--draft')
  // gh pr create outputs the URL, not JSON. We create then fetch details.
  const url = await runGh(args, cwd)
  // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
  const match = url.match(/\/pull\/(\d+)/)
  if (!match) throw new Error('Failed to parse PR number from gh output')
  const prNumber = parseInt(match[1], 10)
  return fetchPRDetailsSettled(cwd, prNumber)
}

export async function mergePR(
  cwd: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<void> {
  await runGh(['pr', 'merge', String(number), `--${method}`], cwd)
}

export async function closePR(cwd: string, number: number): Promise<void> {
  await runGh(['pr', 'close', String(number)], cwd)
}

export async function markDraft(cwd: string, number: number): Promise<void> {
  await runGh(['pr', 'ready', String(number), '--undo'], cwd)
}

export async function markReady(cwd: string, number: number): Promise<void> {
  await runGh(['pr', 'ready', String(number)], cwd)
}

export async function updatePR(
  cwd: string,
  number: number,
  opts: { title?: string; body?: string; base?: string }
): Promise<void> {
  const args = ['pr', 'edit', String(number)]
  if (opts.title) args.push('--title', opts.title)
  if (opts.body !== undefined) args.push('--body', opts.body)
  if (opts.base) args.push('--base', opts.base)
  await runGh(args, cwd)
}

// --- Issue comment operations ---

export async function createPRComment(cwd: string, number: number, body: string): Promise<void> {
  await runGh(['pr', 'comment', String(number), '--body', body], cwd)
}

export async function editPRComment(cwd: string, commentId: number, body: string): Promise<void> {
  const { owner, name } = await getRepoInfo(cwd)
  await runGh(['api', `repos/${owner}/${name}/issues/comments/${commentId}`, '-X', 'PATCH', '-f', `body=${body}`], cwd)
}

export async function deletePRComment(cwd: string, commentId: number): Promise<void> {
  const { owner, name } = await getRepoInfo(cwd)
  await runGh(['api', `repos/${owner}/${name}/issues/comments/${commentId}`, '-X', 'DELETE'], cwd)
}

// --- Review thread operations ---

export async function getReviewThreads(cwd: string, number: number, repo?: { owner: string; name: string }): Promise<GhReviewThread[]> {
  const { owner, name } = repo || await getRepoInfo(cwd)
  const query = `query($owner:String!,$name:String!,$number:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$number){
        reviewThreads(first:100){
          nodes{
            id isResolved isOutdated path line startLine originalLine originalStartLine diffSide startDiffSide subjectType
            comments(first:50){
              nodes{ id databaseId body author{login} createdAt viewerDidAuthor path line startLine originalLine originalStartLine diffHunk }
            }
          }
        }
      }
    }
  }`
  const output = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-F', `owner=${owner}`,
    '-F', `name=${name}`,
    '-F', `number=${number}`,
  ], cwd)
  const data = parseJson<any>(output, 'review threads')
  const nodes = data?.data?.repository?.pullRequest?.reviewThreads?.nodes || []
  return nodes.map((t: any) => {
    const comments = (t.comments?.nodes || []).map((c: any) => ({
      id: c.id,
      databaseId: c.databaseId,
      body: c.body,
      author: c.author,
      createdAt: c.createdAt,
      viewerDidAuthor: c.viewerDidAuthor ?? false,
      path: c.path ?? null,
      line: c.line ?? null,
      startLine: c.startLine ?? null,
      originalLine: c.originalLine ?? null,
      originalStartLine: c.originalStartLine ?? null,
      diffHunk: c.diffHunk ?? null,
    }))
    const firstDiffHunk = comments.find((c: any) => c.diffHunk)?.diffHunk ?? null
    return {
      id: t.id,
      isResolved: t.isResolved,
      isOutdated: t.isOutdated,
      path: t.path,
      line: t.line,
      startLine: t.startLine ?? null,
      originalLine: t.originalLine ?? null,
      originalStartLine: t.originalStartLine ?? null,
      diffSide: t.diffSide ?? null,
      startDiffSide: t.startDiffSide ?? null,
      subjectType: t.subjectType ?? null,
      diffHunk: firstDiffHunk,
      comments,
    }
  })
}

export async function replyToReviewThread(cwd: string, prNumber: number, commentDatabaseId: number, body: string): Promise<void> {
  const { owner, name } = await getRepoInfo(cwd)
  await runGh([
    'api', `repos/${owner}/${name}/pulls/${prNumber}/comments/${commentDatabaseId}/replies`,
    '-X', 'POST', '-f', `body=${body}`,
  ], cwd)
}

export async function editReviewComment(cwd: string, commentId: number, body: string): Promise<void> {
  const { owner, name } = await getRepoInfo(cwd)
  await runGh(['api', `repos/${owner}/${name}/pulls/comments/${commentId}`, '-X', 'PATCH', '-f', `body=${body}`], cwd)
}

export async function deleteReviewComment(cwd: string, commentId: number): Promise<void> {
  const { owner, name } = await getRepoInfo(cwd)
  await runGh(['api', `repos/${owner}/${name}/pulls/comments/${commentId}`, '-X', 'DELETE'], cwd)
}

export async function resolveReviewThread(cwd: string, threadId: string): Promise<void> {
  const mutation = `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ clientMutationId } }`
  await runGh(['api', 'graphql', '-f', `query=${mutation}`, '-F', `id=${threadId}`], cwd)
}

export async function unresolveReviewThread(cwd: string, threadId: string): Promise<void> {
  const mutation = `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ clientMutationId } }`
  await runGh(['api', 'graphql', '-f', `query=${mutation}`, '-F', `id=${threadId}`], cwd)
}

// --- Helpers ---

async function getRepoInfo(cwd: string): Promise<{ owner: string; name: string }> {
  const output = await runGh(['repo', 'view', '--json', 'owner,name'], cwd, 5_000)
  const data = parseJson<{ owner: { login: string }; name: string }>(output, 'repo info')
  return { owner: data.owner.login, name: data.name }
}

// --- GitHub asset URL resolution ---

async function getAuthToken(cwd: string): Promise<string> {
  return runGh(['auth', 'token'], cwd, 5_000)
}

function resolveRedirect(url: string, token: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'HEAD',
      headers: { Authorization: `token ${token}` },
    }, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        resolve(res.headers.location)
      } else {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
    req.setTimeout(5_000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

const ASSET_URL_PATTERN = /https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+/g

export async function resolveGitHubAssetUrls(text: string, cwd: string): Promise<string> {
  if (!text) return text
  const matches = text.match(ASSET_URL_PATTERN)
  if (!matches) return text

  let token: string
  try {
    token = await getAuthToken(cwd)
  } catch {
    return text
  }

  let resolved = text
  const unique = [...new Set(matches)]
  const results = await Promise.all(
    unique.map(url => resolveRedirect(url, token))
  )
  for (let i = 0; i < unique.length; i++) {
    if (results[i]) {
      resolved = resolved.split(unique[i]).join(results[i]!)
    }
  }
  return resolved
}

/**
 * Has the GitHub CLI give git its sign-in for `host` (`gh auth setup-git`), which writes a credential helper for
 * that host into the user's git config. It is the user's to ask for, and only works once the CLI is signed in
 * itself, which is checked first so that the answer says which of the two is missing.
 */
export async function setUpGitSignIn(cwd: string, host: string): Promise<void> {
  try {
    await runGh(['auth', 'status', '--hostname', host], cwd)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('GitHub CLI (gh) not found')) throw error
    throw new Error(`GitHub CLI is not signed in to ${host}. Run \`gh auth login\` in a terminal, then try again.`)
  }
  await runGh(['auth', 'setup-git', '--hostname', host], cwd)
}
