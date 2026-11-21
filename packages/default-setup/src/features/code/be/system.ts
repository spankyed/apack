import { featureSettings } from '#generated/settings.ts';
/**
 * Directory State Management:
 *
 * State:
 * - baseDirectory: Root workspace directory (project root)
 * - activeDirectory: Currently browsed subdirectory in explorer
 * - Both are duplicated across parent and children for independence
 * - Parent broadcasts directory changes to all children
 *
 * Persistence (saved to settings):
 * - baseDirectory: Current base directory (tracked automatically on navigation)
 * - defaultBaseDirectory: User's explicit preferred default (set via settings UI)
 *
 * Priority on startup:
 *   baseDirectory > defaultBaseDirectory > first workspace project > null
 */
import type { Contract, CommitAsks, SearchAsks, ActionsAsks, PromptsAsks, PullRequestAsks, GitHubAsks, ExplorerAsks, TerminalAsks } from './contract.ts';
import type { AppSettings } from '@apackdev/sdk/types';
import { services } from '#generated/services.ts';
import { broadcast, sendToWindow } from '#generated/events.ts';
import { clearCliPathCache, isCliName, testCli } from './utils/resolve-cli.ts';
import { terminalService } from './services/terminal.ts';
import { createLogger, setDebugEnabled } from '@apackdev/sdk/logger';

const cliLogger = createLogger('code');
import { setup, enqueueActions, assign, sendTo, type AnyActorRef } from 'xstate'

import { defineSystem } from '@apackdev/sdk/framework'
import { AppGitRepository, GIT_COMMAND_LOG, openGitRepository, openGitWatcher, repositoryHandle, repositoryOf, watcherHandle, watcherOf } from './services/app-git-repository.ts'
import { gitWatcherActor } from './git-watcher-actor.ts'

// The child systems, whose events and asks the contract declares
import { explorerSystem } from './features/explorer.ts'
import { searchSystem } from './features/search.ts'
import { commitSystem } from './features/commit.ts'
import { pullRequestSystem } from './features/pull-request.ts'
import { forgetHeldSignIn, githubSystem } from './features/github.ts'
import { terminalSystem } from './features/terminal.ts'
import { actionsSystem } from './features/actions.ts'
import { promptsSystem } from './features/prompts.ts'

/** One of this system's children, by the id it was spawned under */
function child(self: AnyActorRef, id: string): AnyActorRef | undefined {
  return self.getSnapshot().children[id];
}

import type { CodeSettings } from './types.ts'

export const codeSpec = defineSystem<Contract>();

/**
 * Resolves the initial base directory on system startup.
 * Priority chain: baseDirectory > defaultBaseDirectory > first workspace project > null
 */
function resolveInitialDirectory(
  codeSettings: CodeSettings | undefined,
  projects: any[]
): string | null {
  // User's explicit default takes priority
  if (codeSettings?.defaultBaseDirectory) {
    return codeSettings.defaultBaseDirectory
  }

  // Fall back to last directory they were in
  if (codeSettings?.baseDirectory) {
    return codeSettings.baseDirectory
  }

  // Fall back to first project directory
  const firstProjectDir = projects[0]?.directories?.[0]
  if (firstProjectDir) {
    return firstProjectDir
  }

  // No directory available
  return null
}

/**
 * Every ask the code system answers: its own, and each child's, whose handlers live beside that child's machine and
 * do its work over this system's repository and folder. A code answer is data its asker shows — a file, a diff, a
 * status, a pull request — so one nobody asked for goes nowhere. What happens unasked — a file changing on disk, the
 * repository changing, the directory moving, a terminal's lifecycle — is news, broadcast where it happens with no
 * listing on it, and each window asks for what it shows.
 */
