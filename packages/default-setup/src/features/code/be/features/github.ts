// The app's own sign-in to GitHub, which the code feature's pull requests and git's pushes to GitHub run on. The
// token is this pack's own secret (`services.secrets.own`): another pack cannot read it, and it is in no setting
// and no log. Which account it signs in as is kept beside it, so showing it asks GitHub nothing.
import { answer } from '../answer.ts'
import type { OutgoingGitHubEvents } from '../contract.ts'
import { broadcastToSurface } from '#generated/events.ts'
import { services } from '#generated/services.ts'
import { defineHandlers } from '@apackdev/sdk/framework'
import { createLogger } from '@apackdev/sdk/logger'
import { setup } from 'xstate'
import { GitHubSignInError, type GitHubAccount } from '../services/github.ts'
import { createGitHubApi, GitHubApiError, repoOfRemote, type GitHubApi, type GitHubRepo } from '../services/github-api.ts'
import type { AppGitRepository } from '../services/app-git-repository.ts'
import { agentChildEnvironment } from '../services/shell-environment.ts'
import { resolveGitPath } from '../utils/resolve-cli.ts'
import { execFileWhileWorking } from '@apackdev/sdk/progress'

const logger = createLogger('github')

/** The name the token is kept under, among this pack's own secrets */
const SECRET = 'github'

/** The username git sends the app's GitHub token as. GitHub takes any with a token; this one says whose it is */
export const GITHUB_TOKEN_USERNAME = 'x-access-token'

/**
 * Has git's own credential helpers forget the token, so it signs nothing in once the app has signed out. Git hands
 * a sign-in that worked to every helper the user has to keep, so a keychain may hold the app's token after a push;
 * `git credential reject`, run in `environment`, asks each helper that environment's git names to erase it. A git
 * that cannot be run leaves it there, which is said in the log; the promise settles once git has finished either way
 */
export function forgetInGit(token: string, web: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const { protocol, host } = new URL(web)
  const run = execFileWhileWorking(resolveGitPath(), ['credential', 'reject'], { env: environment })
  run.child.stdin?.end(`protocol=${protocol.replace(':', '')}\nhost=${host}\nusername=${GITHUB_TOKEN_USERNAME}\npassword=${token}\n\n`)
  return run.then(() => undefined, (error: unknown) => logger.warn('Git could not be asked to forget the GitHub sign-in', { error: error instanceof Error ? error.message : String(error) }))
}

/** What is kept: the token, the scopes GitHub granted with it, and whose it is */
interface StoredSignIn {
  token: string
  scopes: string[]
  account: GitHubAccount
}

export interface CodeGitHubSystemContext {
  /** The sign-in under way, which a new one or a cancel ends */
  held: { signIn?: AbortController }
}

export type Event =
  | { type: 'github.GET_ACCOUNT' }
  | { type: 'github.SIGN_IN' }
  | { type: 'github.CANCEL_SIGN_IN' }
  | { type: 'github.SIGN_OUT' }

/**
 * The sign-in as last read, so that a git run, which lays it over git's environment, neither reads nor decrypts
 * the secrets file: `undefined` until it is read. This system's own sign-in and sign-out write it as they write the
 * secret; anything else that changes the stored secrets says so (`SECRETS_CHANGED`), and it is read again
 */
let heldSignIn: { signIn: StoredSignIn | null } | undefined

/**
 * The sign-in this pack holds, or `null`. One that cannot be read is no sign-in, which is said in the log once,
 * until the secrets change
 */
export function storedSignIn(): StoredSignIn | null {
  if (heldSignIn) return heldSignIn.signIn
  let signIn: StoredSignIn | null = null
  try {
    const stored = services.secrets.own.get(SECRET)
    signIn = stored === undefined ? null : JSON.parse(stored) as StoredSignIn
  } catch (error) {
    logger.warn('The GitHub sign-in could not be read; sign in again', { error: error instanceof Error ? error.message : String(error) })
  }
  heldSignIn = { signIn }
  return signIn
}

/** Has the next use read the sign-in again: the stored secrets changed, or the app holding it started */
export function forgetHeldSignIn(): void {
  heldSignIn = undefined
}

