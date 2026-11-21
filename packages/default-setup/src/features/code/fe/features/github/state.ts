// The app's sign-in to GitHub as a window shows it: who it is signed in as, and a sign-in under way with the code
// to type at github.com. The backend holds the token; a window holds only what it shows.
import { setup, assign, spawnChild, stopChild, type ActorRefFrom, type DoneActorEvent } from 'xstate'
import type { AskOutcome, ProgressEventOf } from '@apackdev/sdk/events'
import { fromAsk, sendToSystem } from '#generated/events.ts'
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
  /** The code of the sign-in this window started, once GitHub has given it; `null` before, and with none under way */
  code: GitHubSignInCode | null
  /** How the last sign-in this window started ended, when it did not end signed in */
  failure: { reason: GitHubSignInFailure; message: string } | null
}

/** The id the read of the account is spawned under */
const ACCOUNT = 'account'

export type Event =
  // What a window asks
  | { type: 'github.GET_ACCOUNT' }
  | { type: 'github.SIGN_IN' }
  | { type: 'github.CANCEL_SIGN_IN' }
  | { type: 'github.SIGN_OUT' }
  // What the sign-in under way says before it ends: the code to type at GitHub
  | ProgressEventOf<CodeSystemContract, 'github.SIGN_IN'>
  // How this window's read of the account ended
  | DoneActorEvent<AskOutcome<CodeSystemContract['asks']['github.GET_ACCOUNT']>, typeof ACCOUNT>
  // The backend's news
  | { type: 'github.ACCOUNT_CHANGED'; account: GitHubAccount | null }

/** The reasons a sign-in says it ended without an account; anything else it ended with is shown as a failure */
const SIGN_IN_REFUSALS: readonly string[] = ['unconfigured', 'denied', 'expired', 'cancelled'] satisfies GitHubSignInFailure[]

export const githubState = setup({
  types: {
    context: {} as CodeGitHubContext,
    events: {} as Event,
  },
  actors: {
    readAccount: fromAsk('code', 'github.GET_ACCOUNT'),
    signIn: fromAsk('code', 'github.SIGN_IN'),
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
  initial: 'idle',
  context: { account: undefined, code: null, failure: null },
  on: {
    'github.SIGN_OUT': { actions: () => { sendToSystem('code', { type: 'github.SIGN_OUT' }) } },
    // Who the app is signed in as, read when a view of it asks: a read under way is replaced by the newer one
    'github.GET_ACCOUNT': { actions: [stopChild(ACCOUNT), spawnChild('readAccount', { id: ACCOUNT, input: {} })] },
    [`xstate.done.actor.${ACCOUNT}`]: {
      actions: [stopChild(ACCOUNT), assign({ account: ({ context, event }) => event.output.ok ? event.output.value : context.account })],
    },
    // Entering `signingIn` again ends the sign-in under way and starts this one
    'github.SIGN_IN': { target: '.signingIn', reenter: true, actions: assign({ failure: null }) },
    'github.CANCEL_SIGN_IN': { target: '.idle' },
    // Another window's sign-in, or this one's, ends any this window shows
    'github.ACCOUNT_CHANGED': { target: '.idle', actions: assign({ account: ({ event }) => event.account, failure: null }) },
  },
  states: {
    idle: {},
    // A sign-in is under way for exactly as long as this state is: leaving it ends the sign-in on the backend
    signingIn: {
      invoke: {
        src: 'signIn',
        input: {},
        onDone: {
          target: 'idle',
          actions: assign(({ event: { output } }) => {
            if (output.ok) return { account: output.value }
            const { kind, message } = output.failure
            // A cancel is not a failure to show
            if (kind === 'cancelled') return {}
            return { failure: { reason: SIGN_IN_REFUSALS.includes(kind) ? kind as GitHubSignInFailure : 'failed', message } }
          }),
        },
      },
      exit: assign({ code: null }),
      on: {
        'github.SIGN_IN.progress': {
          actions: [
            assign({ code: ({ event }) => event.update }),
            { type: 'handOverCode', params: ({ event }) => event.update },
          ],
        },
      },
    },
  },
})

export type CodeGitHubActor = ActorRefFrom<typeof githubState>
