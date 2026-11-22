import type { Tab } from '#generated/types.ts'
import type { ThreadTabGroup } from './types.ts'

export function categorizeThreadTabs(
  tabs: readonly Tab[],
  groups: readonly ThreadTabGroup[]
): {
  pinnedTabs: Tab[]
  pinnedGroups: { group: ThreadTabGroup; tabs: Tab[] }[]
  groupedTabs: Map<string, Tab[]>
  ungroupedTabs: Tab[]
} {
  const pinnedTabs: Tab[] = []
  const pinnedGroupsData: { group: ThreadTabGroup; tabs: Tab[] }[] = []
  const groupedTabs = new Map<string, Tab[]>()
  const ungroupedTabs: Tab[] = []

  const pinnedGroupsList = groups.filter(g => g.isPinned).sort((a, b) => a.order - b.order)
  const unpinnedGroups = groups.filter(g => !g.isPinned).sort((a, b) => a.order - b.order)

  pinnedGroupsList.forEach(group => {
    pinnedGroupsData.push({ group, tabs: [] })
  })

  unpinnedGroups.forEach(group => {
    groupedTabs.set(group.id, [])
  })

  for (const tab of tabs) {
    if (tab.groupId && tab.pinned) {
      const pinnedGroupData = pinnedGroupsData.find(pg => pg.group.id === tab.groupId)
      if (pinnedGroupData) {
        pinnedGroupData.tabs.push(tab)
      }
    } else if (tab.pinned && !tab.groupId) {
      pinnedTabs.push(tab)
    } else if (tab.groupId && groupedTabs.has(tab.groupId)) {
      groupedTabs.get(tab.groupId)!.push(tab)
    } else {
      ungroupedTabs.push(tab)
    }
  }

  return { pinnedTabs, pinnedGroups: pinnedGroupsData, groupedTabs, ungroupedTabs }
}
