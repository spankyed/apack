import { _packServiceSelection } from '@apackdev/pack-format';
import type { _PackServiceDeclarations, DeclarationData, NativePackDeclaration } from '@apackdev/sdk/framework';
import type { PackManifest } from '@apackdev/pack-format';
import type { PackCatalogSnapshot } from './catalog.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** Native composition and authored packs have distinct pack-level declaration locations. */
export type PackServiceOwner =
  | { readonly origin: 'native'; readonly declaration: DeclarationData<NativePackDeclaration> }
  | { readonly origin: 'installed' | 'source'; readonly declaration: DeclarationData<PackManifest> };

export interface PackServiceContract extends _PackServiceDeclarations {
  readonly origin: PackServiceOwner['origin'];
  readonly enabled?: boolean;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
}

export function packServiceDeclaration(owner: PackServiceOwner): _PackServiceDeclarations {
  const { id, version, features, consumes, dependencies } = owner.declaration;
  const services = owner.origin === 'native' ? owner.declaration.services : owner.declaration.extensions?.services;
  return { id, version, features, services, consumes, dependencies };
}

/** A projection of one committed catalog, never a second inventory or a runtime lookup. */
export function packServiceContracts(snapshot: PackCatalogSnapshot): readonly PackServiceContract[] {
  return [
    ...snapshot.native.map(declaration => ({ ...packServiceDeclaration({ origin: 'native', declaration }), origin: 'native' as const, enabled: true })),
    ...snapshot.packs.map(entry => ({ ...packServiceDeclaration({ origin: 'installed', declaration: entry.snapshot.manifest }),
      origin: 'installed' as const, enabled: entry.enabled,
      declarationRevision: entry.snapshot.declarationRevision, buildRevision: entry.buildRevision })),
    ...snapshot.sourcePacks.map(entry => ({ ...packServiceDeclaration({ origin: 'source', declaration: entry.manifest }),
      origin: 'source' as const, declarationRevision: entry.declarationRevision })),
  ];
}

/** Validate required declarations before importing a candidate and again before granting its bindings. */
export function assertPackServiceRequirements(snapshot: PackCatalogSnapshot, owner: PackServiceOwner) {
  // The candidate can repair an incumbent's declaration; cycles must see its prospective contract.
  const candidate: PackServiceContract = { ...packServiceDeclaration(owner), origin: owner.origin };
  const contracts = packServiceContracts(snapshot);
  const checked = new Set<PackServiceContract>();
  const check = (consumer: PackServiceContract): ReturnType<typeof _packServiceSelection> => {
    if (checked.has(consumer)) return [];
    checked.add(consumer);
    return _packServiceSelection(consumer, (id, ref) => {
      const refuse = (reason: string): never => {
        throw new Error(`Pack "${consumer.id}" consumes "${ref}", but provider "${id}" ${reason}`);
      };
      const problem = id === candidate.id ? undefined : snapshot.problems.find(entry => entry.id === id);
      if (problem) return refuse(`is unavailable: ${problem.message}`);
      const candidates = id === candidate.id ? [candidate] : contracts.filter(contract => contract.id === id);
      const runtime = candidates.filter(contract => contract.origin !== 'source');
      const eligible = runtime.length ? runtime : consumer.origin === 'source' ? candidates : [];
      if (eligible.length > 1) return refuse('has ambiguous service declarations');
      const provider = eligible[0];
      if (!provider && candidates.length) return refuse('has only authoring source declarations');
      if (provider?.enabled === false) return refuse('is disabled');
      if (provider) {
        try { check(provider); }
        catch (error) { return refuse(`cannot satisfy its requirements: ${errorMessage(error)}`); }
      }
      return provider;
    });
  };
  return check(candidate);
}
