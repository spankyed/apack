// What of a terminal outlasts the shell under it: its screen, in a recording the next shell starts under
// and a window can look back through; and the shell itself, where it was asked to keep running.
//
// The host's terminal service is stood in for, so what is pinned here is the app's half: which sessions
// are opened recorded and which begin from a recording, who is told a terminal is kept, and that a
// recording opened by a window is closed when that window is not there to look at it.
import { afterEach, describe, expect, it } from 'vitest'
import { mockService, resetTestData, startApp, takeSystemErrors } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { featureSettings } from '#generated/settings.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'
import type { TerminalInfo } from '#features/code/be/types.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

type App = Awaited<ReturnType<typeof startApp>>

async function started() {
  const removed: string[] = []
  mockService('filesystem', {
    writeFile: async () => {},
    remove: async (file: string) => { removed.push(file) },
  })
  const broker = recordingBroker({ pidBase: 5000 })
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  return { app, broker, removed }
}

async function created(app: App, title = 'one'): Promise<TerminalInfo> {
  await app.send('code', { type: 'terminal.CREATE_TERMINAL', title }, { sender: CODE, client: WINDOW })
  const opened = await app.nextEmit('code', 'terminal.OPENED')
  await app.settle()
  return opened.data as TerminalInfo
}

afterEach(() => { resetTestData() })

const handlers = () => ({ onEvent: () => {}, onExit: () => {}, onCrashed: () => {} })

/** A row as the run before this one left it, naming the session it had if it had one */
function aRowNaming(session?: string) {
  const id = newId(EARS.Entity.Terminal)
  repository.terminalCommands.create({
    id, title: 'from before', shell: defaultShell(), cwd: '/tmp', cols: 80, rows: 24, ...(session && { session }),
  })
  return id
}

