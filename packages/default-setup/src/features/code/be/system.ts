import { featureSettings } from '#generated/settings.ts';
/**
 * Directory State Management:
 *
 * State:
 * - baseDirectory: Root workspace directory (project root)
 * - openedDirectory: Folder the user opened (what the repository picker lists)
 * - Parent broadcasts directory changes to all children
 *
 * Persistence (saved to settings):
 * - baseDirectory: Current base directory (tracked automatically on navigation)
 * - defaultBaseDirectory: User's explicit preferred default (set via settings UI)
 *
 * Priority on startup:
 *   defaultBaseDirectory > baseDirectory > first workspace project > null
 */
import type {
  Contract,
  CommitAsks,
  SearchAsks,
  ActionsAsks,
  PromptsAsks,
  PullRequestAsks,
  GitHubAsks,
  ExplorerAsks,
  TerminalAsks,
} from './contract.ts';
import type { AppSettings } from '@apackdev/sdk/types';
import { services } from '#generated/services.ts';
import { broadcast as busBroadcast, sendToWindow } from '#generated/events.ts';
import { state, type PackNet } from '#generated/state.ts';
import {
  currentClient,
  type ContractAsks,
  type IncomingOnlyEventsOf,
  type NormalizeAsks,
} from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';
import type { AskScope, Asks, Outcome, Read } from '@apackdev/state';
import { clearCliPathCache, isCliName, testCli } from './utils/resolve-cli.ts';
import { terminalService } from './services/terminal.ts';
import { createLogger, setDebugEnabled } from '@apackdev/sdk/logger';
import {
  AppGitRepository,
  GIT_COMMAND_LOG,
  openGitRepository,
  openGitWatcher,
  repositoryHandle,
  repositoryOf,
  watcherHandle,
  watcherOf,
} from './services/app-git-repository.ts';
import { gitWatcherState, type GitWatcherReport } from './git-watcher-actor.ts';

// The child systems, whose events and asks the contract declares
import { explorerSystem } from './features/explorer.ts';
import { searchSystem } from './features/search.ts';
import { commitSystem, type CommitReport } from './features/commit.ts';
import { pullRequestSystem, type PullRequestReport } from './features/pull-request.ts';
import { forgetHeldSignIn, githubSystem } from './features/github.ts';
import { terminalSystem } from './features/terminal.ts';
import { actionsSystem } from './features/actions.ts';
import { promptsSystem } from './features/prompts.ts';
import type { CodeSettings, CodeSystemContext } from './types.ts';

const cliLogger = createLogger('code');

/**
 * Resolves the initial base directory on system startup.
 * Priority chain: defaultBaseDirectory > baseDirectory > first workspace project > null
 */
function resolveInitialDirectory(codeSettings: CodeSettings | undefined, projects: any[]): string | null {
  // User's explicit default takes priority
  if (codeSettings?.defaultBaseDirectory) {
    return codeSettings.defaultBaseDirectory;
  }

  // Fall back to last directory they were in
  if (codeSettings?.baseDirectory) {
    return codeSettings.baseDirectory;
  }

  // Fall back to first project directory
  const firstProjectDir = projects[0]?.directories?.[0];
  if (firstProjectDir) {
    return firstProjectDir;
  }

  // No directory available
  return null;
}

/**
 * Resolves a CLI and records where it was found, in this feature's own settings. It lives here because
 * `resolve-cli` and the stored paths are this feature's; the Settings view asks for it and is told the result.
 */
function runTestCliProvider(provider: string, client: string | undefined): void {
  // The Settings view of the window that asked; with no window, the Settings view in every window
  const answer = (result: { success: boolean; error?: string; resolvedPath?: string }) => {
    const tested = { type: 'CLI_TEST_RESULT' as const, provider, ...result };
    if (client) sendToWindow(client, 'host/settings', tested);
    else busBroadcast('host/settings', tested);
  };

  if (!isCliName(provider)) return answer({ success: false, error: `Unknown CLI provider: ${provider}` });

  const paths = featureSettings.forFeature('code').get().cliPaths;
  void testCli(provider, paths[provider]).then((result) => {
    if (result.success) featureSettings.forFeature('code').set({ path: ['cliPaths', provider], value: result.resolvedPath });
    else cliLogger.error(`CLI test failed for "${provider}"`, { error: result.error });
    answer(result);
  });
}

