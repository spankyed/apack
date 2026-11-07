// Two defects in the code surface's tab bookkeeping (T3 and T9 in the terminal integration review).
//
// A restore has no completion signal, so it has a 2,500 ms deadline. The deadline is the give-up — a restore
// that completes settles itself as each tab lands — but settling also *persisted* the list it had just
// pruned, which turned a slow restore into a permanent one: the backend spawns restored shells one at a
// time, so a terminal that had not come back in time was dropped from storage as well as from the surface,
// and the next launch had nothing left to ask for.
//
// And moving a terminal from a tab into the panel removed the tab without pruning the group it emptied,
// where every other removal in this machine prunes.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

vi.mock('#generated/events.ts', () => ({ sendToSystem: vi.fn(), broadcastToSurface: vi.fn(), sendToSurface: vi.fn() }))
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn() } }))
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}))

const codeState = (await import('#features/code/fe/state.ts')).default

const TABS_KEY = 'default-setup/code:open-tabs'
const GROUPS_KEY = 'default-setup/code:tab-groups'

const started = () => createActor(codeState).start()
const contextOf = (actor: ReturnType<typeof started>) => actor.getSnapshot().context
const storedTabs = (): { tabs: Array<{ path: string }> } => JSON.parse(localStorage.getItem(TABS_KEY) ?? '{"tabs":[]}')

beforeEach(() => localStorage.clear())

describe('settling a restore that did not finish', () => {
  /** A previous session: one file and one terminal, the terminal pinned and in a group */
  const seedTwoTabs = () => {
    localStorage.setItem(TABS_KEY, JSON.stringify({
      tabs: [
        { path: '/src/a.ts', type: 'file', order: 0 },
        { path: 'terminal:t-1', type: 'terminal', terminalId: 't-1', order: 1, isPinned: true, groupId: 'g-1' },
      ],
      activeFilePath: '/src/a.ts',
    }))
    localStorage.setItem(GROUPS_KEY, JSON.stringify([{ id: 'g-1', name: 'shells', color: 'blue', isCollapsed: false, order: 0 }]))
  }

  it('leaves storage alone, so what has not arrived is still there next launch', () => {
    seedTwoTabs()
    const actor = started()
    // Nothing has arrived: no child answered inside the window
    expect(contextOf(actor).openFiles).toEqual([])

    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    expect(storedTabs().tabs.map(tab => tab.path), 'persisting the pruned list is what made the loss permanent')
      .toEqual(['/src/a.ts', 'terminal:t-1'])
  })

  it('keeps the metadata of a tab that has not arrived, so a late one still has its pin and group', () => {
    seedTwoTabs()
    const actor = started()

    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    const metadata = contextOf(actor).pendingPersistedMetadata
    expect([...(metadata ?? [])].map(([path]) => path)).toEqual(['/src/a.ts', 'terminal:t-1'])
    expect(metadata?.get('terminal:t-1')).toMatchObject({ isPinned: true, groupId: 'g-1' })
  })

  it('keeps the group a tab that has not arrived belongs to', () => {
    seedTwoTabs()
    const actor = started()

    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    expect(contextOf(actor).tabGroups.map(group => group.id)).toEqual(['g-1'])
  })

  it('stops waiting, so a restore settles exactly once', () => {
    seedTwoTabs()
    const actor = started()

    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    expect(contextOf(actor).pendingTabOrder).toBeUndefined()
    expect(contextOf(actor).pendingTerminalTabIds).toBeUndefined()
  })
})

describe('moving a terminal from a tab into the panel', () => {
  it('prunes the group it emptied', () => {
    const actor = started()
    actor.send({ type: 'ADD_TAB', tab: { path: 'terminal:t-1', isTerminal: true, terminalInfo: { id: 't-1', title: 't-1', cwd: '/tmp' } } } as never)
    actor.send({ type: 'CREATE_GROUP', name: 'shells', color: 'blue', tabPaths: ['terminal:t-1'] } as never)
    expect(contextOf(actor).tabGroups).toHaveLength(1)

    actor.send({ type: 'MOVE_TERMINAL_TO_PANEL', path: 'terminal:t-1' })

    expect(contextOf(actor).openFiles).toEqual([])
    expect(contextOf(actor).tabGroups, 'a group with no tabs still renders in the tab bar').toEqual([])
  })
})

// A popout showing this surface observes the layout and writes none, which is M5.
//
// Every window has its own copy of the window storage but they share its names, so two windows showing the
// code surface kept their tabs under one key: each restored the other's and each rewrote them, and which
// layout you got was whichever window had most recently changed something. The shell already decides which
// window records app-wide layout — it is how the last-open surface is recorded — and answers the same
// question on `SURFACE_STARTED`.
describe('which window keeps the layout', () => {
  /**
   * A window with a layout of its own and a tab arriving in it.
   *
   * **It has to be a window that would write**, which is the part that took a mutation to notice: a machine
   * whose restore has not settled saves nothing at all (`saveTabsAction` returns early), so a case over one
   * passes whether or not the window is allowed to write.
   */
  const aWindowWithATab = (ownsAppLayout?: boolean) => {
    localStorage.setItem(TABS_KEY, JSON.stringify({
      tabs: [{ path: '/src/a.ts', type: 'file', order: 0 }], activeFilePath: '/src/a.ts',
    }))
    const actor = started()
    if (ownsAppLayout !== undefined) actor.send({ type: 'SURFACE_STARTED', ownsAppLayout })
    // The restore gives up, which is what makes this machine one that saves from here on
    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })
    actor.send({ type: 'ADD_TAB', tab: { path: '/src/b.ts', type: 'file', name: 'b.ts' } })
    return actor
  }

  it('writes nothing when the shell says another window keeps it', () => {
    aWindowWithATab(false)

    expect(storedTabs().tabs.map(tab => tab.path), "the popout rewrote the main window's tabs")
      .toEqual(['/src/a.ts'])
  })

  it('writes when the shell says this window keeps it', () => {
    aWindowWithATab(true)

    expect(storedTabs().tabs.map(tab => tab.path)).toContain('/src/b.ts')
  })

  it('writes when nothing has said otherwise, since a window that was never told is the only one', () => {
    aWindowWithATab()

    expect(storedTabs().tabs.map(tab => tab.path)).toContain('/src/b.ts')
  })
})
