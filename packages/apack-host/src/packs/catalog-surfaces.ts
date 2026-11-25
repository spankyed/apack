import { SDK_ENTITIES } from '@apackdev/sdk/types';
import { _entityDestinationsProblem, _packEntityTypes } from '@apackdev/sdk/framework';
import { resolveName } from '@apackdev/sdk/ids';
import type { PackCatalogSnapshot, SurfaceCatalogEntry } from './catalog-types.ts';
import { referenceNameConflicts } from './catalog-references.ts';
import type { DeclarationData, SurfaceDeclaration, NativePackDeclaration } from '@apackdev/sdk/framework';

const collect = (packId: string, features: Record<string, { surface?: DeclarationData<SurfaceDeclaration> }> | undefined,
    origin: SurfaceCatalogEntry['origin'], identity: Pick<SurfaceCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {},
    destinations?: Readonly<Record<string, string>>) =>
    Object.entries(features ?? {}).flatMap(([id, feature]) => feature.surface
      ? [Object.freeze({ featureRef: resolveName(id, packId), packId, origin, declaration: feature.surface, ...identity,
        ...(destinations !== undefined && { opens: Object.freeze(Object.keys(destinations).filter(entity => destinations[entity] === id).sort()) }) })] : []);

/** Local native declarations exist before any backend connection. */
export function nativeSurfaceCatalogEntries(declarations: readonly DeclarationData<NativePackDeclaration>[]): readonly SurfaceCatalogEntry[] {
  const entries = declarations.flatMap(pack => collect(pack.id, pack.features, 'native', { enabled: true }, pack.entityDestinations ?? {}));
  assertSurfaceDestinationClaims(entries);
  return Object.freeze(entries);
}

/** Surface metadata is independent of frontend delivery and actor readiness. */
export function surfaceCatalogEntries(snapshot: PackCatalogSnapshot): readonly SurfaceCatalogEntry[] {
  return Object.freeze([
    ...nativeSurfaceCatalogEntries(snapshot.native),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.features, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined && { buildRevision: pack.buildRevision }) }, pack.snapshot.entityDestinations)),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.features, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}


/** Refuse the whole candidate before publication; disabled claims remain discoverable. */
export function assertCatalogClaims(snapshot: PackCatalogSnapshot): void {
  const entities = new Set([...Object.values(SDK_ENTITIES),
    ...snapshot.packs.flatMap(pack => Object.keys(pack.snapshot.types.entities)),
    ...snapshot.native.flatMap(pack => Object.keys(_packEntityTypes(pack)))]);
  for (const { snapshot: pack } of snapshot.packs) {
    const problem = _entityDestinationsProblem(pack.entityDestinations, pack.manifest.features,
      new Set([...Object.values(SDK_ENTITIES), ...Object.keys(pack.types.entities)]));
    if (problem) throw new Error(`Pack "${pack.manifest.id}": ${problem}`);
  }
  for (const pack of snapshot.native) {
    const problem = _entityDestinationsProblem(pack.entityDestinations ?? {}, pack.features, entities);
    if (problem) throw new Error(`Pack "${pack.id}": ${problem}`);
  }
  assertSurfaceDestinationClaims(surfaceCatalogEntries(snapshot));
  const reference = referenceNameConflicts(snapshot).values().next().value;
  if (reference) throw new Error(reference);
}

/**
 * Every pack whose global claims compete with another's, with the reason: entity destinations and reference
 * names. All competing owners are refused; discovery never chooses a winner by directory order.
 */
export function catalogClaimConflicts(snapshot: PackCatalogSnapshot): ReadonlyMap<string, string> {
  return new Map([...referenceNameConflicts(snapshot), ...surfaceDestinationConflicts(surfaceCatalogEntries(snapshot))]);
}

function surfaceDestinationConflicts(entries: readonly SurfaceCatalogEntry[]): Map<string, string> {
  const owners = new Map<string, SurfaceCatalogEntry[]>();
  for (const surface of entries) {
    if (surface.origin === 'source' || surface.enabled !== true) continue;
    for (const entity of surface.opens ?? []) {
      const claims = owners.get(entity) ?? [];
      claims.push(surface);
      owners.set(entity, claims);
    }
  }
  const conflicts = new Map<string, string>();
  for (const [entity, claims] of owners) {
    if (claims.length < 2) continue;
    const message = `Entity destination "${entity}" claimed by both ${claims.map(owner => `"${owner.featureRef}"`).join(' and ')}`;
    for (const owner of claims) conflicts.set(owner.packId, message);
  }
  return conflicts;
}

function assertSurfaceDestinationClaims(entries: readonly SurfaceCatalogEntry[]): void {
  const problem = surfaceDestinationConflicts(entries).values().next().value;
  if (problem) throw new Error(problem);
}
