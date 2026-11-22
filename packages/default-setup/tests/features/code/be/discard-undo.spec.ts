// A window discards a change and is told what was kept of it, asks beforehand what cannot be brought back, and
// has a discard put back. The repository is a real one, driven through the code system as a window drives it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { getDataDirPath } from '#generated/paths.ts';
import { answered, refused } from './_support/asks.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
const asWindow = { client: 'c-main' };
type Kept = { id?: string; notKept: string[] };

/** The code system over a repository with `a.txt` edited and a folder of two files git tracks nothing in */
async function codeOverChanges() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-discard-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'committed\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'committed\nand an edit\n');
  fs.mkdirSync(path.join(directory, 'third-party/lib'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'third-party/lib/one.js'), 'one\n');
  fs.writeFileSync(path.join(directory, 'third-party/two.js'), 'two\n');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return directory;
}
const statusPaths = async () => {
  const asked = app!.ask('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  return ((await answered(asked)) as { files: { path: string }[] }).files.map(file => file.path);
};

it('answers a discard with what it kept, and puts it back for the window that asks', async () => {
  const directory = await codeOverChanges();

  const discarded = app!.ask('code', { type: 'commit.REVERT_FILES', paths: ['a.txt', 'third-party/'] }, asWindow);
  const { kept } = (await answered(discarded)) as { kept: Kept };

  expect(kept).toEqual({ id: expect.any(String), notKept: [] });
  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('committed\n');
  expect(fs.existsSync(path.join(directory, 'third-party'))).toBe(false);
  expect(await statusPaths()).toEqual([]);

  const undone = app!.ask('code', { type: 'commit.RESTORE_DISCARDED', id: kept.id! }, asWindow);
  expect(await answered(undone)).toEqual({
    id: kept.id, restored: ['a.txt', 'third-party/lib/one.js', 'third-party/two.js'], left: [],
  });

  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('committed\nand an edit\n');
  expect(fs.readFileSync(path.join(directory, 'third-party/lib/one.js'), 'utf8')).toBe('one\n');
  expect(await statusPaths()).toEqual(['a.txt', 'third-party/']);
});

it('says beforehand which files a discard could not bring back, to the window about to ask for it', async () => {
  const directory = await codeOverChanges();
  // One byte past what a discard keeps a copy of
  fs.writeFileSync(path.join(directory, 'third-party/video.bin'), Buffer.alloc(10 * 1024 * 1024 + 1));

  const asked = app!.ask('code', { type: 'commit.PREVIEW_DISCARD', paths: ['a.txt', 'third-party/'] }, asWindow);

  expect(await answered(asked)).toEqual({
    paths: ['a.txt', 'third-party/'], notKept: ['third-party/video.bin'],
  });
});

it('keeps a discard through a prune of the repository, since it is kept with the pack\'s own data', async () => {
  const directory = await codeOverChanges();
  const discarded = app!.ask('code', { type: 'commit.REVERT_FILE', path: 'a.txt' }, asWindow);
  const { kept } = (await answered(discarded)) as { kept: Kept };
  await git(directory, 'prune', '--expire=now');

  const undone = app!.ask('code', { type: 'commit.RESTORE_DISCARDED', id: kept.id! }, asWindow);

  await answered(undone);
  expect(fs.existsSync(getDataDirPath('checkpoints')), 'and the copy is in the pack\'s own data').toBe(true);
});

it('tells the window a discard that is no longer kept cannot be put back', async () => {
  await codeOverChanges();
  const discarded = app!.ask('code', { type: 'commit.REVERT_FILE', path: 'a.txt' }, asWindow);
  const { kept } = (await answered(discarded)) as { kept: Kept };
  // The copy dropped and the write's journal entry kept, as the store drops a copy past its age: the store's refs to
  // its copies deleted, as the engine's own spec of this does
  const checkpoints = getDataDirPath('checkpoints');
  const stores = fs.readdirSync(checkpoints, { recursive: true, encoding: 'utf8' })
    .filter(entry => path.basename(entry) === 'HEAD' && fs.existsSync(path.join(checkpoints, path.dirname(entry), 'objects')))
    .map(entry => path.join(checkpoints, path.dirname(entry)));
  let dropped = 0;
  for (const store of stores) {
    const { stdout } = await git(checkpoints, '--git-dir', store, 'for-each-ref', '--format=%(refname)', 'refs/checkpoints/');
    for (const ref of String(stdout).split('\n').filter(Boolean)) {
      await git(checkpoints, '--git-dir', store, 'update-ref', '-d', ref);
      dropped++;
    }
  }
  expect(dropped, 'the copy the discard kept').toBeGreaterThan(0);

  const undone = app!.ask('code', { type: 'commit.RESTORE_DISCARDED', id: kept.id! }, asWindow);

  expect(await refused(undone)).toMatchObject({
    message: expect.stringContaining('no longer kept'),
  });
});
