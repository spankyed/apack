import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as chokidar from 'chokidar';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { GitWatcherService } from '../../../../src/features/code/be/services/gitwatcher.ts';
import { GitRepository } from '../../../../src/features/code/be/services/git.ts';

beforeEach(() => { vi.spyOn(chokidar.FSWatcher.prototype, 'add'); });

const resources: Array<{ directory: string; watcher: GitWatcherService }> = [];
afterEach(async () => {
  for (const { directory, watcher } of resources.splice(0)) {
    await watcher.stopWatching();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('creates no filesystem handles when startup is cancelled during preflight', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-cancel-'));
  fs.mkdirSync(path.join(directory, '.git'));
  const watcher = new GitWatcherService(directory);
  resources.push({ directory, watcher });
  const cancellation = new AbortController();
  const startup = watcher.startWatching(cancellation.signal);
  cancellation.abort();
  await startup;
  expect(chokidar.FSWatcher.prototype.add).not.toHaveBeenCalled();
});

const emitter = (index: number) => vi.mocked(chokidar.FSWatcher.prototype.add).mock.instances[index] as chokidar.FSWatcher;
const watchedPaths = (index: number) => vi.mocked(chokidar.FSWatcher.prototype.add).mock.calls[index][0] as string[];

/** A watcher over a new directory, in a repository of its own unless told otherwise */
async function watching(prefix: string, { repository = true } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  if (repository) await execFileWhileWorking('git', ['init', '--quiet', directory]);
  const watcher = new GitWatcherService(directory);
  resources.push({ directory, watcher });
  const git = new GitRepository(directory);
  const changed = vi.fn();
  watcher.setGitRepository(git);
  watcher.setChangeCallback(changed);
  return { directory, watcher, git, changed };
}

it('retires callbacks before a pending repository write finishes', async () => {
  const { directory, watcher, git, changed } = await watching('apack-watch-write-');
  await watcher.startWatching(new AbortController().signal);
  vi.spyOn(git, 'isWriteInProgress', 'get').mockReturnValue(true);
  const completions: Array<() => void> = [];
  vi.spyOn(git, 'onWriteComplete').mockImplementation(callback => { completions.push(callback); });
  emitter(0).emit('change', path.join(directory, '.git', 'index'));
  expect(completions).toHaveLength(1);
  await watcher.stopWatching();
  vi.useFakeTimers();
  completions[0]();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).not.toHaveBeenCalled();
});

it('announces a repository change while changes keep arriving', async () => {
  const { directory, watcher, changed } = await watching('apack-watch-stream-');
  await watcher.startWatching(new AbortController().signal);
  vi.useFakeTimers();
  // Each change lands before the last one's quiet period ends, as a build or an agent's edits do
  for (let i = 0; i < 12; i += 1) {
    emitter(1).emit('change', path.join(directory, `file-${i}.ts`));
    await vi.advanceTimersByTimeAsync(300);
  }
  expect(changed).toHaveBeenCalled();
});

it('watches the refs a linked worktree shares with its main checkout', async () => {
  const { directory } = await watching('apack-watch-worktree-');
  const identity = ['-c', 'user.name=spec', '-c', 'user.email=spec@example.com'];
  await execFileWhileWorking('git', ['-C', directory, ...identity, 'commit', '--quiet', '--allow-empty', '-m', 'first']);
  const worktree = `${directory}-linked`;
  await execFileWhileWorking('git', ['-C', directory, 'worktree', 'add', '--quiet', worktree]);
  const watcher = new GitWatcherService(worktree);
  resources.push({ directory: worktree, watcher });
  watcher.setGitRepository(new GitRepository(worktree));
  await watcher.startWatching(new AbortController().signal);

  const watched = watchedPaths(0).map(watchedPath => fs.realpathSync(path.dirname(watchedPath)) + path.sep + path.basename(watchedPath));
  const main = path.join(directory, '.git');
  expect(watched).toContain(path.join(main, 'refs'));
  expect(watched).toContain(path.join(main, 'packed-refs'));
  expect(watched).toContain(path.join(main, 'worktrees', path.basename(worktree), 'index'));
});

it('outside a repository, reports an open file under the path it was opened by and no repository change', async () => {
  const { directory, watcher, changed } = await watching('apack-watch-plain-', { repository: false });
  fs.writeFileSync(path.join(directory, 'notes.txt'), 'one\n');
  const link = `${directory}-link`;
  fs.symlinkSync(directory, link);
  resources.push({ directory: link, watcher });
  const opened = path.join(link, 'notes.txt');
  const fileChanged = vi.fn();
  watcher.setFileChangeCallback(fileChanged);
  watcher.registerOpenFile(opened);
  await watcher.startWatching(new AbortController().signal);
  vi.useFakeTimers();
  emitter(0).emit('change', path.join(directory, 'notes.txt'));
  await vi.advanceTimersByTimeAsync(3000);
  expect(fileChanged).toHaveBeenCalledWith(expect.objectContaining({ path: opened, changeType: 'change' }));
  expect(changed).not.toHaveBeenCalled();
});
