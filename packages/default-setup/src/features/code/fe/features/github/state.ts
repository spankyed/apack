// The app's sign-in to GitHub as a window shows it: who it is signed in as, and a sign-in under way with the code
// to type at github.com. The backend holds the token; a window holds only what it shows.
import { state } from '#generated/state.ts';
import type { GitHubAccount, GitHubSignInFailure } from '#features/code/be/services/github.ts';

export interface GitHubSignInCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface CodeGitHubData {
  /** Who the app is signed in as, `null` when it is not, and `undefined` until the backend has said */
  account: GitHubAccount | null | undefined;
  /** The code of the sign-in this window started, once GitHub has given it; `null` before, and with none under way */
  code: GitHubSignInCode | null;
  /** How the last sign-in this window started ended, when it did not end signed in */
  failure: { reason: GitHubSignInFailure; message: string } | null;
}

export type CodeGitHubEvent =
  // What a window asks
  | { type: 'github.GET_ACCOUNT' }
  | { type: 'github.SIGN_IN' }
  | { type: 'github.CANCEL_SIGN_IN' }
  | { type: 'github.SIGN_OUT' }
  // The backend's news
  | { type: 'github.ACCOUNT_CHANGED'; account: GitHubAccount | null };

type CodeGitHubShape = {
  data: CodeGitHubData;
  calls: {
    account: 'one';
  };
  states: {
    idle: {};
    signingIn: {
      calls: {
        signIn: 'one';
      };
    };
  };
};

/** The reasons a sign-in says it ended without an account; anything else it ended with is shown as a failure */
const SIGN_IN_REFUSALS: readonly string[] = ['unconfigured', 'denied', 'expired', 'cancelled'] satisfies GitHubSignInFailure[];

/**
 * Copies the code and opens GitHub's page for it in the system browser, where the user is signed in to GitHub:
 * the click on Sign in asked to go there. The window still shows both, for a browser that did not open.
 */
function handOverCode(code: { userCode: string; verificationUri: string }): void {
  const bridge = globalThis.window?.electronAPI;
  void bridge?.clipboard.writeText(code.userCode);
  void bridge?.shell.openExternal(code.verificationUri);
}

export const githubState = state<CodeGitHubShape, CodeGitHubEvent>()({
  initial: 'idle',
  data: {
    account: undefined,
    code: null,
    failure: null,
  },
  calls: ({ one }) => ({
    account: one('code', 'github.GET_ACCOUNT', {
      done: (outcome) => (outcome.ok ? { data: { account: outcome.value } } : undefined),
    }),
  }),
  on: {
    'github.SIGN_OUT': (_event, { tell }) => {
      tell('code', { type: 'github.SIGN_OUT' });
    },
    // Who the app is signed in as, read when a view of it asks: a read under way is replaced by the newer one
    'github.GET_ACCOUNT': (_event, { cancel, call }) => {
      cancel('account');
      call('account');
    },
    // Entering `signingIn` again ends the sign-in under way and starts this one
    'github.SIGN_IN': () => ({ at: 'signingIn', data: { failure: null, code: null } }),
    'github.CANCEL_SIGN_IN': (_event, { snapshot }) =>
      snapshot.at === 'signingIn' ? { at: 'idle', data: { code: null } } : undefined,
    // Another window's sign-in, or this one's, ends any this window shows
    'github.ACCOUNT_CHANGED': ({ account }, { snapshot }) =>
      snapshot.at === 'signingIn'
        ? { at: 'idle', data: { account, failure: null, code: null } }
        : { data: { account, failure: null } },
  },
  states: {
    idle: {},
    // A sign-in is under way for exactly as long as this state is: leaving it ends the sign-in on the backend
    signingIn: {
      calls: ({ one }) => ({
        signIn: one('code', 'github.SIGN_IN', {
          progress: (updates) => {
            const latest = updates.at(-1);
            if (!latest) return;
            handOverCode(latest);
            return { data: { code: latest } };
          },
          done: (outcome) => {
            if (outcome.ok) return { at: 'idle', data: { account: outcome.value, code: null } };
            const { kind, message } = outcome.failure;
            // A cancel is not a failure to show
            if (kind === 'cancelled') return { at: 'idle', data: { code: null } };
            return {
              at: 'idle',
              data: {
                code: null,
                failure: {
                  reason: SIGN_IN_REFUSALS.includes(kind) ? (kind as GitHubSignInFailure) : 'failed',
                  message,
                },
              },
            };
          },
        }),
      }),
      run: ({ call }) => {
        call('signIn');
      },
    },
  },
});
