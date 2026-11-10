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
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({
  terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), disposeAll: vi.fn() },
}))
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}))

const codeState = (await import('#features/code/fe/state.ts')).default
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')

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

  /**
   * **T10's guard, which is why that row dissolves rather than being fixed.**
   *
   * The claim was that every per-tab save persists a list without the tabs still arriving. It does not:
   * `saveTabsAction` returns early while the order is still pending, and the save fires naturally on the
   * last arrival, because that is when `addTab` clears it. What made the claim look true is the *settled*
   * case above — a save after the settle wrote a pruned group list — and that is a different defect.
   */
  it('persists nothing while the restore is still arriving, so a partial list is never written', () => {
    seedTwoTabs()
    const actor = started()

    // One of the two arrives; the other is still expected, so the batch is in flight
    actor.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } } as never)

    expect(storedTabs().tabs.map(tab => tab.path), 'a save mid-restore wrote the list it had so far')
      .toEqual(['/src/a.ts', 'terminal:t-1'])
  })

  /**
   * **A close is forced past the mid-restore guard, and it took the unarrived tabs with it.**
   *
   * `saveTabsAction` returns early while a restore is in flight, which is the case above. `CLOSE_TAB`,
   * `CLOSE_ACTIVE_TAB`, `DELETE_GROUP` and `KILL_TERMINAL` go through `forceSaveTabsAction` instead, which
   * has to write — the user closed something and that must survive a relaunch — and wrote the open tabs
   * alone. So closing one tab in the seconds a restore takes persisted a list without every tab still on its
   * way, and the next launch had nothing left to ask for. The restore window is not a moment: the backend
   * spawns restored shells one at a time, and closing a tab you did not want back is a thing people do
   * exactly then.
   */
  it('keeps what has not arrived when a close forces a save mid-restore', () => {
    seedTwoTabs()
    const actor = started()

    // One of the two arrives; the terminal is still expected, so the batch is in flight
    actor.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } } as never)
    actor.send({ type: 'CLOSE_TAB', path: '/src/a.ts' } as never)

    expect(storedTabs().tabs.map(tab => tab.path), 'the close wrote a list without the tab still arriving')
      .toEqual(['terminal:t-1'])
  })

  /**
   * **The settle is not the end of the restore, and the prunes have to know that.**
   *
   * Settling clears `pendingTabOrder` — the order has been applied — while `pendingPersistedMetadata` still
   * holds the tabs that have not arrived. Every prune keyed on the order alone therefore started firing
   * again with tabs still coming, and a prune that counts only *open* tabs removes the group of one that is
   * still expected. So the arrival of the tab with no group dropped the other tab's group.
   */
  it('keeps a still-expected tab s group when another tab arrives after the settle', () => {
    seedTwoTabs()
    const actor = started()
    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    // `/src/a.ts` arrives late; `terminal:t-1` is still expected, and `g-1` is its group
    actor.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } } as never)

    expect(contextOf(actor).tabGroups.map(group => group.id), 'the group of a tab still coming was pruned')
      .toEqual(['g-1'])
  })

  /**
   * And the same arrival persists, so the loss would outlive the session: `persistCodeTabs` prunes the
   * groups it writes, and the per-tab save resumes once the order is cleared. That is what made this
   * permanent rather than a wrong screen until the next launch.
   */
  it('leaves a still-expected tab s group in storage when another tab arrives after the settle', () => {
    seedTwoTabs()
    const actor = started()
    actor.send({ type: 'RESTORE_PERSISTED_TABS_SETTLED' })

    actor.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } } as never)

    const stored = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as Array<{ id: string }>
    expect(stored.map(group => group.id), 'storage lost the group, so the next launch has nothing to restore it from')
      .toEqual(['g-1'])
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

/**
 * **Who owns the terminal pool**, which is a module singleton and so has nothing else that could.
 *
 * A component releases its terminal on unmount and deliberately does not dispose it, so a remount draws the
 * same emulator again. That is right while this bundle is alive and a leak once it is not: the shell
 * replaces this pack's frontend by importing a fresh module with a fresh pool, and the last one's emulator
 * instances, DOM and GL contexts stay in the window with nothing left that could reach them.
 *
 * A child actor and not an `exit` action, because **XState 5 runs no `exit` action on `actor.stop()`** — an
 * exit here would read as cleanup and be dead code. An invoked actor's cleanup does run.
 */
describe('the terminal pool the code surface holds', () => {
  it('is left alone while the surface is running', () => {
    const actor = started()
    actor.send({ type: 'ADD_TAB', tab: { path: '/src/a.ts' } } as never)

    expect(terminalPool.disposeAll, 'a running surface disposed the emulators it is drawing with')
      .not.toHaveBeenCalled()
  })

  it('is disposed when the surface stops, which is when the shell replaces this frontend', () => {
    const actor = started()

    actor.stop()

    expect(terminalPool.disposeAll, 'the stopped surface left its emulators in the window')
      .toHaveBeenCalledTimes(1)
  })
})
