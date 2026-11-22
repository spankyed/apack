// The app's own sign-in to GitHub, which the code feature's pull requests and git's pushes to GitHub run on. The
// token is this pack's own secret (`services.secrets.own`): another pack cannot read it, and it is in no setting
// and no log. Which account it signs in as is kept beside it, so showing it asks GitHub nothing.
import type { GitHubAsks, OutgoingGitHubEvents } from '../contract.ts'
import { broadcast } from '#generated/events.ts'
import { services } from '#generated/services.ts'
import { defineHandlers } from '@apackdev/sdk/framework'
import type { AsksEvents } from '@apackdev/sdk/events'
import { createLogger } from '@apackdev/sdk/logger'
import { setup } from 'xstate'
import { GitHubSignInError, type GitHubAccount } from '../services/github.ts'
import { createGitHubApi, GitHubApiError, sameRepo, type GitHubApi, type GitHubRepo } from '../services/github-api.ts'
import { gitHubRepoOf } from '../services/ssh-host.ts'
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

/** The sign-in is held beside this machine (`heldSignIn`), so it keeps nothing of its own */
export type CodeGitHubSystemContext = Record<string, never>

export type Event =
  | { type: 'github.SIGN_OUT' }
  // The github asks, which the code system forwards here to be answered
  | AsksEvents<GitHubAsks>

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

/**
 * A checkout's pull requests on GitHub: the API for the repository they are on, and the remotes every fetch and
 * delete of the ask uses
 */
export interface GitHubOfCheckout {
  /** On the repository the remote names, or on its parent where that is a fork (`github.head` is the fork) */
  github: GitHubApi
  /** The remote's name, as git names it: the one the current branch follows, else `origin`, else the only one */
  remote: string
  /**
   * The remote that names `github.repo`, which a pull request's ref and its base are fetched from: `remote` itself,
   * or for a fork the remote naming its parent (`upstream`, as a rule). Absent for a fork with no such remote
   */
  baseRemote?: string
}

/**
 * The repository each fork is of, by `owner/name` as GitHub reads it (without regard to case), for the app's run:
 * which repository a fork is of does not change. `null` for a repository that is no fork; an ask that failed is
 * forgotten, and asked again
 */
const parents = new Map<string, Promise<GitHubRepo | null>>()

function parentOf(api: GitHubApi): Promise<GitHubRepo | null> {
  const key = `${api.repo.owner}/${api.repo.name}`.toLowerCase()
  const known = parents.get(key)
  if (known) return known
  const asked = api.readParent()
  parents.set(key, asked)
  asked.catch(() => { if (parents.get(key) === asked) parents.delete(key) })
  return asked
}

/**
 * GitHub's API for the pull requests of the repository the checkout's remote names (`readRemote`), with this
 * pack's sign-in, and the remotes to fetch from. Where that repository is a fork they are its parent's: listed,
 * opened and created there, from the fork's branches. Refuses, saying which, a checkout whose remote is not on
 * GitHub and an app that is not signed in
 */
export async function gitHubOf(repository: AppGitRepository): Promise<GitHubOfCheckout> {
  const web = services.github.endpoints.web
  const remote = await repository.readRemote()
  const head = remote ? await gitHubRepoOf(remote.url, web) : undefined
  if (!remote || !head) throw new GitHubApiError('not-github', 'This repository has no remote on github.com.')
  const parent = await parentOf(signedIn(head))
  if (!parent) return { github: signedIn(head), remote: remote.name, baseRemote: remote.name }
  const remotes = await repository.readRemotes()
  const named = await Promise.all(remotes.map(async other => sameRepo(await gitHubRepoOf(other.url, web), parent) ? other.name : undefined))
  const baseRemote = named.find(name => name !== undefined)
  return { github: signedIn(parent, head), remote: remote.name, ...(baseRemote && { baseRemote }) }
}

/** GitHub's API for the pull requests of a checkout (`gitHubOf`), or of `named` where the caller names a repository */
export async function gitHubApiFor(repository: AppGitRepository, named?: GitHubRepo): Promise<GitHubApi> {
  return named ? signedIn(named) : (await gitHubOf(repository)).github
}

function signedIn(repo: GitHubRepo, head: GitHubRepo = repo): GitHubApi {
  const signIn = storedSignIn()
  if (!signIn) throw new GitHubApiError('signed-out', 'Sign in to GitHub in Settings → Code to work with pull requests.')
  return createGitHubApi({ endpoints: services.github.endpoints, token: signIn.token, repo, head })
}

const accountChanged = (account: GitHubAccount | null) => broadcast('code', { type: 'github.ACCOUNT_CHANGED', account } satisfies OutgoingGitHubEvents)

/** Why a sign-in ended without an account, as GitHub's sign-in service says it */
const signInFailureOf = (error: unknown): GitHubSignInError =>
  error instanceof GitHubSignInError ? error : new GitHubSignInError('failed', error instanceof Error ? error.message : String(error))

const handlers = defineHandlers<CodeGitHubSystemContext, Event>()

/** The github asks, answered here over the sign-in this pack holds */
const answers = handlers.answers<GitHubAsks>({
  'github.GET_ACCOUNT': () => storedSignIn()?.account ?? null,

  /**
   * Signs in: tells whoever asked the code to type at GitHub, waits for them to approve it there, and answers with
   * the account, which is news for every window too (`github.ACCOUNT_CHANGED`). `signal` aborts when the asker stops
   * waiting — a cancel, or their window going — which ends the sign-in and keeps nothing
   */
  'github.SIGN_IN': async ({ signal, progress, refuse }) => {
    try {
      const code = await services.github.fetchDeviceCode(signal)
      progress({ userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt })
      const { token, scopes } = await services.github.pollForToken(code, signal)
      const account = await services.github.fetchAccount(token, signal)
      const signIn: StoredSignIn = { token, scopes, account }
      services.secrets.own.set(SECRET, JSON.stringify(signIn))
      heldSignIn = { signIn }
      logger.info(`Signed in to GitHub as ${account.login}`)
      accountChanged(account)
      return account
    } catch (error) {
      const why = signInFailureOf(error)
      if (why.reason !== 'cancelled') logger.warn(`Signing in to GitHub failed: ${why.message}`)
      throw why.reason === 'failed' ? new Error(why.message) : refuse(why.reason, why.message)
    }
  },
})

export const githubSystem = setup({
  types: {
    context: {} as CodeGitHubSystemContext,
    events: {} as Event,
  },
  actions: {
    ...answers.actions,

    signOut: () => {
      const signedIn = storedSignIn()
      services.secrets.own.delete(SECRET)
      heldSignIn = { signIn: null }
      if (signedIn) void forgetInGit(signedIn.token, services.github.endpoints.web, agentChildEnvironment(process.env))
      accountChanged(null)
    },
  },
}).createMachine({
  id: 'github',
  context: {},
  // A sign-in read by an app before this one is not this app's
  entry: () => forgetHeldSignIn(),
  on: {
    ...answers.on,
    'github.SIGN_OUT': { actions: 'signOut' },
  },
})
