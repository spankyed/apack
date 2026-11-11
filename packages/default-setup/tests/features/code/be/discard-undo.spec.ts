// A window discards a change and is told what was kept of it, asks beforehand what cannot be brought back, and
// has a discard put back. The repository is a real one, driven through the code system as a window drives it.
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

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
const asWindow = { sender: CODE, client: 'c-main' };
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
  fs.mkdirSync(path.join(directory, 'vendor/lib'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'vendor/lib/one.js'), 'one\n');
  fs.writeFileSync(path.join(directory, 'vendor/two.js'), 'two\n');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return directory;
}
const statusPaths = async () => {
  const asked = await app!.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  return ((await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: asked })).data as { files: { path: string }[] }).files.map(file => file.path);
};

it('answers a discard with what it kept, and puts it back for the window that asks', async () => {
  const directory = await codeOverChanges();

  const discarded = await app!.send('code', { type: 'commit.REVERT_FILES', paths: ['a.txt', 'vendor/'] }, asWindow);
  const { kept } = (await app!.nextEmit('code', 'commit.FILES_REVERTED', { answering: discarded })).data as { kept: Kept };

  expect(kept).toEqual({ id: expect.stringMatching(/^[0-9a-f]{40,64}$/), notKept: [] });
  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('committed\n');
  expect(fs.existsSync(path.join(directory, 'vendor'))).toBe(false);
  expect(await statusPaths()).toEqual([]);

  const undone = await app!.send('code', { type: 'commit.RESTORE_DISCARDED', id: kept.id! }, asWindow);
  expect((await app!.nextEmit('code', 'commit.DISCARD_RESTORED', { answering: undone })).data).toEqual({
    id: kept.id, restored: ['a.txt', 'vendor/lib/one.js', 'vendor/two.js'], left: [],
  });

  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('committed\nand an edit\n');
  expect(fs.readFileSync(path.join(directory, 'vendor/lib/one.js'), 'utf8')).toBe('one\n');
  expect(await statusPaths()).toEqual(['a.txt', 'vendor/']);
});

it('says beforehand which files a discard could not bring back, to the window about to ask for it', async () => {
  const directory = await codeOverChanges();
  // One byte past what a discard keeps a copy of
  fs.writeFileSync(path.join(directory, 'vendor/video.bin'), Buffer.alloc(10 * 1024 * 1024 + 1));

  const asked = await app!.send('code', { type: 'commit.PREVIEW_DISCARD', paths: ['a.txt', 'vendor/'] }, asWindow);

  expect((await app!.nextEmit('code', 'commit.DISCARD_PREVIEWED', { answering: asked })).data).toEqual({
    paths: ['a.txt', 'vendor/'], notKept: ['vendor/video.bin'],
  });
});

it('tells the window a discard that is no longer kept cannot be put back', async () => {
  const directory = await codeOverChanges();
  const discarded = await app!.send('code', { type: 'commit.REVERT_FILE', path: 'a.txt' }, asWindow);
  const { kept } = (await app!.nextEmit('code', 'commit.FILE_REVERTED', { answering: discarded })).data as { kept: Kept };
  await git(directory, 'prune', '--expire=now');

  const undone = await app!.send('code', { type: 'commit.RESTORE_DISCARDED', id: kept.id! }, asWindow);

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: undone })).data).toMatchObject({
    message: expect.stringContaining('no longer kept'),
  });
});
