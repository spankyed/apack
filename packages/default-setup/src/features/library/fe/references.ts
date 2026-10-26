import { computed } from 'vue'
import { useView } from '#generated/fe.ts'
import type { ReferenceItem } from '@apackdev/sdk/fe/references'

/** Every document and folder a reference can name, from the library's index view, kept current by the backend */
export const useItems = () => {
  const view = useView('library', 'index')
  return computed((): ReferenceItem[] => {
    const index = view.data ?? { documents: [], folders: [] }

    const docItems: ReferenceItem[] = index.documents.map((d: any) => ({
      id: d.id,
      shortCode: d.shortCode || d.id,
      label: d.name || d.shortCode || d.id,
      type: 'document' as const,
    }))

    const folderItems: ReferenceItem[] = index.folders.map((f: any) => ({
      id: f.id,
      shortCode: f.id,
      label: f.name || f.id,
      type: 'folder' as const,
    }))

    return [...folderItems, ...docItems]
  })
}
