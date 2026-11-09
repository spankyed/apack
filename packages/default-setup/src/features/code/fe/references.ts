import { computed, type Ref } from 'vue'
import { useView } from '#generated/fe.ts'
import type { ReferenceItem } from '@apackdev/sdk/fe/references'

const LIMIT = 25

/**
 * The symbols what the user has typed names, searched by the backend across every indexed checkout: a checkout holds
 * thousands, so nothing is asked for until there is something to search for
 */
export const useItems = (query: Readonly<Ref<string>>) => {
  const view = useView('code', 'symbols', () => query.value ? { text: query.value, limit: LIMIT } : null)
  return computed((): ReferenceItem[] => (view.data ?? []).map(symbol => ({
    id: symbol.id,
    shortCode: symbol.kind,
    label: symbol.name,
    type: 'symbol' as const,
  })))
}
