import { compileSettingsCatalog } from '../features/settings/validation.ts';
// The host's implementations of the services packs reach through `services` (contracts in @apackdev/sdk/services),
// and the one place the app's HostRuntime is assembled.
import { secretRedaction } from '../secrets/redaction.ts';
import type { HostRuntime, RootEvents } from '@apackdev/sdk/runtime';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import type { PackRegistry } from '../packs/registry.ts';
import { createAppData } from './app-data.ts';
import { createOnboarding } from './onboarding.ts';
import { HOST } from '../refs.ts';
import { filesystem } from './filesystem.ts';
import { createSettingsService } from './settings.ts';
import { createSettingsStore } from '../features/settings/be/store.ts';

import { inference } from './inference.ts';
import { secrets } from './secrets.ts';
import { createRunHistory } from './run-history.ts';

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
}

/** The running app as the SDK reaches it, which the composition root binds with `bindHost` */
export function createHostRuntime({ transport, appVersion, database, runHistory, engine, packs, countCalls }: HostRuntimeOptions): HostRuntime {
  const settings = createSettingsService(createSettingsStore({
    ears: () => engine,
    observe: operation => database.withoutWriteAuthority(() => runHistory.database.withoutWriteAuthority(operation)),
    catalog: packs.settingsCatalog,
    onCatalogChanged: packs.onCatalogChanged,
  }));
  packs.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate(settings.getOverrides()));
  const runHistoryService = createRunHistory(runHistory.engine);
  return {
    transport,
    ears: engine,
    packs,
    appVersion,
    redaction: secretRedaction,
    ...(countCalls && {
      diagnostics: {
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
