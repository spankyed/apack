import type { FeatureEventCatalogEntry, PackEventContracts } from '@apackdev/sdk/framework';
import { _parseEventContracts } from '@apackdev/sdk/framework';
import { resolveName } from '@apackdev/sdk/ids';
import type { PackCatalogSnapshot } from './catalog-types.ts';

/** Validate a window's incoming frame before replacing its accepted declaration data. */
export function assertEventContracts(snapshot: Pick<PackCatalogSnapshot, 'native' | 'packs' | 'sourcePacks'>): void {
  for (const pack of snapshot.native) _parseEventContracts(pack.eventContracts ?? {}, pack.features, true);
  for (const { snapshot: pack } of snapshot.packs) _parseEventContracts(pack.eventContracts ?? {}, pack.manifest.features);
  for (const pack of snapshot.sourcePacks) {
    if (pack.eventContracts !== undefined) _parseEventContracts(pack.eventContracts, pack.manifest.features);
  }
}

/** Static endpoint inventory; runtime validation maps describe bound endpoints separately. */
export function eventCatalogEntries(snapshot: Pick<PackCatalogSnapshot, 'native' | 'packs' | 'sourcePacks'>): readonly FeatureEventCatalogEntry[] {
  const collect = (packId: string, contracts: Readonly<PackEventContracts> | undefined,
    origin: FeatureEventCatalogEntry['origin'],
    identity: Pick<FeatureEventCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'>,
    features?: readonly string[]): FeatureEventCatalogEntry[] =>
    (features ?? Object.keys(contracts ?? {})).map(id => Object.freeze({
      featureRef: resolveName(id, packId), packId, origin, ...identity,
      ...(contracts?.[id] ? { status: 'compiled' as const, declaration: contracts[id] } : { status: 'unavailable' as const }),
    }));
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.eventContracts, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.eventContracts, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision, buildRevision: pack.buildRevision })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.eventContracts, 'source',
      { declarationRevision: pack.declarationRevision }, Object.entries(pack.manifest.features ?? {})
        .filter(([, feature]) => feature.system || feature.surface).map(([id]) => id))),
  ]);
}
