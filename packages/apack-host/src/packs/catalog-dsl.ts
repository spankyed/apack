import type { PackCatalogSnapshot } from './catalog-types.ts';
import type { DeclarationData, DslCatalogEntry, DslDeclaration } from '@apackdev/sdk/framework';

/** Built type text and authoring metadata are data; discovery never imports DSL or runtime modules. */
export function dslCatalogEntries(snapshot: PackCatalogSnapshot): readonly DslCatalogEntry[] {
  const collect = (packId: string, declarations: Readonly<Record<string, DeclarationData<DslDeclaration>>> | undefined,
    definitions: Readonly<Record<string, string>> | undefined, origin: DslCatalogEntry['origin'],
    identity: Pick<DslCatalogEntry, 'enabled' | 'declarationRevision' | 'buildRevision'> = {}) =>
    Object.entries(declarations ?? {}).map(([type, declaration]) => Object.freeze({ type, packId, origin, declaration,
      ...(definitions && Object.hasOwn(definitions, type) && { definitions: definitions[type] }), ...identity }));
  return Object.freeze([
    ...snapshot.native.flatMap(pack => collect(pack.id, pack.dsl, pack.dslDefinitions, 'native', { enabled: true })),
    ...snapshot.packs.flatMap(pack => collect(pack.snapshot.manifest.id, pack.snapshot.manifest.extensions?.dsl,
      pack.snapshot.dslDefinitions, 'installed', { enabled: pack.enabled, declarationRevision: pack.snapshot.declarationRevision,
        ...(pack.buildRevision !== undefined && { buildRevision: pack.buildRevision }) })),
    ...snapshot.sourcePacks.flatMap(pack => collect(pack.manifest.id, pack.manifest.extensions?.dsl, undefined, 'source',
      { declarationRevision: pack.declarationRevision })),
  ]);
}
