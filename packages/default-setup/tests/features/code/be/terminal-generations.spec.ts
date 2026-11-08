// A terminal is not its shell: what happens to one when the other ends.
//
// **The status is the whole of the decision, because only the status says whether the user meant it.**
// `exit`, `logout` and Ctrl-D all end a shell with 0 and all mean "close this". A segfault, an OOM kill and
// a `set -e` script failing do not — and the terminal is where the reason is written, so taking the window
// away takes the error with it. That is why a crash keeps the terminal and starts a new generation under
// it rather than removing it, which is what Phase H asks for and what T6's restart-in-place needs.
import { describe, expect, it, vi } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'


const handlers = () => ({ onData: vi.fn(), onExit: vi.fn(), onCrashed: vi.fn() })

/**
 * This terminal's descriptor, or nothing.
 *
 * **Asked by id rather than of the whole list**, because the service is one object for the process and
 * `resetTestData` does not empty it: a case that read the list as its own would describe every terminal
 * every case before it had made.
 */
const only = <T extends { id: string }>(list: readonly T[], id: string) => list.filter(one => one.id === id)

async function aTerminal() {
  const broker = recordingBroker({ pidBase: 5000 })
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const { terminalService } = await import('#features/code/be/services/terminal.ts')
  const told = handlers()
  const info = await terminalService.create({ cols: 80, rows: 24 }, told)
  return { broker, app, terminalService, told, info }
}

describe('a shell ending under its terminal', () => {
  it('takes the terminal with it when the user ended it', async () => {
    const { broker, app, terminalService, told, info } = await aTerminal()

    broker.endShell('broker-1', 0)

    expect(only(terminalService.list(), info.id), 'a clean exit closes the terminal').toEqual([])
    expect(told.onExit).toHaveBeenCalledWith(info.id, 0)
    expect(told.onCrashed, 'and is not a crash').not.toHaveBeenCalled()
    await app.stop()
    resetTestData()
  })

  it('leaves the terminal, marked, when the shell died badly', async () => {
    const { broker, app, terminalService, told, info } = await aTerminal()

    broker.endShell('broker-1', 139)

    const [kept] = only(terminalService.list(), info.id)
    expect(kept?.id, 'the terminal is still there to be read').toBe(info.id)
    expect(kept?.active).toBe(false)
    expect(kept?.exited).toEqual({ code: 139 })
    expect(told.onCrashed).toHaveBeenCalledWith(info.id, 139)
    expect(told.onExit, 'which is not the terminal closing').not.toHaveBeenCalled()
    await app.stop()
    resetTestData()
  })

  /** A signal leaves no status at all, and that is not the same as succeeding */
  it('treats a shell killed by a signal as a crash', async () => {
    const { broker, app, terminalService, told, info } = await aTerminal()

    broker.endShell('broker-1', null)

    expect(only(terminalService.list(), info.id)).toHaveLength(1)
    expect(told.onCrashed).toHaveBeenCalledWith(info.id, null)
    await app.stop()
    resetTestData()
  })
})

describe('restarting a terminal', () => {
  /**
   * **T6.** The id is what every tab, pin, group and position is keyed by, so a restart that mints a new
   * one loses all of them — and loses the transcript of the shell that just failed, which is usually what
   * the user restarted it to read.
   */
  it('keeps the terminal and starts a new generation under it', async () => {
    const { broker, app, terminalService, told, info } = await aTerminal()
    expect(info.generation, 'the first shell is the first generation').toBe(1)

    broker.endShell('broker-1', 139)
    const restarted = await terminalService.restart(info.id, told)

    expect(restarted?.id, 'the same terminal').toBe(info.id)
    expect(restarted?.generation).toBe(2)
    expect(restarted?.active).toBe(true)
    expect(restarted?.exited, 'no longer dead').toBeUndefined()
    expect(restarted?.pid, 'a different process').not.toBe(info.pid)
    expect(only(terminalService.list(), info.id), 'and still one terminal, not two').toHaveLength(1)
    await app.stop()
    resetTestData()
  })

  /**
   * **A restart ends the old shell, and that ending must reach nobody.**
   *
   * The old session's `onExit` arrives while the terminal already names the new one, so the generation
   * token is what drops it (`exited`, which returns when `terminal.opening` has moved on). Without that,
   * the exit falls through to `ended`, where a kill's non-zero status and no `closing` flag mean **crash**
   * — so the terminal the user has just restarted is marked dead under them, and its row keeps an
   * `exited` code.
   *
   * It asserts `onCrashed` for that reason: `onExit` alone passes with the guard removed, because the
   * status of a kill never reads as a close. That is also why the double's `terminate` has to fire an exit
   * at all (`_support/terminal-broker.ts`) — against one that ends nothing, neither assertion can fail.
   */
  it('restarts a shell that is still running, and the old one ending reaches nobody', async () => {
    const { app, terminalService, told, info } = await aTerminal()

    const restarted = await terminalService.restart(info.id, told)

    expect(restarted?.generation).toBe(2)
    expect(restarted?.pid).not.toBe(info.pid)
    expect(told.onExit, 'the replaced session read as the terminal closing').not.toHaveBeenCalled()
    expect(told.onCrashed, 'the replaced session read as a crash, so a live terminal was marked dead')
      .not.toHaveBeenCalled()
    expect(restarted?.exited, 'the restarted terminal carries an exit status').toBeUndefined()
    expect(restarted?.active, 'the restarted terminal is not active').toBe(true)
    await app.stop()
    resetTestData()
  })

  it('answers nothing for a terminal that is not there', async () => {
    const { app, terminalService, told } = await aTerminal()

    expect(await terminalService.restart('Terminal-not-a-real-one', told)).toBeNull()
    await app.stop()
    resetTestData()
  })
})
