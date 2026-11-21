// The panel's history in pages, each commit with its parents, and a file's history followed across its rename.
// Driven through the code system as a window drives it, over a real repository.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { answered } from './_support/asks.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { client: 'c-main' };
const git = async (cwd: string, ...args: string[]) =>
  String((await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout).trim();
type Page = { commits: { subject: string; parents: string[] }[]; cursor?: string; path?: string; continued?: boolean };

it('answers the history with parents, and a file\'s history across its rename', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-history-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'old.txt'), Array.from({ length: 20 }, (_, line) => `line ${line}\n`).join(''));
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await git(directory, 'mv', 'old.txt', 'new.txt');
  await git(directory, 'commit', '--quiet', '-m', 'renamed');
  fs.writeFileSync(path.join(directory, 'other.txt'), 'other\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'other');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const whole = app.ask('code', { type: 'commit.LOG_LIST' }, asWindow);
  const data = await answered(whole);
  expect((data as Page).commits.map(({ subject, parents }) => [subject, parents.length])).toEqual([['other', 1], ['renamed', 1], ['first', 0]]);

  const ofFile = app.ask('code', { type: 'commit.LOG_LIST', path: 'new.txt' }, asWindow);
  const history = await answered(ofFile);
  expect(history).toMatchObject({ path: 'new.txt' });
  expect((history as Page).commits.map(({ subject }) => subject)).toEqual(['renamed', 'first']);
});
