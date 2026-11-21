import { computed } from 'vue';
import { useState } from '@apackdev/sdk/fe';

/**
 * Creates a writable computed property for managing collapsible section state
 * @param actor - The XState actor to send events to
 * @param path - Path to the state value in the context (e.g., ['create', 'tagsExpanded'])
 * @param eventType - The event type to send when toggling (e.g., 'TOGGLE_TAGS_SECTION')
 * @returns A computed property that can be used with v-model
 */
export function useCollapsibleState(actor: any, path: string[], eventType: string) {
  const { state: machine, send } = useState(actor);

  // Return a computed property that can be used with v-model
  return computed({
    get: () => {
      // Navigate through the path to get the value
      let value: any = machine.value?.data;
      for (const key of path) {
        value = value?.[key];
      }
      return Boolean(value);
    },
    set: (value: boolean) => send({ type: eventType, show: value } as any)
  });
}