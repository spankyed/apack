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
import { createLogger } from '@apackdev/sdk/logger';

const cliLogger = createLogger('code');
import { setup, enqueueActions, assign, sendTo, type AnyActorRef } from 'xstate'

import { defineSystem } from '@apackdev/sdk/framework'
import { GitRepository } from './services/git.ts'
import { GitWatcherService } from './services/gitwatcher.ts'
import { gitWatcherActor } from './git-watcher-actor.ts'

// child systems; their events come from the contract, which is where every child's now live
import { explorerSystem } from './features/explorer.ts'
import { searchSystem } from './features/search.ts'
import { commitSystem } from './features/commit.ts'
import { pullRequestSystem } from './features/pull-request.ts'
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
          baseDirectory: context.baseDirectory,
          gitWatcher: context.gitWatcher
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
          gitRepository: context.gitRepository,
          gitWatcher: context.gitWatcher,
          code: self
        }
      });
      enqueue.spawnChild('pullRequestSystem', {
        id: 'pr',
        input: {
          baseDirectory: context.baseDirectory,
          gitRepository: context.gitRepository,
          code: self
        }
      });
      enqueue.spawnChild('terminalSystem', {
        id: 'terminal',
        input: {
          baseDirectory: context.baseDirectory
        }
      });
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
      gitRepository: ({ event, context }) => {
        const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
        // Clear the old repository's cache before creating new one
        if (context.gitRepository) {
          context.gitRepository.clearCache()
        }
        const repo = new GitRepository(ev.path)
        const codeSettings = featureSettings.forFeature('code').get()
        repo.setFetchConfig(
          codeSettings?.autoFetchRemote ?? false,
          codeSettings?.autoFetchIntervalSeconds ?? 180
        )
        return repo
      },
      gitWatcher: ({ event }) => {
        const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
        return new GitWatcherService(ev.path)
      }
    }),

    notifyChildSystemsOfBaseChange: ({ event, self, context }) => {
      const ev = codeSpec.typeOf('SET_BASE_DIRECTORY', event)
      const newPath = ev.path

      // Update child systems
      child(self, 'explorer')?.send({
        type: 'explorer.UPDATE_BASE_DIRECTORY',
        path: newPath,
        gitWatcher: context.gitWatcher
      });
      child(self, 'search')?.send({ type: 'search.UPDATE_BASE_DIRECTORY', path: newPath });
      // Pass the new git services to systems that need them
      child(self, 'commit')?.send({
        type: 'commit.UPDATE_BASE_DIRECTORY',
        path: newPath,
        gitRepository: context.gitRepository,
        gitWatcher: context.gitWatcher
      });
      child(self, 'pr')?.send({
        type: 'pr.UPDATE_BASE_DIRECTORY',
        path: newPath,
        gitRepository: context.gitRepository
      });
      // Note: Updates terminal's base directory for new terminal creation.
      // Individual terminal processes track their own cwd independently.
      child(self, 'terminal')?.send({ type: 'terminal.UPDATE_BASE_DIRECTORY', path: newPath });
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

      // Update git fetch config if repository exists
      if (context.gitRepository) {
        context.gitRepository.setFetchConfig(
          ev.settings.autoFetchRemote ?? false,
          ev.settings.autoFetchIntervalSeconds ?? 180
        )
      }

    },
    
    broadcastConnected: ({ self, context }) => {
      // Send CODE_CONNECTED to all children that need it
      child(self, 'explorer')?.send({ type: 'CODE_CONNECTED' });
      child(self, 'terminal')?.send({ type: 'CODE_CONNECTED' });
      child(self, 'codeActions')?.send({ type: 'CODE_CONNECTED' });
      child(self, 'codePrompts')?.send({ type: 'CODE_CONNECTED' });

      // Get code settings - this will create default settings if they don't exist
      const codeSettings = featureSettings.forFeature('code').get();

      // Send initial directory state to frontend
      const connectedData: CodeConnectedData = {
        baseDirectory: context.baseDirectory,
        settings: codeSettings
      };

      broadcastToSurface('code', {
        type: 'CODE_CONNECTED',
        data: connectedData
      })
    },
    
    selectGitWatcher: sendTo('gitWatcher', ({ context }) => ({
      type: 'WATCH', selection: { watcher: context.gitWatcher, repository: context.gitRepository },
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

    const gitRepo = baseDir ? new GitRepository(baseDir) : null
    if (gitRepo) {
      gitRepo.setFetchConfig(
        codeSettings?.autoFetchRemote ?? false,
        codeSettings?.autoFetchIntervalSeconds ?? 180
      )
    }

    return {
      baseDirectory: baseDir,
      defaultBaseDirectory: codeSettings?.defaultBaseDirectory ?? null,
      gitRepository: gitRepo,
      gitWatcher: baseDir ? new GitWatcherService(baseDir) : null
    }
  },
  entry: 'spawnFeatureActors',
  invoke: {
    id: 'gitWatcher', src: 'gitWatcherActor',
    input: ({ context, self }) => ({ watcher: context.gitWatcher, repository: context.gitRepository,
      onChange: () => child(self, 'commit')?.send({ type: 'commit.GIT_STATUS_CHANGED' }),
    }),
  },
  states: {
    idle: {
      on: {
        SEND_STATE: {
          actions: 'broadcastConnected',
        },
        // Handle settings updates
        TEST_CLI_PROVIDER: { actions: 'testCliProvider' },
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
        // Worktree switch is intercepted here to change baseDirectory
        'commit.WORKTREE_SWITCH': {
          actions: ({ event, self }) => {
            const ev = event as { type: 'commit.WORKTREE_SWITCH'; path: string }
            self.send({ type: 'SET_BASE_DIRECTORY', path: ev.path, fromUserNavigation: true })
          }
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
