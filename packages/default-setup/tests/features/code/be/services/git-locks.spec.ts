// A git in a terminal, or an agent's, holds a repository's index for the moments it writes it, and git refuses at
// once a write made here in those moments. The write waits for the lock to be let go of and then runs. When the
// lock is not let go of, it says plainly what holds the repository. Every case runs a real git against a real
// lock file, which is all another git's lock is.
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { GitRepository } from '../../../../../src/features/code/be/services/git.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args]);

/** A repository with one commit and an edit to `a.txt` that is not staged */
async function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-locks-')));
  directories.push(root);
  await git(root, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n');
  return { root, repo: new GitRepository(root) };
}
/** Takes a lock as another git would, optionally as one taken some time ago */
function locked(root: string, file: string, takenMsAgo = 0) {
  const lock = path.join(root, '.git', `${file}.lock`);
  fs.writeFileSync(lock, '');
  const taken = new Date(Date.now() - takenMsAgo);
  fs.utimesSync(lock, taken, taken);
  return lock;
}
type Internals = { runGit(args: string[], encoding: string): Promise<unknown>; lockPatienceMs: number };
/**
 * Counts the times git was run with these arguments, and has the other git let go once git has refused them:
 * `at once`, before the repository has looked at the lock, or `a turn later`, when it is already waiting on it
 */
function watched(repo: GitRepository, command: string[], onRefused: () => void = () => {}, when: 'at once' | 'a turn later' = 'a turn later') {
  const internals = repo as unknown as Internals;
  const runGit = internals.runGit.bind(repo);
  let runs = 0;
  vi.spyOn(internals, 'runGit').mockImplementation(async (args, encoding) => {
    if (args.join(' ') !== command.join(' ')) return runGit(args, encoding);
    runs++;
    return runGit(args, encoding).catch((error: unknown) => {
      if (runs === 1 && when === 'at once') onRefused();
      else if (runs === 1) setImmediate(onRefused);
      throw error;
    });
  });
  return () => runs;
}
const stagedFiles = async (repo: GitRepository) => (await repo.getStatus()).filter(file => file.staged).map(file => file.path);

// The other git usually lets go within moments of refusing this one: before the repository has looked at the
// lock, or just after it began to wait
it.each(['at once', 'a turn later'] as const)('stages a file once the git that held the index has let go of it, %s', async (when) => {
  const { root, repo } = await repository();
  const lock = locked(root, 'index');
  const runs = watched(repo, ['add', '--', 'a.txt'], () => fs.rmSync(lock), when);

  await repo.stageFiles(['a.txt']);

  expect(runs(), 'refused once, then run again').toBe(2);
  expect(await stagedFiles(repo)).toEqual(['a.txt']);
});

// Git lets go of the index by renaming its lock over it, and of a lock it gives up by deleting it
it('stages a file once the lock was renamed away, as git does when it has written the index', async () => {
  const { root, repo } = await repository();
  const lock = locked(root, 'index');
  fs.copyFileSync(path.join(root, '.git', 'index'), lock);
  const runs = watched(repo, ['add', '--', 'a.txt'], () => fs.renameSync(lock, path.join(root, '.git', 'index')));

  await repo.stageFiles(['a.txt']);

  expect(runs()).toBe(2);
  expect(await stagedFiles(repo)).toEqual(['a.txt']);
});

it('waits the same for a lock on a ref', async () => {
  const { root, repo } = await repository();
  const lock = locked(root, path.join('refs', 'heads', 'topic'));
  const runs = watched(repo, ['checkout', '-b', 'topic'], () => fs.rmSync(lock));

  await repo.checkoutBranch('topic');

  expect(runs(), 'making the branch was refused once, then run again').toBe(2);
  expect((await repo.readSnapshot()).branch).toBe('topic');
});

it('says what holds the repository when the lock is not let go of, and leaves the file as it was', async () => {
  const { root, repo } = await repository();
  const lock = locked(root, 'index');
  const runs = watched(repo, ['add', '--', 'a.txt']);
  (repo as unknown as Internals).lockPatienceMs = 150;

  await expect(repo.stageFiles(['a.txt'])).rejects.toThrow(`has not let go of it: ${lock} is still there`);

  expect(runs(), 'git was not run again while the lock was held').toBe(1);
  expect(fs.existsSync(lock), 'and the lock is the other git\'s to remove').toBe(true);
  fs.rmSync(lock);
  expect(await stagedFiles(repo)).toEqual([]);
});

// A lock older than the patience is not held by a git that is about to finish. Two repositories are refused at
// the same moment, one by a lock taken an hour ago and one by a lock just taken: the first is answered while
// the second is still waiting, however long either git took to run
it('gives up at once on a lock taken longer ago than it would wait', async () => {
  const [old, fresh] = await Promise.all([repository(), repository()]);
  locked(old.root, 'index', 3_600_000);
  const freshLock = locked(fresh.root, 'index');
  for (const { repo } of [old, fresh]) (repo as unknown as Internals).lockPatienceMs = 600_000;

  const waiting = fresh.repo.stageFiles(['a.txt']).then(() => 'the fresh lock was let go of');
  const refused = old.repo.stageFiles(['a.txt']).then(() => 'staged', (error: Error) => error.message);

  expect(await Promise.race([refused, waiting])).toContain('has not let go of it');

  fs.rmSync(freshLock);
  expect(await waiting).toBe('the fresh lock was let go of');
  expect(await stagedFiles(fresh.repo)).toEqual(['a.txt']);
});

// A stash is several steps to git: it saves the changes, then puts the working tree back, and it is the second
// that needs the index. Refused there, it has already stashed, and run again it would stash twice. Git's own
// refusal at that step is stood in for here, there being no way to have a real one arrive between the two
it('does not run a stash again, and says what holds the repository', async () => {
  const { root, repo } = await repository();
  const lock = path.join(root, '.git', 'index.lock');
  const internals = repo as unknown as Internals;
  const runGit = internals.runGit.bind(repo);
  let stashes = 0;
  vi.spyOn(internals, 'runGit').mockImplementation(async (args, encoding) => {
    if (args[0] !== 'stash') return runGit(args, encoding);
    stashes++;
    throw Object.assign(new Error('git stash failed'), { code: 128, stderr: `fatal: Unable to create '${lock}': File exists.\n` });
  });
  internals.lockPatienceMs = 600_000;

  await expect(repo.stashPush('work in progress')).rejects.toThrow(`has not let go of it: ${lock} is still there`);

  expect(stashes).toBe(1);
});

// Git can go on naming a lock that nothing here can see: one in a directory this process may not read, or one
// another git takes again every time it is let go of. Each look finds it gone, so only the patience ends it
it('gives up on a lock git goes on naming though nothing is there', async () => {
  const { root, repo } = await repository();
  const lock = path.join(root, '.git', 'index.lock');
  const internals = repo as unknown as Internals;
  const runGit = internals.runGit.bind(repo);
  let adds = 0;
  vi.spyOn(internals, 'runGit').mockImplementation(async (args, encoding) => {
    if (args[0] !== 'add') return runGit(args, encoding);
    adds++;
    throw Object.assign(new Error('git add failed'), { code: 128, stderr: `fatal: Unable to create '${lock}': File exists.\n` });
  });
  internals.lockPatienceMs = 100;

  await expect(repo.stageFiles(['a.txt'])).rejects.toThrow('has not let go of it');

  expect(adds, 'run again while the patience lasted').toBeGreaterThan(1);
});
