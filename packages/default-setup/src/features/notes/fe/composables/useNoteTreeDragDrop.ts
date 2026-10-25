import { ref, computed, type Ref } from 'vue'
import type { NoteSummary } from '#generated/types.ts'

type DropPosition = 'before' | 'after' | 'on'

interface DropTarget {
  noteId: string
  position: DropPosition
}

interface FileDropData {
  title: string
  content: string
}

interface NoteTreeDragDropOptions {
  notes: Ref<NoteSummary[]>
  selectedNoteIds: Ref<string[]>
  currentNoteId: Ref<string | null>
  onMove: (noteIds: string[], newParentId: string | null) => void
  onReorder?: (noteId: string, newParentId: string | null, newIndex: number) => void
  onFileDrop?: (files: FileDropData[], parentId: string | null, index: number) => void
  expandedNodeIds?: Ref<string[]>
}

export function useNoteTreeDragDrop({
  notes,
  selectedNoteIds,
  currentNoteId,
  onMove,
  onReorder,
  onFileDrop,
  expandedNodeIds,
}: NoteTreeDragDropOptions) {
  const draggedNoteIds = ref<string[]>([])
  const dropTarget = ref<DropTarget | null>(null)
  const isDragging = ref(false)
  const isExternalFileDrag = ref(false)
  let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

  const ALLOWED_EXTENSIONS = ['.md', '.txt']

  function isExternalFileEvent(dt: DataTransfer | null): boolean {
    if (!dt || !dt.types.includes('Files')) return false
    // If we initiated an internal drag, ignore Files type
    if (draggedNoteIds.value.length > 0) return false
    return true
  }

  function getDraggedItems(noteId: string): string[] {
    const effective = new Set(selectedNoteIds.value)
    if (currentNoteId.value) effective.add(currentNoteId.value)
    if (effective.has(noteId)) {
      return [...effective]
    }
    return [noteId]
  }

  function isDescendant(noteId: string, ancestorId: string): boolean {
    const children = notes.value.filter(n => n.parentId === ancestorId)
    for (const child of children) {
      if (child.id === noteId) return true
      if (isDescendant(noteId, child.id)) return true
    }
    return false
  }

  function getCurrentParentId(noteId: string): string | null {
    const note = notes.value.find(n => n.id === noteId)
    return note?.parentId ?? null
  }

  function isExpandedWithChildren(noteId: string): boolean {
    if (!expandedNodeIds?.value?.includes(noteId)) return false
    return notes.value.some(n => n.parentId === noteId)
  }

  function hasDraggedTask(): boolean {
    return draggedNoteIds.value.some(id => {
      const note = notes.value.find(n => n.id === id)
      return note?.noteType === 'task'
    })
  }

  function isValidDrop(targetId: string | null, position: DropPosition): boolean {
    if (!draggedNoteIds.value.length) return false

    if (position === 'before' || position === 'after') {
      // Reorder mode: only single-item
      if (draggedNoteIds.value.length > 1) return false
      const draggedId = draggedNoteIds.value[0]

      // Can't drop on self
      if (targetId === draggedId) return false

      // Can't drop on own descendant
      if (targetId && isDescendant(targetId, draggedId)) return false

      // Block if target is completed
      if (targetId) {
        const target = notes.value.find(n => n.id === targetId)
        if (target?.completed) return false
      }

      // Tasks can only be reordered within task/tasklist containers
      if (hasDraggedTask() && targetId) {
        const target = notes.value.find(n => n.id === targetId)
        // Check that the target's parent is a valid task container
        // (dropping before/after places the item at the target's parent level)
        if (target?.parentId) {
          const parent = notes.value.find(n => n.id === target.parentId)
          if (parent?.noteType !== 'task' && parent?.noteType !== 'tasklist') {
            return false
          }
        } else {
          // Target is at root level — tasks can't go to root
          return false
        }
      }

      return true
    }

    // 'on' mode — reparent
    if (targetId && draggedNoteIds.value.includes(targetId)) return false
    if (targetId) {
      for (const id of draggedNoteIds.value) {
        if (isDescendant(targetId, id)) return false
      }
    }

    // Tasks can only be dropped on tasks or tasklists
    if (hasDraggedTask()) {
      if (!targetId) return false
      const target = notes.value.find(n => n.id === targetId)
      if (target?.noteType !== 'task' && target?.noteType !== 'tasklist') {
        return false
      }
    }

    return true
  }

  function handleDragStart(e: DragEvent, noteId: string) {
    if (!e.dataTransfer) return
    const items = getDraggedItems(noteId)
    draggedNoteIds.value = items
    isDragging.value = true
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify(items))

    if (items.length > 1) {
      const dragImage = document.createElement('div')
      dragImage.textContent = `${items.length} notes`
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

  function computeDropPosition(e: DragEvent, noteId: string): DropPosition {
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const relativeY = (e.clientY - rect.top) / rect.height
    const currentPosition = dropTarget.value?.noteId === noteId ? dropTarget.value.position : null

    if (isExpandedWithChildren(noteId)) {
      if (currentPosition === 'before') return relativeY < 0.60 ? 'before' : 'on'
      if (currentPosition === 'on') return relativeY < 0.40 ? 'before' : 'on'
      return relativeY < 0.50 ? 'before' : 'on'
    }

    if (currentPosition === 'before') return relativeY < 0.40 ? 'before' : relativeY > 0.70 ? 'after' : 'on'
    if (currentPosition === 'after') return relativeY > 0.60 ? 'after' : relativeY < 0.30 ? 'before' : 'on'
    if (currentPosition === 'on') return relativeY < 0.20 ? 'before' : relativeY > 0.80 ? 'after' : 'on'
    return relativeY < 0.30 ? 'before' : relativeY > 0.70 ? 'after' : 'on'
  }

  function handleDragOver(e: DragEvent, noteId: string) {
    e.preventDefault()
    if (!e.dataTransfer) return

    // Cancel any pending drag-leave clear
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }

    const externalFile = isExternalFileEvent(e.dataTransfer)

    // For external file drags, compute position and show indicators without validation
    if (externalFile) {
      isExternalFileDrag.value = true
      isDragging.value = true
      const position = computeDropPosition(e, noteId)
      if (dropTarget.value?.noteId === noteId && dropTarget.value?.position === position) return
      e.dataTransfer.dropEffect = 'copy'
      dropTarget.value = { noteId, position }
      return
    }

    const position = computeDropPosition(e, noteId)

    if (!isValidDrop(noteId, position)) {
      // Try falling back to 'on' if before/after isn't valid
      if (position !== 'on' && isValidDrop(noteId, 'on')) {
        dropTarget.value = { noteId, position: 'on' }
        e.dataTransfer.dropEffect = 'move'
        return
      } else {
        e.dataTransfer.dropEffect = 'none'
        dropTarget.value = null
        return
      }
    }

    // Skip update if nothing changed
    if (dropTarget.value?.noteId === noteId && dropTarget.value?.position === position) return

    e.dataTransfer.dropEffect = 'move'
    dropTarget.value = { noteId, position }
  }

  function handleDragLeave(_e: DragEvent) {
    // Defer clearing so the next dragover (on an adjacent item) can cancel it.
    // This prevents flicker when the cursor crosses gaps between items.
    if (dragLeaveTimer) clearTimeout(dragLeaveTimer)
    dragLeaveTimer = setTimeout(() => {
      dropTarget.value = null
      dragLeaveTimer = null
    }, 50)
  }

  function getEndIndex(parentId: string | null, draggedId: string): number {
    const siblings = notes.value
      .filter(n => (n.parentId ?? null) === (parentId ?? null))
      .sort((a, b) => a.displayOrder - b.displayOrder)
    let newIndex = siblings.length
    const draggedNote = notes.value.find(n => n.id === draggedId)
    if (draggedNote && (draggedNote.parentId ?? null) === (parentId ?? null)) {
      const draggedIndex = siblings.findIndex(s => s.id === draggedId)
      if (draggedIndex < newIndex) {
        newIndex -= 1
      }
    }
    return newIndex
  }

  function getDropLocation(targetId: string | null): { parentId: string | null; index: number } {
    const currentDT = dropTarget.value
    const isEmptySpaceDrop = !currentDT || currentDT.noteId !== targetId
    const position = isEmptySpaceDrop ? 'on' : currentDT.position

    if (!targetId || position === 'on') {
      const parentId = (currentDT && currentDT.position === 'on') ? (targetId ?? currentDT.noteId ?? null) : null
      const siblings = notes.value
        .filter(n => (n.parentId ?? null) === (parentId ?? null))
        .sort((a, b) => a.displayOrder - b.displayOrder)
      return { parentId, index: siblings.length }
    }

    // before/after
    const targetNote = notes.value.find(n => n.id === targetId)
    if (!targetNote) return { parentId: null, index: 0 }

    const parentId = targetNote.parentId ?? null
    const siblings = notes.value
      .filter(n => (n.parentId ?? null) === (parentId ?? null))
      .sort((a, b) => a.displayOrder - b.displayOrder)
    const targetIndex = siblings.findIndex(s => s.id === targetId)
    const newIndex = position === 'before' ? targetIndex : targetIndex + 1
    return { parentId, index: newIndex }
  }

  function handleFileDrop(e: DragEvent, targetId: string | null) {
    const files = e.dataTransfer?.files
    if (!files || !onFileDrop) return

    const { parentId, index } = getDropLocation(targetId)

    const validFiles: FileDropData[] = []
    let pending = 0

    for (const file of Array.from(files)) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
      if (!ALLOWED_EXTENSIONS.includes(ext)) continue
      pending++

      const reader = new FileReader()
      reader.onload = () => {
        validFiles.push({
          title: file.name.replace(/\.(md|txt)$/i, ''),
          content: reader.result as string,
        })
        pending--
        if (pending === 0) {
          onFileDrop(validFiles, parentId, index)
        }
      }
      reader.readAsText(file)
    }
  }

  function handleDrop(e: DragEvent, targetId: string | null) {
    e.preventDefault()
    e.stopPropagation()

    // Handle external file drops
    if (isExternalFileDrag.value) {
      handleFileDrop(e, targetId)
      handleDragEnd()
      return
    }

    if (!draggedNoteIds.value.length) return

    const currentTarget = dropTarget.value

    // If dropTarget points to a valid 'on' target that differs from the root targetId,
    // honor the dropTarget — the user saw a highlight on that node.
    if (currentTarget && currentTarget.noteId !== targetId && currentTarget.position === 'on') {
      if (isValidDrop(currentTarget.noteId, 'on')) {
        targetId = currentTarget.noteId
      }
    }

    const isEmptySpaceDrop = !currentTarget || currentTarget.noteId !== targetId
    const position = isEmptySpaceDrop ? 'on' : currentTarget.position

    // For root drop or 'on' position: reparent (or reorder)
    if (!targetId || position === 'on') {
      // Single-item drag onto its own parent → reorder
      if (onReorder && draggedNoteIds.value.length === 1) {
        const draggedId = draggedNoteIds.value[0]
        const draggedParent = getCurrentParentId(draggedId)
        if (draggedParent === targetId) {
          const index = isEmptySpaceDrop ? getEndIndex(targetId, draggedId) : 0
          onReorder(draggedId, targetId, index)
          handleDragEnd()
          return
        }
      }

      if (!isValidDrop(targetId, 'on')) {
        handleDragEnd()
        return
      }
      // Single-item: use onReorder for proper displayOrder indexing
      if (onReorder && draggedNoteIds.value.length === 1) {
        const index = isEmptySpaceDrop ? getEndIndex(targetId, draggedNoteIds.value[0]) : 0
        onReorder(draggedNoteIds.value[0], targetId, index)
      } else {
        onMove(draggedNoteIds.value, targetId)
      }
      handleDragEnd()
      return
    }

    // For before/after: reorder
    if ((position === 'before' || position === 'after') && onReorder) {
      if (!isValidDrop(targetId, position)) {
        handleDragEnd()
        return
      }

      const targetNote = notes.value.find(n => n.id === targetId)
      if (!targetNote) {
        handleDragEnd()
        return
      }

      const parentId = targetNote.parentId
      const siblings = notes.value
        .filter(n => (n.parentId ?? null) === (parentId ?? null))
        .sort((a, b) => a.displayOrder - b.displayOrder)

      const targetIndex = siblings.findIndex(s => s.id === targetId)
      let newIndex = position === 'before' ? targetIndex : targetIndex + 1

      // Adjust if dragged note is in same parent and before the target
      const draggedId = draggedNoteIds.value[0]
      const draggedNote = notes.value.find(n => n.id === draggedId)
      if (draggedNote && (draggedNote.parentId ?? null) === (parentId ?? null)) {
        const draggedIndex = siblings.findIndex(s => s.id === draggedId)
        if (draggedIndex < newIndex) {
          newIndex -= 1
        }
      }

      onReorder(draggedId, parentId, newIndex)
    }

    handleDragEnd()
  }

  function cancelDragLeave() {
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
  }

  function handleDragEnd() {
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
    draggedNoteIds.value = []
    dropTarget.value = null
    isDragging.value = false
    isExternalFileDrag.value = false
  }

  function getItemClass(noteId: string): string {
    const classes: string[] = []
    if (isDragging.value && draggedNoteIds.value.includes(noteId)) {
      classes.push('opacity-50')
    }
    if (dropTarget.value?.noteId === noteId && dropTarget.value.position === 'on') {
      if (isExternalFileDrag.value || isValidDrop(noteId, 'on')) {
        classes.push('!bg-blue-500/20 ring-2 ring-blue-500')
      }
    }
    if (selectedNoteIds.value.includes(noteId) && noteId !== currentNoteId.value) {
      classes.push('!bg-neutral-700/20')
    }
    return classes.join(' ')
  }

  const dropIndicator = computed(() => {
    if (!dropTarget.value) return null
    if (dropTarget.value.position === 'on') return null
    return {
      noteId: dropTarget.value.noteId,
      position: dropTarget.value.position,
    }
  })

  return {
    isDragging,
    isExternalFileDrag,
    draggedNoteIds,
    dropTarget,
    dropIndicator,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    cancelDragLeave,
    getItemClass,
  }
}
