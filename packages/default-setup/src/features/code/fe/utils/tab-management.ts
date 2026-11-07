/**
 * Shared utilities for managing tabs in the code editor
 */

import type { TabGroup } from '../state.ts'

// Base tab interface - all tabs must have at least a path
interface BaseTab {
  path: string
  isPinned?: boolean
  groupId?: string
}

/**
 * Removes tabs by path and manages active tab selection
 * @param openFiles - Current array of open tabs
 * @param pathsToRemove - Single path or array of paths to remove
 * @param currentActive - Current active tab path
 * @returns Object with updated openFiles and activeFilePath
 */
export function removeTabs<T extends BaseTab>(
  openFiles: T[],
  pathsToRemove: string | string[],
  currentActive?: string | null
): { openFiles: T[]; activeFilePath: string | null } {
  const pathsSet = new Set(Array.isArray(pathsToRemove) ? pathsToRemove : [pathsToRemove])
  
  // Pinning is about where a tab sits, not about outliving what it shows. Every caller of this is a subject
  // that is gone — a terminal that exited, a file deleted, a file that no longer loads — so exempting a
  // pinned tab left a permanent ghost pointing at nothing. A user closing a tab does not come through here
  const filteredTabs = openFiles.filter(tab => !pathsSet.has(tab.path))
  
  // Determine new active file if current was removed
  let newActiveFilePath = currentActive
  
  if (currentActive && pathsSet.has(currentActive)) {
    // Current active was removed, find a new one
    if (filteredTabs.length > 0) {
      // Try to find the tab that was after the removed one
      const removedIndex = openFiles.findIndex(f => f.path === currentActive)
      if (removedIndex >= 0) {
        // Look for next available tab after removed position
        for (let i = removedIndex; i < openFiles.length; i++) {
          const tab = openFiles[i]
          if (!pathsSet.has(tab.path)) {
            newActiveFilePath = tab.path
            break
          }
        }
        
        // If nothing found after, look before
        if (!newActiveFilePath || pathsSet.has(newActiveFilePath)) {
          for (let i = removedIndex - 1; i >= 0; i--) {
            const tab = openFiles[i]
            if (!pathsSet.has(tab.path)) {
              newActiveFilePath = tab.path
              break
            }
          }
        }
      }
      
      // Fallback to first available tab
      if (!newActiveFilePath || pathsSet.has(newActiveFilePath)) {
        newActiveFilePath = filteredTabs[0].path
      }
    } else {
      newActiveFilePath = null
    }
  }
  
  return {
    openFiles: filteredTabs,
    activeFilePath: newActiveFilePath || null
  }
}

// --- Tab view history utilities ---

const MAX_TAB_VIEW_HISTORY = 100

/**
 * Records a tab path as most recently viewed (deduplicates and appends)
 */
export function pushTabViewHistory(history: string[], path: string): string[] {
  const updated = [...history.filter(p => p !== path), path]
  return updated.length > MAX_TAB_VIEW_HISTORY ? updated.slice(-MAX_TAB_VIEW_HISTORY) : updated
}

/**
 * Replaces an old path with a new path in tab view history (e.g. after rename)
 */
export function renameInTabViewHistory(history: string[], oldPath: string, newPath: string): string[] {
  return history.map(p => p === oldPath ? newPath : p)
}

function findMostRecentTab(history: string[], openPaths: Set<string>): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (openPaths.has(history[i])) return history[i]
  }
}

/**
 * Determines the next active tab after closing one or more tabs, using view history.
 * Falls back to the first remaining tab if history has no match.
 */
export function nextActiveFromHistory<T extends BaseTab>(
  history: string[],
  remainingTabs: T[],
): string | null {
  if (remainingTabs.length === 0) return null
  const openPaths = new Set(remainingTabs.map(f => f.path))
  return findMostRecentTab(history, openPaths) ?? remainingTabs[0].path
}

/**
 * Reorders tabs by moving a tab from one position to another
 * Respects pinned tab boundaries - pinned tabs stay before unpinned tabs
 * @param openFiles - Current array of open tabs
 * @param fromIndex - Index of tab to move
 * @param toIndex - Index to move tab to
 * @returns Reordered array of tabs
 */
export function reorderTabs<T extends BaseTab>(
  openFiles: T[],
  fromIndex: number,
  toIndex: number
): T[] {
  // Validate indices
  if (fromIndex < 0 || fromIndex >= openFiles.length ||
      toIndex < 0 || toIndex >= openFiles.length ||
      fromIndex === toIndex) {
    return openFiles
  }

  const result = [...openFiles]
  const [movedTab] = result.splice(fromIndex, 1)

  // Find the boundary between pinned and unpinned tabs
  const pinnedCount = result.filter(tab => tab.isPinned).length

  // Enforce pinned boundaries:
  // - Pinned tabs can only be reordered within pinned section (0 to pinnedCount-1)
  // - Unpinned tabs can only be reordered within unpinned section (pinnedCount to end)
  let finalToIndex = toIndex

  if (movedTab.isPinned) {
    // Moving a pinned tab - constrain to pinned section
    finalToIndex = Math.min(toIndex, pinnedCount)
  } else {
    // Moving an unpinned tab - constrain to unpinned section
    finalToIndex = Math.max(toIndex, pinnedCount)
  }

  result.splice(finalToIndex, 0, movedTab)

  return result
}

/**
 * Groups tabs by their groupId, maintaining order within each group
 * @param tabs - Array of tabs
 * @param groups - Array of tab groups (for ordering)
 * @returns Object with pinned tabs, pinned groups, grouped tabs by group, and ungrouped tabs
 */
export function groupTabs<T extends BaseTab>(
  tabs: T[],
  groups: TabGroup[]
): {
  pinnedTabs: T[]
  pinnedGroups: { group: TabGroup; tabs: T[] }[]
  groupedTabs: Map<string, T[]>
  ungroupedTabs: T[]
} {
  const pinnedTabs: T[] = []
  const pinnedGroupsData: { group: TabGroup; tabs: T[] }[] = []
  const groupedTabs = new Map<string, T[]>()
  const ungroupedTabs: T[] = []

  // Separate pinned and unpinned groups
  const pinnedGroups = groups.filter(g => g.isPinned).sort((a, b) => a.order - b.order)
  const unpinnedGroups = groups.filter(g => !g.isPinned).sort((a, b) => a.order - b.order)

  // Initialize pinned groups
  pinnedGroups.forEach(group => {
    pinnedGroupsData.push({ group, tabs: [] })
  })

  // Initialize unpinned groups map
  unpinnedGroups.forEach(group => {
    groupedTabs.set(group.id, [])
  })

  // Categorize tabs
  for (const tab of tabs) {
    if (tab.groupId && tab.isPinned) {
      // Tab belongs to pinned group
      const pinnedGroupData = pinnedGroupsData.find(pg => pg.group.id === tab.groupId)
      if (pinnedGroupData) {
        pinnedGroupData.tabs.push(tab)
      }
    } else if (tab.isPinned && !tab.groupId) {
      // Individual pinned tab
      pinnedTabs.push(tab)
    } else if (tab.groupId && groupedTabs.has(tab.groupId)) {
      // Tab in unpinned group
      groupedTabs.get(tab.groupId)!.push(tab)
    } else {
      // Ungrouped tab
      ungroupedTabs.push(tab)
    }
  }

  return { pinnedTabs, pinnedGroups: pinnedGroupsData, groupedTabs, ungroupedTabs }
}
