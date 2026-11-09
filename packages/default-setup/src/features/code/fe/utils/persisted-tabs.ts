import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('code'))
import type { OpenFile, TerminalTab } from '../state.ts'
import type { ActionTab } from '../features/actions/state.ts'
import type { PromptTab } from '../features/prompts/state.ts'

// Simplified interface for persisted tabs
export interface PersistedTab {
  path: string
  type: 'file' | 'terminal' | 'action' | 'prompt'
  terminalId?: string
  actionId?: string
  promptId?: string
  order: number // Track original position
  isPinned?: boolean // Track pinned state
  groupId?: string // Track group membership
  isPreview?: boolean // Track preview state
}


export interface PersistedTabState {
  tabs: PersistedTab[]
  activeFilePath: string | null
  panelTerminalId: string | null
  panelTerminalExpanded: boolean
}

function getTerminalTabIds(tabs: Array<Pick<PersistedTab, 'type' | 'terminalId'>>): Set<string> {
  return new Set(
    tabs
      .filter(tab => tab.type === 'terminal' && typeof tab.terminalId === 'string')
      .map(tab => tab.terminalId!)
  )
}

function sanitizePanelTerminalId(tabs: PersistedTab[], panelTerminalId: string | null): string | null {
  if (!panelTerminalId) return null
  return getTerminalTabIds(tabs).has(panelTerminalId) ? null : panelTerminalId
}

/**
 * The rows for tabs a restore is still waiting for, taken back out of storage.
 *
 * **Storage is the authority for a tab that has not arrived, because nothing else holds its row.** The
 * surface keeps a path, an order and the three fields a late arrival is hydrated from — not the tab's
 * `type`, nor the `terminalId`, `actionId` or `promptId` that say what it *is* — so a row cannot be rebuilt
 * from what the restore has in hand. What can be done is to leave the stored one alone, which is what this
 * is: a read of the key about to be written, keeping the rows whose tabs are still coming.
 *
 * Each kept row goes back at the position it was stored at, clamped, rather than on the end. Appending is
 * what cost a late tab its slot once already, and the live tabs during a restore were themselves placed by
 * that same persisted order, so the index is the right one to insert against.
 */
function withUnarrived(live: PersistedTab[], stillExpected: ReadonlySet<string>): PersistedTab[] {
  if (stillExpected.size === 0) return live
  const kept = loadPersistedTabs().tabs
    .filter(tab => stillExpected.has(tab.path))
    .sort((left, right) => left.order - right.order)
  if (kept.length === 0) return live

  const merged = [...live]
  for (const tab of kept) merged.splice(Math.min(tab.order, merged.length), 0, tab)
  // Renumbered over the merge, so no two rows claim one position for the next restore to place against
  return merged.map((tab, order) => ({ ...tab, order }))
}

export function saveOpenTabs(
  openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[],
  activeFilePath: string | null,
  panelTerminalId: string | null = null,
  panelTerminalExpanded: boolean = false,
  /**
   * Paths a restore is still waiting for, which this write must not drop.
   *
   * A save made while a restore is in flight knows only the tabs that have arrived. Most saves are skipped
   * for exactly that reason, but a close, a group deletion and a killed terminal are *forced* — the user did
   * something and it has to survive a relaunch — so those arrive here with a partial list, and writing it as
   * given is how closing one tab in the seconds a restore takes emptied the whole stored layout.
   */
  stillExpected: ReadonlySet<string> = new Set()
): void {
  try {
    const tabs: PersistedTab[] = openFiles
      .filter(tab => {
        // Skip diff tabs since we can't restore them
        if ('isDiff' in tab && tab.isDiff) return false
        return true
      })
      .map((tab, index) => {
        const isPreview = 'isPreview' in tab ? tab.isPreview : undefined
        if ('isTerminal' in tab && tab.isTerminal) {
          return {
            path: tab.path,
            type: 'terminal' as const,
            terminalId: tab.terminalInfo.id,
            order: index,
            isPinned: tab.isPinned,
            groupId: tab.groupId,
            isPreview
          }
        }
        if ('isAction' in tab && tab.isAction) {
          return {
            path: tab.path,
            type: 'action' as const,
            actionId: tab.path.replace('action:', ''),
            order: index,
            isPinned: tab.isPinned,
            groupId: tab.groupId,
            isPreview
          }
        }
        if ('isPrompt' in tab && tab.isPrompt) {
          return {
            path: tab.path,
            type: 'prompt' as const,
            promptId: tab.path.replace('prompt:', ''),
            order: index,
            isPinned: tab.isPinned,
            groupId: tab.groupId,
            isPreview
          }
        }
        return {
          path: tab.path,
          type: 'file' as const,
          order: index,
          isPinned: tab.isPinned,
          groupId: tab.groupId,
          isPreview
        }
      })

    const kept = withUnarrived(tabs, stillExpected)
    const sanitizedPanelTerminalId = sanitizePanelTerminalId(kept, panelTerminalId)
    const payload: PersistedTabState = {
      tabs: kept,
      activeFilePath,
      panelTerminalId: sanitizedPanelTerminalId,
      panelTerminalExpanded: sanitizedPanelTerminalId ? panelTerminalExpanded : false,
    }
    storage.set('open-tabs', JSON.stringify(payload))
  } catch (error) {
    console.error('Failed to save open tabs:', error)
  }
}

