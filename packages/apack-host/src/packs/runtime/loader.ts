import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';
import { createLogger } from '@apackdev/sdk/logger';
import { resolveAppEnvironment, getAppVersion } from '@apackdev/sdk/env';
import { _packDeclarationProblem, type PackRegistration } from '@apackdev/sdk/framework';
import { packSystemIds, type PackRegistry, type PackOrigin } from '../registry.ts';
import { readInstalledPackBuild, readInstalledPackBuilds, type PackManifest } from '../discovery.ts';
import { disabledPackIds, forgetPacksExcept } from '../installed.ts';
import { PACK_LAYOUT } from '../layout.ts';
import { isHostCompatible } from '../installer.ts';
import { packLoadFailed, packRegistered } from '../load-messages.ts';
import { findSdkVersion } from '../../build/shared-deps.ts';
import { withHostResolution } from './bridge.ts';
import { backendBindingProblem } from '../declaration-binding.ts';
import type { PackEventContracts } from '@apackdev/sdk/framework';
import { assertPackServiceRequirements } from '../service-requirements.ts';

// Always use createRequire — esbuild's require shim is a Proxy without .cache
const esmRequire = Module.createRequire(import.meta.url);
const logger = createLogger('pack-loader');

/**
 * An external pack the loader read: what its bundle registered, and where the app found it.
 *
 * The registration is the pack's own object, passed to the registry as it is, never flattened into this type
 * field by field: a hand-written copy of its fields drops whichever one it was written before.
 */
export interface LoadedPack {
  registration: PackRegistration;
  origin: PackOrigin;
}


let _hostSdkVersion: string | undefined;
function getHostSdkVersion(): string | undefined {
  if (_hostSdkVersion !== undefined) return _hostSdkVersion || undefined;
  try {
    const sdkEntry = esmRequire.resolve('@apackdev/sdk/package.json');
    _hostSdkVersion = findSdkVersion(path.dirname(sdkEntry)) ?? '';
  } catch { _hostSdkVersion = ''; }
  return _hostSdkVersion || undefined;
}

/** A pack's runtime module, as its built `runtime/index.cjs` exports it */
export interface PackRuntimeModule {
  registration?: PackRegistration;
  setCompiledDir?: (dir: string) => void;
}

/** Why the loader didn't load an installed pack, said as the Packs view shows it after "Failed to load:" */
export interface PackLoadProblem {
  problem: string;
}

/** Where the loader records why it skipped a pack: the app's registry, which the Packs view reads it from */
export type LoadProblemSink = Pick<PackRegistry, 'recordLoadProblem'>;

function skipped(id: string, problem: string): PackLoadProblem {
  logger.warn(`Skipping ${id}: ${problem}`);
  return { problem };
}

/** Reads an installed pack and its runtime, or says why it can't be loaded */
export function loadSingleExternalPack(
  registry: Pick<PackRegistry, 'catalog'>,
  dir: string,
): LoadedPack | PackLoadProblem {
  let build;
  try { build = readInstalledPackBuild(dir); }
  catch (error) { return skipped(path.basename(dir), (error as Error).message); }
  const { snapshot, integrity, revision: buildRevision } = build;
  const { manifest, declarationRevision } = snapshot;
  try {
    registry.catalog.assertPackSettings(manifest);
    registry.catalog.assertPackDestinations({ dir, snapshot });
    assertPackServiceRequirements(registry.catalog.getSnapshot(), { origin: 'installed', declaration: manifest });
  }
  catch (error) { return skipped(manifest.id, (error as Error).message); }
  const buildFiles = Object.freeze({ ...integrity.files });
  const appVersion = getAppVersion();
  if (!isHostCompatible(manifest.hostVersion, appVersion)) {
    return skipped(manifest.id, `requires host ${manifest.hostVersion}, running ${appVersion}`);
  }
  const hostSdk = getHostSdkVersion();
  if (snapshot.sdkVersion && hostSdk && snapshot.sdkVersion.split('.')[0] !== hostSdk.split('.')[0]) {
    logger.warn(`Pack ${manifest.id} was built with SDK v${snapshot.sdkVersion} but host is v${hostSdk} (major version mismatch)`);
  }
  const runtimeEntry = path.join(dir, PACK_LAYOUT.runtimeEntry);
  const registration = loadBundledRuntime(manifest, dir, runtimeEntry, declarationRevision, snapshot.eventContracts);
  if ('problem' in registration) return registration;

  return {
    registration,
    origin: { id: manifest.id, name: manifest.name, version: manifest.version, declarationRevision, buildRevision, buildFiles, eventContracts: snapshot.eventContracts, dir, manifest },
  };
}