type CodeStarts = {
  gitWatcher: typeof gitWatcherState;
  explorer: typeof explorerSystem;
  search: typeof searchSystem;
  commit: typeof commitSystem;
  pr: typeof pullRequestSystem;
  terminal: typeof terminalSystem;
  github: typeof githubSystem;
  codeActions: typeof actionsSystem;
  codePrompts: typeof promptsSystem;
};

type CodeShape = {
  data: CodeSystemContext;
  starts: CodeStarts;
};

type CodeEvent =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'FEATURE_SETTINGS_UPDATED' }>
  | GitWatcherReport
  | CommitReport
  | PullRequestReport;

type CodeNormalizedAsks = NormalizeAsks<ContractAsks<Contract>>;

const ASK_ENDS = new Set<string>(['failed', 'abandoned', 'unavailable', 'disconnected']);

function unwrapChildOutcome<T>(
  outcome: Outcome<T, { readonly kind: string; readonly message: string; readonly [key: string]: unknown }>,
  refuse: (...args: any[]) => Error,
): T {
  if (outcome.ok) return outcome.value;
  const { kind, message, ...details } = outcome.failure;
  if (ASK_ENDS.has(kind)) throw new Error(message);
  throw Object.keys(details).length > 0 ? refuse(kind, message, details) : refuse(kind, message);
}

/**
 * Builds typed forwarding ask handlers that delegate a child's asks to `scope.child(slot)`, preserving progress
 * streaming, cancellation (`signal`), and refusal kinds/payloads.
 */
function delegateAsks<Slot extends keyof CodeStarts, SubAsks extends Asks>(
  slot: Slot,
  names: ReadonlyArray<keyof SubAsks & string>,
  withProgress?: ReadonlySet<string>,
): {
  [K in keyof SubAsks]: (
    args: SubAsks[K]['args'],
    scope: AskScope<CodeShape, '', CodeEvent, PackNet, SubAsks[K]>,
  ) => Promise<Read<SubAsks[K]['answer']>>;
} {
  const handlers: Record<string, unknown> = {};
  for (const name of names) {
    const streams = withProgress?.has(name) ?? false;
    handlers[name] = async (args: unknown, scope: any) => {
      const outcome = streams
        ? await scope.ask(scope.child(slot), name, args, (updates: readonly unknown[]) => {
            for (const update of updates) scope.progress(update);
          })
        : await scope.ask(scope.child(slot), name, args);
      return unwrapChildOutcome(outcome, scope.refuse);
    };
  }
  return handlers as {
    [K in keyof SubAsks]: (
      args: SubAsks[K]['args'],
      scope: AskScope<CodeShape, '', CodeEvent, PackNet, SubAsks[K]>,
    ) => Promise<Read<SubAsks[K]['answer']>>;
  };
}

const EXPLORER_ASKS: ReadonlyArray<keyof NormalizeAsks<ExplorerAsks> & string> = [
  'explorer.LIST_FILES',
  'explorer.READ_FILE',
  'explorer.WRITE_FILE',
  'explorer.DELETE_FILE',
  'explorer.RENAME_FILE',
  'explorer.CREATE_DIRECTORY',
  'explorer.QUICK_OPEN_SEARCH',
  'explorer.MOVE_FILES',
  'explorer.COPY_FILES',
];

const SEARCH_ASKS: ReadonlyArray<keyof NormalizeAsks<SearchAsks> & string> = ['search.SEARCH_FILES'];
const SEARCH_PROGRESS = new Set<string>(['search.SEARCH_FILES']);

