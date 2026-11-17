// What a terminal's programs say they are doing (OSC 7501) reaches every window showing it, and two things
// follow from a change that are not telling a window: the repository is checked when a turn ends, and a flow
// hears.
//
// The host keeps the records and sends them whole, so what is held here is this feature's half: what a window
// is told, what the person has seen of it, what survives the API restarting, and what a record that names a
// program other than the one in front is allowed to cause.
import { afterEach, describe, expect, it } from 'vitest'
import { importFlows, resetTestData, startApp, takeSystemErrors, type TestApp } from '@apackdev/testing/harness'
import { settles, testRootEvents } from '@apackdev/sdk/testing'
import type { ProgramStatusRecord } from '@apackdev/sdk/services'
import { fire, on } from '#generated/flow-helpers.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'
import type { TerminalStatus } from '#features/code/be/types.ts'
import { recordingBroker } from './_support/terminal-broker.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'

let app: TestApp | undefined
afterEach(async () => {
  await app?.stop()
  app = undefined
  resetTestData()
})

/** A record as the host sends one, working as `codex` and confirmed, but for what a case says of it */
const record = (over: Partial<ProgramStatusRecord> = {}): ProgramStatusRecord => ({
  id: '', state: 'working', kind: null, progress: null, app: 'codex', title: null, message: null,
  changed: 1, sinceMs: 1_700_000_000_000, confirmed: 'matched', ...over,
})

/** The code system with one terminal a window opened, and the session its shell runs in */
async function aTerminal(systems: string[] = ['code']) {
  const broker = recordingBroker()
  app = await startApp({ systems })
  await app.connect()
  await app.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { sender: CODE, client: WINDOW })
  const opened = (await app.nextEmit('code', 'terminal.OPENED')).data as { id: string }
  await app.settle()
  return { broker, terminalId: opened.id, session: broker.opened[0]!.id }
}

/** What windows were last told of a terminal's statuses */
const lastTold = (): { terminalId: string; statuses: TerminalStatus[] } | undefined =>
  app!.emitted('code').filter(event => event.type === 'terminal.STATUS').at(-1)?.data as { terminalId: string; statuses: TerminalStatus[] } | undefined

/** Every message sent to a system while `during` ran */
async function sentToSystems(during: () => Promise<void>): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const sent: Array<{ type: string } & Record<string, unknown>> = []
  const stop = testRootEvents.onIncoming(({ event }) => { sent.push(event as { type: string }) })
  try {
    await during()
    await app!.settle()
  } finally {
    stop()
  }
  return sent
}

const listed = async (terminalId: string) => {
  await app!.send('code', { type: 'terminal.REFRESH_LIST' }, { sender: CODE, client: WINDOW })
  const terminals = (await app!.nextEmit('code', 'terminal.TERMINALS_LISTED')).data as Array<{ id: string; statuses?: TerminalStatus[] }>
  return terminals.find(terminal => terminal.id === terminalId)
}