export const answers = codeSpec.answers<keyof SearchAsks | keyof ActionsAsks | keyof PromptsAsks | keyof CommitAsks | keyof PullRequestAsks | keyof GitHubAsks | keyof ExplorerAsks | keyof TerminalAsks>({
  GET_CODE_START: ({ context }) => ({
    baseDirectory: context.baseDirectory,
    settings: featureSettings.forFeature('code').get(),
  }),
  /** Everything under the folder the user opened, for the picker */
  'commit.LIST_REPOSITORIES': async ({ context }) => {
    const folder = context.openedDirectory ?? context.baseDirectory
    const none = { repositories: [], truncated: false, current: context.baseDirectory }
    if (!folder) return none
    const { repositories, truncated } = await AppGitRepository.repositoriesUnder(folder).catch(() => none)
    return { repositories, truncated, current: context.baseDirectory }
  },
  'commit.WORKTREE_SWITCH': async ({ args: { path }, context, self }) => {
    const repository = repositoryOf(context.gitRepository)
    if (!repository) throw new Error('No repository is open to switch worktrees in.')
    const worktrees = await repository.worktreeList()
    if (!worktrees.some(worktree => worktree.path === path)) throw new Error(`Not a worktree of this repository: ${path}`)
    // A worktree is one of the repositories the picker offers, so the picker keeps the folder it lists
    self.send({ type: 'SET_BASE_DIRECTORY', path, fromUserNavigation: true, fromPicker: true })
    return { path }
  },
})

