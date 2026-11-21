export type TabGroupColor = 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'gray'

export const ALL_COLORS: TabGroupColor[] = ['blue', 'orange', 'purple', 'green', 'red', 'teal', 'yellow', 'pink', 'gray']

export interface ThreadTabGroup {
  id: string
  name: string
  color: TabGroupColor
  isCollapsed: boolean
  order: number
  isPinned?: boolean
}

export function getNextAvailableColor(tabGroups: readonly ThreadTabGroup[], isPinned: boolean): TabGroupColor {
  const sameRowGroups = tabGroups.filter(g => (g.isPinned || false) === isPinned)
  const lastColor = sameRowGroups[sameRowGroups.length - 1]?.color
  const nextIndex = tabGroups.length % ALL_COLORS.length
  return ALL_COLORS[nextIndex] === lastColor
    ? ALL_COLORS[(nextIndex + 1) % ALL_COLORS.length]
    : ALL_COLORS[nextIndex]
}
