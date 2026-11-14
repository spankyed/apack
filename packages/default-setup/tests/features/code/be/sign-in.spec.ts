// A remote that asks for a sign-in git does not have is refused at once, since git runs with its prompts off. The
// window that pushed is told so with what can be done about it, and where that is signing in to GitHub, is told
// git can sign in once the app has. The remote is a real one that answers 401.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { services } from '#generated/services.ts';

const CODE = 'default-setup/code';
const dirs: string[] = [];
const servers: http.Server[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const server of servers.splice(0)) await new Promise((closed) => { server.close(closed); server.closeAllConnections(); });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

/** The code system over a repository whose remote answers every request as one wanting a sign-in */
async function codeOverARemoteWantingASignIn() {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="spec"' }).end();
  });
  servers.push(server);
  await new Promise<void>((listening) => { server.listen(0, '127.0.0.1', listening); });
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-sign-in-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'credential.helper', '');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await git(directory, 'remote', 'add', 'origin', `http://127.0.0.1:${(server.address() as AddressInfo).port}/repo.git`);
  app = await startApp({ systems: ['code', 'host/settings'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
}

/** The app signed in to GitHub, as its sign-in leaves it: the pack's own secret */
const signedIn = () => services.secrets.own.set('github', JSON.stringify({ token: 'gho_token', scopes: ['repo'], account: { login: 'octocat' } }));

const ask = (event: { type: string; host?: string; during?: 'push' | 'pull' }) => app!.send('code', event, { sender: CODE, client: 'c-main' });

it('tells the window that pushed why the push failed, that it can be run again, and what sign-in is missing', async () => {
  await codeOverARemoteWantingASignIn();

  const call = await ask({ type: 'commit.PUBLISH_BRANCH' });

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toEqual({
    message: 'Failed to push: The remote asked for a sign-in that git does not have.',
    code: 'authentication',
    during: 'push',
    signIn: { host: '127.0.0.1', kind: 'https' },
  });
});

describe('taking the offer to sign in to GitHub', () => {
  it('says git can sign in, once the app is signed in to GitHub, with the push or the pull it was for', async () => {
    await codeOverARemoteWantingASignIn();
    signedIn();

    const call = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });

    expect((await app!.nextEmit('code', 'commit.SIGN_IN_SET_UP', { answering: call })).data).toEqual({ host: 'github.com', during: 'push' });
  });

  it('leaves the offer standing while the app is not signed in, with the pull it was for', async () => {
    await codeOverARemoteWantingASignIn();

    const call = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'pull' });

    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toEqual({
      message: 'Sign in to GitHub to give git a sign-in for github.com.',
      code: 'authentication',
      during: 'pull',
      signIn: { host: 'github.com', kind: 'github' },
    });
  });

  it('takes nothing for a host that would read as an option, or one that is not GitHub', async () => {
    await codeOverARemoteWantingASignIn();
    signedIn();

    const option = await ask({ type: 'commit.SET_UP_SIGN_IN', host: '--help' });
    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: option })).data).toMatchObject({ message: 'Not a host name: "--help"' });
    const elsewhere = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'gitlab.com' });
    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: elsewhere })).data).toEqual({ message: 'The app signs git in to GitHub, not to gitlab.com.' });
  });
});

// A push that works says how far along it is to the window that asked, before it says it is done
it('tells the window that pushed how far along the push is', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-progress-')));
  const remote = `${directory}-remote`;
  dirs.push(directory, remote);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await execFileWhileWorking('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  await git(directory, 'remote', 'add', 'origin', remote);
  app = await startApp({ systems: ['code', 'host/settings'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const call = await ask({ type: 'commit.PUBLISH_BRANCH' });

  await app.nextEmit('code', 'commit.BRANCH_PUSHED', { answering: call });
  const progress = app.emitted('code').filter(event => event.type === 'commit.PROGRESS').map(event => event.data as { during: string; stage: string; percent: number });
  expect(progress.at(-1)).toEqual({ during: 'push', stage: 'Writing objects', percent: 100 });
});