describe("a terminal's recording", () => {
  it('is where a new terminal is recorded, and what the shell that replaces it starts under', async () => {
    const { app, broker } = await started()
    const terminal = await created(app)
    const first = broker.opened[0]!.options
    expect(first.record, 'named for the terminal, so the shell after this one finds it').toContain(terminal.id)
    expect(first).toMatchObject({ restore: false, images: true })

    await app.send('code', { type: 'terminal.RESTART_TERMINAL', terminalId: terminal.id }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.RESTARTED')
    expect(broker.opened[1]!.options).toMatchObject({ record: first.record, restore: true, images: true })
    await app.stop()
  })

  it('is what a terminal restored at the next start begins from', async () => {
    const { app, broker } = await started()
    // The app quit: the session went with it, and the row is what is left
    const id = aRowNaming()
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(handlers())
    const restored = broker.opened.filter(({ options }) => options.record?.includes(id))
    expect(restored.map(({ options }) => options.restore), 'a new shell on an empty screen').toEqual([true])
    await app.stop()
  })

  it('is not kept where terminals are not restored', async () => {
    const { app, broker } = await started()
    featureSettings.forFeature('code').set({ path: ['restoreTerminals'], value: false })
    await created(app)
    expect(broker.opened[0]!.options.record, 'recorded though nothing would read it back').toBeUndefined()
    expect(broker.opened[0]!.options.images).toBe(true)
    await app.stop()
  })

  it('goes when the terminal is closed', async () => {
    const { app, broker, removed } = await started()
    const terminal = await created(app)
    await app.send('code', { type: 'terminal.CLOSE_TERMINAL', terminalId: terminal.id }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.CLOSED')
    await app.settle()
    expect(removed).toEqual([broker.opened[0]!.options.record])
    await app.stop()
  })
})

describe('a terminal asked to keep running', () => {
  it('has its session kept, and every window is told', async () => {
    const { app, broker } = await started()
    const terminal = await created(app)
    await app.send('code', { type: 'terminal.KEEP_TERMINAL', terminalId: terminal.id, kept: true }, { sender: CODE, client: WINDOW })
    expect(await app.nextEmit('code', 'terminal.KEPT')).toMatchObject({ data: { terminalId: terminal.id, kept: true } })
    expect(broker.kept).toEqual([broker.opened[0]!.id])

    await app.send('code', { type: 'terminal.REFRESH_LIST' }, { sender: CODE, client: WINDOW })
    const listed = await app.nextEmit('code', 'terminal.TERMINALS_LISTED')
    expect((listed.data as TerminalInfo[]).find(({ id }) => id === terminal.id)?.kept).toBe(true)

    await app.send('code', { type: 'terminal.KEEP_TERMINAL', terminalId: terminal.id, kept: false }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.KEPT')
    expect(broker.kept).toEqual([])
    await app.stop()
  })

  it('is taken up again at the next start as the kept terminal it was', async () => {
    const { app, broker } = await started()
    // Two sessions the last run left running, one of them asked to be
    const { services } = await import('#generated/services.ts')
    const keptOn = await services.terminal.open({ cols: 80, rows: 24 }, { onExit() {} })
    await keptOn.keep(true)
    const other = await services.terminal.open({ cols: 80, rows: 24 }, { onExit() {} })
    const [keptId, otherId] = [aRowNaming(keptOn.id), aRowNaming(other.id)]

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(handlers())
    expect(broker.opened, 'a shell was started beside one that kept running').toHaveLength(2)
    const listed = terminalService.list()
    expect(listed.find(({ id }) => id === keptId)?.kept).toBe(true)
    expect(listed.find(({ id }) => id === otherId)?.kept).toBeUndefined()
    await app.stop()
  })

  it('refuses for a terminal that is not there, to the window that asked', async () => {
    const { app } = await started()
    await app.send('code', { type: 'terminal.KEEP_TERMINAL', terminalId: 'Terminal:none', kept: true }, { sender: CODE, client: WINDOW })
    expect(await app.nextEmit('code', 'terminal.ERROR')).toMatchObject({ data: { terminalId: 'Terminal:none' } })
    expect(takeSystemErrors()).toHaveLength(1)
    await app.stop()
  })
})

describe('looking back through a terminal', () => {
  it('opens its recording for the window that asked, shows the moment asked for, and closes', async () => {
    const { app, broker } = await started()
    const terminal = await created(app)
    await app.send('code', { type: 'terminal.REWIND', terminalId: terminal.id, cols: 100, rows: 30 }, { sender: CODE, client: WINDOW })
    const rewound = await app.nextEmit('code', 'terminal.REWOUND')
    expect(rewound.data).toEqual({ terminalId: terminal.id, session: 'rewind-1', first: 1_000, last: 9_000 })
    expect(broker.rewound[0]).toMatchObject({ recording: broker.opened[0]!.options.record, cols: 100, rows: 30 })

    await app.send('code', { type: 'terminal.REWIND_SEEK', session: 'rewind-1', at: 50_000 }, { sender: CODE, client: WINDOW })
    expect(await app.nextEmit('code', 'terminal.REWIND_SOUGHT'), 'held to what the recording covers')
      .toMatchObject({ data: { session: 'rewind-1', at: 9_000 } })

    await app.send('code', { type: 'terminal.REWIND_CLOSE', session: 'rewind-1' }, { sender: CODE, client: WINDOW })
    await app.settle()
    expect(broker.rewound[0]!.closed).toBe(true)
    // And the terminal it was a recording of was never touched
    expect(broker.terminated).toEqual([])
    await app.stop()
  })

  it('says so when there is no recording to open', async () => {
    const { app, broker } = await started()
    const terminal = await created(app)
    broker.refuseRewind()
    await app.send('code', { type: 'terminal.REWIND', terminalId: terminal.id, cols: 80, rows: 24 }, { sender: CODE, client: WINDOW })
    expect(await app.nextEmit('code', 'terminal.ERROR')).toMatchObject({ data: { terminalId: terminal.id } })
    expect(takeSystemErrors()).toHaveLength(1)
    await app.stop()
  })

  it('closes a recording whose window has gone', async () => {
    const { app, broker } = await started()
    const terminal = await created(app)
    await app.send('code', { type: 'terminal.REWIND', terminalId: terminal.id, cols: 80, rows: 24 }, { sender: CODE, client: WINDOW })
    await app.nextEmit('code', 'terminal.REWOUND')
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.forgetClient('c-another')
    await app.settle()
    expect(broker.rewound[0]!.closed, 'closed for a window that never opened it').toBe(false)
    await terminalService.forgetClient(WINDOW)
    await app.settle()
    expect(broker.rewound[0]!.closed).toBe(true)
    await app.stop()
  })
})
