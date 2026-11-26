import { computed, getCurrentScope, onScopeDispose, shallowRef, type ComputedRef } from 'vue';
import { selectCatalogDeclaration, selectCatalogDeclarations } from '../framework/catalog-selection.ts';
import type { DslCatalogEntry } from '../framework/catalog-view.ts';
import { boundFeHost } from '../runtime/fe-host.ts';

/** Static editor metadata and built type text, including disabled or unbuilt providers. */
export function getDslDeclarations(): readonly DslCatalogEntry[] {
  return selectCatalogDeclarations(boundFeHost().catalog.dsl());
}

/** Ambiguous owners are unavailable; a unique installed/native owner precedes source previews. */
export function getDslDeclaration(type: string): DslCatalogEntry | undefined {
  return selectCatalogDeclaration(type, boundFeHost().catalog.dsl());
}

/** Observe type-data changes independently of frontend activation. */
export function onDslDeclarationsChanged(listener: () => void): () => void {
  return boundFeHost().catalog.subscribe(listener);
}

export function useDslDeclarations(): ComputedRef<readonly DslCatalogEntry[]> {
  if (!getCurrentScope()) throw new Error('useDslDeclarations requires an active Vue effect scope');
  const revision = shallowRef(0);
  onScopeDispose(onDslDeclarationsChanged(() => { revision.value++; }));
  return computed(() => { void revision.value; return getDslDeclarations(); });
}
