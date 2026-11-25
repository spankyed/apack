import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { BlockCatalogEntry, BlockDeclaration, DeclarationData } from '@apackdev/sdk/framework';

/** Input kind and facet references are data; resolving them does not load a component or backend. */
export function blockCatalogEntries(snapshot: PackCatalogSnapshot): readonly BlockCatalogEntry[] {
  const collect = (packId: string, entries: DeclarationData<Record<string, BlockDeclaration>> | undefined,
    origin: BlockCatalogEntry['origin'], identity: Pick<BlockCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    Object.entries(entries ?? {}).map(([type, declaration]) => Object.freeze({ type, packId, origin, declaration, ...identity }));
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.blocks, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.extensions?.blocks, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined ? { buildRevision: pack.buildRevision } : {}) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.extensions?.blocks, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}
