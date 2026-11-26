import { computed } from 'vue';
import { openHelp } from '@apackdev/sdk/fe';
import { splitRef } from '@apackdev/sdk/ids';
import { useHostState } from '@apackdev/host/fe';

/** Read the same live catalog as Help; contextual links disappear when their pack unloads. */
export function useContextualHelp() {
  const { state: settings } = useHostState('settings');
  const features = computed(() =>
    new Set((settings.value.data.help.catalog.articles ?? []).flatMap(a => (a.features ?? []).map(f => `${a.packId}/${f}`))),
  );
  return {
    hasHelp: (ref: string) => features.value.has(ref),
    openFeatureHelp: (ref: string) => { const target = splitRef(ref); if (target) openHelp(target); },
  };
}
