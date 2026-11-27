import { given, state as standaloneState, type Read } from '@apackdev/state';
import type { CommitAsks, GitFailure } from '../contract.ts';
import { featureSettings } from '#generated/settings.ts';
import { tell as busTell } from '#generated/events.ts';
import { state } from '#generated/state.ts';
import { currentClient, type NormalizeAsks } from '@apackdev/sdk/events';

import {
  GitError,
  GitUnusableError,
  HookRefusedError,
  NOTHING_CHANGED,
  StashConflictError,
  UnsafeOwnershipError,
  UntrustedError,
  changedAnything,
} from '@apackdev/git';
import type { HistoryCommit, HistoryPage, JournalEntry, RewriteStep } from '@apackdev/git';
import { openGitRepository, trustRepository, type AppGitRepository } from '../services/app-git-repository.ts';
import { storedSignIn } from './github.ts';
import { isHostName } from '../services/sign-in.ts';
import type { CommitFailure, GitProgress, ProgressDuring, RepositoryChange, RewriteAction } from '../types.ts';

/**
 * A message as the panel commits it: without the trailers the code settings name (`trailersRemovedOnCommit`), by
 * key whatever its case, as git reads a key
 */
function asCommitted(repository: AppGitRepository, message: string): Promise<string> {
  const removed = new Set(featureSettings.forFeature('code').get().trailersRemovedOnCommit.map((key) => key.toLowerCase()));
  return removed.size === 0
    ? Promise.resolve(message)
    : repository.withoutTrailers(message, ({ key }) => removed.has(key.toLowerCase()));
}

/**
 * Tells whoever asked for a push, a pull, a checkout or a submodule update how far along it is, as git says, through
 * the ask's own `progress`
 */
const progressDuring =
  (progress: (update: { during: ProgressDuring } & GitProgress) => void, during: ProgressDuring) => (said: GitProgress) => {
    progress({ during, ...said });
  };

/** What the user can do about a git that cannot be used */
const WHAT_TO_DO = {
  'git-not-found': 'Install Git from git-scm.com, or set where it is under Settings, CLI providers.',
  'developer-tools-missing': 'Install them with `xcode-select --install`, or install Git another way and set where it is under Settings, CLI providers.',
  'git-too-old': 'Update Git, or set a newer one under Settings, CLI providers.',
} as const;

/**
 * The newest write the panel's undo takes back: the engine lists every write it can (`undoables`), discards among
 * them, and a discard is put back from the change it removed (`restoreDiscarded`), not from the panel's undo
 */
async function lastUndoable(repo: AppGitRepository): Promise<JournalEntry | undefined> {
  return (await repo.undoables()).find(({ entry }) => entry.operation !== 'discard')?.entry;
}

/**
 * What Undo would take back now, for the answer to a write that can be taken back: the last write in the repository's
 * journal, unless another window or process made one since. Absent when it cannot be read, which leaves what the
 * window holds as it was
 */
async function undoableAfter(repository: AppGitRepository): Promise<{ undoable?: { id: string; summary: string } | null }> {
  try {
    const entry = await lastUndoable(repository);
    return { undoable: entry ? { id: entry.id, summary: entry.summary } : null };
  } catch {
    return {};
  }
}

/** The furthest back the panel's rewrites reach, in commits from what is checked out */
const REWRITE_REACH = 1000;

/**
 * What rewriting one commit asks of the engine: the commits from the one the rewrite starts after to what is checked
 * out, oldest first, each kept but `hash`, which is reworded, folded into the one before it or dropped. Refused for a
 * commit what is checked out does not hold, for a range with a merge in it, which a rewrite would flatten, and for a
 * fold of a first commit, which has nothing before it.
 */
async function rewriteOf(
  repository: AppGitRepository,
  hash: string,
  action: RewriteAction,
  message?: string,
): Promise<{ base: string; steps: RewriteStep[] }> {
  const line: HistoryCommit[] = [];
  // A fold reaches one further, to the commit it is folded into
  let found = false;
  let cursor: string | undefined;
  while (line.length < REWRITE_REACH) {
    const page = await repository.history({ cursor, limit: LOG_PAGE });
    for (const commit of page.commits) {
      if (commit.parents.length > 1) throw new Error('A merge is among these commits, and rewriting them would flatten it.');
      line.push(commit);
      if (found || (commit.hash === hash && action !== 'squash')) {
        const base = commit.parents[0];
        if (!base) throw new Error('The first commit has nothing before it to rewrite after.');
        return {
          base,
          steps: line.reverse().map(({ hash: each }) => ({
            commit: each,
            action: each === hash ? action : 'pick',
            ...(each === hash && message !== undefined && { message }),
          })),
        };
      }
      if (commit.hash === hash) found = true;
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  throw new Error(
    found
      ? 'The first commit has nothing before it to be folded into.'
      : 'That commit is not among the last ones of what is checked out.',
  );
}

/**
 * Whether turning git's speed-ups on would change anything for a slow status: its untracked cache is off, or its
 * file monitor is, on a system git has one for (macOS and Windows). Linux has none, so a status that is slow with the
 * cache on is offered nothing
 */
function canSpeedUp({ fileMonitor, untrackedCache }: { fileMonitor: boolean; untrackedCache: boolean }): boolean {
  return !untrackedCache || (!fileMonitor && FILE_MONITOR_HERE);
}

/** Whether git has a file monitor of its own on this system */
const FILE_MONITOR_HERE = process.platform === 'darwin' || process.platform === 'win32';

/** How many commits a page of the panel's history holds */
const LOG_PAGE = 100;

/** The most changed files whose lines are counted with the status: past it the list is scrolled, not read */
const COUNTED_FILES = 500;

/** What the panel is told of a command that failed: git's words, and why it failed where git said */
function failureOf(error: unknown): CommitFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    message,
    ...(error instanceof GitError && error.code && { code: error.code }),
    // Refused before git was run: what the repository would have had it run, for the panel to ask about
    ...(error instanceof UntrustedError &&
      error.repository && { trust: { repository: error.repository, asks: error.asks } }),
    // Refused by git for who owns the repository: the path it named, for the panel to offer to trust
    ...(error instanceof UnsafeOwnershipError && { ownership: { directory: error.directory } }),
    // A hook of the repository's refused it: which, how it exited, and what it printed, said as the hook's
    ...(error instanceof HookRefusedError && {
      message: `The ${error.hook} hook refused it (exit code ${error.exitCode}).`,
      hook: { name: error.hook, exitCode: error.exitCode, output: error.output.trim() },
    }),
    // No git to run, or one that cannot be used: what to do about it, after what the engine said
    ...(error instanceof GitUnusableError && { message: `${message} ${WHAT_TO_DO[error.unusable.code]}` }),
  };
}