export const systemMachine = setup({
  types: codeSpec.types,
  actors: {
    gitWatcherActor,
    explorerSystem,
    searchSystem,
    commitSystem,
    pullRequestSystem,
    githubSystem,
    terminalSystem,
    actionsSystem,
    promptsSystem,
  },
  actions: {
    ...answers.actions,
    ...codeSpec.actions({
    spawnFeatureActors: enqueueActions(({ enqueue, context, self }) => {
      // The children are this system's own: nothing outside it looks them up, so none has a system id
      enqueue.spawnChild('explorerSystem', {
        id: 'explorer',
        input: {
          baseDirectory: context.baseDirectory
        }
      });
      enqueue.spawnChild('searchSystem', {
        id: 'search',
        input: {
          baseDirectory: context.baseDirectory
        }
      });
      enqueue.spawnChild('commitSystem', {
        id: 'commit',
        input: {
          baseDirectory: context.baseDirectory,
          gitRepository: repositoryOf(context.gitRepository),
          code: self
        }
      });
      enqueue.spawnChild('pullRequestSystem', {
        id: 'pr',
        input: {
          gitRepository: repositoryOf(context.gitRepository),
          code: self
        }
      });
      enqueue.spawnChild('terminalSystem', {
        id: 'terminal',
        input: {
          baseDirectory: context.baseDirectory
        }
      });
      enqueue.spawnChild('githubSystem', { id: 'github' });
      // Named for the prefix of the asks they answer, which is how `routeEvent` finds them
      enqueue.spawnChild('actionsSystem', { id: 'codeActions' });
      enqueue.spawnChild('promptsSystem', { id: 'codePrompts' });
    }),

    routeEvent: ({ event, self }) => {
      // An event's prefix names the child that handles it
      const [prefix] = event.type.split('.');
      if (prefix) {
        child(self, prefix)?.send(event);
      }
    },

    rememberBaseDirectory: ({ event }) => {
      const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
      if (ev.fromUserNavigation !== false) {
        featureSettings.forFeature('code').set({ path: ['baseDirectory'], value: ev.path })
      }
    },

    updateBaseDirectory: assign({
      baseDirectory: ({ event }) => codeSpec.typeOf('SET_BASE_DIRECTORY', event).path,
      // A folder the user opened is what the picker lists; one the picker chose is a repository inside it
      openedDirectory: ({ event, context }) => {
        const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
        return ev.fromPicker ? context.openedDirectory : ev.path
      },
      gitRepository: ({ event, context }) => {
        const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
        // The repository it replaces lets go of what it holds open — its readers, a fetch under way — which on
        // Windows would hold its directory
        const replaced = repositoryOf(context.gitRepository)
        if (replaced) void replaced.close().catch((error: unknown) => cliLogger.warn('The repository left behind could not be closed', { error: error instanceof Error ? error.message : String(error) }))
        const repo = openGitRepository(ev.path)
        const codeSettings = featureSettings.forFeature('code').get()
        repo.setFetchConfig(
          codeSettings?.autoFetchRemote ?? false,
          codeSettings?.autoFetchIntervalSeconds ?? 180
        )
        return repositoryHandle(repo)
      },
      gitWatcher: ({ event }) => {
        const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
        return watcherHandle(openGitWatcher(ev.path))
      }
    }),

    notifyChildSystemsOfBaseChange: ({ event, self, context }) => {
      const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
      const newPath = ev.path

      // Update child systems
      child(self, 'explorer')?.send({ type: 'explorer.UPDATE_BASE_DIRECTORY', path: newPath });
      child(self, 'search')?.send({ type: 'search.UPDATE_BASE_DIRECTORY', path: newPath });
      // Pass the new git services to systems that need them
      child(self, 'commit')?.send({
        type: 'commit.UPDATE_BASE_DIRECTORY',
        path: newPath,
        gitRepository: repositoryOf(context.gitRepository)!
      });
      child(self, 'pr')?.send({ type: 'pr.UPDATE_BASE_DIRECTORY', path: newPath, gitRepository: repositoryOf(context.gitRepository) });
      // Note: Updates terminal's base directory for new terminal creation.
      // Individual terminal processes track their own cwd independently.
      child(self, 'terminal')?.send({ type: 'terminal.UPDATE_BASE_DIRECTORY', path: newPath });

      // News for every window; each asks again for what it shows of the new directory
      broadcast('code', { type: 'BASE_DIRECTORY_CHANGED', baseDirectory: newPath });
    },

    /**
     * Resolves a CLI and records where it was found, in this feature's own settings. It lives here because
     * `resolve-cli` and the stored paths are this feature's; the Settings view asks for it and is told the result.
     */
    testCliProvider: ({ event, client }) => {
      const { provider } = codeSpec.typeOf('TEST_CLI_PROVIDER', event);
      // The Settings view of the window that asked; with no window, the Settings view in every window
      const answer = (result: { success: boolean; error?: string; resolvedPath?: string }) => {
        const tested = { type: 'CLI_TEST_RESULT' as const, provider, ...result };
        if (client) sendToWindow(client, 'host/settings', tested); else broadcast('host/settings', tested);
      };

      if (!isCliName(provider)) return answer({ success: false, error: `Unknown CLI provider: ${provider}` });

      const paths = featureSettings.forFeature('code').get().cliPaths;
      void testCli(provider, paths[provider]).then((result) => {
        if (result.success) featureSettings.forFeature('code').set({ path: ['cliPaths', provider], value: result.resolvedPath });
        else cliLogger.error(`CLI test failed for "${provider}"`, { error: result.error });
        answer(result);
      });
    },

    updateSettings: ({ event, context, self }) => {
      const ev = { settings: codeSpec.typeOf('FEATURE_SETTINGS_UPDATED', event).settings as CodeSettings }

      // The resolved paths are cached, so a change to this feature's settings is where the cache is dropped
      clearCliPathCache();

      // A live terminal keeps the cursor it was given until it is told the setting changed
      terminalService.applyCursorDefaults(ev.settings);

      // A new default moves the explorer there at once; the same default arriving again leaves the user's browsing alone
      if (ev.settings.defaultBaseDirectory &&
          ev.settings.defaultBaseDirectory !== context.defaultBaseDirectory &&
          ev.settings.defaultBaseDirectory !== context.baseDirectory) {
        // Apply the new default base directory
        // Mark as non-navigation so it doesn't overwrite baseDirectory
        self.send({
          type: 'SET_BASE_DIRECTORY',
          path: ev.settings.defaultBaseDirectory,
          fromUserNavigation: false
        })
      }

      setDebugEnabled(GIT_COMMAND_LOG, ev.settings.logGitCommands === true)

      // Update git fetch config if repository exists
      const repository = repositoryOf(context.gitRepository)
      if (repository) {
        const suspended = repository.isAutoFetchSuspended
        repository.setFetchConfig(
          ev.settings.autoFetchRemote ?? false,
          ev.settings.autoFetchIntervalSeconds ?? 180
        )
        // Fetching had stopped and its settings changed, which starts it over: the repository is checked, which
        // says so to the windows showing it, and fetched if a fetch is due
        if (suspended && !repository.isAutoFetchSuspended) child(self, 'commit')?.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true })
      }

    },
    
    /**
     * Something may have changed on disk that no file event reported. The watches are brought in line with the
     * checkout first — it may have become a repository, or a watch may have failed — and then git and the open
     * files say what, if anything, differs.
     */
    checkForExternalChanges: ({ context, event, self }) => {
      const byWindow = codeSpec.typeOf('CHECK_FOR_EXTERNAL_CHANGES', event).by === 'window';
      child(self, 'explorer')?.send({ type: 'explorer.CHECK_OPEN_FILES' });
      const checkRepository = () => { child(self, 'commit')?.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true, byWindow }) };
      const watcher = watcherOf(context.gitWatcher);
      if (watcher) void watcher.check().then(checkRepository, checkRepository);
      else checkRepository();
    },

    selectGitWatcher: sendTo('gitWatcher', ({ context }) => ({
      type: 'WATCH', selection: { watcher: watcherOf(context.gitWatcher), repository: repositoryOf(context.gitRepository) },
    })),
  }),
  },
}).createMachine({
  id: 'code',
  initial: 'idle',
  context: () => {
    const codeSettings = featureSettings.forFeature('code').get()
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects

    // Resolve initial directory using priority chain
    const baseDir = resolveInitialDirectory(codeSettings, projects)

    // Off unless the setting asks for it, whatever the build: a status runs for most file events
    setDebugEnabled(GIT_COMMAND_LOG, codeSettings?.logGitCommands === true)

    const gitRepo = baseDir ? openGitRepository(baseDir) : null
    if (gitRepo) {
      gitRepo.setFetchConfig(
        codeSettings?.autoFetchRemote ?? false,
        codeSettings?.autoFetchIntervalSeconds ?? 180
      )
    }

    return {
      baseDirectory: baseDir,
      defaultBaseDirectory: codeSettings?.defaultBaseDirectory ?? null,
      openedDirectory: baseDir,
      gitRepository: repositoryHandle(gitRepo),
      gitWatcher: watcherHandle(baseDir ? openGitWatcher(baseDir) : null)
    }
  },
  entry: 'spawnFeatureActors',
  invoke: {
    id: 'gitWatcher', src: 'gitWatcherActor',
    input: ({ context, self }) => ({ watcher: watcherOf(context.gitWatcher), repository: repositoryOf(context.gitRepository),
      onChange: () => child(self, 'commit')?.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' }),
    }),
  },
  states: {
    idle: {
      on: {
        // Taken here rather than at the root, where every event this state does not name would be routed past them
        ...answers.on,
        // Handle settings updates
        TEST_CLI_PROVIDER: { actions: 'testCliProvider' },
        CHECK_FOR_EXTERNAL_CHANGES: { actions: 'checkForExternalChanges' },
        FEATURE_SETTINGS_UPDATED: {
          actions: [
            'updateSettings',
            assign({ defaultBaseDirectory: ({ event }) => (event.settings as CodeSettings).defaultBaseDirectory ?? null }),
          ]
        },
        // Handle SET_BASE_DIRECTORY specially
        SET_BASE_DIRECTORY: [
          {
            guard: ({ context, event }) => event.path !== context.baseDirectory,
            actions: ['rememberBaseDirectory', 'updateBaseDirectory', 'notifyChildSystemsOfBaseChange', 'selectGitWatcher'],
          },
          { actions: 'rememberBaseDirectory' },
        ],
        SECRETS_CHANGED: { actions: () => forgetHeldSignIn() },
        SELECT_REPOSITORY: {
          actions: ({ event, self }) => {
            self.send({ type: 'SET_BASE_DIRECTORY', path: event.path, fromUserNavigation: true, fromPicker: true })
          },
        },
        // All other events get routed to children
        '*': {
          actions: 'routeEvent'
        }
      }
    }
  }
})

const codeEntry = { spec: codeSpec, machine: systemMachine };

export default codeEntry;
