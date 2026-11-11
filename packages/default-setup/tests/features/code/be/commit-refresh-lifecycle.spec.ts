import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { commitSystem } from '../../../../src/features/code/be/features/commit.ts';

const actors: Array<{ stop(): void }> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); vi.useRealTimers(); });
function start() {
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: null } }).start();
  actors.push(actor);
  return { actor, announced };
}

// Each window asks again for its status and history on the one announcement
it('coalesces repeated status changes into one announcement that the repository changed', async () => {
  const { actor, announced } = start();
  for (let i = 0; i < 3; i++) actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(149);
  expect(announced).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(announced).toHaveBeenCalledTimes(1);
});

it('cancels a pending refresh when the commit actor stops', async () => {
  const { actor, announced } = start();
  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  actor.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(announced).not.toHaveBeenCalled();
});

// A write here changes the repository every window shows, so it is the same news as the watcher's, and no window
// is sent a listing it did not ask for
it('announces a write as the repository changing, and lists nothing itself', async () => {
  const announced = vi.fn();
  const listed = vi.fn();
  const gitRepository = { stashDrop: async () => {}, refreshSnapshot: async () => NOTHING } as never;
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced, stashList: listed } }),
    { input: { baseDirectory: '/repo', gitRepository } }).start();
  actors.push(actor);

  actor.send({ type: 'commit.STASH_DROP', index: 0 });
  await vi.advanceTimersByTimeAsync(150);

  expect(announced).toHaveBeenCalledTimes(1);
  expect(listed).not.toHaveBeenCalled();
});

const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false };
/** The parts each announcement so far said changed */
const announcedParts = (announced: ReturnType<typeof vi.fn>) =>
  announced.mock.calls.map(([{ event }]) => (event as { changed: typeof NOTHING }).changed);

// A file event or a reconcile is a hint: git says which parts of the repository changed, and only those are news
it('announces a hint as the parts git says changed, one check at a time, and nothing when none did', async () => {
  let found = NOTHING;
  let release = () => {};
  const refreshSnapshot = vi.fn(() => new Promise<typeof NOTHING>((resolve) => { release = () => resolve(found); }));
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot } as never } }).start();
  actors.push(actor);

  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  for (let i = 0; i < 3; i++) actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(announced).not.toHaveBeenCalled();

  // The hints that arrived during the first check are one more
  expect(refreshSnapshot).toHaveBeenCalledTimes(2);
  found = { ...NOTHING, status: true };
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(announcedParts(announced)).toEqual([{ ...NOTHING, status: true }]);
  expect(refreshSnapshot).toHaveBeenCalledTimes(2);
});

// The window that made a write is waiting to show it, so its status is news whatever git says of the rest. The
// log, the stashes and the worktrees are asked for again only when the write moved them: staging a file does
// not. The check it runs first is also what keeps the file event the write causes from being news a second time
it('announces a write as its status changing and whatever else git says did, after checking the repository once', async () => {
  let found = NOTHING;
  const refreshSnapshot = vi.fn(async () => found);
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot } as never } }).start();
  actors.push(actor);

  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(refreshSnapshot).toHaveBeenCalledTimes(1);

  found = { ...NOTHING, stashes: true };
  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(announcedParts(announced)).toEqual([{ ...NOTHING, status: true }, { ...NOTHING, status: true, stashes: true }]);
});

// A pull request is read from commits, so an edited file is not news to it, and asking a remote about one is a
// round trip nobody needs
it('tells the pull requests only when the history changed', async () => {
  let found = NOTHING;
  const code = { send: vi.fn() };
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: () => {} } }),
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot: async () => found } as never, code: code as never } }).start();
  actors.push(actor);

  // A write made here that moved no commit, as staging a file is
  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(code.send).not.toHaveBeenCalled();

  found = { ...NOTHING, status: true };
  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(code.send).not.toHaveBeenCalled();

  found = { ...NOTHING, history: true, worktrees: true };
  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(code.send.mock.calls).toEqual([[{ type: 'pr.GIT_STATUS_CHANGED' }]]);
});