/** The same for a push or a pull, which the panel can run again, with what can be done when the remote asked for a sign-in */
async function remoteFailureOf(error: unknown, during: 'push' | 'pull', repository: AppGitRepository): Promise<CommitFailure> {
  const failure = failureOf(error);
  const signIn = failure.code === 'authentication' ? await repository.signInHelp().catch(() => undefined) : undefined;
  return { ...failure, during, ...(signIn && { signIn }) };
}

type GitRefusal = (kind: 'git', message: string, data?: GitFailure) => Error;
type PublishedRefusal = GitRefusal & ((kind: 'published', message: string) => Error);

/** Marks errors already built via `scope.refuse(...)` so `git(...)` re-throws them unchanged */
const alreadyRefused = new WeakSet<Error>();

function refuseWith<E extends Error>(error: E): E {
  alreadyRefused.add(error);
  return error;
}

/**
 * A rewrite or an undo a remote branch already holds commits of is the user's to go on with: refused as `published`,
 * which the window asks about
 */
const published = (error: unknown, refuse: PublishedRefusal): Error | undefined =>
  (error as { code?: string }).code === 'published' ? refuseWith(refuse('published', (error as Error).message)) : undefined;

/** Runs a commit ask's work, refusing it with a `git` failure when it throws */
async function git<T>(refuse: GitRefusal, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && alreadyRefused.has(error)) throw error;
    const { message, ...data } = failureOf(error);
    throw refuse('git', message, data);
  }
}

/** A remote command that failed, refused with what can be done about it (`remoteFailureOf`) */
async function remoteRefusal(
  refuse: GitRefusal,
  error: unknown,
  during: 'push' | 'pull',
  repository: AppGitRepository,
): Promise<Error> {
  const { message, ...data } = await remoteFailureOf(error, during, repository);
  return refuse('git', message, data);
}

/** The repository this machine is over, for an ask that runs git: an ask made with none is refused */
function repositoryIn(repository: Read<AppGitRepository> | null): AppGitRepository {
  if (!repository) throw new Error('No directory selected. Please select a directory first.');
  return repository as AppGitRepository;
}

/** Triggers the brain flow that generates a commit message (role-addressed so any pack providing brain handles it). */
function triggerCommitGenerate(payload: {
  diff: string;
  branch: string;
  repoName: string;
  provider: string;
  client?: string;
}): void {
  busTell(
    { role: 'brain' },
    {
      type: 'TRIGGER_BRAIN_EVENT',
      eventType: 'commit.generate',
      payload,
    },
  );
}

// ── Write debounce + serialized status refresh child machines ─────────────────────────────────────

/**
 * `everything` when there is no watcher's event to go by, and the whole repository is read again;
 * `refreshIndex` when this is a moment git's index may be written at
 */
interface RefreshRequest {
  repository: AppGitRepository | null;
  written: boolean;
  everything: boolean;
  refreshIndex: boolean;
}

const mergeRequest = (one: Read<RefreshRequest>, other: Read<RefreshRequest> | null): Read<RefreshRequest> =>
  other?.repository !== one.repository
    ? one
    : {
        repository: one.repository,
        written: one.written || other.written,
        everything: one.everything || other.everything,
        refreshIndex: one.refreshIndex || other.refreshIndex,
      };

/**
 * Coalesces bursts of local writes (150ms trailing edge) before asking `statusRefresh` to check the repository.
 * Self-target re-entry on `waiting` cancels the previous 150ms `sleep` and starts a fresh window; exiting cancels
 * any pending timer immediately.
 */
const writeDebounceState = standaloneState<
  {
    reports: { type: 'WRITE_DUE'; repository: AppGitRepository | null };
    states: {
      idle: {};
      waiting: { data: { repository: AppGitRepository | null } };
    };
  },
  { type: 'REFRESH'; repository: AppGitRepository | null } | { type: 'CANCEL' }
>()({
  initial: 'idle',
  states: {
    idle: {
      on: {
        REFRESH: ({ repository }) => ({ at: 'waiting', data: { repository } }),
        CANCEL: () => {},
      },
    },
    waiting: {
      data: { repository: given },
      run: async ({ data, sleep, report }) => {
        await sleep(150);
        report({ type: 'WRITE_DUE', repository: data.repository });
        return { at: 'idle' };
      },
      failed: () => ({ at: 'idle' }),
      on: {
        REFRESH: ({ repository }) => ({ at: 'waiting', data: { repository } }),
        CANCEL: () => ({ at: 'idle' }),
      },
    },
  },
});

/**
 * Turns what may be a change into the one announcement of it, which says which parts of the repository changed.
 *
 * `CHECK` is a hint — a file event, a reconcile — so git is asked, and what differs from the last check is
 * announced, or nothing when nothing does. `REFRESH` is a write made here, checked once the writes that
 * arrive together have: its status is announced whatever the check finds, since the window that made it is
 * waiting to show it, and the other parts only when they differ — staging a file moves no commit, so it asks
 * nobody for the log or a pull request again. Checking is also what keeps the file event that write causes
 * from being announced a second time. One check runs at a time, and whatever arrives during it is one more.
 */