describe("what a terminal's programs say they are doing", () => {
  it('is told to every window whole, and is in the list a window starts from', async () => {
    const { broker, terminalId, session } = await aTerminal()

    broker.happens(session, { kind: 'programStatus', statuses: [record(), record({ id: 'build', state: 'blocked', kind: 'permission', changed: 2 })] })
    await app!.settle()

    expect(lastTold()).toEqual({
      terminalId,
      statuses: [
        expect.objectContaining({ id: '', state: 'working', app: 'codex', seen: false }),
        expect.objectContaining({ id: 'build', state: 'blocked', kind: 'permission', seen: false }),
      ],
    })
    expect((await listed(terminalId))?.statuses?.map(status => status.id)).toEqual(['', 'build'])

    // The last record going is told as none, and the list then carries nothing of it
    broker.happens(session, { kind: 'programStatus', statuses: [] })
    await app!.settle()
    expect(lastTold()).toEqual({ terminalId, statuses: [] })
    expect(await listed(terminalId)).not.toHaveProperty('statuses')
  })

  it('arrives without what cannot be seen in its text', async () => {
    const { broker, session } = await aTerminal()
    // A direction override: the rest of the text reads backwards on a tab and in a notification
    broker.happens(session, { kind: 'programStatus', statuses: [record({ title: 'evil‮gnp.exe', message: 'a​b⁦c' })] })
    await app!.settle()
    expect(lastTold()?.statuses[0]).toMatchObject({ title: 'evilgnp.exe', message: 'abc' })
  })

  it('is seen once the person has looked, in every window, until something else changes', async () => {
    const { broker, terminalId, session } = await aTerminal()
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 4 })] })
    await app!.settle()
    expect(lastTold()?.statuses[0]?.seen).toBe(false)

    await app!.send('code', { type: 'terminal.STATUS_SEEN', terminalId }, { sender: CODE, client: WINDOW })
    await app!.settle()
    expect(lastTold()?.statuses[0]?.seen).toBe(true)
    expect(repository.terminalQueries.byId(terminalId as EARS.EntityId))
      .toMatchObject({ statusSeenSession: session, statusSeenChanged: 4 })

    // Looking again at nothing new tells nobody
    const told = app!.emitted('code').filter(event => event.type === 'terminal.STATUS').length
    await app!.send('code', { type: 'terminal.STATUS_SEEN', terminalId }, { sender: CODE, client: WINDOW })
    await app!.settle()
    expect(app!.emitted('code').filter(event => event.type === 'terminal.STATUS')).toHaveLength(told)

    // What it finishes next is past what they looked at
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'error', changed: 5 })] })
    await app!.settle()
    expect(lastTold()?.statuses[0]).toMatchObject({ state: 'error', seen: false })
  })

  it("is kept after its shell has gone, and not carried into the next one's", async () => {
    const { broker, terminalId, session } = await aTerminal()
    // As the host ends a session: what its programs finished is told, then the exit
    broker.happens(session, { kind: 'programStatus', statuses: [record({ id: 'build', state: 'done', changed: 3 })] })
    broker.endShell(session, 1)
    await app!.settle()
    expect((await listed(terminalId))?.statuses, 'still there to be looked at').toEqual([expect.objectContaining({ id: 'build', state: 'done' })])

    await app!.send('code', { type: 'terminal.RESTART_TERMINAL', terminalId }, { sender: CODE, client: WINDOW })
    await app!.nextEmit('code', 'terminal.RESTARTED')
    expect(await listed(terminalId), 'the new shell has said nothing').not.toHaveProperty('statuses')
  })
})

describe('a terminal whose session outlived this process', () => {
  it('starts from what its programs were saying and what the person had seen of it', async () => {
    const broker = recordingBroker({ pidBase: 7300 })
    app = await startApp({ systems: ['code'] })
    await app.connect()
    const { services } = await import('#generated/services.ts')
    const survivor = await services.terminal.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} })
    broker.happens(survivor.id, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 6 }), record({ id: 'later', state: 'error', changed: 9 })] })
    const id = newId(EARS.Entity.Terminal)
    repository.terminalCommands.create({ id, title: 'survivor', shell: defaultShell(), cwd: '/tmp', cols: 80, rows: 24, session: survivor.id })
    repository.terminalCommands.recordStatusSeen(id, survivor.id, 6)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onEvent() {}, onExit() {}, onCrashed() {} })

    expect(terminalService.list().find(terminal => terminal.id === id)?.statuses).toEqual([
      expect.objectContaining({ id: '', state: 'done', seen: true }),
      expect.objectContaining({ id: 'later', state: 'error', seen: false }),
    ])
  })

  it('reads a mark made for another session as nothing seen', async () => {
    const broker = recordingBroker({ pidBase: 7400 })
    app = await startApp({ systems: ['code'] })
    await app.connect()
    const { services } = await import('#generated/services.ts')
    const survivor = await services.terminal.open({ cols: 80, rows: 24 }, { onOutput() {}, onExit() {} })
    broker.happens(survivor.id, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 2 })] })
    const id = newId(EARS.Entity.Terminal)
    repository.terminalCommands.create({ id, title: 'survivor', shell: defaultShell(), cwd: '/tmp', cols: 80, rows: 24, session: survivor.id })
    // A count starts again with each session, so one from the shell before says nothing of this one
    repository.terminalCommands.recordStatusSeen(id, 'the-session-before', 50)

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onEvent() {}, onExit() {}, onCrashed() {} })
    expect(terminalService.list().find(terminal => terminal.id === id)?.statuses?.[0]?.seen).toBe(false)
  })
})

