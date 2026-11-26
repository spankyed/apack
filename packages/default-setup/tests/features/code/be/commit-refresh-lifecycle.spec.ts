import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { state, system, type Clock, type System } from '@apackdev/state';
import { commitSystem, type CommitReport, type Event as CommitEvent } from '../../../../src/features/code/be/features/commit.ts';
import type { AppGitRepository } from '../../../../src/features/code/be/services/app-git-repository.ts';
import type { RepositoryChange } from '../../../../src/features/code/be/types.ts';

const systems: System[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  systems.splice(0).forEach((sys) => sys.stop());
  vi.useRealTimers();
});

const timerClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function startCommit(options: { baseDirectory: string | null; gitRepository?: AppGitRepository | null } = { baseDirectory: null }) {
  const announced = vi.fn<(changed: RepositoryChange) => void>();
  const reported = vi.fn<(event: CommitReport) => void>();

  const parent = state<
    { starts: { commit: typeof commitSystem } },
    CommitEvent | (CommitReport & { from?: string })
  >()({
    starts: (s) => ({
      commit: s(commitSystem, {
        given: () => ({
          baseDirectory: options.baseDirectory,
          gitRepository: options.gitRepository ?? null,
        }),
      }),
    }),
    on: {
      'commit.UPDATE_BASE_DIRECTORY': (event, { tell, child }) => {
        tell(child('commit'), event);
      },
      'commit.GIT_STATUS_CHANGED': (event, { tell, child }) => {
        tell(child('commit'), event);
      },
      'commit.REPOSITORY_MAY_HAVE_CHANGED': (event, { tell, child }) => {
        tell(child('commit'), event);
      },
      REPOSITORY_CHANGED: () => {},
      GIT_STATUS_CHANGED: () => {
        reported({ type: 'GIT_STATUS_CHANGED' });
      },
      CHECK_FOR_EXTERNAL_CHANGES: () => {
        reported({ type: 'CHECK_FOR_EXTERNAL_CHANGES' });
      },
    },
  });

  const sys = system({ side: 'backend', clock: timerClock });
  sys.attach({
    tell: (_to, event) => {
      const payload = event as { type?: string; changed?: RepositoryChange };
      if (payload.type === 'commit.REPOSITORY_CHANGED' && payload.changed) {
        announced(payload.changed);
      }
    },
    ask: (_to, _name, _args, _progress, done) => {
      done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'unused' });
      return { stop: () => {} };
    },
  });

  const root = sys.start('default-setup/code', parent);
  const commit = sys.child(root, 'commit');
  systems.push(sys);

  return {
    send: (event: CommitEvent) => sys.send(commit, event),
    ask: sys.ask.bind(sys, commit),
    stop: () => sys.stop(),
    announced,
    reported,
  };
}

// Each window asks again for its status and history on the one announcement
it('coalesces repeated status changes into one announcement that the repository changed', async () => {
  const { send, announced } = startCommit();
  for (let i = 0; i < 3; i++) send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(149);
  expect(announced).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(announced).toHaveBeenCalledTimes(1);
});

it('cancels a pending refresh when the commit actor stops', async () => {
  const { send, stop, announced } = startCommit();
  send({ type: 'commit.GIT_STATUS_CHANGED' });
  stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(announced).not.toHaveBeenCalled();
});

// A write here changes the repository every window shows, so it is the same news as the watcher's, and no window
// is sent a listing it did not ask for
it('announces a write as the repository changing, and lists nothing itself', async () => {
  const stashDrop = vi.fn(async () => {});
  const gitRepository = {
    whenFetchDue: () => {},
    stashDrop,
    undoables: async () => [],
    refreshSnapshot: async () => NOTHING,
  } as never;
  const { ask, announced } = startCommit({ baseDirectory: '/repo', gitRepository });

  await ask('commit.STASH_DROP', { index: 0 });
  await vi.advanceTimersByTimeAsync(150);

  expect(stashDrop).toHaveBeenCalledWith(0);
  expect(announced).toHaveBeenCalledTimes(1);
});

