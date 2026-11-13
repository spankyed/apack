// The failures the engine names that the panel has plainer words for than git's, in the words the panel shows. Each
// fails a real git through the app's repository, as a window's command does.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { AppGitRepository, APP_TIES } from '#features/code/be/services/app-git-repository.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
function scratch(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
async function repository() {
  const root = scratch('named-failure-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'first');
  return root;
}
const refusal = (attempt: Promise<unknown>) => attempt.then(
  () => { throw new Error('it did not fail'); },
  (error: Error & { code?: string }) => ({ code: error.code, message: error.message }),
);
const opened = (root: string) => new AppGitRepository(root, { ...APP_TIES, isTrusted: () => true });

it('says there is nothing staged to commit', async () => {
  const root = await repository();

  expect(await refusal(opened(root).commit('nothing'))).toEqual({ code: 'nothing-to-commit', message: 'There is nothing staged to commit.' });
});

it('says a branch of that name already exists', async () => {
  const root = await repository();
  await git(root, 'branch', 'topic');

  expect(await refusal(opened(root).worktreeAdd(path.join(scratch('named-failure-worktree-'), 'topic'), 'topic', true)))
    .toMatchObject({ code: 'branch-exists', message: expect.stringContaining('already exists') });
});

it('says the host refused a push, in the host\'s own words', async () => {
  const root = await repository();
  const remote = scratch('named-failure-host-');
  await git(remote, 'init', '--quiet', '--bare', '--initial-branch=main');
  const hook = path.join(remote, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "error: GH006: Protected branch update failed for refs/heads/main." >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  await git(root, 'remote', 'add', 'origin', remote);

  expect(await refusal(opened(root).pushBranch())).toEqual({
    code: 'host-refused', message: 'Failed to push: The host refused the push: GH006: Protected branch update failed for refs/heads/main.',
  });
});
