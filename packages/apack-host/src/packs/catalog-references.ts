import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { ReferenceCatalogEntry, DeclarationData, ReferenceDeclarations } from '@apackdev/sdk/framework';
import { resolveName } from '@apackdev/sdk/ids';

/** The same immutable reference projection for backend and window catalog readers. */
export function referenceCatalogEntries(snapshot: PackCatalogSnapshot): readonly ReferenceCatalogEntry[] {
  const collect = (packId: string, features: Record<string, { references?: DeclarationData<ReferenceDeclarations> }> | undefined,
    origin: ReferenceCatalogEntry['origin'], identity: Pick<ReferenceCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    Object.entries(features ?? {}).flatMap(([id, feature]) => feature.references
      ? [Object.freeze({ featureRef: resolveName(id, packId), packId, origin, declaration: feature.references, ...identity })] : []);
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.features, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.features, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined ? { buildRevision: pack.buildRevision } : {}) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.features, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}

/**
 * Reference type and category names are global: two enabled owners of one name are both refused, as entity
 * destinations are, so no owner is chosen by load order and the reader is never left with an ambiguous name.
 */
export function referenceNameConflicts(snapshot: PackCatalogSnapshot): Map<string, string> {
  const owners = new Map<string, ReferenceCatalogEntry[]>();
  for (const entry of referenceCatalogEntries(snapshot)) {
    if (entry.origin === 'source' || entry.enabled !== true) continue;
    for (const group of ['types', 'categories'] as const) {
      for (const name of Object.keys(entry.declaration[group] ?? {})) {
        const key = `${group}\u0000${name}`;
        owners.set(key, [...owners.get(key) ?? [], entry]);
      }
    }
  }
  const conflicts = new Map<string, string>();
  for (const [key, claims] of owners) {
    if (claims.length < 2) continue;
    const [group, name] = key.split('\u0000');
    const message = `Reference ${group === 'types' ? 'type' : 'category'} "${name}" claimed by both ${claims.map(owner => `"${owner.featureRef}"`).join(' and ')}`;
    for (const owner of claims) if (!conflicts.has(owner.packId)) conflicts.set(owner.packId, message);
  }
  return conflicts;
}
