// The guards for what the broker's ownership dissolved. Each one fails if the construction that removed a
// finding is undone, which is what makes `dissolved` mean anything rather than being a claim about structure
// (the terminal ownership goal's D6 and its acceptance table).
import { describe, expect, it } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { repository } from '#generated/repository.ts'


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
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const id = await openATerminal(app)

    const row = repository.terminalQueries.byId(id as never)
    expect(row, 'the terminal was written').toBeDefined()
    // Not "the field is undefined": the attribute must not be *on the row at all*, which is what a later
    // `restoreAll` reaching for one would need. `restoreAll` used to kill it and its process group
    expect(Object.keys(row as object)).not.toContain('pid')
    expect(broker.opened).toHaveLength(1)
    await app.stop()
  })

  it('writes no row when a terminal is resized (F5)', async () => {
    recordingBroker({ pidBase: 4242 })
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

  it('hands its listeners to the service at open, so what a shell does first cannot be dropped (F8)', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)

    expect(broker.opened[0]?.listenersGivenAtOpen, 'the listeners came with the open').toBe(true)

    // What a program does immediately reaches the surface, with no registration step in between
    broker.happens('broker-1', { kind: 'clipboard', text: 'copied at once' })
    await app.settle()
    const copied = app.emitted('code').filter(event => event.type === 'terminal.CLIPBOARD')
    expect(copied.map(event => (event as unknown as { data: { text: string } }).data.text)).toEqual(['copied at once'])
    await app.stop()
  })

  /**
   * **A terminal a person looks at is not sent its bytes.** A window draws it from the rows its session
   * sends, so this service asks for none: a session opened with an output listener would have every byte
   * cross the app to be thrown away, and be held to the pace of whatever was not reading them.
   */
  it('opens a session without asking for its bytes, and tells a window which session to draw', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)

    expect(broker.opened[0]?.asksForBytes).toBe(false)
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    // The newest: the service outlives a case, so its list holds the terminals of the ones before
    expect(terminalService.list().at(-1)?.session).toBe(broker.opened[0]!.id)
    await app.stop()
  })

  /**
   * **Nothing in this process may end a session when it stops.** A session outlives the API on purpose, so
   * the app's hold on the broker closing is what ends one — and that hold is Electron main's, not this
   * process's. The broker's own suite proves a session survives a client leaving; this is the half above it,
   * that the app does not ask for the kill anyway.
   *
   * **What it reaches is `onShutdown`**, which is what the harness and the API both run on the way out, and
   * a `kill` there fails this case. What it does **not** reach is a machine's `exit` action: XState 5 runs no
   * exit action on `actor.stop()` — measured, with a two-state machine — so such an action is dead code on
   * this path rather than a hazard this case would catch. If a future XState runs them, this case does not
   * change and the guard is somewhere else.
   */
  it('ends no session when the systems stop, which is what an API restart does', async () => {
    const broker = recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    const id = await openATerminal(app)
    expect(broker.opened).toHaveLength(1)

    // What `backendActor?.stop()` does in the API's SIGTERM handler, and what a pack reload does to its systems
    await app.stop()

    expect(broker.terminated, 'stopping the systems ended a user s shell').toEqual([])
    expect(repository.terminalQueries.all().map(row => row.id), 'the row stays, so the next boot restores it')
      .toEqual([id])
    resetTestData()
  })

  it('leaves no row behind when every terminal is killed (L2, L3)', async () => {
    recordingBroker({ pidBase: 4242 })
    const app = await startApp({ systems: ['code'] })
    await app.connect()
    await openATerminal(app)
    expect(repository.terminalQueries.all()).toHaveLength(1)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    // Through the door the user has: there is no kill-everything operation, because the app ending the
    // sessions is the broker's job and not this process's
    // What the windows hear is another spec's subject; this one is about the rows
    const told = { onEvent: () => {}, onExit: () => {}, onCrashed: () => {} }
    for (const terminal of terminalService.list()) await terminalService.kill(terminal.id, told)

    // L2: a run that quit used to leave its rows open, so the next boot restored terminals that were never
    // open. L3: and the rows themselves never went anywhere — a closed one was annotated, not removed, so a
    // row accumulated for every terminal the user had ever opened. `restoreAll` opens what the query
    // answers, which is the whole of what a row is for
    expect(repository.terminalQueries.all(), 'a closed terminal leaves no row').toEqual([])
    await app.stop()
    resetTestData()
  })
})
