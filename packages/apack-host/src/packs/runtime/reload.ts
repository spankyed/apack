import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@apackdev/sdk/logger';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { resolveAppEnvironment, getAppVersion } from '@apackdev/sdk/env';
import { packSystemIds, type PackRegistry } from '../registry.ts';
import { installShippedPacks } from '../installer.ts';
import { disabledPackIds } from '../installed.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { loadSingleExternalPack, clearPackRequireCache, registerExternalPacks } from './loader.ts';
import { runPackMigrations } from '../../migrations/index.ts';
import { applyPacks } from './apply.ts';
import { acceptInstalledPack, replacePackRuntime } from './lifecycle.ts';

const logger = createLogger('pack-reload');

/** A pack's freshly loaded runtime, not yet registered */
interface FreshPack {
  newSystemIds: string[];
  /** Registers the fresh runtime; throws when the registration is refused */
  register(replacing: boolean): void;
  onShutdown?: () => void;
  initialize(): void;
}

/**
 * Replaces a running pack with its rebuilt runtime. The fresh runtime is loaded and registered before the
 * running one is shut down: if it fails to load, or its registration is refused, the running pack stays as
 * it was and the error is thrown.
 */
async function reloadPack(
  registry: PackRegistry,
  packId: string,
  backendActor: import('xstate').AnyActorRef,
  loadFresh: () => FreshPack,
  cacheDir: string,
): Promise<void> {
  const previous = registry.getPackRegistration(packId);
  const oldSystemIds = previous ? packSystemIds(previous) : [];

  logger.info(`Reloading pack: ${packId}`);

  // The running pack's modules stay live; only a fresh require loads the rebuilt ones
  clearPackRequireCache(cacheDir);
  const fresh = loadFresh();

  // Candidate refusal leaves the incumbent's accepted resources untouched.
  fresh.register(!!previous);

  try {
    await registry.indexesReady(packId);
  } catch (error) {
    // Registration is already accepted. Keep its files, but do not start actors on incomplete indexes.
    registry.runShutdownHooksForKey(packId);
    try { registry.unregisterPack(packId); }
    catch (cleanupError) { logger.error(`Cleaning up failed reload of ${packId}:`, cleanupError as Error); }
    backendActor.send({ type: 'TEARDOWN_PACK', packId, systemIds: [...new Set([...oldSystemIds, ...fresh.newSystemIds])] });
    backendActor.send({ type: 'PACK_CHANGED', packId });
    registry.recordLoadProblem(packId, `index readiness failed: ${errorMessage(error)}`);
    throw error;
  }

  registry.runShutdownHooksForKey(packId);
  if (fresh.onShutdown) {
    registry.registerShutdownHook(fresh.onShutdown, packId);
  }
  // Side work once the swap is done (applying content, publishing build output, the loaded-pack list). By here the old
  // registration is gone and its shutdown hooks have run, so the systems must be restarted whatever this
  // does: a throw that escaped would leave the fresh registration live, the old actors running but already
  // torn down, and nothing ever stopped or respawned.
  try {
    fresh.initialize();
  } catch (err) {
    logger.error(`Pack ${packId} reloaded, but the work after registering it failed:`, err as Error);
  }

  // The bus stops each of these and starts those still registered: a feature the pack dropped only stops
  const systemIds = [...new Set([...oldSystemIds, ...fresh.newSystemIds])];

  backendActor.send({ type: 'RELOAD_PACK', packId, systemIds });
  // Other packs' systems read what this one registers and content (the chat's slash commands, say). Sent once the
  // fresh registration is live, never between unregistering the old one and registering it
  backendActor.send({ type: 'PACK_CHANGED', packId });

  logger.info(`Pack reloaded: ${packId} (${fresh.newSystemIds.length} systems)`);
}

/**
 * Reloads a pack after a rebuild: its built runtime is re-required from its own directory, its systems are
 * stopped and respawned, and its data is brought up to date.
 *
 * **The caller says which pack, never what kind of pack it is.** The registry already knows which directory
 * the pack was loaded from, and a caller that could claim otherwise could ask for a reload of a pack the app
 * does not have in the place it says.
 */
export async function reloadPackById(
  registry: PackRegistry,
  packId: string,
  backendActor: import('xstate').AnyActorRef,
): Promise<void> {
  const { packsDir } = resolveAppEnvironment();
  const packDir = path.join(packsDir, packId);

  // Refresh app-managed copies when the shipped source changes; user-owned forks stay in place.
  // Acceptance couples filesystem/record rollback with registration before post-publication startup.
  const shippedDir = process.env.SHIPPED_PACKS_DIR;
  let startInstalled: (() => Promise<boolean>) | undefined;
  if (shippedDir) {
    for (const result of await installShippedPacks(shippedDir, packsDir, {
      installedPacksFile: resolveAppEnvironment().installedPacksFile,
      only: packId,
      beforePlace: manifest => registry.catalog.assertPackSettings(manifest),
      hostVersion: getAppVersion(),
      packFormat: PACK_SNAPSHOT_FORMAT,
      accept: candidate => {
        if (!disabledPackIds().has(candidate.id)) startInstalled = acceptInstalledPack(registry, candidate.id, backendActor);
      },
    })) {
      // The author's edit is the point of the reload, so a refresh that failed is the answer rather than a
      // note beside a reload of the previous build
      if (result.outcome === 'failed') throw new Error(`Could not refresh the installed copy of ${packId}, which this app ships: ${result.error}`);
      if (result.outcome === 'installed' || result.outcome === 'updated') logger.info(`Refreshed the installed copy of ${packId} from ${shippedDir}`);
    }
  }

  if (disabledPackIds().has(packId)) {
    registry.refreshCatalog(packsDir);
    backendActor.send({ type: 'PACK_CHANGED', packId });
    return;
  }

  if (startInstalled) {
    if (!await startInstalled()) throw new Error(`Accepted ${packId}, but ${registry.loadProblem(packId)}`);
    return;
  }

  if (!fs.existsSync(packDir)) {
    throw new Error(`Pack directory not found: ${packDir}`);
  }

  const manifestPath = path.join(packDir, 'apack.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No apack.json found in ${packDir}`);
  }

  await reloadPack(registry, packId, backendActor, () => {
    const pack = loadSingleExternalPack(registry, packDir);
    if ('problem' in pack) {
      // A pack still running keeps its previous runtime, so only one that isn't has a load problem to show
      if (!registry.getPackRegistration(packId)) registry.recordLoadProblem(packId, pack.problem);
      throw new Error(`Failed to load pack ${packId} after rebuild: ${pack.problem}`);
    }

    return {
      register: (replacing) => {
        if (replacing) {
          try {
            for (const problem of replacePackRuntime(registry, pack, backendActor)) {
              logger.error(`Pack ${packId} replaced, but old binding cleanup failed: ${problem}`);
            }
          } catch (error) {
            throw new Error(`Failed to register pack ${packId}`, { cause: error });
          }
        } else if (registerExternalPacks(registry, [pack]).length === 0) {
          throw new Error(`Failed to register pack ${packId}`);
        }
      },
      newSystemIds: packSystemIds(pack.registration),
      onShutdown: pack.registration.lifecycle?.onShutdown,
      initialize: () => {
        registry.refreshCatalog(packsDir);
        pack.registration.lifecycle?.onInit?.();
        runPackMigrations(registry.packMigrationTargets('pack', [packId]));
        applyPacks(registry.packContentTargets([packId]));
      },
    };
  }, packDir);
}
