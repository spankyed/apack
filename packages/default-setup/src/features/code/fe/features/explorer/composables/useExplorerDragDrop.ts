import { ref, type Ref } from 'vue'

interface DragDropOptions {
  selectedPaths: Ref<readonly string[]>
  onMove: (sourcePaths: string[], targetDir: string) => void
  onCopyFiles?: (sourcePaths: string[], targetDir: string) => void
}

export function useExplorerDragDrop({ selectedPaths, onMove, onCopyFiles }: DragDropOptions) {
  const draggedPaths = ref<string[]>([])
  const draggedOverPath = ref<string | null>(null)
  const dropPosition = ref<'before' | 'after' | 'inside' | null>(null)
  const isDragging = ref(false)
  const isExternalFileDrag = ref(false)

  /** Remove paths whose parent/ancestor is also in the list */
  function deduplicateNestedPaths(paths: string[]): string[] {
    const sorted = paths.sort()
    const result: string[] = []
    for (const p of sorted) {
      if (!result.length || !p.startsWith(result[result.length - 1] + '/')) {
        result.push(p)
      }
    }
    return result
  }

  function getDraggedPaths(draggedPath: string): string[] {
    // If the dragged item is in the selection, drag all selected items
    if (selectedPaths.value.includes(draggedPath)) {
      return deduplicateNestedPaths([...selectedPaths.value])
    }
    return [draggedPath]
  }

  function isValidDrop(sourcePaths: string[], targetPath: string): boolean {
    if (!sourcePaths.length) return false

    // Can't drop on itself
    if (sourcePaths.includes(targetPath)) return false

    // Can't drop a folder into itself or its descendants
    const normalizedTarget = targetPath + '/'
    for (const sourcePath of sourcePaths) {
      const normalizedSource = sourcePath + '/'
      if (normalizedTarget.startsWith(normalizedSource)) {
        return false
      }
    }

    return true
  }

  function isExternalFileEvent(dt: DataTransfer | null): boolean {
    if (!dt || !dt.types.includes('Files')) return false
    // If we initiated an internal drag, ignore Files type
    if (draggedPaths.value.length > 0) return false
    return true
  }

  function handleDragStart(e: DragEvent, path: string) {
    if (!e.dataTransfer) return

    const items = getDraggedPaths(path)
    draggedPaths.value = items
    isDragging.value = true

    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify(items))

    // Create custom drag image for multiple items
    if (items.length > 1) {
      const dragImage = document.createElement('div')
      dragImage.textContent = `${items.length} items`
      dragImage.style.position = 'absolute'
      dragImage.style.top = '-1000px'
      dragImage.style.padding = '4px 8px'
      dragImage.style.background = 'rgba(59, 130, 246, 0.9)'
      dragImage.style.color = 'white'
      dragImage.style.borderRadius = '4px'
      dragImage.style.fontSize = '12px'
      document.body.appendChild(dragImage)
      e.dataTransfer.setDragImage(dragImage, 0, 0)
      setTimeout(() => document.body.removeChild(dragImage), 0)
    }
  }

  function handleDragOver(e: DragEvent, path: string, isDirectory: boolean) {
    e.preventDefault()
    if (!e.dataTransfer) return

    const externalFile = isExternalFileEvent(e.dataTransfer)

    if (externalFile) {
      isExternalFileDrag.value = true
      isDragging.value = true
      // External files can only drop into directories
      const newPosition: 'before' | 'after' | 'inside' = isDirectory ? 'inside' : 'before'
      e.dataTransfer.dropEffect = isDirectory ? 'copy' : 'none'
      if (isDirectory) {
        dropPosition.value = newPosition
        draggedOverPath.value = path
      } else {
        dropPosition.value = null
        draggedOverPath.value = null
      }
      return
    }

    if (!isValidDrop(draggedPaths.value, path)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }

    e.dataTransfer.dropEffect = 'move'

    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height

    let newPosition: 'before' | 'after' | 'inside'

    if (isDirectory) {
      // For directories: 25/50/25 vertical split
      if (y < height * 0.25) {
        newPosition = 'before'
      } else if (y > height * 0.75) {
        newPosition = 'after'
      } else {
        newPosition = 'inside'
      }
    } else {
      // For files: only before/after (no reorder in filesystem, but useful visual feedback)
      newPosition = y < height / 2 ? 'before' : 'after'
    }

    if (dropPosition.value !== newPosition || draggedOverPath.value !== path) {
      dropPosition.value = newPosition
      draggedOverPath.value = path
    }
  }

  function handleDragLeave(e: DragEvent) {
    const related = e.relatedTarget as HTMLElement
    if (!related || !related.closest('[data-explorer-item]')) {
      draggedOverPath.value = null
      dropPosition.value = null
      if (isExternalFileDrag.value) {
        isExternalFileDrag.value = false
        isDragging.value = false
      }
    }
  }

  function getExternalFilePaths(e: DragEvent): string[] {
    const files = e.dataTransfer?.files
    if (!files) return []

    const getPath = window.electronAPI?.fileUtils?.getPathForFile
    if (!getPath) return []

    const paths: string[] = []
    for (const file of files) {
      const filePath: string = getPath(file)
      if (filePath) paths.push(filePath)
    }
    return paths
  }

  function handleDrop(e: DragEvent, targetPath: string, isDirectory: boolean) {
    e.preventDefault()
    e.stopPropagation()

    // Handle external file drops
    if (isExternalFileDrag.value) {
      if (isDirectory && onCopyFiles) {
        const paths = getExternalFilePaths(e)
        if (paths.length > 0) {
          onCopyFiles(paths, targetPath)
        }
      }
      handleDragEnd()
      return
    }

    if (!draggedPaths.value.length) return

    if (isDirectory && dropPosition.value === 'inside') {
      if (isValidDrop(draggedPaths.value, targetPath)) {
        onMove(draggedPaths.value, targetPath)
      }
    }
    // For 'before'/'after' on files, we don't move (filesystem is alphabetically sorted)

    handleDragEnd()
  }

  function handleDropOnEmptySpace(e: DragEvent, baseDirectory: string) {
    e.preventDefault()
    e.stopPropagation()

    // Handle external file drops
    if (isExternalFileDrag.value) {
      if (onCopyFiles) {
        const paths = getExternalFilePaths(e)
        if (paths.length > 0) {
          onCopyFiles(paths, baseDirectory)
        }
      }
      handleDragEnd()
      return
    }

    if (!draggedPaths.value.length) return

    // Move to base directory
    if (isValidDrop(draggedPaths.value, baseDirectory)) {
      onMove(draggedPaths.value, baseDirectory)
    }

    handleDragEnd()
  }

  function handleDragEnd() {
    draggedPaths.value = []
    draggedOverPath.value = null
    dropPosition.value = null
    isDragging.value = false
    isExternalFileDrag.value = false
  }

  function getItemDragClass(path: string): string {
    const classes: string[] = []

    if (isDragging.value && draggedPaths.value.includes(path)) {
      classes.push('opacity-50')
    }

    if (draggedOverPath.value === path && dropPosition.value === 'inside') {
      if (isExternalFileDrag.value || isValidDrop(draggedPaths.value, path)) {
        classes.push('!bg-blue-500/20 ring-2 ring-blue-500')
      }
    }

    return classes.join(' ')
  }

  function getDropIndicatorStyle(path: string) {
    if (draggedOverPath.value !== path || !dropPosition.value || dropPosition.value === 'inside') {
      return { display: 'none' }
    }

    return {
      display: 'block',
      position: 'absolute' as const,
      left: '0',
      right: '0',
      height: '2px',
      backgroundColor: 'rgb(59, 130, 246)',
      ...(dropPosition.value === 'before' ? { top: '0' } : { bottom: '0' })
    }
  }

  return {
    isDragging,
    isExternalFileDrag,
    draggedPaths,
    draggedOverPath,
    dropPosition,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDropOnEmptySpace,
    handleDragEnd,
    getItemDragClass,
    getDropIndicatorStyle
  }
}
