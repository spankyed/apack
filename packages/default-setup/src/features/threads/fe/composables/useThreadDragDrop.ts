import { ref, type Ref } from 'vue'

interface ThreadDragDropOptions {
  selectedItems: Ref<readonly string[]>
  onReparent: (childIds: string[], parentId: string) => void
}

export function useThreadDragDrop({
  selectedItems,
  onReparent
}: ThreadDragDropOptions) {
  const draggedItems = ref<string[]>([])
  const draggedOverId = ref<string | null>(null)
  const isDragging = ref(false)

  /** Resolve which items are being dragged: selected set or just the one */
  const getDraggedItems = (threadId: string): string[] => {
    if (selectedItems.value.includes(threadId)) {
      return [...selectedItems.value]
    }
    return [threadId]
  }

  const handleDragStart = (e: DragEvent, threadId: string) => {
    if (!e.dataTransfer) return

    const items = getDraggedItems(threadId)
    draggedItems.value = items
    isDragging.value = true

    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify(items))

    // Custom drag image for multi-item drag
    if (items.length > 1) {
      const dragImage = document.createElement('div')
      dragImage.textContent = `${items.length} threads`
      dragImage.style.cssText = 'position:absolute;top:-1000px;padding:4px 8px;background:rgba(59,130,246,0.9);color:white;border-radius:4px;font-size:12px;'
      document.body.appendChild(dragImage)
      e.dataTransfer.setDragImage(dragImage, 0, 0)
      setTimeout(() => document.body.removeChild(dragImage), 0)
    }
  }

  const handleDragOver = (e: DragEvent, threadId: string) => {
    e.preventDefault()
    if (!e.dataTransfer) return

    // Don't allow dropping on a dragged item
    if (draggedItems.value.includes(threadId)) {
      e.dataTransfer.dropEffect = 'none'
      draggedOverId.value = null
      return
    }

    e.dataTransfer.dropEffect = 'move'
    if (draggedOverId.value !== threadId) {
      draggedOverId.value = threadId
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement
    if (!related || !related.closest('tr')) {
      draggedOverId.value = null
    }
  }

  const handleDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedItems.value.length) return
    if (draggedItems.value.includes(targetId)) return

    onReparent(draggedItems.value, targetId)
    handleDragEnd()
  }

  const handleDragEnd = () => {
    draggedItems.value = []
    draggedOverId.value = null
    isDragging.value = false
  }

  const getRowClass = (threadId: string): string => {
    const classes: string[] = []

    if (isDragging.value && draggedItems.value.includes(threadId)) {
      classes.push('opacity-50')
    }

    if (draggedOverId.value === threadId) {
      classes.push('!bg-emerald-500/20 ring-1 ring-emerald-500/50')
    }

    return classes.join(' ')
  }

  return {
    isDragging,
    draggedItems,
    draggedOverId,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    getRowClass
  }
}
