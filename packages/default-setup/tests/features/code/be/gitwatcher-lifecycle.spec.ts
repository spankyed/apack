import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as chokidar from 'chokidar';
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

it('retires callbacks before a pending repository write finishes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-write-'));
  fs.mkdirSync(path.join(directory, '.git'));
  const watcher = new GitWatcherService(directory);
  resources.push({ directory, watcher });
  const repository = new GitRepository(directory);
  vi.spyOn(repository, 'isWriteInProgress', 'get').mockReturnValue(true);
  const completions: Array<() => void> = [];
  vi.spyOn(repository, 'onWriteComplete').mockImplementation(callback => { completions.push(callback); });
  const changed = vi.fn();
  watcher.setGitRepository(repository);
  watcher.setChangeCallback(changed);
  await watcher.startWatching(new AbortController().signal);
  const files = vi.mocked(chokidar.FSWatcher.prototype.add).mock.instances[0] as chokidar.FSWatcher;
  files.emit('change', path.join(directory, '.git', 'index'));
  expect(completions).toHaveLength(1);
  await watcher.stopWatching();
  vi.useFakeTimers();
  completions[0]();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(changed).not.toHaveBeenCalled();
});
