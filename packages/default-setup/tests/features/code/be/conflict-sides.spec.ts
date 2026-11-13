// A conflicted file's diff carries its three sides, which the panel shows in place of the markers git wrote, and
// taking a side resolves it. Driven through the code system as a window drives it, over a real merge that conflicts.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

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
const git = async (cwd: string, ...args: string[]) =>
  String((await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout).trim();

it('sends a conflicted file\'s three sides with its diff, and taking theirs resolves it', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-conflict-')));
  dirs.push(directory);
  const write = (content: string) => fs.writeFileSync(path.join(directory, 'a.txt'), content);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  write('base\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'base');
  await git(directory, 'checkout', '--quiet', '-b', 'topic');
  write('theirs\n');
  await git(directory, 'commit', '--quiet', '-am', 'theirs');
  await git(directory, 'checkout', '--quiet', 'main');
  write('ours\n');
  await git(directory, 'commit', '--quiet', '-am', 'ours');
  await git(directory, 'merge', '--quiet', 'topic').catch(() => {});
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_GIT_DIFF', path: 'a.txt' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.DIFF_RECEIVED', { answering: asked });
  expect((data as { conflict: unknown }).conflict).toEqual({ base: 'base\n', ours: 'ours\n', theirs: 'theirs\n' });

  const resolved = await app.send('code', { type: 'commit.RESOLVE_CONFLICT', path: 'a.txt', strategy: 'theirs' }, asWindow);
  await app.nextEmit('code', 'commit.CONFLICT_RESOLVED', { answering: resolved });
  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('theirs\n');
  expect(await git(directory, 'diff', '--name-only', '--diff-filter=U')).toBe('');
});
