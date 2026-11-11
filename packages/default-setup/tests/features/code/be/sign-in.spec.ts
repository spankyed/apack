// A remote that asks for a sign-in git does not have is refused at once, since git runs with its prompts off. The
// window that pushed is told so with what can be done about it, and where that is the GitHub CLI, has the CLI give
// git its sign-in. The remote is a real one that answers 401; the CLI is a script that records what it was asked.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';

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

/** A GitHub CLI that records each command it was given, signed in or not */
function githubCli({ signedIn }: { signedIn: boolean }) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-sign-in-gh-')));
  dirs.push(directory);
  const cli = path.join(directory, 'gh');
  fs.writeFileSync(cli, `#!/bin/sh
echo "$*" >> "$(dirname "$0")/asked"
if [ "$2" = status ] && [ ${signedIn ? 0 : 1} = 1 ]; then
  echo 'You are not logged into any GitHub hosts. To log in, run: gh auth login' >&2
  exit 1
fi
`);
  fs.chmodSync(cli, 0o755);
  featureSettings.forFeature('code').set({ path: ['cliPaths', 'gh'], value: cli });
  return () => fs.existsSync(path.join(directory, 'asked')) ? fs.readFileSync(path.join(directory, 'asked'), 'utf8').trim().split('\n') : [];
}

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

// The stand-in is a script run by its shebang, which Windows does not read
describe.skipIf(process.platform === 'win32')('taking the GitHub CLI offer', () => {
  it('has the CLI give git its sign-in for the host, once the CLI says it is signed in', async () => {
    await codeOverARemoteWantingASignIn();
    const asked = githubCli({ signedIn: true });

    const call = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

    expect((await app!.nextEmit('code', 'commit.SIGN_IN_SET_UP', { answering: call })).data).toEqual({ host: 'github.com' });
    expect(asked()).toEqual(['auth status --hostname github.com', 'auth setup-git --hostname github.com']);
  });

  it('says the CLI is not signed in, changes nothing, and leaves the offer standing', async () => {
    await codeOverARemoteWantingASignIn();
    const asked = githubCli({ signedIn: false });

    const call = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toEqual({
      message: 'GitHub CLI is not signed in to github.com. Run `gh auth login` in a terminal, then try again.',
      code: 'authentication',
      signIn: { host: 'github.com', kind: 'github-cli' },
    });
    expect(asked(), 'git\'s config was not touched').toEqual(['auth status --hostname github.com']);
  });

  // Whoever asked runs the refused command again from the answer, since what they held of it may be gone by then
  it('answers with the push or the pull the sign-in was for, set up or not', async () => {
    await codeOverARemoteWantingASignIn();
    githubCli({ signedIn: true });
    const done = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });
    expect((await app!.nextEmit('code', 'commit.SIGN_IN_SET_UP', { answering: done })).data).toEqual({ host: 'github.com', during: 'push' });

    githubCli({ signedIn: false });
    const refused = await ask({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'pull' });
    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: refused })).data).toMatchObject({ during: 'pull', signIn: { host: 'github.com', kind: 'github-cli' } });
  });

  it('runs nothing for a host that would read as an option', async () => {
    await codeOverARemoteWantingASignIn();
    const asked = githubCli({ signedIn: true });

    const call = await ask({ type: 'commit.SET_UP_SIGN_IN', host: '--help' });

    expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toMatchObject({ message: 'Not a host name: "--help"' });
    expect(asked()).toEqual([]);
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

