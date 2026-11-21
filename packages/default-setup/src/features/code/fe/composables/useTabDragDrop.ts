import { ref, type Ref } from 'vue'
import type { OpenFile, TerminalTab, TabGroup } from '../state.ts'
import type { ActionTab } from '../features/actions/state.ts'
import type { PromptTab } from '../features/prompts/state.ts'

type Tab = OpenFile | TerminalTab | ActionTab | PromptTab
type Context = 'pinned' | 'ungrouped' | string

interface UseTabDragDropOptions {
  tabs: Ref<readonly Tab[]>
  pinnedTabs: Ref<Tab[]>
  ungroupedTabs: Ref<Tab[]>
  getTabsForGroup: (groupId: string) => Tab[]
  tabGroups: Ref<readonly TabGroup[]>
  pinnedContainer: Ref<HTMLElement | null>
  mainContainer: Ref<HTMLElement | null>
  onPinTab: (path: string) => void
  onUnpinTab: (path: string) => void
  onPinTabAt: (path: string, targetPath: string, side: 'left' | 'right') => void
  onUnpinTabAt: (path: string, targetPath: string, side: 'left' | 'right') => void
  onAddToGroup: (path: string, groupId: string) => void
  onRemoveFromGroup: (path: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}

export function useTabDragDrop(options: UseTabDragDropOptions) {
  const {
    tabs,
    pinnedTabs,
    ungroupedTabs,
    getTabsForGroup,
    tabGroups,
    pinnedContainer,
    mainContainer,
    onPinTab,
    onUnpinTab,
    onPinTabAt,
    onUnpinTabAt,
    onAddToGroup,
    onRemoveFromGroup,
    onReorder
  } = options

  // Helper functions
  const getContextTabs = (context: Context): Tab[] => {
    if (context === 'pinned') return pinnedTabs.value
    if (context === 'ungrouped') return ungroupedTabs.value
    return getTabsForGroup(context)
  }

  const getContextFromElement = (el: HTMLElement): Context =>
    el.dataset.groupId || el.dataset.context || 'ungrouped'

  const getSourceContext = (tab: Tab, groupId?: string): Context => {
    // If tab is in a group (pinned or unpinned), use groupId as context
    if (tab.isPinned && groupId) return groupId
    if (tab.isPinned) return 'pinned'
    return groupId || 'ungrouped'
  }

  const resetDragState = () => {
    draggedTab.value = null
    dropPosition.value = { index: null, side: 'left', context: 'pinned' }
  }

  const setDropPositionForElement = (el: HTMLElement, side: 'left' | 'right'): boolean => {
    const tabPath = el.dataset.path
    if (!tabPath) return false

    const context = getContextFromElement(el)
    const contextTabs = getContextTabs(context)
    const index = contextTabs.findIndex(t => t.path === tabPath)
    if (index === -1) return false

    dropPosition.value = { index, side, context }
    return true
  }

  // Check if mouse is hovering over gap where dragged tab was (20% threshold logic)
  const checkGapHover = (
    sourceTab: Tab,
    sourceContext: Context,
    containerType: string,
    mouseX: number,
    validTabs: HTMLElement[]
  ): boolean => {
    const isInSameContainer = (sourceContext === 'pinned' && containerType === 'pinned') ||
                              (sourceContext !== 'pinned' && containerType !== 'pinned')
    if (!isInSameContainer) return false

    const contextTabs = getContextTabs(sourceContext)
    const sourceIndex = contextTabs.findIndex(t => t.path === sourceTab.path)
    if (sourceIndex === -1) return false

    const prevTab = sourceIndex > 0 ? contextTabs[sourceIndex - 1] : null
    const nextTab = sourceIndex < contextTabs.length - 1 ? contextTabs[sourceIndex + 1] : null
    if (!prevTab || !nextTab) return false

    const prevEl = validTabs.find(el => el.dataset.path === prevTab.path)
    const nextEl = validTabs.find(el => el.dataset.path === nextTab.path)
    if (!prevEl || !nextEl) return false

    const prevRect = prevEl.getBoundingClientRect()
    const nextRect = nextEl.getBoundingClientRect()
    const gapLeft = prevRect.right
    const gapRight = nextRect.left

    if (mouseX < gapLeft || mouseX > gapRight) return false

    // Mouse is in gap - apply 20% threshold
    const gapWidth = gapRight - gapLeft
    const relativeX = mouseX - gapLeft

    if (relativeX < gapWidth * 0.2) {
      // Left 20% of gap - position after prevTab
      setDropPositionForElement(prevEl, 'right')
    } else if (relativeX > gapWidth * 0.8) {
      // Right 20% of gap - position before nextTab
      setDropPositionForElement(nextEl, 'left')
    } else {
      // Middle 60% - no change (tab stays in original position)
      dropPosition.value = { index: null, side: 'left', context: sourceContext }
    }
    return true
  }

  // Find which tab the mouse is hovering over
  const findTabUnderMouse = (validTabs: HTMLElement[], mouseX: number): boolean => {
    for (let i = 0; i < validTabs.length; i++) {
      const el = validTabs[i]
      const rect = el.getBoundingClientRect()
      const nextRect = validTabs[i + 1]?.getBoundingClientRect()
      const endX = nextRect ? (rect.right + nextRect.left) / 2 : rect.right + 50

      if (mouseX >= rect.left && mouseX <= endX) {
        const side = mouseX < rect.left + rect.width / 2 ? 'left' : 'right'
        setDropPositionForElement(el, side)
        return true
      }
    }

    // Check if beyond last tab
    const lastTabRect = validTabs[validTabs.length - 1].getBoundingClientRect()
    if (mouseX > lastTabRect.right) {
      setDropPositionForElement(validTabs[validTabs.length - 1], 'right')
      return true
    }

    return false
  }

  // Handle moving tab between contexts (pinned/ungrouped/groups)
  const handleContextChange = (
    sourceTab: Tab,
    sourceContext: Context,
    targetContext: Context
  ): void => {
    if (targetContext === 'pinned') {
      onPinTab(sourceTab.path)
    } else if (sourceContext === 'pinned') {
      // Moving from individual pinned tab
      onUnpinTab(sourceTab.path)
      if (targetContext !== 'ungrouped') {
        onAddToGroup(sourceTab.path, targetContext)
      }
    } else {
      // Moving from group or ungrouped
      // First check if we need to unpin (if tab is currently pinned, e.g., from pinned group)
      if (sourceTab.isPinned) {
        onUnpinTab(sourceTab.path)
      }

      if (sourceContext !== 'ungrouped') {
        onRemoveFromGroup(sourceTab.path)
      }
      if (targetContext !== 'ungrouped') {
        onAddToGroup(sourceTab.path, targetContext)
      }
    }
  }

  // Drag state
  const draggedTab = ref<{ path: string; groupId?: string } | null>(null)
  const dropPosition = ref<{
    index: number | null
    side: 'left' | 'right'
    context: Context
  } | null>({ index: null, side: 'left', context: 'pinned' })

  // Drag handlers
  const handleDragStart = (tab: Tab, event: DragEvent) => {
    const groupId = 'groupId' in tab ? tab.groupId : undefined
    draggedTab.value = { path: tab.path, groupId }
    event.dataTransfer!.effectAllowed = 'move'
    event.dataTransfer!.setData('text/plain', JSON.stringify(draggedTab.value))
  }

  const handleDragOver = (event: DragEvent) => {
    if (!draggedTab.value) return

    event.preventDefault()
    event.dataTransfer!.dropEffect = 'move'

    const containerEl = event.currentTarget as HTMLElement
    const containerType = containerEl.dataset.container
    if (!containerType) return

    const validTabs = Array.from(containerEl.querySelectorAll('.tab-item'))
      .filter(el => (el as HTMLElement).dataset.path !== draggedTab.value?.path) as HTMLElement[]

    // Check if we're hovering over a group label
    const targetEl = event.target as HTMLElement
    const groupLabel = targetEl.closest('.group-label')
    if (groupLabel) {
      // Let group label handle it
      return
    }

    if (validTabs.length === 0) {
      // Check if there are ANY group labels in the container
      const hasGroups = containerEl.querySelectorAll('.group-label').length > 0

      if (hasGroups) {
        // Container has groups but no ungrouped tabs - don't set position
        // User needs to hover over a specific group label
        dropPosition.value = { index: null, side: 'left', context: containerType === 'pinned' ? 'pinned' : 'ungrouped' }
      } else {
        // Truly empty container - allow drop to ungrouped
        dropPosition.value = {
          index: 0,
          side: 'left',
          context: containerType === 'pinned' ? 'pinned' : 'ungrouped'
        }
      }
      return
    }

    const mouseX = event.clientX
    const sourceTab = tabs.value.find(t => t.path === draggedTab.value!.path)

    // Check gap hover first (if dragging to original position)
    if (sourceTab) {
      const sourceContext = getSourceContext(sourceTab, draggedTab.value.groupId)
      if (checkGapHover(sourceTab, sourceContext, containerType, mouseX, validTabs)) {
        return
      }
    }

    // Normal tab detection
    findTabUnderMouse(validTabs, mouseX)
  }

  const handleDrop = (event: DragEvent) => {
    if (!draggedTab.value || !dropPosition.value) return

    event.preventDefault()

    if (dropPosition.value.index === null) {
      resetDragState()
      return
    }

    const sourceTab = tabs.value.find(t => t.path === draggedTab.value!.path)
    if (!sourceTab) return

    const sourceContext = getSourceContext(sourceTab, draggedTab.value.groupId)
    const { context: targetContext, index: targetIndex, side: targetSide } = dropPosition.value

    // Special case: dropping into empty group (sentinel value -1)
    if (targetIndex === -1) {
      if (sourceContext !== targetContext) {
        handleContextChange(sourceTab, sourceContext, targetContext)
      }
      resetDragState()
      return
    }

    // Get target tab BEFORE context change to avoid index shifts
    const targetContextTabsBeforeChange = getContextTabs(targetContext)

    // Special case: dropping into truly empty ungrouped/pinned context
    if (targetIndex === 0 && targetContextTabsBeforeChange.length === 0 &&
        (targetContext === 'ungrouped' || targetContext === 'pinned')) {
      if (sourceContext !== targetContext) {
        handleContextChange(sourceTab, sourceContext, targetContext)
      }
      resetDragState()
      return
    }

    const targetTab = targetContextTabsBeforeChange[targetIndex]

    if (!targetTab) {
      resetDragState()
      return
    }

    // Cross-context move: use atomic pin/unpin-at to avoid stale reactivity
    if (sourceContext !== targetContext) {
      if (targetContext === 'pinned') {
        onPinTabAt(sourceTab.path, targetTab.path, targetSide)
      } else if (sourceContext === 'pinned' && targetContext === 'ungrouped') {
        onUnpinTabAt(sourceTab.path, targetTab.path, targetSide)
      } else {
        // Group moves — fall back to existing handleContextChange
        handleContextChange(sourceTab, sourceContext, targetContext)
      }

      resetDragState()
      return
    }

    // Same-context reorder
    const sourceIndex = tabs.value.findIndex(t => t.path === sourceTab.path)
    const fullTargetIndex = tabs.value.findIndex(t => t.path === targetTab.path)

    const offset = targetSide === 'left'
      ? (sourceIndex < fullTargetIndex ? -1 : 0)
      : (sourceIndex < fullTargetIndex ? 0 : 1)
    const insertIndex = fullTargetIndex + offset

    if (sourceIndex !== insertIndex) {
      onReorder(sourceIndex, insertIndex)
    }

    resetDragState()
  }

  const handleDragLeave = (event: DragEvent) => {
    const relatedTarget = event.relatedTarget as HTMLElement
    const leftBothContainers = !pinnedContainer.value?.contains(relatedTarget) &&
                               !mainContainer.value?.contains(relatedTarget)
    if (leftBothContainers) resetDragState()
  }

  const getDropIndicatorStyle = () => {
    const pos = dropPosition.value
    if (!pos || pos.index === null) return {}

    // Determine which container based on context
    // Context can be: 'pinned' (individual pinned), groupId (pinned or unpinned), or 'ungrouped'
    const isPinnedContext = pos.context === 'pinned' || (() => {
      const group = tabGroups.value.find(g => g.id === pos.context)
      return group?.isPinned || false
    })()
    const container = isPinnedContext ? pinnedContainer.value : mainContainer.value
    const contextTabs = getContextTabs(pos.context)
    const targetTab = contextTabs[pos.index]

    if (!container || !targetTab || pos.index < 0 || pos.index >= contextTabs.length) return {}

    const tabElement = container.querySelector(`[data-path="${CSS.escape(targetTab.path)}"]`) as HTMLElement
    if (!tabElement) return {}

    const rect = tabElement.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const left = (pos.side === 'left' ? rect.left : rect.right) - containerRect.left + container.scrollLeft

    const group = tabGroups.value.find(g => g.id === pos.context)
    const backgroundColor = group ? `var(--color-${group.color})` : 'rgb(59, 130, 246)'

    return { left: `${left}px`, backgroundColor }
  }

  return {
    draggedTab,
    dropPosition,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd: resetDragState,
    handleDragLeave,
    getDropIndicatorStyle
  }
}
