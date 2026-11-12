// A pull request's file diff in a partial clone: the version the clone was not given is said to be missing rather
// than fetched, and fetched when the window asks for it. Driven through the code system as a window drives it,
// over a real clone of a folder remote.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { resolveGitPath } from '#features/code/be/utils/resolve-cli.ts';

const CODE = 'default-setup/code';
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { sender: CODE, client: 'c-main' };
const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

/** A clone given no file content but its checkout's, of a remote where `a.txt` was `one` and is `two` */
async function partialClone() {
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-partial-remote-')));
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-partial-clone-')));
  dirs.push(remote, parent);
  await git(remote, 'init', '--quiet', '--initial-branch=main');
  await git(remote, 'config', 'uploadpack.allowFilter', 'true');
  fs.writeFileSync(path.join(remote, 'a.txt'), 'one\n');
  await git(remote, 'add', '.');
  await git(remote, 'commit', '--quiet', '-m', 'one');
  fs.writeFileSync(path.join(remote, 'a.txt'), 'two\n');
  await git(remote, 'commit', '--quiet', '-am', 'two');
  const root = path.join(parent, 'clone');
  await git(parent, 'clone', '--quiet', '--filter=blob:none', `file://${remote.replaceAll('\\', '/')}`, root);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: root });
  await app.settle();
  return root;
}

/**
 * Whether the git the app runs can be told not to fetch, asked of it: one that cannot fetches whatever a read needs.
 * Which releases can is a table of each line's, so it is found by what git does, in a clone made for the asking
 */
const refusesToFetch = await (async () => {
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-partial-probe-')));
  try {
    await git(remote, 'init', '--quiet', '--initial-branch=main');
    await git(remote, 'config', 'uploadpack.allowFilter', 'true');
    fs.writeFileSync(path.join(remote, 'a.txt'), 'one\n');
    await git(remote, 'add', '.');
    await git(remote, 'commit', '--quiet', '-m', 'one');
    fs.writeFileSync(path.join(remote, 'a.txt'), 'two\n');
    await git(remote, 'commit', '--quiet', '-am', 'two');
    await execFileWhileWorking(resolveGitPath(), ['clone', '--quiet', '--filter=blob:none', `file://${remote.replaceAll('\\', '/')}`, 'clone'], { cwd: remote });
    const clone = path.join(remote, 'clone');
    const old = String((await execFileWhileWorking(resolveGitPath(), ['rev-parse', 'HEAD~1:a.txt'], { cwd: clone })).stdout).trim();
    return await execFileWhileWorking(resolveGitPath(), ['cat-file', 'blob', old], { cwd: clone, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).then(() => false, () => true);
  } finally {
    fs.rmSync(remote, { recursive: true, force: true });
  }
})();

it.runIf(refusesToFetch)('says a file diff needs a version the clone was not given, and fetches nothing', async () => {
  await partialClone();

  const asked = await app!.send('code', { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'a.txt', baseBranch: 'HEAD~1' }, asWindow);

  const { data } = await app!.nextEmit('code', 'pr.FILE_CONTENT_MISSING', { answering: asked });
  expect(data).toEqual({ path: 'a.txt', baseBranch: 'HEAD~1' });
});

it('fetches the version a file diff needs when the window asks it to', async () => {
  await partialClone();

  const asked = await app!.send('code', { type: 'pr.GET_BRANCH_FILE_DIFF', path: 'a.txt', baseBranch: 'HEAD~1', fetchMissing: true }, asWindow);

  const { data } = await app!.nextEmit('code', 'pr.FILE_DIFF_RECEIVED', { answering: asked });
  expect(data).toMatchObject({ path: 'a.txt', originalContent: 'one\n', modifiedContent: 'two\n' });
});
