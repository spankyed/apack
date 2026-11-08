// A restored terminal's shell and directory are data, not instructions — which is S3.
//
// `restoreTerminals` defaults to true, so the restore path runs at every boot, and it spawned the `shell`
// the row held with the `cwd` the row held. A Terminal row is writable: the database console's
// `EXECUTE_TRANSACTION` writes one, `apack db exec` writes one, and a backup import replaces the whole store
// with no row-level validation. "Import a backup someone sent you" is enough to make a stored string the
// executable your terminal starts at the next launch.
//
// The ordering the review names is why this case can exist at all: the check it goes through had to stop
// being inert first (F13), because an allow-list whose remedy is the value it just refused changes nothing.
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'


/** A row as something that is not this app might have left it */
function writeATerminalRow(shell: string, cwd: string) {
  const id = newId(EARS.Entity.Terminal)
  repository.terminalCommands.create({ id, title: 'restored', shell, cwd, cols: 80, rows: 24 })
  return id
}

describe('restoring a terminal from a row', () => {
  it('does not start what the row names when this machine does not start it', async () => {
    const broker = recordingBroker({ pidBase: 2000 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow('/tmp/payload.sh', '/tmp')

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect(broker.opened, 'a stored string was spawned as an executable').toHaveLength(1)
    expect(broker.opened[0]!.options.shell, 'the row named it and the machine does not start it').not.toBe('/tmp/payload.sh')
    expect(broker.opened[0]!.options.shell).toBe(defaultShell())
    await app.stop()
    resetTestData()
  })

  it('does not start in a directory that is not one', async () => {
    const broker = recordingBroker({ pidBase: 2000 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow(defaultShell(), '/tmp/this-directory-does-not-exist-apack')

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect(broker.opened[0]!.options.cwd).not.toBe('/tmp/this-directory-does-not-exist-apack')
    await app.stop()
    resetTestData()
  })

  it('starts what the row names when it is a shell this machine starts', async () => {
    // The refusal has to be about the value and not about restoring: a terminal the user actually had must
    // come back as the shell they had
    const broker = recordingBroker({ pidBase: 2000 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow(defaultShell(), process.cwd())

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect({ shell: broker.opened[0]!.options.shell, cwd: broker.opened[0]!.options.cwd })
      .toEqual({ shell: defaultShell(), cwd: process.cwd() })
    await app.stop()
    resetTestData()
  })
})
