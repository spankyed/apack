// What a panel's machine does to the code surface's tabs when the tab is of something other than a file: an
// action's code, a prompt's template. The tabs are the surface's, so each is asked of it (`parent-communication.ts`).
import { addTabToParent, getParentContext, updateParentState } from './parent-communication.ts'

/** Shows the tab at `tab.path`: the one open there, else `tab`, opened where a preview tab was */
export function showTabInParent(self: unknown, tab: { path: string }): void {
  const openFiles: { path: string }[] = getParentContext(self)?.openFiles || []
  if (openFiles.some(file => file.path === tab.path)) updateParentState(self, { activeFilePath: tab.path })
  else addTabToParent(self, tab, true)
}

/** Replaces each open tab with what `update` makes of it */
export function updateTabsInParent(self: unknown, update: (file: any) => unknown): void {
  updateParentState(self, { openFiles: (getParentContext(self)?.openFiles || []).map(update) })
}
