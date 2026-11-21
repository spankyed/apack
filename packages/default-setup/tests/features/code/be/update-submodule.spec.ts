// Bringing a submodule to the commit its repository records, driven through the code system as the commit panel drives
// it, over real repositories: the row that says the submodule is on another commit, the update that answers the window
// that asked, and the row gone after it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { answered, refused } from './_support/asks.ts';

const asWindow = { client: 'c-main' };
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'protocol.file.allow=always', ...args], { cwd })).stdout.trim();

/**
 * A repository recording a submodule at the second of its two commits, with the submodule's checkout moved back to the
 * first, and the code system over it
 */
async function movedSubmodule() {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-submodule-')));
  dirs.push(outer);
  const library = path.join(outer, 'library');
  const top = path.join(outer, 'top');
  for (const directory of [library, top]) {
    fs.mkdirSync(directory);
    await git(directory, 'init', '--quiet', '--initial-branch=main');
  }
  for (const line of ['one', 'two']) {
    fs.writeFileSync(path.join(library, 'lib.txt'), `${line}\n`);
    await git(library, 'add', '.');
    await git(library, 'commit', '--quiet', '-m', line);
  }
  await git(top, 'submodule', '--quiet', 'add', library, 'lib');
  await git(top, 'commit', '--quiet', '-m', 'add lib');
  const recorded = await git(path.join(top, 'lib'), 'rev-parse', 'HEAD');
  await git(path.join(top, 'lib'), 'checkout', '--quiet', 'HEAD~1');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: top });
  await app.settle();
  return { app, recorded, at: () => git(path.join(top, 'lib'), 'rev-parse', 'HEAD') };
}

/** The rows of the status the window is told */
async function rows(app: Awaited<ReturnType<typeof startApp>>) {
  const asked = app.ask('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  return (await answered(asked)) as { files: { path: string; submodule?: { commit: boolean } }[] };
}

it('tells the window a submodule is on another commit, and brings it to the one recorded when asked', async () => {
  const { app, recorded, at } = await movedSubmodule();
  expect((await rows(app)).files).toMatchObject([{ path: 'lib', submodule: { commit: true } }]);

  const asked = app.ask('code', { type: 'commit.UPDATE_SUBMODULE', path: 'lib' }, asWindow);

  expect(await answered(asked)).toEqual({ path: 'lib' });
  expect(await at()).toBe(recorded);
  expect((await rows(app)).files).toEqual([]);
});

it('answers an update of a path that is no submodule with the failure, changing nothing', async () => {
  const { app, at } = await movedSubmodule();
  const before = await at();

  const asked = app.ask('code', { type: 'commit.UPDATE_SUBMODULE', path: 'nothing-here' }, asWindow);

  expect(await refused(asked)).toHaveProperty('message');
  expect(await at()).toBe(before);
});
