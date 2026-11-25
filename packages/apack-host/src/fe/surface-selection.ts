import { isEqual } from '../features/settings/document.ts';
import type { SurfaceCatalogEntry } from '../packs/catalog-types.ts';
import type { SurfaceFrontendBinding } from './pack-store.ts';

export interface ShellSurfaceCatalog {
  status(): 'loading' | 'ready' | 'disconnected' | 'error' | 'disposed';
  surfaces(): readonly SurfaceCatalogEntry[];
  subscribe(listener: () => void): () => void;
}

/** Installed/native ownership takes precedence over authoring-source previews. */
export function selectSurfaceDeclaration(catalog: ShellSurfaceCatalog, ref: string): SurfaceCatalogEntry | undefined {
  const owners = catalog.surfaces().filter(entry => entry.featureRef === ref);
  const runtime = owners.filter(entry => entry.origin !== 'source');
  const candidates = runtime.length ? runtime : owners;
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The default is selected before frontend loading; delivery order cannot change its owner. */
export function selectDefaultSurfaceDeclaration(catalog: ShellSurfaceCatalog): SurfaceCatalogEntry | undefined {
  return catalog.surfaces().filter(entry => entry.enabled === true && entry.origin !== 'source' && entry.declaration.default
    && selectSurfaceDeclaration(catalog, entry.featureRef)?.packId === entry.packId)
    .sort((a, b) => (a.origin === 'native' ? 0 : 1) - (b.origin === 'native' ? 0 : 1)
      || a.featureRef.localeCompare(b.featureRef, 'en'))[0];
}

/** A declaration does not authorize stale components or actors to receive new work. */
export function getEligibleSurface(catalog: ShellSurfaceCatalog, bindings: ReadonlyMap<string, SurfaceFrontendBinding>, ref: string) {
  const owner = selectSurfaceDeclaration(catalog, ref); const accepted = bindings.get(ref);
  if (!owner || owner.enabled !== true || owner.origin === 'source' || !accepted
    || (owner.origin !== 'native' && catalog.status() !== 'ready')
    || accepted.packId !== owner.packId || accepted.binding.id !== ref
    || !isEqual(owner.declaration, accepted.declaration)) return undefined;
  if (owner.origin === 'native') return isEqual(owner.opens ?? [], accepted.opens ?? []) && accepted.declarationRevision === undefined && accepted.buildRevision === undefined
    && accepted.registrationId === undefined ? accepted.binding : undefined;
  return owner.declarationRevision && owner.buildRevision && accepted.registrationId
    && owner.declarationRevision === accepted.declarationRevision && owner.buildRevision === accepted.buildRevision
    ? accepted.binding : undefined;
}


export type EntityDestinationSelection =
  | { status: 'declared'; destination: SurfaceCatalogEntry }
  | { status: 'disabled' | 'ambiguous'; destinations: readonly SurfaceCatalogEntry[] }
  | { status: 'loading' | 'unavailable' | 'unclaimed' };

/** Resolve declarations first; actor readiness and accepted binding identity remain separate. */
export function selectEntityDestination(catalog: ShellSurfaceCatalog, entity: string): EntityDestinationSelection {
  const claims = catalog.surfaces().filter(entry => entry.origin !== 'source' && entry.opens?.includes(entity));
  const enabled = claims.filter(entry => entry.enabled === true);
  if (enabled.length > 1) return { status: 'ambiguous', destinations: enabled };
  const destination = enabled[0];
  // A native destination is available before backend connection only if no installed declarations
  // can still arrive and conflict. Wait for complete authority before choosing an entity destination.
  if (catalog.status() === 'loading') return { status: 'loading' };
  if (catalog.status() !== 'ready') return { status: 'unavailable' };
  if (destination) return { status: 'declared', destination };
  return claims.length ? { status: 'disabled', destinations: claims } : { status: 'unclaimed' };
}