const statusRefreshState = standaloneState<
  {
    data: {
      repository: AppGitRepository | null;
      generation: number;
      next: RefreshRequest | null;
      /**
       * Whether a changed status was announced and no window has asked for it since. Every window showing the
       * repository asks when it hears that, so none asking means none is: a hint that arrives then is `owed`,
       * and git is asked when a window next does
       */
      unasked: boolean;
      owed: RefreshRequest | null;
    };
    internal: {
      type: 'CHECK_FINISHED';
      changed: RepositoryChange | null;
      generation: number;
      repository: AppGitRepository | null;
    };
    reports: { type: 'REPOSITORY_CHANGED'; changed: RepositoryChange };
    starts: { debounce: typeof writeDebounceState };
    states: {
      idle: {};
      checking: { data: { current: RefreshRequest } };
    };
  },
  | { type: 'RESET'; repository: AppGitRepository | null }
  | { type: 'REFRESH'; repository: AppGitRepository | null }
  | { type: 'CHECK'; repository: AppGitRepository | null; everything: boolean; refreshIndex: boolean; byWindow: boolean }
  | { type: 'ASKED'; repository: AppGitRepository | null }
  | { type: 'WRITE_DUE'; repository: AppGitRepository | null; from?: string }
>()({
  data: {
    repository: given,
    generation: 0,
    next: null,
    unasked: false,
    owed: null,
  },
  initial: 'idle',
  starts: () => ({ debounce: writeDebounceState }),
  on: {
    RESET: ({ repository }, { data, tell, child }) => {
      tell(child('debounce'), { type: 'CANCEL' });
      return {
        at: 'idle',
        data: {
          repository,
          generation: data.generation + 1,
          next: null,
          unasked: false,
          owed: null,
        },
      };
    },
    REFRESH: ({ repository }, { data, tell, child }) => {
      if (repository !== data.repository) return;
      tell(child('debounce'), { type: 'REFRESH', repository });
    },
  },
  states: {
    idle: {
      on: {
        ASKED: ({ repository }, { data }) => {
          if (repository !== data.repository) return;
          const waiting = data.owed;
          // What was put off is checked now, for the windows that did not ask as well as the one that did
          if (waiting && waiting.repository === repository) {
            return { at: 'checking', data: { current: waiting, unasked: false, owed: null } };
          }
          return { data: { unasked: false, owed: null } };
        },
        CHECK: (ev, { data }) => {
          if (ev.repository !== data.repository) return;
          const asked: RefreshRequest = {
            repository: ev.repository,
            written: false,
            everything: ev.everything,
            refreshIndex: ev.refreshIndex,
          };
          // A window that gained focus is somebody looking, whatever it has asked for.
          // Put off, it is checked whenever a window next asks, which is not a moment chosen to write the index at
          if (data.unasked && !ev.byWindow) {
            return { data: { owed: { ...mergeRequest(asked, data.owed), refreshIndex: false } } };
          }
          return { at: 'checking', data: { current: asked } };
        },
        WRITE_DUE: ({ repository }, { data }) => {
          if (repository !== data.repository) return;
          return {
            at: 'checking',
            data: { current: { repository, written: true, everything: true, refreshIndex: false } },
          };
        },
      },
    },
    checking: {
      data: { current: given },
      run: async ({ data, send }) => {
        const req = data.current;
        const generation = data.generation;
        const found = req.repository
          ? await req.repository.refreshSnapshot(req.everything ? 'everything' : 'noted', { refreshIndex: req.refreshIndex })
          : NOTHING_CHANGED;
        const changed = req.written ? { ...found, status: true } : found;
        send({
          type: 'CHECK_FINISHED',
          changed: changedAnything(changed) ? changed : null,
          generation,
          repository: req.repository,
        });
      },
      failed: () => ({ at: 'idle', data: { next: null } }),
      on: {
        ASKED: ({ repository }, { data }) => {
          if (repository !== data.repository) return;
          const waiting = data.owed;
          if (waiting && waiting.repository === repository) {
            return { data: { unasked: false, owed: null, next: mergeRequest(waiting, data.next) } };
          }
          return { data: { unasked: false, owed: null } };
        },
        CHECK: (ev, { data }) => {
          if (ev.repository !== data.repository) return;
          const asked: RefreshRequest = {
            repository: ev.repository,
            written: false,
            everything: ev.everything,
            refreshIndex: ev.refreshIndex,
          };
          if (data.unasked && !ev.byWindow) {
            return { data: { owed: { ...mergeRequest(asked, data.owed), refreshIndex: false } } };
          }
          return { data: { next: mergeRequest(asked, data.next) } };
        },
        WRITE_DUE: ({ repository }, { data }) => {
          if (repository !== data.repository) return;
          return {
            data: {
              next: mergeRequest({ repository, written: true, everything: true, refreshIndex: false }, data.next),
            },
          };
        },
      },
      internal: {
        CHECK_FINISHED: ({ changed, generation, repository }, { data, report }) => {
          if (generation !== data.generation || repository !== data.repository) {
            return { at: 'idle', data: { next: null } };
          }
          if (changed) {
            report({ type: 'REPOSITORY_CHANGED', changed });
          }
          const nextUnasked = changed?.status ? true : data.unasked;
          if (data.next && data.next.repository === data.repository) {
            return {
              at: 'checking',
              data: { current: data.next, next: null, unasked: nextUnasked },
            };
          }
          return { at: 'idle', data: { next: null, unasked: nextUnasked } };
        },
      },
    },
  },
});

// ── Background fetch coordinator tied to commitSystem's lifetime ──────────────────────────────────

/**
 * Owns `whenFetchDue` subscription and background `fetchIfDue()` runs for the active repository, on the
 * commit system's lifetime so background fetches started during `GET_GIT_STATUS` or `reconcile` outlive
 * their ask and tear down cleanly when the repository changes or the commit system stops.
 */
class FetchCoordinator {
  private active = true;
  private current: AppGitRepository | null = null;

  constructor(private readonly notifyChanged: () => void) {}

  bind(repository: AppGitRepository | null): void {
    if (this.current === repository) return;
    this.current?.whenFetchDue(undefined);
    this.current = repository;
    if (!this.active || !repository) return;
    repository.whenFetchDue(() => {
      if (this.active && this.current === repository) {
        this.fetchInBackground(repository);
      }
    });
  }

  /**
   * Fetches from the remote when a fetch is due, behind whoever asked, and has the repository checked once it has:
   * what the fetch brought is then announced like any other change. Nobody waits on the network for an answer.
   */
  fetchInBackground(repository: AppGitRepository): void {
    const suspended = repository.isAutoFetchSuspended;
    void repository.fetchIfDue().then((fetched) => {
      if (!this.active || this.current !== repository) return;
      // What a fetch brought is one thing to announce. That fetching has stopped, or started again, is another
      if (fetched || repository.isAutoFetchSuspended !== suspended) {
        this.notifyChanged();
      }
    });
  }

