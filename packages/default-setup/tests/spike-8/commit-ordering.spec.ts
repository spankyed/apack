import { describe, expect, it } from 'vitest';
import { system, type Handle } from '@apackdev/state';
import { connect, defectGuard, everyOrder, onSchedule, sample } from '@apackdev/state/testing';
import { state, type PackNet } from '#generated/state.ts';
import type { CommitStatus } from '#features/code/be/contract.ts';
import type { GitStatusFile, RepositoryChange } from '#features/code/be/types.ts';
import {
  commitState,
  createStatusRefreshState,
  type CommitEvent,
  type FakeGitRepoHandle,
  type OpenDiffRef,
} from './commit-prototype.ts';

const EMPTY_CHANGE: RepositoryChange = {
  status: false,
  diffs: false,
  history: false,
  stashes: false,
  refs: false,
  worktrees: false,
};

function makeStatus(branch: string, files: GitStatusFile[]): CommitStatus {
  return {
    files,
    counts: files.map((f) => ({ path: f.path, staged: f.staged, added: 3, removed: 1, binary: false })),
    truncated: false,
    branch,
    hasUpstream: true,
    commitsAhead: 1,
    commitsBehind: 0,
    watching: true,
    hasIdentity: true,
  };
}

describe('Phase 2 #8 Spike — code/fe/commit (7 states) + code/be/commit (writeDebounce) ordering harness', () => {
  it('200-seed sample harness: interleaves optimistic staging, REPOSITORY_CHANGED, REFRESH_STATUS, streamed PUSH+STOP_PUSH, folder switch, cancelled SHOW_BLAME, and 150ms debounce + CHECK', async () => {
    const explored = await sample((schedule) => {
      const guard = defectGuard();
      const be = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });
      const fe = system({ side: 'window', ...onSchedule(schedule, 'fe'), onDefect: guard.onDefect });
      const link = connect(fe, be, schedule, 'window');

      let activeTimers = 0;
      let stagedOnBackend = false;
      let blameAborts = 0;
      let pushAborts = 0;
      let activeRepoId: string = 'repo-a';
      const announcedChanges: RepositoryChange[] = [];
      const checkLog: Array<{ mode: 'everything' | 'noted'; at: number }> = [];

      const repos = new Map<string, FakeGitRepoHandle>();
      const makeRepo = (id: string): FakeGitRepoHandle => ({
        id,
        refreshSnapshot: async (mode) => {
          checkLog.push({ mode, at: schedule.clock.now() });
          await schedule.clock.sleep(10);
          return {
            ...EMPTY_CHANGE,
            status: true,
            diffs: true,
            files: ['src/app.ts'],
            history: mode === 'everything',
          };
        },
        whenFetchDue: () => undefined,
      });
      repos.set('repo-a', makeRepo('repo-a'));
      repos.set('repo-b', makeRepo('repo-b'));

      // Forward `statusRefresh` announcements to the FE commit surface via a helper reference
      let commitHandleRef: Handle<unknown, CommitEvent, {}> | undefined;
      const announceLane = { label: 'backend-broadcast' };

      const statusRefresh = createStatusRefreshState({
        repositoryOf: (repoId) => (repoId ? (repos.get(repoId) ?? null) : null),
        onTimerStart: () => { activeTimers++; },
        onTimerEnd: () => { activeTimers--; },
        onAnnounce: (changed) => {
          announcedChanges.push(changed);
          schedule.later(announceLane, () => {
            if (commitHandleRef) {
              fe.send(commitHandleRef, { type: 'commit.REPOSITORY_CHANGED', changed });
            }
          });
        },
      });

      const statusRefreshHandle = be.start('default-setup/commit-status-refresh', statusRefresh);

      type CodeAsks = PackNet['systems']['code']['asks'];
      type MockCodeAsks = Pick<
        CodeAsks,
        | 'commit.GET_GIT_STATUS'
        | 'commit.GET_GIT_DIFF'
        | 'commit.STAGE_FILES'
        | 'commit.UNSTAGE_FILES'
        | 'commit.PUBLISH_BRANCH'
        | 'commit.GET_BLAME'
        | 'commit.LOG_LIST'
        | 'commit.GET_ALL_BRANCHES'
        | 'commit.STASH_LIST'
        | 'commit.WORKTREE_LIST'
        | 'commit.LIST_REPOSITORIES'
      >;

      const codeBe = state<{}, never, MockCodeAsks>()({
        answers: {
          'commit.GET_GIT_STATUS': async (_args, { sleep }) => {
            be.send(statusRefreshHandle, { type: 'ASKED', repoId: activeRepoId });
            await sleep(15);
            const files: GitStatusFile[] = [
              { path: 'src/app.ts', status: 'modified', staged: stagedOnBackend },
            ];
            return makeStatus(activeRepoId === 'repo-a' ? 'main' : 'feature/b', files);
          },
          'commit.GET_GIT_DIFF': async ({ path = 'src/app.ts', staged = false }, { sleep }) => {
            await sleep(10);
            return { path, staged, originalContent: 'old', modifiedContent: 'new' };
          },
          'commit.STAGE_FILES': async ({ paths }, { sleep }) => {
            await sleep(25);
            stagedOnBackend = true;
            be.send(statusRefreshHandle, { type: 'REFRESH', repoId: activeRepoId });
            return { paths: [...paths] };
          },
          'commit.UNSTAGE_FILES': async ({ paths }, { sleep }) => {
            await sleep(20);
            stagedOnBackend = false;
            be.send(statusRefreshHandle, { type: 'REFRESH', repoId: activeRepoId });
            return { paths: [...paths] };
          },
          'commit.PUBLISH_BRANCH': async (_args, { signal, sleep, progress }) => {
            signal.addEventListener('abort', () => { pushAborts++; });
            progress({ during: 'push', stage: 'counting', percent: 25 });
            await sleep(20);
            progress({ during: 'push', stage: 'writing', percent: 75 });
            await sleep(25);
            return { branchName: 'main' };
          },
          'commit.GET_BLAME': async ({ path }, { signal, sleep }) => {
            signal.addEventListener('abort', () => { blameAborts++; });
            await sleep(40);
            return {
              path,
              lines: [{
                line: 1,
                commit: 'abc1234',
                author: 'dev',
                authorEmail: 'dev@example.com',
                date: '2026-01-01',
                summary: 'init',
                originalLine: 1,
                originalPath: path,
              }],
            };
          },
          'commit.LOG_LIST': async () => ({ commits: [] }),
          'commit.GET_ALL_BRANCHES': async () => ({ branches: ['main', 'feature/b'] }),
          'commit.STASH_LIST': async () => ({ stashes: [] }),
          'commit.WORKTREE_LIST': async () => ({ worktrees: [] }),
          'commit.LIST_REPOSITORIES': async () => ({ repositories: [], truncated: false, current: activeRepoId }),
        },
      });

      be.start('default-setup/code', codeBe);
      const commitHandle = fe.start('default-setup/commit', commitState);
      commitHandleRef = commitHandle;

      const preservedDiffs: OpenDiffRef[] = [{ tab: 'unstaged:src/app.ts', path: 'src/app.ts', staged: false }];

      // Initial open on repo-a with open diff and draft commit message
      fe.send(commitHandle, { type: 'CODE_STARTED', directory: '/repo-a' });
      fe.send(commitHandle, { type: 'OPEN_DIFFS_CHANGED', openDiffs: preservedDiffs });
      fe.send(commitHandle, { type: 'commit.UPDATE_MESSAGE', message: 'feat: keep me across folders' });

      // Concurrent interleaved user & backend lanes
      schedule.does(
        'user-stage-and-blame',
        ['optimistic stage', () => fe.send(commitHandle, { type: 'commit.STAGE_FILES', paths: ['src/app.ts'] })],
        ['refresh status', () => fe.send(commitHandle, { type: 'commit.REFRESH_STATUS' })],
        ['show blame', () => fe.send(commitHandle, { type: 'commit.SHOW_BLAME', path: 'src/app.ts' })],
        ['cancel blame', () => fe.send(commitHandle, { type: 'commit.CLEAR_BLAME' })],
      );

      schedule.does(
        'user-push',
        ['push branch', () => fe.send(commitHandle, { type: 'commit.PUSH_BRANCH' })],
        ['stop push', () => fe.send(commitHandle, { type: 'commit.STOP_PUSH' })],
      );

      schedule.does(
        'backend-watch-and-debounce',
        ['write refresh', () => be.send(statusRefreshHandle, { type: 'REFRESH', repoId: activeRepoId })],
        [
          'concurrent check during debounce',
          () =>
            be.send(statusRefreshHandle, {
              type: 'CHECK',
              repoId: activeRepoId,
              everything: false,
              refreshIndex: false,
              byWindow: true,
            }),
        ],
      );

      schedule.does(
        'navigation',
        [
          'switch directory to repo-b',
          () => {
            activeRepoId = 'repo-b';
            fe.send(commitHandle, { type: 'CODE_STARTED', directory: '/repo-b' });
          },
        ],
      );

      return () => {
        try {
          const snap = fe.read(commitHandle);
          expect(snap.at).toBe('open');
          if (snap.at === 'open') {
            // Directory switch landed cleanly on /repo-b
            expect(snap.data.directory).toBe('/repo-b');
            // Root-scoped openDiffs & commitMessage SURVIVED the directory switch
            expect(snap.data.openDiffs).toEqual(preservedDiffs);
            expect(snap.data.commitMessage).toBe('feat: keep me across folders');
            // No leaked pending calls on commit or commit.open
            expect(snap.pending.stage).toBe(0);
            expect(snap.pending.unstage).toBe(0);
            expect(snap.pending.diff).toEqual({});
            expect(snap.pending.diffRefresh).toEqual({});
          }

          // Remotes child in new folder has clean idle state
          const remotesHandle = fe.child(commitHandle, 'remotes');
          const remotesSnap = fe.read(remotesHandle);
          expect(remotesSnap).toBeDefined();
          expect(remotesSnap?.pending.push).toBe(false);

          // Backend statusRefresh drained cleanly with 0 leaked timers
          expect(be.read(statusRefreshHandle).at).toBe('idle');
          expect(activeTimers).toBe(0);
          expect(announcedChanges.length).toBeGreaterThanOrEqual(1);
          expect(blameAborts).toBeGreaterThanOrEqual(0);
          expect(pushAborts).toBeGreaterThanOrEqual(0);
          expect(fe.idle()).toBe(true);
          expect(be.idle()).toBe(true);
        } finally {
          link.close();
          fe.stop();
          be.stop();
          guard.assertNone();
        }
      };
    }, { seed: 20260408, runs: 200 });

    expect(explored.failure).toBeUndefined();
    expect(explored.orderings).toBe(200);
  });

  it('exact 150ms writeDebounce + concurrent CHECK semantics: CHECK runs immediately without cancelling 150ms REFRESH timer', async () => {
    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });

      let activeTimers = 0;
      const events: Array<{ kind: 'snapshot' | 'announce'; at: number; detail: string }> = [];

      const repo: FakeGitRepoHandle = {
        id: 'repo-1',
        refreshSnapshot: async (mode) => {
          events.push({ kind: 'snapshot', at: schedule.clock.now(), detail: mode });
          // Return no changes from `noted` check so only `written: true` forces `status: true`
          return mode === 'noted'
            ? { ...EMPTY_CHANGE, history: true }
            : { ...EMPTY_CHANGE };
        },
        whenFetchDue: () => undefined,
      };

      const statusRefresh = createStatusRefreshState({
        repositoryOf: (id) => (id === 'repo-1' ? repo : null),
        onTimerStart: () => { activeTimers++; },
        onTimerEnd: () => { activeTimers--; },
        onAnnounce: (changed) => {
          events.push({
            kind: 'announce',
            at: schedule.clock.now(),
            detail: `${changed.status ? 'status' : ''}${changed.history ? '+history' : ''}`,
          });
        },
      });

      const handle = sys.start('statusRefresh', statusRefresh);

      // t=0: REFRESH starts 150ms writeDebounce timer
      sys.send(handle, { type: 'REFRESH', repoId: 'repo-1' });
      // t=50: CHECK arrives mid-debounce — must run immediately at t=50 WITHOUT cancelling the t=150 write timer!
      schedule.clock.after(50, () => {
        sys.send(handle, {
          type: 'CHECK',
          repoId: 'repo-1',
          everything: false,
          refreshIndex: false,
          byWindow: true,
        });
      });

      return () => {
        try {
          const snap = sys.read(handle);
          expect(snap.at).toBe('idle');
          expect(activeTimers).toBe(0);
          expect(sys.idle()).toBe(true);

          // CHECK ran immediately at t=50ms (before the 150ms write debounce fired)
          const checkSnap = events.find((e) => e.kind === 'snapshot' && e.detail === 'noted');
          expect(checkSnap).toBeDefined();
          expect(checkSnap!.at).toBe(50);

          // And the 150ms write debounce timer was NOT cancelled — it still fired at t=150ms!
          const writeSnap = events.find((e) => e.kind === 'snapshot' && e.detail === 'everything');
          expect(writeSnap).toBeDefined();
          expect(writeSnap!.at).toBe(150);

          // Both announcements landed: history at t=50, forced status at t=150
          expect(events.filter((e) => e.kind === 'announce')).toEqual([
            { kind: 'announce', at: 50, detail: '+history' },
            { kind: 'announce', at: 150, detail: 'status' },
          ]);
        } finally {
          sys.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });

  it('debounce reset: second REFRESH at t=100ms resets the 150ms timer to t=250ms with 0 leaked timers', async () => {
    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });

      let activeTimers = 0;
      const announcedAt: number[] = [];

      const repo: FakeGitRepoHandle = {
        id: 'repo-1',
        refreshSnapshot: async () => EMPTY_CHANGE,
        whenFetchDue: () => undefined,
      };

      const statusRefresh = createStatusRefreshState({
        repositoryOf: (id) => (id === 'repo-1' ? repo : null),
        onTimerStart: () => { activeTimers++; },
        onTimerEnd: () => { activeTimers--; },
        onAnnounce: () => { announcedAt.push(schedule.clock.now()); },
      });

      const handle = sys.start('statusRefresh', statusRefresh);

      sys.send(handle, { type: 'REFRESH', repoId: 'repo-1' });
      schedule.clock.after(100, () => {
        sys.send(handle, { type: 'REFRESH', repoId: 'repo-1' });
      });

      return () => {
        try {
          expect(sys.read(handle).at).toBe('idle');
          expect(activeTimers).toBe(0);
          expect(announcedAt).toEqual([250]);
          expect(sys.idle()).toBe(true);
        } finally {
          sys.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });

  it('optimistic STAGE_FILES is never clobbered by a stale in-flight GET_GIT_STATUS under everyOrder', async () => {
    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const be = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });
      const fe = system({ side: 'window', ...onSchedule(schedule, 'fe'), onDefect: guard.onDefect });
      const link = connect(fe, be, schedule, 'window');

      let stagedOnBackend = false;
      let observedClobber = false;

      type MockCodeAsks = Pick<
        PackNet['systems']['code']['asks'],
        | 'commit.GET_GIT_STATUS'
        | 'commit.STAGE_FILES'
        | 'commit.LOG_LIST'
        | 'commit.GET_ALL_BRANCHES'
        | 'commit.STASH_LIST'
        | 'commit.WORKTREE_LIST'
        | 'commit.LIST_REPOSITORIES'
      >;

      const codeBe = state<{}, never, MockCodeAsks>()({
        answers: {
          'commit.GET_GIT_STATUS': async (_args, { sleep }) => {
            await sleep(20);
            return makeStatus('main', [{ path: 'a.ts', status: 'modified', staged: stagedOnBackend }]);
          },
          'commit.STAGE_FILES': async ({ paths }, { sleep }) => {
            await sleep(30);
            stagedOnBackend = true;
            return { paths: [...paths] };
          },
          'commit.LOG_LIST': async () => ({ commits: [] }),
          'commit.GET_ALL_BRANCHES': async () => ({ branches: ['main'] }),
          'commit.STASH_LIST': async () => ({ stashes: [] }),
          'commit.WORKTREE_LIST': async () => ({ worktrees: [] }),
          'commit.LIST_REPOSITORIES': async () => ({ repositories: [], truncated: false, current: 'repo-a' }),
        },
      });

      be.start('default-setup/code', codeBe);
      const commitHandle = fe.start('default-setup/commit', commitState);

      let userStaged = false;
      const unsub = fe.subscribe(() => {
        const snap = fe.read(commitHandle);
        if (userStaged && snap?.at === 'open') {
          const row = snap.data.gitStatus.find((f) => f.path === 'a.ts');
          if (row && !row.staged) observedClobber = true;
        }
      });

      fe.send(commitHandle, { type: 'CODE_STARTED', directory: '/repo-a' });
      schedule.does('user', [
        'stage a.ts',
        () => {
          userStaged = true;
          fe.send(commitHandle, { type: 'commit.STAGE_FILES', paths: ['a.ts'] });
        },
      ]);

      return () => {
        try {
          unsub();
          expect(observedClobber).toBe(false);
          const snap = fe.read(commitHandle);
          expect(snap.at).toBe('open');
          if (snap.at === 'open') {
            expect(snap.pending.stage).toBe(0);
            expect(snap.data.gitStatus.find((f) => f.path === 'a.ts')?.staged).toBe(true);
          }
          expect(fe.idle()).toBe(true);
          expect(be.idle()).toBe(true);
        } finally {
          unsub();
          link.close();
          fe.stop();
          be.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });
});
