import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { ArtifactCatalogEntry, ArtifactDeclaration, DeclarationData } from '@apackdev/sdk/framework';

/** Icon and viewer declarations remain readable without activating or importing their owner. */
export function artifactCatalogEntries(snapshot: PackCatalogSnapshot): readonly ArtifactCatalogEntry[] {
  const collect = (packId: string, entries: DeclarationData<Record<string, ArtifactDeclaration>> | undefined,
    origin: ArtifactCatalogEntry['origin'], identity: Pick<ArtifactCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    Object.entries(entries ?? {}).map(([type, declaration]) => Object.freeze({ type, packId, origin, declaration, ...identity }));
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.artifacts, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.extensions?.artifacts, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined ? { buildRevision: pack.buildRevision } : {}) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.extensions?.artifacts, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}
