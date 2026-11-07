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
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'

/** What the host's terminal service was asked to start */
function recordingSessions() {
  const opened: Array<{ shell?: string; cwd?: string }> = []
  let next = 0
  mockService('terminal', {
    open: async (options) => {
      opened.push({ shell: options.shell, cwd: options.cwd })
      next += 1
      return {
        id: `broker-${next}`,
        pid: 2000 + next,
        write: async () => {},
        resize: async () => {},
        terminate: async () => {},
      }
    },
  })
  return opened
}

/** A row as something that is not this app might have left it */
function writeATerminalRow(shell: string, cwd: string) {
  const id = newId(EARS.Entity.Terminal)
  repository.terminalCommands.create({ id, title: 'restored', shell, cwd, cols: 80, rows: 24 })
  return id
}

describe('restoring a terminal from a row', () => {
  it('does not start what the row names when this machine does not start it', async () => {
    const opened = recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow('/tmp/payload.sh', '/tmp')

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {} })

    expect(opened, 'a stored string was spawned as an executable').toHaveLength(1)
    expect(opened[0]!.shell, 'the row named it and the machine does not start it').not.toBe('/tmp/payload.sh')
    expect(opened[0]!.shell).toBe(defaultShell())
    await app.stop()
    resetTestData()
  })

  it('does not start in a directory that is not one', async () => {
    const opened = recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow(defaultShell(), '/tmp/this-directory-does-not-exist-apack')

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {} })

    expect(opened[0]!.cwd).not.toBe('/tmp/this-directory-does-not-exist-apack')
    await app.stop()
    resetTestData()
  })

  it('starts what the row names when it is a shell this machine starts', async () => {
    // The refusal has to be about the value and not about restoring: a terminal the user actually had must
    // come back as the shell they had
    const opened = recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    writeATerminalRow(defaultShell(), process.cwd())

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onData: () => {}, onExit: () => {} })

    expect(opened[0]).toEqual({ shell: defaultShell(), cwd: process.cwd() })
    await app.stop()
    resetTestData()
  })
})
