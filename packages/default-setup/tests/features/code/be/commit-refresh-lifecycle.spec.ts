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

// A watcher notes with the repository what it saw change, so the check its event starts reads that. A reconcile
// is asked for because something may have changed that no event reported, and a write is made by this app with
// no event at all: each of those reads everything
it('reads what was noted for a hint, and everything for a reconcile and for a write', async () => {
  const refreshSnapshot = vi.fn(async (_reading?: string) => NOTHING);
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot, fetchIfDue: async () => false } as never } }).start();
  actors.push(actor);
  const read = async (event: Parameters<typeof actor.send>[0]) => {
    refreshSnapshot.mockClear();
    actor.send(event);
    await vi.advanceTimersByTimeAsync(150);
    return refreshSnapshot.mock.calls.map(([reading]) => reading);
  };

  expect(await read({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' })).toEqual(['noted']);
  expect(await read({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true })).toEqual(['everything']);
  expect(await read({ type: 'commit.GIT_STATUS_CHANGED' })).toEqual(['everything']);
});

// A fetch made behind a reconcile announces what it brought by having the repository checked again. One that
// stopped fetching, the remote having asked for a sign-in, has it checked too: that is something a window shows
it('has the repository checked again when a fetch behind a reconcile stops fetching, and not when nothing came of it', async () => {
  const refreshSnapshot = vi.fn(async (_reading?: string) => NOTHING);
  const announced = vi.fn();
  let stops = false;
  const gitRepository = {
    refreshSnapshot,
    isAutoFetchSuspended: false,
    async fetchIfDue() { if (stops) this.isAutoFetchSuspended = true; return false; },
  };
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: '/repo', gitRepository: gitRepository as never } }).start();
  actors.push(actor);
  const checks = async () => {
    refreshSnapshot.mockClear();
    actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true });
    await vi.advanceTimersByTimeAsync(150);
    return refreshSnapshot.mock.calls.map(([reading]) => reading);
  };

  expect(await checks(), 'the fetch brought nothing and goes on').toEqual(['everything']);
  stops = true;
  expect(await checks(), 'the fetch stopped fetching').toEqual(['everything', 'noted']);
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
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot: async () => found, isGitRepository: async () => false } as never, code: code as never } }).start();
  actors.push(actor);

  // A write made here that moved no commit, as staging a file is
  // A window showing the repository asks for its status each time it is told that changed
  const aWindowAsks = async () => {
    actor.send({ type: 'commit.GET_GIT_STATUS' });
    await vi.advanceTimersByTimeAsync(0);
  };
  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(code.send).not.toHaveBeenCalled();
  await aWindowAsks();

  found = { ...NOTHING, status: true };
  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(code.send).not.toHaveBeenCalled();
  await aWindowAsks();

  found = { ...NOTHING, history: true, worktrees: true };
  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(code.send.mock.calls).toEqual([[{ type: 'pr.GIT_STATUS_CHANGED' }]]);
});

/** A commit system over a stand-in repository whose every check finds its status changed, with what was read each time */
function overAChangingRepository() {
  const refreshSnapshot = vi.fn(async (_reading?: string, _options?: { refreshIndex?: boolean }) => ({ ...NOTHING, status: true }));
  const gitRepository = { refreshSnapshot, isGitRepository: async () => false, fetchIfDue: async () => false, isAutoFetchSuspended: false };
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: () => {} } }),
    { input: { baseDirectory: '/repo', gitRepository: gitRepository as never } }).start();
  actors.push(actor);
  const after = async (event: Parameters<typeof actor.send>[0]) => {
    refreshSnapshot.mockClear();
    actor.send(event);
    await vi.advanceTimersByTimeAsync(0);
    return refreshSnapshot.mock.calls.map(([reading, options]) => `${reading}${options?.refreshIndex ? ', may write the index' : ''}`);
  };
  return after;
}
const HINT = { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' } as const;
const WINDOW_ASKS = { type: 'commit.GET_GIT_STATUS' } as const;

// Every window showing the repository asks for its status when told it changed. When none does, none is showing
// it, and git is not asked about hints nobody would hear the answer to: an agent editing files with the code
// surface closed would otherwise run a status for every file event
it('asks git nothing about a hint while no window has asked for the status it was last told changed', async () => {
  const after = overAChangingRepository();
  expect(await after(HINT), 'the first is checked and announced').toEqual(['noted']);

  expect(await after(HINT), 'nobody asked, so nobody is looking').toEqual([]);
  expect(await after({ ...HINT, reconcile: true }), 'nor when a command or a turn ended').toEqual([]);

  expect(await after(WINDOW_ASKS), 'what was put off is checked once a window asks').toEqual(['everything']);
  expect(await after(WINDOW_ASKS), 'and once').toEqual([]);
});

it('checks at once for a window that gained focus, which is somebody looking', async () => {
  const after = overAChangingRepository();
  await after(HINT);

  expect(await after({ ...HINT, reconcile: true, byWindow: true })).toEqual(['everything']);
});

// Writing git's index holds its lock, in which a git run from a terminal is refused: it is done when a terminal
// command or an agent's turn has just ended, and never because a window gained focus or asked
it('lets git write its index when a command or a turn ended, and at no other check', async () => {
  const after = overAChangingRepository();
  const andAWindowAsked = async (event: Parameters<typeof after>[0]) => {
    const read = await after(event);
    await after(WINDOW_ASKS);
    return read;
  };

  expect(await andAWindowAsked({ ...HINT, reconcile: true })).toEqual(['everything, may write the index']);
  expect(await andAWindowAsked({ ...HINT, reconcile: true, byWindow: true })).toEqual(['everything']);
  expect(await andAWindowAsked(HINT)).toEqual(['noted']);

  await after(HINT);
  await after({ ...HINT, reconcile: true });
  expect(await after(WINDOW_ASKS), 'nor when a check that was put off is made').toEqual(['everything']);
});

