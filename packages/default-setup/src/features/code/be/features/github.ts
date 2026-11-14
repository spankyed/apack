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

const logger = createLogger('github')

/** The name the token is kept under, among this pack's own secrets */
const SECRET = 'github'

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

/** The sign-in this pack holds, or `null`. One that cannot be read is no sign-in, which is said in the log */
export function storedSignIn(): StoredSignIn | null {
  try {
    const stored = services.secrets.own.get(SECRET)
    return stored === undefined ? null : JSON.parse(stored) as StoredSignIn
  } catch (error) {
    logger.warn('The GitHub sign-in could not be read; sign in again', { error: error instanceof Error ? error.message : String(error) })
    return null
  }
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
        services.secrets.own.set(SECRET, JSON.stringify({ token, scopes, account } satisfies StoredSignIn))
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
      services.secrets.own.delete(SECRET)
      accountChanged(null)
    },
  }),
}).createMachine({
  id: 'github',
  context: () => ({ held: {} }),
  on: {
    'github.GET_ACCOUNT': { actions: 'tellAccount' },
    'github.SIGN_IN': { actions: 'signIn' },
    'github.CANCEL_SIGN_IN': { actions: 'cancelSignIn' },
    'github.SIGN_OUT': { actions: 'signOut' },
  },
})
