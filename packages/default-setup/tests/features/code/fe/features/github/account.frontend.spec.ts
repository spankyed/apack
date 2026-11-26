// The GitHub sign-in as it is drawn: the code GitHub gave is said to be copied only once that code is.
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { state, system, type AnyEvent } from '@apackdev/state';
import { provide as providePackState } from '#generated/state-fe.ts';

const { default: GitHubAccount } = await import('#features/code/fe/features/github/GitHubAccount.vue');

const CODE_SURFACE = 'default-setup/code';
type FakeGithubEvent = { type: 'test.CODE'; userCode: string } | { type: 'github.GET_ACCOUNT' };
let app: App | undefined;
let sys: ReturnType<typeof system> | undefined;
let sendGithub: ((ev: FakeGithubEvent) => void) | undefined;

afterEach(() => {
  app?.unmount();
  sys?.stop();
  app = undefined;
  sys = undefined;
  sendGithub = undefined;
  delete (window as { electronAPI?: unknown }).electronAPI;
  document.body.replaceChildren();
});

const codeOf = (userCode: string) => ({ userCode, verificationUri: 'https://github.com/login/device', expiresAt: 0 });

/** The account form, over a sign-in GitHub has given `userCode` for */
async function account(userCode: string) {
  const fakeGithub = state<{
    data: { account: null; code: ReturnType<typeof codeOf>; failure: null };
    states: { signingIn: {} };
  }, FakeGithubEvent>()({
    initial: 'signingIn',
    data: { account: null, code: codeOf(userCode), failure: null },
    states: { signingIn: {} },
    on: {
      'test.CODE': ({ userCode: nextCode }) => ({ data: { code: codeOf(nextCode) } }),
      'github.GET_ACCOUNT': () => {},
    },
  });
  const fakeCode = state<{ starts: { github: typeof fakeGithub } }, AnyEvent>()({
    starts: () => ({ github: fakeGithub }),
  });

  sys = system({ side: 'window' });
  const codeHandle = sys.start(CODE_SURFACE, fakeCode);
  const githubHandle = sys.child(codeHandle, 'github');
  sendGithub = (ev) => sys!.send(githubHandle, ev);

  (window as { electronAPI?: unknown }).electronAPI = { clipboard: { writeText: vi.fn(async () => true) }, shell: { openExternal: vi.fn() } };

  app = createApp({ render: () => h(GitHubAccount) });
  providePackState(app, sys);
  app.mount(document.body.appendChild(document.createElement('div')));
  await nextTick();
}

const copyButton = () => [...document.querySelectorAll('button')].find((b) => ['Copy', 'Copied'].includes(b.textContent!.trim()))!;

it('says Copied for the code copied, and Copy again for the next code GitHub gives', async () => {
  await account('AAAA-1111');
  copyButton().click();
  // The copy is answered by the clipboard's promise, and drawn on the tick after
  await Promise.resolve();
  await nextTick();
  expect(copyButton().textContent!.trim()).toBe('Copied');

  sendGithub!({ type: 'test.CODE', userCode: 'BBBB-2222' });
  await nextTick();
  await nextTick();

  expect(document.body.textContent).toContain('BBBB-2222');
  expect(copyButton().textContent!.trim()).toBe('Copy');
});
