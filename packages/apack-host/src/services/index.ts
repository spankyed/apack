import { compileSettingsCatalog } from '../features/settings/validation.ts';
// The host's implementations of the services packs reach through `services` (contracts in @apackdev/sdk/services),
// and the one place the app's HostRuntime is assembled.
import { secretRedaction } from '../secrets/redaction.ts';
import { _installProjections, type HostRuntime, type RootEvents, type PerformanceExecution } from '@apackdev/sdk/runtime';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import type { PackRegistry } from '../packs/registry.ts';
import { createAppData } from './app-data.ts';
import { createOnboarding } from './onboarding.ts';
import { HOST } from '../refs.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { filesystem } from './filesystem.ts';
import { createSettingsService } from './settings.ts';
import { createSettingsStore } from '../features/settings/be/store.ts';

import { inference } from './inference.ts';
import { secrets } from './secrets.ts';
import { createRunHistory } from './run-history.ts';

const logger = createLogger('host-runtime');

/**
 * How long a refresh after another process's commit waits for more: a script's every unit wakes the app, and each refresh
 * has every system publish. CPU profile of the built app, 2026-11-05, load about 40: 10 ms per refresh at 1 note, 148 ms
 * at 11,000.
 */
const ELSEWHERE_REFRESH_MS = 250;

export interface HostRuntimeOptions {
  /** The app's database, which appData works on */
  database: EarsDatabase;
  /**
   * The run history's database and its engine, which runHistory works on and appData backs up and resets with the
   * app's database: the app's (`openRunHistory`), a test's in a temporary directory (`_openTestRunHistory()`)
   */
  runHistory: { database: EarsDatabase; engine: EarsEngine };
  /** The app's engine: packs get its operations, the services its `admin` too */
  engine: EarsEngine;
  /** The app's event bus */
  transport: { rootEvents: RootEvents };
  /** The app's registered packs (`createPackRegistry()`): packs read them through the SDK, the services reset them and apply their content */
  packs: PackRegistry;
  appVersion: string;
  /** Whether the runtime offers counting its engines' calls (`HostRuntime.diagnostics`): a development app's choice */
  countCalls?: boolean;
  /** Development/test context supplied by the composition root, never initialized by services. */
  performance?: PerformanceExecution;
}

export function createHostRuntime({ transport, appVersion, database, runHistory, engine, packs, countCalls, performance }: HostRuntimeOptions): HostRuntime & {
  /** Brings the engine's projections up to what changed since each last read: at boot, once the packs have started */
  catchUpProjections(): Promise<void>;
} {
  const projections = _installProjections(engine);
  const settingsStore = createSettingsStore({
    ears: () => engine,
    catalog: packs.settingsCatalog,
    onCatalogChanged: packs.onCatalogChanged,
  });
  const settings = createSettingsService(settingsStore);
  packs.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate(settings.getOverrides()));
  const runHistoryService = createRunHistory(runHistory.engine);
  // The service replaces the data; naming what the app is told about it belongs here, with the wiring
  const { replacedElsewhere, ...appData } = createAppData({ database, engine, history: { service: runHistoryService, database: runHistory.database, engine: runHistory.engine },
    registry: packs, settings, projections,
    onReplaced: () => transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_REPLACED' } }),
  });
  let refreshing: ReturnType<typeof setTimeout> | undefined;
  /** Runs once a burst of commits from elsewhere has passed. Nothing waits on this timer to catch what it throws, and an uncaught error ends the process */
  const refreshAfterBurst = () => {
    refreshing ??= setTimeout(() => {
      refreshing = undefined;
      try {
        // Either database: a tool resets the run history first, and may stop before the app's
        if (engine.admin.replacedElsewhere() !== undefined || runHistory.engine.admin.replacedElsewhere() !== undefined) {
          void replacedElsewhere().catch((error: unknown) => {
            // Its writes stay refused: the next one refused, a pack changing or another wake tries again
            logger.error('Starting over after another process replaced the data failed:', error as Error);
          });
          return;
        }
      } catch (error) {
        logger.error('Asking whether another process replaced the data failed:', error as Error);
      }
      try {
        settingsStore.adoptStored();
      } catch (error) {
        logger.error('Reviewing the stored settings after a commit from another process failed:', error as Error);
      }
      let changed = true;
      try {
        changed = engine.admin.changedElsewhere();
      } catch (error) {
        logger.error('Refreshing after a commit from another process failed:', error as Error);
      }
      // The run history is a database of its own, which a tool may write without the app's: its watches run again from
      // what it answers
      try {
        runHistory.engine.admin.changedElsewhere();
      } catch (error) {
        logger.error('Refreshing the run history after a commit from another process failed:', error as Error);
      }
      // Whatever the answer, since each projection reads from its own cursor
      void projections.catchUp();
      if (changed) transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_CHANGED_ELSEWHERE' } });
    }, ELSEWHERE_REFRESH_MS);
    refreshing.unref?.();
  };
  for (const hearing of [engine, runHistory.engine]) {
    try {
      hearing.admin.onFoundElsewhere(refreshAfterBurst);
    } catch (error) {
      logger.warn('This app will hear of commits from other processes only at its own next commit:', error as Error);
    }
  }
  // A pack changing may have waited out a start-over refused while it ran, and its projections may have missed commits
  packs.onRegistrationChanged(refreshAfterBurst);
  return {
    catchUpProjections: projections.catchUp,
    transport,
    ears: engine,
    packs,
    appVersion,
    redaction: secretRedaction,
    ...((countCalls || performance) && {
      diagnostics: {
        ...(performance && { performance }),
        calls: {
          start() {
            engine.admin.calls.start();
            runHistory.engine.admin.calls.start();
          },
          report: () => ({ app: engine.admin.calls.report(), runHistory: runHistory.engine.admin.calls.report() }),
          stop: () => ({ app: engine.admin.calls.stop(), runHistory: runHistory.engine.admin.calls.stop() }),
        },
      },
    }),
    services: {
      onboarding: createOnboarding(engine),
      appData,
      runHistory: runHistoryService,
      inference,
      secrets,
      filesystem,
      // All owners use the accepted declaration catalog.
      settings,
    },
  };
}
