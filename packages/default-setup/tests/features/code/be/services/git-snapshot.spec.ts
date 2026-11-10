// What the commit panel shows of a checkout is one read of git, and "did the repository change" is that read
// compared with the last. Every case runs a real git, since what is being held is how git's own output is read.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { GitRepository } from '../../../../../src/features/code/be/services/git.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args]);
const write = (root: string, file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

/** A repository on `main` with one commit holding `kept.txt`, `gone.txt` and `old name.txt` */
async function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-snapshot-')));
  directories.push(root);
  await git(root, 'init', '--quiet', '--initial-branch=main');
  write(root, 'kept.txt', 'one\n');
  write(root, 'gone.txt', 'here\n');
  write(root, 'old name.txt', 'a file that will be renamed, long enough for git to follow it\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'first');
  return { root, repo: new GitRepository(root) };
}

it('reads every kind of change, with paths that hold spaces and each untracked file by name', async () => {
  const { root, repo } = await repository();
  write(root, 'kept.txt', 'one\ntwo\n');
  fs.rmSync(path.join(root, 'gone.txt'));
  await git(root, 'mv', 'old name.txt', 'new name.txt');
  write(root, 'staged.txt', 'new\n');
  await git(root, 'add', 'staged.txt');
  write(root, 'fresh/deep/a.txt', '');
  write(root, 'fresh/b.txt', '');

  const { files, branch, hasUpstream } = await repo.readSnapshot();
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  expect([...files].sort(byPath)).toEqual([
    { path: 'fresh/b.txt', status: 'untracked', staged: false },
    { path: 'fresh/deep/a.txt', status: 'untracked', staged: false },
    { path: 'gone.txt', status: 'deleted', staged: false, originalPath: undefined },
    { path: 'kept.txt', status: 'modified', staged: false, originalPath: undefined },
    { path: 'new name.txt', status: 'renamed', staged: true, originalPath: 'old name.txt' },
    { path: 'staged.txt', status: 'added', staged: true, originalPath: undefined },
  ]);
  expect(branch).toBe('main');
  expect(hasUpstream).toBe(false);
});

it('reads a file changed in the index and again in the working tree as both', async () => {
  const { root, repo } = await repository();
  write(root, 'kept.txt', 'staged\n');
  await git(root, 'add', 'kept.txt');
  write(root, 'kept.txt', 'staged, then edited\n');
  expect((await repo.readSnapshot()).files).toEqual([
    { path: 'kept.txt', status: 'modified', staged: true, originalPath: undefined },
    { path: 'kept.txt', status: 'modified', staged: false, originalPath: undefined },
  ]);
});

it('reads a conflict as one row that is not staged', async () => {
  const { root, repo } = await repository();
  await git(root, 'checkout', '--quiet', '-b', 'other');
  write(root, 'kept.txt', 'theirs\n');
  await git(root, 'commit', '--quiet', '-am', 'theirs');
  await git(root, 'checkout', '--quiet', 'main');
  write(root, 'kept.txt', 'ours\n');
  await git(root, 'commit', '--quiet', '-am', 'ours');
  await git(root, 'merge', '--quiet', 'other').catch(() => {});
  expect((await repo.readSnapshot()).files).toEqual([{ path: 'kept.txt', status: 'unmerged', staged: false }]);
});

it('names the branch of a repository with no commit yet, and HEAD when none is checked out', async () => {
  const unborn = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-snapshot-unborn-')));
  directories.push(unborn);
  await git(unborn, 'init', '--quiet', '--initial-branch=trunk');
  expect((await new GitRepository(unborn).readSnapshot()).branch).toBe('trunk');

  const { root, repo } = await repository();
  await git(root, 'checkout', '--quiet', '--detach');
  expect((await repo.readSnapshot()).branch).toBe('HEAD');
});

it('counts the commits a branch is ahead of and behind the remote branch it tracks', async () => {
  const { root } = await repository();
  const clone = `${root}-clone`;
  directories.push(clone);
  await execFileWhileWorking('git', ['clone', '--quiet', root, clone]);
  write(root, 'kept.txt', 'moved on\n');
  await git(root, 'commit', '--quiet', '-am', 'second');
  await git(clone, 'fetch', '--quiet');
  write(clone, 'local.txt', '');
  await git(clone, 'add', '.');
  await git(clone, 'commit', '--quiet', '-m', 'local');

  expect(await new GitRepository(clone).readSnapshot()).toMatchObject({ hasUpstream: true, ahead: 1, behind: 1 });
});

it('says the repository changed when its status or a ref did, and not otherwise', async () => {
  const { root, repo } = await repository();
  await repo.readSnapshot();
  expect(await repo.refreshSnapshot(), 'nothing happened').toBe(false);

  write(root, 'kept.txt', 'edited\n');
  expect(await repo.refreshSnapshot(), 'a file was edited').toBe(true);
  expect(await repo.refreshSnapshot()).toBe(false);

  // The status is the same; only a ref moved
  await git(root, 'branch', 'side');
  expect(await repo.refreshSnapshot(), 'a branch was made').toBe(true);
});

it('reuses a snapshot only while a watcher reports the checkout, and reads again once told it may have changed', async () => {
  const { root, repo } = await repository();
  const paths = async () => (await repo.readSnapshot()).files.map(file => file.path);

  expect(await paths()).toEqual([]);
  write(root, 'unseen.txt', '');
  expect(await paths(), 'nothing watches, so git is asked').toEqual(['unseen.txt']);

  repo.setWatched(true);
  expect(await paths()).toEqual(['unseen.txt']);
  write(root, 'later.txt', '');
  expect(await paths(), 'the watcher has reported nothing').toEqual(['unseen.txt']);
  repo.markSnapshotStale();
  expect(await paths()).toEqual(['later.txt', 'unseen.txt']);
});

it('lists the directories git ignores, and no ignored file', async () => {
  const { root, repo } = await repository();
  write(root, '.gitignore', 'out/\n*.log\n');
  write(root, 'out/bundle.js', '');
  write(root, 'debug.log', '');
  expect(await repo.listIgnoredDirectories()).toEqual(['out']);
});
