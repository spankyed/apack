// A terminal is not its shell: what happens to one when the other ends.
//
// **The status is the whole of the decision, because only the status says whether the user meant it.**
// `exit`, `logout` and Ctrl-D all end a shell with 0 and all mean "close this". A segfault, an OOM kill and
// a `set -e` script failing do not — and the terminal is where the reason is written, so taking the window
// away takes the error with it. That is why a crash keeps the terminal and starts a new generation under
// it rather than removing it, which is what Phase H asks for and what T6's restart-in-place needs.
import { describe, expect, it, vi } from 'vitest'
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness'

/** The sessions the host handed out, and the way to end one as a shell ending would */
function recordingSessions() {
  const ended: Array<(code: number | null) => void> = []
  const opened: Array<{ pid: number }> = []
  let next = 0
  mockService('terminal', {
    open: async (_options, listeners) => {
      next += 1
      ended.push(listeners.onExit)
      const session = { id: `broker-${next}`, pid: 5000 + next }
      opened.push(session)
      return {
        ...session,
        write: async () => {},
        resize: async () => {},
        terminate: async () => {},
      }
    },
  })
  return { ended, opened }
}

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
  const sessions = recordingSessions()
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const { terminalService } = await import('#features/code/be/services/terminal.ts')
  const told = handlers()
  const info = await terminalService.create({ cols: 80, rows: 24 }, told)
  return { sessions, app, terminalService, told, info }
}

describe('a shell ending under its terminal', () => {
  it('takes the terminal with it when the user ended it', async () => {
    const { sessions, app, terminalService, told, info } = await aTerminal()

    sessions.ended[0]!(0)

    expect(only(terminalService.list(), info.id), 'a clean exit closes the terminal').toEqual([])
    expect(told.onExit).toHaveBeenCalledWith(info.id, 0)
    expect(told.onCrashed, 'and is not a crash').not.toHaveBeenCalled()
    await app.stop()
    resetTestData()
  })

  it('leaves the terminal, marked, when the shell died badly', async () => {
    const { sessions, app, terminalService, told, info } = await aTerminal()

    sessions.ended[0]!(139)

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
    const { sessions, app, terminalService, told, info } = await aTerminal()

    sessions.ended[0]!(null)

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
    const { sessions, app, terminalService, told, info } = await aTerminal()
    expect(info.generation, 'the first shell is the first generation').toBe(1)

    sessions.ended[0]!(139)
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

  it('restarts a shell that is still running, ending the old one first', async () => {
    const { app, terminalService, told, info } = await aTerminal()

    const restarted = await terminalService.restart(info.id, told)

    expect(restarted?.generation).toBe(2)
    expect(restarted?.pid).not.toBe(info.pid)
    // The old session ending must not be read as the terminal closing — it was replaced, not lost
    expect(told.onExit).not.toHaveBeenCalled()
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
