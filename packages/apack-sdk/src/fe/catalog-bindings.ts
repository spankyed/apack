import { computed, getCurrentScope, onScopeDispose, shallowRef, type ComputedRef } from 'vue';
import { boundFeHost } from '../runtime/fe-host.ts';
import { declarationJson } from '../framework/declaration-data.ts';
import type { ArtifactCatalogEntry, BlockCatalogEntry, StepCatalogEntry } from '../framework/catalog-view.ts';
import type { StepFrontendBinding } from './step-bindings.ts';
import type { ArtifactFrontendBinding, BlockFrontendBinding } from './viewer-bindings.ts';

/** An executable frontend must belong to the currently enabled declaration and accepted build. */
export function matchesFrontendDeclaration(
  owner: ArtifactCatalogEntry | BlockCatalogEntry | StepCatalogEntry | undefined,
  accepted: ArtifactFrontendBinding | BlockFrontendBinding | StepFrontendBinding | undefined,
): boolean {
  if (!owner || owner.enabled !== true || owner.origin === 'source' || !accepted
    || accepted.packId !== owner.packId || accepted.binding.type !== owner.type
    || declarationJson(owner.declaration) !== declarationJson(accepted.declaration)) return false;
  if (owner.origin === 'native') {
    return accepted.declarationRevision === undefined && accepted.buildRevision === undefined
      && accepted.registrationId === undefined;
  }
  return !!(owner.declarationRevision && owner.buildRevision && accepted.registrationId
    && owner.declarationRevision === accepted.declarationRevision && owner.buildRevision === accepted.buildRevision);
}

/** Declarations and their executable bindings publish independently. */
export function onFrontendCatalogChanged(listener: () => void): () => void {
  const host = boundFeHost();
  const stopCatalog = host.catalog.subscribe(listener);
  try {
    const stopBindings = host.packs.onChanged(listener);
    return () => { stopCatalog(); stopBindings(); };
  } catch (error) {
    stopCatalog();
    throw error;
  }
}

export function useFrontendDeclarations<T>(name: string, read: () => T): ComputedRef<T> {
  if (!getCurrentScope()) throw new Error(`${name} requires an active Vue effect scope`);
  const revision = shallowRef(0);
  onScopeDispose(onFrontendCatalogChanged(() => { revision.value++; }));
  return computed(() => { void revision.value; return read(); });
}
