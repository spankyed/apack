import { compileSettingsCatalog } from '../features/settings/validation.ts';
// The host's implementations of the services packs reach through `services` (contracts in @apackdev/sdk/services),
// and the one place the app's HostRuntime is assembled.
import { secretRedaction } from '../secrets/redaction.ts';
import type { HostRuntime, RootEvents, PerformanceExecution } from '@apackdev/sdk/runtime';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import type { PackRegistry } from '../packs/registry.ts';
import { createAppData } from './app-data.ts';
import { createOnboarding } from './onboarding.ts';
import { HOST } from '../refs.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { filesystem } from './filesystem.ts';
import { createSettingsService } from './settings.ts';
import { createSettingsStore, type SettingsStore } from '../features/settings/be/store.ts';

import { inference } from './inference.ts';
import { secrets } from './secrets.ts';
import { createRunHistory } from './run-history.ts';

const logger = createLogger('host-runtime');

/**
 * How long a refresh after another process's commit waits for more: a refresh blocks the API for hundreds of milliseconds,
 * and a shell loop or a repl session tells once per command. Measured 2026-11-05 on the built app at load 13-30: a POST of
 * the route took 150-1200 ms, at 1 note as at 11,000.
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

/** The running app as the SDK reaches it, which the composition root binds with `bindHost`, and what only that root calls */
export type AppRuntime = HostRuntime & {
  /**
   * A local tool committed to the database from its own process. Answers at once the problems of a stored settings row it
   * refused; every view reads the data again and every system is told once a burst of these has passed.
   */
  dataChangedElsewhere(): ReturnType<SettingsStore['adoptStored']>;
};

export function createHostRuntime({ transport, appVersion, database, runHistory, engine, packs, countCalls, performance }: HostRuntimeOptions): AppRuntime {
  const settingsStore = createSettingsStore({
    ears: () => engine,
    catalog: packs.settingsCatalog,
    onCatalogChanged: packs.onCatalogChanged,
  });
  const settings = createSettingsService(settingsStore);
  packs.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate(settings.getOverrides()));
  const runHistoryService = createRunHistory(runHistory.engine);
  let refreshing: ReturnType<typeof setTimeout> | undefined;
  const refreshAfterBurst = () => {
    refreshing ??= setTimeout(() => {
      refreshing = undefined;
      engine.admin.changedElsewhere();
      transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_CHANGED_ELSEWHERE' } });
    }, ELSEWHERE_REFRESH_MS);
    refreshing.unref?.();
  };
  const dataChangedElsewhere = () => {
    try {
      return settingsStore.adoptStored();
    } finally {
      refreshAfterBurst();
    }
  };
  // A tool that was killed after committing told nobody: the app's own next commit finds out
  engine.admin.onFoundElsewhere(() => {
    try {
      const refused = dataChangedElsewhere();
      if (refused.length > 0) logger.warn(`Refused the stored settings another process wrote: ${refused.map(problem => problem.message).join('; ')}`);
    } catch (error) {
      // Nobody is waiting on this to catch it, and an uncaught error ends the process
      logger.error('Hearing of a commit from another process failed:', error as Error);
    }
  });
  return {
    dataChangedElsewhere,
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
      // The service replaces the data; naming what the app is told about it belongs here, with the wiring
      appData: createAppData({ database, engine, history: { service: runHistoryService, database: runHistory.database },
        registry: packs, settings,
        onReplaced: () => transport.rootEvents.emitIncoming({ to: HOST.bus, event: { type: 'DATA_REPLACED' } }),
      }),
      runHistory: runHistoryService,
      inference,
      secrets,
      filesystem,
      // All owners use the accepted declaration catalog.
      settings,
    },
  };
}
