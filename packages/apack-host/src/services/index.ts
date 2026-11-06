import { compileSettingsCatalog } from '../features/settings/validation.ts';
// The host's implementations of the services packs reach through `services` (contracts in @apackdev/sdk/services),
// and the one place the app's HostRuntime is assembled.
import { secretRedaction } from '../secrets/redaction.ts';
import { _catchUpProjections, _installProjections, type HostRuntime, type RootEvents, type PerformanceExecution } from '@apackdev/sdk/runtime';
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

export function createHostRuntime({ transport, appVersion, database, runHistory, engine, packs, countCalls, performance }: HostRuntimeOptions): HostRuntime {
  _installProjections(engine);
  const settingsStore = createSettingsStore({
    ears: () => engine,
    catalog: packs.settingsCatalog,
    onCatalogChanged: packs.onCatalogChanged,
  });
  const settings = createSettingsService(settingsStore);
  packs.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate(settings.getOverrides()));
  const runHistoryService = createRunHistory(runHistory.engine);
  // The service replaces the data; naming what the app is told about it belongs here, with the wiring
  const { replacedElsewhere, ...appData } = createAppData({ database, engine, history: { service: runHistoryService, database: runHistory.database },
    registry: packs, settings,
    onReplaced: () => transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_REPLACED' } }),
  });
  let refreshing: ReturnType<typeof setTimeout> | undefined;
  /** Runs once a burst of commits from elsewhere has passed. Nothing waits on this timer to catch what it throws, and an uncaught error ends the process */
  const refreshAfterBurst = () => {
    refreshing ??= setTimeout(() => {
      refreshing = undefined;
      try {
        if (engine.admin.replacedElsewhere()) {
          void replacedElsewhere().catch((error: unknown) => {
            // Its writes stay refused, and the next one refused brings this back
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
      // Whatever the answer, since each projection reads the log from its own cursor
      _catchUpProjections(engine);
      if (changed) transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_CHANGED_ELSEWHERE' } });
    }, ELSEWHERE_REFRESH_MS);
    refreshing.unref?.();
  };
  try {
    engine.admin.onFoundElsewhere(refreshAfterBurst);
  } catch (error) {
    logger.warn('This app will hear of commits from other processes only at its own next commit:', error as Error);
  }
  return {
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
