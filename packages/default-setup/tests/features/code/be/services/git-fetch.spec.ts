// Fetching is never part of answering what a repository holds: a read answers from what is here, and what the
// remote has is fetched behind it when one is due. Every case runs a real git against a remote on disk.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { APP_TIES, AppGitRepository } from '../../../../../src/features/code/be/services/app-git-repository.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args])).stdout.trim();
function scratch(prefix: string): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  directories.push(directory);
  return directory;
}

/** A clone whose remote has one commit the clone has not fetched */
async function cloneBehindItsRemote() {
  const origin = scratch('apack-fetch-origin-');
  await git(origin, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(origin, 'a.txt'), 'one\n');
  await git(origin, 'add', '.');
  await git(origin, 'commit', '--quiet', '-m', 'first');
  const clone = `${origin}-clone`;
  directories.push(clone);
  await execFileWhileWorking('git', ['clone', '--quiet', origin, clone]);
  fs.writeFileSync(path.join(origin, 'a.txt'), 'two\n');
  await git(origin, 'commit', '--quiet', '-am', 'second');
  return new AppGitRepository(clone);
}

it('answers a read from what is here, and fetches only when asked to and one is due', async () => {
  const repo = await cloneBehindItsRemote();
  repo.setFetchConfig(true, 180);

  expect(await repo.readSnapshot(), 'a read fetches nothing').toMatchObject({ hasUpstream: true, behind: 0 });
  expect(await repo.fetchIfDue()).toBe(true);
  expect(await repo.readSnapshot()).toMatchObject({ behind: 1 });
  expect(await repo.fetchIfDue(), 'the interval has not passed').toBe(false);

  repo.forceFetchOnce();
  expect(await repo.fetchIfDue(), 'a forced fetch does not wait for the interval').toBe(true);
});

it('fetches nothing by itself unless the settings ask for it', async () => {
  const repo = await cloneBehindItsRemote();
  repo.setFetchConfig(false, 0);
  expect(await repo.fetchIfDue()).toBe(false);
  expect(await repo.readSnapshot()).toMatchObject({ behind: 0 });
});

it('stops fetching by itself once the remote wants credentials, until the settings are changed', async () => {
  const root = scratch('apack-fetch-auth-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'first');
  // A remote that answers every fetch as a server refusing credentials does, and counts how often it was asked
  const remote = path.join(root, 'remote.sh');
  fs.writeFileSync(remote, `echo asked >> "${root}/asked"\necho "fatal: Authentication failed for 'https://example.invalid/repo.git/'" >&2\nexit 128\n`);
  await git(root, 'config', 'protocol.ext.allow', 'always');
  await git(root, 'remote', 'add', 'origin', `ext::sh ${remote}`);
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(root, 'branch', '--quiet', '--set-upstream-to=origin/main');
  const asked = () => fs.existsSync(path.join(root, 'asked')) ? fs.readFileSync(path.join(root, 'asked'), 'utf8').trim().split('\n').length : 0;

  // Trusted: its remote is a program of this case's own, which git is to run
  const repo = new AppGitRepository(root, { ...APP_TIES, isTrusted: () => true });
  repo.setFetchConfig(true, 0);
  await repo.refreshSnapshot();
  expect(await repo.fetchIfDue(), 'the fetch failed').toBe(false);
  expect(asked()).toBe(1);
  // That it has stopped is something a window shows, so it is part of the status a check compares
  expect(repo.isAutoFetchSuspended).toBe(true);
  expect(await repo.refreshSnapshot()).toMatchObject({ status: true, history: false });

  expect(await repo.fetchIfDue()).toBe(false);
  expect(asked(), 'it was not tried again').toBe(1);

  // Every write to the feature's settings hands the fetch settings on, the same ones included
  repo.setFetchConfig(true, 0);
  expect(repo.isAutoFetchSuspended, 'the same settings arriving again are no one saying to try again').toBe(true);
  expect(await repo.fetchIfDue()).toBe(false);
  expect(asked()).toBe(1);

  // Turned off and on again
  repo.setFetchConfig(false, 0);
  repo.setFetchConfig(true, 0);
  expect(repo.isAutoFetchSuspended).toBe(false);
  expect(await repo.refreshSnapshot(), 'and that it may try again is said too').toMatchObject({ status: true });
  await repo.fetchIfDue();
  expect(asked(), 'changing the settings tries again').toBe(2);
});