const COMMIT_ASKS: ReadonlyArray<keyof NormalizeAsks<CommitAsks> & string> = [
  'commit.GET_GIT_STATUS',
  'commit.GET_GIT_DIFF',
  'commit.STAGE_FILES',
  'commit.UNSTAGE_FILES',
  'commit.COMMIT',
  'commit.REVERT_FILE',
  'commit.REVERT_FILES',
  'commit.PREVIEW_DISCARD',
  'commit.RESTORE_DISCARDED',
  'commit.TRUST_REPOSITORY',
  'commit.TRUST_OWNERSHIP',
  'commit.GET_ALL_BRANCHES',
  'commit.CHECKOUT_BRANCH',
  'commit.CREATE_BRANCH',
  'commit.PUBLISH_BRANCH',
  'commit.PULL_BRANCH',
  'commit.GENERATE_MESSAGE',
  'commit.STASH_PUSH',
  'commit.CREATE_TAG',
  'commit.DELETE_TAG',
  'commit.PUSH_TAG',
  'commit.RENAME_BRANCH',
  'commit.SPEED_UP_STATUS',
  'commit.STASH_LIST',
  'commit.STASH_APPLY',
  'commit.STASH_POP',
  'commit.STASH_DROP',
  'commit.STASH_CLEAR',
  'commit.GET_STASH_CHANGES',
  'commit.GET_BLAME',
  'commit.UPDATE_SUBMODULE',
  'commit.UNDO_LAST',
  'commit.WORKTREE_LIST',
  'commit.WORKTREE_ADD',
  'commit.WORKTREE_REMOVE',
  'commit.RESOLVE_CONFLICT',
  'commit.MARK_RESOLVED',
  'commit.RESOLVE_ALL_CONFLICTS',
  'commit.MOVE_OPERATION',
  'commit.START_OPERATION',
  'commit.AMEND',
  'commit.GET_COMMIT_MESSAGE',
  'commit.READ_TRAILERS',
  'commit.REMOVE_TRAILER',
  'commit.REWRITE_COMMIT',
  'commit.PREVIEW_MERGE',
  'commit.LIST_UNTRACKED',
  'commit.APPLY_HUNK',
  'commit.SET_UP_SIGN_IN',
  'commit.LOG_LIST',
  'commit.REVERT_COMMIT',
  'commit.RESET_TO_COMMIT',
];
const COMMIT_PROGRESS = new Set<string>([
  'commit.CHECKOUT_BRANCH',
  'commit.PUBLISH_BRANCH',
  'commit.PULL_BRANCH',
  'commit.UPDATE_SUBMODULE',
]);

const PR_ASKS: ReadonlyArray<keyof NormalizeAsks<PullRequestAsks> & string> = [
  'pr.GET_BRANCH_DIFF',
  'pr.GET_BRANCH_FILE_DIFF',
  'pr.LIST_PRS',
  'pr.CHECKOUT_PR',
  'pr.SELECT_PR',
  'pr.CREATE_PR',
  'pr.MERGE_PR',
  'pr.CLOSE_PR',
  'pr.TOGGLE_DRAFT',
  'pr.CHECK_BRANCH_PR',
  'pr.CHECK_GITHUB_ACCESS',
  'pr.GET_PR_AUTOFILL',
  'pr.GET_SMART_BASE_BRANCH',
  'pr.DELETE_BRANCH',
  'pr.UPDATE_PR',
  'pr.CREATE_COMMENT',
  'pr.EDIT_COMMENT',
  'pr.DELETE_COMMENT',
  'pr.GET_COMMENTS',
  'pr.GET_REVIEW_THREADS',
  'pr.REPLY_TO_THREAD',
  'pr.RESOLVE_THREAD',
  'pr.UNRESOLVE_THREAD',
  'pr.EDIT_REVIEW_COMMENT',
  'pr.DELETE_REVIEW_COMMENT',
];

