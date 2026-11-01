import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@apackdev/sdk/logger';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { packSystemIds, type PackRegistry } from '../registry.ts';
import { loadSingleExternalPack, clearPackRequireCache, registerExternalPacks, type LoadedPack } from './loader.ts';
import { runPackMigrations } from '../../migrations/index.ts';
import { applyPacks } from './apply.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('pack-lifecycle');

/**
 * Unregister and revoke a pack only after the bus finishes stopping its actors and subscriptions. Resolves once
 * that has happened, so a caller holding the pack's claim can keep it until the pack is gone.
 */
export function teardownPack(
  registry: PackRegistry,
  packId: string,
  busActor: import('xstate').AnyActorRef,
): Promise<void> {
  const systemIds = registry.getRegisteredPackSystemIds(packId);

  logger.info(`Tearing down pack: ${packId}`);

  const finish = () => {
    registry.runShutdownHooksForKey(packId);
    // Whatever stopped it loading is no longer the pack's state: it is disabled, gone, or about to be activated again
    registry.clearLoadProblem(packId);

    // Asked, not caught: unregisterPack also throws when a contribution couldn't be taken back out, and
    // reporting that as a pack nobody had registered is the wrong story. The pack is unregistered either
    // way, so the rest of the teardown — the require cache, stopping its systems — still has to happen.
    if (!registry.getPackRegistration(packId)) {
      logger.info(`Pack ${packId} was not previously registered`);
    } else {
      try {
        registry.unregisterPack(packId);
      } catch (err) {
        logger.error(`Tearing down pack ${packId}:`, err as Error);
      }
    }

    const packDir = path.join(resolveAppEnvironment().packsDir, packId);
    if (fs.existsSync(packDir)) {
      clearPackRequireCache(packDir);
    }

    // The systems still running read what the pack registered (its slash commands, say)
    busActor.send({ type: 'PACK_CHANGED', packId });

    logger.info(`Pack torn down: ${packId} (${systemIds.length} systems stopped)`);
  };
  return new Promise(resolve => {
    const finished = () => { try { finish(); } finally { resolve(); } };
    if (systemIds.length > 0) busActor.send({ type: 'TEARDOWN_PACK', packId, systemIds, afterStop: finished });
    else finished();
  });
}

/** Publish checked bindings first; revoke the incumbent only after its actors finish cleanup. */
export function replacePackRuntime(registry: PackRegistry, pack: LoadedPack, busActor: import('xstate').AnyActorRef): string[] {
  const systemIds = registry.getRegisteredPackSystemIds(pack.registration.id);
  return registry.replacePack(pack.registration, pack.origin, { retireBinding: dispose => {
    busActor.send({ type: 'TEARDOWN_PACK', packId: pack.registration.id, systemIds,
      afterStop: () => {
        for (const problem of dispose()) logger.error(`Pack ${pack.registration.id} accepted, but old binding cleanup failed: ${problem}`);
      },
    });
  } });
}

/**
 * Loads, registers and starts an installed pack as a boot starts it: its onInit, its migrations, then its content
 * (hash-checked, so unchanged data isn't imported again). Returns false when it can't be read, loaded or registered,
 * with why recorded as the pack's load problem in `registry`.
 */
export async function activatePack(
  registry: PackRegistry,
  packId: string,
  busActor: import('xstate').AnyActorRef,
): Promise<boolean> {
  const { packsDir } = resolveAppEnvironment();
  registry.refreshCatalog(packsDir);
  const packDir = path.join(packsDir, packId);

  const failed = (problem: string, err?: Error): false => {
    logger.error(`Failed to load pack ${packId}: ${problem}`, err);
    registry.recordLoadProblem(packId, problem);
    return false;
  };

  if (!fs.existsSync(packDir)) return failed(`pack directory not found: ${packDir}`);

  const pack = loadSingleExternalPack(registry, packDir);
  if ('problem' in pack) return failed(pack.problem);

  // A refused registration is recorded as the load problem by registerExternalPacks
  const registered = registerExternalPacks(registry, [pack]);
  if (registered.length === 0) {
    logger.error(`Failed to register pack ${packId}`);
    return false;
  }

  return startAcceptedPack(registry, pack, busActor);
}

/**
 * Accept the candidate currently at its final install path, preserving the incumbent on refusal.
 * Call the returned starter only after filesystem publication succeeds: initialization can write data.
 */
export function acceptInstalledPack(
  registry: PackRegistry,
  packId: string,
  busActor: import('xstate').AnyActorRef,
): () => Promise<boolean> {
  const packDir = path.join(resolveAppEnvironment().packsDir, packId);
  const previous = registry.getPackRegistration(packId);
  const previousSystemIds = previous ? packSystemIds(previous) : undefined;
  clearPackRequireCache(packDir);
  let pack: LoadedPack;
  let cleanupProblems: string[] = [];
  try {
    const candidate = loadSingleExternalPack(registry, packDir);
    if ('problem' in candidate) throw new Error(`Failed to load pack ${packId}: ${candidate.problem}`);
    pack = candidate;
    if (previous) {
      cleanupProblems = replacePackRuntime(registry, pack, busActor);
    } else {
      registry.registerPack(pack.registration, pack.origin);
    }
  } catch (error) {
    clearPackRequireCache(packDir);
    throw error;
  }
  return async () => {
    const started = await startAcceptedPack(registry, pack, busActor, previousSystemIds);
    for (const problem of cleanupProblems) logger.error(`Pack ${packId} accepted, but old binding cleanup failed: ${problem}`);
    return started;
  };
}

async function startAcceptedPack(
  registry: PackRegistry,
  pack: LoadedPack,
  busActor: import('xstate').AnyActorRef,
  previousSystemIds?: string[],
): Promise<boolean> {
  const packId = pack.registration.id;
  const systemIds = packSystemIds(pack.registration);
  const affectedSystemIds = [...new Set([...(previousSystemIds ?? []), ...systemIds])];
  const { lifecycle } = pack.registration;
  if (previousSystemIds) registry.runShutdownHooksForKey(packId);
  if (lifecycle?.onShutdown) registry.registerShutdownHook(lifecycle.onShutdown, packId);
  try {
    await registry.indexesReady();
    registry.refreshCatalog(resolveAppEnvironment().packsDir);
    lifecycle?.onInit?.();
    runPackMigrations(registry.packMigrationTargets('pack', [packId]));
    applyPacks(registry.packContentTargets([packId]));
  } catch (error) {
    registry.runShutdownHooksForKey(packId);
    try { registry.unregisterPack(packId); }
    catch (cleanupError) { logger.error(`Cleaning up failed activation of ${packId}:`, cleanupError as Error); }
    if (affectedSystemIds.length) busActor.send({ type: 'TEARDOWN_PACK', systemIds: affectedSystemIds });
    busActor.send({ type: 'PACK_CHANGED', packId });
    const problem = `initialization failed: ${errorMessage(error)}`;
    logger.error(`Failed to start accepted pack ${packId}: ${problem}`);
    registry.recordLoadProblem(packId, problem);
    return false;
  }

  if (previousSystemIds) {
    busActor.send({ type: 'RELOAD_PACK', packId, systemIds: affectedSystemIds });
    busActor.send({ type: 'PACK_CHANGED', packId });
  } else {
    busActor.send({ type: 'PACK_CHANGED', packId });
    if (systemIds.length) busActor.send({ type: 'ACTIVATE_PACK', packId, systemIds });
  }
  logger.info(`Pack activated: ${packId} (${systemIds.length} systems started)`);
  return true;
}
