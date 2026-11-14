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
import type { Contract } from './contract.ts';
import type { AppSettings } from '@apackdev/sdk/types';
import { services } from '#generated/services.ts';
import { broadcastToSurface } from '#generated/events.ts';
import { clearCliPathCache, isCliName, testCli } from './utils/resolve-cli.ts';
import { terminalService } from './services/terminal.ts';
import { createLogger, setDebugEnabled } from '@apackdev/sdk/logger';

const cliLogger = createLogger('code');
import { setup, enqueueActions, assign, sendTo, type AnyActorRef } from 'xstate'

import { defineSystem } from '@apackdev/sdk/framework'
import { AppGitRepository, GIT_COMMAND_LOG, openGitRepository, openGitWatcher, repositoryHandle, repositoryOf, watcherHandle, watcherOf } from './services/app-git-repository.ts'
import { gitWatcherActor } from './git-watcher-actor.ts'
import { answer } from './answer.ts'

// child systems; their events come from the contract, which is where every child's now live
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

// Union all incoming events from child systems
// Union all outgoing events from child systems  
// Import only the type needed for broadcast event
import type { CodeConnectedData, CodeSettings } from './types.ts'

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
    promptsSystem
  },
  actions: codeSpec.actions({
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
          baseDirectory: context.baseDirectory,
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

    /** What the repository picker lists, for the window that asked: everything under the folder the user opened */
    listRepositories: ({ context, reply }) => {
      const folder = context.openedDirectory ?? context.baseDirectory
      if (!folder) {
        reply?.({ type: 'commit.REPOSITORIES_RECEIVED', data: { repositories: [], truncated: false, current: context.baseDirectory } })
        return
      }
      void AppGitRepository.repositoriesUnder(folder).then(
        ({ repositories, truncated }) => reply?.({ type: 'commit.REPOSITORIES_RECEIVED', data: { repositories, truncated, current: context.baseDirectory } }),
        () => reply?.({ type: 'commit.REPOSITORIES_RECEIVED', data: { repositories: [], truncated: false, current: context.baseDirectory } }),
      )
    },

    /**
     * Moves the code surface to one of the repository's worktrees, and answers the window that asked: switched, or
     * why not. A path the repository does not list as a worktree is refused, and the folder stays where it is
     */
    switchWorktree: ({ context, event, self, reply }) => {
      const { path } = codeSpec.typeOf('commit.WORKTREE_SWITCH', event)
      const repository = repositoryOf(context.gitRepository)
      if (!repository) {
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: { message: 'No repository is open to switch worktrees in.' } })
        return
      }
      void repository.worktreeList().then(
        (worktrees) => {
          if (!worktrees.some(worktree => worktree.path === path)) {
            answer(reply, { type: 'commit.ERROR_RECEIVED', data: { message: `Not a worktree of this repository: ${path}` } })
            return
          }
          // A worktree is one of the repositories the picker offers, so the picker keeps the folder it lists
          self.send({ type: 'SET_BASE_DIRECTORY', path, fromUserNavigation: true, fromPicker: true })
          answer(reply, { type: 'commit.WORKTREE_SWITCHED', data: { path } })
        },
        (error: unknown) => answer(reply, { type: 'commit.ERROR_RECEIVED', data: { message: error instanceof Error ? error.message : String(error) } }),
      )
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
      child(self, 'pr')?.send({
        type: 'pr.UPDATE_BASE_DIRECTORY',
        path: newPath,
        gitRepository: repositoryOf(context.gitRepository)!
      });
      // Note: Updates terminal's base directory for new terminal creation.
      // Individual terminal processes track their own cwd independently.
      child(self, 'terminal')?.send({ type: 'terminal.UPDATE_BASE_DIRECTORY', path: newPath });

      // News for every window; each asks again for what it shows of the new directory
      broadcastToSurface('code', { type: 'BASE_DIRECTORY_CHANGED', baseDirectory: newPath });
    },

    /**
     * Resolves a CLI and records where it was found, in this feature's own settings. It lives here because
     * `resolve-cli` and the stored paths are this feature's; the Settings view asks for it and is told the result.
     */
    testCliProvider: ({ event, reply }) => {
      const { provider } = event as { type: 'TEST_CLI_PROVIDER'; provider: string };
      // The Settings view that asked; with nobody to answer, the Settings view in every window
      const answer = (result: { success: boolean; error?: string; resolvedPath?: string }) => {
        const tested = { type: 'CLI_TEST_RESULT' as const, provider, ...result };
        if (reply) reply(tested); else broadcastToSurface('host/settings', tested);
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
      const ev = event as { type: 'FEATURE_SETTINGS_UPDATED'; settings: CodeSettings }

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
     * What a window's code surface starts from, answered to it: the directory and the settings, then — the same ask
     * handed on, so it answers that window too — the running terminals. The panels ask for their own on the answer
     */
    sendCodeStart: ({ self, context, event, reply }) => {
      const connectedData: CodeConnectedData = {
        baseDirectory: context.baseDirectory,
        settings: featureSettings.forFeature('code').get(),
      };
      reply?.({ type: 'CODE_STARTED', data: connectedData });
      child(self, 'terminal')?.send(event);
    },
    
    /**
     * Something may have changed on disk that no file event reported. The watches are brought in line with the
     * checkout first — it may have become a repository, or a watch may have failed — and then git and the open
     * files say what, if anything, differs.
     */
    checkForExternalChanges: ({ context, event, self }) => {
      const byWindow = (event as { by?: 'window' }).by === 'window';
      child(self, 'explorer')?.send({ type: 'explorer.CHECK_OPEN_FILES' });
      const checkRepository = () => { child(self, 'commit')?.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED', reconcile: true, byWindow }) };
      const watcher = watcherOf(context.gitWatcher);
      if (watcher) void watcher.check().then(checkRepository, checkRepository);
      else checkRepository();
    },

    selectGitWatcher: sendTo('gitWatcher', ({ context }) => ({
      type: 'WATCH', selection: { watcher: watcherOf(context.gitWatcher), repository: repositoryOf(context.gitRepository) },
    })),
  })
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
        GET_CODE_START: {
          actions: 'sendCodeStart',
        },
        // Handle settings updates
        TEST_CLI_PROVIDER: { actions: 'testCliProvider' },
        CHECK_FOR_EXTERNAL_CHANGES: { actions: 'checkForExternalChanges' },
        FEATURE_SETTINGS_UPDATED: {
          actions: [
            'updateSettings',
            assign({ defaultBaseDirectory: ({ event }) => (event as { settings: CodeSettings }).settings.defaultBaseDirectory ?? null }),
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
        LIST_REPOSITORIES: { actions: 'listRepositories' },
        SECRETS_CHANGED: { actions: () => forgetHeldSignIn() },
        SELECT_REPOSITORY: {
          actions: ({ event, self }) => {
            const ev = event as { type: 'SELECT_REPOSITORY'; path: string }
            self.send({ type: 'SET_BASE_DIRECTORY', path: ev.path, fromUserNavigation: true, fromPicker: true })
          },
        },
        // A worktree switch changes the folder, which is this system's: it is not routed to the commit child
        'commit.WORKTREE_SWITCH': { actions: 'switchWorktree' },
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
