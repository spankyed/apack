import { ref, type Ref } from 'vue'
import type { Tab } from '#generated/types.ts'
import type { ThreadTabGroup } from './types.ts'

type Context = 'pinned' | 'ungrouped' | string

interface UseTabDragDropOptions {
  tabs: Ref<readonly Tab[]>
  pinnedTabs: Ref<Tab[]>
  ungroupedTabs: Ref<Tab[]>
  getTabsForGroup: (groupId: string) => Tab[]
  tabGroups: Ref<readonly ThreadTabGroup[]>
  pinnedContainer: Ref<HTMLElement | null>
  mainContainer: Ref<HTMLElement | null>
  onPinTab: (tabId: string) => void
  onUnpinTab: (tabId: string) => void
  onPinTabAt: (tabId: string, targetTabId: string, side: 'left' | 'right') => void
  onUnpinTabAt: (tabId: string, targetTabId: string, side: 'left' | 'right') => void
  onAddToGroup: (tabId: string, groupId: string) => void
  onAddToGroupAt: (tabId: string, groupId: string, targetTabId: string, side: 'left' | 'right') => void
  onRemoveFromGroup: (tabId: string) => void
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
    onAddToGroupAt,
    onRemoveFromGroup,
    onReorder
  } = options

  const getContextTabs = (context: Context): Tab[] => {
    if (context === 'pinned') return pinnedTabs.value
    if (context === 'ungrouped') return ungroupedTabs.value
    return getTabsForGroup(context)
  }

  const getContextFromElement = (el: HTMLElement): Context =>
    el.dataset.groupId || el.dataset.context || 'ungrouped'

  const getSourceContext = (tab: Tab, groupId?: string): Context => {
    if (tab.pinned && groupId) return groupId
    if (tab.pinned) return 'pinned'
    return groupId || 'ungrouped'
  }

  const resetDragState = () => {
    draggedTab.value = null
    dropPosition.value = { index: null, side: 'left', context: 'pinned' }
  }

  const setDropPositionForElement = (el: HTMLElement, side: 'left' | 'right'): boolean => {
    const tabId = el.dataset.tabId
    if (!tabId) return false

    const context = getContextFromElement(el)
    const contextTabs = getContextTabs(context)
    const index = contextTabs.findIndex(t => t.id === tabId)
    if (index === -1) return false

    dropPosition.value = { index, side, context }
    return true
  }

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
    const sourceIndex = contextTabs.findIndex(t => t.id === sourceTab.id)
    if (sourceIndex === -1) return false

    const prevTab = sourceIndex > 0 ? contextTabs[sourceIndex - 1] : null
    const nextTab = sourceIndex < contextTabs.length - 1 ? contextTabs[sourceIndex + 1] : null
    if (!prevTab || !nextTab) return false

    const prevEl = validTabs.find(el => el.dataset.tabId === prevTab.id)
    const nextEl = validTabs.find(el => el.dataset.tabId === nextTab.id)
    if (!prevEl || !nextEl) return false

    const prevRect = prevEl.getBoundingClientRect()
    const nextRect = nextEl.getBoundingClientRect()
    const gapLeft = prevRect.right
    const gapRight = nextRect.left

    if (mouseX < gapLeft || mouseX > gapRight) return false

    const gapWidth = gapRight - gapLeft
    const relativeX = mouseX - gapLeft

    if (relativeX < gapWidth * 0.2) {
      setDropPositionForElement(prevEl, 'right')
    } else if (relativeX > gapWidth * 0.8) {
      setDropPositionForElement(nextEl, 'left')
    } else {
      dropPosition.value = { index: null, side: 'left', context: sourceContext }
    }
    return true
  }

  const findTabUnderMouse = (validTabs: HTMLElement[], mouseX: number): boolean => {
    for (let i = 0; i < validTabs.length; i++) {
      const el = validTabs[i]
      const rect = el.getBoundingClientRect()
      const prevRect = validTabs[i - 1]?.getBoundingClientRect()
      const nextRect = validTabs[i + 1]?.getBoundingClientRect()
      const startX = prevRect ? (prevRect.right + rect.left) / 2 : -Infinity
      const endX = nextRect ? (rect.right + nextRect.left) / 2 : Infinity

      if (mouseX >= startX && mouseX <= endX) {
        const side = mouseX < rect.left + rect.width / 2 ? 'left' : 'right'
        setDropPositionForElement(el, side)
        return true
      }
    }

    return false
  }

  const handleContextChange = (
    sourceTab: Tab,
    sourceContext: Context,
    targetContext: Context
  ): void => {
    if (targetContext === 'pinned') {
      onPinTab(sourceTab.id)
    } else if (sourceContext === 'pinned') {
      onUnpinTab(sourceTab.id)
      if (targetContext !== 'ungrouped') {
        onAddToGroup(sourceTab.id, targetContext)
      }
    } else {
      if (sourceTab.pinned) {
        onUnpinTab(sourceTab.id)
      }
      if (sourceContext !== 'ungrouped') {
        onRemoveFromGroup(sourceTab.id)
      }
      if (targetContext !== 'ungrouped') {
        onAddToGroup(sourceTab.id, targetContext)
      }
    }
  }

  // Drag state
  const draggedTab = ref<{ id: string; groupId?: string } | null>(null)
  const dropPosition = ref<{
    index: number | null
    side: 'left' | 'right'
    context: Context
  } | null>({ index: null, side: 'left', context: 'pinned' })

  const handleDragStart = (tab: Tab, event: DragEvent) => {
    draggedTab.value = { id: tab.id, groupId: tab.groupId }
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
      .filter(el => (el as HTMLElement).dataset.tabId !== draggedTab.value?.id) as HTMLElement[]

    const targetEl = event.target as HTMLElement
    const groupLabel = targetEl.closest('.group-label')
    if (groupLabel) return

    if (validTabs.length === 0) {
      const hasGroups = containerEl.querySelectorAll('.group-label').length > 0

      if (hasGroups) {
        dropPosition.value = { index: null, side: 'left', context: containerType === 'pinned' ? 'pinned' : 'ungrouped' }
      } else {
        dropPosition.value = {
          index: 0,
          side: 'left',
          context: containerType === 'pinned' ? 'pinned' : 'ungrouped'
        }
      }
      return
    }

    const mouseX = event.clientX
    const sourceTab = tabs.value.find(t => t.id === draggedTab.value!.id)

    if (sourceTab) {
      const sourceContext = getSourceContext(sourceTab, draggedTab.value.groupId)
      if (checkGapHover(sourceTab, sourceContext, containerType, mouseX, validTabs)) {
        return
      }
    }

    findTabUnderMouse(validTabs, mouseX)
  }

  const handleDrop = (event: DragEvent) => {
    if (!draggedTab.value || !dropPosition.value) return

    event.preventDefault()

    if (dropPosition.value.index === null) {
      resetDragState()
      return
    }

    const sourceTab = tabs.value.find(t => t.id === draggedTab.value!.id)
    if (!sourceTab) return

    const sourceContext = getSourceContext(sourceTab, draggedTab.value.groupId)
    const { context: targetContext, index: targetIndex, side: targetSide } = dropPosition.value

    // Dropping into empty group (sentinel value -1)
    if (targetIndex === -1) {
      if (sourceContext !== targetContext) {
        handleContextChange(sourceTab, sourceContext, targetContext)
      }
      resetDragState()
      return
    }

    const targetContextTabsBeforeChange = getContextTabs(targetContext)

    // Dropping into truly empty context
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

    // Cross-context move
    if (sourceContext !== targetContext) {
      if (targetContext === 'pinned') {
        onPinTabAt(sourceTab.id, targetTab.id, targetSide)
      } else if (sourceContext === 'pinned' && targetContext === 'ungrouped') {
        onUnpinTabAt(sourceTab.id, targetTab.id, targetSide)
      } else if (targetContext !== 'pinned' && targetContext !== 'ungrouped') {
        // Dropping into a group at a specific position
        if (sourceContext !== 'ungrouped' && sourceContext !== 'pinned') {
          onRemoveFromGroup(sourceTab.id)
        }
        if (sourceTab.pinned) {
          onUnpinTab(sourceTab.id)
        }
        onAddToGroupAt(sourceTab.id, targetContext, targetTab.id, targetSide)
      } else {
        handleContextChange(sourceTab, sourceContext, targetContext)
      }

      resetDragState()
      return
    }

    // Same-context reorder
    const sourceIndex = tabs.value.findIndex(t => t.id === sourceTab.id)
    const fullTargetIndex = tabs.value.findIndex(t => t.id === targetTab.id)

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

    const isPinnedContext = pos.context === 'pinned' || (() => {
      const group = tabGroups.value.find(g => g.id === pos.context)
      return group?.isPinned || false
    })()
    const container = isPinnedContext ? pinnedContainer.value : mainContainer.value
    const contextTabs = getContextTabs(pos.context)
    const targetTab = contextTabs[pos.index]

    if (!container || !targetTab || pos.index < 0 || pos.index >= contextTabs.length) return {}

    const tabElement = container.querySelector(`[data-tab-id="${CSS.escape(targetTab.id)}"]`) as HTMLElement
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
