// The watcher of open files reports a file that changed on disk since it was last seen. A file event only says
// to look, so these cases ask it to look (`check`) and never wait on the platform delivering one.
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenFileWatcher, type FileChangeInfo } from '../../../../../src/features/code/be/services/open-file-watcher.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-open-files-')));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const changes: FileChangeInfo[] = [];
  const watcher = new OpenFileWatcher(change => changes.push(change));
  cleanups.push(() => watcher.stop());
  const file = path.join(directory, 'notes.txt');
  fs.writeFileSync(file, 'one\n');
  return { directory, watcher, file, changes };
}

it('reports nothing for a file that is as it was when opened', async () => {
  const { watcher, file, changes } = fixture();
  watcher.open(file);
  await watcher.check();
  await watcher.check();
  expect(changes).toEqual([]);
});

it('reports a change, a removal and a return, each once, with when the file was modified', async () => {
  const { watcher, file, changes } = fixture();
  watcher.open(file);
  await watcher.check();

  fs.writeFileSync(file, 'one\ntwo\n');
  await watcher.check();
  await watcher.check();
  expect(changes).toEqual([{ path: file, changeType: 'change', modifiedAt: fs.statSync(file).mtime }]);

  fs.rmSync(file);
  await watcher.check();
  expect(changes.at(-1)).toMatchObject({ path: file, changeType: 'unlink' });

  fs.writeFileSync(file, 'back\n');
  await watcher.check();
  expect(changes.at(-1)).toEqual({ path: file, changeType: 'add', modifiedAt: fs.statSync(file).mtime });
  expect(changes).toHaveLength(3);
});

it('reports a file under the path it was opened by', async () => {
  const { directory, watcher, changes } = fixture();
  const link = `${directory}-link`;
  fs.symlinkSync(directory, link);
  cleanups.push(() => fs.rmSync(link, { force: true }));
  const opened = path.join(link, 'notes.txt');
  watcher.open(opened);
  await watcher.check();

  fs.writeFileSync(path.join(directory, 'notes.txt'), 'changed through the real path\n');
  await watcher.check();
  expect(changes.map(change => change.path)).toEqual([opened]);
});

it('reports nothing for a file that was closed', async () => {
  const { watcher, file, changes } = fixture();
  watcher.open(file);
  await watcher.check();
  watcher.close(file);

  fs.writeFileSync(file, 'changed after closing\n');
  await watcher.check();
  expect(watcher.isOpen(file)).toBe(false);
  expect(changes).toEqual([]);
});

it('looks at a file when the platform reports an event for it', async () => {
  const { watcher, file, changes } = fixture();
  const add = vi.spyOn((await import('chokidar')).FSWatcher.prototype, 'add');
  cleanups.push(() => add.mockRestore());
  watcher.open(file);
  await watcher.check();

  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  (add.mock.instances[0] as import('chokidar').FSWatcher).emit('all', 'change', file);
  await expect.poll(() => changes).toEqual([{ path: file, changeType: 'change', modifiedAt: fs.statSync(file).mtime }]);
});
