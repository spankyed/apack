import { ref, computed } from 'vue'
import type { ThreadListItem } from '#features/threads/fe/state.ts'

export function useThreadSelection(
  items: () => ThreadListItem[],
  selectedItems: () => readonly string[],
  emit: (itemIds: string[]) => void
) {
  const shiftAnchorId = ref<string | null>(null)

  const allItemsSelected = computed(() => {
    const itemsList = items()
    return itemsList.length > 0 && itemsList.every(item => selectedItems().includes(item.id))
  })

  function selectItem(item: ThreadListItem, sortedItems: ThreadListItem[], event: MouseEvent) {
    if (event.shiftKey && shiftAnchorId.value) {
      // Range select: extend from anchor to clicked item
      const anchorIndex = sortedItems.findIndex(i => i.id === shiftAnchorId.value)
      const clickedIndex = sortedItems.findIndex(i => i.id === item.id)

      if (anchorIndex !== -1 && clickedIndex !== -1) {
        const start = Math.min(anchorIndex, clickedIndex)
        const end = Math.max(anchorIndex, clickedIndex)
        const rangeIds = sortedItems.slice(start, end + 1).map(i => i.id)
        const newSelection = Array.from(new Set([...selectedItems(), ...rangeIds]))
        emit(newSelection)
      }
    } else if (event.metaKey || event.ctrlKey) {
      // Toggle individual item
      const current = selectedItems()
      const newSelection = current.includes(item.id)
        ? current.filter(id => id !== item.id)
        : [...current, item.id]
      emit(newSelection)
      shiftAnchorId.value = item.id
    }
    // Plain click is handled by the row component directly (navigates, no selection)
  }

  function toggleSelectAll() {
    if (allItemsSelected.value) {
      emit([])
    } else {
      emit(items().map(item => item.id))
    }
  }

  function clearSelection() {
    emit([])
    shiftAnchorId.value = null
  }

  return {
    allItemsSelected,
    selectItem,
    toggleSelectAll,
    clearSelection
  }
}
