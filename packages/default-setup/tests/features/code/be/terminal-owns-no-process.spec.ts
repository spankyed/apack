// The guards for what the broker's ownership dissolved. Each one fails if the construction that removed a
// finding is undone, which is what makes `dissolved` mean anything rather than being a claim about structure
// (the terminal ownership goal's D6 and its acceptance table).
import { describe, expect, it } from 'vitest'
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

/** What the host's terminal service was asked for, and what it was asked to do with each session */
function recordingSessions() {
  const opened: Array<{ cols: number; rows: number; listenersGivenAtOpen: boolean }> = []
  const resized: Array<{ cols: number; rows: number }> = []
  let emit: ((data: string) => void) | undefined

  mockService('terminal', {
    open: async (options, listeners) => {
      // The listeners arrive *with* the open, which is F8: there is no window in which output has nowhere
      // to go. A service that registered them afterwards would hand this `undefined`
      opened.push({ cols: options.cols, rows: options.rows, listenersGivenAtOpen: typeof listeners?.onOutput === 'function' })
      emit = listeners.onOutput
      return {
        id: `broker-${opened.length}`,
        pid: 4242,
        write: async () => {},
        resize: async (cols: number, rows: number) => { resized.push({ cols, rows }) },
        terminate: async () => {},
      }
    },
  })

  return { opened, resized, writeFromTheShell: (data: string) => emit?.(data) }
}

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

/** Opens one terminal and settles, returning its id */
async function openATerminal(app: Awaited<ReturnType<typeof startApp>>) {
  await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
  const opened = await app.nextEmit('code', 'terminal.OPENED')
  await app.settle()
  return (opened as unknown as { data: { id: string } }).data.id
}

describe('what the broker owning the process removes', () => {
  it('declares no pid on a Terminal row, so nothing persisted can be killed by one (F7)', async () => {
    const sessions = recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const id = await openATerminal(app)

    const row = repository.terminalQueries.byId(id as never)
    expect(row, 'the terminal was written').toBeDefined()
    // Not "the field is undefined": the attribute must not be *on the row at all*, which is what a later
    // `restoreAll` reaching for one would need. `restoreAll` used to kill it and its process group
    expect(Object.keys(row as object)).not.toContain('pid')
    expect(sessions.opened).toHaveLength(1)
    await app.stop()
  })

  it('writes no row when a terminal is resized (F5)', async () => {
    recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const id = await openATerminal(app)
    const before = repository.terminalQueries.byId(id as never)!

    // A drag produces one of these per observed frame: 24 per action, measured
    for (let step = 0; step < 24; step++) {
      await app.send('code', { type: 'terminal.RESIZE_TERMINAL', terminalId: id, cols: 80 - step, rows: 24 }, { sender: CODE, client: WINDOW })
    }
    await app.settle()

    const after = repository.terminalQueries.byId(id as never)!
    expect(after.updatedAt, 'twenty-four resizes wrote nothing').toBe(before.updatedAt)
    expect(after.cols, 'the row keeps the size it was created at, which is a starting point').toBe(80)
    await app.stop()
  })

  it('hands the output listener to the service at open, so a first byte cannot be dropped (F8)', async () => {
    const sessions = recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)

    expect(sessions.opened[0]?.listenersGivenAtOpen, 'the listeners came with the open').toBe(true)

    // What a shell writes immediately reaches the surface, with no registration step in between
    sessions.writeFromTheShell('a prompt, written at once')
    await app.settle()
    const output = app.emitted('code').filter(event => event.type === 'terminal.OUTPUT')
    expect(output.map(event => (event as unknown as { data: { data: string } }).data.data)).toContain('a prompt, written at once')
    await app.stop()
  })

  it('leaves no active row behind when every terminal is killed (L2)', async () => {
    recordingSessions()
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)
    expect(repository.terminalQueries.active()).toHaveLength(1)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.killAll()

    // A run that quit used to leave its rows active, so the next boot restored terminals that were never open
    expect(repository.terminalQueries.active(), 'killAll marks every row closed').toEqual([])
    await app.stop()
    resetTestData()
  })
})
