// The app's sign-in to GitHub as a window shows it: who it is signed in as, and a sign-in under way with the code
// to type at github.com. The backend holds the token; a window holds only what it shows.
import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate'
import { answerOf, answersCall, isAnswered, newCall, type AnswersOf } from '@apackdev/sdk/events'
import { sendToSystem } from '#generated/events.ts'
import type { Contract as CodeSystemContract } from '#features/code/be/contract.ts'
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
  | AnswersOf<CodeSystemContract, 'github.GET_ACCOUNT' | 'github.SIGN_IN'>
  | { type: 'github.SIGN_IN_FAILED'; userCode: string; reason: GitHubSignInFailure; message: string }
  | { type: 'github.ACCOUNT_CHANGED'; account: GitHubAccount | null }

export const githubState = setup({
  types: {
    context: {} as CodeGitHubContext,
    events: {} as Event,
  },
  guards: {
    /** A sign-in ending that is of the one this window shows: the one it was given that code for */
    endsTheSignInShown: ({ context, event }) =>
      event.type === 'github.SIGN_IN_FAILED' && context.signIn?.code?.userCode === event.userCode,
  },
  actions: {
    /**
     * Copies the code and opens GitHub's page for it in the system browser, where the user is signed in to GitHub:
     * the click on Sign in asked to go there. The window still shows both, for a browser that did not open
     */
    handOverCode: (_, code: { userCode: string; verificationUri: string }) => {
      const bridge = globalThis.window?.electronAPI
      void bridge?.clipboard.writeText(code.userCode)
      void bridge?.shell.openExternal(code.verificationUri)
    },
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

    ASK_ANSWERED: [
      { guard: ({ event }) => isAnswered(event, 'github.GET_ACCOUNT'), actions: assign({ account: ({ event }) => answerOf(event, 'github.GET_ACCOUNT') }) },
      {
        guard: ({ context, event }) => isAnswered(event, 'github.SIGN_IN') && answersCall(event, context.signInAsk),
        actions: [
          assign({ signIn: ({ event }) => ({ code: answerOf(event, 'github.SIGN_IN') }) }),
          { type: 'handOverCode', params: ({ event }) => answerOf(event, 'github.SIGN_IN') },
        ],
      },
    ],
    // A cancel is not a failure to show
    ASK_FAILED: {
      guard: ({ context, event }) => event.asked === 'github.SIGN_IN' && answersCall(event, context.signInAsk),
      actions: assign({
        signIn: () => null,
        signInAsk: () => null,
        failure: ({ event }) => event.failure.kind === 'cancelled' ? null : { reason: event.failure.kind === 'unavailable' ? 'failed' : event.failure.kind, message: event.failure.message },
      }),
    },
    'github.SIGN_IN_FAILED': {
      guard: 'endsTheSignInShown',
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
