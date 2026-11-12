// Who last changed each line of a file, for the editor's gutter, leaving out a commit the repository lists to be
// ignored. Driven through the code system as a window drives it, over a real repository.
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

it('answers each line with who last changed it, leaving out the commits the repository lists', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-blame-')));
  dirs.push(directory);
  const as = async (name: string, ...args: string[]) => String((await execFileWhileWorking('git', args, {
    cwd: directory, env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name}@example.com`, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name}@example.com` },
  })).stdout).trim();
  const write = (content: string) => fs.writeFileSync(path.join(directory, 'notes.txt'), content);
  await as('ada', 'init', '--quiet', '--initial-branch=main');
  write('ada\n');
  await as('ada', 'add', '.');
  await as('ada', 'commit', '--quiet', '-m', 'by ada');
  write('ada\nbea\n');
  await as('bea', 'commit', '--quiet', '-am', 'by bea');
  write('ada\n  bea\n');
  await as('dee', 'commit', '--quiet', '-am', 'reformatted');
  fs.writeFileSync(path.join(directory, '.git-blame-ignore-revs'), `${await as('dee', 'rev-parse', 'HEAD')}\n`);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_BLAME', path: 'notes.txt' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.BLAME_RECEIVED', { answering: asked });

  expect(data).toMatchObject({ path: 'notes.txt' });
  expect((data as { lines: { line: number; author: string }[] }).lines.map(({ line, author }) => [line, author])).toEqual([[1, 'ada'], [2, 'bea']]);
});
