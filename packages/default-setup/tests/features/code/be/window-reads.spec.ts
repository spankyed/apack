// A window's blame and history reads, driven through the code system as windows drive it: a read stops when whoever
// asked for it stops waiting, as a panel does that asks for another, a window going stops all of its, and another
// window's are left running. The repository's reads are stood in for by ones that run until their
// signal stops them, which is what a blame of a large file or a long history does; that the engine's reads stop on the
// signal is apack-git's own spec.
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitError } from '@apackdev/git';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { AppGitRepository } from '../../../../src/features/code/be/services/app-git-repository.ts';
import { refused } from './_support/asks.ts';

const asWindow = (client: string) => ({ client });
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A read that runs until its signal stops it, rejecting then as the engine's does */
const untilStopped = (signal: AbortSignal | undefined) => new Promise<never>((_, reject) => {
  signal?.addEventListener('abort', () => reject(new GitError('stopped', 'aborted')), { once: true });
});

/** The code system over a repository, with each blame and history read it starts recorded by what it was asked */
async function reading() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-window-reads-')));
  dirs.push(directory);
  await execFileWhileWorking('git', ['init', '--quiet', '--initial-branch=main'], { cwd: directory });
  const reads: { what: string; signal?: AbortSignal }[] = [];
  vi.spyOn(AppGitRepository.prototype, 'blame').mockImplementation((file, options) => {
    reads.push({ what: `blame ${file}`, signal: options?.signal });
    return untilStopped(options?.signal);
  });
  vi.spyOn(AppGitRepository.prototype, 'history').mockImplementation((options) => {
    reads.push({ what: `history ${options?.path ?? 'all'}`, signal: options?.signal });
    return untilStopped(options?.signal);
  });
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  reads.splice(0);
  const stopped = () => reads.filter(read => read.signal?.aborted).map(read => read.what);
  return { app, reads, stopped };
}

it("stops a blame when whoever asked for it stops waiting, leaving another window's and the one asked for since", async () => {
  const { app, reads, stopped } = await reading();
  const moved = new AbortController();

  const first = app.ask('code', { type: 'commit.GET_BLAME', path: 'a.ts' }, { ...asWindow('one'), signal: moved.signal });
  void app.ask('code', { type: 'commit.GET_BLAME', path: 'b.ts' }, asWindow('two'));
  await app.settle();
  // The panel asks for another file's blame, and no longer waits on the first
  moved.abort(new Error('the panel asked for another'));
  void app.ask('code', { type: 'commit.GET_BLAME', path: 'c.ts' }, asWindow('one'));
  await expect(first).rejects.toThrow('the panel asked for another');
  await app.settle();

  expect(reads.map(read => read.what)).toEqual(['blame a.ts', 'blame b.ts', 'blame c.ts']);
  await vi.waitFor(() => expect(stopped()).toEqual(['blame a.ts']));
});

it('stops a page of history when whoever asked for it stops waiting, whichever history the next is of', async () => {
  const { app, stopped } = await reading();
  const moved = new AbortController();

  const first = app.ask('code', { type: 'commit.LOG_LIST', path: 'a.ts' }, { ...asWindow('one'), signal: moved.signal });
  await app.settle();
  moved.abort(new Error('the panel asked for another'));
  void app.ask('code', { type: 'commit.LOG_LIST' }, asWindow('one'));
  await expect(first).rejects.toThrow('the panel asked for another');
  await app.settle();

  await vi.waitFor(() => expect(stopped()).toEqual(['history a.ts']));
});

it("stops every read of a window that goes, and none of another's", async () => {
  const { app, stopped } = await reading();
  void app.ask('code', { type: 'commit.GET_BLAME', path: 'a.ts' }, asWindow('one')).catch(() => {});
  void app.ask('code', { type: 'commit.LOG_LIST', path: 'a.ts' }, asWindow('one')).catch(() => {});
  void app.ask('code', { type: 'commit.GET_BLAME', path: 'b.ts' }, asWindow('two'));
  await app.settle();

  await app.endConnection('one');
  await app.settle();

  expect(stopped().sort()).toEqual(['blame a.ts', 'history a.ts']);
});

it('answers a read that fails for any other reason with the failure', async () => {
  const { app } = await reading();
  vi.mocked(AppGitRepository.prototype.blame).mockRejectedValueOnce(new GitError('no such path'));

  const asked = app.ask('code', { type: 'commit.GET_BLAME', path: 'gone.ts' }, asWindow('one'));

  expect(await refused(asked)).toMatchObject({ message: 'no such path' });
});