const NOTHING = { status: false, diffs: false, history: false, stashes: false, refs: false, worktrees: false };
/** The parts each announcement so far said changed */
const announcedParts = (announced: ReturnType<typeof vi.fn<(changed: RepositoryChange) => void>>) =>
  announced.mock.calls.map(([changed]) => changed);

// A file event or a reconcile is a hint: git says which parts of the repository changed, and only those are news
it('announces a hint as the parts git says changed, one check at a time, and nothing when none did', async () => {
  let found = NOTHING;
  let release = () => {};
  const refreshSnapshot = vi.fn(
    () =>
      new Promise<typeof NOTHING>((resolve) => {
        release = () => resolve(found);
      }),
  );
  const { send, announced } = startCommit({
    baseDirectory: '/repo',
    gitRepository: { whenFetchDue: () => {}, refreshSnapshot } as never,
  });

  send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  for (let i = 0; i < 3; i++) send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
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
  const { send } = startCommit({
    baseDirectory: '/repo',
    gitRepository: { whenFetchDue: () => {}, refreshSnapshot, fetchIfDue: async () => false } as never,
  });
  const read = async (event: CommitEvent) => {
    refreshSnapshot.mockClear();
    send(event);
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
  let stops = false;
  let suspended = false;
  const gitRepository = {
    refreshSnapshot,
    get isAutoFetchSuspended() {
      return suspended;
    },
    whenFetchDue() {},
    async fetchIfDue() {
      if (stops) suspended = true;
      return false;
    },
  };
  const { send } = startCommit({ baseDirectory: '/repo', gitRepository: gitRepository as never });
  const checks = async () => {
    refreshSnapshot.mockClear();
    send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true });
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
  const { send, announced } = startCommit({
    baseDirectory: '/repo',
    gitRepository: { whenFetchDue: () => {}, refreshSnapshot } as never,
  });

  send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(refreshSnapshot).toHaveBeenCalledTimes(1);

  found = { ...NOTHING, stashes: true };
  send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(announcedParts(announced)).toEqual([
    { ...NOTHING, status: true },
    { ...NOTHING, status: true, stashes: true },
  ]);
});

// A pull request is read from commits, so an edited file is not news to it, and asking a remote about one is a
// round trip nobody needs
it('tells the pull requests only when the history changed', async () => {
  let found = NOTHING;
  const gitRepository = { whenFetchDue: () => {}, refreshSnapshot: async () => found, isGitRepository: async () => false };
  const { send, ask, reported } = startCommit({ baseDirectory: '/repo', gitRepository: gitRepository as never });

  // A window showing the repository asks for its status each time it is told that changed
  const aWindowAsks = async () => {
    await ask('commit.GET_GIT_STATUS', {});
    await vi.advanceTimersByTimeAsync(0);
  };
  send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(150);
  expect(reported).not.toHaveBeenCalled();
  await aWindowAsks();

  found = { ...NOTHING, status: true };
  send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(reported).not.toHaveBeenCalled();
  await aWindowAsks();

  found = { ...NOTHING, history: true, worktrees: true };
  send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(reported.mock.calls).toEqual([[{ type: 'GIT_STATUS_CHANGED' }]]);
});

/** A commit system over a stand-in repository whose every check finds its status changed, with what was read each time */
function overAChangingRepository() {
  const refreshSnapshot = vi.fn(async (_reading?: string, _options?: { refreshIndex?: boolean }) => ({
    ...NOTHING,
    status: true,
  }));
  const gitRepository = {
    whenFetchDue: () => {},
    refreshSnapshot,
    isGitRepository: async () => false,
    fetchIfDue: async () => false,
    isAutoFetchSuspended: false,
  };
  const { send, ask } = startCommit({ baseDirectory: '/repo', gitRepository: gitRepository as never });
  const after = async (event: CommitEvent | typeof WINDOW_ASKS) => {
    refreshSnapshot.mockClear();
    if (event.type === 'commit.GET_GIT_STATUS') await ask('commit.GET_GIT_STATUS', {});
    else send(event);
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
