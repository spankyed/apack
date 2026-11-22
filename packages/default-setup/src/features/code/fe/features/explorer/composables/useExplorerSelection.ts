import { ref, computed, type Ref } from 'vue'

interface SelectionOptions {
  selectedPaths: Ref<readonly string[]>
  onSelect: (paths: string[]) => void
}

export function useExplorerSelection({ selectedPaths, onSelect }: SelectionOptions) {
  const shiftAnchorPath = ref<string | null>(null)

  const allSelected = computed(() => selectedPaths.value.length > 0)

  function selectItem(path: string, flattenedPaths: string[], event: MouseEvent) {
    if (event.shiftKey && shiftAnchorPath.value) {
      // Range select across the flattened visible tree
      const anchorIndex = flattenedPaths.indexOf(shiftAnchorPath.value)
      const clickedIndex = flattenedPaths.indexOf(path)

      if (anchorIndex !== -1 && clickedIndex !== -1) {
        const start = Math.min(anchorIndex, clickedIndex)
        const end = Math.max(anchorIndex, clickedIndex)
        const rangePaths = flattenedPaths.slice(start, end + 1)
        const newSelection = Array.from(new Set([...selectedPaths.value, ...rangePaths]))
        onSelect(newSelection)
      }
    } else if (event.metaKey || event.ctrlKey) {
      // Toggle item in selection
      const current = selectedPaths.value
      const newSelection = current.includes(path)
        ? current.filter(p => p !== path)
        : [...current, path]
      onSelect(newSelection)
      shiftAnchorPath.value = path
    } else {
      // Single click
      const current = selectedPaths.value
      if (current.includes(path)) {
        if (current.length === 1) {
          onSelect([])
          shiftAnchorPath.value = null
        } else {
          onSelect([path])
          shiftAnchorPath.value = path
        }
      } else {
        onSelect([path])
        shiftAnchorPath.value = path
      }
    }
  }

  function toggleSelectAll(allPaths: string[]) {
    if (selectedPaths.value.length === allPaths.length) {
      onSelect([])
    } else {
      onSelect(allPaths)
    }
  }

  function clearSelection() {
    onSelect([])
    shiftAnchorPath.value = null
  }

  return {
    shiftAnchorPath,
    allSelected,
    selectItem,
    toggleSelectAll,
    clearSelection
  }
}
