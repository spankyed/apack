import { compileSettingsCatalog } from '../features/settings/validation.ts';
// The host's implementations of the services packs reach through `services` (contracts in @apackdev/sdk/services),
// and the one place the app's HostRuntime is assembled.
import { secretRedaction } from '../secrets/redaction.ts';
import type { HostRuntime, RootEvents } from '@apackdev/sdk/runtime';
import type { EarsEngine } from '@apackdev/ears';
import type { RecordStore } from '@apackdev/ears';
import type { LmdbStore } from '@apackdev/ears/lmdb';
import type { RunNode } from '@apackdev/sdk/services';
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
  /** The app's LMDB store, which appData works on */
  store: LmdbStore;
  /**
   * The run history's record store, which runHistory works on and appData backs up and resets with the database: the
   * app's on disk (`openRunHistoryStore`), a test's in memory (`_memoryRunHistoryStore()`)
   */
  runHistory: RecordStore<RunNode>;
  /** The app's engine: packs get its operations, the services its `admin` too */
  engine: EarsEngine;
  /** The app's event bus */
  transport: { rootEvents: RootEvents };
  /** The app's registered packs (`createPackRegistry()`): packs read them through the SDK, the services reset them and apply their content */
  packs: PackRegistry;
  appVersion: string;
}

/** The running app as the SDK reaches it, which the composition root binds with `bindHost` */
export function createHostRuntime({ transport, appVersion, store, runHistory, engine, packs }: HostRuntimeOptions): HostRuntime {
  const settings = createSettingsService(createSettingsStore({
    ears: () => engine,
    catalog: packs.settingsCatalog,
    onCatalogChanged: packs.onCatalogChanged,
  }));
  packs.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate(settings.getOverrides()));
  const runHistoryService = createRunHistory(runHistory);
  return {
    transport,
    ears: engine,
    packs,
    appVersion,
    redaction: secretRedaction,
    services: {
      onboarding: createOnboarding(engine),
      // The service replaces the data; naming what the app is told about it belongs here, with the wiring
      appData: createAppData({ store, history: { service: runHistoryService, store: runHistory },
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
