// Signing in to GitHub as a window does it, through the code system, against a stand-in for GitHub on this machine:
// the window that asked is told the code and then the account, the token is kept as this pack's own secret, every
// window is told the account, and signing out forgets it, asking git's credential helpers to forget it too. That no other pack can
// read the secret is the host's binding, held in `@apackdev/host`'s secrets specs.
//
// Git is run here with a home of its own, whose `.gitconfig` is its user config, and no system configuration, so the
// helpers it asks are only the ones a case names: this machine's own credential store is never asked to erase anything.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness';
import { createGitHubSignIn } from '#features/code/be/services/github.ts';
import { forgetInGit, storedSignIn } from '#features/code/be/features/github.ts';
import { startGitHubStandIn, STAND_IN_TOKEN } from './_support/github-stand-in.ts';

/** A home whose git asks one credential helper, which writes down each thing it is asked to `erase` */
function homeWithHelper() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'github-sign-out-home-')));
  dirs.push(home);
  const erased = path.join(home, 'erased');
  fs.writeFileSync(path.join(home, '.gitconfig'), `[credential]\n\thelper = "!f() { test \\"$1\\" = erase && cat >> '${erased}'; }; f"\n`);
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  return { environment, erased: () => fs.existsSync(erased) ? fs.readFileSync(erased, 'utf8') : '' };
}

const dirs: string[] = [];
let helper: ReturnType<typeof homeWithHelper>;
beforeEach(() => {
  // What the app runs git with is its own process's environment: here, the home above
  helper = homeWithHelper();
  for (const [name, value] of Object.entries(helper.environment)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const asWindow = { client: 'c-main' };
const stops: Array<() => Promise<void>> = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  for (const stop of stops.splice(0)) await stop();
  resetTestData();
});

it('tells the asker the code and then the account, keeps the token as its own secret, tells every window the account, and forgets it on sign-out', async () => {
  const standIn = await startGitHubStandIn({ tokenAnswers: [{ error: 'authorization_pending' }, { access_token: STAND_IN_TOKEN, scope: 'repo,workflow' }] });
  stops.push(standIn.close);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait: async () => {} }));
  app = await startApp({ systems: ['code'] });
  await app.connect();

  expect(await app.ask('code', { type: 'github.GET_ACCOUNT' }, asWindow)).toEqual({ ok: true, value: null });

  const changed = app.nextEmit('code', 'github.ACCOUNT_CHANGED');
  const heard: unknown[] = [];
  expect(await app.ask('code', { type: 'github.SIGN_IN' }, { ...asWindow, heard: update => { heard.push(update) } })).toMatchObject({ ok: true, value: { login: 'octocat' } });
  expect(heard, 'the code comes before the account, for the asker to type at GitHub').toMatchObject([{ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }]);
  expect((await changed).account).toMatchObject({ login: 'octocat' });

  expect(storedSignIn()).toMatchObject({ token: STAND_IN_TOKEN, scopes: ['repo', 'workflow'], account: { login: 'octocat' } });
  expect(await app.ask('code', { type: 'github.GET_ACCOUNT' }, asWindow)).toMatchObject({ ok: true, value: { login: 'octocat' } });

  await app.send('code', { type: 'github.SIGN_OUT' }, asWindow);
  expect((await app.nextEmit('code', 'github.ACCOUNT_CHANGED')).account).toBeNull();
  expect(storedSignIn()).toBeNull();
});

it('has git forget the token through the helpers of the environment it is given, and no other', async () => {
  const elsewhere = homeWithHelper();

  await forgetInGit('gho_forgotten', 'https://github.com', elsewhere.environment);

  expect(elsewhere.erased()).toContain('password=gho_forgotten');
  expect(elsewhere.erased()).toContain('host=github.com');
  expect(helper.erased(), "the app's own environment's helpers are not asked").toBe('');
});

it('tells the asker why a sign-in ended without an account, and keeps nothing', async () => {
  const standIn = await startGitHubStandIn({ tokenAnswers: [{ error: 'access_denied' }] });
  stops.push(standIn.close);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait: async () => {} }));
  app = await startApp({ systems: ['code'] });
  await app.connect();

  const heard: unknown[] = [];
  const asked = await app.ask('code', { type: 'github.SIGN_IN' }, { ...asWindow, heard: update => { heard.push(update) } });

  expect(heard).toMatchObject([{ userCode: 'ABCD-1234' }]);
  expect(asked, 'the asker given the code is told how its sign-in ended').toMatchObject({ ok: false, failure: { kind: 'denied' } });
  expect(storedSignIn()).toBeNull();
});

it('ends a sign-in whose asker stops waiting, and keeps nothing', async () => {
  const standIn = await startGitHubStandIn({ tokenAnswers: [{ error: 'authorization_pending' }] });
  stops.push(standIn.close);
  // GitHub is asked again only once the wait between two polls ends, which here is when the asker stops
  const waits: AbortSignal[] = [];
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait: (_ms, signal) => new Promise((_resolve, reject) => {
    waits.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }));
  app = await startApp({ systems: ['code'] });
  await app.connect();

  const stopping = new AbortController();
  const asked = app.ask('code', { type: 'github.SIGN_IN' }, { ...asWindow, signal: stopping.signal });
  await vi.waitFor(() => expect(waits).toHaveLength(1));

  stopping.abort(new Error('the window cancelled'));
  await expect(asked).rejects.toThrow('the window cancelled');
  await vi.waitFor(() => expect(waits[0].aborted).toBe(true));
  expect(storedSignIn()).toBeNull();
});
