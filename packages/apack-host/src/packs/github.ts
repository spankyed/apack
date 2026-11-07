/**
 * GitHub requests for pack installs and update checks. A GITHUB_TOKEN (or GH_TOKEN) in the
 * environment authenticates them, which reaches private repositories and raises the API rate
 * limit; failures name the cause instead of looking like "no release".
 */

/** Metadata requests: a release list or a manifest, small enough that a slow one is a stuck one. */
const BUDGET_MS = 10_000;

/**
 * Downloads: a pack archive is a few megabytes, so this covers a slow connection while still
 * failing a stalled download instead of hanging the install. It bounds the body too, since the
 * signal aborts the response while it's being read.
 */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

export function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

export type GitHubFailure = 'rate-limited' | 'not-found' | 'unauthorized' | 'failed';

/** The variable a token came from, so a message names the one the user actually set */
const tokenVar = (): string | undefined =>
  process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : process.env.GH_TOKEN ? 'GH_TOKEN' : undefined;

export class GitHubRequestError extends Error {
  constructor(message: string, readonly reason: GitHubFailure, readonly status?: number) {
    super(message);
    this.name = 'GitHubRequestError';
  }
}

function headers(accept: string): Record<string, string> {
  const token = githubToken();
  return {
    Accept: accept,
    'User-Agent': 'apack',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Fetches a GitHub URL, throwing GitHubRequestError with the cause when it doesn't succeed. */
export async function githubFetch(url: string, accept = 'application/vnd.github+json', timeoutMs = BUDGET_MS): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(accept), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new GitHubRequestError(`GitHub request to ${url} failed: ${err instanceof Error ? err.message : err}`, 'failed');
  }
  if (response.ok) return response;

  const tokenHint = githubToken() ? '' : '; set GITHUB_TOKEN';  // no token yet, so name the documented one
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const when = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : '';
    throw new GitHubRequestError(`GitHub's API rate limit is used up${when}${tokenHint} to raise it`, 'rate-limited', response.status);
  }
  // A secondary rate limit: too many requests too quickly, with quota to spare
  if (response.status === 403 || response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const when = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Retry in ${retryAfter}s.` : ' Retry in a minute.';
    throw new GitHubRequestError(`GitHub is rate limiting these requests.${when}`, 'rate-limited', response.status);
  }
  if (response.status === 401) {
    throw new GitHubRequestError(
      tokenVar() ? `GitHub rejected the ${tokenVar()} (401)` : 'GitHub needs credentials for this request (401); set GITHUB_TOKEN',
      'unauthorized',
      401,
    );
  }
  if (response.status === 404) {
    throw new GitHubRequestError(`${url} was not found: it doesn't exist or it's private${tokenHint ? `${tokenHint} with access to it` : ''}`, 'not-found', 404);
  }
  throw new GitHubRequestError(`GitHub request to ${url} failed: ${response.status} ${response.statusText}`, 'failed', response.status);
}

export interface GitHubReleaseAsset {
  name: string;
  /** API URL; with a token it downloads assets of private repositories too */
  url?: string;
  browser_download_url: string;
}

/** Downloads a release asset: through the API when authenticated, else its public download URL. */
export function fetchReleaseAsset(asset: GitHubReleaseAsset): Promise<Response> {
  return githubToken() && asset.url
    ? githubFetch(asset.url, 'application/octet-stream', DOWNLOAD_TIMEOUT_MS)
    : githubFetch(asset.browser_download_url, 'application/octet-stream', DOWNLOAD_TIMEOUT_MS);
}

/** A file at a tag: the contents API when authenticated (private repositories), else raw.githubusercontent.com. */
export function fetchRepoFile(owner: string, repo: string, ref: string, file: string): Promise<Response> {
  return githubToken()
    ? githubFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw+json')
    : githubFetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${file}`, 'application/json');
}
