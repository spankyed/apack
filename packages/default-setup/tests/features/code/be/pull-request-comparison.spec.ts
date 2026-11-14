// A pull request's changes as the panel compares them, over a real bare remote serving the pull request's ref as
// GitHub does, driven through the code system as a window drives it: a file's original side is where the branch
// left its base, so what the base did since is not shown as undone; a base the checkout has only on the remote is
// compared with; the remote the branch follows is the one fetched from, whatever it is called; and opening a file
// fetches nothing, the comparison having fetched once.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const asWindow = { sender: CODE, client: 'c-main' };
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();

const commit = async (cwd: string, file: string, content: string, message: string) => {
  fs.writeFileSync(path.join(cwd, file), content);
  await git(cwd, 'add', '.');
  await git(cwd, 'commit', '--quiet', '-m', message);
};

/**
 * A remote whose `main` has `a.txt`, and pull request #1 from `feature`, which changes it; `main` then moves on and
 * changes it too. The checkout is cloned after, its remote called `remote`; `prepare` shapes it before the code
 * system opens it
 */
async function pullRequestOver({ remote: remoteName = 'origin', initialBranch = 'main', prepare }: { remote?: string; initialBranch?: string; prepare?: (checkout: string) => Promise<unknown> } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-comparison-')));
  dirs.push(root);
  const remote = path.join(root, 'remote.git');
  const author = path.join(root, 'author');
  const checkout = path.join(root, 'checkout');
  await execFileWhileWorking('git', ['init', '--quiet', '--bare', `--initial-branch=${initialBranch}`, remote]);
  await execFileWhileWorking('git', ['init', '--quiet', `--initial-branch=${initialBranch}`, author]);
  await commit(author, 'a.txt', 'one\n', 'first');
  await git(author, 'remote', 'add', 'origin', remote);
  await git(author, 'checkout', '--quiet', '-b', 'feature');
  await commit(author, 'a.txt', 'one\nfeature\n', 'the feature');
  await git(author, 'checkout', '--quiet', initialBranch);
  await commit(author, 'a.txt', 'zero\none\n', 'the base moves on');
  await git(author, 'push', '--quiet', 'origin', initialBranch, 'feature', 'feature:refs/pull/1/head');
  await execFileWhileWorking('git', ['clone', '--quiet', '-o', remoteName, remote, checkout]);
  await prepare?.(checkout);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: checkout });
  await app.settle();
  return { running: app, remote, root };
}

const ask = async (running: NonNullable<typeof app>, event: { type: string; [key: string]: unknown }, answeredWith: string): Promise<Record<string, any>> =>
  running.nextEmit('code', answeredWith, { answering: await running.send('code', event, asWindow) });

const pr = { baseBranch: 'main', headBranch: 'feature', prNumber: 1 };

it('reads a file\'s original side where the branch left its base, so what the base did since is not shown as undone', async () => {
  const { running } = await pullRequestOver();

  expect((await ask(running, { type: 'pr.GET_BRANCH_DIFF', ...pr }, 'pr.BRANCH_DIFF_RECEIVED')).data.files).toEqual([expect.objectContaining({ path: 'a.txt' })]);
  expect((await ask(running, { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'a.txt', ...pr }, 'pr.FILE_DIFF_RECEIVED')).data)
    .toMatchObject({ originalContent: 'one\n', modifiedContent: 'one\nfeature\n' });
});

it('compares with a base the checkout has only on the remote', async () => {
  const { running } = await pullRequestOver({ prepare: async checkout => {
    await git(checkout, 'checkout', '--quiet', '-b', 'work');
    await git(checkout, 'branch', '--quiet', '-D', 'main');
  } });

  expect((await ask(running, { type: 'pr.GET_BRANCH_DIFF', ...pr }, 'pr.BRANCH_DIFF_RECEIVED')).data.files).toEqual([expect.objectContaining({ path: 'a.txt' })]);
  expect((await ask(running, { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'a.txt', ...pr }, 'pr.FILE_DIFF_RECEIVED')).data).toMatchObject({ originalContent: 'one\n' });
  // The checkout's own branch against the remote's base, which is all there is of it here
  expect((await ask(running, { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'main' }, 'pr.BRANCH_DIFF_RECEIVED')).data.files).toEqual([]);
  expect(await ask(running, { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'gone', headBranch: 'feature' }, 'pr.ERROR'))
    .toMatchObject({ message: 'gone, the branch this is compared with, is not on the remote.' });
});

it('fetches from the remote the branch follows, whatever it is called', async () => {
  const { running } = await pullRequestOver({ remote: 'upstream' });

  expect((await ask(running, { type: 'pr.GET_BRANCH_DIFF', ...pr }, 'pr.BRANCH_DIFF_RECEIVED')).data.files).toEqual([expect.objectContaining({ path: 'a.txt' })]);
  expect((await ask(running, { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'main', headBranch: 'feature' }, 'pr.BRANCH_DIFF_RECEIVED')).data.files).toHaveLength(1);
});

it('opens a file of a comparison without fetching again, and says a fetch that failed', async () => {
  const { running, remote, root } = await pullRequestOver();
  await ask(running, { type: 'pr.GET_BRANCH_DIFF', ...pr }, 'pr.BRANCH_DIFF_RECEIVED');
  // The remote cannot be reached any more: only a fetch would notice
  fs.renameSync(remote, path.join(root, 'moved.git'));

  expect((await ask(running, { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'a.txt', ...pr }, 'pr.FILE_DIFF_RECEIVED')).data).toMatchObject({ modifiedContent: 'one\nfeature\n' });
  expect(await ask(running, { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'main', headBranch: 'feature' }, 'pr.ERROR'))
    .toMatchObject({ message: expect.stringContaining('feature could not be fetched from origin') });
});

it('answers a comparison whose base cannot be worked out and whose head is gone, with nothing left unhandled', async () => {
  // No main, master or develop, and no remote HEAD naming one: there is no base to find
  const { running } = await pullRequestOver({ initialBranch: 'trunk', prepare: checkout => git(checkout, 'remote', 'set-head', 'origin', '-d') });

  expect(await ask(running, { type: 'pr.GET_BRANCH_DIFF', headBranch: 'gone' }, 'pr.ERROR')).toMatchObject({ message: expect.any(String) });
});