function isPersistedTab(tab: unknown): tab is PersistedTab {
  if (typeof tab !== 'object' || tab === null) return false
  const t = tab as PersistedTab
  if (typeof t.path !== 'string') return false
  if (t.type === 'file') return true
  if (t.type === 'terminal') return typeof t.terminalId === 'string'
  if (t.type === 'action') return typeof t.actionId === 'string'
  if (t.type === 'prompt') return typeof t.promptId === 'string'
  return false
}

function normalizeTabs(rawTabs: unknown[]): PersistedTab[] {
  const seen = new Set<string>()
  const normalized: PersistedTab[] = []

  for (const raw of rawTabs) {
    if (!isPersistedTab(raw)) continue
    if (seen.has(raw.path)) continue
    seen.add(raw.path)
    normalized.push({
      ...raw,
      order: typeof raw.order === 'number' ? raw.order : normalized.length
    })
  }

  return normalized
}

export function loadPersistedTabs(): PersistedTabState {
  try {
    const stored = storage.get('open-tabs')
    if (!stored) return { tabs: [], activeFilePath: null, panelTerminalId: null, panelTerminalExpanded: false }

    const parsed = JSON.parse(stored)

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.tabs)) {
      return { tabs: [], activeFilePath: null, panelTerminalId: null, panelTerminalExpanded: false }
    }

    const tabs = normalizeTabs(parsed.tabs)
    const panelTerminalId = sanitizePanelTerminalId(
      tabs,
      typeof parsed.panelTerminalId === 'string' ? parsed.panelTerminalId : null
    )

    return {
      tabs,
      activeFilePath: typeof parsed.activeFilePath === 'string' ? parsed.activeFilePath : null,
      panelTerminalId,
      panelTerminalExpanded: panelTerminalId ? parsed.panelTerminalExpanded === true : false
    }
  } catch (error) {
    console.error('Failed to load persisted tabs:', error)
    return { tabs: [], activeFilePath: null, panelTerminalId: null, panelTerminalExpanded: false }
  }
}

export function prunePersistedTabsToOpenPaths(
  state: PersistedTabState,
  openPaths: Set<string>
): PersistedTabState {
  const tabs = state.tabs
    .filter(tab => openPaths.has(tab.path))
    .map((tab, index) => ({ ...tab, order: index }))
  const activeFilePath = state.activeFilePath && openPaths.has(state.activeFilePath)
    ? state.activeFilePath
    : tabs[0]?.path ?? null
  const panelTerminalId = sanitizePanelTerminalId(tabs, state.panelTerminalId)

  return {
    ...state,
    tabs,
    activeFilePath,
    panelTerminalId,
    panelTerminalExpanded: panelTerminalId ? state.panelTerminalExpanded : false,
  }
}

// Sort tabs to put pinned tabs first, maintaining relative order within each group
export function sortTabsByPinned<T extends { isPinned?: boolean }>(tabs: T[]): T[] {
  const pinnedTabs = tabs.filter(tab => tab.isPinned)
  const unpinnedTabs = tabs.filter(tab => !tab.isPinned)
  return [...pinnedTabs, ...unpinnedTabs]
}