const TERMINAL_ASKS: ReadonlyArray<keyof NormalizeAsks<TerminalAsks> & string> = [
  'terminal.CREATE_TERMINAL',
  'terminal.CLOSE_TERMINAL',
  'terminal.RESTART_TERMINAL',
  'terminal.RESIZE_TERMINAL',
  'terminal.RENAME_TERMINAL',
  'terminal.REFRESH_LIST',
  'terminal.OPEN_TERMINAL_TAB',
  'terminal.KEEP_TERMINAL',
  'terminal.REWIND',
  'terminal.REWIND_SEEK',
];

const ACTIONS_ASKS: ReadonlyArray<keyof NormalizeAsks<ActionsAsks> & string> = [
  'codeActions.OPEN_ACTION',
  'codeActions.SAVE_ACTION',
];

const PROMPTS_ASKS: ReadonlyArray<keyof NormalizeAsks<PromptsAsks> & string> = [
  'codePrompts.OPEN_PROMPT',
  'codePrompts.SAVE_PROMPT',
];

const GITHUB_ASKS: ReadonlyArray<keyof NormalizeAsks<GitHubAsks> & string> = [
  'github.GET_ACCOUNT',
  'github.SIGN_IN',
];
const GITHUB_PROGRESS = new Set<string>(['github.SIGN_IN']);

