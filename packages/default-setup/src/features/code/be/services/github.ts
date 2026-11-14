// Signing in to GitHub with OAuth's device flow: GitHub gives a code, the user types it at github.com, and the app
// asks until GitHub says the user approved it, then holds the token GitHub hands back. Nothing is pasted, and no
// client secret is involved: device flow has none, which is why the client id below can be committed.
//
// GitHub's addresses and the wait between asks are what this is built over, so a spec builds one over a stand-in
// for GitHub and a wait it records.

/** Where GitHub answers: the web host that runs sign-in, and the REST API */
export interface GitHubEndpoints {
  web: string
  api: string
}

export const GITHUB_ENDPOINTS: GitHubEndpoints = { web: 'https://github.com', api: 'https://api.github.com' }

/**
 * The OAuth App this app signs in as: registered on GitHub with device flow on and token expiry off, and public,
 * since device flow has no secret. Where it is unset, sign-in says so rather than asking GitHub
 */
export const GITHUB_CLIENT_ID: string | undefined = 'Ov23lioCOloq0FgG3Uj3'

/** Private repositories, pull requests and pushes (`repo`), and pushing a change to `.github/workflows` (`workflow`) */
export const GITHUB_SCOPES: readonly string[] = ['repo', 'workflow']

/**
 * How long one request to GitHub may take. A network wait, which nothing on this machine can show progress on:
 * the sign-in as a whole is bounded by the code's own expiry, and the user can cancel it
 */
const REQUEST_MS = 30_000

/** What GitHub gave to show the user, and what to ask with */
export interface DeviceCode {
  deviceCode: string
  /** What the user types at `verificationUri` */
  userCode: string
  verificationUri: string
  /** When GitHub stops taking this code, in milliseconds since the epoch */
  expiresAt: number
  /** How long to wait between asks, as GitHub said */
  intervalMs: number
}

export interface GitHubToken {
  token: string
  /** The scopes GitHub granted, which the user may have narrowed */
  scopes: string[]
}

export interface GitHubAccount {
  login: string
  name?: string
  avatarUrl?: string
}

/**
 * Why a sign-in ended without a token: no OAuth App configured for this build, the user refused it at github.com,
 * the code expired before they approved it, the app cancelled it, or GitHub could not be asked or said something else
 */
export type GitHubSignInFailure = 'unconfigured' | 'denied' | 'expired' | 'cancelled' | 'failed'

export class GitHubSignInError extends Error {
  constructor(readonly reason: GitHubSignInFailure, message: string) {
    super(message)
    this.name = 'GitHubSignInError'
  }
}

/** Waits `ms`, or until `signal` aborts, which it rejects with */
export type Wait = (ms: number, signal: AbortSignal) => Promise<void>

const waitFor: Wait = (ms, signal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason)
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
  const stop = () => { clearTimeout(timer); reject(signal.reason) }
  signal.addEventListener('abort', stop, { once: true })
})

export interface GitHubSignIn {
  /** Where GitHub answers, which the API calls made with this sign-in go to as well */
  readonly endpoints: GitHubEndpoints
  /** Asks GitHub for a code to show the user */
  fetchDeviceCode(signal: AbortSignal): Promise<DeviceCode>
  /** Asks GitHub at the interval it set until the user approved the code, refused it or it expired */
  pollForToken(code: DeviceCode, signal: AbortSignal): Promise<GitHubToken>
  /** The account a token signs in as */
  fetchAccount(token: string, signal: AbortSignal): Promise<GitHubAccount>
}

export function createGitHubSignIn({ endpoints = GITHUB_ENDPOINTS, clientId = GITHUB_CLIENT_ID, wait = waitFor, now = Date.now }: {
  endpoints?: GitHubEndpoints
  clientId?: string
  wait?: Wait
  now?: () => number
} = {}): GitHubSignIn {
  const configuredId = (): string => {
    if (!clientId) throw new GitHubSignInError('unconfigured', 'This build of apack has no GitHub OAuth App to sign in with.')
    return clientId
  }

  /** One request, bounded by its own wait and by whoever asked; what it answers as JSON */
  const request = async (url: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }> => {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]) })
    } catch (error) {
      if (signal.aborted) throw new GitHubSignInError('cancelled', 'Signing in to GitHub was cancelled.')
      throw new GitHubSignInError('failed', `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    try {
      return { status: response.status, body: JSON.parse(text) as Record<string, unknown> }
    } catch {
      throw new GitHubSignInError('failed', `GitHub answered ${response.status} with something that is not JSON.`)
    }
  }

  /** A form post to GitHub's sign-in, which answers JSON when asked to */
  const post = (path: string, fields: Record<string, string>, signal: AbortSignal) => request(`${endpoints.web}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }, signal)

  return {
    endpoints,

    async fetchDeviceCode(signal) {
      const { status, body } = await post('/login/device/code', { client_id: configuredId(), scope: GITHUB_SCOPES.join(' ') }, signal)
      if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string' || typeof body.verification_uri !== 'string') {
        throw new GitHubSignInError('failed', `GitHub gave no code to sign in with (${status}${typeof body.error === 'string' ? `: ${body.error}` : ''}).`)
      }
      return {
        deviceCode: body.device_code,
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        expiresAt: now() + Number(body.expires_in ?? 900) * 1000,
        intervalMs: Number(body.interval ?? 5) * 1000,
      }
    },

    async pollForToken(code, signal) {
      let intervalMs = code.intervalMs
      for (;;) {
        if (now() >= code.expiresAt) throw new GitHubSignInError('expired', 'The code expired before it was approved. Sign in again for a new one.')
        try {
          await wait(intervalMs, signal)
        } catch {
          throw new GitHubSignInError('cancelled', 'Signing in to GitHub was cancelled.')
        }
        const { body } = await post('/login/oauth/access_token', {
          client_id: configuredId(),
          device_code: code.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }, signal)
        if (typeof body.access_token === 'string') {
          return { token: body.access_token, scopes: typeof body.scope === 'string' ? body.scope.split(/[ ,]/).filter(Boolean) : [] }
        }
        switch (body.error) {
          case 'authorization_pending':
            continue
          // GitHub asked for asks further apart, and says how far; it adds five seconds when it does not say
          case 'slow_down':
            intervalMs = typeof body.interval === 'number' ? body.interval * 1000 : intervalMs + 5000
            continue
          case 'expired_token':
            throw new GitHubSignInError('expired', 'The code expired before it was approved. Sign in again for a new one.')
          case 'access_denied':
            throw new GitHubSignInError('denied', 'The sign-in was refused at GitHub.')
          default:
            throw new GitHubSignInError('failed', `GitHub refused the sign-in: ${String(body.error_description ?? body.error ?? 'no reason given')}.`)
        }
      }
    },

    async fetchAccount(token, signal) {
      const { status, body } = await request(`${endpoints.api}/user`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      }, signal)
      if (status !== 200 || typeof body.login !== 'string') throw new GitHubSignInError('failed', `GitHub did not say whose sign-in it is (${status}).`)
      return {
        login: body.login,
        ...(typeof body.name === 'string' && { name: body.name }),
        ...(typeof body.avatar_url === 'string' && { avatarUrl: body.avatar_url }),
      }
    },
  }
}

export const githubService: GitHubSignIn = createGitHubSignIn()
