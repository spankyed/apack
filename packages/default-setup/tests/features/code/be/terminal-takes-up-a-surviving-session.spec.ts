// A session that outlived this process is taken up again, not replaced.
//
// **Two different things are called restoring, and only one of them loses anything.** Electron main holds
// the broker's sessions for the life of the app, so a restart of the *API* — a dev reload, a crash-restart —
// leaves every shell running with its output intact. A restart of the *app* ends them with the hold, and
// what comes back there is the record: a new shell in the old one's directory.
//
// Without the first of those, the surviving shells are worse than lost. They keep running with no listener
// and no handle in the process that would have to kill them, a fresh shell is spawned beside each, and both
// accumulate on every restart until the app quits. The row carries the session's id for exactly this, and
// the id is a name rather than a handle: a stale one is offered to the broker and refused, which is how a
// session that survived is told from one that did not.
import { describe, expect, it, vi } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'

const handlers = () => ({ onEvent: vi.fn(), onExit: vi.fn(), onCrashed: vi.fn() })

/** Asked by id, because the service is one object for the process and `resetTestData` does not empty it */
const only = <T extends { id: string }>(list: readonly T[], id: string) => list.filter(one => one.id === id)

/** A row naming a session, as the run before this one would have left it */
function aRowNaming(session: string | undefined) {
  const id = newId(EARS.Entity.Terminal)
  repository.terminalCommands.create({
    id, title: 'survivor', shell: defaultShell(), cwd: '/tmp', cols: 80, rows: 24, ...(session && { session }),
  })
  return id
}

describe('restoring a terminal whose session is still running', () => {
  it('takes up the session rather than spawning beside it', async () => {
    const broker = recordingBroker({ pidBase: 7000 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    // A session alive in the broker that this service knows nothing about, which is exactly what an API
    // restart leaves behind: opened through the service's own door, then orphaned by the restart
    const { services } = await import('#generated/services.ts')
    const survivor = await services.terminal.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} })
    const id = aRowNaming(survivor.id)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(handlers())

    expect(broker.adopted, 'the stored session was never offered to the broker').toEqual([survivor.id])
    expect(broker.opened, 'a second shell was started for a terminal that already had one')
      .toHaveLength(1)
    expect(only(terminalService.list(), id), 'the terminal is there, over the shell that survived')
      .toHaveLength(1)
    await app.stop()
    resetTestData()
  })

  it('reports no pid for it, so no window reads a boundary that is not there', async () => {
    const broker = recordingBroker({ pidBase: 7100 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const { services } = await import('#generated/services.ts')
    const survivor = await services.terminal.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} })
    const id = aRowNaming(survivor.id)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(handlers())

    // A window tells one shell from the next by the pid, and draws a seam where it changes. This is the
    // shell it was already watching, so there is nothing to draw — and any number here would draw it
    const [taken] = only(terminalService.list(), id)
    expect(taken?.pid).toBeNull()
    expect(broker.opened).toHaveLength(1)
    await app.stop()
    resetTestData()
  })

  it('starts exactly one shell when the session is gone', async () => {
    const broker = recordingBroker({ pidBase: 7200 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    // What every row looks like after a full app restart: the hold closed, so the broker ended them all
    const id = aRowNaming('broker-from-a-run-that-ended')

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(handlers())

    expect(broker.adopted, 'the id was not offered, so the refusal never happened')
      .toEqual(['broker-from-a-run-that-ended'])
    expect(broker.opened, 'a refused adoption has to fall back to one shell, and only one').toHaveLength(1)
    const [restored] = only(terminalService.list(), id)
    expect(restored?.pid, 'a shell this process started answers a pid').toBe(7201)
    await app.stop()
    resetTestData()
  })

  it('records the session of every shell it starts, so the next restart can take it up', async () => {
    recordingBroker({ pidBase: 7300 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    const info = await terminalService.create({ cols: 80, rows: 24 }, handlers())

    // Unrecorded, this whole mechanism is inert: every row would fall through to a fresh shell for ever
    const row = repository.terminalQueries.byId(info.id)
    expect(row?.session, 'the row names no session, so nothing could ever be taken up').toBeDefined()
    await app.stop()
    resetTestData()
  })
})