export const codeSystem = state<CodeShape, CodeEvent, CodeNormalizedAsks>()({
  data: {
    baseDirectory: null,
    defaultBaseDirectory: null,
    openedDirectory: null,
    gitRepository: null,
    gitWatcher: null,
  },
  run: () => {
    const codeSettings = featureSettings.forFeature('code').get();
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects;

    // Resolve initial directory using priority chain
    const baseDir = resolveInitialDirectory(codeSettings, projects);

    // Off unless the setting asks for it, whatever the build: a status runs for most file events
    setDebugEnabled(GIT_COMMAND_LOG, codeSettings?.logGitCommands === true);

    const gitRepo = baseDir ? openGitRepository(baseDir) : null;
    if (gitRepo) {
      gitRepo.setFetchConfig(codeSettings?.autoFetchRemote ?? false, codeSettings?.autoFetchIntervalSeconds ?? 180);
    }

    return {
      data: {
        baseDirectory: baseDir,
        defaultBaseDirectory: codeSettings?.defaultBaseDirectory ?? null,
        openedDirectory: baseDir,
        gitRepository: repositoryHandle(gitRepo),
        gitWatcher: watcherHandle(baseDir ? openGitWatcher(baseDir) : null),
      },
    };
  },
  starts: (start) => ({
    gitWatcher: start(gitWatcherState, {
      given: (data) => ({
        selection: {
          watcher: watcherOf(data.gitWatcher),
          repository: repositoryOf(data.gitRepository),
        },
      }),
    }),
    explorer: start(explorerSystem, { given: (data) => ({ baseDirectory: data.baseDirectory }) }),
    search: start(searchSystem, { given: (data) => ({ baseDirectory: data.baseDirectory }) }),
    commit: start(commitSystem, {
      given: (data) => ({
        baseDirectory: data.baseDirectory,
        gitRepository: repositoryOf(data.gitRepository),
      }),
    }),
    pr: start(pullRequestSystem, { given: (data) => ({ gitRepository: repositoryOf(data.gitRepository) }) }),
    terminal: start(terminalSystem, { given: (data) => ({ baseDirectory: data.baseDirectory }) }),
    github: githubSystem,
    codeActions: actionsSystem,
    codePrompts: promptsSystem,
  }),
  on: {
    TEST_CLI_PROVIDER: ({ provider }) => {
      runTestCliProvider(provider, currentClient());
    },

    /**
     * Something may have changed on disk that no file event reported. The watches are brought in line with the
     * checkout first — it may have become a repository, or a watch may have failed — and then git and the open
     * files say what, if anything, differs.
     */
    CHECK_FOR_EXTERNAL_CHANGES: (event, { data, tell, child }) => {
      const byWindow = 'by' in event && event.by === 'window';
      tell(child('explorer'), { type: 'explorer.CHECK_OPEN_FILES' });
      const checkRepository = () => {
        tell(child('commit'), { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true, byWindow });
      };
      const watcher = watcherOf(data.gitWatcher);
      if (watcher) void watcher.check().then(checkRepository, checkRepository);
      else checkRepository();
    },

    FEATURE_SETTINGS_UPDATED: (event, { data, send, tell, child }) => {
      const settings = event.settings as CodeSettings;

      // The resolved paths are cached, so a change to this feature's settings is where the cache is dropped
      clearCliPathCache();

      // A live terminal keeps the cursor it was given until it is told the setting changed
      terminalService.applyCursorDefaults(settings);

      // A new default moves the explorer there at once; the same default arriving again leaves the user's browsing alone
      if (
        settings.defaultBaseDirectory &&
        settings.defaultBaseDirectory !== data.defaultBaseDirectory &&
        settings.defaultBaseDirectory !== data.baseDirectory
      ) {
        // Apply the new default base directory; mark as non-navigation so it doesn't overwrite baseDirectory
        send({
          type: 'SET_BASE_DIRECTORY',
          path: settings.defaultBaseDirectory,
          fromUserNavigation: false,
        });
      }

      setDebugEnabled(GIT_COMMAND_LOG, settings.logGitCommands === true);

      // Update git fetch config if repository exists
      const repository = repositoryOf(data.gitRepository);
      if (repository) {
        const suspended = repository.isAutoFetchSuspended;
        repository.setFetchConfig(settings.autoFetchRemote ?? false, settings.autoFetchIntervalSeconds ?? 180);
        // Fetching had stopped and its settings changed, which starts it over: the repository is checked, which
        // says so to the windows showing it, and fetched if a fetch is due
        if (suspended && !repository.isAutoFetchSuspended) {
          tell(child('commit'), { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true });
        }
      }

      return { data: { defaultBaseDirectory: settings.defaultBaseDirectory ?? null } };
    },

    SET_BASE_DIRECTORY: (event, { data, tell, child, broadcast }) => {
      if (event.fromUserNavigation !== false) {
        featureSettings.forFeature('code').set({ path: ['baseDirectory'], value: event.path });
      }
      if (event.path === data.baseDirectory) return;

      // The repository it replaces lets go of what it holds open — its readers, a fetch under way — which on
      // Windows would hold its directory
      const replaced = repositoryOf(data.gitRepository);
      if (replaced) {
        void replaced.close().catch((error: unknown) =>
          cliLogger.warn('The repository left behind could not be closed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      const repo = openGitRepository(event.path);
      const codeSettings = featureSettings.forFeature('code').get();
      repo.setFetchConfig(codeSettings?.autoFetchRemote ?? false, codeSettings?.autoFetchIntervalSeconds ?? 180);
      const watcher = openGitWatcher(event.path);

      // Update child systems
      tell(child('explorer'), { type: 'explorer.UPDATE_BASE_DIRECTORY', path: event.path });
      tell(child('search'), { type: 'search.UPDATE_BASE_DIRECTORY', path: event.path });
      tell(child('commit'), { type: 'commit.UPDATE_BASE_DIRECTORY', path: event.path, gitRepository: repo });
      tell(child('pr'), { type: 'pr.UPDATE_BASE_DIRECTORY', path: event.path, gitRepository: repo });
      // Note: Updates terminal's base directory for new terminal creation.
      // Individual terminal processes track their own cwd independently.
      tell(child('terminal'), { type: 'terminal.UPDATE_BASE_DIRECTORY', path: event.path });
      tell(child('gitWatcher'), { type: 'WATCH', selection: { watcher, repository: repo } });

      // News for every window; each asks again for what it shows of the new directory
      broadcast('code', { type: 'BASE_DIRECTORY_CHANGED', baseDirectory: event.path });

      return {
        data: {
          baseDirectory: event.path,
          // A folder the user opened is what the picker lists; one the picker chose is a repository inside it
          openedDirectory: event.fromPicker ? data.openedDirectory : event.path,
          gitRepository: repositoryHandle(repo),
          gitWatcher: watcherHandle(watcher),
        },
      };
    },

    SECRETS_CHANGED: () => {
      forgetHeldSignIn();
    },

    SELECT_REPOSITORY: ({ path }, { send }) => {
      send({ type: 'SET_BASE_DIRECTORY', path, fromUserNavigation: true, fromPicker: true });
    },

    // Routed incoming events to child systems
    'explorer.CLOSE_FILE': (event, { tell, child }) => {
      tell(child('explorer'), event);
    },
    'terminal.TERMINAL_INPUT': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.STOPPED_FITTING': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.STATUS_SEEN': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.REWIND_CLOSE': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'terminal.REWIND_RESIZE': (event, { tell, child }) => {
      tell(child('terminal'), event);
    },
    'github.SIGN_OUT': (event, { tell, child }) => {
      tell(child('github'), event);
    },

    // Child reports routed between sibling children
    GIT_WATCHER_CHANGED: (_event, { tell, child }) => {
      tell(child('commit'), { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
    },
    GIT_STATUS_CHANGED: (_event, { tell, child }) => {
      tell(child('pr'), { type: 'pr.GIT_STATUS_CHANGED' });
    },
    COMMIT_GIT_STATUS_CHANGED: (_event, { tell, child }) => {
      tell(child('commit'), { type: 'commit.GIT_STATUS_CHANGED' });
    },
  },
  answers: {
    GET_CODE_START: (_args, { data }) => ({
      baseDirectory: data.baseDirectory,
      settings: featureSettings.forFeature('code').get(),
    }),
    /** Everything under the folder the user opened, for the picker */
    'commit.LIST_REPOSITORIES': async (_args, { data }) => {
      const folder = data.openedDirectory ?? data.baseDirectory;
      const none = { repositories: [], truncated: false, current: data.baseDirectory };
      if (!folder) return none;
      const { repositories, truncated } = await AppGitRepository.repositoriesUnder(folder).catch(() => none);
      return { repositories, truncated, current: data.baseDirectory };
    },
    'commit.WORKTREE_SWITCH': async ({ path }, { data, send }) => {
      const repository = repositoryOf(data.gitRepository);
      if (!repository) throw new Error('No repository is open to switch worktrees in.');
      const worktrees = await repository.worktreeList();
      if (!worktrees.some((worktree) => worktree.path === path)) {
        throw new Error(`Not a worktree of this repository: ${path}`);
      }
      // A worktree is one of the repositories the picker offers, so the picker keeps the folder it lists
      send({ type: 'SET_BASE_DIRECTORY', path, fromUserNavigation: true, fromPicker: true });
      return { path };
    },
    ...delegateAsks<'explorer', NormalizeAsks<ExplorerAsks>>('explorer', EXPLORER_ASKS),
    ...delegateAsks<'search', NormalizeAsks<SearchAsks>>('search', SEARCH_ASKS, SEARCH_PROGRESS),
    ...delegateAsks<'commit', NormalizeAsks<CommitAsks>>('commit', COMMIT_ASKS, COMMIT_PROGRESS),
    ...delegateAsks<'pr', NormalizeAsks<PullRequestAsks>>('pr', PR_ASKS),
    ...delegateAsks<'terminal', NormalizeAsks<TerminalAsks>>('terminal', TERMINAL_ASKS),
    ...delegateAsks<'codeActions', NormalizeAsks<ActionsAsks>>('codeActions', ACTIONS_ASKS),
    ...delegateAsks<'codePrompts', NormalizeAsks<PromptsAsks>>('codePrompts', PROMPTS_ASKS),
    ...delegateAsks<'github', NormalizeAsks<GitHubAsks>>('github', GITHUB_ASKS, GITHUB_PROGRESS),
  },
});

const _contractMatches: StateMatchesContract<typeof codeSystem, Contract> = true;
void _contractMatches;

export default codeSystem;
