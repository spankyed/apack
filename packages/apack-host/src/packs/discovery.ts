import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@apackdev/sdk/logger';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { interruptedReplacementProblem } from './staging.ts';
import { packRecord, packRecords, type PackRecord } from './installed.ts';
import { errorMessage, hasOwn } from '@apackdev/sdk/utils/pure';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { PACK_LAYOUT, readPackBuild, type PackBuild } from './layout.ts';
import type { PackManifest } from '@apackdev/pack-format';

const logger = createLogger('pack-discovery');

export type { PackManifest };

// ── Pack discovery ─────────────────────────────────────────

/** Visible installed directories; hidden directories are unpublished install candidates. */
export function discoverPackDirectories(packsDir: string): string[] {
  if (!fs.existsSync(packsDir)) return [];
  return fs.readdirSync(packsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => path.join(packsDir, entry.name));
}

/** Directory presence is installation evidence even when its build cannot be admitted. */
export type InstalledPackBuild = { id: string; dir: string } & (
  | { build: PackBuild; problem?: never }
  | { build?: never; problem: string }
);

/** Read a managed installed directory; producer/staging directories use readPackBuild directly. */
export function readInstalledPackBuild(dir: string): PackBuild {
  const id = path.basename(dir);
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`Invalid installed pack directory "${id}"`);
  const interrupted = interruptedReplacementProblem(dir);
  if (interrupted) throw new Error(interrupted);
  const build = readPackBuild(dir);
  if (build.snapshot.manifest.id !== id) {
    throw new Error(`Installed directory "${id}" contains pack "${build.snapshot.manifest.id}"`);
  }
  if (!hasOwn(build.integrity.files, PACK_LAYOUT.runtimeEntry)) {
    throw new Error(`Installed pack "${id}" has no ${PACK_LAYOUT.runtimeEntry} asset in its receipt`);
  }
  return build;
}

/** One data-only admission path for installed inventory, with a refusal for every invalid directory. */
export function readInstalledPackBuilds(packsDir: string): InstalledPackBuild[] {
  return discoverPackDirectories(packsDir).map(dir => {
    const id = path.basename(dir);
    try { return { id, dir, build: readInstalledPackBuild(dir) }; }
    catch (error) { return { id, dir, problem: errorMessage(error) }; }
  });
}

export function discoverPacks(packsDir: string): DiscoveredPack[] {
  return readInstalledPackBuilds(packsDir).flatMap(entry => {
    if (!entry.build) {
      logger.warn(`Skipping ${entry.id}: ${entry.problem}`);
      return [];
    }
    return [{ manifest: entry.build.snapshot.manifest, dir: entry.dir }];
  });
}

/** A pack found in a packs directory, with the manifest read from it */
export interface DiscoveredPack {
  manifest: PackManifest;
  dir: string;
}

/** A pack the app has: what its directory says, with what the app has recorded about it. */
export interface InstalledPack extends DiscoveredPack {
  record: PackRecord;
}

/**
 * Every pack in the packs directory, enabled or not, with what the app has recorded about it.
 *
 * The admitted builds an install, update or toggle can act on; the catalog also lists refusals. A pack with no row is here
 * like any other: the directory is what makes it installed.
 */
export function installedPacks(packsDir = resolveAppEnvironment().packsDir): InstalledPack[] {
  const records = packRecords();
  return discoverPacks(packsDir).map(pack => ({ ...pack, record: packRecord(pack.manifest.id, records) }));
}

/** A pack and what it declares it depends on (`apack.json` `dependencies`), as the apply order reads it */
export interface PackDependents {
  id: string;
  dependencies?: Record<string, string>;
}

/**
 * `packs`, ordered so each one follows the packs in the list it depends on.
 *
 * Only edges between the packs given, so a dependency on a pack that is not in the list is not an edge:
 * either the caller is not acting on it, or it is not installed, which is reported when the pack that
 * declares it is installed. Callers that want every edge honoured pass every pack — `packContentTargets`
 * does, which is how a pack depending on one the app ships applies after it.
 *
 * A cycle has no order that satisfies it, and a pack-authoring mistake must not stop an app booting, so
 * the packs in one are still returned, in an order that is arbitrary but deterministic, and the cycle is
 * logged. Stable otherwise: packs with nothing between them come back as they went in.
 */
export function packContentOrder<T extends PackDependents>(packs: readonly T[]): T[] {
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const state = new Map<string, 'visiting' | 'done'>();
  const ordered: T[] = [];
  const cycles: string[] = [];

  function visit(pack: T, trail: readonly string[]): void {
    const seen = state.get(pack.id);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      cycles.push([...trail.slice(trail.indexOf(pack.id)), pack.id].join(' -> '));
      return;
    }
    state.set(pack.id, 'visiting');
    for (const depId of Object.keys(pack.dependencies ?? {})) {
      const dep = byId.get(depId);
      if (dep) visit(dep, [...trail, pack.id]);
    }
    state.set(pack.id, 'done');
    ordered.push(pack);
  }

  for (const pack of packs) visit(pack, []);
  if (cycles.length > 0) {
    logger.warn(`Packs depend on each other, so no order satisfies them all; applying them anyway: ${cycles.join(', ')}`);
  }
  return ordered;
}
