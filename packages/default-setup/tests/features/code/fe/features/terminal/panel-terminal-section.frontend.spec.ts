// What the panel host does with the attachment the pool hands it.
//
// This host picks which of several terminals it is drawing, so its attachment is held across changes to the
// list and to the selection, and its recorded defect is in that bookkeeping rather than in the pool.
// Mounted in the code surface's scope, it is a case rather than a reading.
//
// **A second mount draws, and that is a case here rather than a note.** The container's template ref used to
// sit on the element reka-ui's `as-child` trigger clones, and such a binding is made for the first instance
// of a component in the process and no later one: a remount reached `attachTerminal` with `container.value`
// undefined, returned at its own guard and drew nothing — no error, no warning, a blank panel until the
// window was reloaded, which a `SurfaceScope` replacement or a `v-if` makes happen. The ref is a child of
// that element now.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('apack-terminal-view', async () => (await import('../../_support/terminal-view.ts')).viewModule())

const { startCodeSurface, terminalInfo } = await import('../../_support/terminal-host.ts')
const { terminalPool } = await import('#features/code/fe/utils/terminal-pool.ts')
const PanelTerminalSection = (await import('#features/code/fe/features/terminal/PanelTerminalSection.vue')).default

let surface: ReturnType<typeof startCodeSurface> | undefined
const info = terminalInfo('panel-1')

afterEach(() => {
  surface?.stop()
  surface = undefined
  terminalPool.dispose(info.id)
  document.body.replaceChildren()
})

describe('the panel terminal host', () => {
  /**
   * **A collapsed panel stops holding the pty small**, which is the half of the grid rule that lives here.
   *
   * The backend runs a pty at the smallest fit of the windows showing it, so a window that stops showing one
   * has to say so or it constrains every other window for as long as its connection lives — the same symptom
   * as a terminal frozen at a grid nobody chose, reached by collapsing a panel instead of by a reconnect.
   * Collapsing falls into the watcher's `else`, which releases the attachment, and a release that actually
   * let go is what sends `terminal.DETACHED`.
   *
   * The release has to report whether *this* host is the one that let go (F1): during a remount the new host
   * attaches before the old one releases, and a message from the old one would drop the fit the new one just
   * recorded. So the case asserts one event and not merely a non-empty list.
   */
  it('tells the backend to release its fit when the panel collapses', async () => {
    surface = startCodeSurface({ terminals: [info], panelTerminalId: info.id, panelTerminalExpanded: true })
    surface.mount(PanelTerminalSection)
    await surface.settle()
    expect(surface.sent.filter((event) => event.type === 'terminal.DETACHED'),
      'nothing has been let go of yet').toEqual([])

    await surface.togglePanel()

    expect(surface.sent.filter((event) => event.type === 'terminal.DETACHED'))
      .toEqual([{ type: 'terminal.DETACHED', terminalId: info.id }])
  })

  /**
   * **T7.** The watcher's `else` is every case that is not a terminal to draw, of which there are three: the
   * panel collapsed, nothing selected, and this one — a terminal gone from the list while its id is still
   * the selected one. Naming the cases left this one in neither branch, so the host went on holding an
   * attachment to a session that no longer exists, in a container no longer in the document.
   */
  it('lets go of a terminal that leaves the list while it is still the selected one', async () => {
    surface = startCodeSurface({ terminals: [info], panelTerminalId: info.id, panelTerminalExpanded: true })
    surface.mount(PanelTerminalSection)
    await surface.settle()
    const entry = terminalPool.ensure(info)
    expect(entry.attachedContainer, 'the panel is not drawing the terminal').not.toBeNull()

    // The backend published a list without it — killed from a tab, from another window, or its shell exited
    // — and nothing cleared the selection
    await surface.setTerminals([])

    expect(entry.attachedContainer, 'the panel still holds a terminal that is gone').toBeNull()
  })

  /**
   * **The remount, which is what the ref's position decided.** A `SurfaceScope` replacement — a pack reload
   * — and this section being `v-if`'d out and back are both this, and under the old shape the second mount
   * drew nothing at all. Put the ref back on the element `as-child` clones and this case fails while the one
   * above still passes, which is the whole reason it is here: a single-mount file could not see it.
   */
  it('draws again after a remount, which is what a pack reload is', async () => {
    surface = startCodeSurface({ terminals: [info], panelTerminalId: info.id, panelTerminalExpanded: true })
    surface.mount(PanelTerminalSection)
    await surface.settle()
    expect(terminalPool.ensure(info).attachedContainer, 'the first mount is not drawing').not.toBeNull()

    surface.unmount()
    surface.mount(PanelTerminalSection)
    await surface.settle()

    expect(terminalPool.ensure(info).attachedContainer, 'the remounted panel drew nothing')
      .not.toBeNull()
  })
})
