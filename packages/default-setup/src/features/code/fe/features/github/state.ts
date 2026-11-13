// The app's sign-in to GitHub as a window shows it: who it is signed in as, and a sign-in under way with the code
// to type at github.com. The backend holds the token; a window holds only what it shows.
import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate'
import { answersCall, newCall } from '@apackdev/sdk/events'
import { sendToSystem } from '#generated/events.ts'
import type { GitHubAccount, GitHubSignInFailure } from '#features/code/be/services/github.ts'

export interface GitHubSignInCode {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface CodeGitHubContext {
  /** Who the app is signed in as, `null` when it is not, and `undefined` until the backend has said */
  account: GitHubAccount | null | undefined
  /** The sign-in this window started and is showing the code of */
  signIn: { code?: GitHubSignInCode } | null
  /**
   * The call that sign-in was asked with. Starting another ends this one, whose ending then arrives as an answer
   * to an ask nobody is waiting on: only the answers to this call are this window's to show
   */
  signInAsk: string | null
  /** How the last sign-in this window started ended, when it did not end signed in */
  failure: { reason: GitHubSignInFailure; message: string } | null
}

export type Event =
  // What a window asks
  | { type: 'github.GET_ACCOUNT' }
  | { type: 'github.SIGN_IN' }
  | { type: 'github.CANCEL_SIGN_IN' }
  | { type: 'github.SIGN_OUT' }
  // What the backend answers, and its news
  | { type: 'github.ACCOUNT'; account: GitHubAccount | null }
  | { type: 'github.SIGN_IN_CODE'; userCode: string; verificationUri: string; expiresAt: number }
  | { type: 'github.SIGN_IN_FAILED'; reason: GitHubSignInFailure; message: string }
  | { type: 'github.ACCOUNT_CHANGED'; account: GitHubAccount | null }

export const githubState = setup({
  types: {
    context: {} as CodeGitHubContext,
    events: {} as Event,
  },
  guards: {
    answersTheSignIn: ({ context, event }) => answersCall(event, context.signInAsk),
  },
}).createMachine({
  id: 'github',
  context: { account: undefined, signIn: null, signInAsk: null, failure: null },
  on: {
    'github.GET_ACCOUNT': { actions: () => { sendToSystem('code', { type: 'github.GET_ACCOUNT' }) } },
    'github.SIGN_IN': {
      actions: enqueueActions(({ enqueue }) => {
        const call = newCall()
        enqueue.assign({ signIn: {}, signInAsk: call, failure: null })
        enqueue(() => { sendToSystem('code', { type: 'github.SIGN_IN' }, { call }) })
      }),
    },
    'github.CANCEL_SIGN_IN': {
      actions: [
        assign({ signIn: () => null, signInAsk: () => null }),
        () => { sendToSystem('code', { type: 'github.CANCEL_SIGN_IN' }) },
      ],
    },
    'github.SIGN_OUT': { actions: () => { sendToSystem('code', { type: 'github.SIGN_OUT' }) } },

    'github.ACCOUNT': { actions: assign({ account: ({ event }) => event.account }) },
    'github.SIGN_IN_CODE': {
      guard: 'answersTheSignIn',
      actions: assign({ signIn: ({ event }) => ({ code: { userCode: event.userCode, verificationUri: event.verificationUri, expiresAt: event.expiresAt } }) }),
    },
    // A cancel is not a failure to show
    'github.SIGN_IN_FAILED': {
      guard: 'answersTheSignIn',
      actions: assign({
        signIn: () => null,
        signInAsk: () => null,
        failure: ({ event }) => event.reason === 'cancelled' ? null : { reason: event.reason, message: event.message },
      }),
    },
    // Another window's sign-in, or this one's, ends any this window shows
    'github.ACCOUNT_CHANGED': { actions: assign({ account: ({ event }) => event.account, signIn: () => null, signInAsk: () => null, failure: () => null }) },
  },
})

export type CodeGitHubActor = ActorRefFrom<typeof githubState>
