import { computed, onScopeDispose, shallowRef } from 'vue';
import { surfaceNavigationItems, useHostState } from '@apackdev/host/fe';
import { windowCatalog } from '@/runtime/catalog';
import { fePacks } from '@/runtime/packs';

/** Observe declarations and runtime icons independently, without keeping a second surface inventory. */
export function useSurfaceNavigation() {
  const revision = shallowRef(0);
  onScopeDispose(windowCatalog.subscribe(() => { revision.value++; }));
  const { state: shell } = useHostState('application');
  return computed(() => {
    void revision.value;
    return surfaceNavigationItems(windowCatalog, fePacks.surfaceBindings(), shell.value.data.surfaceVisibility);
  });
}
