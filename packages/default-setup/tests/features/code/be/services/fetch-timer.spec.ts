// Fetching by itself on a timer, whether or not a window asks: due an interval after the last fetch, or the last
// time one was considered, never while fetching is off, has stopped or the repository is closed — and the commit
// system fetches on it with no window asking. Every case runs a real git against a remote on disk.
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createActor } from 'xstate';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { AppGitRepository } from '../../../../../src/features/code/be/services/app-git-repository.ts';
import { commitSystem } from '../../../../../src/features/code/be/features/commit.ts';

const directories: string[] = [];
const closing: Array<() => unknown> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of closing.splice(0)) await close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args])).stdout.trim();

/** A clone whose remote has one commit the clone has not fetched; `following` false leaves its branch following nothing */
async function cloneBehindItsRemote({ following = true } = {}) {
  const origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-fetch-timer-')));
  directories.push(origin);
  await git(origin, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(origin, 'a.txt'), 'one\n');
  await git(origin, 'add', '.');
  await git(origin, 'commit', '--quiet', '-m', 'first');
  const clone = `${origin}-clone`;
  directories.push(clone);
  await execFileWhileWorking('git', ['clone', '--quiet', origin, clone]);
  if (!following) await git(clone, 'branch', '--quiet', '--unset-upstream');
  fs.writeFileSync(path.join(origin, 'a.txt'), 'two\n');
  await git(origin, 'commit', '--quiet', '-am', 'second');
  const repo = new AppGitRepository(clone);
  closing.push(() => repo.close());
  return repo;
}

const MINUTE = 60_000;
/** Only the timer is faked: git and the processes it runs keep the real clock, which `fetchIfDue` reads */
const fakeTimer = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

/**
 * Checks that `due` is not called short of `intervalMs` after a fetch that began at `fetchedFrom`, and is just past it.
 *
 * **The timer is the interval less the real time since the fetch**, read from the real clock, and the fetch and what
 * followed it took real time, which a busy machine stretches to seconds. So "short of it" is measured from the real
 * time the fetch began, which the fetch's own stamp cannot precede, and "past it" is a second past the whole interval,
 * which no stamp can exceed. Two seconds either side of the fake interval failed under load
 */
function dueAfter(intervalMs: number, fetchedFrom: number, due: ReturnType<typeof vi.fn>) {
  const short = intervalMs - (Date.now() - fetchedFrom) - 1_000;
  vi.advanceTimersByTime(short);
  expect(due, 'within the interval').not.toHaveBeenCalled();
  vi.advanceTimersByTime(intervalMs + 1_000 - short);
  expect(due).toHaveBeenCalledTimes(1);
}

it('is due an interval after the last fetch, and not before', async () => {
  const repo = await cloneBehindItsRemote();
  repo.setFetchConfig(true, 180);
  const fetchedFrom = Date.now();
  expect(await repo.fetchIfDue()).toBe(true);
  fakeTimer();
  const due = vi.fn();

  repo.whenFetchDue(due);
  dueAfter(3 * MINUTE, fetchedFrom, due);
});

it('is due nothing while fetching by itself is off, and due at once when it is turned on', async () => {
  const repo = await cloneBehindItsRemote();
  fakeTimer();
  const due = vi.fn();
  repo.whenFetchDue(due);
  vi.advanceTimersByTime(30 * MINUTE);
  expect(due).not.toHaveBeenCalled();

  repo.setFetchConfig(true, 180);
  vi.advanceTimersByTime(0);
  expect(due, 'never fetched, so due now').toHaveBeenCalledTimes(1);

  repo.setFetchConfig(false, 180);
  vi.advanceTimersByTime(30 * MINUTE);
  expect(due).toHaveBeenCalledTimes(1);
});

it('puts the next look off by the interval for a branch with nothing to fetch, rather than looking again at once', async () => {
  const repo = await cloneBehindItsRemote({ following: false });
  repo.setFetchConfig(true, 180);
  fakeTimer();
  let looks = 0;
  let looked: Promise<boolean> | undefined;
  repo.whenFetchDue(() => { looks++; looked = repo.fetchIfDue(); });
  vi.advanceTimersByTime(0);
  expect(looks).toBe(1);
  expect(await looked, 'it follows no remote branch').toBe(false);

  vi.advanceTimersByTime(MINUTE);
  expect(looks, 'not looked at again within the interval').toBe(1);
  vi.advanceTimersByTime(2 * MINUTE + 2_000);
  expect(looks, 'and looked at again once it has passed: a look sets the next').toBe(2);
});

it('never fires sooner than a minute after the last fetch, whatever interval it is given', async () => {
  const repo = await cloneBehindItsRemote();
  repo.setFetchConfig(true, 0);
  const fetchedFrom = Date.now();
  expect(await repo.fetchIfDue()).toBe(true);
  fakeTimer();
  const due = vi.fn();
  repo.whenFetchDue(due);
  dueAfter(MINUTE, fetchedFrom, due);
});

it('is due nothing once the repository is closed, or told to stop', async () => {
  const stopped = await cloneBehindItsRemote();
  const closed = await cloneBehindItsRemote();
  fakeTimer();
  const due = vi.fn();
  for (const repo of [stopped, closed]) {
    repo.setFetchConfig(true, 180);
    repo.whenFetchDue(due);
  }
  stopped.whenFetchDue(undefined);
  await closed.close();
  vi.advanceTimersByTime(30 * MINUTE);
  expect(due).not.toHaveBeenCalled();
});

it('fetches on the commit system with no window asking, and announces what it brought', async () => {
  const repo = await cloneBehindItsRemote();
  repo.setFetchConfig(true, 180);
  let announced!: () => void;
  const announcement = new Promise<void>(resolve => { announced = resolve; });
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: () => announced() } }),
    { input: { baseDirectory: null, gitRepository: repo } }).start();
  closing.unshift(() => actor.stop());

  await announcement;

  expect(await repo.readSnapshot(), 'the commit the remote had is fetched').toMatchObject({ behind: 1 });
});
