import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_TIMEOUT_MS, GitHubRequestError, fetchReleaseAsset, fetchRepoFile, githubFetch, githubToken } from '../../src/packs/github.ts';

/**
 * Every GitHub request a pack install or update check makes goes through `githubFetch`, and what it
 * turns a failed response into is what the user reads: the Packs view shows the message, and the
 * `reason` decides whether the app offers to retry. None of it was covered — `updater.spec.ts` mocks
 * `fetch` above this layer, so the whole mapping from status code to message was untested.
 */

const respond = (status: number, headers: Record<string, string> = {}, body = '{}') =>
  vi.fn(async () => new Response(body, { status, headers }));

const fail = async (fetchMock: ReturnType<typeof respond>): Promise<GitHubRequestError> => {
  vi.stubGlobal('fetch', fetchMock);
  try {
    await githubFetch('https://api.github.com/repos/o/r/releases');
  } catch (err) {
    return err as GitHubRequestError;
  }
  throw new Error('githubFetch resolved, but the response was not ok');
};

const ORIGINAL = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  // A spy outlives its case otherwise: spying on AbortSignal.timeout again returns it, earlier calls and all
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('githubToken', () => {
  it('prefers GITHUB_TOKEN and falls back to GH_TOKEN', () => {
    expect(githubToken()).toBeUndefined();
    process.env.GH_TOKEN = 'gh';
    expect(githubToken()).toBe('gh');
    process.env.GITHUB_TOKEN = 'github';
    expect(githubToken()).toBe('github');
  });
});

describe('githubFetch', () => {
  it('returns the response when it is ok', async () => {
    vi.stubGlobal('fetch', respond(200));
    await expect(githubFetch('https://api.github.com/x')).resolves.toMatchObject({ ok: true });
  });

  it('sends the token as a bearer credential when one is set', async () => {
    process.env.GH_TOKEN = 'secret-value';
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    await githubFetch('https://api.github.com/x');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(headers.Authorization).toContain('secret-value');
  });

  it('sends no Authorization header when no token is set', async () => {
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    await githubFetch('https://api.github.com/x');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  describe('failure mapping', () => {
    it('reports an exhausted quota as rate-limited, with when it resets', async () => {
      const reset = Math.floor(Date.now() / 1000) + 600;
      const err = await fail(respond(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
      expect(err.reason).toBe('rate-limited');
      expect(err.message).toContain('rate limit');
      expect(err.message).toContain(new Date(reset * 1000).toISOString());
    });

    // A 403 with quota to spare is GitHub's secondary limit: retryable, and not the same advice
    it('reports a secondary rate limit as rate-limited, not a generic failure', async () => {
      const err = await fail(respond(403, { 'retry-after': '30' }));
      expect(err.reason).toBe('rate-limited');
      expect(err.message).toContain('30s');
    });

    it('treats 429 the same way', async () => {
      expect((await fail(respond(429, { 'retry-after': '5' }))).reason).toBe('rate-limited');
    });

    it('asks for credentials on a 401 when none are set', async () => {
      const err = await fail(respond(401));
      expect(err.reason).toBe('unauthorized');
      expect(err.message).toContain('set GITHUB_TOKEN');
    });

    // The message used to name GITHUB_TOKEN whichever variable supplied the token, sending the user
    // to check a variable they never set
    it('names the variable the token actually came from on a 401', async () => {
      process.env.GH_TOKEN = 'gh';
      const err = await fail(respond(401));
      expect(err.message).toContain('GH_TOKEN');
      expect(err.message).not.toContain('GITHUB_TOKEN');
    });

    it('names GITHUB_TOKEN on a 401 when that is the one set', async () => {
      process.env.GITHUB_TOKEN = 'github';
      expect((await fail(respond(401))).message).toContain('GITHUB_TOKEN');
    });

    it('reports a 404 as not-found, and suggests a token only when there is none', async () => {
      expect((await fail(respond(404))).reason).toBe('not-found');
      expect((await fail(respond(404))).message).toContain('private');
      process.env.GITHUB_TOKEN = 'github';
      expect((await fail(respond(404))).message).not.toContain('set GITHUB_TOKEN');
    });

    it('reports any other status as a generic failure', async () => {
      expect((await fail(respond(500))).reason).toBe('failed');
    });

    it('reports a network error as a generic failure, keeping the cause in the message', async () => {
      const err = await fail(vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
      expect(err.reason).toBe('failed');
      expect(err.message).toContain('ECONNREFUSED');
    });
  });

  // The signal bounds the body too, not just the headers, so a stalled download can't hang a check
  it('passes an abort signal, and gives a release asset the longer download timeout', async () => {
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    // AbortSignal.timeout keeps its duration to itself, so the assertion is on the value reaching it.
    // Comparing the two calls is the point: asserting DOWNLOAD_TIMEOUT_MS's own value here only
    // restated the constant, and stayed green however fetchReleaseAsset passed it — or didn't.
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await githubFetch('https://api.github.com/x');
    expect((fetchMock.mock.calls[0] as unknown as [string, { signal?: AbortSignal }])[1].signal).toBeInstanceOf(AbortSignal);
    const [apiTimeout] = timeout.mock.calls[0];

    await fetchReleaseAsset({ name: 'p.tgz', url: 'https://api.github.com/a', browser_download_url: 'https://x/p.tgz' });
    const [downloadTimeout] = timeout.mock.calls[1];
    expect(downloadTimeout).toBe(DOWNLOAD_TIMEOUT_MS);
    expect(downloadTimeout).toBeGreaterThan(apiTimeout);
  });

  // fetchReleaseAsset has two branches and every test above runs without a token, so only the public
  // download URL was ever exercised. Dropping DOWNLOAD_TIMEOUT_MS from the API branch left all of them
  // green.
  it('downloads a release asset through the API when a token is set, with the same accept and timeout', async () => {
    process.env.GITHUB_TOKEN = 'github';
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await fetchReleaseAsset({ name: 'p.tgz', url: 'https://api.github.com/a', browser_download_url: 'https://x/p.tgz' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.github.com/a');
    expect(init.headers.Accept).toContain('octet-stream');
    expect(init.headers.Authorization).toBe('Bearer github');
    expect(timeout.mock.calls[0][0]).toBe(DOWNLOAD_TIMEOUT_MS);
  });

  it('asks for a release asset as a binary stream, not as JSON', async () => {
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    await fetchReleaseAsset({ name: 'p.tgz', url: 'https://api.github.com/a', browser_download_url: 'https://x/p.tgz' });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(headers.Accept).toContain('octet-stream');
  });

  it('reads a repo file at a ref from the raw endpoint', async () => {
    const fetchMock = respond(200);
    vi.stubGlobal('fetch', fetchMock);
    await fetchRepoFile('owner', 'repo', 'v1.0.0', 'apack.json');
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('owner');
    expect(url).toContain('repo');
    expect(url).toContain('v1.0.0');
    expect(url).toContain('apack.json');
  });
});
