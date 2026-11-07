import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPersistedTabs,
  prunePersistedTabsToOpenPaths,
  saveOpenTabs,
  type PersistedTabState,
} from '#features/code/fe/utils/persisted-tabs.ts'

describe('code persisted tabs', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes invalid and duplicate persisted tabs on load', () => {
    localStorage.setItem('default-setup/code:open-tabs', JSON.stringify({
      tabs: [
        { path: '/tmp/a.ts', type: 'file', order: 5 },
        { path: '/tmp/a.ts', type: 'file', order: 6 },
        { path: 123, type: 'file', order: 7 },
        { path: 'terminal:missing-id', type: 'terminal', order: 8 },
      ],
      activeFilePath: '/tmp/a.ts',
      panelTerminalId: null,
      panelTerminalExpanded: false,
    }))

    const loaded = loadPersistedTabs()

    expect(loaded.tabs).toEqual([
      { path: '/tmp/a.ts', type: 'file', order: 5 },
    ])
  })

  it('prunes persisted tabs to actual open paths', () => {
    const state: PersistedTabState = {
      tabs: [
        { path: '/tmp/a.ts', type: 'file', order: 0 },
        { path: '/tmp/stale.ts', type: 'file', order: 1, groupId: 'old-group' },
      ],
      activeFilePath: '/tmp/stale.ts',
      panelTerminalId: null,
      panelTerminalExpanded: false,
    }

    const repaired = prunePersistedTabsToOpenPaths(state, new Set(['/tmp/a.ts']))

    expect(repaired.tabs).toEqual([
      { path: '/tmp/a.ts', type: 'file', order: 0 },
    ])
    expect(repaired.activeFilePath).toBe('/tmp/a.ts')
  })

  it('persists an empty tab list when all tabs are closed', () => {
    saveOpenTabs([], null)

    expect(JSON.parse(localStorage.getItem('default-setup/code:open-tabs')!)).toEqual({
      tabs: [],
      activeFilePath: null,
      panelTerminalId: null,
      panelTerminalExpanded: false,
    })
  })

  it('does not persist a panel terminal id for a terminal already open as an editor tab', () => {
    saveOpenTabs([
      {
        path: 'terminal:Terminal-a',
        content: '',
        originalContent: '',
        modified: false,
        isTerminal: true,
        isPinned: true,
        terminalInfo: {
          id: 'Terminal-a',
          title: 'Terminal',
          pid: 123,
          cwd: '/tmp',
          active: true,
          cols: 80,
          rows: 24,
        },
      } as any,
    ], 'terminal:Terminal-a', 'Terminal-a', true)

    expect(JSON.parse(localStorage.getItem('default-setup/code:open-tabs')!)).toEqual({
      tabs: [
        {
          path: 'terminal:Terminal-a',
          type: 'terminal',
          terminalId: 'Terminal-a',
          order: 0,
          isPinned: true,
        },
      ],
      activeFilePath: 'terminal:Terminal-a',
      panelTerminalId: null,
      panelTerminalExpanded: false,
    })
  })

  it('clears duplicate panel terminal placement when loading persisted terminal tabs', () => {
    localStorage.setItem('default-setup/code:open-tabs', JSON.stringify({
      tabs: [
        {
          path: 'terminal:Terminal-a',
          type: 'terminal',
          terminalId: 'Terminal-a',
          order: 0,
          isPinned: true,
        },
      ],
      activeFilePath: 'terminal:Terminal-a',
      panelTerminalId: 'Terminal-a',
      panelTerminalExpanded: true,
    }))

    const loaded = loadPersistedTabs()

    expect(loaded).toEqual({
      tabs: [
        {
          path: 'terminal:Terminal-a',
          type: 'terminal',
          terminalId: 'Terminal-a',
          order: 0,
          isPinned: true,
        },
      ],
      activeFilePath: 'terminal:Terminal-a',
      panelTerminalId: null,
      panelTerminalExpanded: false,
    })
  })

})
