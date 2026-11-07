// A pinned tab is about where it sits, not about outliving what it shows.
//
// `removeTabs` exempted pinned tabs, and every caller of it is a subject that is gone: a terminal that
// exited, a file that was deleted, a file that no longer loads. So a pinned tab survived the thing it was
// showing and became a permanent ghost — the explorer even documented it in a comment rather than fixing it
// (T2 in the terminal integration review). A user closing a tab does not come through here.
import { describe, expect, it } from 'vitest'
import { removeTabs } from '#features/code/fe/utils/tab-management.ts'

const tab = (path: string, isPinned = false) => ({ path, isPinned })

describe('removeTabs', () => {
  it('removes a pinned tab whose subject is gone, rather than leaving a ghost', () => {
    const open = [tab('terminal:t-1', true), tab('/src/a.ts')]

    const { openFiles } = removeTabs(open, 'terminal:t-1', '/src/a.ts')

    expect(openFiles.map(t => t.path)).toEqual(['/src/a.ts'])
  })

  it('leaves every tab it was not asked about, pinned or not', () => {
    const open = [tab('/src/a.ts', true), tab('/src/b.ts'), tab('/src/c.ts', true)]

    const { openFiles } = removeTabs(open, '/src/b.ts', '/src/b.ts')

    expect(openFiles.map(t => t.path)).toEqual(['/src/a.ts', '/src/c.ts'])
  })

  it('moves the active tab off one it removed, pinned or not', () => {
    const open = [tab('/src/a.ts'), tab('terminal:t-1', true), tab('/src/b.ts')]

    const { activeFilePath } = removeTabs(open, 'terminal:t-1', 'terminal:t-1')

    expect(activeFilePath).toBe('/src/b.ts')
  })

  it('leaves no active tab when it removed the last one', () => {
    expect(removeTabs([tab('terminal:t-1', true)], 'terminal:t-1', 'terminal:t-1')).toEqual({
      openFiles: [],
      activeFilePath: null,
    })
  })
})