describe('what follows from a change', () => {
  const checks = (sent: Array<{ type: string }>) => sent.filter(event => event.type === 'CHECK_FOR_EXTERNAL_CHANGES').length
  const flowEvents = (sent: Array<{ type: string } & Record<string, unknown>>) =>
    sent.filter(event => event.type === 'TRIGGER_BRAIN_EVENT' && event.eventType === 'terminal.status').map(event => event.payload)

  it('checks the repository when a record leaves working, as a finished command does', async () => {
    const { broker, session } = await aTerminal()
    const starting = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record()] })
    })
    expect(checks(starting), 'nothing has ended').toBe(0)

    const ending = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 2 })] })
    })
    expect(checks(ending)).toBe(1)

    // And when the record goes while it was working: the program exited
    broker.happens(session, { kind: 'programStatus', statuses: [record({ changed: 3 })] })
    const gone = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [] })
    })
    expect(checks(gone)).toBe(1)
  })

  it('tells a flow each state a record enters, with the state it left', async () => {
    const { broker, terminalId, session } = await aTerminal()
    const sent = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [record()] })
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'blocked', kind: 'permission', changed: 2 })] })
      // The same state again, with another figure, is not a state entered
      broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'blocked', kind: 'permission', progress: 50, changed: 3 })] })
    })
    expect(flowEvents(sent)).toEqual([
      { terminalId, id: '', app: 'codex', state: 'working', kind: null, previous: null },
      { terminalId, id: '', app: 'codex', state: 'blocked', kind: 'permission', previous: 'working' },
    ])
  })

  it('tells a flow nothing of a record naming a program other than the one in front', async () => {
    const { broker, session } = await aTerminal()
    const sent = await sentToSystems(async () => {
      broker.happens(session, { kind: 'programStatus', statuses: [
        record({ id: 'forged', state: 'blocked', kind: 'permission', confirmed: 'mismatched' }),
        record({ id: 'windows', state: 'blocked', kind: 'question', confirmed: 'unknown', changed: 2 }),
      ] })
    })
    expect(flowEvents(sent).map(payload => (payload as { id: string }).id), 'where nothing could be compared, it is told').toEqual(['windows'])
  })

  it('runs a flow that listens, and is no error where none does', async () => {
    importFlows({ Listens: { root: true, tracks: [on('terminal.status', [[fire('terminal.status.heard', { label: 'heard' })]])] } })
    const { broker, session } = await aTerminal(['code', 'brain'])
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done' })] })
    await settles(() => expect(app!.flowSteps('Listens')).toContainEqual(expect.objectContaining({ label: 'heard', status: 'completed' })))
    expect(takeSystemErrors()).toEqual([])
  })

  it('is no error with no flow listening', async () => {
    importFlows({ Deaf: { root: true, tracks: [on('something.else', [[fire('never', { label: 'never' })]])] } })
    const { broker, session } = await aTerminal(['code', 'brain'])
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done' })] })
    await app!.settle()
    expect(takeSystemErrors()).toEqual([])
    expect(app!.flowSteps('Deaf')).toEqual([])
  })
})
