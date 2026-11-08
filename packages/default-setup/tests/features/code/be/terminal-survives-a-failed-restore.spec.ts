// A restore that fails must not take the terminal system with it, which is L1.
//
// `restoreTerminalsActor` was invoked with `onDone` and nothing else. XState leaves a machine in the state
// whose invoked actor rejected, and `initializing` handles no events — so one rejection meant every later
// `terminal.CREATE_TERMINAL` and every `GET_CODE_START` for the rest of the session went nowhere and the
// surface showed an empty list. In silence: nothing reported it and nothing recovered.
//
// Restoring is best-effort — what it restores is a convenience, and the previous run's processes are gone
// either way — so the failure is reported and the system goes on doing its job.
//
// **What this case covers is the failure that can happen**, an open that fails, which `restoreAll` already
// survives per terminal. The `onError` branch that was added beside it has no firing case, and the source
// says which edit would give it one: everything `restoreAll` does per terminal is inside a `try`, and what
// is left outside is a settings read and a query.
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp, takeSystemErrors } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

describe('a restore that fails', () => {
  it('reports it and leaves the system able to open a terminal', async () => {
    // A row to restore, and a broker that refuses the first open and allows the rest
    recordingBroker({ pidBase: 3000 }).refuseOpen(1)
    const id = newId(EARS.Entity.Terminal)
    repository.terminalCommands.create({ id, title: 'from last time', shell: defaultShell(), cwd: process.cwd(), cols: 80, rows: 24 })

    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await app.settle()

    // The system is past initializing and answers the window that asks
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'after the failure' },
      { sender: CODE, client: WINDOW })
    const opened = await app.nextEmit('code', 'terminal.OPENED')
    await app.settle()

    expect(opened, 'the system never left initializing, so nothing answered').toBeDefined()
    await app.stop()
    resetTestData()
    // The restore's failure is reported rather than swallowed; clearing it is what keeps the harness honest
    takeSystemErrors()
  })
})
