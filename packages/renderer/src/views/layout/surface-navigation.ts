import { computed, onScopeDispose, shallowRef } from 'vue';
import { useState } from '@apackdev/sdk/fe';
import { surfaceNavigationItems } from '@apackdev/host/fe';
import { applicationState } from '@/main';
import { windowCatalog } from '@/runtime/catalog';
import { fePacks } from '@/runtime/packs';

/** Observe declarations and runtime icons independently, without keeping a second surface inventory. */
export function useSurfaceNavigation() {
  const revision = shallowRef(0);
  onScopeDispose(windowCatalog.subscribe(() => { revision.value++; }));
  const { state: shell } = useState(applicationState);
  const context = computed(() => ({ ...shell.value.data }));
  return computed(() => {
    void revision.value;
    return surfaceNavigationItems(windowCatalog, fePacks.surfaceBindings(), context.value.surfaceVisibility);
  });
}
