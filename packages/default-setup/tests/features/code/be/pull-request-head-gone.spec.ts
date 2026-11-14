// A pull request whose branch was deleted, as merging or closing one often does: its changes are read from what
// GitHub keeps of it (`refs/pull/<n>/head`), not from a branch that is no longer there, and a comparison of a
// branch that is gone says so in words rather than git's. The remote is a real bare repository serving the pull
// ref as GitHub does; the code system is driven as a window drives it.
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

it("reads a closed pull request's changes after its branch is deleted, and says so of a branch that is gone", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-pull-ref-')));
  dirs.push(root);
  const remote = path.join(root, 'remote.git');
  const author = path.join(root, 'author');
  const checkout = path.join(root, 'checkout');
  await execFileWhileWorking('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  await execFileWhileWorking('git', ['init', '--quiet', '--initial-branch=main', author]);
  fs.writeFileSync(path.join(author, 'a.txt'), 'one\n');
  await git(author, 'add', '.');
  await git(author, 'commit', '--quiet', '-m', 'first');
  await git(author, 'remote', 'add', 'origin', remote);
  await git(author, 'push', '--quiet', 'origin', 'main');
  await execFileWhileWorking('git', ['clone', '--quiet', remote, checkout]);
  // The pull request's branch, pushed and opened as #1 after the checkout was cloned, then deleted
  await git(author, 'checkout', '--quiet', '-b', 'feature');
  fs.writeFileSync(path.join(author, 'b.txt'), 'two\n');
  await git(author, 'add', '.');
  await git(author, 'commit', '--quiet', '-m', 'second');
  await git(author, 'push', '--quiet', 'origin', 'feature', 'feature:refs/pull/1/head');
  await git(author, 'push', '--quiet', 'origin', '--delete', 'feature');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: checkout });
  await app.settle();

  const files = await app.nextEmit('code', 'pr.BRANCH_DIFF_RECEIVED', {
    answering: await app.send('code', { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'main', headBranch: 'feature', prNumber: 1 }, asWindow),
  });
  expect(files.data).toMatchObject({ baseBranch: 'main', headBranch: 'feature', files: [{ path: 'b.txt' }] });

  const file = await app.nextEmit('code', 'pr.FILE_DIFF_RECEIVED', {
    answering: await app.send('code', { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'b.txt', baseBranch: 'main', headBranch: 'feature', prNumber: 1 }, asWindow),
  });
  expect(file.data).toMatchObject({ path: 'b.txt', originalContent: '', modifiedContent: 'two\n' });

  const gone = await app.nextEmit('code', 'pr.ERROR', {
    answering: await app.send('code', { type: 'pr.GET_BRANCH_DIFF', baseBranch: 'main', headBranch: 'feature' }, asWindow),
  });
  expect(gone).toMatchObject({ message: 'feature is no longer on the remote, so its changes cannot be compared.' });
});
