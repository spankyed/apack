import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { StepCatalogEntry, StepEntry, DeclarationData } from '@apackdev/sdk/framework';

/** Declared steps across all origins, without reading source files or executable bindings. */
export function stepCatalogEntries(snapshot: PackCatalogSnapshot): readonly StepCatalogEntry[] {
  const collect = (packId: string, steps: DeclarationData<Record<string, StepEntry>> | undefined,
    origin: StepCatalogEntry['origin'], identity: Pick<StepCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    Object.entries(steps ?? {}).map(([type, declaration]) => Object.freeze({ type, packId, origin, declaration, ...identity }));
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.steps, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.extensions?.steps, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined ? { buildRevision: pack.buildRevision } : {}) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.extensions?.steps, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}