/** A checkout's repository on GitHub, and the remote that names it, which every fetch and delete of the ask uses */
export interface GitHubOfCheckout {
  github: GitHubApi
  /** The remote's name, as git names it: the one the current branch follows, else `origin`, else the only one */
  remote: string
}

/**
 * GitHub's API for the repository the checkout's remote names (`readRemote`) with this pack's sign-in, and that
 * remote. Refuses, saying which, a checkout whose remote is not on GitHub and an app that is not signed in
 */
export async function gitHubOf(repository: AppGitRepository): Promise<GitHubOfCheckout> {
  const remote = await repository.readRemote()
  const repo = remote ? repoOfRemote(remote.url, services.github.endpoints.web) : undefined
  if (!remote || !repo) throw new GitHubApiError('not-github', 'This repository has no remote on github.com.')
  return { github: signedIn(repo), remote: remote.name }
}

/** GitHub's API for the repository a checkout's remote names, or for `named` where the caller names another */
export async function gitHubApiFor(repository: AppGitRepository, named?: GitHubRepo): Promise<GitHubApi> {
  return named ? signedIn(named) : (await gitHubOf(repository)).github
}

function signedIn(repo: GitHubRepo): GitHubApi {
  const signIn = storedSignIn()
  if (!signIn) throw new GitHubApiError('signed-out', 'Sign in to GitHub in Settings → Code to work with pull requests.')
  return createGitHubApi({ endpoints: services.github.endpoints, token: signIn.token, repo })
}

const accountChanged = (account: GitHubAccount | null) => broadcastToSurface('code', { type: 'github.ACCOUNT_CHANGED', account } satisfies OutgoingGitHubEvents)

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeGitHubSystemContext, Event>()

export const githubSystem = setup({
  types: {
    context: {} as CodeGitHubSystemContext,
    events: {} as Event,
  },
  actions: handlers.actions({
    tellAccount: ({ reply }) => {
      answer(reply, { type: 'github.ACCOUNT', account: storedSignIn()?.account ?? null })
    },

    signIn: ({ context, reply }) => {
      context.held.signIn?.abort()
      const controller = new AbortController()
      context.held.signIn = controller
      const { signal } = controller
      void (async () => {
        const code = await services.github.fetchDeviceCode(signal)
        answer(reply, { type: 'github.SIGN_IN_CODE', userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt })
        const { token, scopes } = await services.github.pollForToken(code, signal)
        const account = await services.github.fetchAccount(token, signal)
        const signIn: StoredSignIn = { token, scopes, account }
        services.secrets.own.set(SECRET, JSON.stringify(signIn))
        heldSignIn = { signIn }
        logger.info(`Signed in to GitHub as ${account.login}`)
        accountChanged(account)
      })().catch((error: unknown) => {
        const failure = error instanceof GitHubSignInError ? error : new GitHubSignInError('failed', error instanceof Error ? error.message : String(error))
        if (failure.reason !== 'cancelled') logger.warn(`Signing in to GitHub failed: ${failure.message}`)
        answer(reply, { type: 'github.SIGN_IN_FAILED', reason: failure.reason, message: failure.message })
      }).finally(() => {
        if (context.held.signIn === controller) context.held.signIn = undefined
      })
    },

    cancelSignIn: ({ context }) => {
      context.held.signIn?.abort()
    },

    signOut: ({ context }) => {
      context.held.signIn?.abort()
      const signedIn = storedSignIn()
      services.secrets.own.delete(SECRET)
      heldSignIn = { signIn: null }
      if (signedIn) void forgetInGit(signedIn.token, services.github.endpoints.web, agentChildEnvironment(process.env))
      accountChanged(null)
    },
  }),
}).createMachine({
  id: 'github',
  context: () => ({ held: {} }),
  // A sign-in read by an app before this one is not this app's
  entry: () => forgetHeldSignIn(),
  on: {
    'github.GET_ACCOUNT': { actions: 'tellAccount' },
    'github.SIGN_IN': { actions: 'signIn' },
    'github.CANCEL_SIGN_IN': { actions: 'cancelSignIn' },
    'github.SIGN_OUT': { actions: 'signOut' },
  },
})
