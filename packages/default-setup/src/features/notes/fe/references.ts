import { computed } from 'vue'
import { useView } from '#generated/fe.ts'
import { NOTE_TYPE_TO_REFERENCE_TYPE } from '../reference-types.ts'
import type { ReferenceItem } from '@apackdev/sdk/fe/references'

/** Every note a reference can name, from the notes feature's tree view, kept current by the backend */
export const useItems = () => {
  const tree = useView('notes', 'tree')
  return computed((): ReferenceItem[] => (tree.data ?? [])
    .filter((n) => n.noteType in NOTE_TYPE_TO_REFERENCE_TYPE)
    .map((n) => ({
      id: n.id,
      shortCode: n.id,
      label: n.title || n.id,
      type: NOTE_TYPE_TO_REFERENCE_TYPE[n.noteType] as string,
    })))
}