  stop(): void {
    this.active = false;
    this.current?.whenFetchDue(undefined);
    this.current = null;
  }
}

// ── Commit child system ───────────────────────────────────────────────────────────────────────────

export interface CodeCommitSystemContext {
  baseDirectory: string | null;
  gitRepository: AppGitRepository | null;
  fetchCoordinator: FetchCoordinator | null;
}

export type CommitReport =
  | { type: 'GIT_STATUS_CHANGED' }
  | { type: 'CHECK_FOR_EXTERNAL_CHANGES' };

/** What the commit child handles: the repository moving, its hints, and statusRefresh reports */
export type Event =
  | { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: AppGitRepository }
  | { type: 'commit.GIT_STATUS_CHANGED' }
  /** A hint that the repository changed. `reconcile` says it comes from someone who knows a change is likely, not from a file event */
  | { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED'; reconcile?: boolean; byWindow?: boolean }
  | { type: 'REPOSITORY_CHANGED'; changed: RepositoryChange; from?: string };

type CommitShape = {
  data: CodeCommitSystemContext;
  internal:
    | { type: 'INIT'; gitRepository: AppGitRepository | null; fetchCoordinator: FetchCoordinator }
    | { type: 'ANNOUNCE_REPOSITORY_CHANGED'; changed: RepositoryChange };
  reports: CommitReport;
  starts: { statusRefresh: typeof statusRefreshState };
};

export const commitSystem = state<CommitShape, Event, NormalizeAsks<CommitAsks>>()({
  data: {
    baseDirectory: given,
    gitRepository: given,
    fetchCoordinator: null,
  },
  starts: (start) => ({
    statusRefresh: start(statusRefreshState, {
      given: (data) => ({ repository: data.gitRepository }),
    }),
  }),
  listen: ({ data, send }) => {
    const repo = (data.gitRepository as AppGitRepository | null) ?? (data.baseDirectory ? openGitRepository(data.baseDirectory) : null);
    const coordinator = new FetchCoordinator(() => send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' }));
    coordinator.bind(repo);
    send({ type: 'INIT', gitRepository: repo, fetchCoordinator: coordinator });
    return () => coordinator.stop();
  },
  internal: {
    INIT: ({ gitRepository, fetchCoordinator }, { tell, child }) => {
      tell(child('statusRefresh'), { type: 'RESET', repository: gitRepository });
      return {
        data: { gitRepository, fetchCoordinator },
      };
    },
    ANNOUNCE_REPOSITORY_CHANGED: ({ changed }, { broadcast, report }) => {
      broadcast('code', { type: 'commit.REPOSITORY_CHANGED', changed });
      if (changed.history || changed.refs) report({ type: 'GIT_STATUS_CHANGED' });
    },
  },
  on: {
    'commit.UPDATE_BASE_DIRECTORY': ({ path, gitRepository }, { data, tell, child }) => {
      data.fetchCoordinator?.bind(gitRepository);
      tell(child('statusRefresh'), { type: 'RESET', repository: gitRepository });
      return { data: { baseDirectory: path, gitRepository } };
    },
    'commit.GIT_STATUS_CHANGED': (_event, { data, tell, child }) => {
      tell(child('statusRefresh'), { type: 'REFRESH', repository: data.gitRepository });
    },
    /** A hint that the repository changed, from its watcher or a reconcile: git decides whether it did */
    'commit.REPOSITORY_MAY_HAVE_CHANGED': ({ reconcile = false, byWindow = false }, { data, tell, child }) => {
      const repository = data.gitRepository;
      if (!repository) return;
      // A reconcile has no event to go by. Any other hint is a watcher's, or follows a fetch, and each has
      // noted what it changed with the repository already. One that no window asked for follows a terminal
      // command or an agent's turn ending: the moment least likely to have another git running, so the one at
      // which git's index may be written
      tell(child('statusRefresh'), {
        type: 'CHECK',
        repository,
        everything: reconcile,
        refreshIndex: reconcile && !byWindow,
        byWindow,
      });
      // Someone has come back to the repository, which is when what the remote has is worth knowing
      if (reconcile) data.fetchCoordinator?.fetchInBackground(repository as AppGitRepository);
    },
    /**
     * The repository changed (on disk, or by a write here; coalesced): news for every window, saying which parts
     * of it changed, and each window asks again for what it shows of those. What a pull request shows is read
     * from the commits of the same repository, so it hears of those moving — and of nothing else.
     */
    REPOSITORY_CHANGED: ({ changed }, { broadcast, report }) => {
      broadcast('code', { type: 'commit.REPOSITORY_CHANGED', changed });
      // A pull request's head is a remote's branch, which a fetch moves as news of the refs alone
      if (changed.history || changed.refs) report({ type: 'GIT_STATUS_CHANGED' });
    },
  },
  answers: {
    'commit.GET_GIT_STATUS': async (_args, { data, tell, child, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      // Somebody is looking: whatever was put off while nobody was is checked now
      tell(child('statusRefresh'), { type: 'ASKED', repository });
      try {
        if (!(await repository.isGitRepository())) throw new Error('Not a git repository');
        const snapshot = await repository.readSnapshot();
        // Each file's count, git's own: two more processes, so not past what a person reads down a list of
        const counts = snapshot.files.length <= COUNTED_FILES ? await repository.lineCounts().catch(() => undefined) : undefined;
        // What a pull would do, worked out without moving anything: asked only when there is something to pull
        const pullPreview =
          snapshot.hasUpstream && snapshot.behind > 0 ? await repository.previewMerge('@{upstream}').catch(() => undefined) : undefined;
        // The window has its answer: what the remote has is fetched behind it, and announced if it differs
        data.fetchCoordinator?.fetchInBackground(repository);
        return {
          files: snapshot.files,
          ...(counts && { counts }),
          ...(pullPreview && { pullPreview }),
          hasIdentity: snapshot.hasIdentity,
          ...(snapshot.slowStatus &&
            canSpeedUp(snapshot.slowStatus) && {
              slowStatus: { ...snapshot.slowStatus, fileMonitorAvailable: FILE_MONITOR_HERE },
            }),
          truncated: snapshot.truncated,
          branch: snapshot.branch,
          hasUpstream: snapshot.hasUpstream,
          commitsAhead: snapshot.ahead,
          commitsBehind: snapshot.behind,
          signIn: repository.autoFetchSignIn,
          watching: !repository.hasWatchFailed,
          ...(snapshot.watchSilent && { watchSilent: true }),
          operation: snapshot.operation,
          fetchSuspended: repository.isAutoFetchSuspended,
        };
      } catch (error) {
        const { message, ...details } = failureOf(error);
        throw refuse(
          'git',
          details.code === 'not-a-repository'
            ? 'This directory is not a Git repository. Initialize with "git init" first.'
            : message,
          details,
        );
      }
    },

    'commit.GET_GIT_DIFF': (ev, { data, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const isImage = ev.path ? repository.isImageFile(ev.path) : false;
        const getContent = isImage
          ? (p: string, v: 'HEAD' | 'working' | 'index') => repository.getFileContentAsDataUrl(p, v)
          : (p: string, v: 'HEAD' | 'working' | 'index') => repository.readFileContent(p, v);

        // The editor draws the change from the file's two sides, so those are what is read: no patch is made
        const status = await repository.readStatus();
        const fileStatus =
          status.find((f) => f.path === ev.path && f.staged === (ev.staged || false)) ??
          // A file inside a folder listed as one row has no row of its own, and is untracked like the folder
          (!ev.staged && ev.path && status.some((f) => f.isDirectory && ev.path!.startsWith(f.path))
            ? { path: ev.path, status: 'untracked' as const, staged: false }
            : undefined);

        let originalContent = '';
        let modifiedContent = '';

        if (fileStatus) {
          if (fileStatus.status === 'added' || fileStatus.status === 'untracked') {
            originalContent = '';
            modifiedContent = ev.staged ? await getContent(ev.path!, 'index') : await getContent(ev.path!, 'working');
          } else if (fileStatus.status === 'deleted') {
            originalContent = ev.staged ? await getContent(ev.path!, 'HEAD') : await getContent(ev.path!, 'index');
            modifiedContent = '';
          } else if (fileStatus.status === 'renamed' || fileStatus.status === 'copied') {
            const oldPath = fileStatus.originalPath || ev.path!;
            if (ev.staged) {
              originalContent = await getContent(oldPath, 'HEAD');
              modifiedContent = await getContent(ev.path!, 'index');
            } else {
              originalContent = await getContent(ev.path!, 'index');
              modifiedContent = await getContent(ev.path!, 'working');
            }
          } else if (fileStatus.status === 'unmerged') {
            originalContent = await getContent(ev.path!, 'HEAD');
            modifiedContent = await getContent(ev.path!, 'working');
          } else {
            if (ev.staged) {
              originalContent = await getContent(ev.path!, 'HEAD');
              modifiedContent = await getContent(ev.path!, 'index');
            } else {
              originalContent = await getContent(ev.path!, 'index');
              modifiedContent = await getContent(ev.path!, 'working');
            }
          }
        } else if (ev.path) {
          // The file has no change on this side any more: both sides are what it holds now, so the diff is
          // empty, and an edit made in it is an edit to the file as it is
          originalContent = modifiedContent = await getContent(ev.path, ev.staged ? 'index' : 'working').catch(() => '');
        }

        // The pieces of the change that can be staged one at a time, cut by git from the file as it is now
        const hunks = ev.path && !isImage ? await repository.readHunks(ev.path, ev.staged || false) : [];
        // A conflicted file is shown as its three sides, in place of the markers git wrote into one file
        const sides =
          fileStatus?.status === 'unmerged' && ev.path && !isImage
            ? await repository.conflictSides(ev.path).catch(() => undefined)
            : undefined;
        const conflict = sides && !sides.binary ? { base: sides.base, ours: sides.ours, theirs: sides.theirs } : undefined;

        return {
          path: ev.path || 'all',
          staged: ev.staged || false,
          originalContent,
          modifiedContent,
          isImage,
          ...(conflict && { conflict }),
          hunks,
        };
      }),

    'commit.STAGE_FILES': ({ paths }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.stageFiles(paths);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { paths };
      }),

    'commit.UNSTAGE_FILES': ({ paths }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const status = await repository.readStatus();
        const allPaths = new Set(paths);
        for (const p of paths) {
          // The row of what is staged: a file renamed in the index and edited since has a second, unstaged row
          const fileStatus = status.find((f) => f.path === p && f.staged);
          if (fileStatus && (fileStatus.status === 'renamed' || fileStatus.status === 'copied') && fileStatus.originalPath) {
            allPaths.add(fileStatus.originalPath);
          }
        }
        await repository.unstageFiles([...allPaths]);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { paths };
      }),

    'commit.REVERT_FILE': ({ path }, { data, tell, child, broadcast, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const kept = await repository.revertFile(path);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        broadcast('code', {
          type: 'explorer.FILE_CHANGED_EXTERNALLY',
          data: { path, changeType: 'change', modifiedAt: new Date() },
        });
        return { path, kept };
      }),

    'commit.REVERT_FILES': ({ paths }, { data, tell, child, broadcast, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const kept = await repository.revertFiles(paths);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        for (const path of paths) {
          broadcast('code', {
            type: 'explorer.FILE_CHANGED_EXTERNALLY',
            data: { path, changeType: 'change', modifiedAt: new Date() },
          });
        }
        return { paths, kept };
      }),

    'commit.RESOLVE_CONFLICT': ({ path, strategy }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.resolveConflict(path, strategy);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path };
      }),

    'commit.MARK_RESOLVED': ({ path }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.stageFiles([path]);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path };
      }),

    'commit.RESOLVE_ALL_CONFLICTS': ({ strategy }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const status = await repository.readStatus();
        for (const f of status.filter((item) => item.status === 'unmerged')) {
          await repository.resolveConflict(f.path, strategy);
        }
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
      }),

    /**
     * Carries on with what git is in the middle of, leaves out the commit a rebase stopped at, or gives it up.
     * Whether it could or not, the repository may be somewhere else afterwards, so it is checked either way
     */
    'commit.MOVE_OPERATION': ({ move }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        try {
          await repository.moveOperation(move);
        } finally {
          tell(child('statusRefresh'), { type: 'REFRESH', repository });
        }
        return { move };
      }),

    'commit.AMEND': ({ message, evenIfPublished }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const committed = message === undefined ? undefined : await asCommitted(repository, message);
        await repository.amend({ message: committed, evenIfPublished }).catch((error: unknown) => {
          throw published(error, refuse) ?? error;
        });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return undoableAfter(repository);
      }),

    'commit.GET_COMMIT_MESSAGE': ({ hash }, { data, refuse }) =>
      git(refuse, async () => ({ hash, message: await repositoryIn(data.gitRepository).commitMessage(hash) })),

    'commit.READ_TRAILERS': ({ message }, { data, refuse }) =>
      git(refuse, async () => ({ message, trailers: await repositoryIn(data.gitRepository).trailersIn(message) })),

    'commit.REMOVE_TRAILER': ({ message, trailer }, { data, refuse }) =>
      git(refuse, async () => ({
        message,
        without: await repositoryIn(data.gitRepository).withoutTrailers(
          message,
          ({ key, value }) => key === trailer.key && value === trailer.value,
        ),
      })),

    'commit.REWRITE_COMMIT': ({ hash, action, message, evenIfPublished }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const { base, steps } = await rewriteOf(repository, hash, action, message);
        await repository.rewrite(base, steps, { evenIfPublished }).catch((error: unknown) => {
          throw published(error, refuse) ?? error;
        });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { hash, action, ...(await undoableAfter(repository)) };
      }),

    'commit.START_OPERATION': async ({ kind, target }, { data, tell, child, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      try {
        return await git(refuse, async () => {
          const { operation } = await repository.readSnapshot();
          if (operation) {
            throw new Error(`A ${operation.kind} of ${operation.subject} is in progress: carry it on or give it up first.`);
          }
          const started =
            kind === 'merge'
              ? repository.merge(target)
              : kind === 'rebase'
                ? repository.rebaseOnto(target)
                : repository.cherryPick([target]);
          // One that stops on a conflict is left in progress, which the status describes, to be carried on or given up
          const stopped = await started.then(
            () => false,
            async (error: unknown) => {
              if ((await repository.readSnapshot().catch(() => undefined))?.operation) return true;
              throw error;
            },
          );
          return { kind, target, stopped, ...(stopped ? {} : await undoableAfter(repository)) };
        });
      } finally {
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
      }
    },

    'commit.PREVIEW_MERGE': ({ target }, { data, refuse }) =>
      git(refuse, async () => ({ target, preview: await repositoryIn(data.gitRepository).previewMerge(target) })),

    'commit.COMMIT': async (args, { data, tell, child, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      try {
        const stagedFiles = await repository.readStagedFiles();
        if (stagedFiles.length === 0) throw new Error('No files staged for commit. Please stage files before committing.');
        const message = await asCommitted(repository, args.message);
        await repository.commit(message);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { message, ...(await undoableAfter(repository)) };
      } catch (error) {
        // What failed and why, with what can be done about it (a trust to give, a hook's output); two of git's
        // messages are said in words of the panel's
        const { message, ...details } = failureOf(error);
        const said = message.includes('nothing to commit')
          ? 'No changes to commit. Stage your changes first.'
          : message.includes('Please tell me who you are')
            ? 'Git user not configured. Run "git config --global user.email" and "git config --global user.name"'
            : message;
        throw refuse('git', said, details);
      }
    },

    'commit.GET_ALL_BRANCHES': (_args, { data, refuse }) =>
      git(refuse, async () => {
        const repo = repositoryIn(data.gitRepository);
        const [branches, refs] = await Promise.all([repo.readBranches(), repo.refsModel().catch(() => undefined)]);
        // Each local branch's standing, by the name the list gives it
        const standing = Object.fromEntries(
          (refs?.branches ?? [])
            .filter((branch) => !branch.remote)
            .map(({ name, upstream, upstreamGone, ahead, behind }) => [
              name,
              { ...(upstream && { upstream }), ...(upstreamGone && { upstreamGone }), ahead, behind },
            ]),
        );
        return { branches, standing, ...(refs && { tags: refs.tags }) };
      }),

    /**
     * Checks out a branch there is, and with `pull` pulls it once it is checked out, when it follows one. A name no
     * branch has is refused with the name, which the panel offers to make; a pull that fails after the checkout is
     * refused as the pull's failure, the checkout having happened
     */
    'commit.CHECKOUT_BRANCH': async ({ branchName, pull }, { data, tell, child, progress, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      try {
        await repository.checkoutBranch(branchName, progressDuring(progress, 'checkout'));
      } catch (error) {
        const { message, ...details } = failureOf(error);
        throw refuse('git', message, details.code === 'unknown-ref' ? { ...details, missingBranch: branchName } : details);
      }
      tell(child('statusRefresh'), { type: 'REFRESH', repository });
      if (pull && (await git(refuse, () => repository.readSnapshot())).hasUpstream) {
        try {
          await repository.pullBranch(progressDuring(progress, 'pull'));
        } catch (error) {
          throw await remoteRefusal(refuse, error, 'pull', repository);
        }
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
      }
      return { branchName };
    },

    /** Makes a branch at what is checked out and checks it out: answered as a checkout of it */
    'commit.CREATE_BRANCH': ({ branchName }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.createBranch(branchName);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { branchName };
      }),

    /**
     * Pushes what is checked out. `signal` aborts when whoever asked stops waiting, which ends git and what it started:
     * nothing has failed then, and nobody is answered
     */
    'commit.PUBLISH_BRANCH': async (_args, { data, tell, child, signal, progress, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      const branchName = await git(refuse, () => repository.readCurrentBranch());
      try {
        await repository.pushBranch(progressDuring(progress, 'push'), signal);
      } catch (error) {
        // What the remote holds is not known from here: it has the push or it does not
        if (signal.aborted) tell(child('statusRefresh'), { type: 'REFRESH', repository });
        throw await remoteRefusal(refuse, error, 'push', repository);
      }
      tell(child('statusRefresh'), { type: 'REFRESH', repository });
      return { branchName };
    },

    'commit.PULL_BRANCH': async (_args, { data, tell, child, progress, refuse }) => {
      const repository = repositoryIn(data.gitRepository);
      const branchName = await git(refuse, () => repository.readCurrentBranch());
      try {
        await repository.pullBranch(progressDuring(progress, 'pull'));
      } catch (error) {
        throw await remoteRefusal(refuse, error, 'pull', repository);
      }
      tell(child('statusRefresh'), { type: 'REFRESH', repository });
      return { branchName };
    },

    /**
     * Hands the changes to the flow that writes a commit message, answered once it has them. The flow tells the asking
     * window what it made, or why it made nothing: a flow run has no return address, so the ask carries the window's
     * connection for the action to answer
     */
    'commit.GENERATE_MESSAGE': (_args, { data, refuse }) => {
      const client = currentClient();
      return git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const stagedFiles = await repository.readStagedFiles();
        const diff = await repository.readDiff(undefined, stagedFiles.length > 0);
        if (!diff.trim()) throw new Error('No changes found to generate a commit message from.');

        const truncatedDiff = diff.length > 40000 ? diff.substring(0, 40000) + '\n... (truncated)' : diff;
        const branch = await repository.readCurrentBranch();
        const repoName = repository.getWorkingDir().split('/').pop() || '';
        const threadsSettings = featureSettings.forFeature('threads').get();
        const provider = threadsSettings?.chat?.defaultMode || 'Claude Code';

        triggerCommitGenerate({ diff: truncatedDiff, branch, repoName, provider, ...(client && { client }) });
      });
    },

    /** Which of what discarding these rows would remove is too large to keep a copy of, for the window about to ask */
    'commit.PREVIEW_DISCARD': ({ paths }, { data, refuse }) =>
      git(refuse, async () => ({ paths, notKept: await repositoryIn(data.gitRepository).discardNotKept(paths) })),

    /**
     * Adds the repository the panel is over to the user's safe.directory, when git refuses it for who owns it.
     * The path is the one git names now, asked again here: a window says only that the user trusts it, and the
     * user's global git configuration is written for no path a window sends
     */
    'commit.TRUST_OWNERSHIP': (_args, { data, tell, child, report, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const directory = await repository.isGitRepository().then(
          () => {
            throw new Error('Git already reads this repository');
          },
          async (error: unknown) => {
            if (!(error instanceof UnsafeOwnershipError)) throw error;
            await repository.trustOwnership(error.directory);
            return error.directory;
          },
        );
        // Nothing was read while git refused it: its status, and its watches
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        report({ type: 'CHECK_FOR_EXTERNAL_CHANGES' });
        return { directory };
      }),

    /**
     * Remembers that the user trusts this repository, after which git runs there as it does anywhere. Only the
     * repository the panel is over: the path arrives from a window, and trust is not handed out by name
     */
    'commit.TRUST_REPOSITORY': ({ repository: named }, { data, tell, child, report, refuse }) =>
      git(refuse, async () => {
        const repo = repositoryIn(data.gitRepository);
        const { repository } = await repo.readTrust();
        if (!repository || repository !== named) throw new Error('That is not the repository this panel is showing');
        trustRepository(repository);
        // Its watches were not opened while it was refused, and the status was never read
        tell(child('statusRefresh'), { type: 'REFRESH', repository: repo });
        report({ type: 'CHECK_FOR_EXTERNAL_CHANGES' });
        return { repository };
      }),

    /** Takes back the last write the engine made here, refused as `published` for a commit a remote branch already holds */
    'commit.UNDO_LAST': ({ evenIfPublished }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        // With none, the engine's own refusal of an id it does not hold, `nothing-to-undo`
        const { entry } = await repository.undo((await lastUndoable(repository))?.id ?? '', { evenIfPublished }).catch((error: unknown) => {
          throw published(error, refuse) ?? error;
        });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { id: entry.id, summary: entry.summary, ...(await undoableAfter(repository)) };
      }),

    /** Puts back what a discard kept: a write like the discard it undoes, announced the same way */
    'commit.RESTORE_DISCARDED': ({ id }, { data, tell, child, broadcast, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        // A discard is in the engine's journal, and undoing it is what puts it back
        const { discard } = await repository.undo(id);
        const restored = discard ?? { restored: [], left: [] };
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        for (const path of restored.restored) {
          broadcast('code', {
            type: 'explorer.FILE_CHANGED_EXTERNALLY',
            data: { path, changeType: 'change', modifiedAt: new Date() },
          });
        }
        return { id, ...restored };
      }),

    /** The files in an untracked folder the panel lists as one row, for the window that opened it */
    'commit.LIST_UNTRACKED': ({ path: folder }, { data, refuse }) =>
      git(refuse, async () => ({ path: folder, ...(await repositoryIn(data.gitRepository).listUntracked(folder)) })),

    /** Stages one piece of a file's change, or takes one back out of what is staged: a write like staging the file */
    'commit.APPLY_HUNK': ({ path: file, staged, hunk }, { data, tell, child, send, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        try {
          await repository.applyHunk(file, staged, hunk);
        } catch (error) {
          // A refusal means the file moved on under the window's diff, so that diff is read again. Its diff and
          // not the status: nothing was written, and a status answer would take the reason off the screen
          send({ type: 'ANNOUNCE_REPOSITORY_CHANGED', changed: { ...NOTHING_CHANGED, diffs: true, files: [file] } });
          throw error;
        }
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path: file, staged, hunk };
      }),

    /**
     * Git can sign in to the host a remote asked on now that the app is signed in to GitHub (`withGitHubSignIn`
     * gives every git run that sign-in), so fetching starts again and the window runs again what was refused. The
     * host arrives from the window, so it is held to a host name, and to GitHub's
     */
    'commit.SET_UP_SIGN_IN': ({ host, during: asked }, { data, tell, child, refuse }) => {
      // The push or the pull that was refused, which the answer carries back: whoever asked runs it again
      // once git can sign in, and what they held of it may have been cleared while this ran
      const during = asked === 'push' || asked === 'pull' ? { during: asked } : {};
      const repository = repositoryIn(data.gitRepository);
      if (!isHostName(host)) throw new Error(`Not a host name: ${JSON.stringify(host)}`);
      if (host !== 'github.com') throw refuse('git', `The app signs git in to GitHub, not to ${host}.`, during);
      // Still the sign-in that is missing, so the offer stays
      if (!storedSignIn()) {
        throw refuse('git', `Sign in to GitHub to give git a sign-in for ${host}.`, {
          ...during,
          code: 'authentication',
          signIn: { host, kind: 'github' },
        });
      }
      repository.resumeAutoFetch();
      tell(child('statusRefresh'), { type: 'REFRESH', repository });
      return { host, ...during };
    },

    'commit.STASH_PUSH': ({ message, stagedOnly, paths }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const result = await repository.stashPush(message, stagedOnly, paths);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { message: result };
      }),

    'commit.CREATE_TAG': ({ name, commit, message }, { data, refuse }) =>
      git(refuse, async () => {
        await repositoryIn(data.gitRepository).createTag(name, { commit, message });
        return { name };
      }),

    'commit.DELETE_TAG': ({ name }, { data, refuse }) =>
      git(refuse, async () => {
        await repositoryIn(data.gitRepository).deleteTag(name);
        return { name };
      }),

    'commit.PUSH_TAG': ({ name }, { data, refuse }) =>
      git(refuse, async () => {
        await repositoryIn(data.gitRepository).pushTag(name);
        return { name };
      }),

    'commit.RENAME_BRANCH': ({ name, to }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.renameBranch(name, to);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { name, to };
      }),

    /** Turns on git's own file monitor and untracked cache for the repository, on the user's click: it writes its config */
    'commit.SPEED_UP_STATUS': (_args, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        const turnedOn = await repository.speedUpStatus();
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return turnedOn;
      }),

    'commit.STASH_LIST': (_args, { data, refuse }) =>
      git(refuse, async () => ({ stashes: await repositoryIn(data.gitRepository).stashList() })),

    /**
     * Applies a stash, or with `STASH_POP` applies and drops it. A stash that conflicts is refused as the conflict, and
     * the repository is checked either way, so the status shows the conflicted files (and a popped one is kept)
     */
    'commit.STASH_APPLY': ({ index }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository
          .stashApply(index)
          .catch((error: unknown) => {
            if (error instanceof StashConflictError) {
              tell(child('statusRefresh'), { type: 'REFRESH', repository });
            }
            throw error;
          });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { index, popped: false };
      }),

    'commit.STASH_POP': ({ index }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository
          .stashPop(index)
          .catch((error: unknown) => {
            if (error instanceof StashConflictError) {
              tell(child('statusRefresh'), { type: 'REFRESH', repository });
            }
            throw error;
          });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { index, popped: true };
      }),

    /** The files a stash holds, read without applying it */
    'commit.GET_STASH_CHANGES': ({ index }, { data, refuse }) =>
      git(refuse, async () => ({ index, files: await repositoryIn(data.gitRepository).readStashChanges(index) })),

    /**
     * Who last changed each line of a file, leaving out the commits the repository lists to be ignored. `signal` aborts
     * when whoever asked stops waiting, as a panel does that asks for another file's, which stops git reading it
     */
    'commit.GET_BLAME': ({ path: file }, { data, signal, refuse }) =>
      git(refuse, async () => ({ path: file, lines: await repositoryIn(data.gitRepository).blame(file, { signal }) })),

    'commit.STASH_DROP': ({ index }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.stashDrop(index);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return undoableAfter(repository);
      }),

    'commit.STASH_CLEAR': (_args, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.stashClear();
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return undoableAfter(repository);
      }),

    /**
     * A page of history. `signal` aborts when whoever asked stops waiting, as a panel does that asks for the log again,
     * which stops git walking it
     */
    'commit.LOG_LIST': ({ cursor, path: file }, { data, signal, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        // The whole history is of every local branch with what is checked out, so another branch's commits are there
        // to be picked; a file's is of what is checked out, and a later page carries on from its cursor
        const refs =
          cursor || file
            ? undefined
            : await repository.refsModel().then(
                ({ branches }) => {
                  const local = branches.filter((branch) => !branch.remote);
                  return local.length ? ['HEAD', ...local.map((branch) => branch.name)] : undefined;
                },
                () => undefined,
              );
        // A branch checked out with no commit yet has no HEAD to start from, and its history is empty
        const page = await repository
          .history({ refs, cursor, path: file, limit: LOG_PAGE, signal })
          .catch(async (error: unknown): Promise<HistoryPage> => {
            if (!signal.aborted && refs && !(await repository.commitsExist('HEAD'))) return { commits: [] };
            throw error;
          });
        return {
          commits: page.commits,
          ...(page.cursor && { cursor: page.cursor }),
          ...(file && { path: file }),
          ...(cursor && { continued: true }),
        };
      }),

    /**
     * Brings a submodule to the commit the repository records for it, setting it up first if it is not: what makes a
     * submodule's row that says it is on another commit go away, short of committing the commit it is on
     */
    'commit.UPDATE_SUBMODULE': ({ path: submodule }, { data, tell, child, progress, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.updateSubmodules([submodule], {
          onProgress: progressDuring(progress, 'submodule'),
        });
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path: submodule };
      }),

    'commit.REVERT_COMMIT': ({ hash }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.revertCommit(hash);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { hash };
      }),

    'commit.RESET_TO_COMMIT': ({ hash }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.resetToCommit(hash);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { hash, ...(await undoableAfter(repository)) };
      }),

    'commit.WORKTREE_LIST': (_args, { data, refuse }) =>
      git(refuse, async () => ({ worktrees: await repositoryIn(data.gitRepository).worktreeList() })),

    'commit.WORKTREE_ADD': ({ path, branch, createBranch }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.worktreeAdd(path, branch, createBranch);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path, branch: branch || '' };
      }),

    'commit.WORKTREE_REMOVE': ({ path, force }, { data, tell, child, refuse }) =>
      git(refuse, async () => {
        const repository = repositoryIn(data.gitRepository);
        await repository.worktreeRemove(path, force);
        tell(child('statusRefresh'), { type: 'REFRESH', repository });
        return { path };
      }),
  },
});
