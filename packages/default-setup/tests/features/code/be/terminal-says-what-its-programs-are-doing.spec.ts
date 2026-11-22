// What a terminal's programs say they are doing (OSC 7501) reaches every window showing it, is kept as far as
// the person has looked, and survives the API restarting.
//
// The host keeps the records and sends them whole, so what is held here is this feature's half: what a window
// is told, what the person has seen of it, and what a terminal starts from. What follows from a change — the
// repository check and the flow event — is `terminal-status-tells-the-repository-and-flows.spec.ts`.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { defaultShell } from '#features/code/be/services/known-shells.ts'
import type { TerminalStatus } from '#features/code/be/types.ts'
import { recordingBroker } from './_support/recording-broker.ts'
import { answered } from './_support/answered.ts'
import { aTerminal, lastTold, record, running, stopsAfterEach, WINDOW } from './_support/terminal-statuses.ts'

stopsAfterEach()

const listed = async (terminalId: string) => {
  const terminals = answered<Array<{ id: string; statuses?: TerminalStatus[] }>>(await running.app!.ask('code', { type: 'terminal.REFRESH_LIST' }, { client: WINDOW }))
  return terminals.find(terminal => terminal.id === terminalId)
}

describe("what a terminal's programs say they are doing", () => {
  it('is told to every window whole, and is in the list a window starts from', async () => {
    const { broker, terminalId, session } = await aTerminal()

    broker.happens(session, { kind: 'programStatus', statuses: [record(), record({ id: 'build', state: 'blocked', kind: 'permission', changed: 2 })] })
    await running.app!.settle()

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
    await running.app!.settle()
    expect(lastTold()).toEqual({ terminalId, statuses: [] })
    expect(await listed(terminalId)).not.toHaveProperty('statuses')
  })

  it('arrives without what cannot be seen in its text', async () => {
    const { broker, session } = await aTerminal()
    // A direction override: the rest of the text reads backwards on a tab and in a notification
    broker.happens(session, { kind: 'programStatus', statuses: [record({ title: 'evil‮gnp.exe', message: 'a​b⁦c' })] })
    await running.app!.settle()
    expect(lastTold()?.statuses[0]).toMatchObject({ title: 'evilgnp.exe', message: 'abc' })
  })

  it('is seen once the person has looked, in every window, until something else changes', async () => {
    const { broker, terminalId, session } = await aTerminal()
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'done', changed: 4 })] })
    await running.app!.settle()
    expect(lastTold()?.statuses[0]?.seen).toBe(false)

    await running.app!.send('code', { type: 'terminal.STATUS_SEEN', terminalId }, { client: WINDOW })
    await running.app!.settle()
    expect(lastTold()?.statuses[0]?.seen).toBe(true)
    expect(repository.terminalQueries.byId(terminalId as EARS.EntityId))
      .toMatchObject({ statusSeenSession: session, statusSeenChanged: 4 })

    // Looking again at nothing new tells nobody
    const told = running.app!.emitted('code').filter(event => event.type === 'terminal.STATUS').length
    await running.app!.send('code', { type: 'terminal.STATUS_SEEN', terminalId }, { client: WINDOW })
    await running.app!.settle()
    expect(running.app!.emitted('code').filter(event => event.type === 'terminal.STATUS')).toHaveLength(told)

    // What it finishes next is past what they looked at
    broker.happens(session, { kind: 'programStatus', statuses: [record({ state: 'error', changed: 5 })] })
    await running.app!.settle()
    expect(lastTold()?.statuses[0]).toMatchObject({ state: 'error', seen: false })
  })

  it("is kept after its shell has gone, and not carried into the next one's", async () => {
    const { broker, terminalId, session } = await aTerminal()
    // As the host ends a session: what its programs finished is told, then the exit
    broker.happens(session, { kind: 'programStatus', statuses: [record({ id: 'build', state: 'done', changed: 3 })] })
    broker.endShell(session, 1)
    await running.app!.settle()
    expect((await listed(terminalId))?.statuses, 'still there to be looked at').toEqual([expect.objectContaining({ id: 'build', state: 'done' })])

    answered(await running.app!.ask('code', { type: 'terminal.RESTART_TERMINAL', terminalId }, { client: WINDOW }))
    await running.app!.nextEmit('code', 'terminal.RESTARTED')
    expect(await listed(terminalId), 'the new shell has said nothing').not.toHaveProperty('statuses')
  })
})

describe('a terminal whose session outlived this process', () => {
  it('starts from what its programs were saying and what the person had seen of it', async () => {
    const broker = recordingBroker({ pidBase: 7300 })
    const app = running.app = await startApp({ systems: ['code'] })
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
    const app = running.app = await startApp({ systems: ['code'] })
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
