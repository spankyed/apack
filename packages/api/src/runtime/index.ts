import { createActor } from 'xstate';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { bindHost, type HostRuntime } from '@apackdev/sdk/runtime';
import { _getLmdbPath, _getRunHistoryPath } from '@apackdev/sdk/utils';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import { assertNoDatabaseWriter, databaseStorage, openDatabaseStore, openRunHistory, storedSettings, type RunsDatabase } from '@apackdev/host/database';
import { createPackRegistry, installShippedPacks, prepareHostDataDirs, type PackRegistry } from '@apackdev/host/packs';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { loadAppPacks, startPacks } from '@apackdev/host/packs/runtime';
// The app's own features: its registration, and the systems it runs for them
import {
  APPLICATION_SYSTEM_EVENTS, createApplicationSystem, createPacksSystem, createSettingsSystem, hostRegistration, hostDeclaration, packsEvents, settingsEvents,
} from '@apackdev/host/features';
import { createAppBus, createParticipantClaims, HOST } from '@apackdev/host/bus';
import { createHostRuntime } from '@apackdev/host/services';
import { createViewHost, type ViewHost } from '@apackdev/host/views';
import { _settingsAdmin } from '@apackdev/sdk/services';
import { compileSettingsCatalog, createSettingsAccess } from '@apackdev/host/settings';
import { forwardSecretsChanges } from '@apackdev/host/secrets';
import { assertSourceResolution } from '@apackdev/host/build/source-resolution';
import { rootEvents } from '../transport/emitter.ts';
import { initializeLogCapture, printLogEvents } from '../adapters/logging.ts';
import { createRequire } from 'module';
import pkg from '../../../../package.json';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Packaged processes read the same manifest; source runs use the checkout version. */
const APP_VERSION: string = process.env.APACK_APP_MANIFEST
  ? JSON.parse(readFileSync(process.env.APACK_APP_MANIFEST, 'utf8')).version
  : pkg.version;

const logger = createLogger('backend');

/** An actor observer that reports the actor's error as fatal, and tells Electron main (a `__fatal` JSON line on stderr) */
function logErrors(actor: string) {
  return {
    error: (error: unknown) => {
      logger.error(`${actor} State Error:`, { error });
      reportError({ error, title: 'Something went wrong', source: actor, severity: 'fatal' });
      const err = error instanceof Error ? error : new Error(String(error));
      process.stderr.write(JSON.stringify({ __fatal: true, message: err.message, stack: err.stack, source: actor }) + '\n');
    },
  };
}

/** The app's data: its elmdb database, the engine over it (both faces: the composition keeps `admin`), and its registered packs */
export interface AppStore {
  database: EarsDatabase;
  /** The run history's database and its engine, closed with the app's database */
  runHistory: RunsDatabase;
  engine: EarsEngine;
  packs: PackRegistry;
}

/** The app's registered packs, which openAppStore creates: the transport's procedures and dev reload work on them */
export let appPacks: PackRegistry;
export let appSettingsAccess: ReturnType<typeof createSettingsAccess>;
/** The views windows are subscribed to, run on the app's engine over its registered packs (`views.watch`) */
export let appViews: ViewHost;

/** The open database, so shutdown can close it, which syncs what is owed */
export let appDatabase: EarsDatabase | undefined;

/** The run history's open database, so shutdown can close it */
export let appRunHistory: RunsDatabase | undefined;

/**
 * Opens the app's data and binds the app: the registered packs (`createPackRegistry()`, empty until the caller
 * registers them), the elmdb database and the app's engine over it (`openDatabaseStore`, `@apackdev/host/database`,
 * which `apack db` opens a data dir with too) with their entity types, the run history's database, and
 * `bindHost(createHostRuntime(...))` with the root event bus, whose log events are printed, the app version, the
 * registry (the SDK's lookups read it), the engine (packs get its operations, bound by the bind) and the host
 * services over the database and the engine's admin face.
 */
/**
 * What the app holds at boot, once its packs are registered: the heap, and the database's size on disk. The engine
 * reads the database rather than a copy of it, so neither grows with the other; this is the reading that says so
 */
function bootReading(): string {
  const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;
  let onDisk: string;
  try {
    onDisk = appDatabase ? mb(statSync(path.join(appDatabase.path, databaseStorage(appDatabase.format).dataFile)).size) : 'unknown';
  } catch {
    onDisk = 'unknown';
  }
  return `Database ${onDisk} on disk, heap ${mb(process.memoryUsage().heapUsed)}`;
}

export function openAppStore(): AppStore {
  // Installed packs that aren't running keep their settings: the settings take writes for their features too
  let runtime: HostRuntime;
  const packs = createPackRegistry({
    nativeDeclarations: [hostDeclaration],
    installedPacksDir: () => resolveAppEnvironment().packsDir,
    appPackSourcesDir: () => process.env.SHIPPED_PACKS_DIR,
    settingsForPack: (packId) => runtime.services.settings.forPack(packId),
  });
  const { database, engine } = openDatabaseStore({
    path: _getLmdbPath(),
    schema: packs,
    // A where that filters thousands of rows for want of an index is a developer's to fix, so only development says so
    ...(resolveAppEnvironment().env === 'development' && { warn: (message: string) => logger.warn(message) }),
  });
  let runHistory: RunsDatabase | undefined;
  try {
    runHistory = openRunHistory(_getRunHistoryPath());
    runtime = createHostRuntime({
      database, runHistory, engine, transport: { rootEvents }, appVersion: APP_VERSION, packs,
      countCalls: resolveAppEnvironment().env === 'development',
    });
  } catch (error) {
    const failures: unknown[] = [error];
    for (const store of [database, runHistory?.database]) {
      try { store?.close(); } catch (closeError) { failures.push(closeError); }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'Opening app storage failed and cleanup also failed', { cause: error });
    throw error;
  }
  bindHost(runtime);
  printLogEvents();
  appPacks = packs;
  appSettingsAccess = createSettingsAccess(runtime.services.settings, packs.getPackRuntime);
  appViews = createViewHost({ ears: () => engine, packs });
  appDatabase = database;
  appRunHistory = runHistory;
  return { database, runHistory, engine, packs };
}

