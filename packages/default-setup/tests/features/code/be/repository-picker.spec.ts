// The panel's repository picker: the repositories under the folder the user opened, and choosing one moves the
// panels there while the picker goes on listing what is under that folder. Driven through the code system as a
// window drives it, over real repositories.
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
const git = (cwd: string, ...args: string[]) => execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

it('lists the repositories under the opened folder, and choosing one moves the panels there', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-picker-')));
  dirs.push(folder);
  await git(folder, 'init', '--quiet', '--initial-branch=main');
  await git(folder, 'commit', '--quiet', '--allow-empty', '-m', 'outer');
  const nested = path.join(folder, 'tools', 'nested');
  fs.mkdirSync(nested, { recursive: true });
  await git(nested, 'init', '--quiet', '--initial-branch=main');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: folder });
  await app.settle();

  const listed = await app.send('code', { type: 'LIST_REPOSITORIES' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.REPOSITORIES_RECEIVED', { answering: listed });
  expect((data as { repositories: { relative: string; kind: string }[] }).repositories.map(({ relative, kind }) => [relative, kind])).toEqual([['', 'top'], ['tools/nested', 'nested']]);

  await app.send('code', { type: 'SELECT_REPOSITORY', path: nested }, asWindow);
  await app.settle();

  const again = await app.send('code', { type: 'LIST_REPOSITORIES' }, asWindow);
  const { data: after } = await app.nextEmit('code', 'commit.REPOSITORIES_RECEIVED', { answering: again });
  expect(after).toMatchObject({ current: nested });
  expect((after as { repositories: unknown[] }).repositories, 'still what is under the folder the user opened').toHaveLength(2);
});
