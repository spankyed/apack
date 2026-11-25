import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { FrontendCatalogEntry, DeclarationData, FrontendDeclaration } from '@apackdev/sdk/framework';

/** Frontend identities are shared data even when no implementation is eligible or loaded. */
export function frontendCatalogEntries(snapshot: PackCatalogSnapshot): readonly FrontendCatalogEntry[] {
  const collect = (packId: string, declaration: DeclarationData<FrontendDeclaration> | undefined,
    origin: FrontendCatalogEntry['origin'], identity: Pick<FrontendCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    declaration?.textEditor || declaration?.appExtensions
      ? [Object.freeze({ packId, origin, declaration: Object.freeze({
        ...(declaration.textEditor ? { textEditor: declaration.textEditor } : {}),
        ...(declaration.appExtensions ? { appExtensions: declaration.appExtensions } : {}),
      }), ...identity })] : [];
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.extensions, 'installed',
      { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined ? { buildRevision: pack.buildRevision } : {}) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.extensions, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}