/**
 * Names claimed by a connection rather than registered by a pack: `host/drive`, which an agent driving the app
 * takes so a system can be told to answer *it*. An instance, created here with the rest of this process's
 * resources, written by `bus.claim` and read by the bus when it addresses an outgoing message.
 */
export const appClaims = createParticipantClaims();

// Exported for graceful shutdown (SIGTERM handler stops the actor system)
export let backendActor: ReturnType<typeof createActor<ReturnType<typeof createAppBus>>>;

export async function setupBackend(): Promise<void> {
  initializeLogCapture();

  // Before anything opens the database: a tool changing it (`apack db`) holds a lock until it's done, and opening
  // now would overwrite its change from this process's memory
  const appContext = resolveAppEnvironment();
  assertNoDatabaseWriter(appContext.userDataDir);

  // The app's data: the engine reads and writes it from here on
  const { database, runHistory, engine, packs } = openAppStore();
  await Promise.all([database.indexesReady(), runHistory.database.indexesReady()]);

  // Packs require workspace @apackdev/* packages at runtime: from a checkout they must get source,
  // not a stale dist (main starts the API with the condition; manual boots must pass it). The
  // packaged app runs the API on Electron's runtime and ships no workspace source.
  if (!process.versions.electron) {
    assertSourceResolution(createRequire(import.meta.url).resolve, 'The API server');
  }

  // Before discovery: a pack an interrupted install left only as its moved-aside copy is restored,
  // and apack pack install learns which apack uses this data dir
  prepareHostDataDirs({ userDataDir: appContext.userDataDir, packsDir: appContext.packsDir, version: APP_VERSION });

  // API keys: the settings system hears of every change to them
  forwardSecretsChanges(packs);

  // ── Install the packs the app ships, so every pack is an installed pack ────────────
  // Install before discovery. Ownership, shipped source revision and deliberate removal decide refresh;
  // matching bytes never grant app ownership of an existing user build.
  const shippedDir = process.env.SHIPPED_PACKS_DIR;
  if (!shippedDir) {
    // "This app ships no packs" and "nobody told me where they are" are different answers, and installing
    // nothing looks the same either way: on a fresh data dir both give an app with no surfaces
    console.warn('[packs] SHIPPED_PACKS_DIR is not set, so no pack the app ships is installed');
  } else {
    const results = await installShippedPacks(shippedDir, appContext.packsDir, { installedPacksFile: appContext.installedPacksFile, hostVersion: APP_VERSION, packFormat: PACK_SNAPSHOT_FORMAT, settingsOverrides: () => storedSettings(engine) });
    if (results.length === 0) console.warn(`[packs] ${shippedDir} holds no pack to install`);
    for (const result of results) {
      if (result.outcome === 'failed') console.error(`[packs] Could not install ${result.id}, which this app ships: ${result.error}`);
      else if (result.outcome === 'installed' || result.outcome === 'updated') console.log(`[packs] ${result.outcome === 'updated' ? 'Updated' : 'Installed'} ${result.id}, which this app ships`);
    }
  }

  // Static discovery and a direct stored-row read precede executable pack loading and hydration.
  packs.refreshCatalog(appContext.packsDir);
  const settingsProblems = compileSettingsCatalog(packs.settingsCatalog()).inspect(storedSettings(engine));
  const recoveringSettings = settingsProblems.length > 0;
  if (recoveringSettings) {
    console.error('[settings] Preferences require an explicit reset before normal startup:', settingsProblems);
    _settingsAdmin().enterRecovery();
    // This process remains host-only even after repair. Relaunch owns normal initialization.
    packs.catalog.setSettingsAdmission(() => { throw new Error('Restart the app after repairing settings before changing packs.'); });
  }

  packs.registerPack(hostRegistration({
    settings: { machine: createSettingsSystem(), receives: [...settingsEvents] },
    ...(!recoveringSettings && {
      application: { machine: createApplicationSystem(packs), receives: APPLICATION_SYSTEM_EVENTS },
      packs: { machine: createPacksSystem(packs), receives: [...packsEvents] },
    }),
  }));

  // Recovery starts only host actors; no executable external pack is imported.
  const loadedPacks = recoveringSettings ? [] : loadAppPacks(packs).loaded;

  console.log(`[app] apack v${APP_VERSION} startupId=${process.env.APACK_STARTUP_ID ?? 'unknown'}`);

  // ── Wire shutdown hooks (keyed by pack ID for scoped reload teardown) ──
  for (const pack of loadedPacks) {
    if (pack.registration.lifecycle?.onShutdown) {
      packs.registerShutdownHook(pack.registration.lifecycle.onShutdown, pack.origin.id);
    }
  }

  logger.info(bootReading());

  // ── Start the packs: each one's onInit, the migrations (the app's, then external packs'), the content
  if (!recoveringSettings) startPacks(packs);

  // ── Start backend actor ──────────────────────────────────────────────
  backendActor = createActor(createAppBus(packs, appClaims), {
    systemId: HOST.bus,
  }).start();

  backendActor.subscribe(logErrors('Backend'));
}