/**
 * The pack's own registration from its runtime bundle, as the pack built it: `apack pack build` already put the
 * events the manifest adds into each system's `receives`, and the registry derives every ref from the feature ids.
 */
function loadBundledRuntime(
  manifest: PackManifest,
  dir: string,
  runtimeEntry: string,
  declarationRevision: string,
  eventContracts: PackEventContracts | undefined,
): PackRegistration | PackLoadProblem {
  let registration: PackRegistration | PackLoadProblem;
  try {
    registration = withHostResolution(() => {
      const mod = esmRequire(runtimeEntry);
      const problem = _packDeclarationProblem({ id: manifest.id, declarationRevision }, mod.registration)
        ?? backendBindingProblem(manifest, mod.registration, eventContracts);
      if (problem) return { problem };
      mod.setCompiledDir?.(path.join(dir, PACK_LAYOUT.contentDir));
      return mod.registration;
    });
  } catch (err) {
    logger.error(`Failed to load ${manifest.id} runtime (${PACK_LAYOUT.runtimeEntry}): ${(err as Error).message}`, err as Error);
    return { problem: `its runtime (${PACK_LAYOUT.runtimeEntry}) threw: ${(err as Error).message}` };
  }
  if ('problem' in registration) return registration;

  return { ...registration };
}

export function clearPackRequireCache(packDir: string): void {
  // Node keys its cache by real path; callers may name the installed tree through a symlink.
  const prefixes = [path.resolve(packDir), ...(fs.existsSync(packDir) ? [fs.realpathSync(packDir)] : [])]
    .map(dir => dir + path.sep);
  for (const key of Object.keys(esmRequire.cache)) {
    if (prefixes.some(prefix => key.startsWith(prefix))) {
      delete esmRequire.cache[key];
    }
  }
}

/**
 * Reads every enabled installed pack against one committed catalog. Validate the complete installed
 * claim set before importing any candidate; record individual load refusals in the same registry.
 */
export function loadExternalPacks(registry: LoadProblemSink & Pick<PackRegistry, 'catalog' | 'refreshCatalog'>): LoadedPack[] {
  const { packsDir } = resolveAppEnvironment();
  registry.refreshCatalog(packsDir);
  const discovered = readInstalledPackBuilds(packsDir);
  // Boot is where what is installed is settled, so it is where rows for packs that are gone are dropped
  forgetPacksExcept(new Set(discovered.map(entry => entry.id)));
  const disabled = disabledPackIds();
  const enabled = discovered.filter(entry => !disabled.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id));

  if (enabled.length === 0) return [];

  logger.info(`Loading ${enabled.length} pack(s)`);
  const loaded: LoadedPack[] = [];

  for (const entry of enabled) {
    if (!entry.build) {
      logger.warn(`Skipping ${entry.id}: ${entry.problem}`);
      registry.recordLoadProblem(entry.id, entry.problem);
      continue;
    }
    const problem = registry.catalog.getSnapshot().problems.find(problem => problem.id === entry.id);
    if (problem) {
      registry.recordLoadProblem(entry.id, problem.message);
      continue;
    }
    const { dir, build: { snapshot: { manifest } } } = entry;
    const pack = loadSingleExternalPack(registry, dir);
    if ('problem' in pack) registry.recordLoadProblem(manifest.id, pack.problem);
    else loaded.push(pack);
  }

  return loaded;
}

/**
 * Registers each loaded external pack in `registry`, its systems as `<packId>/<featureId>`; returns those registered.
 * A pack the registry refuses has why recorded there as its load problem.
 */
export function registerExternalPacks(registry: PackRegistry, packs: LoadedPack[]): LoadedPack[] {
  const registered: LoadedPack[] = [];
  for (const pack of packs) {
    try {
      registry.registerPack(pack.registration, pack.origin);
      registered.push(pack);
      logger.info(packRegistered(pack.origin.id, packSystemIds(pack.registration).length));
    } catch (err) {
      logger.error(`${packLoadFailed(pack.origin.id)}:`, err as Error);
      registry.recordLoadProblem(pack.origin.id, `its registration was refused: ${(err as Error).message}`);
    }
  }
  return registered;
}

/** Load and register every enabled installed pack; advertisements grant no registration priority. */
export function loadAppPacks(registry: PackRegistry): { loaded: LoadedPack[] } {
  const loaded = loadExternalPacks(registry);
  return { loaded: loaded.length > 0 ? registerExternalPacks(registry, loaded) : [] };
}
